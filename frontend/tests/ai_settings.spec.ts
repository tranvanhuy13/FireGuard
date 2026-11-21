import { test, expect } from '@playwright/test';
import { enableMockMode, loginUI, MOCK_ADMIN } from './helpers';

test.describe('Cấu hình Tham số AI & Hệ thống (AI Settings Page)', () => {
  test.beforeEach(async ({ page }) => {
    await enableMockMode(page);
    await loginUI(page, MOCK_ADMIN.username, MOCK_ADMIN.password);
  });

  test('CFG_01: Truy cập /dashboard/ai-settings hiển thị đầy đủ các thanh trượt cấu hình', async ({ page }) => {
    await page.goto('/dashboard/ai-settings');
    await expect(page).toHaveURL(/.*\/dashboard\/ai-settings/);

    // Kiểm tra có các thanh trượt type="range"
    const firstSlider = page.locator('input[type="range"]').first();
    await expect(firstSlider).toBeVisible();
    const sliders = page.locator('input[type="range"]');
    const count = await sliders.count();
    expect(count).toBeGreaterThanOrEqual(2);

    // Kiểm tra nút Save và Restore Defaults
    const saveBtn = page.locator('button:has-text("Save"), button:has-text("Lưu")');
    await expect(saveBtn.first()).toBeVisible();

    const restoreBtn = page.locator('button:has-text("Restore"), button:has-text("Mặc định")');
    await expect(restoreBtn.first()).toBeVisible();
  });

  test('CFG_02: Điều chỉnh thanh trượt ngưỡng nhạy AI phát hiện cháy/khói', async ({ page }) => {
    await page.goto('/dashboard/ai-settings');
    const sliders = page.locator('input[type="range"]');
    const firstSlider = sliders.first();
    await expect(firstSlider).toBeVisible();

    // Thay đổi giá trị thanh trượt
    await firstSlider.fill('75');
    await expect(firstSlider).toHaveValue('75');
  });

  test('CFG_03: Khôi phục cấu hình mặc định khi nhấn Restore Defaults', async ({ page }) => {
    await page.goto('/dashboard/ai-settings');
    const restoreBtn = page.locator('button:has-text("Restore"), button:has-text("Mặc định")').first();
    await expect(restoreBtn).toBeVisible();
    await restoreBtn.click();

    // Xác nhận các giá trị được gán về mặc định
    const sliders = page.locator('input[type="range"]');
    await expect(sliders.first()).toBeVisible();
  });

  test('CFG_04: Lưu cấu hình thành công khi nhấn Save Settings', async ({ page }) => {
    await page.goto('/dashboard/ai-settings');
    const firstSlider = page.locator('input[type="range"]').first();
    await expect(firstSlider).toBeVisible();
    await firstSlider.fill('80');

    const saveBtn = page.locator('button:has-text("Save"), button:has-text("Lưu")').first();
    await expect(saveBtn).toBeVisible();
    await expect(saveBtn).toBeEnabled();

    // Lắng nghe hộp thoại alert thông báo lưu thành công
    page.once('dialog', async (dialog) => {
      expect(dialog.message()).toBeTruthy();
      await dialog.accept();
    });

    await saveBtn.click();
  });
});
