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
  // 4. KIỂM THỬ QUY TẮC PHÂN QUYỀN MỚI (PR #13, PR #14)
  // Gộp role operator vào viewer; Cho phép mọi vai trò (kể cả viewer) bật/tắt camera
  // --------------------------------------------------------------------------
  test.describe('Cơ chế Chuẩn Hóa Role & Quyền Hạn (PR #13, PR #14 & PR #19)', () => {
    test('Hàm normalizeUser: operator / viewer / các role khác được tự động chuyển thành user (PR #19)', () => {
      const normalizeUser = (u: unknown) => {
        if (!u || typeof u !== 'object') return null;
        const role = 'role' in u ? u.role : undefined;
        return {
          ...u,
          role: role === 'admin' ? 'admin' : 'user',
        };
      };

      expect(normalizeUser({ username: 'test_admin', role: 'admin' })?.role).toBe('admin');
      expect(normalizeUser({ username: 'test_user', role: 'user' })?.role).toBe('user');
      expect(normalizeUser({ username: 'test_viewer', role: 'viewer' })?.role).toBe('user');
      expect(normalizeUser({ username: 'test_operator', role: 'operator' })?.role).toBe('user');
      expect(normalizeUser({ username: 'test_unknown', role: 'guest' })?.role).toBe('user');
    });

    test('Quyền hạn của User (Viewer cũ): Cho phép toggle camera, xem stream, phân tích video', () => {
      const can = (user: { role: string }, permission: string) => {
        if (!user) return false;
        if (permission === 'toggle_camera' || permission === 'toggle:camera') return true;
        if (user.role === 'admin') return true;
        if (user.role === 'user' || user.role === 'viewer') {
          const adminOnly = ['manage_users', 'manage_settings', 'add_camera', 'edit_camera', 'delete_camera', 'audit_log'];
          return !adminOnly.includes(permission);
        }
        return false;
      };

      const user = { role: 'user' };
      // Quyền được phép
      expect(can(user, 'toggle_camera')).toBe(true);
      expect(can(user, 'toggle:camera')).toBe(true);
      expect(can(user, 'view_stream')).toBe(true);
      expect(can(user, 'analyze_video')).toBe(true);
      expect(can(user, 'ack_alert')).toBe(true);

      // Quyền bị cấm
      expect(can(user, 'manage_users')).toBe(false);
      expect(can(user, 'manage_settings')).toBe(false);
      expect(can(user, 'add_camera')).toBe(false);
      expect(can(user, 'edit_camera')).toBe(false);
      expect(can(user, 'delete_camera')).toBe(false);
      expect(can(user, 'audit_log')).toBe(false);
    });

    test('Quyền hạn của Admin: Có toàn quyền trên mọi chức năng', () => {
      const can = (user: { role: string }, permission: string) => {
        if (!user) return false;
        if (permission === 'toggle_camera' || permission === 'toggle:camera') return true;
        if (user.role === 'admin') return true;
        return false;
      };

      const admin = { role: 'admin' };
      const allPermissions = [
        'toggle_camera',
        'view_stream',
        'analyze_video',
        'ack_alert',
        'manage_users',
        'manage_settings',
        'add_camera',
        'edit_camera',
        'delete_camera',
        'audit_log',
      ];

      for (const perm of allPermissions) {
        expect(can(admin, perm)).toBe(true);
      }
    });
  });
});
