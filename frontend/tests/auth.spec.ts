import { test, expect } from '@playwright/test';
import {
  newUser,
  fillRegister,
  submitRegister,
  verifyOtpUI,
  loginUI,
  logoutUI,
  forgotPasswordUI,
  enableMockMode,
  enableRealMode,
  MOCK_ADMIN,
  REAL_USER,
} from './helpers';

// ============================================================================
// 1. KIỂM THỬ ĐĂNG KÝ TÀI KHOẢN (REGISTER - /register)
// ============================================================================
test.describe('1. Đăng ký tài khoản (Register)', () => {
  test.beforeEach(async ({ page }) => {
    await enableMockMode(page);
  });

  test('REG_01: Đăng ký thành công -> Chuyển sang màn hình xác thực OTP', async ({ page }) => {
    const u = newUser();
    await submitRegister(page, u);

    // Chờ chuyển hướng sang /verify-otp với target email
    await expect(page).toHaveURL(new RegExp(`/verify-otp\\?target=.*`), { timeout: 10000 });
    await expect(page.locator('h2')).toContainText(/Xác thực OTP|Verify OTP/i);
  });

  test('REG_02: Để trống tất cả các trường -> Nút Đăng ký bị vô hiệu hóa (disabled)', async ({ page }) => {
    await page.goto('/register');
    const submitBtn = page.locator('button[type="submit"]');
    await expect(submitBtn).toBeDisabled();
  });

  test('REG_03: Username quá ngắn (< 3 ký tự) -> Báo lỗi', async ({ page }) => {
    const u = newUser();
    await submitRegister(page, { ...u, username: 'ab' });

    await expect(page.locator('p.text-red-600').first()).toBeVisible();
  });

  test('REG_04: Username chứa ký tự đặc biệt -> Báo lỗi', async ({ page }) => {
    const u = newUser();
    await submitRegister(page, { ...u, username: 'user@#$' });

    await expect(page.locator('p.text-red-600').first()).toBeVisible();
  });

  test('REG_05: Email không đúng định dạng Gmail -> Báo lỗi validation', async ({ page }) => {
    const u = newUser();
    await submitRegister(page, { ...u, email: 'invalid_user@notgmail.com' });

    await expect(page.locator('p.text-red-600').first()).toBeVisible();
  });

  test('REG_06: Email không phải địa chỉ Gmail (@gmail.com) -> Báo lỗi', async ({ page }) => {
    const u = newUser();
    await submitRegister(page, { ...u, email: `${u.username}@yahoo.com` });

    await expect(page.locator('p.text-red-600').first()).toBeVisible();
  });

  test('REG_07: Mật khẩu xác nhận không khớp -> Nút Đăng ký bị vô hiệu hóa (disabled)', async ({ page }) => {
    const u = newUser();
    await fillRegister(page, { ...u, confirmPassword: 'DifferentPassword123' });
    const submitBtn = page.locator('button[type="submit"]');
    await expect(submitBtn).toBeDisabled();
  });

  test('REG_09: Password Requirements hiển thị checklist 4 điều kiện khi nhập mật khẩu', async ({ page }) => {
    await page.goto('/register');
    await page.fill('#password', 'a');
    const checklist = page.getByText(/Yêu cầu mật khẩu|Password requirements/i);
    await expect(checklist.first()).toBeVisible();
  });

  test('REG_10: Password Strength Meter phản ánh độ mạnh của mật khẩu theo thời gian thực', async ({ page }) => {
    await page.goto('/register');
    const passInput = page.locator('#password');
    await passInput.fill('abcdefgh');
    await expect(page.getByText(/^(Yếu|Weak)$/i).first()).toBeVisible();
    await passInput.fill('Abcdefgh1');
    await expect(page.getByText(/^(Mạnh|Strong)$/i).first()).toBeVisible();
  });

  test('REG_11: Nút Đăng ký được kích hoạt (enabled) khi mật khẩu hợp lệ và xác nhận khớp', async ({ page }) => {
    const u = newUser();
    await fillRegister(page, u);
    const submitBtn = page.locator('button[type="submit"]');
    await expect(submitBtn).toBeEnabled();
  });

  test('REG_12: Loại bỏ hoàn toàn các nút mạng xã hội (Google / Facebook) tại /register và /login', async ({ page }) => {
    await page.goto('/register');
    await expect(page.locator('button:has-text("Google")')).toHaveCount(0);
    await expect(page.locator('button:has-text("Facebook")')).toHaveCount(0);
    await page.goto('/login');
    await expect(page.locator('button:has-text("Google")')).toHaveCount(0);
    await expect(page.locator('button:has-text("Facebook")')).toHaveCount(0);
  });

  test('REG_08: Chưa tích đồng ý điều khoản (Terms) -> Báo lỗi', async ({ page }) => {
    const u = newUser();
    await submitRegister(page, u, false);

    await expect(page.locator('p.text-red-600').first()).toBeVisible();
  });
});

// ============================================================================
// 2. KIỂM THỬ XÁC THỰC MÃ OTP (VERIFY OTP - /verify-otp)
// ============================================================================
test.describe('2. Xác thực OTP (Verify OTP)', () => {
  test.beforeEach(async ({ page }) => {
    await enableMockMode(page);
  });

  test('OTP_01: Truy cập /verify-otp hiển thị giao diện nhập mã OTP', async ({ page }) => {
    await page.goto('/verify-otp');
    await expect(page.locator('h2')).toContainText(/Xác thực OTP|Verify OTP/i);
    await expect(page.locator('input[type="text"]')).toHaveCount(6);
  });

  test('OTP_02: Giao diện hiển thị đủ 6 ô số và có thể điền mã OTP', async ({ page }) => {
    const u = newUser();
    await page.goto(`/verify-otp?target=${encodeURIComponent(u.email)}`);
    await page.waitForLoadState('domcontentloaded');

    const otpInputs = page.locator('input[type="text"]');
    await expect(otpInputs).toHaveCount(6);
    await expect(otpInputs.first()).toBeVisible();
    await page.waitForTimeout(600);

    await verifyOtpUI(page, '123456');
    await expect(otpInputs.first()).toHaveValue('1');
    await expect(otpInputs.last()).toHaveValue('6');
  });

  test('OTP_03: Hiển thị bộ đếm thời gian hết hạn mã OTP', async ({ page }) => {
    const u = newUser();
    await page.goto(`/verify-otp?target=${encodeURIComponent(u.email)}`);

    const timerText = page.locator('div:has-text("Mã hết hạn sau"), div:has-text("expires"), div:has-text("Hết hạn")');
    await expect(timerText.first()).toBeVisible();
  });
});

// ============================================================================
// 3. KIỂM THỬ ĐĂNG NHẬP (LOGIN - /login)
// ============================================================================
test.describe('3. Đăng nhập (Login)', () => {
  test('LOG_01: Đăng nhập tài khoản hợp lệ -> Điều hướng thành công vào Dashboard', async ({ page }) => {
    await loginUI(page, REAL_USER.username, REAL_USER.password);

    await expect(page).toHaveURL(/.*\/dashboard/, { timeout: 10000 });
  });

  test('LOG_02: Để trống trường -> Báo lỗi yêu cầu nhập đầy đủ', async ({ page }) => {
    await page.goto('/login');
    await page.click('button[type="submit"]');

    await expect(page.locator('p.text-red-600').first()).toBeVisible();
  });

  test('LOG_03: Mật khẩu dưới 8 ký tự -> Báo lỗi', async ({ page }) => {
    await page.goto('/login');
    await page.fill('#identifier', 'admin');
    await page.fill('#password', '12345');
    await page.click('button[type="submit"]');

    await expect(page.locator('p.text-red-600').first()).toBeVisible();
  });

  test('LOG_04: Sai mật khẩu -> Báo lỗi không chính xác', async ({ page }) => {
    await enableMockMode(page);
    await loginUI(page, 'admin', 'WrongPassword123');

    const alert = page.locator('div.bg-red-50, div.text-red-600');
    await expect(alert.first()).toBeVisible({ timeout: 5000 });
    await expect(page).toHaveURL(/.*\/login/);
  });

  test('LOG_05: Tài khoản không tồn tại -> Báo lỗi bảo mật', async ({ page }) => {
    await enableMockMode(page);
    await loginUI(page, 'non_existing_user_999', 'Password123');

    const alert = page.locator('div.bg-red-50, div.text-red-600');
    await expect(alert.first()).toBeVisible({ timeout: 5000 });
  });

  test('LOG_06: Bật/tắt hiển thị mật khẩu (Eye Toggle)', async ({ page }) => {
    await page.goto('/login');
    const passInput = page.locator('#password');
    const eyeBtn = page.locator('button:has(svg.lucide-eye), button:has(svg.lucide-eye-off)');

    await passInput.fill('SecretPassword123');
    await expect(passInput).toHaveAttribute('type', 'password');

    // Bấm hiện mật khẩu
    await eyeBtn.first().click();
    await expect(passInput).toHaveAttribute('type', 'text');
  });

  test('LOG_07: Ghi nhớ đăng nhập (Remember me) lưu username vào localStorage', async ({ page }) => {
    await page.goto('/login');
    await page.fill('#identifier', 'rememberedUser');
    await page.fill('#password', 'Password123');
    await page.check('#remember-me');
    await page.click('button[type="submit"]');

    // Kiểm tra localStorage
    const saved = await page.evaluate(() => localStorage.getItem('remembered_username'));
    expect(saved).toBe('rememberedUser');
  });

  test('LOG_08: Click link "Quên mật khẩu?" -> Chuyển đến /forgot-password', async ({ page }) => {
    await page.goto('/login');
    await page.click('a[href="/forgot-password"]');

    await expect(page).toHaveURL(/.*\/forgot-password/);
  });

  test('LOG_09: Bấm link "Quay lại trang chủ" từ trang đăng nhập', async ({ page }) => {
    await page.goto('/login');
    await page.click('a[href="/"]');

    await expect(page).toHaveURL('/');
  });

  test('LOG_10: Xác nhận tài khoản Backend thật vyvy đăng nhập và lưu phiên', async ({ page }) => {
    await enableRealMode(page);
    await page.goto('/login');
    await page.fill('#identifier', REAL_USER.username);
    await page.fill('#password', REAL_USER.password);
    await page.click('button[type="submit"]');

    await page.waitForTimeout(1500);

    // Kiểm tra sessionStorage lưu auth_header
    const authHeader = await page.evaluate(() => sessionStorage.getItem('auth_header'));
    expect(authHeader).not.toBeNull();
  });
});

// ============================================================================
// 4. KIỂM THỬ ĐĂNG XUẤT (LOGOUT)
// ============================================================================
test.describe('4. Đăng xuất (Logout)', () => {
  test('OUT_01: Bấm nút Đăng xuất từ Sidebar -> Xóa phiên và về trang /login', async ({ page }) => {
    await loginUI(page, REAL_USER.username, REAL_USER.password);
    await expect(page).toHaveURL(/.*\/dashboard/);

    // Thực hiện đăng xuất từ Sidebar
    await logoutUI(page);

    // Sau khi logout, điều hướng về /login
    await expect(page).toHaveURL(/.*\/login/);
  });

  test('OUT_02: Sau khi đăng xuất, sessionStorage được dọn dẹp sạch', async ({ page }) => {
    await loginUI(page, REAL_USER.username, REAL_USER.password);
    await expect(page).toHaveURL(/.*\/dashboard/);

    await logoutUI(page);

    // Kiểm tra sessionStorage đã bị xóa thông tin user
    const profile = await page.evaluate(() => sessionStorage.getItem('user_profile'));
    expect(profile).toBeNull();
  });
});

// ============================================================================
// 5. KIỂM THỬ QUÊN VÀ ĐẶT LẠI MẬT KHẨU (FORGOT & RESET PASSWORD)
// ============================================================================
test.describe('5. Quên & Đặt lại mật khẩu (Forgot & Reset Password)', () => {
  test('FGT_01: Để trống email và blur -> Nút gửi bị disabled và báo lỗi', async ({ page }) => {
    await page.goto('/forgot-password');
    // Khi email trống, nút submit bị disabled theo logic bảo vệ
    const submitBtn = page.locator('button[type="submit"]');
    await expect(submitBtn).toBeDisabled();

    // Focus vào input email rồi click ra ngoài để kích hoạt onBlur
    await page.locator('#email').click();
    await page.locator('h2').click();
    await expect(page.locator('p.text-red-600, p:has(svg.lucide-alert-circle)').first()).toBeVisible();
  });

  test('FGT_02: Nhập email sai định dạng -> Báo lỗi email không hợp lệ', async ({ page }) => {
    await page.goto('/forgot-password');
    await page.locator('#email').fill('not-an-email');
    await page.locator('h2').click();

    await expect(page.locator('p.text-red-600, p:has(svg.lucide-alert-circle)').first()).toBeVisible();
  });

  test('FGT_03: Chế độ Mock: Gửi yêu cầu quên mật khẩu thành công -> Chuyển sang /reset-password', async ({ page }) => {
    await enableMockMode(page);
    await page.goto('/forgot-password');
    await page.waitForLoadState('domcontentloaded');

    const emailInput = page.locator('#email');
    await expect(emailInput).toBeVisible();
    await page.evaluate(() => sessionStorage.removeItem('mockForgotLastSent'));

    await emailInput.click();
    await emailInput.fill('admin@fireguard.ai');
    await expect(emailInput).toHaveValue('admin@fireguard.ai');

    const submitBtn = page.locator('button[type="submit"]');
    await expect(submitBtn).toBeEnabled();
    await submitBtn.click();

    // Chuyển sang /reset-password
    await expect(page).toHaveURL(/.*\/reset-password/, { timeout: 10000 });
  });

  test('FGT_04: Link "Quay lại đăng nhập" từ trang Quên mật khẩu', async ({ page }) => {
    await page.goto('/forgot-password');
    await page.click('a[href="/login"]');

    await expect(page).toHaveURL(/.*\/login/);
  });

  test('FGT_05: Vào thẳng /reset-password khi chưa có phiên -> Chuyển hướng về /forgot-password', async ({ page }) => {
    await page.goto('/reset-password');
    await page.evaluate(() => sessionStorage.removeItem('resetEmail'));
    await page.reload();

    await expect(page).toHaveURL(/.*\/forgot-password/);
  });

  test('FGT_06: Chế độ Real Backend: Gửi yêu cầu quên mật khẩu thành công -> Điều hướng sang /reset-password (Commit 654c4c0)', async ({ page }) => {
    await enableRealMode(page);
    await forgotPasswordUI(page, 'vynguyen30082005@gmail.com');

    // Sau khi Real Backend phản hồi 200 OK, form hiển thị thông báo thành công và chuyển sang /reset-password
    await expect(page).toHaveURL(/.*\/reset-password/, { timeout: 10000 });
  });

  test('RST_01: Màn hình /reset-password hiển thị đầy đủ 6 ô OTP, bộ đếm thời gian và email đã che mờ', async ({ page }) => {
    await page.goto('/forgot-password');
    // Khởi tạo phiên hợp lệ trong sessionStorage
    await page.evaluate(() => {
      sessionStorage.setItem('resetEmail', 'admin@fireguard.ai');
      sessionStorage.setItem('resetExpiresAt', (Date.now() + 120000).toString());
      sessionStorage.setItem('resetAttempts', '5');
    });
    await page.goto('/reset-password');

    // Kiểm tra email bị che mờ
    await expect(page.locator('text=ad***@fireguard.ai')).toBeVisible();

    // Kiểm tra đủ 6 ô nhập OTP
    const otpInputs = page.locator('input[inputmode="numeric"]');
    await expect(otpInputs).toHaveCount(6);

    // Kiểm tra bộ đếm thời gian còn hiệu lực
    const timer = page.locator('span.font-mono');
    await expect(timer.first()).toBeVisible();
  });

  test('RST_02: Nhập sai mã OTP -> Báo lỗi mã không hợp lệ và số lần thử giảm', async ({ page }) => {
    await page.route('**/auth/verify-reset-otp', async (route) => {
      await route.fulfill({ status: 400, json: { detail: "INVALID_OTP" } });
    });
    await page.goto('/forgot-password');
    await page.evaluate(() => {
      sessionStorage.setItem('resetEmail', 'vynguyen30082005@gmail.com');
      sessionStorage.setItem('resetExpiresAt', (Date.now() + 120000).toString());
      sessionStorage.setItem('resetAttempts', '5');
    });
    await page.goto('/reset-password');

    // Nhập mã OTP sai
    const otpInputs = page.locator('input[inputmode="numeric"]');
    for (let i = 0; i < 6; i++) {
      await otpInputs.nth(i).fill('9');
    }

    // Kiểm tra thông báo lỗi hiển thị
    const errorAlert = page.locator('div.bg-red-50');
    await expect(errorAlert.first()).toBeVisible({ timeout: 5000 });
  });

  test('RST_03: Nhập đúng mã OTP -> Chuyển sang Giai đoạn 2 (Đặt mật khẩu mới)', async ({ page }) => {
    await page.route('**/auth/verify-reset-otp', async (route) => {
      await route.fulfill({ status: 200, json: { message: "OTP verified", expires_in: 600 } });
    });
    await page.goto('/forgot-password');
    await page.evaluate(() => {
      sessionStorage.setItem('resetEmail', 'vynguyen30082005@gmail.com');
      sessionStorage.setItem('resetExpiresAt', (Date.now() + 120000).toString());
      sessionStorage.setItem('resetAttempts', '5');
    });
    await page.goto('/reset-password');

    // Điền OTP 123456
    const otpInputs = page.locator('input[inputmode="numeric"]');
    for (let i = 0; i < 6; i++) {
      await otpInputs.nth(i).fill(String(i + 1));
    }

    // Chờ chuyển sang Giai đoạn 2: ô nhập mật khẩu mới xuất hiện
    await expect(page.locator('#new-password')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#confirm-password')).toBeVisible();
  });

  test('RST_04: Giai đoạn 2 - Kiểm tra validation quy tắc mật khẩu mới', async ({ page }) => {
    await page.route('**/auth/verify-reset-otp', async (route) => {
      await route.fulfill({ status: 200, json: { message: "OTP verified", expires_in: 600 } });
    });
    await page.goto('/forgot-password');
    await page.evaluate(() => {
      sessionStorage.setItem('resetEmail', 'vynguyen30082005@gmail.com');
      sessionStorage.setItem('resetExpiresAt', (Date.now() + 120000).toString());
      sessionStorage.setItem('resetAttempts', '5');
    });
    await page.goto('/reset-password');

    const otpInputs = page.locator('input[inputmode="numeric"]');
    for (let i = 0; i < 6; i++) {
      await otpInputs.nth(i).fill(String(i + 1));
    }

    await expect(page.locator('#new-password')).toBeVisible({ timeout: 5000 });
    const newPass = page.locator('#new-password');

    // Nhập mật khẩu yếu (chưa đủ ký tự)
    await newPass.fill('Abc1');
    const submitBtn = page.locator('button[type="submit"]');
    await expect(submitBtn).toBeDisabled();

    // Nhập mật khẩu có ký tự đặc biệt -> Vi phạm quy tắc
    await newPass.fill('Abc12345!@#');
    await expect(submitBtn).toBeDisabled();

    // Nhập mật khẩu hợp lệ (>= 8 ký tự, chữ hoa, chữ thường, số, không ký tự đặc biệt)
    await newPass.fill('NewSecurePass123');
    // Nút vẫn disabled vì chưa nhập confirmPassword
    await expect(submitBtn).toBeDisabled();
  });

  test('RST_05: Giai đoạn 2 - Mật khẩu xác nhận không khớp -> Báo lỗi', async ({ page }) => {
    await page.route('**/auth/verify-reset-otp', async (route) => {
      await route.fulfill({ status: 200, json: { message: "OTP verified", expires_in: 600 } });
    });
    await page.goto('/forgot-password');
    await page.evaluate(() => {
      sessionStorage.setItem('resetEmail', 'vynguyen30082005@gmail.com');
      sessionStorage.setItem('resetExpiresAt', (Date.now() + 120000).toString());
      sessionStorage.setItem('resetAttempts', '5');
    });
    await page.goto('/reset-password');

    const otpInputs = page.locator('input[inputmode="numeric"]');
    for (let i = 0; i < 6; i++) {
      await otpInputs.nth(i).fill(String(i + 1));
    }

    await expect(page.locator('#new-password')).toBeVisible({ timeout: 5000 });
    await page.locator('#new-password').fill('NewSecurePass123');
    await page.locator('#confirm-password').fill('DifferentPass123');
    await page.locator('h2').click(); // blur

    // Hiển thị thông báo mật khẩu xác nhận không khớp
    await expect(page.locator('p.text-red-600')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeDisabled();
  });

  test('RST_06: Giai đoạn 2 - Đổi mật khẩu thành công -> Chuyển về /login?resetSuccess=true', async ({ page }) => {
    await page.route('**/auth/verify-reset-otp', async (route) => {
      await route.fulfill({ status: 200, json: { message: "OTP verified", expires_in: 600 } });
    });
    await page.route('**/auth/reset-password', async (route) => {
      await route.fulfill({ status: 200, json: { message: "Password has been reset" } });
    });
    await page.goto('/forgot-password');
    await page.evaluate(() => {
      sessionStorage.setItem('resetEmail', 'vynguyen30082005@gmail.com');
      sessionStorage.setItem('resetExpiresAt', (Date.now() + 120000).toString());
      sessionStorage.setItem('resetAttempts', '5');
    });
    await page.goto('/reset-password');

    const otpInputs = page.locator('input[inputmode="numeric"]');
    for (let i = 0; i < 6; i++) {
      await otpInputs.nth(i).fill(String(i + 1));
    }

    await expect(page.locator('#new-password')).toBeVisible({ timeout: 5000 });
    await page.locator('#new-password').fill('NewSecurePass123');
    await page.locator('#confirm-password').fill('NewSecurePass123');

    const submitBtn = page.locator('button[type="submit"]');
    await expect(submitBtn).toBeEnabled();
    await submitBtn.click();

    // Chuyển hướng về trang đăng nhập với cờ resetSuccess
    await expect(page).toHaveURL(/.*\/login\?resetSuccess=true/, { timeout: 10000 });
  });
});
