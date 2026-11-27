import { test, expect } from '@playwright/test';
import { BACKEND_URL, basicAuth, REAL_USER } from './helpers';

test.describe('Cảnh báo qua Telegram & Zalo (Notification Channels & Settings)', () => {
  const headers = basicAuth(REAL_USER.username, REAL_USER.password);

  async function mockNotificationPage(page: import('@playwright/test').Page, role: 'admin' | 'user' = 'admin') {
    const actor = { id: 1, username: 'notif_actor', email: 'notif@example.com', role, is_active: true };
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
    await page.addInitScript(profile => {
      sessionStorage.setItem('auth_header', 'Bearer notif-ui-session');
      sessionStorage.setItem('user_profile', JSON.stringify(profile));
      localStorage.setItem('language', 'en');
    }, actor);

    await page.route(/.*(18080|:8000)\/.*/, async route => {
      const method = route.request().method();
      if (method === 'OPTIONS') return route.fulfill({ status: 200, headers: cors });
      const path = new URL(route.request().url()).pathname;
      if (path === '/users/me') return route.fulfill({ status: 200, headers: cors, json: actor });
      if (path === '/auth/stream-token') return route.fulfill({ status: 200, headers: cors, json: { token: 't', expires_in: 3600 } });
      if (path === '/notifications/accounts' && method === 'GET') {
        return route.fulfill({
          status: 200,
          headers: cors,
          json: { accounts: [{ id: 'acc-1', channel: 'telegram', friendlyName: 'Fire Response Team', chatId: '-100123456', active: true }] },
        });
      }
      if (path === '/notifications/groups' && method === 'GET') {
        return route.fulfill({ status: 200, headers: cors, json: { groups: [] } });
      }
      if (path === '/notifications/accounts/acc-1/test' && method === 'POST') {
        return route.fulfill({ status: 200, headers: cors, json: { status: 'sent' } });
      }
      return route.fulfill({ status: 200, headers: cors, json: {} });
    });
    await page.routeWebSocket('**/ws/**', () => {});
  }

  test('NOTIF_01: Truy cập /dashboard/notifications hiển thị kênh Telegram và danh sách người nhận', async ({ page }) => {
    await mockNotificationPage(page, 'admin');
    await page.goto('/dashboard/notifications');
    await expect(page).toHaveURL(/.*\/dashboard\/notifications/);

    await expect(page.locator('h1').first()).toBeVisible();
    await expect(page.getByText('Fire Response Team')).toBeVisible();
    await expect(page.getByText(/telegram/i).first()).toBeVisible();
  });

  test('NOTIF_02: Hiển thị và kích hoạt nút Test cảnh báo thử nghiệm cho người nhận trên giao diện', async ({ page }) => {
    await mockNotificationPage(page, 'admin');
    await page.goto('/dashboard/notifications');

    const testBtn = page.getByRole('button', { name: /^(Test|Thử nghiệm|Kiểm tra)$/ });
    await expect(testBtn).toBeVisible();
    await expect(testBtn).toBeEnabled();
    await testBtn.click();

    await expect(page.getByRole('status').filter({ hasText: /TEST/i })).toBeVisible();
  });

  test('NOTIF_03: Phân quyền trên UI: User quản lý được người nhận nhưng không thấy tab Cấu hình hệ thống của Admin', async ({ page }) => {
    await mockNotificationPage(page, 'user');
    await page.goto('/dashboard/notifications');

    // User thấy nút Add Account và nút Test của mình
    await expect(page.getByRole('button', { name: /Add Account|Thêm tài khoản/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /^(Test|Thử nghiệm|Kiểm tra)$/ })).toBeVisible();
    // Nhưng không thấy tab System Configuration dành riêng cho Admin
    await expect(page.getByRole('button', { name: /System Configuration|Cấu hình hệ thống/i })).toHaveCount(0);
  });

  test('NOTIF_04: Endpoint POST /test-notification kích hoạt cảnh báo thử nghiệm thành công (200 OK)', async ({ request }) => {
    const res = await request.post(`${BACKEND_URL}/test-notification`, { headers });
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(['ok', 'partial', 'error']).toContain(data.status);
    expect(data).toHaveProperty('channels');
  });

  test('NOTIF_05: Masking bảo mật cho Bot Tokens Telegram và Zalo tại /settings', async ({ request }) => {
    const res = await request.get(`${BACKEND_URL}/settings`, { headers });
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('settings');
    const settings = data.settings;

    for (const key of ['telegram_bot_token', 'zalo_bot_token']) {
      if (key in settings && settings[key]) {
        expect(settings[key]).toBe('********');
      }
    }
  });
});
