import { test, expect } from '@playwright/test';
import { enableMockMode, loginUI, MOCK_ADMIN } from './helpers';

test.describe('Quản trị Người dùng & Phân quyền Tài khoản (Users Management Page)', () => {
  test.beforeEach(async ({ page }) => {
    await enableMockMode(page);
    await loginUI(page, MOCK_ADMIN.username, MOCK_ADMIN.password);
  });

  test('USR_01: Admin truy cập /dashboard/users hiển thị danh sách người dùng', async ({ page }) => {
    await page.goto('/dashboard/users');
    await expect(page).toHaveURL(/.*\/dashboard\/users/);

    // Kiểm tra tiêu đề trang
    const header = page.locator('h1, h2, h3').first();
    await expect(header).toBeVisible();

    // Bảng người dùng
    const table = page.locator('table');
    await expect(table.first()).toBeVisible();

    // Các cột Vai trò (Role) và Trạng thái (Status)
    const roleHeader = page.locator('th:has-text("Role"), th:has-text("Vai trò")');
    await expect(roleHeader.first()).toBeVisible();
  });

  test('USR_02: Hiển thị dropdown lựa chọn vai trò (user/admin) và đổi vai trò thành công cho tài khoản khác', async ({ page }) => {
    await page.goto('/dashboard/users');
    const otherRow = page.locator('table tbody tr').filter({ hasText: 'operator' });
    const roleSelect = otherRow.locator('select');
    await expect(roleSelect).toBeVisible();
    await expect(roleSelect.locator('option')).toHaveCount(2);

    await roleSelect.selectOption('admin');
    await expect(roleSelect).toHaveValue('admin');
  });

  test('USR_03: Nút chuyển đổi trạng thái Hoạt động / Khóa tài khoản (Active/Blocked) và bảo vệ dòng tài khoản (You)', async ({ page }) => {
    await page.goto('/dashboard/users');
    const statusBadges = page.locator('table span:has-text("active"), table span:has-text("blocked")');
    await expect(statusBadges.first()).toBeVisible();

    // Dòng của chính Admin đang đăng nhập có nhãn (You) và bị khóa không cho tự hạ quyền hoặc tự khóa chính mình
    const selfRow = page.locator('table tbody tr').filter({ hasText: '(You)' });
    await expect(selfRow).toBeVisible();
    await expect(selfRow.locator('select')).toBeDisabled();
    await expect(selfRow.locator('button')).toBeDisabled();
  });

  test('USR_04: Admin thay đổi vai trò (Role), khóa tài khoản khác và hiển thị lỗi khi API trả về 409 Conflict', async ({ page }) => {
    const admin = { id: 1, username: 'admin_boss', email: 'boss@example.com', role: 'admin', is_active: true };
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
    const usersList = [
      { id: '1', name: 'Admin Boss', username: 'admin_boss', role: 'admin', status: 'active' },
      { id: '2', name: 'Member Two', username: 'member_two', role: 'user', status: 'active' },
    ];
    let failWith409 = false;

    await page.addInitScript(profile => {
      localStorage.removeItem('force_mock');
      sessionStorage.setItem('auth_header', 'Bearer users-mgmt-session');
      sessionStorage.setItem('user_profile', JSON.stringify(profile));
      localStorage.setItem('language', 'en');
    }, admin);

    await page.route(/.*(18080|:8000)\/.*/, async route => {
      const method = route.request().method();
      if (method === 'OPTIONS') return route.fulfill({ status: 200, headers });
      const url = new URL(route.request().url());
      if (url.pathname === '/users/me') return route.fulfill({ status: 200, headers, json: admin });
      if (url.pathname === '/auth/stream-token') return route.fulfill({ status: 200, headers, json: { token: 't', expires_in: 3600 } });
      if (url.pathname === '/users' && method === 'GET') {
        return route.fulfill({ status: 200, headers, json: { users: usersList } });
      }
      if (url.pathname === '/users/2' && method === 'PUT') {
        if (failWith409) {
          return route.fulfill({ status: 409, headers, json: { detail: 'Account must verify its email first' } });
        }
        const body = route.request().postDataJSON();
        if (body.role) usersList[1].role = body.role;
        if (body.status) usersList[1].status = body.status;
        return route.fulfill({ status: 200, headers, json: usersList[1] });
      }
      return route.fulfill({ status: 200, headers, json: {} });
    });
    await page.routeWebSocket('**/ws/**', () => {});

    await page.goto('/dashboard/users');
    const memberRow = page.locator('table tbody tr').filter({ hasText: 'member_two' });
    await expect(memberRow).toBeVisible();

    // 1. Đổi role từ user -> admin
    await memberRow.locator('select').selectOption('admin');
    await expect(memberRow.locator('select')).toHaveValue('admin');

    // 2. Khóa tài khoản (active -> blocked)
    await memberRow.locator('button').click();
    await expect(memberRow.locator('span').filter({ hasText: 'blocked' })).toBeVisible();

    // 3. Khi API trả về 409 Conflict -> hiển thị thông báo lỗi trên giao diện
    failWith409 = true;
    await memberRow.locator('button').click();
    await expect(page.getByText('Account must verify its email first')).toBeVisible();
  });
});
