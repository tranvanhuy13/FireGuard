import { test, expect, type Page, type Locator } from '@playwright/test';

test.use({ viewport: { width: 1440, height: 960 }, video: 'off', ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');

async function mockDashboard(page: Page, role: 'user' | 'admin', active = false) {
  const actor = { id: 1, username: 'layout', email: 'test@example.com', role, is_active: true };
  const cameras = Array.from({ length: 26 }, (_, i) => ({ id: i + 1, name: `Camera ${i + 1}`,
    source: '0', is_active: i === 0 && active, status: i === 0 && active ? 'connected' : 'disconnected' }));
  const toggles: boolean[] = [];
  let rejectToggle = false;
  let imageRequests = 0;
  await page.addInitScript(user => {
    sessionStorage.setItem('auth_header', 'Basic dGVzdDp0ZXN0');
    sessionStorage.setItem('user_profile', JSON.stringify(user));
    localStorage.setItem('language', 'en');
  }, actor);
  await page.route(/.*(18080|:8000)\/.*/, async route => {
    const url = new URL(route.request().url());
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 200, headers });
    if (url.pathname.startsWith('/video_feed/')) {
      imageRequests++;
      return route.fulfill({ contentType: 'image/png', body: png, headers });
    }
    if (/\/cameras\/\d+\/toggle/.test(url.pathname)) {
      expect(route.request().headers().authorization).toBe('Basic dGVzdDp0ZXN0');
      const enabled = url.searchParams.get('active') === 'true';
      toggles.push(enabled);
      if (rejectToggle) return route.fulfill({ status: 403, json: { detail: 'Denied' }, headers });
      const camera = cameras.find(camera => camera.id === Number(url.pathname.split('/')[2]))!;
      camera.is_active = enabled;
      camera.status = enabled ? 'connected' : 'disconnected';
      return route.fulfill({ json: { status: 'ok' }, headers });
    }
    const body = url.pathname === '/users/me' || url.pathname === '/auth/login' ? actor
      : url.pathname === '/auth/stream-token' ? { token: 'layout-token', expires_in: 3600 }
      : url.pathname === '/cameras' ? { cameras }
      : url.pathname === '/alerts' ? { alerts: [] }
      : url.pathname === '/stats' ? { stats: [] } : { settings: {} };
    await route.fulfill({ json: body, headers });
  });
  await page.routeWebSocket('**/ws/**', socket => {
    if (socket.url().includes('/ws/detections')) socket.send(JSON.stringify({ cameras: [{ camera_id: 1,
      frame_fresh: true, stale: false, confirmed: [], detections: [] }] }));
  });
  await page.goto('/dashboard');
  await expect(page.getByRole('switch', { name: 'Camera power: Camera 1', exact: true })).toBeVisible();
  return { toggles, reject: () => { rejectToggle = true; }, requests: () => imageRequests };
}

async function drag(page: Page, handle: Locator, dx: number, dy: number) {
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 8 });
  await page.mouse.up();
}

for (const role of ['user', 'admin'] as const) {
  test(`${role} can toggle cameras in every layout without auto-activation`, async ({ page }) => {
    const api = await mockDashboard(page, role);
    const wall = page.getByTestId('live-camera-panel');
    for (const count of [4, 9, 16, 25]) {
      await page.getByRole('button', { name: `${count} CAM`, exact: true }).click();
      await expect(wall.getByRole('switch')).toHaveCount(count);
      for (const control of await wall.getByRole('switch').all()) {
        await expect(control).toBeVisible();
        const visible = await control.evaluate(element => {
          const box = element.getBoundingClientRect();
          const tile = element.closest('[id^="cam-container-"]')!.getBoundingClientRect();
          return box.left >= tile.left && box.right <= tile.right && box.top >= tile.top && box.bottom <= tile.bottom;
        });
        expect(visible).toBe(true);
      }
    }
    expect(api.toggles).toEqual([]);
    await page.getByRole('button', { name: 'Next camera page' }).click();
    await expect(wall.getByRole('switch', { name: 'Camera power: Camera 26', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Previous camera page' }).click();
    const power = page.getByRole('switch', { name: 'Camera power: Camera 1', exact: true });
    await power.click();
    await expect(power).toBeChecked();
    page.once('dialog', dialog => dialog.accept());
    await power.click();
    await expect(power).not.toBeChecked();
    expect(api.toggles).toEqual([true, false]);
    api.reject();
    page.once('dialog', dialog => dialog.accept());
    await power.click();
    await expect(power).not.toBeChecked();
  });
}

for (const role of ['user', 'admin'] as const) {
  test(`${role} sees and operates camera power in grid and table management views`, async ({ page }) => {
    const api = await mockDashboard(page, role);
    await page.goto('/dashboard/cameras');
    const power = page.getByRole('switch', { name: 'Camera power: Camera 1', exact: true });
    await expect(power).toBeVisible();
    await expect(power).not.toBeChecked();
    await power.click();
    await expect(power).toBeChecked();
    await page.getByRole('button', { name: /table/i }).click();
    await expect(power).toBeVisible();
    page.once('dialog', dialog => dialog.accept());
    await power.click();
    await expect(power).not.toBeChecked();
    expect(api.toggles).toEqual([true, false]);
  });
}

test('splitters expand the camera area, support keyboard and preserve the stream', async ({ page }) => {
  const api = await mockDashboard(page, 'user', true);
  const camera = page.getByTestId('live-camera-panel');
  const image = page.locator('#cam-container-1 img');
  await expect(image).toBeVisible();
  await image.evaluate(element => { element.setAttribute('data-retained-stream', 'yes'); });
  const before = (await camera.boundingBox())!;
  const alerts = page.getByRole('separator', { name: 'Resize alerts panel' });
  await drag(page, alerts, 120, 0);
  expect((await camera.boundingBox())!.width).toBeGreaterThan(before.width + 60);
  const stats = page.getByRole('separator', { name: 'Resize statistics panel' });
  await drag(page, stats, 0, 75);
  expect((await camera.boundingBox())!.height).toBeGreaterThan(before.height + 30);
  const daily = page.getByRole('separator', { name: 'Resize daily count panel' });
  await daily.focus();
  await daily.press('End');
  await expect(daily).toHaveAttribute('aria-valuenow', '40');
  await alerts.focus();
  await alerts.press('Home');
  await expect(alerts).toHaveAttribute('aria-valuenow', '18');
  const sidebar = page.getByRole('separator', { name: 'Resize navigation sidebar' });
  await drag(page, sidebar, -50, 0);
  await expect(sidebar).toHaveAttribute('aria-valuenow', '206');
  await page.getByRole('button', { name: 'Expand camera area' }).click();
  await expect(page.locator('#monitoring-alerts')).toBeHidden();
  await expect(page.locator('#monitoring-stats')).toBeHidden();
  expect((await camera.boundingBox())!.width).toBeGreaterThan(before.width + 150);
  await expect(image).toHaveAttribute('data-retained-stream', 'yes');
  await page.getByRole('button', { name: 'Restore panels' }).click();
  await expect(page.locator('#monitoring-alerts')).toBeVisible();
  await page.getByRole('button', { name: 'Reset layout' }).click();
  await expect(alerts).toHaveAttribute('aria-valuenow', '30');
  await expect(stats).toHaveAttribute('aria-valuenow', '26');
  await expect(image).toHaveAttribute('data-retained-stream', 'yes');
  expect(api.requests()).toBe(1);
  await page.screenshot({ path: 'test-results/monitoring-layout.png' });
});

test('mobile keeps navigation and camera controls reachable without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockDashboard(page, 'user');
  await page.getByRole('button', { name: 'Close navigation' }).click();
  await expect(page.getByRole('switch', { name: 'Camera power: Camera 1', exact: true })).toBeVisible();
  await expect(page.getByRole('separator', { name: 'Resize alerts panel' })).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
