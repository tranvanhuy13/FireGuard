import { test, expect } from '@playwright/test';

test.describe('Cấu hình Tham số AI & Hệ thống (AI Settings Page)', () => {
  const savedUpdates: Array<{ key: string; value: string }> = [];

  test.beforeEach(async ({ page }) => {
    savedUpdates.length = 0;
    const admin = { id: 1, username: 'ai_admin', email: 'admin@example.com', role: 'admin', is_active: true };
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };

    await page.addInitScript(profile => {
      sessionStorage.setItem('auth_header', 'Bearer ai-settings-session');
      sessionStorage.setItem('user_profile', JSON.stringify(profile));
      localStorage.setItem('language', 'en');
    }, admin);

    await page.route(/.*(18080|:8000)\/.*/, async route => {
      const method = route.request().method();
      if (method === 'OPTIONS') return route.fulfill({ status: 200, headers });
      const url = new URL(route.request().url());
      if (url.pathname === '/users/me') return route.fulfill({ status: 200, headers, json: admin });
      if (url.pathname === '/auth/stream-token') return route.fulfill({ status: 200, headers, json: { token: 't', expires_in: 3600 } });
      if (url.pathname === '/settings' && method === 'GET') {
        return route.fulfill({
          status: 200,
          headers,
          json: { settings: { fire_threshold: '75', smoke_threshold: '70', persistence: '5', cooldown: '60' } },
        });
      }
      if (url.pathname === '/settings' && method === 'POST') {
        savedUpdates.push(route.request().postDataJSON());
        return route.fulfill({ status: 200, headers, json: { status: 'ok' } });
      }
      return route.fulfill({ status: 200, headers, json: {} });
    });
    await page.routeWebSocket('**/ws/**', () => {});
  });

  test('CFG_01: Truy cập /dashboard/ai-settings hiển thị đầy đủ 4 thanh trượt cấu hình và các nút điều khiển', async ({ page }) => {
    await page.goto('/dashboard/ai-settings');
    await expect(page).toHaveURL(/.*\/dashboard\/ai-settings/);

    const sliders = page.locator('input[type="range"]');
    await expect(sliders).toHaveCount(4);
    await expect(sliders.nth(0)).toHaveValue('75');
    await expect(sliders.nth(1)).toHaveValue('70');

    const saveBtn = page.getByRole('button', { name: /Save|Lưu/i });
    await expect(saveBtn).toBeVisible();
    await expect(saveBtn).toBeDisabled();

    const restoreBtn = page.getByRole('button', { name: /Restore|Mặc định/i });
    await expect(restoreBtn).toBeVisible();
  });

  test('CFG_02: Điều chỉnh thanh trượt ngưỡng nhạy AI hiển thị cảnh báo thay đổi chưa lưu và cảnh báo ngưỡng cực đoan', async ({ page }) => {
    await page.goto('/dashboard/ai-settings');
    const firstSlider = page.locator('input[type="range"]').first();
    await expect(firstSlider).toBeVisible();

    // Đặt ngưỡng < 50% để kích hoạt cả cảnh báo Unsaved Changes và cảnh báo False Positives/Negatives
    await firstSlider.fill('35');
    await expect(firstSlider).toHaveValue('35');
    await expect(page.getByText('You have unsaved changes.')).toBeVisible();
    await expect(page.getByText(/Warning: Values are too high or low/i)).toBeVisible();
  });

  test('CFG_03: Khôi phục cấu hình mặc định khi nhấn Restore Defaults đưa giá trị slider về 75%', async ({ page }) => {
    await page.goto('/dashboard/ai-settings');
    const firstSlider = page.locator('input[type="range"]').first();
    await firstSlider.fill('90');
    await expect(firstSlider).toHaveValue('90');

    const restoreBtn = page.getByRole('button', { name: /Restore|Mặc định/i });
    await restoreBtn.click();
    await expect(firstSlider).toHaveValue('75');
  });

  test('CFG_04: Lưu cấu hình thành công khi nhấn Save Settings gửi đủ 4 tham số và hiển thị dialog xác nhận', async ({ page }) => {
    await page.goto('/dashboard/ai-settings');
    const firstSlider = page.locator('input[type="range"]').first();
    await firstSlider.fill('80');

    const saveBtn = page.getByRole('button', { name: /Save|Lưu/i });
    await expect(saveBtn).toBeEnabled();

    const dialogPromise = page.waitForEvent('dialog');
    await saveBtn.click();
    const dialog = await dialogPromise;
    expect(dialog.message()).toMatch(/Saved|thành công/i);
    await dialog.accept();

    expect(savedUpdates).toContainEqual({ key: 'fire_threshold', value: '80' });
    await expect(saveBtn).toBeDisabled();
  });

  test('CFG_05: Hiển thị cảnh báo lỗi khi POST /settings thất bại (HTTP 500) và giữ nguyên trạng thái chưa lưu', async ({ page }) => {
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
    await page.route(/.*(18080|:8000)\/settings/, async route => {
      if (route.request().method() === 'POST') {
        return route.fulfill({ status: 500, headers, json: { detail: 'Database write failed' } });
      }
      return route.fallback();
    });

    await page.goto('/dashboard/ai-settings');
    const firstSlider = page.locator('input[type="range"]').first();
    await firstSlider.fill('85');

    const saveBtn = page.getByRole('button', { name: /Save|Lưu/i });
    const dialogPromise = page.waitForEvent('dialog');
    await saveBtn.click();
    const dialog = await dialogPromise;
    expect(dialog.message()).toMatch(/Error|Lỗi/i);
    await dialog.accept();

    await expect(saveBtn).toBeEnabled();
    await expect(page.getByText('You have unsaved changes.')).toBeVisible();
  });
});
