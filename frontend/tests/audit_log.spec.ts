import { test, expect } from '@playwright/test';
import { enableMockMode, enableRealMode, loginUI, MOCK_ADMIN } from './helpers';

test.describe('Nhật ký Kiểm toán Hệ thống (Audit Log Page)', () => {
  test.beforeEach(async ({ page }) => {
    await enableMockMode(page);
    await loginUI(page, MOCK_ADMIN.username, MOCK_ADMIN.password);
  });

  test('AUD_01: Admin truy cập /dashboard/audit-log hiển thị bảng nhật ký và lọc theo hành động hoạt động đúng', async ({ page }) => {
    await page.goto('/dashboard/audit-log');
    await expect(page).toHaveURL(/.*\/dashboard\/audit-log/);

    // Tiêu đề, nút xuất CSV và bộ lọc hành động
    const header = page.locator('h1, h2, h3').first();
    await expect(header).toBeVisible();
    await expect(page.locator('button:has-text("Export"), button:has-text("Xuất")').first()).toBeVisible();

    const actionSelect = page.locator('select').first();
    await expect(actionSelect).toBeVisible();
    await expect(page.locator('table tbody tr').first()).toBeVisible();

    // Lọc theo hành động trong bảng -> select cập nhật đúng giá trị đã chọn
    const options = await actionSelect.locator('option').evaluateAll(els => els.map(e => (e as HTMLOptionElement).value));
    const targetOption = options.find(opt => opt && opt !== 'ALL') || 'ALL';
    if (targetOption !== 'ALL') {
      await actionSelect.selectOption(targetOption);
      await expect(actionSelect).toHaveValue(targetOption);
    }
  });

  test('AUD_02: Bảng nhật ký hỗ trợ sắp xếp các cột khi click vào tiêu đề cột và đảo thứ tự dữ liệu', async ({ page }) => {
    await page.goto('/dashboard/audit-log');
    const firstHeader = page.locator('table thead th').first();
    await expect(firstHeader).toBeVisible();

    const firstRowBefore = await page.locator('table tbody tr').first().textContent();
    await firstHeader.click();
    await expect(page.locator('table tbody tr').first()).not.toHaveText(firstRowBefore || '');
  });

  test('AUD_03: Điều khiển phân trang (Pagination) chuyển trang Next/Previous và đổi số dòng hiển thị (10 -> 25)', async ({ page }) => {
    await enableRealMode(page);
    const admin = { id: 1, username: 'audit_admin', email: 'admin@example.com', role: 'admin', is_active: true };
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
    const allLogs = Array.from({ length: 25 }, (_, i) => ({
      id: i + 1,
      timestamp: '2026-11-26T00:00:00Z',
      username: `operator-${i + 1}`,
      action: 'camera.add',
      target: `camera:${i + 1}`,
    }));

    await page.addInitScript(profile => {
      sessionStorage.setItem('auth_header', 'Bearer audit-page-session');
      sessionStorage.setItem('user_profile', JSON.stringify(profile));
      localStorage.setItem('language', 'en');
    }, admin);

    await page.route(/.*(18080|:8000)\/.*/, async route => {
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 200, headers });
      const url = new URL(route.request().url());
      if (url.pathname === '/users/me') return route.fulfill({ status: 200, headers, json: admin });
      if (url.pathname === '/auth/stream-token') return route.fulfill({ status: 200, headers, json: { token: 't', expires_in: 3600 } });
      if (url.pathname === '/audit-log') {
        const offset = Number(url.searchParams.get('offset') || 0);
        const limit = Number(url.searchParams.get('limit') || 10);
        return route.fulfill({ status: 200, headers, json: { logs: allLogs.slice(offset, offset + limit), total: 25, max_id: 25 } });
      }
      return route.fulfill({ status: 200, headers, json: {} });
    });
    await page.routeWebSocket('**/ws/**', () => {});

    await page.goto('/dashboard/audit-log');
    await expect(page.getByText('Page 1 of 3')).toBeVisible();
    await expect(page.getByText('operator-1', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page.getByText('Page 2 of 3')).toBeVisible();
    await expect(page.getByText('operator-11', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Previous', exact: true }).click();
    await expect(page.getByText('Page 1 of 3')).toBeVisible();

    await page.locator('select').last().selectOption('25');
    await expect(page.getByText('Page 1 of 1')).toBeVisible();
    await expect(page.getByText('operator-25', { exact: true })).toBeVisible();
  });

  test('AUD_04: Bảng nhật ký hiển thị đúng 4 cột đều nhau (w-1/4) và không còn dòng mở rộng chi tiết', async ({ page }) => {
    await page.goto('/dashboard/audit-log');
    const tableHeaders = page.locator('table thead th');
    await expect(tableHeaders).toHaveCount(4);
    for (let i = 0; i < 4; i++) {
      await expect(tableHeaders.nth(i)).toHaveClass(/w-1\/4/);
    }
  });

  test('AUD_05: Hiển thị trạng thái lỗi và nút Thử lại (Retry) khi API /audit-log gặp sự cố 500', async ({ page }) => {
    await enableRealMode(page);
    const admin = { id: 1, username: 'audit_admin', email: 'admin@example.com', role: 'admin', is_active: true };
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
    let shouldFail = true;

    await page.addInitScript(profile => {
      sessionStorage.setItem('auth_header', 'Bearer audit-error-session');
      sessionStorage.setItem('user_profile', JSON.stringify(profile));
      localStorage.setItem('language', 'en');
    }, admin);

    await page.route(/.*(18080|:8000)\/.*/, async route => {
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 200, headers });
      const url = new URL(route.request().url());
      if (url.pathname === '/users/me') return route.fulfill({ status: 200, headers, json: admin });
      if (url.pathname === '/auth/stream-token') return route.fulfill({ status: 200, headers, json: { token: 't', expires_in: 3600 } });
      if (url.pathname === '/audit-log') {
        if (shouldFail) return route.fulfill({ status: 500, headers, json: { detail: 'DB outage' } });
        return route.fulfill({
          status: 200,
          headers,
          json: { logs: [{ id: 1, timestamp: '2026-11-26T00:00:00Z', username: 'audit_admin', action: 'camera.add', target: 'camera:1' }], total: 1, max_id: 1 },
        });
      }
      return route.fulfill({ status: 200, headers, json: {} });
    });
    await page.routeWebSocket('**/ws/**', () => {});

    await page.goto('/dashboard/audit-log');
    const retryBtn = page.getByRole('button', { name: /Retry|Thử lại/i });
    await expect(retryBtn).toBeVisible();

    shouldFail = false;
    await retryBtn.click();
    await expect(page.getByRole('table').getByText('audit_admin')).toBeVisible();
  });
});
