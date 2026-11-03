import pytest
from tests.integration_mode import require_integration

require_integration()
pytestmark = pytest.mark.integration

import os
import sys
import time
import tempfile
from unittest.mock import patch, Mock, MagicMock
from httpx import AsyncClient, ASGITransport

BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)
os.chdir(BACKEND_DIR)

import notification
from main import app
import database


@pytest.fixture(autouse=True)
def reset_notification_cooldown():
    """Reset global cooldown timestamp trước mỗi bài test để các bài test độc lập nhau"""
    notification.last_notification.clear()
    with patch("notification.list_targets", return_value=[]):
        yield
    notification.last_notification.clear()


# ==============================================================================
# 1. KIỂM THỬ GỬI CẢNH BÁO QUA TELEGRAM (send_telegram)
# ==============================================================================

def test_telegram_send_text_success():
    """Kiểm thử gửi tin nhắn văn bản qua Telegram Bot API thành công"""
    mock_settings = {
        "telegram_bot_token": "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11",
        "telegram_chat_id": "-100123456789"
    }
    with patch("notification.get_setting", side_effect=lambda k: mock_settings.get(k)):
        with patch("notification.requests.post") as mock_post:
            mock_post.return_value = Mock(status_code=200, json=lambda: {"ok": True})
            
            result = notification.send_telegram("🔥 CẢNH BÁO CHÁY TẠI KHU VỰC 1!")
            
            assert result is True
            mock_post.assert_called_once()
            call_url = mock_post.call_args[0][0]
            assert "api.telegram.org/bot123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11/sendMessage" in call_url
            call_data = mock_post.call_args[1]["data"]
            assert call_data["chat_id"] == "-100123456789"
            assert "CẢNH BÁO CHÁY" in call_data["text"]


def test_telegram_send_photo_success():
    """Kiểm thử gửi cảnh báo kèm ảnh chụp bằng chứng (snapshot) qua Telegram sendPhoto"""
    mock_settings = {
        "telegram_bot_token": "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11",
        "telegram_chat_id": "-100123456789"
    }
    with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as tmp_file:
        tmp_file.write(b"fake jpeg content for test")
        tmp_path = tmp_file.name

    try:
        with patch("notification.get_setting", side_effect=lambda k: mock_settings.get(k)):
            with patch("notification.requests.post") as mock_post:
                mock_post.return_value = Mock(status_code=200, json=lambda: {"ok": True})
                
                result = notification.send_telegram("🔥 PHÁT HIỆN LỬA 95%", snapshot_path=tmp_path)
                
                assert result is True
                mock_post.assert_called_once()
                call_url = mock_post.call_args[0][0]
                assert "api.telegram.org/bot123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11/sendPhoto" in call_url
                assert "files" in mock_post.call_args[1]
                assert mock_post.call_args[1]["data"]["chat_id"] == "-100123456789"
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)


def test_telegram_skipped_when_credentials_missing():
    """Kiểm thử tự động bỏ qua khi chưa cấu hình telegram_bot_token hoặc chat_id"""
    mock_settings = {
        "telegram_bot_token": "",
        "telegram_chat_id": ""
    }
    with patch("notification.get_setting", side_effect=lambda k: mock_settings.get(k)):
        with patch("notification.requests.post") as mock_post:
            result = notification.send_telegram("Test message")
            assert result is False
            mock_post.assert_not_called()


def test_telegram_api_error_handling():
    """Kiểm thử xử lý lỗi khi Telegram API trả về mã lỗi 400 hoặc mất kết nối"""
    mock_settings = {
        "telegram_bot_token": "invalid_token",
        "telegram_chat_id": "-100123456789"
    }
    with patch("notification.get_setting", side_effect=lambda k: mock_settings.get(k)):
        with patch("notification.requests.post") as mock_post:
            mock_post.return_value = Mock(status_code=401, text='{"ok": false, "description": "Unauthorized"}')
            result = notification.send_telegram("Test error message")
            assert result is False


# ==============================================================================
# 2. KIỂM THỬ GỬI CẢNH BÁO QUA ZALO (send_zalo)
# ==============================================================================

def test_zalo_send_text_success():
    """Kiểm thử gửi tin nhắn văn bản qua Zalo Bot Platform thành công"""
    mock_settings = {
        "zalo_bot_token": "zalo_secret_token_123",
        "zalo_chat_id": "zalo_chat_group_888",
        "public_base_url": ""
    }
    with patch("notification.get_setting", side_effect=lambda k: mock_settings.get(k)):
        with patch("notification.requests.post") as mock_post:
            mock_post.return_value = Mock(status_code=200, json=lambda: {"ok": True})
            
            result = notification.send_zalo("💨 PHÁT HIỆN KHÓI DÀY ĐẶC TẠI TẦNG 2!")
            
            assert result is True
            mock_post.assert_called_once()
            call_url = mock_post.call_args[0][0]
            assert "bot-api.zaloplatforms.com/botzalo_secret_token_123/sendMessage" in call_url
            payload = mock_post.call_args[1]["json"]
            assert payload["chat_id"] == "zalo_chat_group_888"
            assert "PHÁT HIỆN KHÓI" in payload["text"]


def test_zalo_sends_s3_link_in_text():
    settings = {"zalo_bot_token": "zalo_token", "zalo_chat_id": "zalo_chat"}
    link = "https://s3.example.com/fireguard/snapshots/event.jpg?signature=test"
    with patch("notification.get_setting", side_effect=lambda k: settings.get(k)), \
         patch("storage.snapshot_public_url", return_value=link), \
         patch("notification._zalo_call", return_value=(True, "")) as call:
        assert notification.send_zalo("Fire alert", snapshot_path="event.jpg") is True
    call.assert_called_once()
    assert call.call_args.args[1] == "sendMessage"
    assert link in call.call_args.args[2]["text"]
    assert "photo" not in call.call_args.args[2]


def test_zalo_keeps_text_when_s3_link_unavailable():
    settings = {"zalo_bot_token": "zalo_token", "zalo_chat_id": "zalo_chat"}
    with patch("notification.get_setting", side_effect=lambda k: settings.get(k)), \
         patch("storage.snapshot_public_url", return_value=None), \
         patch("notification._zalo_call", return_value=(True, "")) as call:
        assert notification.send_zalo("Fire alert", snapshot_path="event.jpg") is True
    call.assert_called_once()
    assert call.call_args.args[1] == "sendMessage"
    assert "Fire alert" in call.call_args.args[2]["text"]


def test_zalo_skipped_when_credentials_missing():
    """Kiểm thử Zalo tự động bỏ qua khi chưa cấu hình token hoặc chat_id"""
    with patch("notification.get_setting", return_value=""):
        with patch("notification.requests.post") as mock_post:
            result = notification.send_zalo("Message")
            assert result is False
            mock_post.assert_not_called()


# ==============================================================================
# 3. KIỂM THỬ ĐIỀU PHỐI VÀ COOLDOWN (trigger_notifications)
# ==============================================================================

def test_trigger_notifications_both_channels_enabled():
    """Kiểm thử trigger_notifications gửi đồng thời cả Telegram và Zalo khi 2 kênh được bật"""
    mock_settings = {
        "zalo_enabled": "true",
        "telegram_enabled": "true"
    }
    with patch("notification.get_setting", side_effect=lambda k: mock_settings.get(k, "")):
        with patch("notification.send_zalo") as mock_zalo, \
             patch("notification.send_telegram") as mock_tele:
            
            notification.trigger_notifications("FIRE", 0.92, None)
            
            mock_zalo.assert_called_once()
            mock_tele.assert_called_once()
            assert "FIRE" in mock_zalo.call_args[0][0]
            assert "92.0%" in mock_zalo.call_args[0][0]


def test_trigger_notifications_respects_cooldown():
    """Kiểm thử cơ chế chống spam: Bỏ qua thông báo tiếp theo nếu chưa hết 60s cooldown"""
    mock_settings = {
        "telegram_enabled": "true",
        "zalo_enabled": "false"
    }
    with patch("notification.get_setting", side_effect=lambda k: mock_settings.get(k, "")):
        with patch("notification.send_telegram") as mock_tele:
            # Lần 1: Được gửi
            notification.trigger_notifications("FIRE", 0.85, None)
            assert mock_tele.call_count == 1

            # Lần 2 (ngay sau đó): Bị chặn bởi cooldown 60s
            notification.trigger_notifications("FIRE", 0.95, None)
            assert mock_tele.call_count == 1  # Không tăng lên 2


# ==============================================================================
# 4. KIỂM THỬ API ENDPOINT TEST-NOTIFICATION & SETTINGS
# ==============================================================================

@pytest.mark.asyncio
async def test_api_trigger_test_notification():
    """Kiểm thử API POST /test-notification gọi trigger_notifications thành công"""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        with patch("notification.trigger_notifications", return_value={"zalo": {"status": "sent"}, "telegram": {"status": "sent"}}) as mock_trigger:
            res = await client.post("/test-notification")
            assert res.status_code == 200
            data = res.json()
            assert data["status"] == "ok"
            assert data["message"] == "Test notification sent"
            mock_trigger.assert_called_once_with("TEST EVENT", 0.99, None, bypass_cooldown=True)


@pytest.mark.asyncio
async def test_api_save_and_mask_notification_settings():
    """Kiểm thử lưu cấu hình Bot Token cho Telegram/Zalo và kiểm tra mask bảo mật ********"""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # Lưu token Telegram hợp lệ
        res_save = await client.post("/settings", json={
            "key": "telegram_bot_token",
            "value": "secret_tele_token_9999"
        })
        assert res_save.status_code == 200
        assert res_save.json()["status"] == "ok"

        # Tra cứu lại /settings phải thấy token đã được mask bằng ********
        res_get = await client.get("/settings")
        assert res_get.status_code == 200
        settings = res_get.json().get("settings", {})
        assert settings.get("telegram_bot_token") == "********"

        # Gửi lại giá trị masked ******** -> Bị bỏ qua không ghi đè giá trị thật
        res_skip = await client.post("/settings", json={
            "key": "telegram_bot_token",
            "value": "********"
        })
        assert res_skip.status_code == 200
        assert res_skip.json()["status"] == "skipped"
