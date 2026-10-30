"""Offline admin API regressions; importing main would start cameras/database."""
import ast
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock

from fastapi import Depends, FastAPI, HTTPException
from fastapi.testclient import TestClient

from auth.dependencies import get_current_user, require_admin
from users.schemas import User


class AdminProfileTests(unittest.TestCase):
    def setUp(self):
        tree = ast.parse((Path(__file__).resolve().parents[1] / "main.py").read_text(encoding="utf-8-sig"))
        routes = ast.Module(body=[node for node in tree.body if getattr(node, "name", None) in
                                 {"login", "get_audit_log"}], type_ignores=[])
        self.app = FastAPI()
        self.actor = SimpleNamespace(id=1, username="admin", email="admin@example.com",
                                     role="admin", is_active=True, is_blocked=False)
        self.connection = Mock()
        self.connection.execute.return_value.fetchall.return_value = [
            {"id": 1, "username": "admin", "role": "admin", "action": "user.update",
             "timestamp": "2026-10-30T00:00:00+00:00", "target": "user:admin", "detail": None}
        ]
        namespace = {"app": self.app, "Depends": Depends, "get_current_user": get_current_user,
                     "require_admin": require_admin, "get_auth_connection": lambda: self.connection}
        exec(compile(routes, "main.py", "exec"), namespace)
        self.app.dependency_overrides[get_current_user] = lambda: self.actor
        self.client = TestClient(self.app)

    def tearDown(self):
        self.client.close()

    def test_login_returns_real_admin_role(self):
        response = self.client.get("/auth/login")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["role"], "admin")
        self.assertEqual(response.json()["email"], self.actor.email)
        self.assertNotIn("hashed_password", response.json())

    def test_login_preserves_standard_user_role(self):
        self.actor.role = "user"
        self.assertEqual(self.client.get("/auth/login").json()["role"], "user")

    def test_admin_reads_real_history_with_bounded_pagination(self):
        response = self.client.get("/audit-log?limit=9999&offset=-3")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["logs"][0]["action"], "user.update")
        self.assertEqual(self.connection.execute.call_args.args[1], (500, 0))
        self.connection.close.assert_called_once()

    def test_standard_user_cannot_read_audit_history(self):
        self.actor.role = "user"
        self.assertEqual(self.client.get("/audit-log").status_code, 403)
        self.connection.execute.assert_not_called()

    def test_logged_out_user_cannot_read_audit_history(self):
        def unauthenticated():
            raise HTTPException(status_code=401, detail="Not authenticated")
        self.app.dependency_overrides[get_current_user] = unauthenticated
        self.assertEqual(self.client.get("/audit-log").status_code, 401)
        self.connection.execute.assert_not_called()

    def test_connection_closes_when_audit_query_fails(self):
        self.connection.execute.side_effect = RuntimeError("database unavailable")
        with self.assertRaisesRegex(RuntimeError, "database unavailable"):
            self.client.get("/audit-log")
        self.connection.close.assert_called_once()

    def test_profile_accepts_admin_with_assigned_email(self):
        profile = User.model_validate(self.actor, from_attributes=True)
        self.assertEqual(profile.role, "admin")
        self.assertEqual(profile.email, "admin@example.com")


if __name__ == "__main__":
    unittest.main()
