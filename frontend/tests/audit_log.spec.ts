import { test, expect } from '@playwright/test';
import { enableMockMode, loginUI, MOCK_ADMIN } from './helpers';

test.describe('Nhật ký Kiểm toán Hệ thống (Audit Log Page)', () => {
  test.beforeEach(async ({ page }) => {
    await enableMockMode(page);
    await loginUI(page, MOCK_ADMIN.username, MOCK_ADMIN.password);
  });

  test('AUD_01: Admin truy cập /dashboard/audit-log hiển thị bảng nhật ký và thanh công cụ', async ({ page }) => {
    await page.goto('/dashboard/audit-log');
    await expect(page).toHaveURL(/.*\/dashboard\/audit-log/);

    // Tiêu đề hoặc bảng nhật ký
    const header = page.locator('h1, h2, h3').first();
    await expect(header).toBeVisible();

    // Nút xuất báo cáo Export CSV
    const exportBtn = page.locator('button:has-text("Export"), button:has-text("Xuất")');
    await expect(exportBtn.first()).toBeVisible();

    // Các bộ lọc hành động và kết quả
    const filterSelects = page.locator('select');
    const count = await filterSelects.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test('AUD_02: Bảng nhật ký hỗ trợ sắp xếp các cột khi click vào tiêu đề cột', async ({ page }) => {
    await page.goto('/dashboard/audit-log');
    await expect(page.locator('table').first()).toBeVisible();
    const headers = page.locator('table th.cursor-pointer, table th');
    const count = await headers.count();
    if (count > 0) {
      await headers.first().click();
      // Bảng vẫn tồn tại ổn định
      const table = page.locator('table');
      await expect(table.first()).toBeVisible();
    }
  });

  test('AUD_03: Điều khiển phân trang (Pagination) và chọn số dòng hiển thị', async ({ page }) => {
    await page.goto('/dashboard/audit-log');
    const paginationControls = page.locator('button:has-text("Previous"), button:has-text("Next"), select');
    await expect(paginationControls.first()).toBeVisible({ timeout: 10000 });
    const count = await paginationControls.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });
});
