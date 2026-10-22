import { expect, Page, APIRequestContext } from '@playwright/test';
import fs from 'fs';
import path from 'path';

// Tài khoản quản trị giả lập (Mock Mode)
export const MOCK_ADMIN = { identifier: 'admin', password: 'admin123' };
export const MOCK_OPERATOR = { identifier: 'operator', password: 'operator123' };

// Tài khoản thật đã đăng ký và xác thực trong Backend Database (example.db)
export const REAL_USER = {
  username: 'vyvy',
  password: 'vyvy12345678',
  email: 'vynguyen30082005@gmail.com'
};

const OTP_FILE = path.resolve(__dirname, '..', '.e2e', 'otp.json');

// ---------- Dữ liệu người dùng giả lập ----------
/**
 * Tạo user mới hợp lệ theo chuẩn FireGuard:
 * - Username: chỉ gồm chữ và số, tối thiểu 3 ký tự
 * - Email: đuôi @gmail.com
 * - Password: chỉ gồm chữ và số, tối thiểu 8 ký tự
 */
export function newUser() {
  const rand = Math.random().toString(36).slice(2, 7);
  const id = `${Date.now().toString(36).slice(-4)}${rand}`;
  const username = `user${id}`.replace(/[^a-zA-Z0-9]/g, '');
  return {
    username,
    email: `${username.toLowerCase()}@gmail.com`,
    password: 'Password123',
  };
}

export type TestUser = ReturnType<typeof newUser>;

// ---------- Chuyển đổi chế độ Mock / Real cho Frontend ----------

/** Bật chế độ Mock Auth trên trình duyệt để test các luồng UI giả lập độc lập */
export async function enableMockMode(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('force_mock', 'true');
    const mockUsers = [
      { id: "1", username: "admin", email: "admin@fireguard.ai", password: "admin123", fullName: "Admin User", role: "admin" },
      { id: "2", username: "operator", email: "operator@fireguard.ai", password: "operator123", fullName: "Operator User", role: "operator" }
    ];
    localStorage.setItem('mockUsers', JSON.stringify(mockUsers));
    localStorage.setItem('mockRole', 'admin');
    localStorage.setItem('mockUsername', 'admin');
  });
}

/** Tắt chế độ Mock để test trực tiếp với máy chủ Backend thật */
export async function enableRealMode(page: Page) {
  await page.addInitScript(() => {
    localStorage.removeItem('force_mock');
  });
}

// ---------- Đọc OTP (Hỗ trợ Mock, DB và File) ----------
export async function readOtp(email: string, purpose: 'verify' | 'reset' = 'verify'): Promise<string> {
  const key = `${purpose}:${email.toLowerCase()}`;
  if (fs.existsSync(OTP_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(OTP_FILE, 'utf8'));
      if (data[key]) return data[key] as string;
    } catch {
      // ignore
    }
  }
  return '123456';
}

// ---------- Thao tác trên Giao diện UI (FireGuard Next.js App) ----------

/** Điền form đăng ký tại /register */
export async function fillRegister(
  page: Page,
  u: Partial<TestUser> & { confirmPassword?: string },
  checkTerms: boolean = true
) {
  await page.goto('/register');
  if (u.username !== undefined) {
    await page.fill('#username', u.username);
  }
  if (u.email !== undefined) {
    await page.fill('#email', u.email);
  }
  if (u.password !== undefined) {
    await page.fill('#password', u.password);
  }
  if (u.confirmPassword !== undefined) {
    await page.fill('#confirmPassword', u.confirmPassword);
  } else if (u.password !== undefined) {
    await page.fill('#confirmPassword', u.password);
  }
  if (checkTerms) {
    const terms = page.locator('input[name="terms"]');
    if (!(await terms.isChecked())) {
      await terms.check();
    }
  }
}

/** Submit form đăng ký */
export async function submitRegister(
  page: Page,
  u: Partial<TestUser> & { confirmPassword?: string },
  checkTerms: boolean = true
) {
  await fillRegister(page, u, checkTerms);
  await page.click('button[type="submit"]');
}

/** Nhập mã OTP 6 số tại màn hình /verify-otp */
export async function verifyOtpUI(page: Page, otp: string = '123456') {
  await expect(page).toHaveURL(/.*\/verify-otp/);
  const inputs = page.locator('input[type="text"]');
  const count = await inputs.count();
  if (count >= 6) {
    for (let i = 0; i < 6; i++) {
      await inputs.nth(i).fill(otp[i] || '0');
    }
  } else {
    await page.fill('input[type="text"]', otp);
  }
}

/** Thao tác đăng nhập tại /login */
export async function loginUI(
  page: Page,
  identifier: string,
  password: string,
  rememberMe: boolean = false
) {
  await page.goto('/login');
  await page.fill('#identifier', identifier);
  await page.fill('#password', password);
  if (rememberMe) {
    const rememberCheckbox = page.locator('#remember-me');
    if (!(await rememberCheckbox.isChecked())) {
      await rememberCheckbox.check();
    }
  }
  await page.click('button[type="submit"]');
}

/** Thao tác đăng xuất từ Sidebar Dashboard */
export async function logoutUI(page: Page) {
  const logoutBtn = page.locator(
    'button:has(svg.lucide-log-out), button:has-text("Đăng xuất"), button:has-text("Logout"), button:has-text("Sign Out")'
  );
  await logoutBtn.first().click();
  await page.waitForURL(/.*\/login/, { timeout: 10000 });
}

/** Gửi yêu cầu quên mật khẩu tại /forgot-password */
export async function forgotPasswordUI(page: Page, email: string) {
  await page.goto('/forgot-password');
  await page.fill('input[type="email"], #email', email);
  await page.click('button[type="submit"]');
}

// ---------- Thao tác qua API chuẩn FireGuard (HTTP Basic Auth) ----------

export const BACKEND_URL = process.env.BACKEND_URL || 'http://127.0.0.1:8000';

export function basicAuth(username: string, password: string) {
  const token = Buffer.from(`${username.trim()}:${password}`).toString('base64');
  return { Authorization: `Basic ${token}` };
}

export async function apiSignup(request: APIRequestContext, u: TestUser) {
  return request.post(`${BACKEND_URL}/auth/signup`, {
    data: { username: u.username, email: u.email, password: u.password },
  });
}

export async function apiVerifyOtp(request: APIRequestContext, email: string, otp: string) {
  return request.post(`${BACKEND_URL}/auth/verify-otp`, {
    data: { email, otp },
  });
}

export async function apiLogin(request: APIRequestContext, identifier: string, password: string) {
  return request.get(`${BACKEND_URL}/auth/login`, {
    headers: basicAuth(identifier, password),
  });
}

export async function apiCurrentUser(request: APIRequestContext, identifier: string, password: string) {
  return request.get(`${BACKEND_URL}/users/me`, {
    headers: basicAuth(identifier, password),
  });
}
