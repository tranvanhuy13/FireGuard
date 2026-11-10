# Kết quả đối chiếu master và phân nhánh — 09/11/2026

## Mốc đối chiếu

Đã fetch origin và kiểm tra `master = origin/master = b35a477`. So với mốc review `d1eca8e`, master thêm chỉnh giao diện lịch sử/HistoryModal/Button, chưa sửa các nguyên nhân R01–R14. Giữ nguyên chỉnh sửa ngoài phạm vi ở AGENTS.md và BUG-018_FIX_PLAN.md. Không push, merge vào master, deploy hay chạy migration trên dữ liệu thật.

## Các nhánh sửa lỗi

| Nhánh | Base | Phạm vi | Kiểm tra đã chạy riêng |
| --- | --- | --- | --- |
| `fix/review-camera-consistency` | master | R04: ghi DB thành công trước đổi RAM, tuần tự toggle/update/delete | 11 test camera đạt |
| `fix/review-schema-readiness` | master | R05, cải thiện 8: đối chiếu migration head, kiểm tra cột profile; metadata LONGTEXT khớp migration | 13 test schema/persistence đạt |
| `fix/review-frontend-recovery` | master | R11/R13/R14: ảnh MJPEG reconnect có giới hạn, không ẩn DOM; timeout gồm signal và body; phản hồi refresh đúng | TypeScript/lint đạt; 3 test client + 14 test connection đạt |
| `fix/review-api-security` | master | R01/R02/R12: HTTP/media/socket auth, token thống nhất; kiểm tra quyền mỗi 30 giây; chặn byte upload và giới hạn 2 upload đồng thời; CORS env | 19 test security/upload đạt; suite trước lần sửa test registration có 116 test đạt và 1 test cần chỉnh harness; cần kiểm tra tích hợp cuối |
| `fix/review-alert-history` | schema-readiness | R03/R06/R07/R08/R09/R10: endpoint status, migration 0003 camera event, tên bot/ảnh unique, phân trang/filter/export đầy đủ | 106 test backend đạt, 7 skip, 44 subtest đạt; TypeScript/lint đạt |
| `ci/review-quality-gates` | master | Cải thiện 2/3: test backend + TypeScript/lint/unit frontend là dependency của build/deploy trên cả 2 workflow deploy | Đối chiếu workflow, diff check; chưa chạy GitHub Actions |
| `refactor/review-followups` | master | Cải thiện 1/7/8: tài liệu hợp đồng, bỏ FPS/resolution giả, ConfigDict; kế hoạch rõ cho thay đổi kiến trúc | Xác minh ở nhánh tích hợp |

Nhánh lịch sử có thay đổi backend/frontend và migration cùng một contract để tránh UI/DB lệch phiên bản. Nó đã chứa commit schema-readiness; merge schema trước hoặc dùng schema làm base PR, sau đó retarget master khi schema đã merge. Các nhánh khác bắt đầu độc lập từ master. Những nhánh cùng sửa main.py/camera_manager.py có thể cần giải quyết conflict khi merge; nhánh tích hợp dùng để kiểm tra giao điểm đó, không thay thế các nhánh nhỏ.

## Hợp đồng sau khi kết hợp các nhánh

- Public: health, tài liệu API, đăng ký/OTP/reset password. Operational HTTP yêu cầu tài khoản verified/unblocked. Quyền user/admin theo tài liệu AUTHORIZATION.
- Feed/snapshot/socket dùng token do `auth.stream_tokens` tạo; đổi password vô hiệu token cũ. Kết nối dài kiểm tra lại khoảng 30 giây, không phải mỗi giây. Notification snapshot token vẫn giới hạn đúng tên file/thời hạn.
- Upload có giới hạn file 500 MiB trong handler, body tối đa 501 MiB gồm multipart; tối đa 2 body upload đang xử lý mỗi process; credential được kiểm tra trước multipart parse. Slot job và slot upload là hai giới hạn khác nhau.
- CORS_ORIGINS nhận danh sách origin cách nhau dấu phẩy; biến có giá trị sẽ thay thế default/regex development. Same-origin qua Caddy vẫn dùng `/api`.
- `PATCH /alerts/{id}/status` nhận `{status}` thuộc new/confirmed/false_alarm. Backend tự lấy người xử lý; không chấp nhận handler tự khai báo.
- `/history` nhận limit 1–500, offset >=0, search, event_type/status, sort/direction whitelist; trả events/total/max_id. Export lấy mọi trang phù hợp với cùng max_id để tránh insert mới đẩy lệch offset. Thay đổi trạng thái đồng thời vẫn có thể làm tập lọc thay đổi; đây chưa phải snapshot transaction cho export.
- Migration `0003_event_camera` thêm camera_id/camera_name nullable. Không tự suy ra camera của event cũ; UI hiển thị chưa xác định. Không thêm foreign key làm mất event khi xóa camera.
- Chạy `python -m alembic upgrade head` trong môi trường triển khai trước khi chạy phiên bản mới. Không được triển khai chỉ frontend lịch sử mới với backend cũ.

## Các điểm kiến trúc đã phân tích nhưng chưa triển khai

Những mục dưới đây là công việc còn lại, không đánh dấu hoàn thành chỉ vì đã có nhánh hoặc kế hoạch. Không đổi semantics dữ liệu/credential và không xóa bằng chứng bằng một bản sửa nhỏ thiếu bước chuyển đổi.

### Cải thiện 4 — Session và thu hồi credential

Nhánh dự kiến tiếp theo: `refactor/auth-sessions`. Tạo bảng session chỉ lưu hash token; cookie HttpOnly/Secure/SameSite, bảo vệ CSRF cho mutation, expiry/rotation, logout thu hồi server-side, đổi password/block thu hồi toàn bộ session. Duy trì HTTP Basic tương thích có thời hạn cho client hiện hữu rồi mới bỏ sessionStorage. Test cross-origin với deployment thực tế, tránh mặc định SameSite khiến Render frontend/backend không đăng nhập được. Hiện Basic credential vẫn nằm trong sessionStorage; chưa được sửa bởi các nhánh bugfix.

### Cải thiện 5 — Timestamp UTC có migration dữ liệu cũ

Nhánh dự kiến: `refactor/event-timestamps`. Chốt timezone của timestamp cũ theo nguồn triển khai, thêm trường UTC rõ ràng và backfill có dry-run, giữ bản gốc để đối soát; mọi API trả ISO 8601 có offset. Thống kê ngày theo timezone nghiệp vụ và test quanh 00:00/múi giờ/browser. Không tự gắn hậu tố Z cho dữ liệu cũ chưa biết timezone. Các nhánh hiện tại giữ nguyên timestamp cũ.

### Cải thiện 6 — Retention và outbox bền vững

Nhánh dự kiến: `refactor/notification-outbox-retention`. Outbox MySQL với idempotency key theo job/class/channel/recipient, retry có lease, khôi phục sau restart; không lặp kênh/recipient đã gửi thành công. Retention tách periodic/event/video evidence, preview/source upload; không xóa evidence được outbox tham chiếu. Có dry-run, quota/dung lượng, batch deletion và audit. Chưa thay hàng đợi RAM và chưa bật tự động xóa event/evidence.

### Phần còn lại của cải thiện 7/8

Nhánh dự kiến: `refactor/runtime-observability` cho tuổi frame/inference/queue/drop/storage, endpoint ops chỉ admin và không mở camera trong health probe. Đã bỏ thông số FPS/resolution ghi cứng, chưa có dashboard telemetry đầy đủ. Dọn any/ESLint toàn cục và dịch locale theo từng feature trong `refactor/frontend-api-types`; tránh đổi toàn UI cùng lúc. Deprecation TestClient/AnyIO cần nâng dependency sau khi có test tương thích riêng.

## Giới hạn xác minh

Chưa thử camera vật lý, độ chính xác model, MySQL migration thật, provider bot thật hoặc deployment. Aikido MCP không khả dụng trong phiên, nên chưa có kết quả SAST từ Aikido; không tuyên bố mã đã được dịch vụ này xác nhận an toàn. Không gửi dữ liệu nguồn tới dịch vụ thay thế. Các kết quả tích hợp/browser cuối cùng được ghi ở phần cập nhật bàn giao.
