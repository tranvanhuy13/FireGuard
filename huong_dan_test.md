# 📖 HƯỚNG DẪN VẬN HÀNH BỘ KIỂM THỬ HỆ THỐNG FIREGUARD
> **Tài liệu chuẩn bị phục vụ Báo cáo & Trình bày Đồ án trước Hội đồng Đánh giá**  
> *Hệ thống Giám sát & Cảnh báo Cháy Thông minh FireGuard*  
> *Ngày cập nhật: Tháng 11/2026*

---

## 🎯 MỤC LỤC
1. [Tổng quan Kiến trúc & Thành phần Kiểm thử](#1-tổng-quan-kiến-trúc--thành-phần-kiểm-thử)
2. [Chuẩn bị Môi trường trước khi Demo](#2-chuẩn-bị-môi-trường-trước-khi-demo)
3. [Kịch bản 1: Trình diễn Giao diện Trực quan (Demo trước Hội đồng)](#3-kịch-bản-1-trình-diễn-giao-diện-trực-quan-demo-trước-hội-đồng)
   - [3.1. Chế độ Playwright UI Mode (Trực quan nhất - Khuyên dùng)](#31-chế-độ-playwright-ui-mode-trực-quan-nhất---khuyên-dùng)
   - [3.2. Chế độ Mở Trình duyệt Thực tế (Headed Mode)](#32-chế-độ-mở-trình-duyệt-thực-tế-headed-mode)
   - [3.3. Chế độ Debug từng bước (Step-by-step Debugger)](#33-chế-độ-debug-từng-bước-step-by-step-debugger)
4. [Kịch bản 2: Hướng dẫn Chạy Từng File Test Cụ thể](#4-kịch-bản-2-hướng-dẫn-chạy-từng-file-test-cụ-thể)
   - [4.1. Bộ Kiểm thử Frontend (Playwright & E2E)](#41-bộ-kiểm-thử-frontend-playwright--e2e)
   - [4.2. Bộ Kiểm thử Backend (FastAPI, AI & MySQL)](#42-bộ-kiểm-thử-backend-fastapi-ai--mysql)
5. [Kịch bản 3: Hướng dẫn Chạy Toàn bộ Bộ Test (All-in-One)](#5-kịch-bản-3-hướng-dẫn-chạy-toàn-bộ-bộ-test-all-in-one)
6. [Kịch bản 4: Kiểm tra Network Traffic, Headers & Báo cáo HTML](#6-kịch-bản-4-kiểm-tra-network-traffic-headers--báo-cáo-html)
   - [6.1. Xuất và Mở Báo cáo Trực quan HTML](#61-xuất-và-mở-báo-cáo-trực-quan-html)
   - [6.2. Kiểm tra Network Headers, Request Payload & Trace](#62-kiểm-tra-network-headers-request-payload--trace)
7. [Kịch bản 5: Hướng dẫn Thuyết minh File Báo cáo Test Excel (`test.xlsx`)](#7-kịch-bản-5-hướng-dẫn-thuyết-minh-file-báo-cáo-test-excel-testxlsx)
8. [Bảng Tra cứu Nhanh các Câu lệnh (Cheat Sheet)](#8-bảng-tra-cứu-nhanh-các-câu-lệnh-cheat-sheet)

---

## 1. TỔNG QUAN KIẾN TRÚC & THÀNH PHẦN KIỂM THỬ

Hệ thống FireGuard được xây dựng với hệ thống kiểm thử đa tầng nghiêm ngặt nhằm đảm bảo độ tin cậy tuyệt đối cho một hệ thống cảnh báo an toàn tính mạng:

```mermaid
flowchart TD
    subgraph UI_E2E["1. Frontend & E2E Testing (Playwright & Unit)"]
        A1["auth.spec.ts (Đăng nhập, Đăng ký, OTP, Quên MK)"]
        A2["camera.spec.ts (CRUD Camera, Toggle an toàn)"]
        A3["notifications.spec.ts (Cảnh báo Telegram/Zalo)"]
        A4["rbac.spec.ts (Phân quyền Admin vs User)"]
        A5["video_analysis.spec.ts (Phân tích Video AI)"]
        A6["profile.spec.ts (Hồ sơ, SĐT, Avatar, Đổi MK)"]
        A7["history.spec.ts (Lịch sử Sự cố, Lọc, Xuất CSV)"]
        A8["ai_settings.spec.ts (Cấu hình Ngưỡng AI, Cooldown)"]
        A9["users.spec.ts (Quản trị Người dùng, Phân quyền)"]
        A10["audit_log.spec.ts (Nhật ký Kiểm toán, Sắp xếp)"]
        A11["legal_consent.spec.ts (Modal Điều khoản & Bảo mật PR #67)"]
        A12["live_monitoring.spec.ts (Bố cục Giám sát, Empty state)"]
        A13["dashboard_connection.unit.cjs (Phục hồi kết nối mạng)"]
        A14["camera_view.unit.cjs (Lưới 4-25 ô, Tự phục hồi HLS)"]
        A15["api_client.unit.cjs (Timeout, Retry, AbortSignal)"]
    end

    subgraph BACKEND_TEST["2. Backend Integration & Unit Testing (pytest & unittest)"]
        B1["test_camera_lifecycle.py (OpenCV, SharedWebcam, Toggle)"]
        B2["test_realtime_detection.py (YOLO26n Checkpoint, Bounding Box)"]
        B3["test_admin_profile.py (RBAC, Audit Log, User API)"]
        B4["test_notifications.py (Bot Telegram/Zalo, S3 Presigned URL)"]
        B5["test_history_and_alerts.py (Lịch sử Sự cố, Alerts, Stats)"]
        B6["test_settings_and_storage.py (Cấu hình AI, Masked Secrets, Dọn dẹp)"]
        B7["test_auth_timing.py (Chống Timing Attack Bcrypt BUG-015)"]
        B8["test_owned_notifications.py (Phân quyền người nhận theo User)"]
        B9["test_s3_url_store.py (Lưu trữ ảnh sự cố Supabase S3)"]
        B10["test_private_evidence.py (Presigned URL & 7-day Retention)"]
        B11["test_package_layout.py (Kiến trúc gói module backend/app/)"]
        B12["test_mysql_persistence.py (Cơ sở dữ liệu MySQL Aiven)"]
    end

    subgraph REPORT["3. Báo cáo & Tài liệu Thực nghiệm"]
        C1["test.xlsx (334 Test Cases chuẩn hóa - Mỗi function là 1 Sheet riêng)"]
        C2["Defect Log (18 Bugs: 18 Resolved - Khắc phục & Kiểm thử Hồi quy 100%)"]
    end

    UI_E2E --> REPORT
    BACKEND_TEST --> REPORT
```

---

## 2. CHUẨN BỊ MÔI TRƯỜNG TRƯỚC KHI DEMO

Để buổi thuyết minh diễn ra suôn sẻ, hãy mở **2 cửa sổ PowerShell (Terminal)** tại thư mục gốc của dự án `d:\FireGuard`:

### Terminal 1: Kiểm tra Cài đặt & Sẵn sàng Frontend
```powershell
cd d:\FireGuard\frontend

# 1. Kiểm tra biên dịch TypeScript (Bắt buộc 0 lỗi)
npx tsc --noEmit

# 2. Khởi động Frontend Server (nếu muốn test trực tiếp trên Web)
npm run dev
# -> Frontend sẽ chạy tại: http://localhost:3000
```

### Terminal 2: Kiểm tra Môi trường Ảo Backend
```powershell
cd d:\FireGuard\backend

# 1. Kích hoạt môi trường Python ảo
.\venv\Scripts\Activate.ps1

# 2. Kiểm tra biên dịch cú pháp Python
python -m py_compile main.py app/cameras/manager.py app/detection/detector.py app/detection/rules.py app/detection/scheduler.py app/videos/analyzer.py
```

---

## 3. KỊCH BẢN 1: TRÌNH DIỄN GIAO DIỆN TRỰC QUAN (DEMO TRƯỚC HỘI ĐỒNG)

> [!TIP]
> **Khuyên dùng khi báo cáo trước Hội đồng**: Hãy sử dụng **Playwright UI Mode** hoặc **Headed Mode**. Hội đồng sẽ tận mắt chứng kiến trình duyệt tự động mở lên, điền biểu mẫu, kiểm tra logic validation và hiển thị kết quả trực quan theo thời gian thực.

### 3.1. Chế độ Playwright UI Mode (Trực quan nhất - Khuyên dùng)
Lệnh này mở giao diện đồ họa chuyên nghiệp của Playwright, cho phép Hội đồng xem từng bước thực thi, tua lại thời gian (time-travel), xem DOM snapshot và network call:

```powershell
cd d:\FireGuard\frontend
npx playwright test --ui
```
* **Cách thuyết minh với Hội đồng**:
  1. Chỉ vào danh sách test bên cột trái (Auth, Camera, Notifications, RBAC,...).
  2. Bấm nút **Play** tam giác để chạy toàn bộ hoặc từng test case.
  3. Chỉ cho Hội đồng thấy tab **Network** (xem request header, Basic Auth, response 200/400).
  4. Kéo thanh trượt **Timeline** để tua lại từng mili-giây quá trình test thao tác trên màn hình.

---

### 3.2. Chế độ Mở Trình duyệt Thực tế (Headed Mode)
Nếu muốn mở cửa sổ trình duyệt Chromium tự động bật lên và thực hiện các thao tác click, gõ phím trực tiếp:

#### Test giao diện Đăng ký, Đăng nhập, OTP, Quên mật khẩu:
```powershell
cd d:\FireGuard\frontend
npx playwright test tests/auth.spec.ts --headed
```

#### Test giao diện Quản lý Camera, Bật/Tắt công tắc an toàn:
```powershell
cd d:\FireGuard\frontend
npx playwright test tests/camera.spec.ts --headed
```

#### Test giao diện Cấu hình Kênh Thông báo Telegram & Zalo:
```powershell
cd d:\FireGuard\frontend
npx playwright test tests/notifications.spec.ts --headed
```

#### Test Phân quyền Người dùng (Admin vs User):
```powershell
cd d:\FireGuard\frontend
npx playwright test tests/rbac.spec.ts --headed
```

#### Test Phân tích Video AI & Điều khiển Play/Pause:
```powershell
cd d:\FireGuard\frontend
npx playwright test tests/video_analysis.spec.ts --headed
```

> [!NOTE]
> Muốn trình duyệt chạy chậm lại một chút để Hội đồng kịp quan sát các thao tác gõ phím và click chuột, thêm cờ `--slowmo`:
> ```powershell
> npx playwright test tests/auth.spec.ts --headed --slowmo=500
> ```
> *(500ms giữa mỗi hành động click/gõ)*

---

### 3.3. Chế độ Debug từng bước (Step-by-step Debugger)
Cho phép dừng chương trình tại từng câu lệnh kiểm thử, mở cửa sổ Playwright Inspector để giải thích chi tiết logic cho Thầy/Cô:

```powershell
cd d:\FireGuard\frontend
npx playwright test tests/auth.spec.ts --debug
```
* Nhấn nút **Step Over (F10)** trên thanh công cụ để thực hiện từng dòng code test.

---

## 4. KỊCH BẢN 2: HƯỚNG DẪN CHẠY TỪNG FILE TEST CỤ THỂ

### 4.1. Bộ Kiểm thử Frontend (Playwright & E2E)
Chạy ở chế độ Headless (chạy ngầm tốc độ cao, hiển thị kết quả dạng text trong terminal):

| STT | Phân hệ kiểm thử | Tên File Test | Lệnh chạy tương ứng |
| :---: | :--- | :--- | :--- |
| 1 | Xác thực & Mật khẩu | [`auth.spec.ts`](file:///d:/FireGuard/frontend/tests/auth.spec.ts) | `npx playwright test tests/auth.spec.ts` |
| 2 | Hộp thoại Pháp lý (Terms/Privacy) | [`legal_consent.spec.ts`](file:///d:/FireGuard/frontend/tests/legal_consent.spec.ts) | `npx playwright test tests/legal_consent.spec.ts` |
| 3 | Quản lý Camera | [`camera.spec.ts`](file:///d:/FireGuard/frontend/tests/camera.spec.ts) | `npx playwright test tests/camera.spec.ts` |
| 4 | Giám sát & Bố cục Camera | [`live_monitoring.spec.ts`](file:///d:/FireGuard/frontend/tests/live_monitoring.spec.ts) | `npx playwright test tests/live_monitoring.spec.ts` |
| 5 | Cảnh báo Telegram/Zalo | [`notifications.spec.ts`](file:///d:/FireGuard/frontend/tests/notifications.spec.ts) | `npx playwright test tests/notifications.spec.ts` |
| 6 | Phân quyền Chat ID | [`notification_permissions.spec.ts`](file:///d:/FireGuard/frontend/tests/notification_permissions.spec.ts) | `npx playwright test tests/notification_permissions.spec.ts` |
| 7 | Phân quyền RBAC | [`rbac.spec.ts`](file:///d:/FireGuard/frontend/tests/rbac.spec.ts) | `npx playwright test tests/rbac.spec.ts` |
| 8 | Hồ sơ Cá nhân & Avatar | [`profile.spec.ts`](file:///d:/FireGuard/frontend/tests/profile.spec.ts) | `npx playwright test tests/profile.spec.ts` |
| 9 | Lịch sử Sự cố & Báo cáo | [`history.spec.ts`](file:///d:/FireGuard/frontend/tests/history.spec.ts) | `npx playwright test tests/history.spec.ts` |
| 10 | Cấu hình Tham số AI | [`ai_settings.spec.ts`](file:///d:/FireGuard/frontend/tests/ai_settings.spec.ts) | `npx playwright test tests/ai_settings.spec.ts` |
| 11 | Quản trị Người dùng | [`users.spec.ts`](file:///d:/FireGuard/frontend/tests/users.spec.ts) | `npx playwright test tests/users.spec.ts` |
| 12 | Nhật ký Kiểm toán | [`audit_log.spec.ts`](file:///d:/FireGuard/frontend/tests/audit_log.spec.ts) | `npx playwright test tests/audit_log.spec.ts` |
| 13 | Độ mạnh Mật khẩu | [`password_requirements.spec.ts`](file:///d:/FireGuard/frontend/tests/password_requirements.spec.ts) | `npx playwright test tests/password_requirements.spec.ts` |
| 14 | Phân tích Video AI | [`video_analysis.spec.ts`](file:///d:/FireGuard/frontend/tests/video_analysis.spec.ts) | `npx playwright test tests/video_analysis.spec.ts` |
| 15 | Điều hướng Login | [`login_redirect.spec.ts`](file:///d:/FireGuard/frontend/tests/login_redirect.spec.ts) | `npx playwright test tests/login_redirect.spec.ts` |
| 16 | Phục hồi Kết nối Mạng | [`dashboard_connection.unit.cjs`](file:///d:/FireGuard/frontend/tests/dashboard_connection.unit.cjs) | `node --test tests/dashboard_connection.unit.cjs` |
| 17 | Lưới Camera Đa ô & HLS | [`camera_view.unit.cjs`](file:///d:/FireGuard/frontend/tests/camera_view.unit.cjs) | `node --test tests/camera_view.unit.cjs` |
| 18 | Client API & Hủy yêu cầu | [`api_client.unit.cjs`](file:///d:/FireGuard/frontend/tests/api_client.unit.cjs) | `node --test tests/api_client.unit.cjs` |

> **Ví dụ chạy kiểm tra trọn bộ Frontend Unit Tests (24 unit tests pass 100%):**
> ```powershell
> cd d:\FireGuard\frontend
> node --test tests/api_client.unit.cjs tests/camera_view.unit.cjs tests/dashboard_connection.unit.cjs
> ```

---

### 4.2. Bộ Kiểm thử Backend (FastAPI, AI & MySQL)
Các bài test Backend được thiết kế theo chuẩn độc lập (offline unittest harness), không phụ thuộc vào thiết bị ngoại vi và chạy cực nhanh (dưới 3 giây):

Mở terminal tại thư mục `d:\FireGuard\backend`:

#### 1. Kiểm thử Vòng đời Camera & SharedWebcam Singleton:
```powershell
cd d:\FireGuard\backend
.\venv\Scripts\python.exe -m unittest discover -s tests -p test_camera_lifecycle.py
```
* *Ý nghĩa*: Kiểm chứng cơ chế chia sẻ webcam vật lý index 0 (`BUG-004`), cơ chế chống xung đột luồng khi bật/tắt liên tục (`BUG-005`).

#### 2. Kiểm thử Mô hình AI Nhận diện Cháy/Khói Thời gian thực:
```powershell
cd d:\FireGuard\backend
.\venv\Scripts\python.exe -m unittest discover -s tests -p test_realtime_detection.py
```
* *Ý nghĩa*: Kiểm chứng tọa độ Bounding box, phân lớp Fire/Smoke, cơ chế suy luận nền độc lập và lọc ngưỡng phát hiện.

#### 3. Kiểm thử Phân quyền Quản trị & Nhật ký Audit Log:
```powershell
cd d:\FireGuard\backend
.\venv\Scripts\python.exe -m unittest discover -s tests -p test_admin_profile.py
```
* *Ý nghĩa*: Kiểm chứng endpoint `GET /audit-log` bảo mật cho Admin, chặn người dùng thường (403), kiểm tra trường `role` trả về từ MySQL (`BUG-003`).

#### 4. Kiểm thử Kênh Thông báo Bot Telegram, Zalo & S3 MinIO:
```powershell
cd d:\FireGuard\backend
.\venv\Scripts\python.exe -m unittest discover -s tests -p test_notifications.py
```
* *Ý nghĩa*: Kiểm chứng gửi text, gửi ảnh snapshot qua Telegram `sendPhoto`, tạo đường link Presigned S3 GET URL gửi qua Zalo, cơ chế Cooldown 60 giây chống spam.

#### 5. Kiểm thử Phân quyền Thêm Người nhận Chia sẻ (Shared Recipients):
```powershell
cd d:\FireGuard\backend
.\venv\Scripts\python.exe -m unittest discover -s tests -p test_notification_permissions.py
```
* *Ý nghĩa*: Kiểm chứng quyền cho phép cả `user` và `admin` thêm Chat ID (PR #32), chỉ admin mới được sửa/xóa/test.

#### 6. Kiểm thử Toàn vẹn Dữ liệu & Đa luồng Cơ sở dữ liệu MySQL Aiven:
```powershell
cd d:\FireGuard\backend
.\venv\Scripts\python.exe -m unittest discover -s tests -p "test_mysql_*.py"
```
* *Ý nghĩa*: Kiểm chứng tính an toàn giao dịch (Transaction Rollback), Connection Pooling, chống SQL Injection (`test_mysql_persistence.py` và `test_mysql_concurrency.py`).

#### 7. Kiểm thử Lịch sử Sự cố, Alerts & Thống kê Vận hành:
```powershell
cd d:\FireGuard\backend
.\venv\Scripts\python.exe -m unittest discover -s tests -p test_history_and_alerts.py
```
* *Ý nghĩa*: Kiểm chứng các endpoint `GET /history`, `GET /alerts`, `GET /stats`, phân trang giới hạn và xử lý an toàn khi truy vấn ảnh snapshot không tồn tại (404).

#### 8. Kiểm thử Cấu hình AI, Masked Secrets & Dọn dẹp Snapshot Định kỳ:
```powershell
cd d:\FireGuard\backend
.\venv\Scripts\python.exe -m unittest discover -s tests -p test_settings_and_storage.py
```
* *Ý nghĩa*: Kiểm chứng cơ chế che mờ bí mật token (`********`), validate ngưỡng nhạy 0-100%, và tác vụ dọn dẹp ảnh snapshot camera cũ định kỳ theo `SNAPSHOT_RETENTION_DAYS`.

---

## 5. KỊCH BẢN 3: HƯỚNG DẪN CHẠY TOÀN BỘ BỘ TEST (ALL-IN-ONE)

Để trình diễn cho Hội đồng thấy toàn bộ hệ thống vượt qua kiểm thử tự động một cách toàn diện:

### Chạy toàn bộ Test Suite Frontend:
```powershell
cd d:\FireGuard\frontend
npx playwright test
```
* Hệ thống sẽ chạy đồng thời tất cả các file test Playwright trên trình duyệt Chromium và in bảng tổng kết trạng thái (Passed / Failed / Duration).

### Chạy toàn bộ Test Suite Backend:
```powershell
cd d:\FireGuard\backend
.\venv\Scripts\python.exe -m unittest discover -s tests -p "test_*.py"
```
* Hệ thống sẽ tự động phát hiện và chạy tất cả các bài kiểm thử đơn vị, kiểm thử nghiệp vụ của Backend và báo cáo tổng số test đã Pass.

---

## 6. KỊCH BẢN 4: KIỂM TRA NETWORK TRAFFIC, HEADERS & BÁO CÁO HTML

### 6.1. Xuất và Mở Báo cáo Trực quan HTML
Sau khi chạy kiểm thử Playwright, có thể mở báo cáo đồ họa chuyên nghiệp dạng web để trình chiếu cho Hội đồng:

```powershell
cd d:\FireGuard\frontend
npx playwright show-report
```
* **Nội dung hiển thị trên trang báo cáo**:
  - Tỷ lệ phần trăm thành công (100% Passed).
  - Thời gian phản hồi trung bình của từng trang.
  - Từng bước thực hiện kèm hình ảnh chụp màn hình (Screenshots) tại thời điểm assertion.
  - Video quay lại toàn bộ quá trình test tự động chạy (nếu bật cờ video).

---

### 6.2. Kiểm tra Network Headers, Request Payload & Trace
Nếu Thầy/Cô trong Hội đồng yêu cầu xem chi tiết **Request Headers**, **Token xác thực** hoặc **Payload dữ liệu**:

1. Chạy test có ghi nhận Trace (Dấu vết hoạt động):
   ```powershell
   cd d:\FireGuard\frontend
   npx playwright test tests/auth.spec.ts --trace on
   ```
2. Mở trình duyệt xem vết (Trace Viewer):
   ```powershell
   npx playwright show-trace test-results/.../trace.zip
   ```
3. **Chỉ cho Hội đồng thấy**:
   - Tab **Network**:
     - Header `Authorization: Basic dXNlcjpwYXNzd29yZA==` (HTTP Basic Auth).
     - Header `Cache-Control: no-store` tại các endpoint ảnh snapshot nhạy cảm.
     - Tham số query `?token=...` (HMAC Media Stream Token bảo vệ luồng video `/video_feed`).
     - Header `Retry-After: 60` khi tài khoản bị giới hạn tần suất đăng nhập (HTTP 429).

---

## 7. KỊCH BẢN 5: HƯỚNG DẪN THUYẾT MINH FILE BÁO CÁO TEST EXCEL (`test.xlsx`)

File [`frontend/tests/test.xlsx`](file:///d:/FireGuard/frontend/tests/test.xlsx) là tài liệu kiểm thử nghiệm thu chính thức của dự án. File được chuẩn hóa theo chuẩn quốc tế IEEE 829 với **16 Sheets riêng biệt** (mỗi phân hệ / function chức năng là 1 sheet độc lập) với tổng cộng **334 Test Cases**:

```
frontend/tests/test.xlsx
 ├── 1. Dang_Nhap                (34 Test Cases) -> Đăng nhập, Remember-Me, Lockout, Rate Limit
 ├── 2. Dang_Ky                  (46 Test Cases) -> Đăng ký, Validation, Mật khẩu ký tự đặc biệt, Modal Điều khoản & Escape key (PR #67)
 ├── 3. Xac_Thuc_OTP             (40 Test Cases) -> Giới hạn 5 lần OTP, Lockout 429, Cooldown 60s, Đồng bộ sessionStorage, Biên ký tự chữ (PR #65)
 ├── 4. Quen_DatLai_MK           (24 Test Cases) -> Khôi phục mật khẩu 2 giai đoạn, Chống tái sử dụng MK cũ
 ├── 5. Ho_So_Ca_Nhan            (19 Test Cases) -> BVA 8/9/11/12 số SĐT (PR #69), Chặn XSS/SQL Injection, Avatar, Đổi MK
 ├── 6. Phan_Quyen_RBAC          (12 Test Cases) -> Ma trận RBAC Admin vs User, Bảo vệ endpoint nhạy cảm
 ├── 7. Quan_Tri_Nguoi_Dung      (10 Test Cases) -> Quản trị User, Đổi vai trò, Khóa/Mở khóa tài khoản
 ├── 8. Quan_Ly_Camera           (25 Test Cases) -> Lưới đa dạng 4-25 ô, Clamp ResizeHandle 20%-80% (PR #56), CameraEmptyState, Tự hồi phục HLS
 ├── 9. Nhan_Dien_AI_Realtime    (17 Test Cases) -> Checkpoint mới YOLO26n best.pt, Model Provenance (PR #71), WebSocket, FPS
 ├── 10. Phan_Tich_Video         (18 Test Cases) -> Upload Gate, Phục hồi lỗi tệp 0 bytes/giả mạo, Semaphore slot release khi Pause/Cancel
 ├── 11. Lich_Su_Su_Co           (14 Test Cases) -> Tra cứu lịch sử, Lọc, Chi tiết Modal, Ngoại lệ ID âm/không tồn tại (404), Xuất CSV
 ├── 12. Cau_Hinh_AI_He_Thong    (11 Test Cases) -> Thanh trượt ngưỡng nhạy Fire/Smoke, Cooldown, Khôi phục mặc định
 ├── 13. Canh_Bao_Telegram_Zalo  (25 Test Cases) -> Mẫu tin tiếng Việt icon (PR #68), Phân biệt video vs cam, Người nhận theo User (PR #58)
 ├── 14. Nhat_Ky_Audit_Log       (11 Test Cases) -> Audit Log từ MySQL, Phân trang, Tìm kiếm, Sắp xếp, Xuất CSV
 ├── 15. Ha_Tang_Va_Bao_Mat_API  (28 Test Cases) -> GET /api/health (PR #72), CORS & No-Store, Launcher Origin/Probe, Supabase S3, Presigned URL
 └── 16. Defect_Log              (18 Bugs)       -> 18 Resolved (PR #15-#72, Đạt tỷ lệ khắc phục 100%)
```

### Cách trả lời câu hỏi của Hội đồng về Defect Log:
* **Hỏi**: *"Tình trạng khắc phục các lỗi (Defect Log) trong quá trình phát triển như thế nào?"*
* **Trả lời mẫu**:  
  > *"Thưa Thầy/Cô, đội ngũ kiểm thử của chúng em áp dụng nguyên tắc kiểm thử độc lập và kiểm chứng nghiêm ngặt. Trong toàn bộ 18 lỗi được phát hiện trong quá trình phát triển:*
  > - * **100% (18/18 lỗi) đã được khắc phục và kiểm thử hồi quy thành công**, bao gồm: bảo vệ luồng video camera bằng Stream Token HMAC (`BUG-008`), bắt buộc xác thực khi upload video AI (`BUG-009`), hỗ trợ ký tự đặc biệt mật khẩu theo chuẩn OWASP (`BUG-010`), chống Brute-force OTP qua khóa thử lại 429 (`BUG-011`), chống tái sử dụng mật khẩu cũ (`BUG-012`), tự động dọn dẹp ảnh snapshot chống tràn ổ cứng (`BUG-013`), chống Brute-force đăng nhập (`BUG-014`), triệt tiêu hoàn toàn lỗ hổng dò quét tài khoản timing attack Bcrypt (`BUG-015` tại PR #35), giải phóng semaphore slot video khi tạm dừng (`BUG-016`), an toàn hóa bộ test offline pytest (`BUG-017` tại PR #36), tự động làm mới token khi tab chuyển sang trạng thái ngủ (`BUG-018` tại PR #37), và chuẩn hóa mẫu SharedWebcam Singleton chia sẻ an toàn phần cứng webcam `0` trên máy tính phát triển (`BUG-004`, `BUG-007`).*
  > - * **Toàn bộ 334 test case trên 15 sheet chức năng đều đạt trạng thái Pass 100%**, sẵn sàng bàn giao và nghiệm thu sản phẩm."*

---

## 8. BẢNG TRA CỨU NHANH CÁC LỆNH (CHEAT SHEET)

| Mục đích thực hiện | Thư mục làm việc | Câu lệnh thực thi |
| :--- | :--- | :--- |
| **Mở Playwright UI trực quan (Demo chính)** | `frontend` | `npx playwright test --ui` |
| **Chạy xem trình duyệt tự động gõ phím** | `frontend` | `npx playwright test tests/auth.spec.ts --headed` |
| **Mở giao diện Debugger từng dòng** | `frontend` | `npx playwright test tests/auth.spec.ts --debug` |
| **Xem báo cáo đồ họa HTML sau khi test** | `frontend` | `npx playwright show-report` |
| **Kiểm tra TypeScript 0 lỗi** | `frontend` | `npx tsc --noEmit` |
| **Test phục hồi mạng Dashboard (14 tests)** | `frontend` | `node tests/dashboard_connection.unit.cjs` |
| **Test vòng đời Camera Backend** | `backend` | `.\venv\Scripts\python.exe -m unittest discover -s tests -p test_camera_lifecycle.py` |
| **Test AI nhận diện Cháy/Khói Backend** | `backend` | `.\venv\Scripts\python.exe -m unittest discover -s tests -p test_realtime_detection.py` |
| **Test Phân quyền & Audit Log Backend** | `backend` | `.\venv\Scripts\python.exe -m unittest discover -s tests -p test_admin_profile.py` |
| **Test Bot Telegram & Zalo Backend** | `backend` | `.\venv\Scripts\python.exe -m unittest discover -s tests -p test_notifications.py` |
| **Test Phân quyền người nhận tin Backend** | `backend` | `.\venv\Scripts\python.exe -m unittest discover -s tests -p test_notification_permissions.py` |
| **Test Cơ sở dữ liệu MySQL Aiven Backend** | `backend` | `.\venv\Scripts\python.exe -m unittest discover -s tests -p "test_mysql_*.py"` |
| **Chạy toàn bộ test Backend** | `backend` | `.\venv\Scripts\python.exe -m unittest discover -s tests -p "test_*.py"` |

---
*Tài liệu được biên soạn phục vụ công tác bảo vệ đồ án. Chúc bạn có một buổi báo cáo thành công xuất sắc trước Hội đồng!*
