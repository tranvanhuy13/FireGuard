"""OTP lifetime regressions without database access or email delivery."""
from datetime import datetime, timedelta, timezone
import unittest
from unittest.mock import patch

from app.auth import utils


class OtpExpiryTests(unittest.TestCase):
    def setUp(self):
        self.now = datetime(2026, 11, 15, tzinfo=timezone.utc)
        self.clock = patch.object(utils, "datetime", wraps=datetime).start()
        self.addCleanup(patch.stopall)
        self.clock.now.return_value = self.now

    def test_new_code_lasts_300_seconds(self):
        expiry = utils.otp_expiry()
        self.assertEqual(datetime.fromisoformat(expiry), self.now + timedelta(seconds=300))
        self.assertEqual(utils.otp_seconds_until_expiry(expiry), 300)
        self.assertEqual(utils.otp_seconds_since_sent(expiry), 0)

    def test_expiry_boundary_and_remaining_lifetime(self):
        expiry = utils.otp_expiry()
        for elapsed, expired, remaining in ((59, False, 241), (120, False, 180), (299, False, 1),
                                             (300, True, 0), (301, True, 0)):
            with self.subTest(elapsed=elapsed):
                self.clock.now.return_value = self.now + timedelta(seconds=elapsed)
                self.assertEqual(utils.otp_expired(expiry), expired)
                self.assertEqual(utils.otp_seconds_until_expiry(expiry), remaining)
                self.assertEqual(utils.otp_seconds_since_sent(expiry), elapsed)

    def test_email_reports_five_minutes_for_both_purposes(self):
        with patch.dict(utils.os.environ, {"GMAIL_ADDRESS": "sender@example.com",
                                            "BREVO_API_KEY": "test-key"}), \
                patch.object(utils.requests, "post") as post:
            for purpose in ("verify", "reset"):
                utils.send_otp_email("recipient@example.com", "123456", purpose)
                self.assertIn("It expires in 5 minutes.", post.call_args.kwargs["json"]["textContent"])
                post.return_value.raise_for_status.assert_called()
