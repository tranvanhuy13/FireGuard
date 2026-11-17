# FireGuard

FireGuard là ứng dụng web phân tích camera và video để phát hiện lửa, khói, hiển thị kết quả và gửi cảnh báo. Backend xử lý video và suy luận AI; trình duyệt quản lý camera, xem luồng trực tiếp, video phân tích và lịch sử sự kiện.

Hướng dẫn này dành cho cài đặt mới. Các lệnh chính dùng PowerShell trên Windows; chạy từng bước theo đúng thư mục được ghi. Dùng một cơ sở dữ liệu phát triển riêng, không dùng dữ liệu vận hành để thử nghiệm.

## Chức năng

- Đăng ký, xác minh email bằng OTP, đăng nhập và đặt lại mật khẩu.
- Quản lý camera thuộc tài khoản; bật/tắt camera và xem video trực tiếp.
- Phát hiện `fire` và `smoke`, hiển thị bounding box và độ tin cậy.
- Phân tích video tải lên, theo dõi kết quả và trạng thái gửi thông báo.
- Quản lý người nhận Telegram/Zalo, xem cảnh báo và bằng chứng hình ảnh.
- Tài khoản `admin` quản lý người dùng, cấu hình chung và nhật ký hệ thống; tài khoản `user` thao tác trên tài nguyên của mình.

AI cung cấp cảnh báo hỗ trợ. Chất lượng phụ thuộc dữ liệu, ánh sáng, góc camera và phần cứng; không thay thế hệ thống báo cháy được chứng nhận. README không cam kết độ chính xác hoặc FPS chưa đo trên môi trường triển khai.

## Công nghệ sử dụng

| Thành phần | Công nghệ và vai trò |
| --- | --- |
| Giao diện | Next.js 16, React 19, TypeScript, Tailwind CSS 4 |
| Thành phần giao diện | Framer Motion, Lucide, Recharts, React Hook Form, Zod |
| API | Python, FastAPI, Uvicorn; REST, WebSocket và MJPEG |
| AI và video | Ultralytics YOLO, PyTorch, OpenCV; trọng số tùy chỉnh `backend/best.pt` cho lửa/khói |
| Dữ liệu | MySQL 8+, SQLAlchemy Core, PyMySQL, Alembic |
| Xác thực | HTTP Basic cho API, bcrypt cho mật khẩu, OTP email; token HMAC cho media |
| Lưu trữ | Hệ thống file; tùy chọn S3-compatible/MinIO hoặc Google Cloud Storage |
| Thông báo | Telegram Bot API, Zalo Bot API; Gmail SMTP hoặc Brevo cho OTP |
| Triển khai | Docker, Docker Compose, Caddy; các workflow GitHub Actions |
| Kiểm thử | pytest/unittest cho backend; Playwright và Node test cho frontend |

Model được nạp từ `MODEL_PATH`, không suy ra kiến trúc chỉ từ tên `best.pt`. Khi thay trọng số, kiểm tra nguồn gốc, kiến trúc và danh sách lớp; backend yêu cầu có cả `fire` và `smoke`.

## Cấu trúc thư mục

```text
backend/
  app/              # Auth, users, cameras, detection, videos, events, storage...
  migrations/       # Alembic migrations
  scripts/          # Provisioning, migration, maintenance, diagnostics
  tests/            # Unit/offline và integration tests
  best.pt           # Trọng số phát hiện lửa/khói
  main.py           # Điểm vào ASGI
frontend/
  src/app/          # Next.js App Router
  src/components/   # Thành phần giao diện
  src/lib/api/      # API client
deploy/             # Docker Compose, Caddy và mẫu cấu hình
docs/               # Kiến trúc, API, cấu hình, vận hành và kiểm thử
```

## 1. Chuẩn bị

Cài Git, Python 3.12 và Node.js 22 kèm npm (cùng dòng phiên bản với Dockerfile). Chuẩn bị một MySQL 8+ có TLS, thông tin kết nối và CA certificate. Mã hiện tại kiểm tra chứng chỉ và hostname, không có tùy chọn bỏ kiểm tra TLS.

CPU có thể chạy suy luận; GPU là tùy chọn. Dung lượng và tốc độ thực tế phụ thuộc môi trường. Cần truy cập Internet khi cài dependencies; chạy camera mạng cần backend truy cập được địa chỉ camera.

```powershell
git --version
py -3.12 --version
node --version
npm --version
git clone https://github.com/tranvanhuy13/FireGuard.git
cd FireGuard
```

Nếu đã có checkout, cập nhật theo quy trình Git của nhóm trước khi tiếp tục; giữ lại các thay đổi cá nhân chưa commit.

## 2. Tạo môi trường backend

Từ thư mục gốc dự án:

```powershell
cd backend
py -3.12 -m venv venv
.\venv\Scripts\python.exe -m pip install --upgrade pip
.\venv\Scripts\python.exe -m pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
.\venv\Scripts\python.exe -m pip install -r requirements.txt
.\venv\Scripts\python.exe -m pip install "passlib[bcrypt]" "bcrypt>=4,<4.1"
```

Gói bcrypt được cài rõ vì đăng ký/đăng nhập dùng bcrypt và requirements chính chỉ liệt kê `passlib`. Không cần activate venv khi gọi Python bằng đường dẫn như trên. Các lệnh này chọn PyTorch CPU; nếu cần GPU, dùng bộ PyTorch/CUDA phù hợp với driver thay cho bước cài CPU.

Trên Linux/macOS, tạo venv bằng `python3 -m venv venv` và thay `.\venv\Scripts\python.exe` bằng `./venv/bin/python` trong các lệnh Python tiếp theo. OpenCV có thể cần thư viện hệ thống; Dockerfile backend liệt kê `libgl1` và `libglib2.0-0` cho Linux.

## 3. Cấu hình backend và MySQL

Vẫn ở `backend/`, chỉ sao chép mẫu nếu chưa có file cấu hình riêng:

```powershell
Copy-Item .env.local.example .env.local
New-Item -ItemType Directory -Force certs
```

Tải CA của dịch vụ MySQL, lưu thành `backend/certs/aiven-ca.pem`. Tạo database `fireguard` trước nếu dịch vụ chưa có database này; tài khoản migration phải có quyền tạo/sửa bảng. Điền thông tin thật vào `.env.local`, không đưa file này hoặc credentials vào Git:

```dotenv
MODEL_PATH=best.pt
MYSQL_HOST=your-mysql-host
MYSQL_PORT=3306
MYSQL_DATABASE=fireguard
MYSQL_USER=your-mysql-user
MYSQL_PASSWORD="replace-with-your-password"
MYSQL_SSL_CA=certs/aiven-ca.pem
DB_POOL_SIZE=5
DB_MAX_OVERFLOW=5
DB_POOL_TIMEOUT=10
DB_POOL_RECYCLE=300
AUTH_DEV_MODE=true
CORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
STREAM_TOKEN_SECRET=replace-with-a-random-secret
```

`3306` chỉ là ví dụ: dùng đúng port do dịch vụ cung cấp. Endpoint phải khớp chứng chỉ; kiểm tra firewall/IP allowlist nếu kết nối thất bại. Có thể dùng MySQL tự quản lý nếu đáp ứng cùng yêu cầu TLS.

Tạo secret ngẫu nhiên rồi dán kết quả vào `STREAM_TOKEN_SECRET`:

```powershell
.\venv\Scripts\python.exe -c "import secrets; print(secrets.token_hex(32))"
```

Thứ tự ưu tiên: biến môi trường của tiến trình → `backend/.env.local` → file `.env` được nạp → mặc định. Khởi động lại backend sau khi sửa cấu hình. Nếu shell đang giữ đường dẫn model cũ, xóa riêng biến đó để dùng giá trị trong file:

```powershell
Remove-Item Env:MODEL_PATH -ErrorAction SilentlyContinue
```

### Model và migration

Kiểm tra trọng số có sẵn trước khi khởi động:

```powershell
Test-Path best.pt
.\venv\Scripts\python.exe -c "from ultralytics import YOLO; m=YOLO('best.pt'); print(m.names)"
.\venv\Scripts\python.exe -m alembic upgrade head
```

`Test-Path` phải trả `True`; model phải có lớp lửa/khói. Nếu thiếu, lấy trọng số tùy chỉnh đã được nhóm xác minh và đặt ở `backend/best.pt`, hoặc trỏ `MODEL_PATH` đến trọng số đó. Đường dẫn tương đối được tính từ `backend/`. Chỉ nạp checkpoint từ nguồn tin cậy.

Migration phải hoàn tất trước khi chạy API. Không xóa bảng để xử lý lỗi migration trên dữ liệu đang dùng. Với cài đặt mới hoàn toàn, có thể seed cấu hình và camera mặc định:

```powershell
.\venv\Scripts\python.exe -m scripts.provisioning.seed_mysql
```

Seed là tùy chọn, không tạo tài khoản admin. Không seed trước khi nhập dữ liệu cũ; xem [runbook MySQL](docs/MYSQL_AIVEN_MIGRATION.md) nếu cần chuyển dữ liệu.

### Email OTP

Ở máy phát triển, `AUTH_DEV_MODE=true` cho phép ghi OTP vào log khi không có credentials email. Để thử chế độ này, để trống `GMAIL_ADDRESS`, `GMAIL_APP_PASSWORD` và `BREVO_API_KEY`; credentials có sẵn vẫn được ưu tiên gửi email. Chỉ dùng trên máy phát triển và không chia sẻ log chứa OTP.

Để gửi email thật, đặt `AUTH_DEV_MODE=false` và cấu hình một trong hai cách:

- Gmail SMTP: `GMAIL_ADDRESS` và `GMAIL_APP_PASSWORD` (App Password, không dùng mật khẩu đăng nhập Gmail).
- Brevo: `GMAIL_ADDRESS` làm địa chỉ người gửi đã xác minh, cùng `BREVO_API_KEY`. Cách này được ưu tiên khi đủ cấu hình.

Không cấu hình email và tắt dev mode sẽ làm các thao tác cần gửi OTP thất bại. OTP có thời hạn 5 phút, thời gian chờ gửi lại 60 giây.

## 4. Chạy backend

Trong terminal thứ nhất, ở `backend/`:

```powershell
.\venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8000
```

Giữ terminal này mở. Startup kiểm tra database, nạp model và có thể khởi chạy camera đã được bật. Kiểm tra từ terminal khác:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/
Invoke-RestMethod http://127.0.0.1:8000/health/ready
```

API docs: [http://localhost:8000/docs](http://localhost:8000/docs). Readiness trả `status=ready` khi kiểm tra database thành công; đây không phải kiểm chứng độ chính xác AI hoặc việc gửi thông báo.

## 5. Cấu hình và chạy frontend

Mở terminal thứ hai, từ thư mục gốc dự án:

```powershell
cd frontend
npm ci
```

Tạo `frontend/.env.local` bằng trình soạn thảo với nội dung:

```dotenv
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_WS_URL=ws://localhost:8000
NEXT_PUBLIC_USE_MOCK=false
NEXT_PUBLIC_USE_MOCK_AUTH=false
NEXT_PUBLIC_USE_MOCK_DATA=false
```

```powershell
npm run dev
```

Mở [http://localhost:3000](http://localhost:3000). Frontend và backend phải cùng chạy. Nếu trước đây bật mock trong trình duyệt, mở Developer Tools → Console và chạy `localStorage.removeItem('force_mock')`, rồi tải lại trang. Mock data không chứng minh backend hay AI đang hoạt động.

`NEXT_PUBLIC_*` được đưa vào mã trình duyệt, không chứa secret. Khi build production, phải cấu hình các giá trị này trước `npm run build`; đổi biến sau build cần build lại. Với HTTPS, dùng URL `https://` và WebSocket `wss://`.

## 6. Tạo tài khoản và thử luồng hoạt động

1. Đăng ký trên giao diện bằng username chữ/số, địa chỉ `@gmail.com` và mật khẩu tối thiểu 8 ký tự.
2. Lấy OTP từ email hoặc log backend ở dev mode, xác minh rồi đăng nhập.
3. Nếu cần quyền admin, từ terminal tại `backend/`, dùng tài khoản đã xác minh và không bị khóa:

   ```powershell
   .\venv\Scripts\python.exe -m scripts.provisioning.set_role YOUR_USERNAME admin
   ```

4. Đăng nhập lại để giao diện nhận quyền mới. Không có thông tin đăng nhập admin mặc định trong hướng dẫn này.
5. Thêm camera mình có quyền sử dụng. Nguồn `0` là webcam trên máy chạy backend, không phải webcam của trình duyệt; camera mạng dùng URL RTSP/RTSPS/HTTP(S) backend truy cập được.
6. Bật camera, kiểm tra hình ảnh, kết quả và trạng thái lỗi. Chỉ đăng ký camera chưa có nghĩa suy luận đã bắt đầu.
7. Thử video tải lên có lửa, khói và cảnh bình thường; kiểm tra lớp, độ tin cậy, cảnh báo và lịch sử. Dùng video mẫu an toàn, không tạo cháy thật để thử.

FPS của pipeline phụ thuộc camera, model và số luồng. Đánh giá model cần tập dữ liệu có nhãn độc lập, không chỉ quan sát vài video.

## 7. Cấu hình thông báo và lưu trữ

### Telegram và Zalo

Cấu hình credentials ở backend hoặc trang Settings của admin. Ví dụ trong `backend/.env.local`:

```dotenv
TELEGRAM_BOT_TOKEN=replace-with-your-token
TELEGRAM_ENABLED=true
ZALO_BOT_TOKEN=
ZALO_ENABLED=false
```

Sau khi khởi động lại backend:

1. Kiểm tra kênh được bật và đủ credentials trong Settings.
2. Mỗi người dùng tạo người nhận của mình ở Notification Accounts/Groups bằng chat ID tương ứng.
3. Dùng nút Test của người nhận và kiểm tra kết quả giao thực tế.

Biến môi trường không trống ưu tiên hơn thiết lập lưu trong MySQL; `*_ENABLED=false` vô hiệu hóa kênh. Các chat ID toàn cục không còn là đích gửi dự phòng: cần người nhận đang hoạt động thuộc chủ camera/video. Đọc [hướng dẫn người nhận](docs/ACCOUNT_NOTIFICATIONS.md) và [cấu hình hệ thống](docs/system/CONFIGURATION.md) để xử lý lỗi giao tin.

### Lưu trữ hình ảnh và model

Chạy native có thể dùng lưu trữ file cục bộ; object storage là tùy chọn. Không thiết lập endpoint cloud khi chỉ muốn chạy local. Khi dùng S3-compatible/MinIO, cấu hình `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_REGION` và `S3_SECURE` theo adapter đang dùng. GCS dùng `GCS_BUCKET` cùng credentials Google Cloud phù hợp.

`S3_PUBLIC_ENDPOINT` là endpoint S3 API công khai để tạo link ảnh cho Zalo, không phải trang Console. Link đã ký có hạn sử dụng (`S3_SNAPSHOT_URL_TTL_SECONDS`); giữ credentials và link riêng tư. Telegram gửi ảnh trực tiếp; thiếu link ảnh không đồng nghĩa không gửi được thông báo văn bản.

`SNAPSHOT_DIR` mặc định là `snapshots`; chạy từ `backend/` để vị trí dữ liệu nhất quán. `PERIODIC_SNAPSHOT_RETENTION_DAYS=7` và `SNAPSHOT_CLEANUP_INTERVAL_SECONDS=3600` điều khiển dọn ảnh định kỳ. Bằng chứng sự kiện có chính sách riêng, xem [hướng dẫn bằng chứng](docs/PRIVATE_ALERT_EVIDENCE.md).

## 8. Chạy bằng Docker Compose

Đây là cách thay thế chạy native, không cần chạy đồng thời hai cách. Cài Docker Engine/Desktop với Compose v2, chuẩn bị MySQL/TLS như trên. Từ thư mục gốc:

```powershell
New-Item -ItemType Directory -Force "$HOME/.fireguard"
Copy-Item deploy/local.env.example "$HOME/.fireguard/local.env"
```

Sửa file bên ngoài repo vừa tạo: điền `MYSQL_*`, `MYSQL_SSL_CA_HOST_PATH` (đường dẫn CA tuyệt đối trên Docker host), `MODEL_SEED` (đường dẫn tuyệt đối tới `best.pt`), mật khẩu MinIO/S3 và secret riêng. Thay mọi giá trị `change-me` trước khi chạy. Với Windows có thể dùng dạng `D:/certs/aiven-ca.pem`; xác nhận Docker có quyền đọc các file được mount.

```powershell
docker compose -f deploy/docker-compose.local.yml --env-file "$HOME/.fireguard/local.env" config --quiet
docker compose -f deploy/docker-compose.local.yml --env-file "$HOME/.fireguard/local.env" up -d --build
docker compose -f deploy/docker-compose.local.yml --env-file "$HOME/.fireguard/local.env" ps
docker compose -f deploy/docker-compose.local.yml --env-file "$HOME/.fireguard/local.env" logs --tail 100 backend
```

Stack gồm MinIO, bước khởi tạo bucket/model, backend, frontend và Caddy. Backend image chạy migration trước Uvicorn. Mở [http://localhost:8080](http://localhost:8080); Caddy chuyển `/api` tới backend. MinIO Console mặc định ở [http://localhost:9101](http://localhost:9101). Các port mặc định chỉ bind loopback. Webcam của host không tự xuất hiện trong container; cần camera mạng hoặc cấu hình thiết bị riêng.

Frontend Dockerfile mặc định build API URL `/api`; không dùng URL `localhost:8000` của native trong browser khi chạy stack này. File `backend/.env.local` không được tự động đưa vào container: dùng file `--env-file` và các biến Compose thực sự forward. Không sửa `MODEL_PATH` thành đường dẫn Windows bên trong container; image dùng `/data/models/best.pt`.

Dừng stack và giữ dữ liệu trong volumes:

```powershell
docker compose -f deploy/docker-compose.local.yml --env-file "$HOME/.fireguard/local.env" down
```

Không thêm `-v` trừ khi chủ động muốn xóa dữ liệu volumes. Triển khai VM theo [runbook MySQL](docs/MYSQL_AIVEN_MIGRATION.md) và cấu hình trong `deploy/`; quản lý CA, secrets, backups và migrations trước khi bật workflow triển khai.

## 9. Kiểm thử và kiểm tra trước khi gửi PR

Backend: mở terminal ở `backend/`, dùng môi trường kiểm thử riêng nếu không muốn thay dependencies của môi trường chạy:

```powershell
py -3.12 -m venv .venv-test
.\.venv-test\Scripts\python.exe -m pip install -r requirements-test.txt
.\.venv-test\Scripts\python.exe -m pytest tests/ -q -rs
```

Mặc định các bài kiểm thử tích hợp cần dịch vụ thật được bỏ qua. Không bật `--integration` trên database đang vận hành; xem điều kiện database `_test` và hướng dẫn trong [TESTING.md](docs/system/TESTING.md). Kiểm thử offline không đo độ chính xác model, camera vật lý hay việc gửi tin thật.

Frontend, ở `frontend/` sau `npm ci`:

```powershell
npx tsc --noEmit
npm run lint
npm run test:connection
```

Playwright dùng `npm test`; chuẩn bị browser và cấu hình theo `frontend/playwright.config.ts` trước. Chỉ ghi các kết quả đã chạy thật vào PR.

## 10. Xử lý lỗi thường gặp

| Hiện tượng | Cách kiểm tra |
| --- | --- |
| Thiếu MySQL config hoặc CA | Kiểm tra `.env.local`, đúng host/port và file CA; không tắt xác minh TLS |
| API không sẵn sàng sau migration | Xem log và `alembic current`; xác nhận migration chạy trên đúng database |
| Thiếu model hoặc thiếu lớp | Kiểm tra `MODEL_PATH`, file tồn tại và `YOLO(...).names`; dùng trọng số fire/smoke |
| OTP không tới | Kiểm tra dev mode/log, Gmail App Password hoặc Brevo, kết nối dịch vụ; không gửi log có OTP lên Git |
| Frontend hiện dữ liệu mẫu | Tắt các cờ mock, xóa `force_mock` trong localStorage, khởi động lại frontend |
| Lỗi CORS hoặc không kết nối WebSocket | Đồng nhất hostname/port, `CORS_ORIGINS`, API/WS URL và HTTP/HTTPS |
| Không có hình camera | Xác nhận nguồn nằm trên backend host hoặc URL mạng truy cập được, camera đã bật và không bị ứng dụng khác chiếm |
| Bot đủ token nhưng không giao tin | Kiểm tra trạng thái enabled, người nhận thuộc tài khoản và kết quả Test; không chỉ dựa vào HTTP 200 |
| Đổi config nhưng không có hiệu lực | Kiểm tra biến shell đang ghi đè; restart native hoặc recreate container; build lại frontend nếu đổi biến public |

## Tài liệu tiếp theo

- [Chỉ mục tài liệu hệ thống](docs/system/README.md)
- [Kiến trúc runtime](docs/system/ARCHITECTURE.md)
- [Cấu hình đầy đủ](docs/system/CONFIGURATION.md)
- [MySQL, migration và rollout](docs/MYSQL_AIVEN_MIGRATION.md)
- [Phát hiện thời gian thực](docs/REALTIME_DETECTION.md)
- [Quyền truy cập](docs/AUTHORIZATION.md)
- [Kiểm thử và tác động phụ](docs/system/TESTING.md)

Khi sửa mã, tạo nhánh riêng từ `master`, commit đúng phạm vi thay đổi và mở pull request. Không commit `.env.local`, CA, credentials, log có OTP, database hay dữ liệu camera cá nhân.
