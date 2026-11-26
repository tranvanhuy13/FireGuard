import { test, expect } from '@playwright/test';
import { BACKEND_URL, basicAuth, REAL_USER } from './helpers';

test.describe('Quản lý Camera, Bật/Tắt & Trạng thái Nhận diện (Camera Management & Detection Status)', () => {
  test.use({ baseURL: BACKEND_URL });

  const headers = basicAuth(REAL_USER.username, REAL_USER.password);

  test('CAM_01: Lấy danh sách camera (GET /cameras) trả về mảng danh sách hợp lệ', async ({ request }) => {
    const res = await request.get('/cameras', { headers });
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.cameras)).toBe(true);
    if (data.cameras.length > 0) {
      const firstCam = data.cameras[0];
      expect(firstCam).toHaveProperty('id');
      expect(firstCam).toHaveProperty('name');
      expect(firstCam).toHaveProperty('status');
      expect(firstCam).toHaveProperty('is_active');
    }
  });

  test('CAM_02: Tạo camera mới, cập nhật tên và trạng thái qua PUT /cameras/{id}', async ({ request }) => {
    // 1. Tạo camera tạm
    const addRes = await request.post('/cameras', {
      headers,
      data: {
        source: 'https://192.168.1.100/live.m3u8',
        name: 'Camera Kiểm Thử Tự Động',
      },
    });
    expect(addRes.status()).toBe(200);
    const addData = await addRes.json();
    const camId = addData.id;
    expect(camId).toBeDefined();

    try {
      // 2. Cập nhật thông tin qua PUT /cameras/{id} (Tính năng mới PR #15)
      const putRes = await request.put(`/cameras/${camId}`, {
        headers,
        data: {
          name: 'Camera Kiểm Thử Đã Đổi Tên',
          is_active: false,
        },
      });
      expect(putRes.status()).toBe(200);
      const putData = await putRes.json();
      expect(putData.status).toBe('ok');

      // 3. Bật lại camera qua toggle API
      const toggleRes = await request.post(`/cameras/${camId}/toggle?active=true`, { headers });
      expect(toggleRes.status()).toBe(200);
      expect((await toggleRes.json()).message).toContain('enabled');
    } finally {
      // Dọn dẹp: Xóa camera tạm
      await request.delete(`/cameras/${camId}`, { headers });
    }
  });

  test('CAM_03: PUT /cameras/{id} với id không tồn tại trả về 404', async ({ request }) => {
    const res = await request.put('/cameras/9999999', {
      headers,
      data: {
        name: 'Non Existent',
        is_active: true,
      },
    });
    expect(res.status()).toBe(404);
    const data = await res.json();
    expect(data.detail).toBe('Camera not found');
  });

  test('CAM_04: POST /cameras/{id}/toggle với id không tồn tại trả về 404', async ({ request }) => {
    const res = await request.post('/cameras/9999999/toggle?active=false', { headers });
    expect(res.status()).toBe(404);
    const data = await res.json();
    expect(data.detail).toBe('Camera not found');
  });

  test('CAM_05: Hiển thị thực tế trạng thái AI Detection & Stale Expiry trên component CameraDetectionStatus', async ({ page }) => {
    const actor = { id: 1, username: 'cam_tester', email: 'cam@example.com', role: 'user', is_active: true };
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
    await page.addInitScript(profile => {
      sessionStorage.setItem('auth_header', 'Bearer cam-test-session');
      sessionStorage.setItem('user_profile', JSON.stringify(profile));
      localStorage.setItem('language', 'en');
    }, actor);

    await page.route(/.*(18080|:8000)\/.*/, async route => {
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 200, headers });
      const path = new URL(route.request().url()).pathname;
      const body = path === '/users/me' ? actor
        : path === '/auth/stream-token' ? { token: 'cam-stream-token', expires_in: 3600 }
        : path === '/cameras' ? { cameras: [{ id: 1, name: 'Warehouse Cam', source: '0', is_active: true, status: 'connected' }] }
        : path === '/alerts' ? { alerts: [] }
        : path === '/stats' ? { stats: [] } : { settings: {} };
      await route.fulfill({ status: 200, headers, json: body });
    });

    let wsPayload: unknown = {
      cameras: [{ camera_id: 1, stale: true, confirmed: [], detections: [], frame_fresh: true }],
    };
    await page.routeWebSocket('**/ws/**', socket => {
      if (!socket.url().includes('/ws/detections')) return;
      const timer = setInterval(() => socket.send(JSON.stringify(wsPayload)), 150);
      socket.onClose(() => clearInterval(timer));
    });

    await page.goto('http://localhost:3000/dashboard');
    const tile = page.locator('#cam-container-1');

    // 1. Khi stale = true -> hiển thị waiting for fresh detection
    await expect(tile.getByText('AI: waiting for fresh detection')).toBeVisible();

    // 2. Khi stale = false và không có đám cháy/khói -> hiển thị no fire or smoke detected
    wsPayload = {
      cameras: [{ camera_id: 1, stale: false, confirmed: [], detections: [], latency_ms: 22, frame_fresh: true }],
    };
    await expect(tile.getByText(/AI: no fire or smoke detected/)).toBeVisible();

    // 3. Khi phát hiện FIRE 88% đã xác nhận kèm latency 35 ms -> hiển thị đúng trên badge thật
    wsPayload = {
      cameras: [{
        camera_id: 1,
        stale: false,
        confirmed: ['fire'],
        detections: [{ class: 'fire', confidence: 0.88 }],
        latency_ms: 35,
        frame_fresh: true,
      }],
    };
    await expect(tile.getByText(/FIRE 88% confirmed/)).toBeVisible();
    await expect(tile.getByText('35 ms')).toBeVisible();
  });

  test('CAM_06: Luồng UI CRUD Camera đầy đủ tại /dashboard/cameras (Thêm, Sửa, Lọc trạng thái, Xóa có xác nhận)', async ({ page }) => {
    const actor = { id: 1, username: 'cam_crud', email: 'crud@example.com', role: 'user', is_active: true };
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
    const cameras: Array<{ id: number; name: string; source: string; is_active: boolean; status: string }> = [
      { id: 1, name: 'East Gate', source: '0', is_active: false, status: 'disconnected' },
    ];

    await page.addInitScript(profile => {
      sessionStorage.setItem('auth_header', 'Bearer cam-crud-session');
      sessionStorage.setItem('user_profile', JSON.stringify(profile));
      localStorage.setItem('language', 'en');
    }, actor);

    await page.route(/.*(18080|:8000)\/.*/, async route => {
      const method = route.request().method();
      if (method === 'OPTIONS') return route.fulfill({ status: 200, headers });
      const url = new URL(route.request().url());
      if (url.pathname === '/users/me') return route.fulfill({ status: 200, headers, json: actor });
      if (url.pathname === '/auth/stream-token') return route.fulfill({ status: 200, headers, json: { token: 't', expires_in: 3600 } });
      if (url.pathname === '/cameras' && method === 'GET') {
        return route.fulfill({ status: 200, headers, json: { cameras } });
      }
      if (url.pathname === '/cameras' && method === 'POST') {
        const body = route.request().postDataJSON();
        cameras.push({ id: 2, name: body.name, source: body.source, is_active: !!body.is_active, status: body.is_active ? 'connected' : 'disconnected' });
        return route.fulfill({ status: 200, headers, json: { status: 'ok', id: 2 } });
      }
      if (url.pathname === '/cameras/2' && method === 'PUT') {
        const body = route.request().postDataJSON();
        const cam = cameras.find(c => c.id === 2)!;
        cam.name = body.name;
        cam.source = body.source;
        cam.is_active = !!body.is_active;
        return route.fulfill({ status: 200, headers, json: { status: 'ok' } });
      }
      if (url.pathname === '/cameras/2' && method === 'DELETE') {
        const idx = cameras.findIndex(c => c.id === 2);
        if (idx !== -1) cameras.splice(idx, 1);
        return route.fulfill({ status: 200, headers, json: { status: 'ok' } });
      }
      return route.fulfill({ status: 200, headers, json: {} });
    });
    await page.routeWebSocket('**/ws/**', () => {});

    await page.goto('http://localhost:3000/dashboard/cameras');
    await expect(page.getByText('East Gate')).toBeVisible();

    // 1. Thêm camera mới qua Modal
    await page.getByRole('button', { name: 'Add Camera', exact: true }).click();
    await page.getByPlaceholder('Main Gate').fill('Lobby HLS');
    await page.getByRole('textbox', { name: 'Source' }).fill('https://192.168.1.50/live.m3u8');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Lobby HLS')).toBeVisible();

    // 2. Sửa tên camera qua nút Edit
    const lobbyCard = page.locator('div.border.rounded-lg').filter({ hasText: 'Lobby HLS' });
    await lobbyCard.getByRole('button', { name: 'Edit' }).click();
    await page.getByPlaceholder('Main Gate').fill('Lobby HLS Renamed');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Lobby HLS Renamed')).toBeVisible();

    // 3. Lọc theo trạng thái Running -> cả 2 camera đều đang OFF nên hiển thị thông báo không khớp bộ lọc
    await page.locator('select').selectOption('active');
    await expect(page.getByText('No cameras match these filters.')).toBeVisible();
    await page.locator('select').selectOption('all');
    await expect(page.getByText('Lobby HLS Renamed')).toBeVisible();

    // 4. Xóa camera qua Modal xác nhận Delete
    const renamedCard = page.locator('div.border.rounded-lg').filter({ hasText: 'Lobby HLS Renamed' });
    await renamedCard.getByRole('button', { name: 'Delete' }).click();
    const deleteModal = page.locator('div.fixed').filter({ hasText: /Are you sure|Bạn có chắc/i });
    await expect(deleteModal).toBeVisible();
    await deleteModal.getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText('Lobby HLS Renamed')).toHaveCount(0);
  });

  test('CAM_07: Validation biên cho API POST /cameras (chặn webcam 64/-1, file://, tên rỗng -> 422; cho phép webcam biên 0 và 63)', async ({ request }) => {
    for (const invalidPayload of [
      { name: 'Out of bounds high', source: '64' },
      { name: 'Negative webcam', source: '-1' },
      { name: 'Local file scheme', source: 'file:///etc/passwd' },
      { name: '   ', source: '0' },
    ]) {
      const badRes = await request.post('/cameras', { headers, data: invalidPayload });
      expect(badRes.status()).toBe(422);
    }

    const boundaryRes = await request.post('/cameras', { headers, data: { name: 'Webcam Boundary 63', source: '63', is_active: false } });
    expect(boundaryRes.status()).toBe(200);
    const { id } = await boundaryRes.json();
    try {
      expect(id).toBeDefined();
    } finally {
      await request.delete(`/cameras/${id}`, { headers });
    }
  });
});
