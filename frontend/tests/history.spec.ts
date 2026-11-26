import { test, expect } from '@playwright/test';

test.describe('Lịch sử Sự cố & Báo cáo (Incident History Page)', () => {
  test.beforeEach(async ({ page }) => {
    const actor = { id: 1, username: 'history_admin', email: 'admin@example.com', role: 'admin', is_active: true };
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
    const allEvents = [
      { id: 101, camera_id: 1, camera_name: 'Camera Warehouse East', type: 'fire', confidence: 0.94, timestamp: '2026-11-25T10:00:00Z', status: 'new', snapshot_path: null, handled_by: null },
      { id: 102, camera_id: 2, camera_name: 'Lobby Entrance', type: 'smoke', confidence: 0.82, timestamp: '2026-11-25T11:00:00Z', status: 'confirmed', snapshot_path: null, handled_by: 'history_admin' },
    ];

    await page.addInitScript(profile => {
      sessionStorage.setItem('auth_header', 'Bearer history-test-session');
      sessionStorage.setItem('user_profile', JSON.stringify(profile));
      localStorage.setItem('language', 'en');
    }, actor);

    await page.route(/.*(18080|:8000)\/.*/, async route => {
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 200, headers });
      const url = new URL(route.request().url());
      if (url.pathname === '/users/me') return route.fulfill({ status: 200, headers, json: actor });
      if (url.pathname === '/auth/stream-token') return route.fulfill({ status: 200, headers, json: { token: 'hist-token', expires_in: 3600 } });
      if (url.pathname === '/history') {
        const q = (url.searchParams.get('search') || '').toLowerCase();
        const filtered = q ? allEvents.filter(e => e.camera_name.toLowerCase().includes(q)) : allEvents;
        return route.fulfill({ status: 200, headers, json: { events: filtered, total: filtered.length, max_id: 102 } });
      }
      if (url.pathname.startsWith('/alerts/') && url.pathname.endsWith('/status')) {
        return route.fulfill({ status: 200, headers, json: { status: 'confirmed', handled_by: 'history_admin' } });
      }
      return route.fulfill({ status: 200, headers, json: {} });
    });
    await page.routeWebSocket('**/ws/**', () => {});
  });

  test('HIS_01: Truy cập /dashboard/history hiển thị bảng sự cố và các công cụ lọc', async ({ page }) => {
    await page.goto('/dashboard/history');
    await expect(page).toHaveURL(/.*\/dashboard\/history/);

    await expect(page.locator('h1, h2, h3').first()).toBeVisible();
    await expect(page.getByPlaceholder('Search...')).toBeVisible();
    await expect(page.locator('select').first()).toBeVisible();
    await expect(page.getByRole('button', { name: /Export|Xuất/i })).toBeVisible();
    await expect(page.getByText('Camera Warehouse East')).toBeVisible();
    await expect(page.getByText('Lobby Entrance')).toBeVisible();
  });

  test('HIS_02: Lọc sự cố theo từ khóa tìm kiếm trong ô Search cập nhật đúng dữ liệu bảng', async ({ page }) => {
    await page.goto('/dashboard/history');
    await expect(page.getByText('Camera Warehouse East')).toBeVisible();
    await expect(page.getByText('Lobby Entrance')).toBeVisible();

    const searchInput = page.getByPlaceholder('Search...');
    await searchInput.fill('Warehouse');
    await expect(searchInput).toHaveValue('Warehouse');

    // Sau khi lọc, chỉ còn dòng khớp từ khóa hiển thị
    await expect(page.getByText('Camera Warehouse East')).toBeVisible();
    await expect(page.getByText('Lobby Entrance')).toHaveCount(0);
  });

  test('HIS_03: Mở modal xem chi tiết sự cố khi click vào dòng trong bảng và đóng modal', async ({ page }) => {
    await page.goto('/dashboard/history');
    const firstRow = page.locator('tbody tr').first();
    await expect(firstRow).toBeVisible();
    await firstRow.click();

    // Modal chi tiết hiển thị thông tin camera và nút thao tác
    const closeBtn = page.getByRole('button', { name: /Cancel|Hủy|Đóng/i });
    await expect(closeBtn).toBeVisible();
    await closeBtn.click();
    await expect(closeBtn).toHaveCount(0);
  });

  test('HIS_04: Nhấn nút Xuất CSV (Export CSV) thực sự kích hoạt tải file history_export.csv', async ({ page }) => {
    await page.goto('/dashboard/history');
    await expect(page.getByText('Camera Warehouse East')).toBeVisible();

    const exportBtn = page.getByRole('button', { name: /Export|Xuất/i });
    await expect(exportBtn).toBeEnabled();

    const downloadPromise = page.waitForEvent('download');
    await exportBtn.click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('history_export.csv');
  });

  test('HIS_05: Hiển thị thông báo lỗi (role="alert") khi API /history trả về lỗi 500', async ({ page }) => {
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
    await page.route(/.*(18080|:8000)\/history.*/, async route => {
      await route.fulfill({ status: 500, headers, json: { detail: 'Internal Server Error' } });
    });

    await page.goto('/dashboard/history');
    await expect(page.getByRole('alert')).toBeVisible();
  });
});
