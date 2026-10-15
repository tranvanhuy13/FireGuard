# Thay đổi mã nguồn: MinIO và CI/CD

Tài liệu này liệt kê những file đã thêm hoặc sửa để FireGuard dùng MinIO và CI/CD, và mỗi thay đổi nằm ở đâu. Cách cài đặt xem ở [HUONG_DAN_CAI_DAT.md](HUONG_DAN_CAI_DAT.md).

## Tổng quan

| Nhóm | File | Loại |
|---|---|---|
| Lưu trữ | [`backend/storage.py`](../backend/storage.py) | **Mới** |
| Xác thực (của nhóm) | [`backend/auth/database.py`](../backend/auth/database.py) | Sửa 1 dòng: đường dẫn DB đọc từ `AUTH_DB_PATH` |
| Backend | [`backend/main.py`](../backend/main.py), [`backend/camera_manager.py`](../backend/camera_manager.py), [`backend/video_analyzer.py`](../backend/video_analyzer.py), [`backend/requirements.txt`](../backend/requirements.txt) | Sửa |
| Frontend | [`frontend/src/config.ts`](../frontend/src/config.ts), [`frontend/next.config.ts`](../frontend/next.config.ts) | Sửa |
| Docker | `backend/Dockerfile`, `backend/.dockerignore`, `frontend/Dockerfile`, `frontend/.dockerignore` | **Mới** |
| Chạy local | `deploy/docker-compose.local.yml`, `deploy/Caddyfile.local`, `deploy/minio-init.sh`, `deploy/local.env.example` | **Mới** |
| CI/CD | `.github/workflows/local-cd.yml`, `.github/workflows/deploy.yml` | **Mới** |
| Google Cloud (tuỳ chọn) | `deploy/docker-compose.yml`, `deploy/Caddyfile`, `deploy/gcp-setup.sh`, `deploy/vm-startup.sh`, `deploy/.env.example` | **Mới** |

Nhánh `thang` được tạo từ `master` của repo gốc. Hệ thống đăng nhập (`backend/auth/`, `backend/users/`, các trang login/register/verify-otp) **giữ nguyên của nhóm**, chỉ thêm `AUTH_DB_PATH` để Docker lưu tài khoản trong volume. Không thay đổi: `database.py`, `detection.py`, `notification.py`, các API. `start.bat` vẫn chạy được và lưu ảnh vào ổ đĩa.

## 1. Lớp lưu trữ: `backend/storage.py` (mới)

Mọi thao tác đọc/ghi ảnh snapshot và tải model đi qua module này. Nơi lưu được chọn bằng biến môi trường, không cần sửa code:

| Biến môi trường | Nơi lưu |
|---|---|
| `S3_ENDPOINT` (+ `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_SECURE`) | MinIO hoặc dịch vụ tương thích S3 |
| `GCS_BUCKET` | Google Cloud Storage (dùng service account của VM) |
| Không đặt gì | Ổ đĩa, thư mục `snapshots/` (như trước đây) |

| Hàm / lớp | Tác dụng |
|---|---|
| `_MinioStore` | Đọc/ghi qua thư viện `minio` (S3 API) |
| `_GcsStore` | Đọc/ghi qua thư viện `google-cloud-storage` |
| `save_snapshot(name, img, keep_local=False)` | Mã hoá JPEG rồi upload lên `snapshots/<name>`. Nếu upload lỗi thì ghi tạm ra ổ đĩa để không mất ảnh. `keep_local=True` giữ thêm một bản trên ổ đĩa |
| `read_snapshot(name)` | Đọc từ ổ đĩa nếu có, nếu không thì đọc từ object storage. Trả về `None` nếu không tồn tại |
| `delete_snapshot(name)` | Xoá ở cả ổ đĩa và object storage |
| `discard_local(path)` | Xoá bản trên ổ đĩa sau khi đã dùng xong (chỉ khi có object storage) |
| `ensure_model(path)` | Nếu chưa có file model thì tải `models/best.pt` từ object storage về |
| `start_sync()` | Luồng nền, mỗi 60 giây upload các ảnh còn nằm trên ổ đĩa (do lúc lưu không kết nối được MinIO), xong thì xoá bản tạm. Chỉ xử lý file cũ hơn 60 giây, tránh đụng vào file đang được đính kèm thông báo |

Client MinIO đặt thời gian chờ ngắn (kết nối 2 giây, thử lại 1 lần). Khi MinIO tắt, mỗi lần lưu ảnh chỉ mất khoảng 0,4 giây thay vì khoảng 6,6 giây, nên luồng nhận diện cháy không bị chặn. Thư mục ảnh tạm đặt bằng biến `SNAPSHOT_DIR`; trong Docker là `/data/snapshots`, nằm trong volume, nên không mất khi container bị tạo lại.

Tên file luôn được cắt bằng `os.path.basename`, nên không thể đọc file ngoài thư mục snapshot kiểu `../main.py`.

## 2. Xác thực (của nhóm)

Không viết lại. Thay đổi duy nhất là ở `backend/auth/database.py`: `DATABASE_PATH = os.getenv("AUTH_DB_PATH", "example.db")`. Trước đây file `example.db` nằm trong thư mục làm việc của container, nên sẽ mất toàn bộ tài khoản mỗi lần deploy lại. Dockerfile đặt `AUTH_DB_PATH=/data/auth.db` (trong volume).

Biến môi trường cho đăng nhập được truyền vào container qua `deploy/docker-compose*.yml`: `GMAIL_ADDRESS`, `GMAIL_APP_PASSWORD`, `AUTH_DEV_MODE`, `STREAM_TOKEN_SECRET`.

## 3. Backend

### `backend/main.py`

| Dòng | Thay đổi | Lý do |
|---|---|---|
| 3 | Bỏ `StaticFiles`, thêm `Response` | Snapshot giờ được phục vụ qua route riêng |
| 11 | `import storage` | |
| 55 | `allow_origins` đọc từ biến `CORS_ORIGINS` (mặc định giữ giá trị cũ) | Khi deploy, origin là tên miền thật |
| 64–67 | `MODEL_PATH` từ biến môi trường; gọi `storage.ensure_model()` trước khi tạo `FireDetector`, rồi `storage.start_sync()` | Model không có trong git, nên được tải từ MinIO khi khởi động; upload lại ảnh còn chờ |
| 73–80 | Route mới `GET /snapshots/{name}` thay cho `app.mount("/snapshots", StaticFiles(...))` | Ảnh có thể nằm trong MinIO chứ không chỉ trên ổ đĩa. URL giữ nguyên nên frontend không phải đổi |

### `backend/camera_manager.py`

| Dòng | Thay đổi |
|---|---|
| 11 | `import storage`; bỏ hằng `SNAPSHOT_DIR` và `os.makedirs` (đã chuyển sang `storage.py`) |
| 32 | Ảnh định kỳ (mỗi 10 giây một ảnh): `cv2.imwrite(...)` thay bằng `storage.save_snapshot(filename, img)` |
| 407 | Ảnh sự kiện cháy: `storage.save_snapshot(..., keep_local=True)`. Giữ bản trên ổ đĩa vì `notification.py` cần đính kèm file khi gửi Telegram |
| 428–434 | Gửi thông báo trong hàm `notify()`. Sau khi gửi xong, `storage.discard_local()` xoá bản tạm trên ổ đĩa |

### `backend/video_analyzer.py`

| Dòng | Thay đổi |
|---|---|
| 20 | `import storage`; bỏ `SNAPSHOT_DIR` |
| 105 | Khi dọn job cũ: `os.remove(...)` thay bằng `storage.delete_snapshot(...)`, xoá cả trong MinIO |
| 188 | Ảnh bằng chứng của video upload: `cv2.imwrite(...)` thay bằng `storage.save_snapshot(name, img)` |

Video upload vẫn lưu tạm ở `uploads_tmp/` trên ổ đĩa và bị xoá sau khi phân tích, nên không đưa vào MinIO.

### `backend/requirements.txt`

Thêm `minio` và `google-cloud-storage`.

## 4. Frontend

### `frontend/src/config.ts`

Thêm nhánh trong `getWsUrl()` (dòng 13–17): nếu `NEXT_PUBLIC_API_URL` là đường dẫn tương đối như `/api`, URL WebSocket được tạo từ tên miền trang đang mở (`ws://` hoặc `wss://`). Nhờ vậy một image frontend chạy được ở mọi tên miền, không phải build lại.

### `frontend/next.config.ts`

Thêm `output: "standalone"` để Next.js tạo server gọn cho Docker image.

## 5. Docker

| File | Nội dung |
|---|---|
| `backend/Dockerfile` | `python:3.12-slim` + thư viện OpenCV. Cài **PyTorch bản CPU** trước để không tải bản CUDA nhiều GB. Database ở `/data/fire_guard.db`, model ở `/data/models/best.pt`, ảnh chờ upload ở `/data/snapshots` |
| `frontend/Dockerfile` | Build 3 giai đoạn trên `node:22-bookworm-slim`. Mặc định `NEXT_PUBLIC_API_URL=/api`, đăng nhập thật (giả lập tắt), dữ liệu giả tắt. Chạy bằng user `node` |
| `*.dockerignore` | Loại `venv/`, `node_modules/`, `.env`, `*.pt`, `*.db` khỏi image |

## 6. Chạy local với MinIO

| File | Nội dung |
|---|---|
| `deploy/docker-compose.local.yml` | 5 service: `minio`, `minio-init`, `backend`, `frontend`, `caddy`. Cổng chỉ mở trên `127.0.0.1` |
| `deploy/minio-init.sh` | Chạy lại nhiều lần vẫn an toàn. Tạo bucket, tạo policy `fireguard-backend` chỉ cho phép dùng bucket này, tạo user cho backend, đặt quy tắc tự xoá `snapshots/periodic_*` sau 30 ngày, upload model nếu chưa có |
| `deploy/Caddyfile.local` | `/api/*` vào `backend:8000` (bỏ tiền tố `/api`), còn lại vào `frontend:3000` |
| `deploy/local.env.example` | Mẫu cho `~/.fireguard/local.env` |

Cấu trúc trong bucket `fireguard`:

```
models/best.pt
snapshots/event_<thời gian>_<camera>_<lớp>.jpg      # sự kiện cháy, giữ lâu dài
snapshots/periodic_<thời gian>_cam_<id>.jpg         # ảnh định kỳ, tự xoá sau 30 ngày
snapshots/video_<job>_<ms>_<lớp>.jpg                # bằng chứng từ video upload
```

## 7. CI/CD

### `.github/workflows/local-cd.yml`

Chạy trên self-hosted runner có label `fireguard`, khi push lên `main` hoặc chạy tay (không chạy cho PR):

1. `actions/checkout`
2. Kiểm tra có `~/.fireguard/local.env`
3. `docker compose build`
4. `docker compose up -d --remove-orphans`
5. Smoke test: gọi `/api/` và `/` tối đa 3 phút. Nếu lỗi thì in log `backend` và `minio-init`
6. `docker image prune -f`

### `.github/workflows/deploy.yml`

- **Job `build`** (mọi PR và push): build image backend và frontend trên máy của GitHub để bắt lỗi sớm.
- Chỉ khi có biến `GCP_PROJECT_ID`: push image lên Artifact Registry, rồi job `deploy` SSH qua IAP vào VM, chạy `docker compose pull && up -d` và smoke test. Xác thực bằng Workload Identity Federation, không dùng file khoá.

## 8. Google Cloud (tuỳ chọn, chưa triển khai)

| File | Nội dung |
|---|---|
| `deploy/gcp-setup.sh` | Script tạo hạ tầng theo từng bước (`apis`, `registry`, `bucket`, `vm`, `wif`, `model`, `env`, `outputs`). Chạy lại nhiều lần vẫn an toàn |
| `deploy/vm-startup.sh` | Cài Docker trên VM Debian 12, cấu hình đăng nhập Artifact Registry |
| `deploy/docker-compose.yml` | Stack trên VM: Caddy (HTTPS tự động) + backend + frontend, dùng GCS thay MinIO |
| `deploy/Caddyfile` | Giống bản local, có thêm HTTPS tự động. **Không** dùng `basic_auth` của Caddy, vì app đã tự đăng nhập bằng header `Authorization: Basic`; nếu bật ở proxy, hai bên sẽ tranh nhau cùng một header |

## Hạn chế còn lại

- **Chưa có đăng nhập Google/Facebook:** hai nút có trên giao diện nhưng bấm vào chỉ báo "chưa hỗ trợ". Cách chuẩn bị client ID/secret xem ở [HUONG_DAN_CAI_DAT.md](HUONG_DAN_CAI_DAT.md), Phần 1, mục 7.
- **Các trang dùng dữ liệu giả:** Nhật ký thao tác (`/audit-logs`) và Cấu hình kênh thông báo (`/notifications/*`) vẫn chưa có API ở backend.
- **Snapshot gửi qua Zalo** cần một URL công khai (`public_base_url`). `/snapshots/*` được để công khai cho việc này, nhưng bản local chỉ mở trên localhost, nên Zalo vẫn không tải được ảnh khi chạy local.
- **SQLite** (`fire_guard.db`, `auth.db`) vẫn nằm trong volume `backend_data`, chưa có sao lưu tự động.
