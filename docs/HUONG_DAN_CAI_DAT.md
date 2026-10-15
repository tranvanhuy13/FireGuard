# Hướng dẫn cài đặt: MinIO và CI/CD

Tài liệu này hướng dẫn chạy FireGuard trên máy local bằng Docker, dùng **MinIO** để lưu ảnh snapshot và model, và **GitHub Actions** (self-hosted runner) để tự deploy mỗi khi push lên `main`.

Chi tiết những file code đã thay đổi xem ở [THAY_DOI_MA_NGUON.md](THAY_DOI_MA_NGUON.md).

## Kiến trúc

```
Trình duyệt ──► Caddy :8080 ──┬── /api/*  ──► backend (FastAPI + YOLO) ──► MinIO (bucket "fireguard")
                              └── /*      ──► frontend (Next.js)
```

| Container | Vai trò | Cổng trên máy |
|---|---|---|
| `caddy` | Reverse proxy: `/api/*` vào backend, còn lại vào frontend | `127.0.0.1:8080` |
| `frontend` | Giao diện Next.js | (chỉ trong mạng Docker) |
| `backend` | API FastAPI, nhận diện cháy bằng YOLO | (chỉ trong mạng Docker) |
| `minio` | Object storage, lưu snapshot và model | Console `127.0.0.1:9101` |
| `minio-init` | Chạy một lần mỗi khi khởi động: tạo bucket, user, upload model | — |

Backend yêu cầu đăng nhập (hệ thống `backend/auth/` của nhóm) cho mọi API, trừ `/api/`, đăng ký/OTP và `/api/snapshots/*` (để công khai cho Zalo). Các cổng chỉ mở trên `127.0.0.1` theo mặc định; đặt `BIND=0.0.0.0` để mở cho mạng LAN.

## Yêu cầu

- Linux, có Docker Engine và Docker Compose v2 (`docker compose version`).
- Khoảng 6 GB trống ổ đĩa. Riêng image backend khoảng 2,5 GB vì có PyTorch.
- File model `best.pt`. File này **không có trong git** (bị `.gitignore`), nên phải lấy từ người trong nhóm.

## Phần 1: Chạy stack trên máy local

### 1. Tạo file cấu hình

File cấu hình chứa mật khẩu, nên đặt **ngoài repo**:

```bash
mkdir -p ~/.fireguard && chmod 700 ~/.fireguard
cp deploy/local.env.example ~/.fireguard/local.env
chmod 600 ~/.fireguard/local.env
cp /đường/dẫn/tới/best.pt ~/.fireguard/best.pt
```

Sửa `~/.fireguard/local.env`:

| Biến | Ý nghĩa |
|---|---|
| `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD` | Tài khoản quản trị MinIO, dùng để đăng nhập console |
| `S3_BUCKET` | Tên bucket (mặc định `fireguard`) |
| `S3_ACCESS_KEY`, `S3_SECRET_KEY` | User riêng của backend, chỉ có quyền trên bucket trên |
| `MODEL_SEED` | Đường dẫn **tuyệt đối** tới `best.pt`, được upload vào MinIO ở lần chạy đầu |
| `BIND` | `127.0.0.1` (chỉ máy này) hoặc `0.0.0.0` (mở cho mạng LAN) |
| `HTTP_PORT` | Cổng web (mặc định `8080`) |
| `MINIO_CONSOLE_PORT` | Cổng console MinIO (mặc định `9101`) |
| `GMAIL_ADDRESS`, `GMAIL_APP_PASSWORD` | Tài khoản Gmail dùng để gửi mã OTP khi đăng ký. `GMAIL_APP_PASSWORD` là *App Password*, không phải mật khẩu Gmail. Cách tạo xem ở mục 6, phần "Gửi OTP qua Gmail (SMTP)" |
| `AUTH_DEV_MODE` | `true`: không gửi email, mã OTP được ghi vào log backend (dùng khi chạy thử). `false`: bắt buộc phải có Gmail |
| `STREAM_TOKEN_SECRET` | Chuỗi bí mật ngẫu nhiên để token xem camera/WebSocket vẫn hợp lệ sau khi khởi động lại (`openssl rand -hex 32`) |

Tạo mật khẩu ngẫu nhiên bằng lệnh `openssl rand -hex 20`.

### 2. Khởi động

Chạy từ thư mục gốc của repo:

```bash
docker compose -f deploy/docker-compose.local.yml --env-file ~/.fireguard/local.env up -d --build
```

Lần đầu mất khoảng 10–15 phút để build image; các lần sau nhanh hơn nhờ cache.

Thứ tự khởi động: `minio` chạy và đạt healthy, rồi `minio-init` chạy xong thành công, sau đó mới tới `backend`. Nếu `minio-init` lỗi thì backend không khởi động.

### 3. Kiểm tra

```bash
docker compose -f deploy/docker-compose.local.yml --env-file ~/.fireguard/local.env ps -a
curl http://127.0.0.1:8080/api/          # {"status":"ok",...}
curl http://127.0.0.1:8080/api/cameras
```

- Web: http://127.0.0.1:8080. Lần đầu chưa có tài khoản nào: bấm **Đăng ký** (xem mục 6).
- Console MinIO: http://127.0.0.1:9101. Đăng nhập bằng `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD`. Trong bucket `fireguard` sẽ thấy `models/best.pt` và thư mục `snapshots/`.

Log khởi động backend bình thường sẽ có:

```
[Storage] Downloading minio://minio:9000/fireguard/models/best.pt -> /data/models/best.pt
Model loaded. Classes: {0: 'Fire'}
Application startup complete.
```

### 4. Các lệnh thường dùng

```bash
C="docker compose -f deploy/docker-compose.local.yml --env-file $HOME/.fireguard/local.env"
$C logs -f backend          # xem log backend
$C logs minio-init          # xem kết quả khởi tạo MinIO
$C restart backend
$C down                     # dừng, GIỮ dữ liệu
$C down -v                  # dừng và XOÁ toàn bộ dữ liệu (MinIO, database)
```

Dữ liệu nằm trong 2 Docker volume: `fireguard_minio_data` (ảnh, model) và `fireguard_backend_data` (SQLite `fire_guard.db`, bản cache của model, ảnh đang chờ upload).

### 5. Khi máy tắt và khởi động lại

Không cần làm gì, stack tự chạy lại:

| Thành phần | Sau khi khởi động lại |
|---|---|
| Docker | Tự bật cùng máy. Kiểm tra bằng `systemctl is-enabled docker`; nếu chưa bật thì chạy `sudo systemctl enable docker` |
| `minio`, `backend`, `frontend`, `caddy` | Tự chạy lại nhờ `restart: unless-stopped` |
| `minio-init` | Không chạy lại. Không cần, vì bucket, user và model đã có sẵn trong volume |
| Dữ liệu | Còn nguyên: camera, lịch sử sự kiện, cài đặt, ảnh, model |
| Camera RTSP | Backend tự kết nối lại |
| Self-hosted runner | Tự chạy lại nếu đã cài bằng `./svc.sh install`. Các lần push trong lúc máy tắt sẽ chờ trong hàng đợi và chạy khi runner online (GitHub giữ tối đa 24 giờ) |

Khi khởi động lại, Docker bật các container theo **thứ tự bất kỳ** (bỏ qua `depends_on`). Backend vẫn xử lý được:

- Model đã được cache trong volume, nên backend không cần MinIO để khởi động.
- Nếu MinIO chưa lên, ảnh mới được ghi tạm vào `/data/snapshots` trong volume. Mỗi lần ghi chỉ mất dưới 1 giây, nên nhận diện cháy không bị khựng. Một luồng nền thử upload lại mỗi 60 giây, rồi xoá bản tạm khi upload xong.

Hai trường hợp container **không** tự chạy lại:

- Bạn đã chạy `docker compose stop` hoặc `down` trước khi tắt máy. Khi đó chạy lại lệnh `up -d` ở bước 2.
- Hai server dev chạy bằng `npm run dev` / `uvicorn` ngoài Docker (cổng 3000, 8001). Chúng không có cơ chế tự khởi động.

### 6. Tài khoản và đăng nhập

Nhánh này dùng hệ thống đăng nhập của nhóm (`backend/auth/`, `backend/users/`). Tài liệu chi tiết xem ở `docs/API_CONTRACT.md` và chú thích đầu file `backend/main.py`. Tóm tắt:

- **Đăng ký** (`/register`): username và mật khẩu chỉ gồm chữ và số; email **bắt buộc là `@gmail.com`**. Hệ thống gửi mã OTP 6 số qua email, mã hết hạn sau 5 phút; nhập mã ở trang xác thực. Chưa xác thực thì chưa đăng nhập được.
- **Đăng nhập**: frontend gửi `Authorization: Basic` kèm mỗi request. Luồng camera và WebSocket dùng token tạm lấy từ `GET /auth/stream-token`.
- Tài khoản và mã OTP được lưu ở `AUTH_DB_PATH`. Trong Docker là `/data/auth.db` (volume `backend_data`), nên không mất khi deploy lại.

Chạy thử khi chưa có Gmail: đặt `AUTH_DEV_MODE=true` trong `local.env`, chạy lại `up -d`, rồi lấy mã OTP từ log:

```bash
docker compose -f deploy/docker-compose.local.yml --env-file ~/.fireguard/local.env logs backend | grep "DEV MODE"
```

#### Gửi OTP qua Gmail (SMTP)

Backend gửi mã OTP bằng SMTP của Gmail (`smtp.gmail.com`, cổng 587, STARTTLS; xem `send_otp_email` trong `backend/auth/utils.py`). Gmail không cho đăng nhập SMTP bằng mật khẩu thường, nên phải dùng **App Password** (mật khẩu ứng dụng, 16 ký tự).

**Bước 1: Bật Xác minh 2 bước** cho tài khoản Gmail dùng để gửi mail. Nên tạo một Gmail riêng cho hệ thống, ví dụ `fireguard.otp@gmail.com`, đừng dùng Gmail cá nhân.

1. Mở https://myaccount.google.com/security.
2. Ở mục *Cách bạn đăng nhập vào Google*, bật **Xác minh 2 bước** (2-Step Verification) và làm theo hướng dẫn (xác nhận bằng số điện thoại).

**Bước 2: Tạo App Password**

1. Mở https://myaccount.google.com/apppasswords. Đăng nhập lại nếu được hỏi.
2. Ở ô *Tên ứng dụng*, gõ `FireGuard`, rồi bấm **Tạo**.
3. Google hiện một mật khẩu 16 ký tự, dạng `abcd efgh ijkl mnop`. **Chép ngay**, vì mật khẩu này chỉ hiện một lần. Nếu mất, xoá nó đi rồi tạo cái mới.

Nếu trang App Password báo *"The setting you are looking for is not available"*, có ba khả năng thường gặp:

- Chưa bật Xác minh 2 bước.
- Tài khoản thuộc Google Workspace (email công ty) và quản trị viên đã tắt App Password.
- Tài khoản đang bật *Advanced Protection*.

**Bước 3: Điền vào cấu hình**

Khi chạy bằng Docker, điền vào `~/.fireguard/local.env`:

```bash
GMAIL_ADDRESS=fireguard.otp@gmail.com
GMAIL_APP_PASSWORD=abcd efgh ijkl mnop   # để nguyên dấu cách cũng được, code tự bỏ
AUTH_DEV_MODE=false
```

Rồi tạo lại container backend để nạp biến mới:

```bash
docker compose -f deploy/docker-compose.local.yml --env-file ~/.fireguard/local.env up -d backend
```

Khi chạy bằng `start.bat` hoặc `uvicorn`, không qua Docker: tạo file `backend/.env` chứa ba dòng trên (backend tự đọc file này bằng `python-dotenv`). File `.env` đã nằm trong `.gitignore`, **không được commit**.

**Bước 4: Kiểm tra**

1. Mở trang **Đăng ký**, dùng một địa chỉ `@gmail.com` mà bạn đọc được thư.
2. Mã OTP sẽ tới trong vài giây, tiêu đề *"Your verification code"*. Nếu không thấy trong hộp thư đến, kiểm tra cả thư mục **Spam**.
3. Nếu gửi lỗi, trang đăng ký báo lỗi, API trả về `502 Could not send OTP email`, và log backend có dòng `Could not send OTP e-mail to ...`. Xem chi tiết lỗi bằng:
   ```bash
   docker compose -f deploy/docker-compose.local.yml --env-file ~/.fireguard/local.env logs backend | grep -A5 "Could not send OTP"
   ```

| Lỗi trong log | Nguyên nhân và cách xử lý |
|---|---|
| `535 ... Username and Password not accepted` | Sai App Password, hoặc đang dùng mật khẩu Gmail thường. Tạo App Password mới và kiểm tra lại `GMAIL_ADDRESS` |
| `534 ... Application-specific password required` | Chưa dùng App Password. Làm lại Bước 2 |
| `GMAIL_ADDRESS / GMAIL_APP_PASSWORD are not configured` | Thiếu biến, và `AUTH_DEV_MODE` đang là `false`. Kiểm tra `local.env`, rồi chạy lại lệnh `up -d backend` |
| `timed out` / `Connection refused` | Mạng chặn cổng 587 (ví dụ một số mạng công ty). Thử mạng khác. Google Cloud chỉ chặn cổng 25, cổng 587 dùng được |
| Thư vào Spam | Bình thường với Gmail mới tạo. Đánh dấu "Không phải spam" vài lần để Gmail học |

Lưu ý:

- Khi đã điền `GMAIL_ADDRESS` và `GMAIL_APP_PASSWORD`, backend **luôn gửi mail thật**, kể cả khi `AUTH_DEV_MODE=true`. `AUTH_DEV_MODE` chỉ có tác dụng khi hai biến này để trống.
- Gmail cá nhân giới hạn khoảng **500 thư/ngày**. Đủ cho đồ án; nếu cần nhiều hơn thì phải dùng dịch vụ gửi mail riêng như SendGrid hay Amazon SES (code hiện chỉ hỗ trợ Gmail).
- Hệ thống chỉ cho **đăng ký bằng địa chỉ `@gmail.com`** (quy tắc của nhóm trong `is_valid_email`).
- Nếu App Password bị lộ, xoá nó ở https://myaccount.google.com/apppasswords. Mọi mật khẩu khác của tài khoản vẫn an toàn.

### 7. Đăng nhập bằng Google / Facebook (chưa hoạt động)

**Trạng thái hiện tại:** hai nút **Google** và **Facebook** có trên trang đăng nhập và đăng ký, nhưng **chưa đăng nhập được**. Bấm vào chỉ hiện thông báo "chưa hỗ trợ" (`socialNotImplemented`). Backend chưa có phần xử lý OAuth; phần này sẽ được làm khi có thông tin ứng dụng bên dưới.

Cần chuẩn bị hai ứng dụng OAuth. Trong các bước dưới đây, `<SITE>` là địa chỉ người dùng mở trang web: `http://localhost:8080` khi chạy local, hoặc `https://<tên miền>` khi chạy thật.

**Google**

1. Vào [Google Cloud Console → APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials). Chọn hoặc tạo một project.
2. Nếu được yêu cầu, cấu hình **OAuth consent screen**: chọn *External*, điền tên ứng dụng và email hỗ trợ. Khi app còn ở chế độ *Testing*, thêm email của những người được phép đăng nhập vào mục *Test users*.
3. **Create credentials → OAuth client ID → Web application**.
4. **Authorized redirect URIs**: thêm `<SITE>/api/auth/oauth/google/callback`. Ví dụ `http://localhost:8080/api/auth/oauth/google/callback`.
5. Lưu lại **Client ID** và **Client secret**.

**Facebook**

1. Vào [Meta for Developers → My Apps](https://developers.facebook.com/apps) → **Create app**. Chọn mục đích *Authenticate and request data from users with Facebook Login*.
2. Trong **Facebook Login → Settings**, ở mục **Valid OAuth Redirect URIs**, thêm `<SITE>/api/auth/oauth/facebook/callback`.
3. Trong **App settings → Basic**, lưu lại **App ID** và **App secret**. Điền thêm *Privacy Policy URL* nếu muốn chuyển app sang chế độ *Live*.
4. Khi app còn ở chế độ *Development*, chỉ những tài khoản có vai trò trong app (Admin, Developer, Tester) mới đăng nhập được.

Facebook chỉ chấp nhận redirect URI dùng **HTTPS**, trừ `localhost`. Vì vậy, khi chạy trong mạng LAN bằng địa chỉ IP, đăng nhập Facebook sẽ không hoạt động.

**Nơi lưu thông tin:** điền vào `~/.fireguard/local.env`. **Không** commit file này, và không gửi secret qua chat hay email.

```bash
PUBLIC_BASE_URL=http://localhost:8080      # <SITE> ở trên
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
FACEBOOK_APP_ID=...
FACEBOOK_APP_SECRET=...
```

Tên các biến này là tên dự kiến cho phần backend sắp làm. Nếu chúng thay đổi khi triển khai, mục này sẽ được cập nhật.

**Dự kiến hoạt động khi xong:**

- Lần đầu đăng nhập bằng Google/Facebook sẽ tạo tài khoản mới, đã xác thực sẵn (email đã được Google/Facebook xác minh).
- Nếu email trùng với một tài khoản đã có, hai tài khoản sẽ được liên kết với nhau.
- Mục "Tài khoản liên kết" trong trang Hồ sơ sẽ được thêm lại, hiển thị dữ liệu thật.

## Phần 2: CI/CD với GitHub Actions

Có hai workflow:

| Workflow | Chạy khi | Làm gì |
|---|---|---|
| [`local-cd.yml`](../.github/workflows/local-cd.yml) | Push lên `main`, hoặc bấm chạy tay | Trên **máy của bạn** (self-hosted runner): build image, `up -d`, kiểm tra trang trả lời |
| [`deploy.yml`](../.github/workflows/deploy.yml) | Mỗi PR và mỗi lần push | Trên máy của GitHub: build thử 2 image (CI). Chỉ deploy lên Google Cloud khi đã đặt biến `GCP_PROJECT_ID` |

### 1. Đăng ký self-hosted runner

Làm trên chính máy sẽ chạy stack, và máy đã làm xong Phần 1:

1. Vào repo trên GitHub: **Settings → Actions → Runners → New self-hosted runner**, chọn **Linux**.
2. Chạy các lệnh GitHub hiển thị (tải runner, `./config.sh --url ... --token ...`).
   Lúc chạy `config.sh`, ở câu hỏi *runner group* và *runner name* chỉ cần nhấn Enter để dùng mặc định. Đừng gõ lệnh khác vào đó, ví dụ `./run.sh`; nếu gõ, sẽ gặp lỗi `Could not find any self-hosted runner group named ...`.
3. Khi được hỏi *labels*, nhập: **`fireguard`**. Workflow chỉ chạy trên runner có label này. Nếu thiếu label, job **Local CD** sẽ nằm mãi ở trạng thái *Queued*.

   **Nếu lỡ bỏ trống label** (runner chỉ có `self-hosted`, `Linux`, `X64`) thì không cần cấu hình lại. Thêm trên GitHub:
   1. Vào **Settings → Actions → Runners**, bấm vào tên runner.
   2. Ở mục **Labels**, bấm biểu tượng bánh răng, gõ `fireguard` rồi chọn *Create new label "fireguard"*.
   3. Job đang chờ (GitHub giữ tối đa 24 giờ) sẽ tự chạy. Nếu không có job nào đang chờ, vào **Actions → Local CD → Run workflow**.
4. Cài runner thành **service** để nó tự chạy khi bật máy. Nếu chỉ chạy bằng `./run.sh`, runner sẽ dừng khi đóng terminal hoặc tắt máy.

   Nếu `./run.sh` đang chạy, dừng nó trước (Ctrl+C trong terminal đó), vì không được chạy 2 bản runner cùng lúc. Sau đó chạy:
   ```bash
   cd ~/Downloads/cap_fg/actions-runner      # thư mục chứa config.sh, sửa theo máy của bạn
   sudo ./svc.sh install $USER
   sudo ./svc.sh start
   sudo ./svc.sh status                      # phải thấy "active (running)"
   ```
   Gỡ service: `sudo ./svc.sh stop && sudo ./svc.sh uninstall`.
5. User chạy runner phải dùng được Docker mà không cần `sudo` (`docker ps` chạy được). Nếu chưa được: `sudo usermod -aG docker $USER`, rồi đăng xuất và đăng nhập lại.

Runner đọc cấu hình từ `$HOME/.fireguard/local.env` của user chạy runner. Nếu runner chạy bằng user khác thì phải tạo file đó cho user ấy.

### 2. Bảo mật runner (bắt buộc nếu repo public)

Self-hosted runner chạy code ngay trên máy của bạn. Với repo **public**, một người lạ mở PR có thể sửa workflow để chạy lệnh tuỳ ý trên runner. Vì vậy:

- `local-cd.yml` **không** chạy cho pull request, chỉ chạy cho push lên `main` và chạy tay.
- Vào **Settings → Actions → General → Fork pull request workflows**, bật **Require approval for all external contributors**.
- Tốt nhất là để repo ở chế độ **private**. GitHub khuyên chỉ dùng self-hosted runner với repo private.

### 3. Kiểm tra pipeline

```bash
git checkout main && git pull
git commit --allow-empty -m "test CD"
git push
```

Vào tab **Actions** trên GitHub, mở run **Local CD**. Khi bước *Smoke test* in ra `Deployed <sha> -> http://127.0.0.1:8080` là thành công.

Cũng có thể chạy tay: **Actions → Local CD → Run workflow**.

## Phần 3 (tuỳ chọn): Chuyển lên Google Cloud

Mã nguồn đã hỗ trợ Google Cloud Storage. Khi có project GCP (ví dụ dùng credit dùng thử 300 USD):

```bash
PROJECT_ID=<project-id> GITHUB_REPO=<owner>/FireGuard ./deploy/gcp-setup.sh all
PROJECT_ID=<project-id> GITHUB_REPO=<owner>/FireGuard ./deploy/gcp-setup.sh env
PROJECT_ID=<project-id> GITHUB_REPO=<owner>/FireGuard ./deploy/gcp-setup.sh outputs
```

Lệnh `outputs` in ra các biến cần thêm vào **Settings → Secrets and variables → Actions → Variables**. Sau khi có `GCP_PROJECT_ID`, mỗi lần push lên `main` workflow `deploy.yml` sẽ deploy lên VM. Chi phí ước tính khoảng 65–70 USD/tháng (VM e2-standard-2 ở Singapore).

## Xử lý sự cố

| Hiện tượng | Nguyên nhân và cách xử lý |
|---|---|
| `minio-init` báo `no seed model is mounted at /seed/best.pt` | `MODEL_SEED` sai đường dẫn hoặc không phải đường dẫn tuyệt đối. Sửa trong `local.env` |
| `required variable MINIO_ROOT_USER is missing` | Quên `--env-file ~/.fireguard/local.env` |
| Lỗi `address already in use` ở cổng 8080/9101 | Đổi `HTTP_PORT` / `MINIO_CONSOLE_PORT` trong `local.env` |
| Build backend treo rất lâu ở `pip install` | Mạng chập chờn khi tải package. Dừng (`Ctrl+C`) và build lại |
| Log có `Pending snapshot sync failed, retrying later` | MinIO chưa chạy. Kiểm tra `$C ps minio`. Ảnh vẫn nằm an toàn trong volume chờ upload |
| Camera hiện `disconnected` | Nguồn `0` là webcam, nhưng container không có webcam. Thêm camera bằng URL RTSP |
| Run **Local CD** cứ ở trạng thái *Queued* | Runner chưa chạy (*Offline*) hoặc thiếu label `fireguard`. Kiểm tra ở Settings → Actions → Runners; thêm label theo Phần 2, bước 3 |
| Runner *Offline* sau khi khởi động lại máy | Runner đang chạy bằng `./run.sh` chứ không phải service. Cài service theo Phần 2, bước 4 |
| Workflow lỗi `~/.fireguard/local.env not found` | Runner chạy bằng user khác. Tạo file cho user đó |

## Lưu ý về image MinIO

MinIO bản cộng đồng đã ngừng phát hành Docker image từ 10/2025, và repo bị archive vào 04/2026. Hiện cả `minio/minio` lẫn `quay.io/minio/minio` đều không tải được. Dự án dùng **`pgsty/minio`**, bản fork do cộng đồng duy trì, có kèm sẵn `mc`. Khi nâng cấp, đổi tag trong [`docker-compose.local.yml`](../deploy/docker-compose.local.yml) ở cả hai service `minio` và `minio-init`.

Vì backend dùng chuẩn S3, có thể thay MinIO bằng một dịch vụ tương thích S3 khác (ví dụ RustFS) chỉ bằng cách đổi image. Không cần sửa code.
