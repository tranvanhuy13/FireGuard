# Giao Kèo API (API Contract) giữa Frontend và Backend

Tài liệu này phản ánh chính xác cấu trúc API thực tế của Backend (nhánh `origin/authentication`), giao thức xác thực HTTP Basic Auth, cơ chế Stream Token, và liệt kê các tính năng còn thiếu cần Backend triển khai tiếp theo.

---

## 1. Các API Đã Được Backend Hỗ Trợ & Frontend Kết Nối Thành Công

> **Quy tắc xác thực chung:**
> - Backend sử dụng **HTTP Basic Authentication** (`Authorization: Basic base64(username:password)`).
> - Mọi endpoint (trừ các endpoint Public) đều bắt buộc gửi kèm header này. Nếu tài khoản chưa kích hoạt (`is_active = 0`), backend trả về `403 Forbidden` (`detail: "Account not verified"`).
> - Trình duyệt không thể tự gửi header Authorization cho thẻ `<img src>` và WebSocket, do đó client phải lấy mã **Stream Token** qua endpoint `/auth/stream-token`.

### 1.1. Xác thực & Tài khoản (Authentication)

#### 1.1.1. Đăng ký tài khoản (Sign Up)
- **Method:** `POST`
- **Path:** `/auth/signup`
- **Auth:** Public
- **Request Body:**
  ```json
  {
    "username": "user123",
    "email": "user@gmail.com",
    "password": "Password123"
  }
  ```
- **Quy tắc kiểm tra phía Backend:**
  - `username` và `password` không được chứa ký tự đặc biệt (chỉ chấp nhận ký tự chữ và số).
  - `email` bắt buộc phải là địa chỉ Gmail hợp lệ (kết thúc bằng `@gmail.com`).
  - Tài khoản mới tạo sẽ có `is_active = 0` và tự động gửi mã OTP xác thực qua email.
- **Response thành công (HTTP 200):**
  ```json
  {
    "id": 1,
    "username": "user123"
  }
  ```
- **Mã lỗi:**
  - `400`: `"Username and password must not contain special characters"`
  - `400`: `"Please use a valid Gmail address (example@gmail.com)."`
  - `400`: `"Username already registered"`
  - `400`: `"Email already registered"`
  - `502`: `"Could not send OTP email"` (Lỗi gửi SMTP)

#### 1.1.2. Xác thực OTP kích hoạt tài khoản
- **Method:** `POST`
- **Path:** `/auth/verify-otp`
- **Auth:** Public
- **Request Body:**
  ```json
  {
    "email": "user@gmail.com",
    "otp": "123456"
  }
  ```
- **Response thành công (HTTP 200):**
  ```json
  {
    "message": "Account verified"
  }
  ```
- **Mã lỗi:**
  - `400`: `"Invalid OTP"`
  - `400`: `"OTP has expired"`
  - `400`: `"Account already verified"`
  - `404`: `"Account not found"`

#### 1.1.3. Gửi lại mã OTP (Resend OTP)
- **Method:** `POST`
- **Path:** `/auth/resend-otp`
- **Auth:** Public
- **Request Body:**
  ```json
  {
    "email": "user@gmail.com"
  }
  ```
- **Response thành công (HTTP 200):**
  ```json
  {
    "message": "OTP sent"
  }
  ```
- **Mã lỗi & Rate Limit:**
  - `429`: `"Please wait {wait}s before requesting a new code."` (Frontend tự động đếm ngược theo số giây trả về).
  - `400`: `"Account already verified"`
  - `404`: `"Account not found"`
  - `502`: `"Could not send OTP email"`

#### 1.1.4. Đăng nhập (Login)
- **Method:** `GET`
- **Path:** `/auth/login`
- **Auth:** `Authorization: Basic base64(identifier:password)` (trong đó `identifier` có thể là `username` hoặc `email`)
- **Lưu ý nghiệp vụ:**
  - Backend đã hỗ trợ đăng nhập bằng **username hoặc email** (nếu chuỗi identifier chứa ký tự `@`, backend sẽ tự động tìm kiếm người dùng theo email).
  - Header HTTP Basic Auth gửi lên dạng `Basic base64(identifier:password)`.
  - Frontend tự động loại bỏ khoảng trắng đầu/cuối của chuỗi nhập trước khi gửi.
  - Khi thông tin đăng nhập không chính xác, backend trả về `401 Unauthorized`, Frontend hiển thị thông báo: `"Sai tên đăng nhập/email hoặc mật khẩu."`.
  - Sau khi đăng nhập thành công, Frontend cập nhật đối tượng người dùng vào `AuthContext`, lưu `user_profile` và `auth_header` vào `sessionStorage` (để hỗ trợ F5 tải lại trang mượt mà), sau đó dùng `router.replace` chuyển hướng theo tham số `redirect` (chỉ chấp nhận đường dẫn nội bộ hợp lệ bắt đầu bằng `/`, không chứa `//` hay `http:`).
- **Response thành công (HTTP 200):**
  ```json
  {
    "id": 1,
    "username": "user123",
    "email": "user@gmail.com",
    "is_active": true
  }
  ```
- **Mã lỗi:**
  - `401`: `"Incorrect username or password"` (Frontend hiển thị: `"Sai tên đăng nhập/email hoặc mật khẩu."`)
  - `403`: `"Account not verified"` (Frontend tự động chuyển hướng sang `/verify-otp`)

#### 1.1.5. Lấy thông tin tài khoản hiện tại (Current User)
- **Method:** `GET`
- **Path:** `/users/me`
- **Auth:** `Authorization: Basic base64(username:password)`
- **Response thành công (HTTP 200):**
  ```json
  {
    "id": 1,
    "username": "user123",
    "email": "user@gmail.com",
    "is_active": true
  }
  ```

#### 1.1.6. Lấy Stream Token cho Camera & WebSocket
- **Method:** `GET`
- **Path:** `/auth/stream-token`
- **Auth:** `Authorization: Basic base64(username:password)`
- **Response thành công (HTTP 200):**
  ```json
  {
    "token": "username:expires_timestamp:hmac_signature",
    "expires_in": 3600
  }
  ```
- **Ghi chú bảo mật:**
  - Token có thời hạn 3600 giây (1 giờ).
  - Frontend tự động xin token mới trước khi hết hạn (hoặc khi gặp lỗi) trong bộ nhớ React context.
  - Tuyệt đối không lưu token vào `localStorage` hay ghi ra `console`.

---

### 1.2. Luồng Video Stream & WebSocket Cảnh Báo

#### 1.2.1. Luồng Camera Video Stream
- **Method:** `GET`
- **Path:** `/video_feed/{camera_id}?token={stream_token}`
- **Response:** `multipart/x-mixed-replace; boundary=frame` (MJPEG stream)
- **Fallback:** `/video_feed?token={stream_token}` (Luồng camera mặc định đầu tiên)
- **Mã lỗi:** `401` nếu token không hợp lệ hoặc đã hết hạn.

#### 1.2.2. WebSocket nhận cảnh báo thời gian thực
- **Protocol:** `WS`
- **Path:** `/ws/alerts?token={stream_token}`
- **Dữ liệu nhận (Alert JSON):**
  ```json
  {
    "id": 1,
    "timestamp": "2026-10-14 10:15:30",
    "type": "Fire",
    "confidence": 0.94,
    "snapshot": "snapshots/cam1_20261014101530.jpg"
  }
  ```
- **Đóng kết nối:** Nếu token sai hoặc hết hạn, WebSocket đóng với mã `1008 (WS_1008_POLICY_VIOLATION)`. Frontend sẽ tự động lấy token mới và tái kết nối.

---

### 1.3. Quản Lý Camera

#### 1.3.1. Danh sách Camera
- **Method:** `GET`
- **Path:** `/cameras`
- **Auth:** Basic Auth
- **Response mẫu:**
  ```json
  {
    "cameras": [
      {
        "id": 1,
        "name": "Cổng chính",
        "source": "0",
        "is_active": true,
        "status": "connected"
      }
    ]
  }
  ```

#### 1.3.2. Thêm Camera mới
- **Method:** `POST`
- **Path:** `/cameras`
- **Auth:** Basic Auth
- **Request Body:**
  ```json
  {
    "source": "rtsp://192.168.1.100:554/live",
    "name": "Kho hàng B"
  }
  ```
- **Response:** `{"status": "ok", "id": 2, "message": "Camera added"}`

#### 1.3.3. Xóa Camera
- **Method:** `DELETE`
- **Path:** `/cameras/{camera_id}`
- **Auth:** Basic Auth
- **Response:** `{"status": "ok", "message": "Camera removed"}`

#### 1.3.4. Bật / Tắt Camera
- **Method:** `POST`
- **Path:** `/cameras/{camera_id}/toggle?active=true` (hoặc `active=false`)
- **Auth:** Basic Auth
- **Response:** `{"status": "ok", "message": "Camera enabled"}`

---

### 1.4. Cảnh Báo, Thống Kê & Lịch Sử

#### 1.4.1. Danh sách cảnh báo gần đây (Alerts)
- **Method:** `GET`
- **Path:** `/alerts`
- **Auth:** Basic Auth
- **Response mẫu:**
  ```json
  {
    "alerts": [
      {
        "id": 1,
        "timestamp": "2026-10-14 10:15:30",
        "type": "Fire",
        "confidence": 0.94,
        "snapshot": "snapshots/event_1.jpg"
      }
    ]
  }
  ```

#### 1.4.2. Thống kê theo ngày (Stats)
- **Method:** `GET`
- **Path:** `/stats`
- **Auth:** Basic Auth
- **Response mẫu:**
  ```json
  {
    "stats": [
      {
        "date": "2026-10-14",
        "count": 5
      }
    ]
  }
  ```

#### 1.4.3. Lịch sử cảnh báo (History)
- **Method:** `GET`
- **Path:** `/history?limit=50&offset=0`
- **Auth:** Basic Auth
- **Response mẫu:**
  ```json
  {
    "events": [
      {
        "id": 1,
        "timestamp": "2026-10-14 10:15:30",
        "type": "Smoke",
        "confidence": 0.88,
        "snapshot_path": "snapshots/event_1.jpg"
      }
    ]
  }
  ```
- *(Ghi chú: Frontend chuẩn hóa `snapshot_path` đồng bộ với `snapshot`).*

---

### 1.5. Cài Đặt Hệ Thống & Kiểm Tra Cảnh Báo

#### 1.5.1. Xem Cài Đặt
- **Method:** `GET`
- **Path:** `/settings`
- **Auth:** Basic Auth
- **Response mẫu:**
  ```json
  {
    "settings": {
      "telegram_bot_token": "********",
      "zalo_oa_secret_key": "********",
      "fire_threshold": "75",
      "smoke_threshold": "70"
    }
  }
  ```
  *(Các khóa bí mật được backend che bằng `********`).*

#### 1.5.2. Lưu Từng Cài Đặt
- **Method:** `POST`
- **Path:** `/settings`
- **Auth:** Basic Auth
- **Request Body:**
  ```json
  {
    "key": "fire_threshold",
    "value": "80"
  }
  ```
- **Response:** `{"status": "ok", "message": "Setting saved"}`

#### 1.5.3. Bắn Cảnh Báo Thử Nghiệm (Test Notification)
- **Method:** `POST`
- **Path:** `/test-notification`
- **Auth:** Basic Auth
- **Response:** `{"status": "ok", "message": "Test notification triggered"}`

---

### 1.6. Phân Tích Video Tải Lên (Video Analysis)

- **Tải lên & phân tích:** `POST /video-analysis` (Multipart Form: `file`, `sample_fps`) -> `{"job_id": "uuid"}`
- **Danh sách tiến trình:** `GET /video-analysis` -> `{"jobs": [...]}`
- **Chi tiết tiến trình:** `GET /video-analysis/{job_id}` -> `{"id", "status", "progress", "result"}`
- **Hủy phân tích:** `POST /video-analysis/{job_id}/cancel` -> `{"status": "ok", "message": "Cancelling"}`

---

## 2. Cần Backend Làm (Các API Còn Thiếu)

Hiện tại các tính năng sau chưa có API trên backend. Khi sử dụng chế độ API thật (`NEXT_PUBLIC_USE_MOCK_AUTH=false` và `NEXT_PUBLIC_USE_MOCK_DATA=false`), frontend hiển thị thông báo **"Tính năng chưa được kích hoạt trên máy chủ"** thay vì giả lập thành công:

### 2.1. Phân Quyền & Vai Trò Người Dùng (RBAC Role Field)
- **Hiện trạng:** Bảng `users` và schema `/users/me` chỉ có `is_active: bool`, hoàn toàn **chưa có trường `role`**. Frontend hiện phải mặc định role là `"viewer"` (không giả lập quyền cao).
- **Cần Backend bổ sung:**
  - Cột `role` (`"admin"` | `"viewer"`) trong database `users` (vai trò `operator` đã được loại bỏ trên frontend và gộp quyền vào `viewer`; nếu backend trả về `operator` hoặc giá trị khác, frontend tự chuẩn hóa về `viewer`).
  - Trả về trường `role` trong response của `GET /auth/login` và `GET /users/me`.

### 2.2. Quản Lý Danh Sách Người Dùng (Users Management)
- **Hiện trạng:** Chưa có API quản lý người dùng.
- **Cần Backend bổ sung:**
  - `GET /users`: Danh sách tất cả người dùng (hỗ trợ phân trang, tìm kiếm).
  - `PUT /users/{id}`: Thay đổi vai trò `role` của người dùng.
  - `PUT /users/{id}/status`: Khóa hoặc kích hoạt lại người dùng (`is_active: 0/1`).

### 2.3. Nhật Ký Thao Tác Hệ Thống (Audit Logs)
- **Hiện trạng:** Chưa có lưu vết thao tác (ai bật tắt camera, ai đổi cấu hình, thời gian, IP).
- **Cần Backend bổ sung:**
  - `GET /audit-logs`: Danh sách nhật ký thao tác hệ thống (thời gian, user, action, target, IP, result).

### 2.4. Quên & Đặt Lại Mật Khẩu (Forgot & Reset Password Flow)
- `POST /auth/forgot-password`: Nhận `{ "email": str }`; trả thông báo chung và gửi mã nếu tài khoản đã xác thực tồn tại.
- `POST /auth/verify-reset-otp`: Nhận `{ "email": str, "otp": str }`; xác thực mã và trả về `{ "message": str, "expires_in": int }`. Có tối đa 5 lần nhập sai.
- `POST /auth/reset-password`: Nhận `{ "email": str, "otp": str, "new_password": str }`; kiểm tra lại mã trước khi đổi mật khẩu. Mật khẩu phải có tối thiểu 8 ký tự chữ và số; mã OTP chỉ dùng được đến khi hết hạn hoặc đổi mật khẩu thành công.

### 2.5. Đăng Xuất (Logout API)
- **Hiện trạng:** HTTP Basic Auth là stateless nên phía backend chưa có endpoint đăng xuất. Frontend hiện tại chỉ xóa thông tin phiên ở client memory và `sessionStorage`.
- **Cần Backend bổ sung (khuyến nghị):**
  - `POST /auth/logout`: Thu hồi ngay lập tức stream token của phiên đăng nhập đó.

### 2.6. Đăng Nhập Mạng Xã Hội (Google / Facebook OAuth 2.0)
- **Hiện trạng:** Chưa có tích hợp OAuth 2.0 với Google và Facebook.
- **Cần Backend bổ sung:**
  - `GET /auth/google`, `GET /auth/google/callback`
  - `GET /auth/facebook`, `GET /auth/facebook/callback`
  - `POST /auth/disconnect`: Ngắt liên kết mạng xã hội của tài khoản.

### 2.7. Xác Nhận / Báo Động Sai Cảnh Báo (Alert Review Status)
- **Hiện trạng:** Bảng `events` trong cơ sở dữ liệu backend chưa có trường `status` và `handler`. Cảnh báo chỉ được lưu cố định.
- **Cần Backend bổ sung:**
  - `PUT /alerts/{id}`: Nhận `{ "status": "confirmed" | "false_alarm", "handler": str }` để cập nhật trạng thái xử lý sự cố.

### 2.8. Cập Nhật Hàng Loạt Cấu Hình AI (Bulk Settings Update)
- **Hiện trạng:** Backend chỉ có `POST /settings` lưu từng cặp `{ "key": str, "value": str }`.
- **Cần Backend bổ sung (khuyến nghị):**
  - `PUT /settings`: Nhận một JSON object chứa nhiều cấu hình cùng lúc để giảm số lượng request HTTP.

### 2.9. Quản Lý Kênh Nhận Tin Cá Nhân (Telegram / Zalo Notification Channels)
- **Hiện trạng:** Backend chỉ lưu token bot trong database và chỉ có `/test-notification`. Chưa có bảng lưu từng tài khoản cá nhân, nhóm hay quy tắc gửi cảnh báo theo camera.
- **Cần Backend bổ sung:**
  - `GET, POST, PUT, DELETE /notifications/accounts`
  - `GET, POST, PUT, DELETE /notifications/groups`
  - `GET, POST, PUT, DELETE /notifications/rules`
