import { test, expect, type Page } from '@playwright/test';

test.use({ video: 'off', ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
const actor = { id: 1, username: 'operator', email: 'test@example.com', role: 'admin', is_active: true };
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');

async function session(page: Page) {
  await page.addInitScript(user => {
    sessionStorage.setItem('auth_header', 'Basic dGVzdDp0ZXN0');
    sessionStorage.setItem('user_profile', JSON.stringify(user));
    localStorage.setItem('language', 'en');
  }, actor);
}

test.describe('real monitoring', () => {
  test.skip(!!process.env.TEST_DEMO, 'Real-camera server required');

  test('real HLS uses backend AI feed, hides live clock on image error and stale capture', async ({ page }) => {
    await session(page);
    let imageWorks = false;
    let fresh = true;
    await page.route(/.*(18080|:8000)\/.*/, async route => {
      const path = new URL(route.request().url()).pathname;
      const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
      if (path.startsWith('/video_feed/')) {
        if (!imageWorks) return route.fulfill({ status: 503, headers });
        return route.fulfill({ headers, contentType: 'image/png', body: png });
      }
      let body: unknown = {};
      if (path === '/users/me') body = actor;
      if (path === '/auth/stream-token') body = { token: 'same-token', expires_in: 3600 };
      if (path === '/cameras') body = { cameras: [{ id: 1, name: 'Real HLS', source: 'https://camera.example/live.m3u8', is_active: true, status: 'connected' }] };
      if (path === '/alerts') body = { alerts: [] };
      if (path === '/stats') body = { stats: [] };
      if (path === '/settings') body = { settings: {} };
      await route.fulfill({ headers, json: body });
    });
    await page.routeWebSocket('**/ws/**', socket => {
      if (!socket.url().includes('/ws/detections')) return;
      const timer = setInterval(() => socket.send(JSON.stringify({ cameras: [{ camera_id: 1,
        generation: 0, capture_frame_id: 4, frame_fresh: fresh, frame_age_ms: fresh ? 30 : 9000,
        stale: false, confirmed: [], detections: [], latency_ms: 20 }] })), 200);
      socket.onClose(() => clearInterval(timer));
    });
    await page.goto('/dashboard');
    const tile = page.locator('#cam-container-1');
    await expect(tile.locator('video')).toHaveCount(0);
    await expect(tile.getByRole('img', { name: 'Real HLS' })).toHaveAttribute('src', /\/video_feed\/1\?/);
    await expect(tile.getByText('No fresh picture', { exact: true })).toBeVisible();
    await expect(tile.locator('[title^="Viewer system time"]')).toHaveCount(0);
    imageWorks = true;
    await expect(tile.locator('[title^="Viewer system time"]')).toBeVisible({ timeout: 15000 });
    fresh = false;
    await expect(tile.getByText('No fresh picture', { exact: true })).toBeVisible();
    fresh = true;
    await expect(tile.locator('[title^="Viewer system time"]')).toBeVisible();
  });

  test('camera editor sends the chosen source and keeps the dialog open on rejection', async ({ page }) => {
    await session(page);
    let submitted: unknown;
    await page.route(/.*(18080|:8000)\/.*/, async route => {
      const path = new URL(route.request().url()).pathname;
      const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
      if (path === '/cameras' && route.request().method() === 'POST') {
        submitted = route.request().postDataJSON();
        return route.fulfill({ status: 422, headers, json: { detail: 'Invalid source' } });
      }
      const body = path === '/users/me' ? actor : path === '/auth/stream-token' ? { token: 'same-token', expires_in: 3600 } : { cameras: [] };
      await route.fulfill({ headers, json: body });
    });
    await page.goto('/dashboard/cameras');
    await page.getByRole('button', { name: 'Add Camera', exact: true }).first().click();
    await page.getByPlaceholder('Main Gate').fill('Gate');
    await page.getByRole('textbox', { name: 'Source' }).fill('rtsp://camera.local/live');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(() => submitted).toEqual({ name: 'Gate', source: 'rtsp://camera.local/live', is_active: false });
    await expect(page.getByRole('alert').filter({ hasText: 'Unable to save camera' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Source' })).toBeVisible();
    await expect(page.getByText('Connection successful', { exact: true })).toHaveCount(0);
  });

  test('detection socket reconnects after a policy close with an unchanged token', async ({ page }) => {
    await session(page);
    let connections = 0;
    await page.route(/.*(18080|:8000)\/.*/, route => {
      const path = new URL(route.request().url()).pathname;
      const body = path === '/users/me' ? actor : path === '/auth/stream-token'
        ? { token: 'same-token', expires_in: 3600 } : path === '/cameras'
          ? { cameras: [{ id: 1, name: 'Socket camera', source: '0', is_active: true, status: 'connected' }] }
          : path === '/alerts' ? { alerts: [] } : path === '/stats' ? { stats: [] } : {};
      return route.fulfill({ headers: { 'access-control-allow-origin': '*' }, json: body });
    });
    await page.routeWebSocket('**/ws/**', socket => {
      if (!socket.url().includes('/ws/detections')) return;
      connections++;
      if (connections === 1) { socket.close({ code: 1008, reason: 'Refresh credential' }); return; }
      const timer = setInterval(() => socket.send(JSON.stringify({ cameras: [{ camera_id: 1,
        stale: false, confirmed: [], detections: [], frame_fresh: true, frame_age_ms: 10 }] })), 200);
      socket.onClose(() => clearInterval(timer));
    });
    await page.goto('/dashboard');
    await expect.poll(() => connections).toBeGreaterThanOrEqual(2);
    await expect(page.getByText('AI: no fire or smoke detected', { exact: false })).toBeVisible();
  });
});

test.describe('demo monitoring', () => {
  test.skip(!process.env.TEST_DEMO, 'Demo-camera server required');

  test('a native HLS stream retries more than once after repeated failure', async ({ page }) => {
    await session(page);
    await page.addInitScript(() => {
      const attempts: Record<string, number> = {};
      Object.defineProperty(window, '__hlsAttempts', { value: attempts });
      HTMLMediaElement.prototype.canPlayType = () => 'probably';
      HTMLMediaElement.prototype.play = function () {
        const name = this.getAttribute('aria-label') || '';
        attempts[name] = (attempts[name] || 0) + 1;
        queueMicrotask(() => this.dispatchEvent(new Event('error')));
        return Promise.resolve();
      };
    });
    await page.route(/.*(18080|:8000)\/.*/, route => {
      const path = new URL(route.request().url()).pathname;
      return route.fulfill({ headers: { 'access-control-allow-origin': '*' }, json: path === '/users/me' ? actor : { token: 'same-token', expires_in: 3600 } });
    });
    await page.route('https://**/*', route => route.abort());
    await page.routeWebSocket('**/ws/**', () => {});
    await page.clock.install();
    await page.goto('/dashboard');
    const attempts = () => page.evaluate(() => (window as unknown as { __hlsAttempts: Record<string, number> }).__hlsAttempts['Demo - Big Buck Bunny (test)'] || 0);
    await expect.poll(attempts).toBeGreaterThanOrEqual(1);
    await page.clock.fastForward(16000);
    await expect.poll(attempts).toBeGreaterThanOrEqual(2);
    await page.clock.fastForward(16000);
    await expect.poll(attempts).toBeGreaterThanOrEqual(3);
  });
});
