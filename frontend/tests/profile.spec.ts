import { test, expect } from '@playwright/test';
import { enableMockMode, loginUI, MOCK_ADMIN } from './helpers';

test.describe('Hồ sơ Người dùng & Dọn dẹp Tài khoản Liên kết (Profile Page)', () => {
  test.beforeEach(async ({ page }) => {
    await enableMockMode(page);
    await loginUI(page, MOCK_ADMIN.username, MOCK_ADMIN.password);
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
    const linkedAccounts = page.locator('text=Tài khoản liên kết, text=Linked Accounts, text=Liên kết Google, text=Liên kết Facebook');
    await expect(linkedAccounts).toHaveCount(0);
  });
});
