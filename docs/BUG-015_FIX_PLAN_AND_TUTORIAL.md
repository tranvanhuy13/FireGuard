# BUG-015: Kế hoạch và hướng dẫn sửa lỗi

Trạng thái: đã sửa mã nguồn trên nhánh `fix/bug-015-auth-timing`; kiểm thử ngoại tuyến đã đạt. Chưa triển khai hoặc đo HTTP với cơ sở dữ liệu thực tế.

## Vấn đề và phạm vi đã xác minh

Tệp `test_3110_bug.xlsx`, vùng `Sheet1!A16:K16`, mô tả lỗi dò tìm tài khoản qua chênh lệch thời gian phản hồi, có mức độ nghiêm trọng và độ ưu tiên trung bình. Số liệu khoảng 0,5 ms so với 200 ms là ghi nhận trong báo cáo, không phải kết quả đo khi lập kế hoạch này. Cột H mô tả tác động của cuộc tấn công thay vì hành vi mong đợi. Mục tiêu là thực hiện lượng công việc kiểm tra mật khẩu tương đương giữa tài khoản không tồn tại và tài khoản tồn tại nhưng sai mật khẩu.

Hai luồng bị ảnh hưởng trong `backend/app/auth/dependencies.py`:

- `authenticate_user` trả về trước khi xác minh mật khẩu nếu không tìm thấy người dùng.
- `get_current_user` dùng `user and verify_password(...)`, khiến bcrypt bị bỏ qua khi người dùng không tồn tại. Đây là dependency thực tế của `GET /auth/login` trong `backend/main.py` và các route yêu cầu xác thực khác.

Chỉ sửa `authenticate_user` sẽ khiến luồng đăng nhập thực tế vẫn còn lỗ hổng. `backend/app/auth/utils.py` quản lý cấu hình bcrypt của Passlib và các hàm mật khẩu. `backend/app/auth/login_limiter.py` quản lý giữ chỗ cho lượt thử và ghi nhận các lần thất bại.

Bảng tính ghi đã có `TC_LOG_EDGE_004`, nhưng chưa tìm thấy mã kiểm thử này trong mã nguồn hiện tại. Cần bổ sung hoặc tìm lại, không coi đó là kiểm thử đã đạt.

## Kế hoạch thực hiện

| Bước | Công việc | Điều kiện hoàn thành |
| --- | --- | --- |
| 1 | Thêm kiểm thử hồi quy độc lập | Chứng minh cả hai luồng bỏ qua xác minh khi tài khoản không tồn tại trước khi sửa |
| 2 | Tạo mã băm bcrypt giả dùng lại | Chỉ tạo một lần mỗi tiến trình theo cấu hình hiện có |
| 3 | Dùng chung hàm xác minh | Mỗi lượt thử thông thường được phép xử lý đều xác minh một lần, kể cả tài khoản không tồn tại |
| 4 | Giữ nguyên xác thực và giới hạn lượt thử | Thông báo lỗi chung, giữ chỗ, ghi nhận lượt thử và kiểm tra tài khoản vẫn hoạt động |
| 5 | Kiểm thử và so sánh thời gian có kiểm soát | Chức năng đạt và loại bỏ luồng trả về nhanh khi thiếu tài khoản |
| 6 | Ghi nhận kết quả | Ghi môi trường, hệ số chi phí băm, kiểm thử, phân bố thời gian và chênh lệch còn lại |

Bản sửa này không cần thay đổi frontend, cấu trúc cơ sở dữ liệu, chuyển đổi mật khẩu, chính sách tài khoản hoặc triển khai. Không thêm thời gian chờ cố định hay ngẫu nhiên vì chúng không khắc phục việc bỏ qua xử lý mật khẩu.

## Hướng dẫn sửa từng bước

### 1. Chuẩn bị bản làm việc hiện tại

Tại thư mục gốc repository:

```powershell
git status --short --branch
```

Giữ nguyên các thay đổi đang có. Đọc `docs/system/TESTING.md` trước khi kiểm thử. Không import `main.py` trong kiểm thử ngoại tuyến mới vì thao tác đó khởi động dịch vụ và truy cập cơ sở dữ liệu. Dùng dữ liệu tra cứu giả lập và mock các lời gọi giới hạn lượt thử.

### 2. Thêm mã băm giả và hàm xác minh chung

Trong `backend/app/auth/dependencies.py`, bổ sung dòng import:

```python
from .utils import get_password_hash, verify_password
```

Sau các dòng import của module, tạo mã băm giả một lần:

```python
_DUMMY_PASSWORD_HASH = get_password_hash("bug-015-dummy-password")


def _verify_user_password(user, password: str) -> bool:
    hashed_password = (
        user.hashed_password if user is not None else _DUMMY_PASSWORD_HASH
    )
    matches = verify_password(password, hashed_password)
    return user is not None and matches
```

Chuỗi trên là giá trị giả công khai, không phải mật khẩu tài khoản. Ngay cả khi mật khẩu nhập vào khớp mã băm giả, xác thực vẫn phải thất bại vì không có người dùng. Tạo mã băm ngoài quá trình xử lý request, theo cấu hình bcrypt hiện có. Kiểm tra hệ số chi phí khớp với mã băm của các tài khoản hiện tại; mã băm cũ có chi phí khác nhau vẫn có thể tạo các nhóm thời gian khác nhau. Mỗi worker sẽ băm thêm một lần khi khởi động; cần kiểm tra cả import và khởi động.

### 3. Cập nhật hàm hỗ trợ xác thực

Thay `authenticate_user` bằng:

```python
def authenticate_user(db, identifier: str, password: str):
    user = get_user_by_identifier(db, identifier)
    if not _verify_user_password(user, password):
        return False
    return user
```

Giữ nguyên hành vi ngoại lệ của hàm, trừ khi kiểm thử xác định yêu cầu riêng cần thay đổi.

### 4. Cập nhật dependency xác thực thực tế

Trong khối `try` của `get_current_user`, thay:

```python
valid = bool(user and verify_password(credentials.password, user.hashed_password))
```

bằng:

```python
valid = _verify_user_password(user, credentials.password)
```

Giữ nguyên thứ tự tra cứu, `reserve`, `finish`, xử lý ngoại lệ, phản hồi 401 chung, header `WWW-Authenticate: Basic` và `validate_account`. Không gọi `authenticate_user` tại đây nếu làm lặp lại truy vấn cơ sở dữ liệu. Request vượt giới hạn vẫn phải bị từ chối trước khi chạy bcrypt.

Xử lý `ValueError` hiện có phải tiếp tục từ chối mật khẩu không hợp lệ. Kiểm tra mật khẩu UTF-8 quá dài và mật khẩu chứa ký tự NUL ở cả hai luồng; không âm thầm cắt ngắn mật khẩu hoặc mở rộng việc bỏ qua ngoại lệ. Đánh giá riêng các đầu vào này và mã băm lưu trữ sai định dạng nếu chúng tạo chênh lệch thời gian còn đo được.

### 5. Bổ sung kiểm thử hồi quy

Tạo `backend/tests/unit/test_auth_timing.py` bằng `unittest` và mock. Patch đối tượng tại nơi được sử dụng trong `auth.dependencies`. Dùng người dùng và cơ sở dữ liệu giả lập; không import `main` hoặc kết nối MySQL. Gọi hàm `get_current_user` thực tế với request, cơ sở dữ liệu và thông tin đăng nhập được truyền rõ ràng.

Kiểm tra cả hai hàm xác thực:

| Trường hợp | Kết quả cần khẳng định |
| --- | --- |
| Username không tồn tại | Xác minh đúng một lần với mã băm giả; từ chối xác thực |
| Email không tồn tại | Hành vi tương tự qua tra cứu email |
| Tài khoản tồn tại, sai mật khẩu | Xác minh đúng một lần với mã băm đã lưu; từ chối xác thực |
| Tài khoản tồn tại, đúng mật khẩu | Xác minh đúng một lần; trả về người dùng thực tế |
| Mật khẩu nhập vào bằng mật khẩu giả | Tài khoản không tồn tại vẫn bị từ chối dù hàm xác minh báo khớp |

Với `get_current_user`, kiểm tra thêm:

- Hai trường hợp sai thông tin thông thường trả về 401 với cùng nội dung và header Basic.
- `reserve` chạy trước xác minh; khi bị từ chối giữ chỗ thì không chạy bcrypt.
- `finish` nhận thất bại cho tài khoản không tồn tại hoặc sai mật khẩu, và thành công khi đúng thông tin. Phản hồi 429 vẫn giữ header `Retry-After`.
- Từ chối khi gặp `ValueError` và dọn dẹp khi gặp ngoại lệ ngoài dự kiến vẫn hoạt động.
- Tài khoản bị chặn, chưa xác minh hoặc có vai trò không hợp lệ vẫn bị từ chối sau khi nhập đúng thông tin; quyền truy cập hợp lệ của user/admin không đổi.

Thêm kiểm thử dùng bcrypt thực tế cho tài khoản không tồn tại và tài khoản tồn tại nhưng sai mật khẩu, không mock `verify_password`, để tránh mock che khuất mã băm giả bị lỗi. Không đặt ngưỡng thời gian thực trong kiểm thử đơn vị thông thường vì nhiễu bộ lập lịch làm kết quả thiếu ổn định. Điều cần khẳng định chắc chắn là cả hai luồng thực sự xác minh mật khẩu.

### 6. Chạy kiểm tra tập trung

Từ `backend/`, sau khi tạo tệp kiểm thử:

```powershell
.\venv\Scripts\python.exe -m unittest discover -s tests -p test_auth_timing.py
.\venv\Scripts\python.exe -m unittest discover -s tests -p test_admin_profile.py
.\venv\Scripts\python.exe -m py_compile auth/dependencies.py
```

Bộ admin-profile kiểm tra route nhưng ghi đè dependency xác thực, nên không thay thế kiểm thử mới. Nếu sửa bộ giới hạn lượt thử, chạy thêm kiểm thử MySQL liên quan với cơ sở dữ liệu kiểm thử dùng riêng và có thể xóa bỏ. Không chạy toàn bộ pytest trên dữ liệu ứng dụng thông thường. Xem `docs/system/TESTING.md` và `docs/MYSQL_AIVEN_MIGRATION.md`.

### 7. Xác nhận cải thiện thời gian

Đầu tiên, đo ngoại tuyến hai luồng hàm hỗ trợ bằng dữ liệu tra cứu giả lập và bcrypt thực tế. Chạy làm nóng cơ chế băm, xen kẽ hoặc xáo trộn các trường hợp, dùng cùng mật khẩu sai và lấy ít nhất 30 mẫu mỗi trường hợp bằng `time.perf_counter()`. Ghi trung vị và độ phân tán trước/sau; lặp lại khi tải máy tương đương. Đo username và email riêng, dùng đầu vào dài bằng nhau khi khả thi. Một cặp request không đủ làm bằng chứng.

Sau đó kiểm tra dependency qua HTTP thực tế trên ứng dụng cục bộ và cơ sở dữ liệu kiểm thử biệt lập. Giữ request dưới giới hạn hoặc chỉ đặt lại trạng thái giới hạn của môi trường kiểm thử có thể xóa bỏ giữa các mẫu. Loại mẫu 429 khỏi so sánh thời gian xác thực và kiểm tra riêng hành vi 429. Không tắt giới hạn lượt thử của production để thuận tiện đo đạc.

Kết quả mong đợi: tài khoản không tồn tại thực hiện cùng công việc bcrypt như trường hợp sai mật khẩu, loại bỏ chênh lệch lớn do trả về sớm. Không bảo đảm thời gian HTTP hoàn toàn cố định vì cơ sở dữ liệu, chi phí băm, trạng thái giới hạn, mạng và bộ lập lịch vẫn ảnh hưởng. Điều tra chênh lệch còn lại có tính nhất quán; chỉ thấy khoảng thời gian chồng lấn chưa đủ chứng minh an toàn.

## Tiêu chí nghiệm thu và bàn giao

- Cả hai hàm dùng hàm xác minh chung.
- Mỗi lượt thử thông thường với tài khoản không tồn tại hoặc sai mật khẩu chạy bcrypt một lần.
- Khớp mật khẩu giả không bao giờ xác thực thành công; thông tin hợp lệ và kiểm tra tài khoản vẫn hoạt động.
- Phản hồi sai thông tin chung và ghi nhận lượt thử được giữ nguyên.
- Kiểm thử mới và các kiểm thử liên quan hiện có đều đạt.
- Ghi bằng chứng thời gian trước/sau, không tuyên bố thời gian hoàn toàn cố định.
- Chỉ đánh dấu BUG-015 đã xử lý sau khi hoàn tất sửa mã và kiểm tra.

## Kết quả thực hiện ngày 02/11/2026

Đã thêm mã băm giả tạo một lần mỗi tiến trình và hàm xác minh chung cho cả `authenticate_user` và `get_current_user`. Giữ nguyên giới hạn lượt thử, thông báo lỗi và kiểm tra tài khoản.

- `test_auth_timing.py`: đạt 12 kiểm thử, gồm mock và bcrypt thực tế.
- `test_admin_profile.py`: đạt 7 kiểm thử khi chạy ngoài sandbox. Trong sandbox, TestClient bị treo ở bước tạo socket nội bộ của asyncio.
- Kiểm tra cú pháp hai tệp Python thay đổi và `git diff --check`: đạt.

Đo trên Windows/Python 3.12, bcrypt cost 12, tra cứu và bộ giới hạn giả lập; dùng mật khẩu sai giống nhau. Mỗi nhóm có 30 mẫu sau làm nóng. Sau sửa, thứ tự hai trường hợp được đảo xen kẽ. Đơn vị: ms.

| Luồng | Trường hợp | Trung vị | Nhỏ nhất | Lớn nhất |
| --- | --- | --- | --- | --- |
| Hàm hỗ trợ, trước sửa | Không tồn tại | 0,003 | 0,003 | 0,010 |
| Hàm hỗ trợ, trước sửa | Sai mật khẩu | 211,154 | 202,782 | 279,303 |
| Hàm hỗ trợ, sau sửa | Không tồn tại | 208,641 | 202,804 | 229,376 |
| Hàm hỗ trợ, sau sửa | Sai mật khẩu | 211,046 | 202,225 | 250,316 |
| Gọi trực tiếp dependency, sau sửa | Không tồn tại | 207,817 | 202,382 | 299,404 |
| Gọi trực tiếp dependency, sau sửa | Sai mật khẩu | 215,153 | 203,189 | 268,635 |

Phép đo cho thấy đã loại bỏ đường trả về nhanh bỏ qua bcrypt. Đây không phải phép đo HTTP, không bao gồm MySQL thực tế và không chứng minh thời gian phản hồi hoàn toàn cố định. Chưa đo riêng email qua HTTP hoặc chi phí mã băm của tài khoản trong cơ sở dữ liệu triển khai. Bảng tính không bị thay đổi; chưa commit, push hoặc triển khai.

## Tài liệu tham khảo

- Tệp người dùng cung cấp: `test_3110_bug.xlsx`, vùng `Sheet1!A16:K16`.
- Mã nguồn: `backend/app/auth/dependencies.py`, `backend/app/auth/utils.py`, `backend/app/auth/login_limiter.py`, `backend/main.py`.
- [OWASP Authentication Cheat Sheet: phản hồi xác thực](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html#authentication-responses): giải thích thông báo lỗi chung và chênh lệch thời gian do trả về sớm.
