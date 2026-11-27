import { test, expect } from '@playwright/test';
import { basicAuth, REAL_USER, BACKEND_URL } from './helpers';

test.describe('Phân quyền & Kiểm soát truy cập (Access Control & Protected Routes)', () => {
  test.use({ baseURL: BACKEND_URL });

  // --------------------------------------------------------------------------
  // 1. CÁC ENDPOINT YÊU CẦU XÁC THỰC (ACCOUNT HELPERS)
  // Theo thiết kế backend/main.py: /auth/login, /auth/stream-token, /users/me
  // --------------------------------------------------------------------------
  test.describe('Các Endpoint Yêu Cầu Xác Thực (HTTP Basic Auth)', () => {
    const protectedEndpoints = [
      '/auth/login',
      '/auth/stream-token',
      '/users/me',
    ];

    for (const endpoint of protectedEndpoints) {
      test(`chưa xác thực -> ${endpoint} phải trả về 401`, async ({ request }) => {
        const res = await request.get(endpoint);
        expect(res.status()).toBe(401);
      });
    }

    test('đã xác thực hợp lệ (vyvy) -> Truy cập thành công các endpoint bảo vệ (200 OK)', async ({ request }) => {
      const headers = basicAuth(REAL_USER.username, REAL_USER.password);

      const resLogin = await request.get('/auth/login', { headers });
      expect(resLogin.status()).toBe(200);

      const resToken = await request.get('/auth/stream-token', { headers });
      expect(resToken.status()).toBe(200);

      const resMe = await request.get('/users/me', { headers });
      expect(resMe.status()).toBe(200);
    });
  });

  // --------------------------------------------------------------------------
  // 2. CÁC ENDPOINT PUBLIC & BẢO VỆ (THEO THIẾT KẾ CỦA BACKEND)
  // --------------------------------------------------------------------------
  test.describe('Các Endpoint Public & Bảo Vệ (Theo Thiết Kế Của Backend)', () => {
    test('endpoint root / là public (200 OK)', async ({ request }) => {
      const res = await request.get('/');
      expect(res.status()).toBe(200);
    });

    test('các endpoint đọc dữ liệu vận hành yêu cầu xác thực (401 khi chưa login, 200 khi đã login)', async ({ request }) => {
      const operationalEndpoints = [
        '/cameras',
        '/alerts',
        '/stats',
        '/history',
      ];

      const headers = basicAuth(REAL_USER.username, REAL_USER.password);
      for (const endpoint of operationalEndpoints) {
        const resUnauth = await request.get(endpoint);
        expect(resUnauth.status(), `Endpoint ${endpoint} phải trả về 401 khi chưa login`).toBe(401);

        const resAuth = await request.get(endpoint, { headers });
        expect(resAuth.status(), `Endpoint ${endpoint} phải trả về 200 khi đã login`).toBe(200);
      }
    });

    test('endpoint kích hoạt thông báo thử nghiệm /test-notification yêu cầu quyền Admin (401/403 khi chưa login)', async ({ request }) => {
      const res = await request.post('/test-notification');
      expect([401, 403]).toContain(res.status());
    });

    test('endpoint lưu cấu hình /settings yêu cầu xác thực (401 khi chưa login)', async ({ request }) => {
      const res = await request.post('/settings', {
        data: { key: 'autotest_rbac_check', value: '1' },
      });
      expect(res.status()).toBe(401);
    });
  });

  // --------------------------------------------------------------------------
  // 3. HIỆN TRẠNG PHÂN QUYỀN RBAC (THEO API CONTRACT & MYSQL SCHEMA)
  // --------------------------------------------------------------------------
  test.describe('Hiện trạng RBAC & Cấu trúc User', () => {
    test('tài khoản hiện tại có trường is_active và role hợp lệ', async ({ request }) => {
      const headers = basicAuth(REAL_USER.username, REAL_USER.password);
      const res = await request.get('/users/me', { headers });
      expect(res.status()).toBe(200);
      const data = await res.json();
      expect(data.username).toBe(REAL_USER.username);
      expect(data.is_active).toBe(true);
      expect(['admin', 'user']).toContain(data.role);
    });
  });

  // --------------------------------------------------------------------------
  // 4. KIỂM THỬ QUY TẮC PHÂN QUYỀN TRỰC TIẾP TRÊN GIAO DIỆN (PR #13, PR #14 & PR #19)
  // --------------------------------------------------------------------------
  test.describe('Cơ chế Chuẩn Hóa Role & Quyền Hạn Trên Giao Diện (PR #13, PR #14 & PR #19)', () => {
    const FRONTEND_URL = process.env.BASE_URL || 'http://localhost:3000';

    test('AuthContext tự động chuẩn hóa role cũ (operator / viewer) thành user trên giao diện Profile', async ({ page }) => {
      const legacyOperator = { id: 2, username: 'legacy_operator', email: 'op@example.com', role: 'operator', is_active: true };
      const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
      await page.addInitScript(profile => {
        sessionStorage.setItem('auth_header', 'Bearer legacy-role-token');
        sessionStorage.setItem('user_profile', JSON.stringify(profile));
        localStorage.setItem('language', 'en');
      }, legacyOperator);
      await page.route(/.*(18080|:8000)\/.*/, async route => {
        if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 200, headers });
        const path = new URL(route.request().url()).pathname;
        const body = path === '/users/me' ? legacyOperator : { token: 'test', expires_in: 3600 };
        await route.fulfill({ status: 200, headers, json: body });
      });
      await page.routeWebSocket('**/ws/**', () => {});

      await page.goto(`${FRONTEND_URL}/dashboard/profile`);
      await expect(page.locator('span').filter({ hasText: /^user$/i }).first()).toBeVisible();
    });

    test('Quyền hạn của User: Được quản lý camera cá nhân nhưng bị RequireRole chặn tại /users, /ai-settings, /audit-log', async ({ page }) => {
      const standardUser = { id: 3, username: 'standard_member', email: 'member@example.com', role: 'user', is_active: true };
      const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
      await page.addInitScript(profile => {
        sessionStorage.setItem('auth_header', 'Bearer user-role-token');
        sessionStorage.setItem('user_profile', JSON.stringify(profile));
        localStorage.setItem('language', 'en');
      }, standardUser);
      await page.route(/.*(18080|:8000)\/.*/, async route => {
        if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 200, headers });
        const path = new URL(route.request().url()).pathname;
        const body = path === '/users/me' ? standardUser
          : path === '/auth/stream-token' ? { token: 'test', expires_in: 3600 }
          : path === '/cameras' ? { cameras: [{ id: 1, name: 'User Cam', source: '0', is_active: false, status: 'disconnected' }] }
          : {};
        await route.fulfill({ status: 200, headers, json: body });
      });
      await page.routeWebSocket('**/ws/**', () => {});

      // 1. User được phép bật/tắt và thêm/sửa/xóa camera thuộc sở hữu của mình
      await page.goto(`${FRONTEND_URL}/dashboard/cameras`);
      await expect(page.getByRole('button', { name: /Add Camera|Thêm Camera/i })).toBeVisible();
      await expect(page.getByRole('switch', { name: /Camera power: User Cam/i })).toBeVisible();

      // 2. User truy cập trang chỉ dành cho Admin (/dashboard/users, /dashboard/ai-settings, /dashboard/audit-log) bị RequireRole chặn
      for (const restrictedPath of ['/dashboard/users', '/dashboard/ai-settings', '/dashboard/audit-log']) {
        await page.goto(`${FRONTEND_URL}${restrictedPath}`);
        await expect(page.getByRole('heading', { name: '403' })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Access Denied' })).toBeVisible();
        await expect(page.locator('table')).toHaveCount(0);
        await expect(page.locator('input[type="range"]')).toHaveCount(0);
      }
    });

    test('Quyền hạn của Admin: Truy cập đầy đủ các trang quản trị /users, /ai-settings và /audit-log', async ({ page }) => {
      const adminUser = { id: 1, username: 'admin_master', email: 'admin@example.com', role: 'admin', is_active: true };
      const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
      await page.addInitScript(profile => {
        sessionStorage.setItem('auth_header', 'Bearer admin-role-token');
        sessionStorage.setItem('user_profile', JSON.stringify(profile));
        localStorage.setItem('language', 'en');
      }, adminUser);
      await page.route(/.*(18080|:8000)\/.*/, async route => {
        if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 200, headers });
        const path = new URL(route.request().url()).pathname;
        const body = path === '/users/me' ? adminUser
          : path === '/auth/stream-token' ? { token: 'test', expires_in: 3600 }
          : path === '/users' ? { users: [{ id: '1', name: 'Admin', username: 'admin_master', role: 'admin', status: 'active' }] }
          : path === '/settings' ? { settings: { fire_threshold: '75', smoke_threshold: '70', persistence: '5', cooldown: '60' } }
          : path === '/audit-log' ? { logs: [{ id: 1, timestamp: '2026-11-26T00:00:00Z', username: 'admin_master', action: 'camera.add', target: 'camera:1' }], total: 1, max_id: 1 }
          : {};
        await route.fulfill({ status: 200, headers, json: body });
      });
      await page.routeWebSocket('**/ws/**', () => {});

      await page.goto(`${FRONTEND_URL}/dashboard/users`);
      await expect(page.locator('table')).toBeVisible();

      await page.goto(`${FRONTEND_URL}/dashboard/ai-settings`);
      await expect(page.locator('input[type="range"]').first()).toBeVisible();

      await page.goto(`${FRONTEND_URL}/dashboard/audit-log`);
      await expect(page.locator('table')).toBeVisible();
    });
  });
});
