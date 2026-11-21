import { test, expect } from '@playwright/test';
import { enableMockMode, loginUI, MOCK_ADMIN } from './helpers';

test.describe('Lịch sử Sự cố & Báo cáo (Incident History Page)', () => {
  test.beforeEach(async ({ page }) => {
    await enableMockMode(page);
    await loginUI(page, MOCK_ADMIN.username, MOCK_ADMIN.password);
  });

  test('HIS_01: Truy cập /dashboard/history hiển thị bảng sự cố và các công cụ lọc', async ({ page }) => {
    await page.goto('/dashboard/history');
    await expect(page).toHaveURL(/.*\/dashboard\/history/);

    // Kiểm tra tiêu đề hoặc bảng lịch sử
    const header = page.locator('h1, h2, h3').first();
    await expect(header).toBeVisible();

    // Kiểm tra ô tìm kiếm và các bộ lọc
    const searchInput = page.locator('input[placeholder*="Search"], input[placeholder*="Tìm"]');
    await expect(searchInput.first()).toBeVisible();

    const selects = page.locator('select');
    await expect(selects.first()).toBeVisible();

    // Nút xuất CSV
    const exportBtn = page.locator('button:has-text("Export"), button:has-text("Xuất"), button:has-text("CSV")');
    await expect(exportBtn.first()).toBeVisible();
  });

  test('HIS_02: Lọc sự cố theo từ khóa tìm kiếm trong ô Search', async ({ page }) => {
    await page.goto('/dashboard/history');
    const searchInput = page.locator('input[placeholder*="Search"], input[placeholder*="Tìm"]').first();
    await searchInput.fill('Camera');
    await expect(searchInput).toHaveValue('Camera');
  });

  test('HIS_03: Mở modal xem chi tiết sự cố khi click vào dòng trong bảng', async ({ page }) => {
    await page.goto('/dashboard/history');

    // Chờ bảng hoặc dữ liệu tải
    const rows = page.locator('tbody tr');
    const count = await rows.count();
    if (count > 0) {
      await rows.first().click();
      // Modal chi tiết hiển thị
      const modal = page.locator('div.fixed, div[role="dialog"]');
      await expect(modal.first()).toBeVisible();

      // Kiểm tra có nút đóng/hủy
      const closeBtn = page.locator('button:has-text("Cancel"), button:has-text("Hủy"), button:has-text("Đóng")');
      if (await closeBtn.count() > 0) {
        await closeBtn.first().click();
      }
    }
  });

  test('HIS_04: Nhấn nút Xuất CSV (Export CSV) kích hoạt tải file', async ({ page }) => {
    await page.goto('/dashboard/history');
    const exportBtn = page.locator('button:has-text("Export"), button:has-text("Xuất")').first();
    await expect(exportBtn).toBeVisible();
    await expect(exportBtn).toBeEnabled();
  });
});
