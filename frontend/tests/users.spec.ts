import { test, expect } from '@playwright/test';
import { enableMockMode, loginUI, MOCK_ADMIN } from './helpers';

test.describe('Quản trị Người dùng & Phân quyền Tài khoản (Users Management Page)', () => {
  test.beforeEach(async ({ page }) => {
    await enableMockMode(page);
    await loginUI(page, MOCK_ADMIN.username, MOCK_ADMIN.password);
  });

  test('USR_01: Admin truy cập /dashboard/users hiển thị danh sách người dùng', async ({ page }) => {
    await page.goto('/dashboard/users');
    await expect(page).toHaveURL(/.*\/dashboard\/users/);

    // Kiểm tra tiêu đề trang
    const header = page.locator('h1, h2, h3').first();
    await expect(header).toBeVisible();

    // Bảng người dùng
    const table = page.locator('table');
    await expect(table.first()).toBeVisible();

    // Các cột Vai trò (Role) và Trạng thái (Status)
    const roleHeader = page.locator('th:has-text("Role"), th:has-text("Vai trò")');
    await expect(roleHeader.first()).toBeVisible();
  });

  test('USR_02: Hiển thị dropdown lựa chọn vai trò (Role) cho từng tài khoản', async ({ page }) => {
    await page.goto('/dashboard/users');
    const firstSelect = page.locator('table select').first();
    await expect(firstSelect).toBeVisible();

    const roleSelects = page.locator('table select');
    const count = await roleSelects.count();
    expect(count).toBeGreaterThan(0);
  });

  test('USR_03: Nút chuyển đổi trạng thái Hoạt động / Khóa tài khoản (Active/Blocked)', async ({ page }) => {
    await page.goto('/dashboard/users');
    const statusBadges = page.locator('table span:has-text("active"), table span:has-text("blocked")');
    await expect(statusBadges.first()).toBeVisible();

    const actionBtns = page.locator('table tbody tr td button');
    await expect(actionBtns.first()).toBeVisible();
    const count = await actionBtns.count();
    expect(count).toBeGreaterThan(0);
  });
});
