import { test, expect, type Route } from '@playwright/test';

// All backend traffic is intercepted, never sent to Aiven.
test.use({ video: 'off', ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });

test('slow history does not block dashboard; recovery preserves live alerts', async ({ page }) => {
  let historyReady = false;
  let cameraRequests = 0;
  const pending: Route[] = [];
  const profile = { id: 1, username: 'connectiontest', email: 'test@example.com', role: 'admin', is_active: true };
  await page.addInitScript(user => {
    sessionStorage.setItem('auth_header', 'Basic dGVzdDp0ZXN0');
    sessionStorage.setItem('user_profile', JSON.stringify(user));
  }, profile);
  const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
  await page.route(/.*(18080|:8000)\/.*/, async route => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 200, headers }); return;
    }
    let body: unknown = {};
    if (path === '/users/me' || path === '/auth/login') body = profile;
    if (path === '/auth/stream-token') body = { token: 'test', expires_in: 3600 };
    if (path === '/alerts') {
      if (!historyReady) { pending.push(route); return; }
      body = { alerts: [] };
    }
    if (path === '/cameras') { cameraRequests++; body = { cameras: [] }; }
    if (path === '/stats') body = { stats: [] };
    if (path === '/settings') body = { settings: {} };
    await route.fulfill({ json: body, headers });
  });
  await page.routeWebSocket('**/ws/**', socket => {
    if (socket.url().includes('/ws/alerts')) {
      socket.send(JSON.stringify({ id: 99, timestamp: '2026-10-30 12:00:00', type: 'fire', confidence: 0.95 }));
    }
  });
  const alertStatus = page.getByRole('status').filter({ hasText: /alert history|lịch sử/i });
  page.on('requestfailed', request => {
    const idx = pending.findIndex(route => route.request() === request);
    if (idx !== -1) pending.splice(idx, 1);
  });
  await page.clock.install();
  await page.goto('/dashboard');
  await expect.poll(() => pending.length).toBeGreaterThan(0);
  await expect(alertStatus).toBeVisible();
  await expect(page.getByText('Connection Error', { exact: true })).toHaveCount(0);
  // Advance beyond both the former 8-second timeout and the new request timeout.
  await page.clock.fastForward(31000);
  await expect(alertStatus).toBeVisible();
  await expect(page.getByRole('button', { name: /Thử lại|Retry/, exact: true })).toBeVisible();
  historyReady = true;
  for (const route of pending.splice(0)) await route.fulfill({ json: { alerts: [] }, headers });
  await page.getByRole('button', { name: /Thử lại|Retry/, exact: true }).click();
  await expect(alertStatus).toHaveCount(0);
  const detections = page.getByText(/TOTAL DETECTIONS|TỔNG SỐ PHÁT HIỆN/, { exact: true }).locator('..');
  await expect(detections.getByText('1', { exact: true })).toBeVisible();
  expect(cameraRequests).toBeGreaterThan(0);
  await expect(page).toHaveURL(/\/dashboard$/);
});
