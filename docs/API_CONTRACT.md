# Giao Kèo API (API Contract) giữa Frontend và Backend

Tài liệu này liệt kê tất cả các endpoint mà Frontend gọi đến Backend, kèm theo method, request/response mẫu, và đánh dấu những API còn thiếu cần Backend bổ sung.

## 1. Các API đã được Backend hỗ trợ & Frontend kết nối thành công

### 1.1. Lấy danh sách Camera
- **Method:** `GET`
- **Path:** `/cameras`
- **Response mẫu:**
  ```json
  {
    "cameras": [
      {
        "id": 1,
        "name": "Camera 1",
        "source": "0",
        "is_active": true,
        "status": "connected"
      }
    ]
  }
  ```

### 1.2. Thêm Camera mới
- **Method:** `POST`
- **Path:** `/cameras`
- **Role:** `admin`
- **Request mẫu:** `{"source": "rtsp://...", "name": "Cam 2"}`
- **Response mẫu:** `{"status": "ok", "id": 2, "message": "Camera added"}`

### 1.3. Xóa Camera
- **Method:** `DELETE`
- **Path:** `/cameras/{id}`
- **Role:** `admin`
- **Response mẫu:** `{"status": "ok", "message": "Camera removed"}`

### 1.4. Bật/Tắt Camera
- **Method:** `POST`
- **Path:** `/cameras/{id}/toggle?active=true`
- **Role:** `admin`, `operator`
- **Response mẫu:** `{"status": "ok", "message": "Camera enabled"}`

### 1.5. Lấy danh sách Cảnh báo (Dashboard)
- **Method:** `GET`
- **Path:** `/alerts`
- **Response mẫu:**
  ```json
  {
    "alerts": [
      {
        "id": 1,
        "timestamp": "2026-10-10 12:00:00",
        "type": "fire",
        "confidence": 0.95,
        "snapshot": "path/to/image.jpg"
      }
    ]
  }
  ```

### 1.6. Real-time Cảnh báo qua WebSocket
- **Protocol:** `WS`
- **Path:** `/ws/alerts`
- **Mô tả:** Nhận dữ liệu json của 1 alert mới.

### 1.7. Xem luồng Stream Camera
- **Method:** `GET`
- **Path:** `/video_feed/{id}`
- **Mô tả:** Trả về `multipart/x-mixed-replace; boundary=frame` cho thẻ `<img src="...">`. Frontend đã tích hợp trực tiếp thay vì bọc qua fetch.

### 1.8. Phân tích Video tải lên
- **Method:** `POST`
- **Path:** `/video-analysis`
- **Request:** FormData gồm `file` và `sample_fps`.
- **Response:** `{"job_id": "uuid"}`

- **Method:** `GET`
- **Path:** `/video-analysis/{job_id}`
- **Response:**
  ```json
  {
    "id": "uuid",
    "status": "processing",
    "progress": 50,
    "result": {}
  }
  ```

- **Method:** `POST`
- **Path:** `/video-analysis/{job_id}/cancel`
- **Response:** `{"status": "ok"}`

### 1.9. Thống kê KPI & Biểu đồ
- **Method:** `GET`
- **Path:** `/stats?timeframe={week|month}`
- **Response mẫu (Backend):** `{"stats": [{"date": "2026-10-10", "count": 5}]}`
- *(Ghi chú: Frontend tự động ánh xạ và chia tách mock data `fireCount`, `smokeCount` từ `count` tổng do Backend hiện chỉ trả về count tổng).*

### 1.10. Lịch sử Cảnh báo (History)
- **Method:** `GET`
- **Path:** `/history?limit=100&offset=0`
- **Response mẫu:**
  ```json
  {
    "events": [
      {
        "id": 1,
        "timestamp": "2026-10-10 12:00:00",
        "type": "fire",
        "confidence": 0.95,
        "snapshot_path": "path/to/image.jpg"
      }
    ]
  }
  ```
- *(Ghi chú: Frontend đã ánh xạ `snapshot_path` thành `snapshot` tương thích với Component).*

### 1.11. Lấy tất cả Settings
- **Method:** `GET`
- **Path:** `/settings`
- **Response mẫu:** `{"settings": {"key": "value", "key2": "value2"}}`

---

## 2. Cần Backend Làm (Thiếu API hoặc cần chuẩn hóa)

### 2.1. Cập nhật trạng thái Cảnh báo (Xác nhận / Báo động sai)
- **Cần API:** `PUT /alerts/{id}`
- **Request Frontend đang gọi:** `{"status": "confirmed", "handler": "admin"}`
- **Vấn đề:** Backend hiện tại chưa có API để update alert. Frontend đành quản lý local state tạm thời.

### 2.2. Cập nhật nhiều cấu hình AI cùng lúc (Bulk Settings)
- **Cần API:** `PUT /settings`
- **Request Frontend đang gọi:** `{"ai_confidence_threshold": 0.75, "ai_persistence_frames": 3, ...}`
- **Vấn đề:** Backend hiện chỉ có `POST /settings` để update TỪNG KEY một (nhận `{"key": "...", "value": "..."}`). Cần endpoint nhận một object bulk.

### 2.3. Quản lý Người dùng (Users Management)
- **Cần API:** 
  - `GET /users` (Danh sách user)
  - `PUT /users/{id}` (Đổi role user)
  - `PUT /users/{id}/status` (Block/Unblock)
- **Vấn đề:** Chưa tồn tại trên Backend.

### 2.4. Xác thực & Phân quyền (Auth)
- **Cần API:**
  - `POST /auth/login` (Nhận username/email + password, trả JWT token)
  - `POST /auth/register`
  - `GET /auth/me` (Lấy thông tin user đang đăng nhập)
  - `POST /auth/logout`
  - `POST /auth/disconnect` (Ngắt kết nối TK Google/FB)
- **Vấn đề:** Chưa tồn tại trên Backend. Frontend đang dùng Mock.

### 2.5. Lịch sử Thao tác Hệ thống (Audit Log)
- **Cần API:** `GET /audit-logs`
- **Vấn đề:** Chưa tồn tại trên Backend.

### 2.6. Cấu hình Kênh Thông báo (Notifications)
- **Cần API:**
  - `GET, POST, PUT, DELETE /notifications/accounts`
  - `GET, POST, PUT, DELETE /notifications/groups`
  - `GET, POST, PUT, DELETE /notifications/rules`
  - `PUT /notifications/config`
- **Vấn đề:** Chưa tồn tại trên Backend. (Backend chỉ mới có mỗi `/test-notification`).

### 2.7. Quên và Đặt lại Mật khẩu (Forgot & Reset Password)
- **Vấn đề:** Hiện tại `backend/main.py` **chưa có** các endpoint này, backend cần triển khai dịch vụ gửi email thực tế qua SMTP/SendGrid. Frontend hiện đang hỗ trợ Mock Mode (`123456`).
- **Endpoint 1: Yêu cầu mã OTP khôi phục mật khẩu**
  - **Method:** `POST`
  - **Path:** `/auth/forgot-password`
  - **Role:** Public
  - **Request mẫu:**
    ```json
    {
      "email": "user@example.com"
    }
    ```
  - **Response thành công (HTTP 200) - Luôn trả thông báo trung tính bảo mật:**
    ```json
    {
      "message": "Nếu email này đã đăng ký, mã OTP sẽ được gửi trong ít nhất vài phút.",
      "cooldown": 30
    }
    ```
  - **Quy tắc & Mã lỗi:**
    - Mã OTP hết hạn sau **120 giây** (2 phút).
    - Rate limit: `429 Too Many Requests` nếu yêu cầu quá dồn dập (trả kèm `retryAfter` tính bằng giây).
    - `400 Bad Request` nếu email sai định dạng.
    - Không tiết lộ email có tồn tại trong hệ thống hay không để chống brute-force thu thập tài khoản.

- **Endpoint 2: Xác thực mã OTP (Giai đoạn 1)**
  - **Method:** `POST`
  - **Path:** `/auth/verify-reset-otp`
  - **Role:** Public
  - **Request mẫu:**
    ```json
    {
      "email": "user@example.com",
      "otp": "123456"
    }
    ```
  - **Response thành công (HTTP 200):**
    ```json
    {
      "resetToken": "rst_sec_token_abc123xyz",
      "expiresIn": 600
    }
    ```
  - **Quy tắc & Mã lỗi:**
    - Tối đa **5 lần thử** sai OTP. Nếu sai quá 5 lần, trả `429 Too Many Requests` và khóa tạm thời trong 5 phút.
    - `400 Bad Request` với mã `INVALID_OTP` nếu OTP sai (trả kèm `remainingAttempts`).
    - `400 Bad Request` với mã `OTP_EXPIRED` nếu OTP quá hạn 120 giây.

- **Endpoint 3: Đặt lại mật khẩu mới bằng resetToken (Giai đoạn 2)**
  - **Method:** `POST`
  - **Path:** `/auth/reset-password`
  - **Role:** Public
  - **Request mẫu:**
    ```json
    {
      "resetToken": "rst_sec_token_abc123xyz",
      "newPassword": "NewPassword123"
    }
    ```
  - **Response thành công (HTTP 200):**
    ```json
    {
      "message": "Đặt lại mật khẩu thành công"
    }
    ```
  - **Quy tắc & Mã lỗi:**
    - `400 Bad Request` nếu `resetToken` không hợp lệ hoặc đã hết hạn (sau 10 phút / `expiresIn`).
    - `400 Bad Request` nếu mật khẩu mới không đạt chuẩn bảo mật (≥ 8 ký tự, có chữ hoa, chữ thường, số).

