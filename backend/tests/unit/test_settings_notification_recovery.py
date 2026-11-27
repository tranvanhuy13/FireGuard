"""Offline MySQL outage, settings cache, and notification delivery regressions."""

import ast
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import threading
import time
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import requests
from sqlalchemy.exc import OperationalError

from app.db.engine import read_rows
from app.detection.rules import read_settings
from app.notifications import service as notification
from app.settings.cache import SettingsCache
from tests.source import application_source


def disconnect(code=2013):
    return OperationalError("SELECT secret", {}, Exception(code, "sensitive driver error"))


def wait_for(predicate):
    deadline = time.monotonic() + 2
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(0.005)
    raise AssertionError("Timed out waiting for background refresh")


class SettingsRecoveryTests(unittest.TestCase):
    def test_all_frame_settings_use_one_query_and_copies_are_isolated(self):
        loader = Mock(return_value={"fire_threshold": "80"})
        cache = SettingsCache(loader)
        for _ in range(20):
            result = read_settings(lambda key, default: cache.snapshot().get(key, default))
            self.assertEqual(result["fire"], 0.8)
        cache.snapshot()["fire_threshold"] = "1"
        self.assertEqual(cache.snapshot()["fire_threshold"], "80")
        loader.assert_called_once()

    def test_stale_settings_survive_disconnect_and_refresh_after_recovery(self):
        loader = Mock(side_effect=[{"fire_threshold": "80"}, disconnect(), {"fire_threshold": "90"}])
        cache = SettingsCache(loader, ttl=0)
        self.assertEqual(cache.snapshot()["fire_threshold"], "80")
        wait_for(lambda: not cache._refreshing)
        self.assertEqual(cache.peek()["fire_threshold"], "80")
        cache.snapshot()
        wait_for(lambda: not cache._refreshing)
        self.assertEqual(cache.peek()["fire_threshold"], "90")

    def test_slow_refresh_does_not_block_frames_or_overwrite_committed_write(self):
        entered, release = threading.Event(), threading.Event()

        def load():
            if not entered.is_set():
                entered.set()
                release.wait(2)
            return {"fire_threshold": "80"}

        loader = Mock(return_value={"fire_threshold": "70"})
        cache = SettingsCache(loader, ttl=0)
        cache.snapshot()
        wait_for(lambda: not cache._refreshing)
        cache.loader = load
        cache.snapshot()
        self.assertTrue(entered.wait(1))
        with ThreadPoolExecutor(max_workers=3) as pool:
            values = list(pool.map(lambda _: cache.snapshot(), range(3)))
        self.assertTrue(all(value["fire_threshold"] == "70" for value in values))
        cache.put("fire_threshold", "95")
        release.set()
        wait_for(lambda: not cache._refreshing)
        self.assertEqual(cache.peek()["fire_threshold"], "95")

    def test_cold_failure_is_not_replaced_by_invented_settings(self):
        cache = SettingsCache(Mock(side_effect=disconnect()))
        with self.assertRaises(OperationalError):
            cache.snapshot()
        self.assertEqual(cache.peek(), {})

    def test_disconnected_read_retries_once_and_never_replays_writes(self):
        first, second = Mock(), Mock()
        first.__enter__ = Mock(side_effect=disconnect())
        first.__exit__ = Mock(return_value=False)
        second.__enter__ = Mock(return_value=second)
        second.__exit__ = Mock(return_value=False)
        second.execute.return_value.fetchall.return_value = [{"value": "ok"}]
        with patch("app.db.engine.get_connection", side_effect=[first, second]) as connect:
            self.assertEqual(read_rows("SELECT value FROM settings"), [{"value": "ok"}])
            self.assertEqual(connect.call_count, 2)
        with self.assertRaises(ValueError):
            read_rows("UPDATE settings SET value='x'")
        with patch("app.db.engine.get_connection", side_effect=disconnect()) as connect:
            with self.assertRaises(OperationalError):
                read_rows("SELECT value FROM settings")
            self.assertEqual(connect.call_count, 2)
        with patch("app.db.engine.get_connection", side_effect=disconnect(1045)) as connect:
            with self.assertRaises(OperationalError):
                read_rows("SELECT value FROM settings")
            self.assertEqual(connect.call_count, 1)


class NotificationRecoveryTests(unittest.TestCase):
    def config(self, channel, owner_user_id=None):
        return {
            "enabled": True,
            "configured": True,
            "token": "test-token",
            "chat_id": "-123456",
            "targets": [{"id": "recipient", "chatId": "-123456"}],
            "saved_targets": True,
        }

    def test_one_channel_config_failure_does_not_block_other_channel(self):
        def config(channel, owner_user_id=None):
            if channel == "zalo":
                raise disconnect()
            return self.config(channel)

        with patch("app.notifications.service.channel_config", side_effect=config), \
             patch("app.notifications.service.send_telegram", return_value=True) as sender:
            result = notification.trigger_notifications("fire", 0.9, bypass_cooldown=True)
        self.assertEqual(result["zalo"]["reason"], "configuration_unavailable")
        self.assertEqual(result["zalo"]["http_status"], 503)
        self.assertEqual(result["telegram"]["status"], "sent")
        sender.assert_called_once()

    def test_both_channels_prepare_correct_text_requests_without_database_rereads(self):
        response = Mock(status_code=200, json=lambda: {"ok": True})
        with patch("app.notifications.service.channel_config", side_effect=self.config) as configuration, \
             patch("app.notifications.service.requests.post", return_value=response) as post:
            result = notification.trigger_notifications("fire", 0.9, bypass_cooldown=True)
        self.assertEqual(configuration.call_count, 2)
        self.assertTrue(all(state["status"] == "sent" for state in result.values()))
        self.assertEqual(post.call_count, 2)
        zalo = post.call_args_list[0]
        telegram = post.call_args_list[1]
        self.assertIn("zaloplatforms", zalo.args[0])
        self.assertEqual(zalo.kwargs["json"]["chat_id"], "-123456")
        self.assertIn("api.telegram.org", telegram.args[0])
        self.assertEqual(telegram.kwargs["data"]["chat_id"], "-123456")

    def test_provider_rejection_redaction_never_uses_the_database(self):
        response = Mock(
            status_code=403,
            headers={},
            json=lambda: {
                "ok": False,
                "error_code": 403,
                "description": "secret-token failed for alpha-chat https://example.com/private",
            },
        )
        with patch("app.notifications.service.peek_settings", return_value={"zalo_bot_token": "secret-token"}), \
             patch.dict("os.environ", {"ZALO_BOT_TOKEN": ""}), \
             patch("app.notifications.service.channel_config", side_effect=AssertionError("must not query config")), \
             patch("app.notifications.service.requests.post", return_value=response):
            details = {}
            ok, _ = notification._post(
                "https://example.invalid/send",
                json={"chat_id": "alpha-chat"},
                details=details,
                request_attempts=1,
            )
        self.assertFalse(ok)
        for value in ("secret-token", "alpha-chat", "https://example.com/private"):
            self.assertNotIn(value, details["description"])

    def test_photo_rejection_falls_back_but_bad_credentials_do_not(self):
        import tempfile

        with tempfile.TemporaryDirectory() as directory:
            photo = Path(directory) / "photo.jpg"
            photo.write_bytes(b"test-image")
            for status, description, count in ((400, "photo too large", 2), (401, "unauthorized", 1)):
                responses = [
                    Mock(status_code=status, headers={}, json=lambda: {"ok": False, "error_code": status, "description": description}),
                    Mock(status_code=200, json=lambda: {"ok": True}),
                ]
                details = {}
                with patch("app.notifications.service.requests.post", side_effect=responses) as post, \
                     patch("app.notifications.service.peek_settings", return_value={}):
                    ok = notification.send_telegram(
                        "warning",
                        str(photo),
                        _config=self.config("telegram"),
                        details=details,
                        request_attempts=1,
                    )
                self.assertEqual(post.call_count, count)
                self.assertEqual(ok, count == 2)

    def test_timeout_and_rate_limit_are_reported_in_details(self):
        with patch("app.notifications.service.requests.post", side_effect=requests.Timeout()):
            details = {}
            notification._post("https://example.invalid", details=details, request_attempts=1)
        self.assertEqual(details["reason"], "timeout")
        response = Mock(status_code=429, headers={}, json=lambda: {"ok": False, "parameters": {"retry_after": 12}})
        with patch("app.notifications.service.requests.post", return_value=response), \
             patch("app.notifications.service.peek_settings", return_value={}):
            notification._post("https://example.invalid", details=details, request_attempts=1)
        self.assertEqual(details["reason"], "rate_limited")
        self.assertEqual(details["retry_after"], 12)

    def test_global_test_reports_actual_bot_outcomes_instead_of_false_success(self):
        source = application_source()
        function = next(node for node in ast.parse(source).body if getattr(node, "name", None) == "test_notification")
        function.decorator_list = []
        bot = Mock()
        namespace = {"notification": bot, "Depends": lambda dependency: None, "get_current_user": Mock()}
        exec(compile(ast.Module(body=[function], type_ignores=[]), "main.py", "exec"), namespace)
        for states, expected in ((("failed", "failed"), "error"), (("sent", "failed"), "partial"), (("sent", "sent"), "ok")):
            bot.trigger_notifications.return_value = dict(zip(("zalo", "telegram"), ({"status": state} for state in states)))
            result = namespace["test_notification"](SimpleNamespace(id=7))
            self.assertEqual(result["status"], expected)
            self.assertEqual(set(result["channels"]), {"zalo", "telegram"})
        self.assertTrue(bot.trigger_notifications.call_args.kwargs["bypass_cooldown"])


if __name__ == "__main__":
    unittest.main()
