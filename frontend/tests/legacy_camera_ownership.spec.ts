import { test, expect, type Page } from '@playwright/test';

test.use({ video: 'off', ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });

async function legacySession(page: Page, role: 'user' | 'admin' = 'user') {
  const actor = { id: 2, username: 'huy13', email: 'test@example.com', role, is_active: true };
  let owned = false;
  let failure = 0;
  let active = false;
  await page.addInitScript(profile => {
    sessionStorage.setItem('auth_header', 'Basic dGVzdDp0ZXN0');
    sessionStorage.setItem('user_profile', JSON.stringify(profile));
    localStorage.setItem('language', 'en');
  }, actor);
  await page.route('http://127.0.0.1:18080/**', async route => {
    const path = new URL(route.request().url()).pathname;
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 200, headers });
    if (path === '/cameras' && failure) return route.fulfill({ status: failure, headers, json: { detail: 'Unavailable' } });
    if (path.endsWith('/toggle')) {
      active = new URL(route.request().url()).searchParams.get('active') === 'true';
      return route.fulfill({ headers, json: { status: 'ok' } });
    }
    const body = path === '/users/me' || path === '/auth/login' ? actor
      : path === '/auth/stream-token' ? { token: 'legacy-test', expires_in: 3600 }
      : path === '/cameras' ? { cameras: owned ? [{ id: 1, name: 'Legacy Camera', source: '0', is_active: active, status: 'disconnected' }] : [] }
      : path === '/alerts' ? { alerts: [] } : path === '/stats' ? { stats: [] } : { settings: {} };
    await route.fulfill({ headers, json: body });
  });
  await page.routeWebSocket('**/ws/**', () => {});
  return { assign: () => { owned = true; }, fail: (status: number) => { failure = status; } };
}

for (const role of ['user', 'admin'] as const) {
  test(`${role} with no owned cameras gets guidance and working Add actions`, async ({ page }) => {
    await legacySession(page, role);
    await page.goto('/dashboard');
    await expect(page.getByText('No cameras assigned to your account', { exact: true })).toBeVisible();
    await expect(page.getByText(/contact an administrator to restore access/)).toBeVisible();
    await page.getByRole('button', { name: 'Add Camera', exact: true }).click();
    await expect(page.getByPlaceholder('Camera Name')).toBeVisible();
    await page.goto('/dashboard/cameras');
    await expect(page.getByText('No cameras assigned to your account', { exact: true })).toBeVisible();
    await page.getByRole('status').getByRole('button', { name: 'Add Camera', exact: true }).click();
    await expect(page.getByPlaceholder('Main Gate')).toBeVisible();
  });
}

test('legacy user sees power controls after explicit ownership assignment', async ({ page }) => {
  const state = await legacySession(page);
  await page.goto('/dashboard');
  await expect(page.getByText('No cameras assigned to your account', { exact: true })).toBeVisible();
  state.assign();
  await page.reload();
  const power = page.getByRole('switch', { name: 'Camera power: Legacy Camera', exact: true });
  await expect(power).toBeVisible();
  await power.click();
  await expect(power).toBeChecked();
  await page.goto('/dashboard/cameras');
  await expect(power).toBeChecked();
  await page.getByPlaceholder('Search cameras...').fill('missing');
  await expect(page.getByText('No cameras match these filters.')).toBeVisible();
  await expect(page.getByText('No cameras assigned to your account')).toHaveCount(0);
});

for (const status of [403, 503]) {
  test(`camera HTTP ${status} is not shown as an empty account`, async ({ page }) => {
    const state = await legacySession(page);
    state.fail(status);
    await page.goto('/dashboard');
    const text = status === 403 ? 'Your session or permissions could not be verified. Sign in again or contact an administrator.' : 'Unable to load cameras. Please retry.';
    await expect(page.getByText(text, { exact: true })).toBeVisible();
    await expect(page.getByText('No cameras assigned to your account')).toHaveCount(0);
    await page.goto('/dashboard/cameras');
    await expect(page.getByRole('alert').filter({ hasText: text })).toHaveText(text);
    await expect(page.getByText('No cameras assigned to your account')).toHaveCount(0);
  });
}
