import { test, expect } from '@playwright/test';

test.use({ video: 'off', ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });

test('history debounces search and reuses a recently visited page', async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('auth_header', 'Bearer offline-session');
    sessionStorage.setItem('user_profile', JSON.stringify({ id: '1', username: 'admin', role: 'admin' }));
  });
  const queries: URLSearchParams[] = [];
  await page.route('http://127.0.0.1:18080/**', async route => {
    const url = new URL(route.request().url());
    let body: unknown = {};
    if (url.pathname === '/users/me') body = { id: 1, username: 'admin', role: 'admin', is_active: true };
    if (url.pathname === '/auth/stream-token') body = { token: 'offline-media', expires_in: 3600 };
    if (url.pathname === '/history') {
      queries.push(url.searchParams);
      const offset = Number(url.searchParams.get('offset'));
      body = { events: [{ id: offset + 1, timestamp: '2026-11-22T00:00:00Z', camera_name: `Camera ${offset + 1}`,
        type: 'fire', confidence: .9, status: 'new' }], total: 25, max_id: 25 };
    }
    await route.fulfill({ json: body, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } });
  });
  await page.goto('/dashboard/history');
  await expect(page.getByText('Camera 1', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByText('Camera 11', { exact: true })).toBeVisible();
  const count = queries.length;
  await page.getByRole('button', { name: 'Prev', exact: true }).click();
  await expect(page.getByText('Camera 1', { exact: true })).toBeVisible();
  expect(queries.length).toBe(count);
  const search = page.getByPlaceholder('Search...');
  await search.pressSequentially('Camera', { delay: 30 });
  await expect.poll(() => queries.at(-1)?.get('search')).toBe('Camera');
  expect(queries.filter(query => query.get('search'))).toHaveLength(1);
});

test('audit requests server pages, debounces filters and exports all matching records', async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('auth_header', 'Bearer offline-session');
    sessionStorage.setItem('user_profile', JSON.stringify({ id: '1', username: 'admin', role: 'admin' }));
  });
  const queries: URLSearchParams[] = [];
  await page.route('http://127.0.0.1:18080/**', async route => {
    const url = new URL(route.request().url());
    let body: unknown = {};
    if (url.pathname === '/users/me') body = { id: 1, username: 'admin', role: 'admin', is_active: true };
    if (url.pathname === '/auth/stream-token') body = { token: 'offline-media', expires_in: 3600 };
    if (url.pathname === '/audit-log') {
      queries.push(url.searchParams);
      const offset = Number(url.searchParams.get('offset'));
      const limit = Number(url.searchParams.get('limit'));
      const all = Array.from({ length: 25 }, (_, i) => ({ id: i + 1, username: `operator-${i + 1}`,
        timestamp: '2026-11-22T00:00:00Z', action: 'camera.add', target: `camera:${i + 1}` }));
      body = { logs: all.slice(offset, offset + limit), total: 25, max_id: 25 };
    }
    await route.fulfill({ json: body, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } });
  });
  await page.goto('/dashboard/audit-log');
  await expect(page.getByText('operator-1', { exact: true })).toBeVisible();
  expect(queries.at(-1)?.get('limit')).toBe('10');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByText('operator-11', { exact: true })).toBeVisible();
  await page.locator('input[type=text]').pressSequentially('operator', { delay: 30 });
  await expect.poll(() => queries.at(-1)?.get('search')).toBe('operator');
  expect(queries.filter(query => query.get('search'))).toHaveLength(1);
  expect(queries.at(-1)?.get('offset')).toBe('0');
  await expect(page.getByText('operator-1', { exact: true })).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: /Export|Xuất/i }).click();
  await download;
  expect(queries.at(-1)?.get('limit')).toBe('500');
  expect(queries.at(-1)?.get('search')).toBe('operator');
});
