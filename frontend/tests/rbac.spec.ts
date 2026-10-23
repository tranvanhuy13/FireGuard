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
});
