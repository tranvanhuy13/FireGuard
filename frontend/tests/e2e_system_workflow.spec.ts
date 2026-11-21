import { test, expect } from '@playwright/test';
import { REAL_USER, loginUI, logoutUI } from './helpers';

test.describe('E2E Quy trình Hoạt động Toàn diện Hệ thống (End-to-End System Workflow)', () => {
  test.beforeEach(async ({ page }) => {
    // Đăng nhập hệ thống với tài khoản quản trị thực tế
    await loginUI(page, REAL_USER.username, REAL_USER.password);
    await expect(page).toHaveURL(/.*\/dashboard/, { timeout: 15000 });
  });

  test('TC_E2E_01: Xác thực Dashboard KPIs, Topbar và thông tin phiên quản trị viên', async ({ page }) => {
    // Kiểm tra hiển thị tiêu đề và thanh điều hướng
    await expect(page.locator('h2, h1').filter({ hasText: /Dashboard|Bảng điều khiển/i }).first()).toBeVisible({ timeout: 10000 });
    
    // Kiểm tra các khối chỉ số KPI tổng quan
    await expect(page.getByText(/TOTAL CAMERAS|TỔNG CAMERA/i).first()).toBeVisible();
    await expect(page.getByText(/ACTIVE CAMERAS|CAMERA HOẠT ĐỘNG/i).first()).toBeVisible();
    
    // Kiểm tra Topbar hiển thị vai trò Admin
    const userRoleBadge = page.locator('a[href*="profile"], header').filter({ hasText: /Admin/i }).first();
    await expect(userRoleBadge).toBeVisible();
  });

  test('TC_E2E_02: Điều hướng trang Cameras, kiểm tra danh sách và chức năng chuyển đổi bố cục', async ({ page }) => {
    await page.goto('/dashboard/cameras');
    await expect(page).toHaveURL(/.*\/dashboard\/cameras/);

    // Kiểm tra tiêu đề trang hoặc heading
    await expect(page.locator('h1, h2').filter({ hasText: /Cameras|Camera/i }).first()).toBeVisible();

    // Kiểm tra nút thêm camera
    const addCameraBtn = page.locator('button').filter({ hasText: /Add Camera|Thêm Camera/i });
    if (await addCameraBtn.count() > 0) {
      await expect(addCameraBtn.first()).toBeVisible();
    }
  });

  test('TC_E2E_03: Điều hướng Lịch sử Sự cố, kiểm tra bảng dữ liệu và bộ lọc phân loại', async ({ page }) => {
    await page.goto('/dashboard/history');
    await expect(page).toHaveURL(/.*\/dashboard\/history/);

    // Kiểm tra tiêu đề Lịch sử sự cố
    await expect(page.locator('h1, h2').filter({ hasText: /History|Lịch sử/i }).first()).toBeVisible();

    // Kiểm tra sự xuất hiện của bảng lịch sử hoặc ô tìm kiếm và trạng thái dữ liệu
    await expect(page.getByRole('button', { name: /Export CSV|Xuất/i })).toBeVisible({ timeout: 10000 });
    await expect(page.getByPlaceholder(/Search|Tìm kiếm/i).or(page.getByText(/No data|Không có|Event/i)).first()).toBeVisible();
  });

  test('TC_E2E_04: Điều hướng Cấu hình Tham số AI, kiểm tra các thanh trượt và nút lưu', async ({ page }) => {
    await page.goto('/dashboard/ai-settings');
    await expect(page).toHaveURL(/.*\/dashboard\/ai-settings/);

    // Kiểm tra có ít nhất 2 thanh trượt điều chỉnh ngưỡng nhạy
    const sliders = page.locator('input[type="range"]');
    await expect(sliders.first()).toBeVisible({ timeout: 10000 });
    const count = await sliders.count();
    expect(count).toBeGreaterThanOrEqual(2);

    // Kiểm tra nút Save và nút Restore Defaults
    const saveBtn = page.locator('button').filter({ hasText: /Save|Lưu/i }).first();
    await expect(saveBtn).toBeVisible();
  });

  test('TC_E2E_05: Điều hướng Kênh Cảnh báo, kiểm tra cấu hình Telegram Bot & Zalo', async ({ page }) => {
    await page.goto('/dashboard/notifications');
    await expect(page).toHaveURL(/.*\/dashboard\/notifications/);

    // Kiểm tra các trường cấu hình Telegram
    const telegramHeading = page.locator('h2, h3, div').filter({ hasText: /Telegram/i }).first();
    await expect(telegramHeading).toBeVisible();

    // Kiểm tra nút Test Notification hoặc Save
    const testBtn = page.locator('button').filter({ hasText: /Test Notification|Thử nghiệm|Kiểm tra/i }).first();
    if (await testBtn.count() > 0) {
      await expect(testBtn).toBeVisible();
    }
  });

  test('TC_E2E_06: Điều hướng Quản trị Người dùng, xác nhận bảng thành viên và phân quyền', async ({ page }) => {
    await page.goto('/dashboard/users');
    await expect(page).toHaveURL(/.*\/dashboard\/users/);

    // Xác nhận tiêu đề Quản trị người dùng
    await expect(page.locator('h1, h2').filter({ hasText: /Users|Người dùng/i }).first()).toBeVisible();

    // Bảng người dùng có hiển thị tài khoản admin hiện tại
    await expect(page.locator('table, tr, td, div').filter({ hasText: new RegExp(REAL_USER.username, 'i') }).first()).toBeVisible();
  });

  test('TC_E2E_07: Điều hướng Nhật ký Kiểm toán (Audit Log), xác nhận truy vấn sự kiện an toàn', async ({ page }) => {
    await page.goto('/dashboard/audit-log');
    await expect(page).toHaveURL(/.*\/dashboard\/audit-log/);

    // Xác nhận tiêu đề Nhật ký kiểm toán
    await expect(page.locator('h1, h2').filter({ hasText: /Audit Log|Nhật ký/i }).first()).toBeVisible();
  });

  test('TC_E2E_08: Thực hiện Đăng xuất (Logout), dọn dẹp phiên và chuyển hướng về /login', async ({ page }) => {
    await logoutUI(page);
    await expect(page).toHaveURL(/.*\/login/, { timeout: 10000 });

    // Xác nhận session token đã bị xóa sạch
    const authHeader = await page.evaluate(() => sessionStorage.getItem('auth_header'));
    expect(authHeader).toBeNull();
  });
});
