"""Offline MySQL outage, video wiring and bot delivery regressions."""
import ast
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import threading
import time
import unittest
from unittest.mock import Mock, patch

import requests
from sqlalchemy.exc import OperationalError

from db.engine import read_rows
from detection_rules import read_settings
from settings_cache import SettingsCache
import notification


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
                entered.set(); release.wait(2)
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
        with patch("db.engine.get_connection", side_effect=[first, second]) as connect:
            self.assertEqual(read_rows("SELECT value FROM settings"), [{"value": "ok"}])
            self.assertEqual(connect.call_count, 2)
        with self.assertRaises(ValueError):
            read_rows("UPDATE settings SET value='x'")
        with patch("db.engine.get_connection", side_effect=disconnect()) as connect:
            with self.assertRaises(OperationalError):
                read_rows("SELECT value FROM settings")
            self.assertEqual(connect.call_count, 2)
        with patch("db.engine.get_connection", side_effect=disconnect(1045)) as connect:
            with self.assertRaises(OperationalError):
                read_rows("SELECT value FROM settings")
            self.assertEqual(connect.call_count, 1)


class NotificationRecoveryTests(unittest.TestCase):
    def config(self, channel):
        return {"enabled": True, "configured": True, "token": "test-token", "chat_id": "-123456",
                "targets": [{"id": "recipient", "chatId": "-123456"}], "saved_targets": True}

    def test_one_channel_config_failure_does_not_block_other_channel(self):
        def config(channel):
            if channel == "zalo":
                raise disconnect()
            return self.config(channel)
        with patch("notification.channel_config", side_effect=config), \
             patch("notification.send_telegram", return_value=True) as sender:
            result = notification.trigger_notifications("fire", .9, bypass_cooldown=True)
        self.assertEqual(result["zalo"]["reason"], "configuration_unavailable")
        self.assertEqual(result["zalo"]["http_status"], 503)
        self.assertEqual(result["telegram"]["status"], "sent")
        sender.assert_called_once()

    def test_both_channels_prepare_correct_text_requests_without_database_rereads(self):
        response = Mock(status_code=200, json=lambda: {"ok": True})
        with patch("notification.channel_config", side_effect=self.config) as configuration, \
             patch("notification.requests.post", return_value=response) as post:
            result = notification.trigger_notifications("fire", .9, bypass_cooldown=True)
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
        response = Mock(status_code=403, headers={}, json=lambda: {"ok": False, "error_code": 403,
            "description": "secret-token failed for alpha-chat https://example.com/private"})
        with patch("notification.peek_settings", return_value={"zalo_bot_token": "secret-token"}), \
             patch("notification.channel_config", side_effect=AssertionError("must not query config")), \
             patch("notification.requests.post", return_value=response):
            details = {}
            ok, _ = notification._post("https://example.invalid/send", json={"chat_id": "alpha-chat"},
                                       details=details, request_attempts=1)
        self.assertFalse(ok)
        for value in ("secret-token", "alpha-chat", "https://example.com/private"):
            self.assertNotIn(value, details["description"])

    def test_photo_rejection_falls_back_but_bad_credentials_do_not(self):
        import tempfile
        with tempfile.TemporaryDirectory() as directory:
            photo = Path(directory) / "photo.jpg"
            photo.write_bytes(b"test-image")
            for status, description, count in ((400, "photo too large", 2), (401, "unauthorized", 1)):
                responses = [Mock(status_code=status, headers={}, json=lambda: {"ok": False, "error_code": status, "description": description}),
                             Mock(status_code=200, json=lambda: {"ok": True})]
                details = {}
                with patch("notification.requests.post", side_effect=responses) as post, \
                     patch("notification.peek_settings", return_value={}):
                    ok = notification.send_telegram("warning", str(photo), _config=self.config("telegram"), details=details, request_attempts=1)
                self.assertEqual(post.call_count, count)
                self.assertEqual(ok, count == 2)

    def test_timeout_and_rate_limit_are_reported_for_video_worker_retries(self):
        with patch("notification.requests.post", side_effect=requests.Timeout()):
            details = {}
            notification._post("https://example.invalid", details=details, request_attempts=1)
        self.assertEqual(details["reason"], "timeout")
        response = Mock(status_code=429, headers={}, json=lambda: {"ok": False, "parameters": {"retry_after": 12}})
        with patch("notification.requests.post", return_value=response), patch("notification.peek_settings", return_value={}):
            notification._post("https://example.invalid", details=details, request_attempts=1)
        self.assertEqual(details["reason"], "rate_limited")
        self.assertEqual(details["retry_after"], 12)

    def test_video_callback_retry_route_and_pending_stream_are_wired(self):
        path = Path(__file__).resolve().parents[1] / "main.py"
        source = path.read_text(encoding="utf-8-sig")
        tree = ast.parse(source)
        init = next(node.value for node in tree.body if isinstance(node, ast.Assign) and
                    any(isinstance(target, ast.Name) and target.id == "video_analyzer" for target in node.targets))
        self.assertEqual(ast.unparse(init.args[2]), "notification.trigger_notifications")
        self.assertIn('/video-analysis/{job_id}/notifications/retry', source)
        stream = next(node for node in tree.body if getattr(node, "name", None) == "video_analysis_updates")
        self.assertIn('notification_pending', ast.unparse(stream))

    def test_terminal_video_keeps_stream_until_notification_results_arrive(self):
        import asyncio
        from unittest.mock import AsyncMock
        from fastapi import FastAPI, WebSocket, WebSocketDisconnect
        source = (Path(__file__).resolve().parents[1] / "main.py").read_text(encoding="utf-8-sig")
        function = next(node for node in ast.parse(source).body if getattr(node, "name", None) == "video_analysis_updates")
        analyzer = Mock()
        analyzer.get.side_effect = [
            {"id": "job", "revision": 1, "frame_id": 1, "status": "done", "notification_pending": 1},
            {"id": "job", "revision": 2, "frame_id": 1, "status": "done", "notification_pending": 0},
        ]
        namespace = {"app": FastAPI(), "asyncio": asyncio, "WebSocket": WebSocket,
                     "WebSocketDisconnect": WebSocketDisconnect, "video_analyzer": analyzer}
        exec(compile(ast.Module(body=[function], type_ignores=[]), "main.py", "exec"), namespace)
        socket = Mock(accept=AsyncMock(), send_json=AsyncMock(), close=AsyncMock(),
                      receive_text=AsyncMock(side_effect=asyncio.TimeoutError))
        asyncio.run(namespace["video_analysis_updates"](socket, "job"))
        self.assertEqual(socket.send_json.await_count, 2)
        socket.close.assert_awaited_once()

    def test_retry_endpoint_requires_auth_and_targets_requested_channel(self):
        from fastapi import FastAPI, Depends, HTTPException
        from fastapi.testclient import TestClient
        from pydantic import BaseModel
        from typing import Literal
        from types import SimpleNamespace
        def authenticated():
            raise HTTPException(status_code=401)
        app = FastAPI()
        analyzer = Mock()
        analyzer.retry_notification.return_value = {"id": "job", "notification_pending": 1}
        source = (Path(__file__).resolve().parents[1] / "main.py").read_text(encoding="utf-8-sig")
        nodes = [node for node in ast.parse(source).body if getattr(node, "name", None) in
                 {"RetryVideoNotification", "retry_video_notification"}]
        namespace = {"app": app, "Depends": Depends, "BaseModel": BaseModel, "Literal": Literal,
                     "HTTPException": HTTPException, "get_current_user": authenticated, "video_analyzer": analyzer}
        exec(compile(ast.Module(body=nodes, type_ignores=[]), "main.py", "exec"), namespace)
        with TestClient(app) as client:
            payload = {"event_type": "fire", "channel": "telegram"}
            self.assertEqual(client.post("/video-analysis/job/notifications/retry", json=payload).status_code, 401)
            app.dependency_overrides[authenticated] = lambda: SimpleNamespace(role="user")
            self.assertEqual(client.post("/video-analysis/job/notifications/retry", json=payload).status_code, 200)
            analyzer.retry_notification.assert_called_once_with("job", "fire", "telegram")
            analyzer.retry_notification.side_effect = KeyError("missing")
            self.assertEqual(client.post("/video-analysis/job/notifications/retry", json=payload).status_code, 404)
            analyzer.retry_notification.side_effect = ValueError("already sent")
            self.assertEqual(client.post("/video-analysis/job/notifications/retry", json=payload).status_code, 409)

    def test_global_test_reports_actual_bot_outcomes_instead_of_false_success(self):
        source = (Path(__file__).resolve().parents[1] / "main.py").read_text(encoding="utf-8-sig")
        function = next(node for node in ast.parse(source).body if getattr(node, "name", None) == "test_notification")
        function.decorator_list = []
        bot = Mock()
        namespace = {"notification": bot}
        exec(compile(ast.Module(body=[function], type_ignores=[]), "main.py", "exec"), namespace)
        for states, expected in ((("failed", "failed"), "error"), (("sent", "failed"), "partial"), (("sent", "sent"), "ok")):
            bot.trigger_notifications.return_value = dict(zip(("zalo", "telegram"), ({"status": state} for state in states)))
            result = namespace["test_notification"]()
            self.assertEqual(result["status"], expected)
            self.assertEqual(set(result["channels"]), {"zalo", "telegram"})
        self.assertTrue(bot.trigger_notifications.call_args.kwargs["bypass_cooldown"])


class VideoOutageTests(unittest.TestCase):
    def run_video(self, get_setting, notify=None):
        import importlib.util
        import tempfile
        import cv2
        import numpy as np
        from contextlib import ExitStack
        backend = Path(__file__).resolve().parents[1]
        storage = Mock()
        with patch.dict("sys.modules", {"storage": storage}):
            spec = importlib.util.spec_from_file_location("video_recovery_test", backend / "video_analyzer.py")
            video = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(video)
        with tempfile.TemporaryDirectory(dir=backend / "tests") as directory, ExitStack() as stack:
            stack.enter_context(patch.object(video, "UPLOAD_DIR", directory))
            cap = Mock()
            cap.isOpened.return_value = True
            cap.get.side_effect = lambda key: 10 if key == cv2.CAP_PROP_FPS else 4
            cap.grab.side_effect = [True] * 4 + [False]
            cap.retrieve.return_value = (True, np.zeros((64, 64, 3), dtype=np.uint8))
            stack.enter_context(patch.object(video.cv2, "VideoCapture", return_value=cap))
            detections = [{"class": name, "confidence": .95, "bbox": [1, 1, 32, 32]} for name in ("fire", "smoke")]
            analyzer = video.VideoAnalyzer(Mock(return_value=(None, detections)), get_setting, notify)
            try:
                job_id = analyzer.submit(str(Path(directory) / "source.mp4"), "sample.mp4", 10)
                wait_for(lambda: analyzer.get(job_id)["status"] in ("done", "error"))
                wait_for(lambda: analyzer.get(job_id)["notification_pending"] == 0)
                return analyzer.get(job_id)
            finally:
                analyzer.shutdown()

    def test_warm_database_outage_finishes_video_and_queues_both_channels(self):
        loader = Mock(return_value={"persistence": "1"})
        cache = SettingsCache(loader)
        cache.snapshot()
        loader.side_effect = disconnect()
        cache._expires = 0
        notify = Mock(side_effect=lambda *args, **kwargs: {channel: {"status": "sent"} for channel in kwargs["channels"]})
        job = self.run_video(lambda key, default=None: cache.snapshot().get(key, default), notify)
        self.assertEqual(job["status"], "done")
        self.assertEqual(job["frames_analyzed"], 4)
        self.assertEqual(notify.call_count, 4)
        for name in ("fire", "smoke"):
            for channel in ("zalo", "telegram"):
                self.assertEqual(job["notifications"][name][channel]["status"], "sent")

    def test_cold_database_failure_has_safe_error_and_is_not_done(self):
        def setting(*args):
            raise disconnect()
        job = self.run_video(setting)
        self.assertEqual(job["status"], "error")
        self.assertIn("Database temporarily unavailable", job["error"])
        self.assertNotIn("SELECT", job["error"])
        self.assertNotIn("sensitive driver error", job["error"])
        self.assertFalse(job["buffering"])


if __name__ == "__main__":
    unittest.main()
