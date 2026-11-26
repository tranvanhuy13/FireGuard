"""Offline admin API regressions; importing main would start cameras/database."""

from tests.source import application_source
import ast
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, MagicMock, patch

from fastapi import Depends, FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.auth.dependencies import get_current_user, require_admin
from app.users.schemas import User


class AdminProfileTests(unittest.TestCase):
    def setUp(self):
        tree = ast.parse(application_source())
        routes = ast.Module(body=[node for node in tree.body if getattr(node, "name", None) in
                                 {"login", "get_audit_log"}], type_ignores=[])
        self.app = FastAPI()
        self.actor = SimpleNamespace(id=1, username="admin", email="admin@example.com",
                                     role="admin", is_active=True, is_blocked=False, hashed_password="offline-hash")
        self.connection = MagicMock()
        self.connection.__enter__.return_value = self.connection
        self.connection.__exit__.side_effect = lambda *_: self.connection.close() and False
        self.connection.execute.return_value.fetchone.return_value = [1]
        repository = patch("app.db.repositories.audit.get_connection", return_value=self.connection)
        repository.start()
        self.addCleanup(repository.stop)
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
        self.assertEqual(self.connection.execute.call_args.args[1], [1, 500, 0])
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




class UserProfileApiTests(unittest.TestCase):
    def setUp(self):
        from app.users.routes import router as users_router
        from app.auth.dependencies import get_db
        from app.auth.utils import get_password_hash

        self.app = FastAPI()
        self.app.include_router(users_router, prefix="/users")

        self.user = SimpleNamespace(
            id=10,
            username="vyvy",
            email="vynguyen30082005@gmail.com",
            role="user",
            is_active=True,
            is_blocked=False,
            full_name="Vy Nguyen",
            phone="0912345678",
            avatar_url="https://example.com/avatar.png",
            hashed_password=get_password_hash("OldPassword123"),
        )
        self.mock_db = Mock()
        self.app.dependency_overrides[get_current_user] = lambda: self.user
        self.app.dependency_overrides[get_db] = lambda: self.mock_db
        self.client = TestClient(self.app)

    def tearDown(self):
        self.client.close()

    def test_read_users_me_returns_profile_fields(self):
        res = self.client.get("/users/me")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["username"], "vyvy")
        self.assertEqual(data["fullName"], "Vy Nguyen")
        self.assertEqual(data["phone"], "0912345678")
        self.assertEqual(data["avatarUrl"], "https://example.com/avatar.png")

    def test_update_users_me_updates_db_and_returns_updated(self):
        res = self.client.put("/users/me", json={
            "fullName": "Vy Updated",
            "phone": "0987654321",
            "avatarUrl": "https://example.com/new.png"
        })
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["fullName"], "Vy Updated")
        self.assertEqual(data["phone"], "0987654321")
        self.mock_db.execute.assert_called_once()
        self.mock_db.commit.assert_called_once()

    def test_update_users_me_rejects_invalid_phone(self):
        for bad_phone in ("123", "12345678", "091234567890", "091-234-5678", "٠١٢٣٤٥٦٧٨٩"):
            res = self.client.put("/users/me", json={"phone": bad_phone})
            self.assertEqual(res.status_code, 400, f"Expected 400 for {bad_phone!r}")
            self.assertIn("Số điện thoại không hợp lệ", res.json()["detail"])

    def test_update_users_me_clears_blank_whitespace_phone_and_accepts_boundaries(self):
        res_blank = self.client.put("/users/me", json={"phone": "   "})
        self.assertEqual(res_blank.status_code, 200)
        self.assertEqual(res_blank.json()["phone"], "")

        for ok_phone in ("091234567", "09123456789"):
            res_ok = self.client.put("/users/me", json={"phone": f" {ok_phone} "})
            self.assertEqual(res_ok.status_code, 200)
            self.assertEqual(res_ok.json()["phone"], ok_phone)

    def test_change_password_rejects_wrong_current_password(self):
        res = self.client.post("/users/change-password", json={
            "currentPassword": "WrongPassword999",
            "newPassword": "BrandNewPassword123"
        })
        self.assertEqual(res.status_code, 400)
        self.assertIn("Mật khẩu hiện tại không chính xác", res.json()["detail"])

    def test_change_password_rejects_identical_password(self):
        res = self.client.post("/users/change-password", json={
            "currentPassword": "OldPassword123",
            "newPassword": "OldPassword123"
        })
        self.assertEqual(res.status_code, 400)
        self.assertIn("không được trùng mật khẩu cũ", res.json()["detail"])

    def test_change_password_rejects_short_password(self):
        res = self.client.post("/users/change-password", json={
            "currentPassword": "OldPassword123",
            "newPassword": "short"
        })
        self.assertEqual(res.status_code, 400)
        self.assertIn("at least 8 characters", res.json()["detail"])

    def test_change_password_success_hashes_and_commits(self):
        res = self.client.post("/users/change-password", json={
            "currentPassword": "OldPassword123",
            "newPassword": "NewValidPassword123"
        })
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["message"], "Password changed successfully")
        self.mock_db.execute.assert_called_once()
        self.mock_db.commit.assert_called_once()


class AdminUsersManagementTests(unittest.TestCase):
    def setUp(self):
        import sqlalchemy as sa
        from sqlalchemy.pool import StaticPool
        from app.db.engine import Connection
        from app.db.schema import metadata
        from app.users.routes import router as users_router
        from app.auth.dependencies import get_db

        self.engine = sa.create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        metadata.create_all(self.engine)
        with self.engine.begin() as conn:
            conn.execute(metadata.tables["users"].insert(), [
                {"id": 1, "username": "boss", "email": "boss@gmail.com", "hashed_password": "h",
                 "is_active": 1, "is_blocked": 0, "role": "admin", "full_name": "Boss Admin"},
                {"id": 2, "username": "member", "email": "member@gmail.com", "hashed_password": "h",
                 "is_active": 1, "is_blocked": 0, "role": "user", "full_name": ""},
                {"id": 3, "username": "pending", "email": "pending@gmail.com", "hashed_password": "h",
                 "is_active": 0, "is_blocked": 0, "role": "user", "full_name": "Pending User"},
            ])

        self.actor = SimpleNamespace(id=1, username="boss", email="boss@gmail.com",
                                     role="admin", is_active=True, is_blocked=False)
        self.app = FastAPI()
        self.app.include_router(users_router, prefix="/users")
        self.app.dependency_overrides[get_current_user] = lambda: self.actor

        def override_db():
            conn = Connection(self.engine.connect())
            try:
                yield conn
            finally:
                conn.close()

        self.app.dependency_overrides[get_db] = override_db
        self._patches = [
            patch.object(Connection, "begin_serialized", lambda conn_self, name="auth": conn_self.rollback()),
            patch("app.users.routes.log_action"),
        ]
        for p in self._patches:
            p.start()
        self.client = TestClient(self.app)

    def tearDown(self):
        self.client.close()
        for p in reversed(self._patches):
            p.stop()
        self.engine.dispose()

    def test_list_users_requires_admin_and_formats_status(self):
        self.actor.role = "user"
        self.assertEqual(self.client.get("/users").status_code, 403)
        self.actor.role = "admin"
        res = self.client.get("/users")
        self.assertEqual(res.status_code, 200)
        statuses = {u["username"]: u["status"] for u in res.json()["users"]}
        self.assertEqual(statuses, {"boss": "active", "member": "active", "pending": "pending"})

    def test_update_user_guards_self_last_admin_unverified_and_missing(self):
        self.assertEqual(self.client.put("/users/999", json={"role": "admin"}).status_code, 404)
        self.assertEqual(self.client.put("/users/1", json={"role": "user"}).status_code, 403)
        self.assertEqual(self.client.put("/users/1", json={"status": "blocked"}).status_code, 403)
        self.assertEqual(self.client.put("/users/3", json={"status": "active"}).status_code, 409)

        # Promote member -> second active admin, then blocking/demoting succeeds until only 1 admin remains
        self.assertEqual(self.client.put("/users/2/role", json={"role": "admin"}).json()["role"], "admin")
        self.assertEqual(self.client.put("/users/2", json={"status": "blocked"}).json()["status"], "blocked")
        # Now boss is once again the last active admin (demoting self already returns 403)
        self.assertEqual(self.client.put("/users/2", json={"status": "active"}).json()["status"], "active")
        self.assertEqual(self.client.put("/users/2", json={"role": "user"}).json()["role"], "user")


if __name__ == "__main__":
    unittest.main()
