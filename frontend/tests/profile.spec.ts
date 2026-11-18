import { test, expect } from '@playwright/test';
import { enableMockMode, loginUI, MOCK_ADMIN } from './helpers';

test.describe('Hồ sơ Người dùng & Dọn dẹp Tài khoản Liên kết (Profile Page)', () => {
  test.beforeEach(async ({ page }) => {
    await enableMockMode(page);
    await loginUI(page, MOCK_ADMIN.username, MOCK_ADMIN.password);
    await page.waitForURL(/.*\/dashboard/, { timeout: 10000 });
  });

  test('PRO_01: Truy cập /dashboard/profile hiển thị thông tin người dùng và vai trò', async ({ page }) => {
    await page.waitForLoadState('domcontentloaded');
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
});
