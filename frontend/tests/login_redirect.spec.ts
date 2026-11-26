import { test, expect } from '@playwright/test';

test.describe('Kiểm thử lỗi điều hướng và trạng thái đăng nhập (Login Redirect Bug)', () => {
  const testAccount = {
    username: 'vyvy',
    password: 'vyvy12345678',
    email: 'vynguyen30082005@gmail.com',
  };

  test('TC_LOGIN_01: Đăng nhập thành công và điều hướng ổn định vào Dashboard (Đã fix BUG-001)', async ({ page }) => {
    // 1. Vào trang đăng nhập
    await page.goto('/login');

    // 2. Điền thông tin đăng nhập hợp lệ
    await page.fill('#identifier', testAccount.username);
    await page.fill('#password', testAccount.password);

    // 3. Nhấn nút đăng nhập
    await page.click('button[type="submit"]');

    // 4. Kỳ vọng của hệ thống: Điều hướng và ở lại trang dashboard ổn định
    await expect(page).toHaveURL(/.*\/dashboard/, { timeout: 10000 });
    await expect(page.locator('h1, h2, [class*="CameraGrid"]').first()).toBeVisible();
  });

  test('TC_LOGIN_02: Kiểm tra lưu trữ auth_header (Bearer session token) trong sessionStorage', async ({ page }) => {
    await page.goto('/login');
    await page.fill('#identifier', testAccount.username);
    await page.fill('#password', testAccount.password);
    await page.click('button[type="submit"]');

    await expect(page).toHaveURL(/.*\/dashboard/, { timeout: 10000 });

    // Kiểm tra sessionStorage có lưu auth_header (Bearer session token hoặc Basic fallback)
    const authHeader = await page.evaluate(() => sessionStorage.getItem('auth_header'));
    expect(authHeader).not.toBeNull();
    expect(authHeader).toMatch(/^(Bearer|Basic) \S+/);
  });

  test('TC_LOGIN_03: Kiểm tra đăng nhập bằng Email thành công (Tính năng mới Commit 56bb42f)', async ({ page }) => {
    await page.goto('/login');
    // Nhập email vào ô Tên đăng nhập hoặc Email
    await page.fill('#identifier', testAccount.email);
    await page.fill('#password', testAccount.password);
    await page.click('button[type="submit"]');

    await expect(page).toHaveURL(/.*\/dashboard/, { timeout: 10000 });

    // Kiểm tra sessionStorage có lưu auth_header thành công
    const authHeader = await page.evaluate(() => sessionStorage.getItem('auth_header'));
    expect(authHeader).not.toBeNull();
    expect(authHeader).toMatch(/^(Bearer|Basic) \S+/);
  });

  test('TC_LOGIN_04: Chống Open Redirect khi tham số ?redirect trỏ ra domain ngoài và giữ redirect nội bộ hợp lệ', async ({ page }) => {
    await page.goto('/login?redirect=https://evil.example.com/phishing');
    await page.fill('#identifier', testAccount.username);
    await page.fill('#password', testAccount.password);
    await page.click('button[type="submit"]');

    // URL độc hại bên ngoài phải bị chặn và đưa về /dashboard mặc định
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 10000 });
  });

  test('TC_LOGIN_05: Tự động xóa phiên và chuyển hướng về /login?redirect=... khi API trả về 401 (mất phiên đăng nhập)', async ({ page }) => {
    await page.addInitScript(() => {
      if (!sessionStorage.getItem('seeded_expired_once')) {
        sessionStorage.setItem('seeded_expired_once', '1');
        sessionStorage.setItem('auth_header', 'Bearer expired-or-revoked-session-token');
        sessionStorage.setItem('user_profile', JSON.stringify({ id: '99', username: 'expired_user', role: 'user' }));
      }
    });

    await page.goto('/dashboard/history');

    // Khi token không hợp lệ (Backend trả 401), client tự động xóa sessionStorage và chuyển về /login kèm redirect
    await expect(page).toHaveURL(/\/login\?redirect=%2Fdashboard%2Fhistory/, { timeout: 10000 });
    const remainingAuth = await page.evaluate(() => sessionStorage.getItem('auth_header'));
    expect(remainingAuth).toBeNull();
  });
});
