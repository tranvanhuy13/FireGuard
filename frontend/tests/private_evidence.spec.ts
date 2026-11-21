import { test, expect } from '@playwright/test';

test.use({ video: 'off', ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });

test('Fire Alert downloads signed camera/video evidence directly and handles expiration', async ({ page }) => {
  const actor = { id: 1, username: 'owner', email: 'test@example.com', role: 'user', is_active: true };
  await page.addInitScript(user => {
    sessionStorage.setItem('auth_header', 'Basic dGVzdDp0ZXN0');
    sessionStorage.setItem('user_profile', JSON.stringify(user));
  }, actor);
  let expired = false;
  let downloads = 0;
  let issued = 0;
  const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
  await page.route(/.*(18080|:8000)\/.*/, async route => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 200, headers });
    const path = new URL(route.request().url()).pathname;
    let body: unknown = {};
    if (path === '/users/me' || path === '/auth/login') body = actor;
    if (path === '/auth/stream-token') body = { token: 'private-stream-token', expires_in: 3600 };
    if (path === '/cameras') body = { cameras: [] };
    if (path === '/stats') body = { stats: [] };
    if (path === '/settings') body = { settings: {} };
    if (path === '/alerts') body = { alerts: [
      { id: 1, timestamp: '2026-11-12 12:00:00', type: 'fire', confidence: .95, source_kind: 'camera',
        camera_name: 'Private camera', snapshot: '/snapshots/own.jpg' },
      { id: 2, timestamp: '2026-11-12 12:01:00', type: 'smoke', confidence: .85, source_kind: 'video',
        video_name: 'my-video.mp4', video_time: 12.5, snapshot: '/snapshots/video.jpg' },
    ] };
    if (path.startsWith('/snapshot-access/')) {
      expect(route.request().headers().authorization).toBe('Basic dGVzdDp0ZXN0');
      issued++;
      if (expired) return route.fulfill({ status: 410, json: { detail: 'Snapshot expired' }, headers });
      body = { url: `https://storage.example/${path.split('/').pop()}?signature=disposable`, expires_in: 20 };
    }
    await route.fulfill({ json: body, headers });
  });
  await page.route('https://storage.example/**', async route => {
    downloads++;
    expect(route.request().headers().authorization).toBeUndefined();
    expect(route.request().url()).not.toContain('private-stream-token');
    await route.fulfill({ contentType: 'image/png', body: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64') });
  });
  await page.routeWebSocket('**/ws/**', () => {});
  await page.clock.install();
  await page.goto('/dashboard');
  await expect(page.getByText('Private camera', { exact: true })).toBeVisible();
  await expect(page.getByText(/Video: my-video.mp4 \(12.5s\)/)).toBeVisible();
  await expect.poll(() => downloads).toBeGreaterThanOrEqual(2);
  await expect(page.getByAltText('thumb').first()).toHaveAttribute('src', /^https:\/\/storage\.example\//);
  await page.getByAltText('thumb').first().click();
  await expect(page.getByAltText('Event Snapshot')).toBeVisible();
  expired = true;
  const before = issued;
  await page.clock.fastForward(6000);
  await expect.poll(() => issued).toBeGreaterThan(before);
  await expect(page.getByText(/Ảnh đã hết thời hạn lưu trữ|Image retention expired/).first()).toBeVisible();
});
