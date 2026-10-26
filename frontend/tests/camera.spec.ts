import { test, expect } from '@playwright/test';
import { BACKEND_URL } from './helpers';

test.describe('Quản lý Camera, Bật/Tắt & Trạng thái Nhận diện (Camera Management & Detection Status)', () => {
  test.use({ baseURL: BACKEND_URL });

  test('CAM_01: Lấy danh sách camera (GET /cameras) trả về mảng danh sách hợp lệ', async ({ request }) => {
    const res = await request.get('/cameras');
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
      data: {
        source: 'rtsp://192.168.1.100:554/live',
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
        data: {
          name: 'Camera Kiểm Thử Đã Đổi Tên',
          is_active: false,
        },
      });
      expect(putRes.status()).toBe(200);
      const putData = await putRes.json();
      expect(putData.status).toBe('ok');

      // 3. Bật lại camera qua toggle API
      const toggleRes = await request.post(`/cameras/${camId}/toggle?active=true`);
      expect(toggleRes.status()).toBe(200);
      expect((await toggleRes.json()).message).toContain('enabled');
    } finally {
      // Dọn dẹp: Xóa camera tạm
      await request.delete(`/cameras/${camId}`);
    }
  });

  test('CAM_03: PUT /cameras/{id} với id không tồn tại trả về 404', async ({ request }) => {
    const res = await request.put('/cameras/9999999', {
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
    const res = await request.post('/cameras/9999999/toggle?active=false');
    expect(res.status()).toBe(404);
    const data = await res.json();
    expect(data.detail).toBe('Camera not found');
  });

  test('CAM_05: Logic kiểm tra trạng thái Stale Expiry của CameraDetectionStatus', () => {
    // Kiểm tra định dạng chuỗi hiển thị theo logic CameraDetectionStatus.tsx
    const formatStatus = (state?: { stale: boolean; confirmed: string[]; detections: { class: string; confidence: number }[]; latency_ms?: number }) => {
      if (!state || state.stale) return 'AI: waiting for fresh detection';
      const names = Array.from(new Set(state.detections.map(d => d.class)));
      if (!names.length) return 'AI: no fire or smoke detected';
      const detail = names.map(name => {
        const conf = Math.max(...state.detections.filter(d => d.class === name).map(d => d.confidence));
        return `${name.toUpperCase()} ${(conf * 100).toFixed(0)}%${state.confirmed.includes(name) ? ' confirmed' : ' confirming…'}`;
      }).join(' · ');
      return state.latency_ms ? `${detail} · ${state.latency_ms} ms` : detail;
    };

    expect(formatStatus(undefined)).toBe('AI: waiting for fresh detection');
    expect(formatStatus({ stale: true, confirmed: [], detections: [] })).toBe('AI: waiting for fresh detection');
    expect(formatStatus({ stale: false, confirmed: [], detections: [] })).toBe('AI: no fire or smoke detected');
    expect(formatStatus({
      stale: false,
      confirmed: ['fire'],
      detections: [{ class: 'fire', confidence: 0.88 }],
      latency_ms: 35,
    })).toBe('FIRE 88% confirmed · 35 ms');
  });
});
