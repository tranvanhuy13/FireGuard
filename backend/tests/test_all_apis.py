import pytest
from httpx import AsyncClient, ASGITransport
import sys
import os
import io

BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
sys.path.insert(0, BACKEND_DIR)
os.chdir(BACKEND_DIR)

from main import app

@pytest.mark.asyncio
async def test_root_and_snapshot_404():
    """1. Kiểm tra API Root và Snapshot 404 khi file không tồn tại"""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        res = await client.get("/")
        assert res.status_code == 200
        assert res.json().get("status") == "ok"

        res_snapshot = await client.get("/snapshots/non_existent_file_9999.jpg")
        assert res_snapshot.status_code == 404
        assert res_snapshot.json().get("detail") == "Snapshot not found"

@pytest.mark.asyncio
async def test_cameras_crud_and_toggle():
    """2. Kiểm tra toàn diện luồng Quản lý Camera (GET, POST, TOGGLE, DELETE, 404)"""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # GET danh sách camera ban đầu
        res = await client.get("/cameras")
        assert res.status_code == 200
        data = res.json()
        assert "cameras" in data
        assert isinstance(data["cameras"], list)

        # POST thêm camera mới
        new_cam_payload = {
            "source": "rtsp://192.168.1.200:554/live",
            "name": "Camera AutoTest"
        }
        res_add = await client.post("/cameras", json=new_cam_payload)
        assert res_add.status_code == 200
        add_data = res_add.json()
        assert add_data.get("status") == "ok"
        cam_id = add_data.get("id")
        assert cam_id is not None

        # PUT cập nhật thông tin camera (tên và trạng thái)
        res_put = await client.put(f"/cameras/{cam_id}", json={
            "name": "Camera AutoTest Updated",
            "is_active": True
        })
        assert res_put.status_code == 200
        assert res_put.json().get("status") == "ok"

        # PUT cập nhật camera không tồn tại -> 404
        res_put_404 = await client.put("/cameras/999999", json={
            "name": "Non-existent",
            "is_active": False
        })
        assert res_put_404.status_code == 404
        assert res_put_404.json().get("detail") == "Camera not found"

        # POST toggle tắt camera
        res_toggle_off = await client.post(f"/cameras/{cam_id}/toggle?active=false")
        assert res_toggle_off.status_code == 200
        assert "disabled" in res_toggle_off.json().get("message", "")

        # POST toggle bật camera
        res_toggle_on = await client.post(f"/cameras/{cam_id}/toggle?active=true")
        assert res_toggle_on.status_code == 200
        assert "enabled" in res_toggle_on.json().get("message", "")

        # POST toggle camera không tồn tại -> 404
        res_toggle_404 = await client.post("/cameras/999999/toggle?active=true")
        assert res_toggle_404.status_code == 404
        assert res_toggle_404.json().get("detail") == "Camera not found"

        # DELETE xóa camera vừa tạo
        res_del = await client.delete(f"/cameras/{cam_id}")
        assert res_del.status_code == 200
        assert res_del.json().get("status") == "ok"

        # DELETE camera không tồn tại -> 404
        res_del_404 = await client.delete("/cameras/999999")
        assert res_del_404.status_code == 404
        assert res_del_404.json().get("detail") == "Camera not found"

@pytest.mark.asyncio
async def test_alerts_stats_and_history():
    """3. Kiểm tra các API Cảnh báo (/alerts), Thống kê (/stats), Lịch sử (/history)"""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # GET /alerts
        res_alerts = await client.get("/alerts")
        assert res_alerts.status_code == 200
        alerts_data = res_alerts.json()
        assert "alerts" in alerts_data
        assert isinstance(alerts_data["alerts"], list)

        # GET /stats
        res_stats = await client.get("/stats")
        assert res_stats.status_code == 200
        stats_data = res_stats.json()
        assert "stats" in stats_data
        assert isinstance(stats_data["stats"], list)

        # GET /history (mặc định)
        res_history = await client.get("/history")
        assert res_history.status_code == 200
        history_data = res_history.json()
        assert "events" in history_data
        assert isinstance(history_data["events"], list)

        # GET /history với phân trang (pagination)
        res_history_paged = await client.get("/history?limit=10&offset=0")
        assert res_history_paged.status_code == 200
        assert "events" in res_history_paged.json()

@pytest.mark.asyncio
async def test_settings_and_notification():
    """4. Kiểm tra Cài đặt hệ thống (/settings) và Gửi cảnh báo thử nghiệm (/test-notification)"""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # GET /settings
        res_get = await client.get("/settings")
        assert res_get.status_code == 200
        settings = res_get.json().get("settings", {})
        assert isinstance(settings, dict)

        # Kiểm tra mask bảo mật các secret tokens
        for secret_key in ["zalo_bot_token", "zalo_oa_access_token", "telegram_bot_token"]:
            if secret_key in settings and settings[secret_key]:
                assert settings[secret_key] == "********"

        # POST /settings lưu cấu hình hợp lệ
        res_save = await client.post("/settings", json={"key": "autotest_setting_key", "value": "true"})
        assert res_save.status_code == 200
        assert res_save.json().get("status") == "ok"

        # POST /settings gửi giá trị masked ******** -> Bị bỏ qua (skipped)
        res_skip = await client.post("/settings", json={"key": "telegram_bot_token", "value": "********"})
        assert res_skip.status_code == 200
        assert res_skip.json().get("status") == "skipped"

        # POST /test-notification
        res_notif = await client.post("/test-notification")
        assert res_notif.status_code == 200
        assert res_notif.json().get("status") == "ok"

@pytest.mark.asyncio
async def test_video_analysis_api():
    """5. Kiểm tra API Phân tích Video tải lên (/video-analysis) và các case validation"""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # GET danh sách jobs phân tích video
        res_list = await client.get("/video-analysis")
        assert res_list.status_code == 200
        assert "jobs" in res_list.json()

        # GET job không tồn tại -> 404
        res_get_404 = await client.get("/video-analysis/invalid-job-id-999")
        assert res_get_404.status_code == 404
        assert "not found" in res_get_404.json().get("detail", "").lower()

        # POST cancel job không tồn tại -> 404
        res_cancel_404 = await client.post("/video-analysis/invalid-job-id-999/cancel")
        assert res_cancel_404.status_code == 404

        # POST playback job không tồn tại -> 404
        res_playback_404 = await client.post("/video-analysis/invalid-job-id-999/playback", json={"action": "pause"})
        assert res_playback_404.status_code == 404
        assert "Analysis job not found" in res_playback_404.json().get("detail", "")

        # POST playback action không hợp lệ -> 422
        res_playback_bad = await client.post("/video-analysis/invalid-job-id-999/playback", json={"action": "invalid_action"})
        assert res_playback_bad.status_code == 422

        # POST upload file sai định dạng (ví dụ .txt) -> 400 Unsupported file type
        files_bad_ext = {"file": ("test.txt", io.BytesIO(b"dummy text"), "text/plain")}
        res_bad_ext = await client.post("/video-analysis", files=files_bad_ext)
        assert res_bad_ext.status_code == 400
        assert "Unsupported file type" in res_bad_ext.json().get("detail", "")

        # POST upload file rỗng (0 bytes) -> 400 The uploaded file is empty
        files_empty = {"file": ("empty.mp4", io.BytesIO(b""), "video/mp4")}
        res_empty = await client.post("/video-analysis", files=files_empty)
        assert res_empty.status_code == 400
        assert "empty" in res_empty.json().get("detail", "").lower()

@pytest.mark.asyncio
async def test_otp_verification_edge_cases():
    """6. Kiểm tra các trường hợp đặc biệt của API Xác thực OTP (/auth/verify-otp & /auth/resend-otp)"""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # Verify OTP cho email không tồn tại -> 404 Account not found
        res_not_found = await client.post("/auth/verify-otp", json={
            "email": "notfounduser99999@gmail.com",
            "otp": "123456"
        })
        assert res_not_found.status_code == 404
        assert "Account not found" in res_not_found.json().get("detail", "")

        # Verify OTP cho tài khoản đã kích hoạt (vyvy) -> 400 Account already verified
        res_already_active = await client.post("/auth/verify-otp", json={
            "email": "vynguyen30082005@gmail.com",
            "otp": "123456"
        })
        assert res_already_active.status_code == 400
        assert "Account already verified" in res_already_active.json().get("detail", "")

        # Resend OTP cho tài khoản không tồn tại -> 404 Account not found
        res_resend_404 = await client.post("/auth/resend-otp", json={
            "email": "notfounduser99999@gmail.com"
        })
        assert res_resend_404.status_code == 404

        # Resend OTP cho tài khoản đã kích hoạt -> 400 Account already verified
        res_resend_active = await client.post("/auth/resend-otp", json={
            "email": "vynguyen30082005@gmail.com"
        })
        assert res_resend_active.status_code == 400
        assert "Account already verified" in res_resend_active.json().get("detail", "")


@pytest.mark.asyncio
async def test_edge_case_camera_source_hardcoding():
    """7. Truong hop bien: Kiem tra them camera voi luong RTSP (Ghi nhan BUG-007)"""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        res = await client.post("/cameras", json={
            "source": "rtsp://admin:pass@192.168.1.100:554/live",
            "name": "Camera RTSP Ngoai Vi",
            "is_active": False
        })
        assert res.status_code == 200
        cam_id = res.json().get("id")
        try:
            cams_res = await client.get("/cameras")
            cam = next((c for c in cams_res.json().get("cameras", []) if c["id"] == cam_id), None)
            assert cam is not None
            # Ghi nhan BUG-007: source bi hardcode thanh '0' thay vi giu nguyen RTSP URL
            assert cam["source"] == "0"
        finally:
            await client.delete(f"/cameras/{cam_id}")

@pytest.mark.asyncio
async def test_edge_case_unauthenticated_endpoints():
    """8. Truong hop bien bao mat: Kiem tra cac endpoint khong yeu cau xac thuc (BUG-008 va BUG-009)"""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # GET /video-analysis khong yeu cau header Authorization
        res_vid = await client.get("/video-analysis")
        assert res_vid.status_code == 200

        # GET /settings cong khai doc duoc cau hinh
        res_set = await client.get("/settings")
        assert res_set.status_code == 200

@pytest.mark.asyncio
async def test_edge_case_settings_strict_bounds():
    """9. Truong hop bien: Kiem tra validation chat che cua cac gia tri cau hinh AI"""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # Nguong lua vuot qua 100% -> 400
        res1 = await client.post("/settings", json={"key": "fire_threshold", "value": "150"})
        assert res1.status_code == 400

        # Nguong lua am (< 0) -> 400
        res2 = await client.post("/settings", json={"key": "fire_threshold", "value": "-5"})
        assert res2.status_code == 400

        # Persistence la so thap phan (3.5) thay vi so nguyen -> 400
        res3 = await client.post("/settings", json={"key": "persistence", "value": "3.5"})
        assert res3.status_code == 400

        # Cooldown qua 3600 giay -> 400
        res4 = await client.post("/settings", json={"key": "cooldown", "value": "5000"})
        assert res4.status_code == 400

        # Gia tri khong phai so (NaN / String) -> 400
        res5 = await client.post("/settings", json={"key": "smoke_threshold", "value": "not_a_number"})
        assert res5.status_code == 400

@pytest.mark.asyncio
async def test_edge_case_signup_special_character_rejection():
    """10. Truong hop bien: Backend tu choi mat khau co ky tu dac biet (Ghi nhan BUG-010)"""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        res = await client.post("/auth/signup", json={
            "username": "validuser123",
            "email": "validuser123@gmail.com",
            "password": "SecurePass@2026"
        })
        assert res.status_code == 400
        assert "special characters" in res.json().get("detail", "").lower()
