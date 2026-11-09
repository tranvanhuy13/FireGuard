import { test, expect } from '@playwright/test';

// Run against a dedicated frontend on 18030, API origin 18080; no live backend.
test.use({ video: 'off', ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });

test('history reaches old records, resets filtered pages and persists status contract', async ({ page }) => {
  const actor = { id: 1, username: 'reviewer', email: 'test@example.com', role: 'admin', is_active: true };
  await page.addInitScript(user => {
    sessionStorage.setItem('auth_header', 'Basic dGVzdDp0ZXN0');
    sessionStorage.setItem('user_profile', JSON.stringify(user));
  }, actor);
  let updated = false;
  const offsets: number[] = [];
  await page.route('http://127.0.0.1:18080/**', async route => {
    const url = new URL(route.request().url());
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
    let body: unknown = {};
    if (url.pathname === '/users/me') body = actor;
    if (url.pathname === '/auth/stream-token') body = { token: 'same-token', expires_in: 3600 };
    if (url.pathname === '/history') {
      const offset = Number(url.searchParams.get('offset'));
      const limit = Number(url.searchParams.get('limit'));
      offsets.push(offset);
      const filtered = Boolean(url.searchParams.get('search'));
      const all = Array.from({ length: filtered ? 1 : 65 }, (_, i) => ({ id: i + 1,
        camera_id: i + 1, camera_name: `Review camera ${i + 1}`, type: 'fire', confidence: 0.9,
        timestamp: '2026-11-09T12:00:00Z', status: updated ? 'confirmed' : 'new', snapshot_path: null }));
      body = { events: all.slice(offset, offset + limit), total: all.length, max_id: 65 };
    }
    if (url.pathname === '/alerts/1/status') {
      expect(route.request().method()).toBe('PATCH');
      expect(route.request().postDataJSON()).toEqual({ status: 'confirmed' });
      updated = true;
      body = { status: 'confirmed', handled_by: 'reviewer' };
    }
    await route.fulfill({ json: body, headers });
  });
  await page.routeWebSocket('**/ws/**', () => {});
  await page.goto('/dashboard/history');
  await expect(page.getByText('Review camera 1', { exact: true })).toBeVisible();
  for (let i = 0; i < 6; i++) {
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect.poll(() => offsets.at(-1)).toBe((i + 1) * 10);
  }
  await expect(page.getByText('Review camera 65', { exact: true })).toBeVisible();
  await page.getByPlaceholder('Search...').fill('Review camera 1');
  await expect(page.getByText('Review camera 1', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeDisabled();
  await page.getByRole('row').filter({ hasText: 'Review camera 1' }).click();
  await page.getByRole('button', { name: /^(Confirm|Xác nhận)$/ }).click();
  await expect.poll(() => updated).toBe(true);
  await expect(page.getByRole('button', { name: /^(Confirm|Xác nhận)$/ })).toHaveCount(0);
});

test('camera image retries even when refreshed token remains the same', async ({ page }) => {
  const actor = { id: 1, username: 'reviewer', email: 'test@example.com', role: 'admin', is_active: true };
  await page.addInitScript(user => {
    sessionStorage.setItem('auth_header', 'Basic dGVzdDp0ZXN0');
    sessionStorage.setItem('user_profile', JSON.stringify(user));
  }, actor);
  let frames = 0;
  await page.route('http://127.0.0.1:18080/**', async route => {
    const path = new URL(route.request().url()).pathname;
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
    if (path.startsWith('/video_feed/')) {
      frames++;
      if (frames === 1) return route.fulfill({ status: 503, headers });
      return route.fulfill({ contentType: 'image/png', headers,
        body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64') });
    }
    let body: unknown = {};
    if (path === '/users/me') body = actor;
    if (path === '/auth/stream-token') body = { token: 'same-token', expires_in: 3600 };
    if (path === '/cameras') body = { cameras: [{ id: 1, name: 'Recovery camera', source: '0', is_active: true, status: 'connected' }] };
    if (path === '/alerts') body = { alerts: [] };
    if (path === '/stats') body = { stats: [] };
    if (path === '/settings') body = { settings: {} };
    await route.fulfill({ json: body, headers });
  });
  await page.routeWebSocket('**/ws/**', () => {});
  await page.goto('/dashboard');
  await expect.poll(() => frames, { timeout: 15000 }).toBeGreaterThanOrEqual(2);
  const image = page.getByRole('img', { name: 'Recovery camera', exact: true });
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0);
});
