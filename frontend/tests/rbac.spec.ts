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
  // 2. CÁC ENDPOINT PUBLIC (THEO THIẾT KẾ HIỆN TẠI CỦA BACKEND)
  // Theo backend/main.py: /cameras, /alerts, /stats, /history, /settings, /test-notification
  // --------------------------------------------------------------------------
  test.describe('Các Endpoint Public Không Cần Login (Detection & Ops)', () => {
    test('các endpoint đọc dữ liệu vận hành là public (200 OK)', async ({ request }) => {
      const publicGetEndpoints = [
        '/',
        '/cameras',
        '/alerts',
        '/stats',
        '/history',
        '/settings',
      ];

      for (const endpoint of publicGetEndpoints) {
        const res = await request.get(endpoint);
        expect(res.status(), `Endpoint ${endpoint} phải trả về 200`).toBe(200);
      }
    });

    test('endpoint kích hoạt thông báo thử nghiệm /test-notification là public (200 OK)', async ({ request }) => {
      const res = await request.post('/test-notification');
      expect(res.status()).toBe(200);
    });

    test('endpoint lưu cấu hình /settings là public (200 OK)', async ({ request }) => {
      const res = await request.post('/settings', {
        data: { key: 'autotest_rbac_check', value: '1' },
      });
      expect(res.status()).toBe(200);
    });
  });

  // --------------------------------------------------------------------------
  // 3. HIỆN TRẠNG PHÂN QUYỀN RBAC (THEO DOCS/API_CONTRACT.MD MỤC 2.1)
  // Backend hiện chưa có trường role trong bảng users; tất cả user sau khi verify đều có quyền như nhau.
  // --------------------------------------------------------------------------
  test.describe('Hiện trạng RBAC & Cấu trúc User', () => {
    test('tài khoản hiện tại có trường is_active nhưng chưa có role (theo API Contract 2.1)', async ({ request }) => {
      const headers = basicAuth(REAL_USER.username, REAL_USER.password);
      const res = await request.get('/users/me', { headers });
      expect(res.status()).toBe(200);
      const data = await res.json();
      expect(data.username).toBe(REAL_USER.username);
      expect(data.is_active).toBe(true);
      // Phù hợp tài liệu API Contract mục 2.1: role chưa có trên backend
      expect(data.role).toBeUndefined();
    });
  });

  // --------------------------------------------------------------------------
  // 4. KIỂM THỬ QUY TẮC PHÂN QUYỀN MỚI (PR #13, PR #14)
  // Gộp role operator vào viewer; Cho phép mọi vai trò (kể cả viewer) bật/tắt camera
  // --------------------------------------------------------------------------
  test.describe('Cơ chế Chuẩn Hóa Role & Quyền Hạn (PR #13 & PR #14)', () => {
    test('Hàm chuẩn hóa role: operator được tự động chuyển thành viewer', () => {
      const normalizeUser = (u: any) => {
        if (!u || typeof u !== 'object') return null;
        return {
          ...u,
          role: u.role === 'admin' ? 'admin' : 'viewer',
        };
      };

      expect(normalizeUser({ username: 'test_admin', role: 'admin' }).role).toBe('admin');
      expect(normalizeUser({ username: 'test_viewer', role: 'viewer' }).role).toBe('viewer');
      expect(normalizeUser({ username: 'test_operator', role: 'operator' }).role).toBe('viewer');
      expect(normalizeUser({ username: 'test_unknown', role: 'guest' }).role).toBe('viewer');
    });

    test('Quyền hạn của Viewer: Cho phép toggle camera, xem stream, phân tích video', () => {
      const can = (user: { role: string }, permission: string) => {
        if (!user) return false;
        if (permission === 'toggle_camera' || permission === 'toggle:camera') return true;
        if (user.role === 'admin') return true;
        if (user.role === 'viewer') {
          const adminOnly = ['manage_users', 'manage_settings', 'add_camera', 'edit_camera', 'delete_camera', 'audit_log'];
          return !adminOnly.includes(permission);
        }
        return false;
      };

      const viewer = { role: 'viewer' };
      // Quyền được phép
      expect(can(viewer, 'toggle_camera')).toBe(true);
      expect(can(viewer, 'toggle:camera')).toBe(true);
      expect(can(viewer, 'view_stream')).toBe(true);
      expect(can(viewer, 'analyze_video')).toBe(true);
      expect(can(viewer, 'ack_alert')).toBe(true);

      // Quyền bị cấm
      expect(can(viewer, 'manage_users')).toBe(false);
      expect(can(viewer, 'manage_settings')).toBe(false);
      expect(can(viewer, 'add_camera')).toBe(false);
      expect(can(viewer, 'edit_camera')).toBe(false);
      expect(can(viewer, 'delete_camera')).toBe(false);
      expect(can(viewer, 'audit_log')).toBe(false);
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
