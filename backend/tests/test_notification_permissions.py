"""Offline API permission tests; no MySQL connections or real bot delivery."""
import ast
import math
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError

import auth.dependencies as auth
from detection_rules import read_settings
import notification_routes as routes


class RecipientPermissionsTests(unittest.TestCase):
    def setUp(self):
        self.actor = SimpleNamespace(id=1, username="member", email="member@example.com", role="user",
                                     is_active=True, is_blocked=False, hashed_password="test-hash")
        self.target = {"id": "saved", "channel": "telegram", "friendlyName": "Team", "chatId": "-123456", "active": True}
        self.patches = [
            patch("auth.dependencies.get_user_by_identifier", side_effect=lambda *_: self.actor),
            patch("auth.dependencies.verify_password", return_value=True),
            patch("auth.dependencies.reserve", return_value=("ticket", [])),
            patch("auth.dependencies.finish"),
            patch("notification_routes.targets.list_targets", return_value=[self.target]),
            patch("notification_routes.targets.save_target", return_value=self.target),
            patch("notification_routes.targets.delete_target"),
            patch("notification_routes.log_action"),
            patch("notification_routes.notification.send_zalo", return_value=True),
            patch("notification_routes.notification.send_telegram", return_value=True),
        ]
        self.mocks = [p.start() for p in self.patches]
        for p in self.patches:
            self.addCleanup(p.stop)
        self.app = FastAPI()
        self.app.dependency_overrides[auth.get_db] = lambda: object()
        tree = ast.parse((Path(__file__).resolve().parents[1] / "main.py").read_text(encoding="utf-8-sig"))
        registrations = [node for node in tree.body if isinstance(node, ast.Expr) and
                         isinstance(node.value, ast.Call) and isinstance(node.value.func, ast.Attribute) and
                         node.value.func.attr == "include_router" and node.value.args and
                         isinstance(node.value.args[0], ast.Name) and node.value.args[0].id == "notification_router"]
        self.assertEqual(len(registrations), 1, "main must register the real notification router once")
        namespace = {"app": self.app, "notification_router": routes.router, "BaseModel": BaseModel,
                     "Depends": Depends, "get_current_user": auth.get_current_user, "database": Mock(),
                     "require_admin": auth.require_admin, "notification": Mock(),
                     "read_settings": read_settings, "math": math, "HTTPException": __import__('fastapi').HTTPException}
        settings_nodes = [node for node in tree.body if getattr(node, "name", None) in
                          {"SettingsModel", "get_settings", "save_setting", "test_notification"}]
        exec(compile(ast.Module(body=registrations + settings_nodes, type_ignores=[]), "main.py", "exec"), namespace)
        self.database = namespace["database"]
        self.notification = namespace["notification"]
        self.notification.configuration_status.return_value = ({}, {})
        self.client = TestClient(self.app)
        self.addCleanup(self.client.close)
        self.headers = {"Authorization": "Basic bWVtYmVyOnBhc3N3b3Jk"}

    def body(self, channel="telegram"):
        return {"channel": channel, "friendlyName": "Team", "chatId": "-123456", "active": True}

    def test_user_lists_and_adds_both_kinds_and_channels(self):
        for kind in ("accounts", "groups"):
            with self.subTest(kind=kind):
                self.assertEqual(self.client.get(f"/notifications/{kind}", headers=self.headers).status_code, 200)
            for channel in ("zalo", "telegram"):
                with self.subTest(kind=kind, channel=channel):
                    result = self.client.post(f"/notifications/{kind}", json=self.body(channel), headers=self.headers)
                    self.assertEqual(result.status_code, 201)
        self.mocks[7].assert_called_with(self.actor, "notification.recipient.save", "saved")
        self.mocks[8].assert_not_called()
        self.mocks[9].assert_not_called()

    def test_user_manages_only_owned_recipients(self):
        self.assertEqual(self.client.put("/notifications/accounts/saved", json=self.body(), headers=self.headers).status_code, 200)
        self.mocks[5].assert_called_with("accounts", routes.TargetBody(**self.body()), "saved", owner_user_id=1)
        self.assertEqual(self.client.post("/notifications/accounts/saved/test", headers=self.headers).status_code, 200)
        self.mocks[4].assert_called_with("accounts", owner_user_id=1)
        self.assertEqual(self.client.delete("/notifications/accounts/saved", headers=self.headers).status_code, 200)
        self.mocks[6].assert_called_with("accounts", "saved", owner_user_id=1)

    def test_foreign_recipients_hidden_for_both_roles(self):
        for role in ("user", "admin"):
            self.actor.role = role
            self.mocks[4].return_value = []
            self.mocks[5].side_effect = KeyError("foreign")
            self.mocks[6].side_effect = KeyError("foreign")
            self.assertEqual(self.client.get("/notifications/accounts", headers=self.headers).json(), {"accounts": []})
            self.assertEqual(self.client.put("/notifications/accounts/foreign", json=self.body(), headers=self.headers).status_code, 404)
            self.assertEqual(self.client.delete("/notifications/accounts/foreign", headers=self.headers).status_code, 404)
            self.assertEqual(self.client.post("/notifications/accounts/foreign/test", headers=self.headers).status_code, 404)
        self.mocks[8].assert_not_called()
        self.mocks[9].assert_not_called()

    def test_anonymous_blocked_unverified_and_invalid_role_rejected(self):
        self.assertEqual(self.client.get("/notifications/accounts").status_code, 401)
        for field, value in (("is_blocked", True), ("is_active", False), ("role", "unknown")):
            original = getattr(self.actor, field)
            setattr(self.actor, field, value)
            for method in ("get", "post"):
                with self.subTest(field=field, method=method):
                    args = {"json": self.body()} if method == "post" else {}
                    res = getattr(self.client, method)("/notifications/accounts", headers=self.headers, **args)
                    self.assertEqual(res.status_code, 403)
            setattr(self.actor, field, original)
        self.mocks[5].assert_not_called()

    def test_admin_management_and_explicit_test_still_work(self):
        self.actor.role = "admin"
        self.assertEqual(self.client.put("/notifications/accounts/saved", json=self.body(), headers=self.headers).status_code, 200)
        self.assertEqual(self.client.delete("/notifications/accounts/saved", headers=self.headers).status_code, 200)
        self.assertEqual(self.client.post("/notifications/accounts/saved/test", headers=self.headers).json()["status"], "sent")
        self.mocks[9].assert_called_once()

    def test_invalid_input_duplicate_and_capacity(self):
        invalid = {**self.body(), "chatId": "bad id"}
        self.assertEqual(self.client.post("/notifications/accounts", json=invalid, headers=self.headers).status_code, 422)
        for error in (IntegrityError("insert", {}, Exception("duplicate")), ValueError("A channel supports at most 20 saved recipients")):
            self.mocks[5].side_effect = error
            self.assertEqual(self.client.post("/notifications/accounts", json=self.body(), headers=self.headers).status_code, 409)

    def test_users_cannot_read_or_write_bot_configuration(self):
        self.database.get_setting.return_value = "true"
        result = self.client.get("/settings", headers=self.headers)
        self.assertEqual(result.json(), {"settings": {"alarm_sound_enabled": "true"}})
        self.database.get_all_settings.assert_not_called()
        for key in ("telegram_bot_token", "zalo_bot_token", "telegram_enabled", "fire_threshold"):
            res = self.client.post("/settings", json={"key": key, "value": "changed"}, headers=self.headers)
            self.assertEqual(res.status_code, 403)
        self.database.set_setting.assert_not_called()
        self.assertEqual(self.client.post("/settings", json={"key": "alarm_sound_enabled", "value": "false"}, headers=self.headers).status_code, 200)

    def test_global_test_delivery_also_requires_admin(self):
        self.assertEqual(self.client.post("/test-notification").status_code, 401)
        self.assertEqual(self.client.post("/test-notification", headers=self.headers).status_code, 403)
        self.notification.trigger_notifications.assert_not_called()
        self.actor.role = "admin"
        self.assertEqual(self.client.post("/test-notification", headers=self.headers).status_code, 200)
        self.notification.trigger_notifications.assert_called_once()

    def test_admin_configuration_remains_available_and_masks_tokens(self):
        self.actor.role = "admin"
        self.database.get_all_settings.return_value = {"telegram_bot_token": "test-secret"}
        self.database.get_setting.side_effect = lambda key, default=None: default
        response = self.client.get("/settings", headers=self.headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["settings"]["telegram_bot_token"], "********")
        self.assertEqual(self.client.post("/settings", json={"key": "telegram_bot_token", "value": "new-token"}, headers=self.headers).status_code, 200)
        self.database.set_setting.assert_called_with("telegram_bot_token", "new-token")


if __name__ == "__main__":
    unittest.main()
