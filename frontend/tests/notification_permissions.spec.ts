import { test, expect, type Page } from '@playwright/test';

test.use({ video: 'off', ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });

async function setup(page: Page, role: 'user' | 'admin', failure?: number) {
  const user = { id: 1, username: 'permissiontest', email: 'test@example.com', role, is_active: true };
  const lists: Record<string, Array<Record<string, unknown>>> = {
    accounts: [{ id: 'existing', channel: 'telegram', friendlyName: 'Existing Team', chatId: '-123456', active: true }],
    groups: [],
  };
  const mutations: string[] = [];
  await page.addInitScript(profile => {
    sessionStorage.setItem('auth_header', 'Basic dGVzdDp0ZXN0');
    sessionStorage.setItem('user_profile', JSON.stringify(profile));
  }, user);
  const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
  await page.route('**/*', async route => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api\//, '/');
    const apiPath = path === '/users/me' || path.startsWith('/auth/') || path.startsWith('/notifications/') || path === '/settings';
    if (!apiPath) { await route.continue(); return; }
    const method = route.request().method();
    if (method === 'OPTIONS') { await route.fulfill({ status: 200, headers }); return; }
    let body: unknown = {};
    let status = 200;
    if (path === '/users/me' || path === '/auth/login') body = user;
    if (path === '/auth/stream-token') body = { token: 'test', expires_in: 3600 };
    if (path.startsWith('/notifications/')) {
      if (failure) { await route.fulfill({ status: failure, json: { detail: 'test error' }, headers }); return; }
      const kind = path.split('/')[2];
      if (method === 'GET') body = { [kind]: lists[kind] || [] };
      else {
        mutations.push(method + ' ' + path);
        if (method === 'POST' && lists[kind]) {
          body = { ...route.request().postDataJSON(), id: `new-${lists[kind].length}` };
          lists[kind].push(body as Record<string, unknown>); status = 201;
        }
      }
    }
    await route.fulfill({ status, json: body, headers });
  });
  await page.routeWebSocket('**/ws/**', () => {});
  return { lists, mutations };
}

test('user views shared recipients, adds both channels and sees them after reload', async ({ page }) => {
  const state = await setup(page, 'user');
  await page.goto('/dashboard/notifications');
  await expect(page.getByText('Existing Team')).toBeVisible();
  await expect(page.getByRole('button', { name: /^(Test|Thử nghiệm|Kiểm tra|Edit|Sửa|Delete|Xóa)$/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^(System Configuration|Cấu hình hệ thống)$/i })).toHaveCount(0);
  await page.getByRole('button', { name: /^(Add Account|Thêm tài khoản)$/ }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox').nth(0).fill('My Telegram');
  await dialog.getByRole('textbox').nth(1).fill('-234567');
  await dialog.getByRole('button', { name: /^(Save|Lưu)$/ }).click();
  await expect(page.getByText('My Telegram')).toBeVisible();
  await page.getByRole('button', { name: /^(Notification Groups|Nhóm nhận tin)$/ }).click();
  await page.getByRole('button', { name: /^(Create Group|Tạo nhóm)$/ }).click();
  dialog = page.getByRole('dialog');
  await dialog.locator('label').filter({ hasText: /^\s*Zalo\s*$/ }).click();
  await dialog.getByRole('textbox').nth(0).fill('My Zalo Group');
  await dialog.getByRole('textbox').nth(1).fill('987654321');
  await dialog.getByRole('button', { name: /^(Save|Lưu)$/ }).click();
  await expect(page.getByText('My Zalo Group')).toBeVisible();
  await page.reload();
  await expect(page.getByText('My Telegram')).toBeVisible();
  expect(state.lists.groups[0].channel).toBe('zalo');
  expect(state.mutations).toEqual(['POST /notifications/accounts', 'POST /notifications/groups']);
});

test('admin retains management and test controls', async ({ page }) => {
  await setup(page, 'admin');
  await page.goto('/dashboard/notifications');
  await expect(page.getByText('Existing Team')).toBeVisible();
  await expect(page.getByRole('button', { name: /^(Test|Thử nghiệm|Kiểm tra)$/ })).toBeEnabled();
  await expect(page.getByRole('button', { name: /^(Edit|Sửa)$/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^(Delete|Xóa)$/ })).toBeVisible();
});

for (const status of [403, 404, 503]) {
  test(`recipient HTTP ${status} displays an error`, async ({ page }) => {
    await setup(page, 'user', status);
    await page.goto('/dashboard/notifications');
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByRole('button', { name: /^(Add Account|Thêm tài khoản)$/ })).toBeVisible();
  });
}
