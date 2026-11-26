import { test, expect } from '@playwright/test';
import { enableMockMode, loginUI, MOCK_ADMIN } from './helpers';

test.describe('Hồ sơ Người dùng & Dọn dẹp Tài khoản Liên kết (Profile Page)', () => {
  test.beforeEach(async ({ page }) => {
    await enableMockMode(page);
    await loginUI(page, MOCK_ADMIN.username, MOCK_ADMIN.password);
    await page.waitForURL(/.*\/dashboard/, { timeout: 10000 });
  });

  test('PRO_01: Truy cập /dashboard/profile hiển thị thông tin người dùng và vai trò', async ({ page }) => {
    await page.goto('/dashboard/profile');
    await expect(page).toHaveURL(/.*\/dashboard\/profile/);
    await expect(page.locator('h1, h2, h3').first()).toBeVisible();

    // Kiểm tra có hiển thị username
    const usernameField = page.locator('input[value*="admin"], input#username, div:has-text("admin")');
    await expect(usernameField.first()).toBeVisible();
  });

  test('PRO_02: Xác nhận loại bỏ hoàn toàn khối "Tài khoản liên kết" (Linked Accounts) tại trang profile (PR #14)', async ({ page }) => {
    await page.goto('/dashboard/profile');

    // Khối "Tài khoản liên kết" / "Linked Accounts" và nút disconnect Google/Facebook không còn tồn tại
    const linkedAccounts = page.getByText(/Tài khoản liên kết|Linked Accounts|Liên kết Google|Liên kết Facebook/);
    await expect(linkedAccounts).toHaveCount(0);
  });

  test('PRO_03: Nhập sai số điện thoại hiển thị thông báo lỗi, sửa đúng lưu thành công', async ({ page }) => {
    await page.waitForLoadState('domcontentloaded');
    await page.goto('/dashboard/profile');
    await expect(page).toHaveURL(/.*\/dashboard\/profile/);

    const phoneInput = page.locator('input[type="tel"]');
    await expect(phoneInput).toBeVisible();

    // 1. Nhập số điện thoại sai định dạng (chứa dấu gạch ngang)
    await phoneInput.fill('091-234-5678');
    await phoneInput.blur();

    // Lỗi validation phải hiển thị ngay khi blur
    const phoneError = page.getByText(/Số điện thoại không hợp lệ|Invalid phone number/);
    await expect(phoneError).toBeVisible();

    // Nút Lưu thông tin vẫn có thể tương tác (không bị khóa ngầm làm người dùng hoang mang)
    const saveButton = page.locator('button[type="submit"]:has-text("Lưu"), button[type="submit"]:has-text("Save")');
    await expect(saveButton).toBeEnabled();

    // 2. Sửa lại thành số điện thoại hợp lệ (9-11 chữ số)
    await phoneInput.fill('0912345678');
    await phoneInput.blur();

    // Thông báo lỗi phải biến mất
    await expect(phoneError).toHaveCount(0);

    // 3. Bấm nút Lưu thông tin và kiểm tra lưu thành công
    await saveButton.click();
    const successMsg = page.locator('form').getByText(/thành công|successfully/i);
    await expect(successMsg).toBeVisible({ timeout: 5000 });
  });

  test('PRO_04: Phân tích giá trị biên (BVA) độ dài số điện thoại (8 số: lỗi, 9-11 số: hợp lệ, 12 số: lỗi)', async ({ page }) => {
    await page.waitForLoadState('domcontentloaded');
    await page.goto('/dashboard/profile');
    const phoneInput = page.locator('input[type="tel"]');
    const phoneError = page.getByText(/Số điện thoại không hợp lệ|Invalid phone number/);

    // Biên dưới - 1: 8 chữ số -> lỗi
    await phoneInput.fill('09123456');
    await phoneInput.blur();
    await expect(phoneError).toBeVisible();

    // Biên dưới (min): 9 chữ số -> hợp lệ
    await phoneInput.fill('091234567');
    await phoneInput.blur();
    await expect(phoneError).toHaveCount(0);

    // Biên trên (max): 11 chữ số -> hợp lệ
    await phoneInput.fill('09123456789');
    await phoneInput.blur();
    await expect(phoneError).toHaveCount(0);

    // Biên trên + 1: 12 chữ số -> lỗi
    await phoneInput.fill('091234567890');
    await phoneInput.blur();
    await expect(phoneError).toBeVisible();
  });

  test('PRO_05: XSS & Ký tự đặc biệt trong ô số điện thoại bị chặn bởi validation', async ({ page }) => {
    await page.waitForLoadState('domcontentloaded');
    await page.goto('/dashboard/profile');
    const phoneInput = page.locator('input[type="tel"]');
    const phoneError = page.getByText(/Số điện thoại không hợp lệ|Invalid phone number/);

    // Thử chèn payload XSS
    await phoneInput.fill('<script>alert(1)</script>');
    await phoneInput.blur();
    await expect(phoneError).toBeVisible();

    // Thử chèn payload SQL injection
    await phoneInput.fill("0912'; DROP TABLE users;--");
    await phoneInput.blur();
    await expect(phoneError).toBeVisible();
  });

  test('PRO_06: Đổi mật khẩu trên trang Profile: chặn mật khẩu trùng mật khẩu cũ, xác nhận không khớp, và đổi thành công', async ({ page }) => {
    await page.goto('/dashboard/profile');
    const passwordInputs = page.locator('form').nth(1).locator('input[type="password"]');
    await expect(passwordInputs).toHaveCount(3);

    const currentPwd = passwordInputs.nth(0);
    const newPwd = passwordInputs.nth(1);
    const confirmPwd = passwordInputs.nth(2);
    const submitPwdBtn = page.locator('form').nth(1).locator('button[type="submit"]');

    // 1. Mật khẩu mới trùng mật khẩu hiện tại -> báo lỗi và nút lưu bị khóa
    await currentPwd.fill('AdminPass123');
    await newPwd.fill('AdminPass123');
    await confirmPwd.fill('AdminPass123');
    await expect(page.getByText(/không được trùng mật khẩu cũ|cannot be the same/i)).toBeVisible();
    await expect(submitPwdBtn).toBeDisabled();

    // 2. Xác nhận mật khẩu mới không khớp -> báo lỗi và nút lưu bị khóa
    await newPwd.fill('NewAdminPass123');
    await confirmPwd.fill('MismatchPass123');
    await expect(page.getByText(/không khớp|does not match/i)).toBeVisible();
    await expect(submitPwdBtn).toBeDisabled();

    // 3. Nhập hợp lệ và khớp -> nút lưu được mở khóa và lưu thành công
    await confirmPwd.fill('NewAdminPass123');
    await expect(submitPwdBtn).toBeEnabled();
    await submitPwdBtn.click();
    await expect(page.getByText(/Đổi mật khẩu thành công|Password updated successfully/i)).toBeVisible({ timeout: 5000 });
  });

  test('PRO_07: Kiểm tra validation tải ảnh đại diện (chặn file không phải ảnh) và chuyển đổi giao diện Sáng / Tối', async ({ page }) => {
    await page.goto('/dashboard/profile');

    // 1. Tải file không phải định dạng ảnh -> hiển thị thông báo lỗi định dạng
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: 'malicious.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('not an image'),
    });
    await expect(page.getByText(/JPG, PNG, WEBP/i).nth(1)).toBeVisible();

    // 2. Chuyển đổi giao diện Dark / Light
    const darkBtn = page.locator('button').filter({ hasText: /Chế độ Tối|Dark Mode/i }).first();
    await darkBtn.click();
    await expect(page.locator('html')).toHaveClass(/dark/);

    const lightBtn = page.locator('button').filter({ hasText: /Chế độ Sáng|Light Mode/i }).first();
    await lightBtn.click();
    await expect(page.locator('html')).not.toHaveClass(/dark/);
  });
});
