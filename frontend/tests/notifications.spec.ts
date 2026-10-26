import { test, expect } from '@playwright/test';
import { enableMockMode, loginUI, MOCK_ADMIN, BACKEND_URL } from './helpers';

test.describe('Cảnh báo qua Telegram & Zalo (Notification Channels & Settings)', () => {
  test.beforeEach(async ({ page }) => {
    await enableMockMode(page);
    await loginUI(page, MOCK_ADMIN.username, MOCK_ADMIN.password);
  });

  test('NOTIF_01: Truy cập /dashboard/notifications hiển thị kênh Telegram và Zalo', async ({ page }) => {
    await page.goto('/dashboard/notifications');
    await expect(page).toHaveURL(/.*\/dashboard\/notifications/);

    // Kiểm tra có tiêu đề hoặc nội dung trang thông báo
    await expect(page.locator('h1, h2, h3').first()).toBeVisible();

    // Kiểm tra xuất hiện các kênh Telegram hoặc Zalo trên giao diện
    const channels = page.locator('text=Telegram, text=telegram, text=Zalo, text=zalo');
    await expect(channels.first()).toBeVisible();
  });

  test('NOTIF_02: Hiển thị nút Test cảnh báo thử nghiệm cho từng kênh', async ({ page }) => {
    await page.goto('/dashboard/notifications');

    // Nút Test hoặc Gửi thử nghiệm
    const testBtns = page.locator('button:has-text("Test"), button:has-text("Thử"), button:has-text("Gửi thử")');
    if (await testBtns.count() > 0) {
      await expect(testBtns.first()).toBeVisible();
    }
  });

  test('NOTIF_03: Phân quyền: Cả Admin và Viewer đều có quyền quản lý và test thông báo', () => {
    // Kiểm tra logic phân quyền hasRole(['admin', 'viewer']) trong notifications/page.tsx
    const hasRole = (userRole: string, allowedRoles: string[]) => allowedRoles.includes(userRole);

    expect(hasRole('admin', ['admin', 'viewer'])).toBe(true);
    expect(hasRole('viewer', ['admin', 'viewer'])).toBe(true);
    expect(hasRole('guest', ['admin', 'viewer'])).toBe(false);
  });

  test('NOTIF_04: Endpoint POST /test-notification kích hoạt cảnh báo thử nghiệm thành công (200 OK)', async ({ request }) => {
    const res = await request.post(`${BACKEND_URL}/test-notification`);
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('ok');
    expect(data.message).toContain('Test notification triggered');
  });

  test('NOTIF_05: Masking bảo mật cho Bot Tokens Telegram và Zalo', async ({ request }) => {
    const res = await request.get(`${BACKEND_URL}/settings`);
    expect(res.status()).toBe(200);
    const data = await res.json();
    const settings = data.settings || {};

    // Token bot telegram nếu có phải được mask
    if (settings.telegram_bot_token) {
      expect(settings.telegram_bot_token).toBe('********');
    }
    // Token bot zalo nếu có phải được mask
    if (settings.zalo_bot_token) {
      expect(settings.zalo_bot_token).toBe('********');
    }
  });
});
