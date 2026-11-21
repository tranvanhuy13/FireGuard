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

    // 4. Theo dõi URL sau khi đăng nhập
    // Bug hiện tại: router.push chuyển sang /dashboard nhưng AuthContext chưa có user
    // nên DashboardLayout lập tức đá ngược về /login?redirect=%2Fdashboard
    await page.waitForTimeout(2000);

    const currentUrl = page.url();
    console.log('Current URL sau khi đăng nhập:', currentUrl);

    // Kỳ vọng của hệ thống: Phải ở lại trang dashboard thành công
    await expect(page).toHaveURL(/.*\/dashboard/);
    await expect(page.locator('h1, h2, [class*="CameraGrid"]').first()).toBeVisible();
  });

  test('TC_LOGIN_02: Kiểm tra lưu trữ auth_header trong sessionStorage', async ({ page }) => {
    await page.goto('/login');
    await page.fill('#identifier', testAccount.username);
    await page.fill('#password', testAccount.password);
    await page.click('button[type="submit"]');

    await expect(page).toHaveURL(/.*\/dashboard/, { timeout: 10000 });

    // Kiểm tra sessionStorage có lưu auth_header
    const authHeader = await page.evaluate(() => sessionStorage.getItem('auth_header'));
    console.log('SessionStorage auth_header:', authHeader ? 'Đã lưu' : 'Chưa lưu');

    expect(authHeader).not.toBeNull();
    expect(authHeader).toContain('Basic ');
  });

  test('TC_LOGIN_03: Kiểm tra đăng nhập bằng Email thành công (Tính năng mới Commit 56bb42f)', async ({ page }) => {
    await page.goto('/login');
    // Nhập email vào ô Tên đăng nhập hoặc Email
    await page.fill('#identifier', testAccount.email);
    await page.fill('#password', testAccount.password);
    await page.click('button[type="submit"]');

    await expect(page).toHaveURL(/.*\/dashboard/, { timeout: 10000 });

    // Backend mới nhất (Commit 56bb42f) hỗ trợ đăng nhập bằng Email
    // Kiểm tra sessionStorage có lưu auth_header thành công
    const authHeader = await page.evaluate(() => sessionStorage.getItem('auth_header'));
    expect(authHeader).not.toBeNull();
    expect(authHeader).toContain('Basic ');
  });
});
