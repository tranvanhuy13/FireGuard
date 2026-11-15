"""Offline credential regressions: no main import, database, or services."""
from contextlib import ExitStack
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from fastapi import HTTPException
from fastapi.security import HTTPBasicCredentials

from app.auth import dependencies as auth
from app.auth.utils import get_password_hash


class AuthTimingTests(unittest.TestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.lookup = self.stack.enter_context(patch.object(auth, "get_user_by_identifier"))
        self.verify = self.stack.enter_context(patch.object(auth, "verify_password", return_value=False))
        self.reserve = self.stack.enter_context(patch.object(auth, "reserve", return_value=("ticket", ["scope"])))
        self.finish = self.stack.enter_context(patch.object(auth, "finish"))
        self.user = SimpleNamespace(hashed_password="stored-hash", is_blocked=False,
                                    is_active=True, role="user")
        self.db = Mock()
        self.request = SimpleNamespace(client=SimpleNamespace(host="127.0.0.1"))

    def current(self, password="wrong", identifier="someone"):
        return auth.get_current_user(self.request, self.db,
                                     HTTPBasicCredentials(username=identifier, password=password))

    def assert_unauthorized(self, call):
        with self.assertRaises(HTTPException) as caught:
            call()
        self.assertEqual(caught.exception.status_code, 401)
        self.assertEqual(caught.exception.detail, "Incorrect username or password")
        self.assertEqual(caught.exception.headers, {"WWW-Authenticate": "Basic"})

    def test_both_paths_verify_missing_and_existing_accounts_once(self):
        for identifier in ("someone", "missing@example.com"):
            for user in (None, self.user):
                for live in (False, True):
                    with self.subTest(identifier=identifier, exists=user is not None, live=live):
                        self.lookup.return_value = user
                        self.verify.reset_mock()
                        if live:
                            self.assert_unauthorized(lambda: self.current(identifier=identifier))
                            self.reserve.assert_called_with(self.db, identifier, user, "127.0.0.1")
                            self.finish.assert_called_with(self.db, "ticket", ["scope"], False)
                        else:
                            self.assertIs(auth.authenticate_user(self.db, identifier, "wrong"), False)
                        self.lookup.assert_called_with(self.db, identifier)
                        self.assertEqual(self.verify.call_count, 1)
                        self.verify.assert_called_once_with(
                            "wrong", user.hashed_password if user else auth._DUMMY_PASSWORD_HASH)

    def test_dummy_match_never_authenticates(self):
        self.lookup.return_value = None
        self.verify.return_value = True
        self.assertIs(auth.authenticate_user(self.db, "missing", "dummy"), False)
        self.assert_unauthorized(lambda: self.current("dummy"))
        self.finish.assert_called_with(self.db, "ticket", ["scope"], False)

    def test_valid_user_and_admin(self):
        self.lookup.return_value = self.user
        self.verify.return_value = True
        for role in ("user", "admin"):
            self.user.role = role
            self.assertIs(auth.authenticate_user(self.db, "someone", "correct"), self.user)
            self.assertIs(self.current("correct"), self.user)
            self.finish.assert_called_with(self.db, "ticket", ["scope"], True)

    def test_limiter_reserves_before_verification(self):
        self.lookup.return_value = None
        self.verify.side_effect = lambda *args: self.reserve.assert_called_once()
        self.assert_unauthorized(self.current)

    def test_rate_limited_request_skips_bcrypt(self):
        self.reserve.side_effect = HTTPException(429, "LOGIN_RATE_LIMITED", headers={"Retry-After": "60"})
        with self.assertRaises(HTTPException) as caught:
            self.current()
        self.assertEqual(caught.exception.status_code, 429)
        self.assertEqual(caught.exception.headers, {"Retry-After": "60"})
        self.verify.assert_not_called()
        self.finish.assert_not_called()

    def test_finish_rate_limit_preserves_response(self):
        self.finish.side_effect = HTTPException(429, "LOGIN_RATE_LIMITED", headers={"Retry-After": "60"})
        with self.assertRaises(HTTPException) as caught:
            self.current()
        self.assertEqual(caught.exception.status_code, 429)
        self.assertEqual(caught.exception.headers, {"Retry-After": "60"})

    def test_value_error_is_rejected_for_both_account_paths(self):
        self.verify.side_effect = ValueError("invalid password")
        for user in (None, self.user):
            self.lookup.return_value = user
            self.assert_unauthorized(self.current)
            self.finish.assert_called_with(self.db, "ticket", ["scope"], False)
            with self.assertRaises(ValueError):
                auth.authenticate_user(self.db, "someone", "wrong")

    def test_unexpected_exception_releases_reservation(self):
        self.verify.side_effect = RuntimeError("verifier unavailable")
        with self.assertRaises(RuntimeError):
            self.current()
        self.finish.assert_called_once_with(self.db, "ticket", ["scope"], True)

    def test_account_checks_still_apply_after_valid_password(self):
        self.lookup.return_value = self.user
        self.verify.return_value = True
        for field, value, detail in (("is_blocked", True, "Account blocked"),
                                     ("is_active", False, "Account not verified"),
                                     ("role", "invalid", "Invalid account role")):
            old = getattr(self.user, field)
            setattr(self.user, field, value)
            with self.assertRaises(HTTPException) as caught:
                self.current("correct")
            self.assertEqual((caught.exception.status_code, caught.exception.detail), (403, detail))
            setattr(self.user, field, old)


class RealBcryptTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.user = SimpleNamespace(hashed_password=get_password_hash("correct-password"))

    def test_real_bcrypt_on_both_paths(self):
        for user in (None, self.user):
            with patch.object(auth, "get_user_by_identifier", return_value=user), \
                 patch.object(auth, "reserve", return_value=("ticket", [])), \
                 patch.object(auth, "finish"):
                self.assertIs(auth.authenticate_user(None, "someone", "wrong-password"), False)
                with self.assertRaises(HTTPException) as caught:
                    auth.get_current_user(SimpleNamespace(client=None), None,
                                          HTTPBasicCredentials(username="someone", password="wrong-password"))
                self.assertEqual(caught.exception.status_code, 401)

    def test_real_dummy_password_cannot_authenticate(self):
        self.assertFalse(auth._verify_user_password(None, "bug-015-dummy-password"))

    def test_real_password_boundaries_are_consistent(self):
        for password in ("é" * 40, "contains\x00nul"):
            results = []
            for user in (None, self.user):
                try:
                    results.append(auth._verify_user_password(user, password))
                except ValueError:
                    results.append("ValueError")
            self.assertEqual(results[0], results[1])


if __name__ == "__main__":
    unittest.main()
