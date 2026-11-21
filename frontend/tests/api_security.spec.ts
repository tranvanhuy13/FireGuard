import { test, expect } from '@playwright/test';
import {
  newUser,
  basicAuth,
  apiSignup,
  apiVerifyOtp,
  apiLogin,
  apiCurrentUser,
  REAL_USER,
  BACKEND_URL,
} from './helpers';

test.describe('Bảo mật & Validation API Xác thực (FireGuard Backend)', () => {
  test.use({ baseURL: BACKEND_URL });

  // --------------------------------------------------------------------------
  // 1. API ĐĂNG KÝ (/auth/signup)
  // --------------------------------------------------------------------------
  test.describe('API /auth/signup', () => {
    test('đăng ký: username chứa ký tự đặc biệt -> 400', async ({ request }) => {
      const u = newUser();
      const res = await request.post('/auth/signup', {
        data: { username: 'user@#$%', email: u.email, password: u.password },
      });
      expect(res.status()).toBe(400);
      const data = await res.json();
      expect(data.detail).toContain('special characters');
    });

    test('đăng ký: mật khẩu quá ngắn (< 8 ký tự) -> 400', async ({ request }) => {
      const u = newUser();
      const res = await request.post('/auth/signup', {
        data: { username: u.username, email: u.email, password: '123' },
      });
      expect(res.status()).toBe(400);
      const data = await res.json();
      expect(data.detail).toContain('at least 8 characters');
    });

    test('đăng ký: email không phải Gmail (@gmail.com) -> 400', async ({ request }) => {
      const u = newUser();
      const res = await request.post('/auth/signup', {
        data: { username: u.username, email: `${u.username}@yahoo.com`, password: u.password },
      });
      expect(res.status()).toBe(400);
      const data = await res.json();
      expect(data.detail).toContain('Gmail');
    });

    test('đăng ký: thiếu trường bắt buộc -> 422 Unprocessable Entity', async ({ request }) => {
      const res = await request.post('/auth/signup', {
        data: { username: 'onlyuser' },
      });
      expect(res.status()).toBe(422);
    });

    test('đăng ký: username đã tồn tại -> 400 Username already registered', async ({ request }) => {
      const res = await request.post('/auth/signup', {
        data: { username: REAL_USER.username, email: 'newuniqemail999@gmail.com', password: 'Password123' },
      });
      expect(res.status()).toBe(400);
      const data = await res.json();
      expect(data.detail).toContain('Username already registered');
    });

    test('đăng ký: email đã tồn tại -> 400 Email already registered', async ({ request }) => {
      const res = await request.post('/auth/signup', {
        data: { username: 'newuniquename999', email: REAL_USER.email, password: 'Password123' },
      });
      expect(res.status()).toBe(400);
      const data = await res.json();
      expect(data.detail).toContain('Email already registered');
    });
  });

  // --------------------------------------------------------------------------
  // 2. API XÁC THỰC OTP (/auth/verify-otp)
  // --------------------------------------------------------------------------
  test.describe('API /auth/verify-otp', () => {
    test('xác thực OTP: tài khoản không tồn tại -> 404', async ({ request }) => {
      const res = await request.post('/auth/verify-otp', {
        data: { email: 'nonexistent_account_999@gmail.com', otp: '123456' },
      });
      expect(res.status()).toBe(404);
      const data = await res.json();
      expect(data.detail).toContain('Account not found');
    });

    test('xác thực OTP: tài khoản đã kích hoạt -> 400 Account already verified', async ({ request }) => {
      const res = await request.post('/auth/verify-otp', {
        data: { email: REAL_USER.email, otp: '123456' },
      });
      expect(res.status()).toBe(400);
      const data = await res.json();
      expect(data.detail).toContain('Account already verified');
    });
  });

  // --------------------------------------------------------------------------
  // 3. API GỬI LẠI OTP (/auth/resend-otp)
  // --------------------------------------------------------------------------
  test.describe('API /auth/resend-otp', () => {
    test('gửi lại OTP: tài khoản không tồn tại -> 404', async ({ request }) => {
      const res = await request.post('/auth/resend-otp', {
        data: { email: 'unknown_mail_999@gmail.com' },
      });
      expect(res.status()).toBe(404);
    });

    test('gửi lại OTP: tài khoản đã kích hoạt -> 400 Account already verified', async ({ request }) => {
      const res = await request.post('/auth/resend-otp', {
        data: { email: REAL_USER.email },
      });
      expect(res.status()).toBe(400);
      const data = await res.json();
      expect(data.detail).toContain('Account already verified');
    });
  });

  // --------------------------------------------------------------------------
  // 4. API ĐĂNG NHẬP HTTP BASIC AUTH (/auth/login)
  // --------------------------------------------------------------------------
  test.describe('API /auth/login (HTTP Basic Auth)', () => {
    test('đăng nhập không gửi header Authorization -> 401', async ({ request }) => {
      const res = await request.get('/auth/login');
      expect(res.status()).toBe(401);
    });

    test('đăng nhập sai username hoặc password -> 401 Unauthorized', async ({ request }) => {
      const res = await apiLogin(request, 'wronguser', 'wrongpass');
      expect(res.status()).toBe(401);
      const data = await res.json();
      expect(data.detail).toContain('Incorrect username or password');
    });

    test('đăng nhập thành công bằng Username (vyvy) -> 200 OK', async ({ request }) => {
      const res = await apiLogin(request, REAL_USER.username, REAL_USER.password);
      expect(res.status()).toBe(200);
      const data = await res.json();
      expect(data.username).toBe(REAL_USER.username);
      expect(data.email).toBe(REAL_USER.email);
      expect(data.is_active).toBe(1);
    });

    test('đăng nhập thành công bằng Email (Commit 56bb42f) -> 200 OK', async ({ request }) => {
      const res = await apiLogin(request, REAL_USER.email, REAL_USER.password);
      expect(res.status()).toBe(200);
      const data = await res.json();
      expect(data.username).toBe(REAL_USER.username);
      expect(data.email).toBe(REAL_USER.email);
      expect(data.is_active).toBe(1);
    });
  });

  // --------------------------------------------------------------------------
  // 5. API THÔNG TIN TÀI KHOẢN (/users/me) & STREAM TOKEN (/auth/stream-token)
  // --------------------------------------------------------------------------
  test.describe('API /users/me & /auth/stream-token', () => {
    test('gọi /users/me khi chưa xác thực -> 401', async ({ request }) => {
      const res = await request.get('/users/me');
      expect(res.status()).toBe(401);
    });

    test('gọi /users/me sau khi xác thực thành công -> 200 OK', async ({ request }) => {
      const res = await apiCurrentUser(request, REAL_USER.username, REAL_USER.password);
      expect(res.status()).toBe(200);
      const data = await res.json();
      expect(data.username).toBe(REAL_USER.username);
    });

    test('lấy stream token khi chưa xác thực -> 401', async ({ request }) => {
      const res = await request.get('/auth/stream-token');
      expect(res.status()).toBe(401);
    });

    test('lấy stream token sau khi xác thực thành công -> 200 OK', async ({ request }) => {
      const res = await request.get('/auth/stream-token', {
        headers: basicAuth(REAL_USER.username, REAL_USER.password),
      });
      expect(res.status()).toBe(200);
      const data = await res.json();
      expect(data.token).toBeDefined();
      expect(data.expires_in).toBe(3600);
    });
  });

  // --------------------------------------------------------------------------
  // 6. API QUÊN MẬT KHẨU (/auth/forgot-password)
  // --------------------------------------------------------------------------
  test.describe('API /auth/forgot-password (Commit 654c4c0)', () => {
    test('gửi email đã đăng ký -> 200 OK (Generic response)', async ({ request }) => {
      const res = await request.post('/auth/forgot-password', {
        data: { email: REAL_USER.email },
      });
      expect(res.status()).toBe(200);
      const data = await res.json();
      expect(data.message).toContain('If that account exists');
    });

    test('gửi email chưa đăng ký -> 200 OK (Generic response chống liệt kê tài khoản)', async ({ request }) => {
      const res = await request.post('/auth/forgot-password', {
        data: { email: 'unknown_account_999@gmail.com' },
      });
      expect(res.status()).toBe(200);
      const data = await res.json();
      expect(data.message).toContain('If that account exists');
    });

    test('thiếu trường email -> 422 Unprocessable Entity', async ({ request }) => {
      const res = await request.post('/auth/forgot-password', {
        data: {},
      });
      expect(res.status()).toBe(422);
    });
  });

  // --------------------------------------------------------------------------
  // 7. API XÁC THỰC RESET OTP (/auth/verify-reset-otp)
  // --------------------------------------------------------------------------
  test.describe('API /auth/verify-reset-otp (Commit 654c4c0)', () => {
    test('xác thực OTP tài khoản không tồn tại -> 400 Invalid or expired code', async ({ request }) => {
      const res = await request.post('/auth/verify-reset-otp', {
        data: { email: 'nonexistent_user_999@gmail.com', otp: '123456' },
      });
      expect(res.status()).toBe(400);
      const data = await res.json();
      expect(data.detail).toContain('Invalid or expired code');
    });

    test('thiếu trường bắt buộc -> 422 Unprocessable Entity', async ({ request }) => {
      const res = await request.post('/auth/verify-reset-otp', {
        data: { email: REAL_USER.email },
      });
      expect(res.status()).toBe(422);
    });
  });

  // --------------------------------------------------------------------------
  // 8. API ĐẶT LẠI MẬT KHẨU (/auth/reset-password)
  // --------------------------------------------------------------------------
  test.describe('API /auth/reset-password (Commit 654c4c0)', () => {
    test('đặt lại mật khẩu với OTP không hợp lệ -> 400', async ({ request }) => {
      const res = await request.post('/auth/reset-password', {
        data: {
          email: REAL_USER.email,
          otp: '123456',
          new_password: 'Password123!@#',
        },
      });
      expect(res.status()).toBe(400);
      const data = await res.json();
      expect(data.detail).toBe('INVALID_OTP');
    });

    test('đặt lại mật khẩu ngắn dưới 8 ký tự -> 400', async ({ request }) => {
      const res = await request.post('/auth/reset-password', {
        data: {
          email: REAL_USER.email,
          otp: '123456',
          new_password: 'Pass1',
        },
      });
      expect(res.status()).toBe(400);
      const data = await res.json();
      expect(data.detail).toContain('at least 8 characters');
    });

    test('thiếu trường bắt buộc -> 422 Unprocessable Entity', async ({ request }) => {
      const res = await request.post('/auth/reset-password', {
        data: { email: REAL_USER.email },
      });
      expect(res.status()).toBe(422);
    });
  });
});