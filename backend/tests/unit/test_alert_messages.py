"""Offline message contract checks; no database or bot requests."""
import unittest
from unittest.mock import patch
import tempfile
from pathlib import Path

from app.notifications.service import build_alert_message, send_telegram


class AlertMessageTests(unittest.TestCase):
    def test_camera_hazard_and_single_line_name(self):
        for kind, heading in (("fire", "CHÁY"), ("smoke", "KHÓI")):
            body = build_alert_message(kind, .968, camera_name="Kho hàng\n\n  Cửa Đông")
            self.assertIn(heading, body)
            self.assertIn("Camera: Kho hàng Cửa Đông", body)
            self.assertIn("96,8%", body)
            self.assertIn("(UTC+7)", body)
            self.assertNotIn("video tải lên", body)
            self.assertLessEqual(len(body.encode("utf-16-le")) // 2, 1024)

    def test_long_names_stay_under_photo_caption_limit(self):
        body = build_alert_message("smoke", 1, camera_name="ậ" * 500)
        self.assertLessEqual(len(body.encode("utf-16-le")) // 2, 1024)

    def test_sample_is_unambiguously_a_test(self):
        body = build_alert_message("fire", .968, camera_name="Camera thử nghiệm", is_test=True)
        self.assertTrue(body.startswith("[TEST FIREGUARD — KHÔNG PHẢI BÁO CHÁY]"))
        self.assertIn("Dữ liệu minh họa", body)
        self.assertNotIn("kiểm tra khu vực ngay", body)

    def test_approved_test_message_layout(self):
        body = build_alert_message("fire", .968, camera_name="Kho hàng · Cửa phía Đông (minh họa)", is_test=True)
        lines = body.splitlines()
        self.assertEqual(lines[2], "🔥 CẢNH BÁO PHÁT HIỆN CHÁY")
        self.assertEqual(lines[3], "FireGuard phát hiện dấu hiệu cháy. Dữ liệu minh họa để kiểm tra mẫu tin nhắn.")
        self.assertEqual(lines[5], "Camera: Kho hàng · Cửa phía Đông (minh họa)")
        self.assertTrue(body.endswith("Đây là thông báo thử. Không có sự cố thực tế được báo qua tin nhắn này."))

    def test_plain_text_keeps_camera_name_literal(self):
        body = build_alert_message("fire", .968, camera_name='<b>Kho</b> & Cửa Đông')
        self.assertIn('Camera: <b>Kho</b> & Cửa Đông', body)
        self.assertNotIn('<b>FireGuard', body)

    def test_telegram_plain_text_is_used_for_photo_and_text(self):
        config = {"token": "test-token", "chat_id": "12345"}
        message = build_alert_message("smoke", .9, camera_name='A < B')
        with tempfile.TemporaryDirectory() as directory:
            photo = Path(directory) / 'sample.jpg'
            photo.write_bytes(b'sample')
            for attachment in (str(photo), None):
                with patch('app.notifications.service._post', return_value=(True, '')) as post:
                    self.assertTrue(send_telegram(message, attachment, _config=config))
                    data = post.call_args.kwargs['data']
                    self.assertNotIn('parse_mode', data)
                    self.assertEqual(message, data.get('caption', data.get('text')))


if __name__ == "__main__":
    unittest.main()
