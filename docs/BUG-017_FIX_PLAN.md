# BUG-017: Kế hoạch sửa cơ chế chạy kiểm thử

Trạng thái: đã sửa test harness trên nhánh `fix/bug-017-test-harness`; kiểm thử offline đạt, chưa chạy tích hợp với MySQL thật.

## Vấn đề đã xác minh

Nguồn: `test_3110_bug.xlsx`, `Sheet1!A18:K18`. BUG-017 có mức độ nghiêm trọng và độ ưu tiên trung bình.

`backend/tests/conftest.py` hiện nạp `.env.local` và `.env`, sau đó gọi `pytest.exit(..., returncode=4)` ngay khi thiếu `FIREGUARD_TEST_MYSQL=1` hoặc tên `MYSQL_DATABASE` không kết thúc bằng `_test`. Điều này chặn toàn bộ collection, kể cả kiểm thử ngoại tuyến không cần MySQL.

Hai fixture `autouse=True` trong cùng tệp áp dụng cho toàn thư mục. Đặc biệt, `setup_test_user` xóa và tạo lại tài khoản kiểm thử trước/sau mỗi bài test. Vì vậy, chỉ bỏ `pytest.exit` hoặc chuyển nó thành cảnh báo sẽ không giải quyết an toàn vấn đề.

Ba module import `main` ngay khi collection, có thể khởi động dịch vụ:

- `backend/tests/test_all_apis.py`
- `backend/tests/test_health_and_auth.py`
- `backend/tests/test_notifications.py`

`test_mysql_concurrency.py` là bộ unittest dùng MySQL thật có điều kiện riêng; cần giữ cả cờ bật và kiểm tra hậu tố `_test`. `test_mysql_persistence.py` dùng SQLite tạm cho kiểm thử ngoại tuyến có chủ đích, không phải cơ chế thay MySQL của ứng dụng.

Workflow `.github/workflows/deploy.yml` hiện xây dựng Docker image; chưa thấy bước chạy pytest trong tệp này. Do đó, đây là lỗi của trải nghiệm chạy test và khả năng tích hợp CI; chưa có bằng chứng workflow hiện tại thất bại do exit 4.

## Phương án đề xuất

Mặc định chạy được kiểm thử ngoại tuyến mà không cần thông tin MySQL. Kiểm thử tích hợp phải được bật rõ ràng và vẫn từ chối cấu hình có nguy cơ chạm dữ liệu thông thường. Không tự động chuyển ứng dụng sang SQLite, không tự thêm hậu tố `_test`, không tự đặt cờ bật trong môi trường phát triển.

Giữ các tệp test tại đường dẫn hiện có để giảm thay đổi import, đường dẫn fixture và tài liệu. Tách trách nhiệm cấu hình thay vì di chuyển hàng loạt module.

### 1. Thu hẹp phạm vi fixture

- Giữ `backend/tests/conftest.py` chỉ làm cấu hình chung an toàn và đăng ký chế độ tích hợp.
- Tách fixture gửi OTP giả lập và chuẩn bị tài khoản sang plugin riêng, ví dụ `backend/tests/integration_fixtures.py`.
- Chỉ đăng ký plugin khi người dùng chủ động bật chế độ tích hợp và vượt qua kiểm tra cấu hình.
- Fixture chuẩn bị tài khoản phải kiểm tra thêm marker `integration` trước khi kết nối DB, để test ngoại tuyến không bị ghi dữ liệu ngay cả khi chạy cùng phiên tích hợp.
- Kiểm tra quyền sở hữu dữ liệu fixture và cách dọn dẹp; không mở rộng việc xóa dữ liệu ngoài tài khoản kiểm thử hiện có.

### 2. Chặn import trước khi thu thập kiểm thử tích hợp

- Thêm tùy chọn pytest `--integration` trong conftest chung. Đây là tín hiệu chủ động chạy bộ tích hợp, không thay thế hai điều kiện môi trường.
- Ở đầu ba module import `main`, trước mọi import ứng dụng hoặc thay đổi thư mục làm việc, kiểm tra tùy chọn này. Nếu chưa bật, dùng `pytest.skip(..., allow_module_level=True)` với thông báo cách bật.
- Gắn `pytestmark = pytest.mark.integration` cho ba module và đăng ký marker trong `backend/pytest.ini`.
- Khi có `--integration`, xác thực `FIREGUARD_TEST_MYSQL=1` và `MYSQL_DATABASE` kết thúc bằng `_test` ngay trong giai đoạn cấu hình, trước khi import ứng dụng hoặc đăng ký fixture có tác dụng phụ. Cấu hình sai phải báo lỗi rõ ràng, không âm thầm bỏ qua.
- Không chỉ dùng `@pytest.mark.skipif` hoặc `-m 'not integration'`: các cơ chế này không đủ bảo vệ nếu module đã import `main` trong collection.
- Module MySQL concurrency vẫn giữ điều kiện riêng; khi có cờ bật nhưng tên DB không an toàn, phải thất bại trước kết nối.

Ưu tiên module-level skip để cả lệnh thu thập toàn thư mục và chỉ định trực tiếp từng tệp tích hợp đều có kết quả rõ ràng. Cơ chế này cần được kiểm chứng với phiên bản pytest cài trong môi trường thực hiện.

### 3. Làm rõ môi trường kiểm thử

- Mặc định không nạp `.env.local` hoặc `.env` từ conftest chỉ để quyết định bật tích hợp. Cờ chủ động phải đến từ môi trường/lệnh của người chạy.
- Chỉ nạp cấu hình tích hợp sau khi có yêu cầu rõ ràng; biến môi trường được truyền trực tiếp vẫn ưu tiên cao hơn tệp cấu hình.
- Kiểm thử môi trường có `.env.local` phát triển: không tự kết nối DB khi chạy ngoại tuyến. Các module ứng dụng có thể tự nạp dotenv; cần kiểm chứng đường import thực tế thay vì chỉ sửa conftest.
- Liệt kê dependency kiểm thử riêng, gồm pytest, pytest-asyncio, thư viện HTTP/test client và các dependency mà bộ offline thực sự import. Không thay phiên bản thư viện ngoài phạm vi nếu chưa có lỗi tương thích được chứng minh.

### 4. Kiểm thử hồi quy cho chính test harness

Thêm `backend/tests/test_test_harness.py`. Chạy pytest trong tiến trình con có timeout và môi trường được kiểm soát, không kế thừa thông tin DB thật. Chỉ chạy các test con an toàn được chỉ định; không để test harness gọi lại chính nó vô hạn.

| Tình huống | Kết quả cần đạt |
| --- | --- |
| Không cờ, không cấu hình DB | Offline chạy; ba module tích hợp được skip trước import `main` |
| Chỉ định trực tiếp tệp tích hợp, không `--integration` | Skip có thông báo; không import ứng dụng |
| Có biến MySQL phát triển nhưng không `--integration` | Offline không truy cập DB hoặc chạy fixture tạo tài khoản |
| Có `--integration` nhưng thiếu cờ môi trường | Lỗi cấu hình rõ ràng trước import/kết nối |
| Có `--integration`, cờ bật, DB không kết thúc `_test` | Lỗi cấu hình trước import/kết nối |
| Đủ điều kiện nhưng chưa có DB thật | Kiểm tra định tuyến/plugin bằng module giả trong harness, không import `main` thật |
| Test ngoại tuyến cố ý thất bại | Exit code thất bại được giữ, không bị biến thành thành công |

Dùng sentinel để phát hiện import `main`, gọi `get_connection` hoặc tải plugin sai chế độ. Không chỉ kiểm tra mã thoát 0 vì phiên không chạy bài test nào có thể tạo cảm giác thành công giả.

Kiểm tra thêm ảnh hưởng khi nhiều bộ unittest chạy chung tiến trình: các bộ offline có thể giả lập module hoặc thay đổi trạng thái toàn cục. Nếu có xung đột, sửa việc dọn dẹp ở đúng test gây ra hoặc chạy các nhóm độc lập trong tiến trình riêng; không bỏ qua lỗi để CI xanh.

### 5. Cập nhật CI và tài liệu

- Bổ sung job kiểm thử offline riêng, không sửa logic triển khai hiện có. Chạy trên PR và các nhánh mục tiêu thực tế (`master` hiện là đích PR; các workflow triển khai đang dùng `main`, không tự đổi nhánh triển khai).
- Job offline không nhận secret DB/provider, không khởi động MySQL, không tải model hoặc mở camera. Cài dependency theo các import thực tế; kiểm chứng bộ test chạy được trên runner sạch.
- Bộ tích hợp chạy riêng theo yêu cầu, dùng DB MySQL tạm đã migration, thông báo ra ngoài bị vô hiệu hóa và model/storage kiểm thử đã chuẩn bị. Đưa vào giai đoạn sau nếu chưa có đủ hạ tầng; không dùng DB phát triển để hoàn tất công việc này.
- Cập nhật `docs/system/TESTING.md`: lệnh mặc định, lệnh tích hợp, điều kiện môi trường, danh sách skip và tác dụng phụ.

Lệnh dự kiến sau khi triển khai, từ thư mục `backend/`:

```powershell
# Mặc định: offline; các module tích hợp được skip.
.\venv\Scripts\python.exe -m pytest tests/ -q

# Chỉ xem collection an toàn, chưa bật tích hợp.
.\venv\Scripts\python.exe -m pytest tests/ --collect-only -q

# Chỉ thực hiện trên môi trường kiểm thử biệt lập đã chuẩn bị đầy đủ.
$env:FIREGUARD_TEST_MYSQL = '1'
$env:MYSQL_DATABASE = 'fireguard_test'
.\venv\Scripts\python.exe -m pytest tests/ --integration -m integration -q
```

Lệnh tích hợp còn cần các biến kết nối, TLS, migration và cấu hình dịch vụ kiểm thử khác; hai dòng môi trường trên không đủ tự tạo môi trường đó. Kiểm thử MySQL concurrency tiếp tục theo quy trình riêng trong tài liệu migration.

## Tiêu chí nghiệm thu

- Pytest mặc định không còn exit 4 chỉ vì thiếu cấu hình MySQL; thực sự thu thập và chạy offline tests.
- Tích hợp chưa bật được skip rõ ràng trước import ứng dụng, kể cả khi chỉ định trực tiếp tệp.
- Chủ động bật tích hợp với cấu hình không an toàn vẫn thất bại sớm.
- Fixture tích hợp không tác động tới offline tests và không kết nối DB ở chế độ mặc định.
- Không có cơ chế runtime fallback sang SQLite hoặc tự thay tên DB.
- Test harness hồi quy đạt, CI offline chạy trên runner sạch, các lỗi test thực tế vẫn làm job thất bại.
- Ghi riêng kết quả offline, kết quả tích hợp và phần chưa xác minh; không tuyên bố toàn bộ integration đạt khi chỉ chạy offline.

## Phạm vi và trạng thái

Đã tạo nhánh `fix/bug-017-test-harness` từ `origin/master` sau khi fetch. Các thay đổi:

- Conftest mặc định không nạp dotenv để bật tích hợp và không đăng ký fixture ghi DB.
- Ba module tích hợp được skip trước import `main`; chỉ bật bằng `--integration` cùng hai điều kiện môi trường an toàn.
- Fixture tách sang `integration_fixtures.py`, chỉ áp dụng cho marker `integration`.
- Bộ MySQL concurrency được skip trong pytest mặc định, kể cả khi còn biến môi trường opt-in từ lần chạy trước. Luồng unittest độc lập giữ điều kiện riêng.
- Thêm 7 bài kiểm thử harness bằng tiến trình con, có sentinel phát hiện import ứng dụng/truy cập DB ngoài ý muốn.
- Thêm dependency test riêng và workflow offline trên PR/push tới master hoặc main, không thay đổi workflow triển khai.
- Cô lập biến `ZALO_BOT_TOKEN` trong bài kiểm thử redaction có sẵn: giá trị từ môi trường máy trước đây lấn át dữ liệu giả và gây lỗi. Không thay đổi logic ứng dụng.

Kết quả kiểm tra ngày 03/11/2026:

- Môi trường ảo sạch Python 3.12, chỉ cài `backend/requirements-test.txt`: **87 passed, 7 skipped**, cùng **40 subtests passed**, trong khoảng 45 giây.
- 7 skip gồm 3 module ứng dụng và 4 bài MySQL concurrency, đều đúng chủ đích.
- Kiểm tra cú pháp các tệp Python thay đổi và `git diff --check`: đạt.
- Bộ test mới kiểm chứng cấu hình thiếu/không an toàn trả exit 4 trước import ứng dụng; yêu cầu trực tiếp module tích hợp chưa bật trả exit 5 do không thu thập test, có thông báo skip.
- Chưa chạy MySQL/API tích hợp thật hoặc xác minh runner GitHub Linux; job CI mới sẽ cung cấp kết quả sau khi push. Còn cảnh báo deprecation từ thư viện HTTP/Pydantic hiện có.

Không có thay đổi runtime fallback SQLite, schema DB, bí mật hay dữ liệu người dùng.

## Tham khảo

- Bảng lỗi: `test_3110_bug.xlsx`, `Sheet1!A18:K18`.
- Mã nguồn: `backend/tests/conftest.py` và các module kiểm thử được nêu ở trên.
- [Pytest API reference](https://pytest.org/en/stable/reference/reference.html): module-level skip với `allow_module_level=True` và cơ chế collection.
