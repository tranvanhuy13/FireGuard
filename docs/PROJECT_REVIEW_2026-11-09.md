# Review tổng thể FireGuard — 09/11/2026

> Cập nhật: đã đối chiếu master và tách nhánh sửa; xem [kết quả và kế hoạch refactor](REVIEW_REFACTOR_PLAN.md). Các phát hiện dưới đây giữ nguyên làm mốc trước khi sửa.

## 1. Phạm vi và cách đọc

Review checkout tại commit `d1eca8e`, đối chiếu cấu trúc toàn dự án và các luồng backend FastAPI, frontend Next.js, xác thực/OTP/RBAC, camera/inference, video upload, lưu trữ, thông báo, MySQL/migration, Docker/CI và kiểm thử. Tập trung đọc mã thực thi, hợp đồng giữa frontend/backend và các đường lỗi. Không sửa mã ứng dụng trong đợt review này.

Không đọc nội dung bí mật trong `.env`, dữ liệu người dùng trong database/backup, hoặc giải mã trọng số/video. Không chạy ứng dụng production, camera thật, migration trên database thật hoặc gửi thông báo. Đây là một lượt review có giới hạn, không phải chứng nhận toàn bộ dự án không còn lỗi.

Các thay đổi có trước được giữ nguyên: `AGENTS.md`, `docs/BUG-018_FIX_PLAN.md`, `backend/uploads_tmp/`. Kế hoạch BUG-018 chưa được commit được dùng để đối chiếu bối cảnh, không coi là bằng chứng tính năng đã hoàn tất.

**Kết quả: 14 phát hiện — 5 P1, 8 P2, 1 P3; thêm 8 điểm cần cải thiện.** Không gán P0 do chưa xác minh mức phơi lộ của bản triển khai thực tế. Một số route public được ghi rõ là chủ ý trong `main.py`; vẫn xếp rủi ro P1 theo chức năng hệ thống giám sát và chính sách bảo vệ được tài liệu mô tả, không khẳng định đó là thay đổi ngoài ý muốn.

| Mức | Ý nghĩa |
| --- | --- |
| P0 | Sự cố khẩn cấp đã xác minh, cần xử lý ngay |
| P1 | Rủi ro lớn hoặc hỏng luồng nghiệp vụ chính; ưu tiên đợt sửa gần nhất |
| P2 | Lỗi chức năng/dữ liệu/độ ổn định có điều kiện tái hiện cụ thể |
| P3 | Lỗi phản hồi giao diện hoặc chi tiết chất lượng |

“Xác nhận tĩnh” nghĩa là đã đối chiếu trực tiếp mã nguồn và đường gọi; không đồng nghĩa đã tái hiện bằng trình duyệt, phần cứng hoặc môi trường triển khai.

## 2. Danh sách theo ưu tiên

| ID | Mức | Phát hiện | Bằng chứng |
| --- | --- | --- | --- |
| R01 | P1 | API vận hành và media cho phép truy cập không đăng nhập | Xác nhận tĩnh |
| R02 | P1 | Giới hạn upload áp dụng sau khi multipart đã được parse/spool | Xác nhận tĩnh |
| R03 | P1 | Hai giao diện xử lý cảnh báo gọi endpoint không tồn tại | Xác nhận tĩnh |
| R04 | P1 | Toggle/xóa camera thay đổi RAM trước khi DB thành công | Xác nhận tĩnh |
| R05 | P1 | Readiness chấp nhận schema cũ thiếu cột profile | Xác nhận tĩnh |
| R06 | P2 | Event không lưu camera nguồn, lịch sử thiếu định danh camera | Xác nhận tĩnh |
| R07 | P2 | Thông báo camera không truyền tên camera | Xác nhận tĩnh |
| R08 | P2 | Lịch sử và CSV chỉ dùng 50 bản ghi đầu tiên | Xác nhận tĩnh |
| R09 | P2 | Lọc lịch sử không đưa trang hiện tại về phạm vi hợp lệ | Xác nhận tĩnh |
| R10 | P2 | Snapshot sự kiện có thể trùng tên khi cooldown dưới một giây | Xác nhận tĩnh |
| R11 | P2 | Ảnh CameraGrid có thể bị ẩn vĩnh viễn sau lỗi | Xác nhận tĩnh; chưa thử trình duyệt |
| R12 | P2 | Cấu hình CORS_ORIGINS trong deployment không được sử dụng | Xác nhận tĩnh |
| R13 | P2 | apiClient mất timeout khi caller truyền AbortSignal | Xác nhận tĩnh |
| R14 | P3 | Nút làm mới token báo thành công khi refresh trả null | Xác nhận tĩnh |

## 3. Chi tiết phát hiện

### R01 — P1 — Các route vận hành/media không yêu cầu xác thực

- **Vị trí:** `backend/main.py:157`, `:286`, `:314`, `:329`, `:336`, `:351`, `:362`, `:402`, `:444`, `:454`, `:483`, `:497`, `:518`, `:591`; đối chiếu `backend/app/auth/stream_tokens.py` và `docs/system/ARCHITECTURE.md`.
- **Hiện trạng:** không có dependency xác thực toàn app; các route camera, lịch sử, video/job và WebSocket nêu trên không gắn kiểm tra user/token. Feed và alerts socket nhận token nhưng bỏ qua. Module xác minh token có tồn tại nhưng không được nối vào các route này; `main.py` còn có một hàm tạo token riêng với cách ký khác.
- **Tác động:** khi backend có thể truy cập từ ngoài, người chưa đăng nhập có thể xem dữ liệu/ảnh, bật tắt hoặc xóa camera, tạo và điều khiển job. Trạng thái blocked/password change không bảo vệ các luồng public. Caddy production chỉ reverse proxy, không bổ sung lớp xác thực.
- **Kiểm chứng đề xuất:** trên app thử nghiệm có dependency dịch vụ giả, gửi request không Authorization tới camera mutations, lịch sử, upload và mở socket không token. Không thử xóa camera trên môi trường thật.
- **Hướng sửa:** thống nhất chính sách public/private trước; với chính sách được tài liệu mô tả, gắn kiểm tra verified/unblocked cho HTTP và bộ token thống nhất cho media/socket, kiểm tra lại quyền trên kết nối dài. Thêm test kiểm tra dependency thực sự được đăng ký. Nếu public là yêu cầu chính thức, phải cập nhật tài liệu và công bố rõ giới hạn triển khai.

### R02 — P1 — Chặn kích thước upload quá muộn

- **Vị trí:** `backend/main.py:362–397`; `backend/app/auth/upload.py`.
- **Hiện trạng:** `UploadFile = File(...)` được FastAPI parse trước khi vào handler. Bộ đếm 500 MB chỉ chạy khi đọc lại `file.file` để ghi file ứng dụng. `AuthenticatedUploadRoute` đã có sẵn nhưng route thực tế không sử dụng.
- **Tác động:** body lớn hoặc nhiều upload đồng thời có thể chiếm tài nguyên spool/temp trước khi bị trả 413. Giới hạn 20 job chỉ áp dụng khi submit, sau bước đọc/ghi upload. R01 làm tăng khả năng bị lạm dụng nhưng lỗi giới hạn body vẫn còn ngay cả sau khi thêm đăng nhập.
- **Hướng sửa:** xác thực trước parse, giới hạn body tại proxy/ASGI có đếm byte thực nhận, hạn chế upload đồng thời và dọn tài nguyên khi client ngắt. Không chỉ tin `Content-Length`. Kiểm tra body vượt giới hạn bị dừng trước khi ghi toàn bộ.

### R03 — P1 — Xác nhận/báo nhầm cảnh báo không hoạt động

- **Vị trí:** `frontend/src/components/AlertPanel.tsx` gọi `PATCH /alerts/{id}/status`; `frontend/src/app/dashboard/history/page.tsx:79` gọi `PUT /alerts/{id}`; `backend/main.py` chỉ khai báo GET `/alerts`.
- **Tác động:** cả hai nút xử lý cảnh báo đều không cập nhật DB; HTTP 404 bị bỏ qua gần như im lặng. `database.update_event_status` có tồn tại nhưng không có route gọi tới.
- **Hướng sửa:** thống nhất một endpoint có xác thực và validation trạng thái; lấy người xử lý từ user backend, không từ trường `handler` do client cung cấp. Đồng bộ cả hai giao diện, hiển thị lỗi HTTP và thêm kiểm tra lưu/reload.

### R04 — P1 — DB lỗi khiến trạng thái camera bị lệch

- **Vị trí:** `backend/app/cameras/manager.py:384–412`.
- **Điều kiện:** MySQL lỗi trong `set_db_camera_status` hoặc `delete_db_camera`.
- **Hiện trạng:** toggle gọi `cam.set_active` trước ghi DB; remove `pop` và dừng camera trước xóa DB. Không có khôi phục khi ghi thất bại.
- **Tác động:** request báo lỗi nhưng camera thật đã tắt/bật hoặc biến mất khỏi RAM; sau restart, cấu hình cũ trong DB có thể làm camera xuất hiện/chạy trở lại. Đặc biệt đáng chú ý với thao tác tắt giám sát.
- **Hướng sửa:** thiết kế cập nhật có khóa và bù trạng thái khi thất bại; đảm bảo thao tác thành công mới công bố trạng thái nhất quán. Kiểm thử bằng fake repository ném lỗi ở bước ghi/xóa, sau đó kiểm tra RAM, DB giả và lần retry.

### R05 — P1 — Schema cũ vẫn được báo sẵn sàng

- **Vị trí:** `backend/app/db/engine.py:132–142`; `backend/migrations/versions/0001_initial_mysql.py`, `0002_user_profile.py`; `backend/app/users/routes.py`.
- **Hiện trạng:** `check_database` chấp nhận cả `0001_mysql` và `0002_user_profile`, chỉ thử `SELECT 1` từ bảng. Trong khi `/users/me` truy cập trực tiếp các cột profile và route cập nhật ghi `full_name`, `phone`, `avatar_url`, vốn chỉ được thêm ở 0002.
- **Tác động:** database ở revision 0001 có thể vượt readiness; đọc profile trả rỗng qua default dataclass, nhưng lưu profile sẽ lỗi SQL do thiếu cột. Người vận hành nhận tín hiệu readiness sai cho phiên bản ứng dụng hiện tại.
- **Hướng sửa:** yêu cầu revision tương thích có đủ cột, lý tưởng đối chiếu head migration thay vì danh sách revision cũ. Kiểm thử bằng schema 0001 trong database dùng một lần; readiness phải từ chối trước khi phục vụ.

### R06 — P2 — Lịch sử mất định danh camera nguồn

- **Vị trí:** `backend/app/db/repositories/operations.py:28–33`; `backend/app/db/schema.py:16–19`; `backend/app/cameras/manager.py:554–578`; `frontend/src/app/dashboard/history/page.tsx:57`, `:160`, `:192`.
- **Hiện trạng:** bảng event và `add_event` không lưu `camera_id`/`camera_name`. Realtime payload có tên nhưng truy vấn lịch sử không có. UI vẫn dùng `camera_id` để hiển thị, tìm kiếm, sắp xếp và xuất CSV.
- **Tác động:** xuất hiện `Cam undefined`, mất khả năng truy nguồn sau reload; CSV không có camera. Nhiều camera khó phân biệt sự kiện.
- **Hướng sửa:** migration thêm định danh và tên chụp tại thời điểm xảy ra; truyền từ camera tới repository và API. Với dữ liệu cũ, hiển thị “không xác định” thay vì tự suy đoán.

### R07 — P2 — Bot không nhận tên camera

- **Vị trí:** `backend/app/cameras/manager.py:582–584`; `backend/app/notifications/service.py:260–270`.
- **Hiện trạng:** `trigger_notifications` có tham số `camera_name`, nhưng caller camera chỉ truyền loại, confidence, ảnh. Do đó body không có Source/Camera như tài liệu kiến trúc mô tả.
- **Tác động:** người nhận biết có cháy/khói nhưng không biết camera nào, đặc biệt khi có nhiều nguồn.
- **Hướng sửa:** chụp tên camera cùng event và truyền rõ vào notification; tránh đọc tên mutable quá muộn. Test body của hai kênh bằng sender giả.

### R08 — P2 — Phân trang lịch sử chỉ chạy trên 50 bản ghi

- **Vị trí:** `frontend/src/app/dashboard/history/page.tsx:31–44`, `:51–74`; `backend/main.py:518–521`.
- **Hiện trạng:** frontend gọi `/history` không limit/offset; backend mặc định 50. Frontend tiếp tục phân trang/lọc/xuất CSV trên mảng 50 dòng này, không tải các trang server.
- **Tác động:** bản ghi từ thứ 51 trở đi không thể xem hoặc tìm thấy; file “history_export.csv” không phản ánh toàn bộ lịch sử, không báo đang bị giới hạn.
- **Hướng sửa:** phân trang/filter ở server cùng tổng số bản ghi; xuất CSV qua cơ chế lấy đủ dữ liệu hoặc ghi rõ phạm vi xuất. Test dữ liệu trên 50 dòng và tìm một event cũ.

### R09 — P2 — Trang lịch sử trống sau lọc

- **Vị trí:** `frontend/src/app/dashboard/history/page.tsx:21–25`, `:93–109`, `:174–177`.
- **Điều kiện:** đang ở trang 4/5 rồi lọc còn một trang.
- **Hiện trạng:** không reset/clamp `currentPage` khi search/type/status hoặc dữ liệu đổi; slice vẫn dùng trang cũ. Khi không có kết quả, `totalPages=0`; Next có thể đưa trang về 0 vì chỉ kiểm tra equality.
- **Tác động:** bảng trống dù có kết quả phù hợp; hiển thị phân trang bất hợp lệ.
- **Hướng sửa:** reset trang khi bộ lọc đổi, giới hạn trang theo tổng mới, quy định trạng thái rỗng và disable Next bằng so sánh phạm vi.

### R10 — P2 — Ảnh nhiều event có thể ghi đè nhau

- **Vị trí:** `backend/app/cameras/manager.py:554–556`; giới hạn cooldown tại `backend/main.py:558–565`.
- **Điều kiện:** cooldown hợp lệ bằng 0 hoặc nhỏ hơn 1 giây; cùng camera/class tạo nhiều event trong một giây.
- **Hiện trạng:** tên ảnh chỉ có timestamp chính xác tới giây + camera + class.
- **Tác động:** nhiều event DB trỏ vào cùng ảnh bị ghi đè; ảnh được bot đính kèm có thể thuộc event khác.
- **Hướng sửa:** dùng UUID hoặc event identity duy nhất; kiểm tra hai event cùng giây vẫn giữ hai bằng chứng riêng. Không khắc phục bằng cách tăng cooldown vì 0 đang là cấu hình được API chấp nhận.

### R11 — P2 — CameraGrid không phục hồi thẻ ảnh đã bị ẩn

- **Vị trí:** `frontend/src/components/CameraGrid.tsx:411–418`; `backend/main.py:88–90`.
- **Hiện trạng:** `onError` gán `style.display='none'`, gọi refresh token; không có nhánh reset display/onLoad. React key chỉ là token. Token cấp cho cùng username trong cùng một giây có thể giống nhau.
- **Tác động:** nếu refresh lỗi hoặc trả lại cùng token, không có remount hay URL mới; ảnh có thể tiếp tục bị ẩn sau khi mạng hồi phục. Đây không phải bằng chứng server từ chối token hết hạn: backend hiện bỏ qua token ở feed.
- **Hướng sửa:** biểu diễn lỗi bằng state có thể phục hồi, có mã lần kết nối độc lập với token và retry có kiểm soát. Browser test lỗi ảnh → refresh trả cùng token/timeout → phục hồi.

### R12 — P2 — Biến cấu hình CORS bị bỏ qua

- **Vị trí:** `backend/main.py:117–130`; `deploy/docker-compose.yml` truyền `CORS_ORIGINS=https://${DOMAIN}`.
- **Hiện trạng:** middleware dùng danh sách origin hardcode, không đọc biến này.
- **Tác động:** frontend gọi backend khác origin từ domain mới vẫn bị chặn dù đã cấu hình đúng biến. Triển khai same-origin qua `/api` không chịu lỗi này; không kết luận mọi deployment đều hỏng.
- **Hướng sửa:** parse và validate allowlist từ env; đặt default development riêng. Test preflight cho origin được phép và bị từ chối.

### R13 — P2 — Timeout apiClient không hủy request có signal riêng

- **Vị trí:** `frontend/src/lib/api/client.ts:157–168`, `:194`.
- **Hiện trạng:** timer abort controller nội bộ, nhưng fetch chọn `customConfig.signal` khi caller truyền signal. Controller nội bộ không còn nối với request. Timer cũng bị xóa ngay khi nhận headers, trước khi JSON body đọc xong.
- **Tác động:** caller dùng signal để hủy khi unmount có thể vô tình mất timeout; response body treo cũng có thể chờ không giới hạn theo timeout đã khai báo. Không khẳng định dashboard hiện mắc lỗi này: dashboard có cơ chế transport riêng.
- **Hướng sửa:** kết hợp signal của caller và timeout; giữ timeout tới khi đọc body xong và dọn listener/timer trong finally. Test server giả không trả hoặc không kết thúc body.

### R14 — P3 — Làm mới token thất bại nhưng báo thành công

- **Vị trí:** `frontend/src/app/dashboard/profile/page.tsx:240–245`; `frontend/src/context/AuthContext.tsx`, hàm `refreshStreamToken`.
- **Hiện trạng:** context bắt lỗi và resolve `null`; handler profile chỉ await rồi đặt thông báo thành công. Nhánh catch không chạy với thất bại đã được context xử lý.
- **Hướng sửa:** kiểm tra token trả về trước khi báo thành công; phân biệt mất phiên với lỗi tạm thời. Test response 401, timeout và thành công.

## 4. Tám điểm cần cải thiện

1. **Đồng bộ tài liệu với code.** `docs/system/ARCHITECTURE.md` và tài liệu authorization mô tả operational auth/media protection và tên camera trong bot, khác R01/R07. BUG-018 còn mô tả thiếu listener/hạn token trong khi AuthContext hiện đã có một phần. Ghi trạng thái hoàn thành theo bằng chứng, không sao chép kế hoạch thành hiện trạng.
2. **Bổ sung kiểm tra hợp đồng API trong CI.** Kiểm tra sự tồn tại của endpoint mà UI sử dụng, method/payload/response và việc gắn dependency thực tế. Các test AST và mock hiện có hữu ích nhưng không bảo đảm toàn bộ app registration đúng; R03 cho thấy khoảng trống này.
3. **Ràng buộc deploy vào kết quả kiểm thử.** Workflow deploy chỉ `needs: build`; backend offline tests nằm ở workflow khác. Build Docker đạt không bảo đảm suite đã đạt trước rollout. Thêm TypeScript, test kết nối và test hợp đồng vào chuỗi kiểm tra cần thiết.
4. **Đánh giá lại lưu Basic credential trong sessionStorage.** Giá trị Basic là thông tin username/password mã hóa Base64, JavaScript có thể đọc. Cân nhắc session HttpOnly và cơ chế thu hồi/expiry phù hợp nếu hướng tới production; đây là giới hạn thiết kế, không phải bằng chứng đã có XSS.
5. **Chuẩn hóa timestamp có timezone.** Event dùng giờ máy dạng chuỗi không timezone, cutoff stats dùng UTC, frontend parse `Date`. Cần quy ước UTC/ISO 8601 và chỉ đổi timezone khi hiển thị; kiểm thử quanh nửa đêm. Chưa chạy đối chiếu trên máy chủ thực tế.
6. **Quy định lưu giữ và phục hồi dữ liệu.** Video job/queue notification trong RAM mất khi restart; evidence đã gửi được giữ lâu dài, còn retention tự động chủ yếu xử lý periodic snapshot. Xác định TTL, quota, lịch dọn và nhu cầu outbox bền vững; không xóa bằng chứng chưa có chính sách.
7. **Quan sát sức khỏe giám sát thực tế.** Readiness hiện tập trung DB; bổ sung số camera có frame mới, tuổi frame, lỗi inference, queue/drop, thời gian bot và dung lượng đĩa. UI `VideoFeed` đang ghi cứng “FPS: 30 | RES: 1080p”, không phải số đo thật.
8. **Dọn nợ kỹ thuật có trọng tâm.** Có nhiều file tắt ESLint toàn cục, `any` và text chưa đi qua locale; metadata schema profile dùng `Text` trong khi migration avatar dùng `LONGTEXT`. Đồng bộ schema và kiểu API, xử lý cảnh báo phù hợp; ảnh MJPEG/preview dùng `<img>` có thể hợp lý, không thay máy móc bằng `next/image` chỉ để hết warning.

## 5. Kiểm tra thực hiện

| Kiểm tra | Kết quả |
| --- | --- |
| Backend: `venv/Scripts/python.exe -m pytest tests/ -q -rs` | **100 passed, 7 skipped, 44 subtests passed**, 4 cảnh báo; 18,25 giây ở lần chạy ngoài sandbox |
| Frontend: `node_modules/.bin/tsc.cmd --noEmit --incremental false` | Đạt, không có lỗi TypeScript |
| Frontend: `npm run test:connection` | **14/14 đạt** |
| Frontend: `npm run lint` | Exit 0; **0 lỗi, 6 warnings**: 3 cảnh báo `<img>` ở VideoAnalysisModal, 3 import không dùng trong test |
| Tài liệu và working tree | Đã kiểm tra các đường dẫn nguồn được dẫn chiếu, số mục ưu tiên và `git diff --check`; chỉ thêm file review |

Bảy test backend được skip gồm 3 module integration app và 4 test MySQL concurrency theo cấu hình mặc định. Bốn cảnh báo backend liên quan deprecation TestClient/httpx, AnyIO và Pydantic class Config; không phải test failure. Các lần thử trong sandbox đã bị dừng do TestClient treo ở `asyncio`/`socketpair` nội bộ Windows; stack dump xác định điểm chờ. Chạy lại ngoài sandbox đã hoàn tất toàn bộ suite. Không tính các lần bị dừng là test đạt hoặc lỗi ứng dụng.

Không chạy production build, browser E2E, MySQL integration, model accuracy hoặc kiểm tra camera vật lý trong lượt này. Chưa thực hiện audit CVE/dependency qua dịch vụ ngoài; báo cáo này không kết luận dependency không có lỗ hổng. Suite hiện có đạt không bác bỏ các phát hiện tĩnh bên trên vì nhiều contract/đường lỗi chưa được suite bao phủ.

## 6. Thứ tự xử lý đề xuất

1. Chốt chính sách xác thực và khắc phục R01/R02; thống nhất endpoint xử lý cảnh báo R03.
2. Sửa tính nhất quán camera/DB và readiness R04/R05; bổ sung regression cho tình huống DB lỗi và schema cũ.
3. Hoàn thiện dữ liệu event và thông báo R06/R07/R10; đồng bộ contract lịch sử.
4. Sửa phân trang/phục hồi camera/CORS/timeout R08/R09/R11/R12/R13 và phản hồi token R14.
5. Tích hợp kiểm tra hợp đồng và test vào điều kiện deploy, rồi kiểm chứng trên staging với video có nhãn và camera thật.

Mỗi mục chỉ đóng khi có kiểm chứng đúng tầng: test tĩnh/unit không thay thế browser, MySQL thực hoặc độ chính xác phát hiện cháy/khói trên dữ liệu có nhãn.
