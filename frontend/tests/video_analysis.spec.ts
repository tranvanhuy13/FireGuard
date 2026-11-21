import { test, expect } from '@playwright/test';
import { BACKEND_URL, basicAuth, REAL_USER } from './helpers';

test.describe('Phân tích Video Tải lên & Điều khiển Playback (Video Analysis & Playback Controls)', () => {
  test.use({ baseURL: BACKEND_URL });

  const headers = basicAuth(REAL_USER.username, REAL_USER.password);

  test('VID_01: Lấy danh sách tác vụ phân tích video (GET /video-analysis)', async ({ request }) => {
    const res = await request.get('/video-analysis', { headers });
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('jobs');
    expect(Array.isArray(data.jobs)).toBe(true);
  });

  test('VID_02: Upload file sai định dạng (text/plain) -> Báo lỗi 400 Unsupported file type', async ({ request }) => {
    const res = await request.post('/video-analysis', {
      headers,
      multipart: {
        file: {
          name: 'test.txt',
          mimeType: 'text/plain',
          buffer: Buffer.from('This is not a video file'),
        },
      },
    });
    expect(res.status()).toBe(400);
    const data = await res.json();
    expect(data.detail).toContain('Unsupported file type');
  });

  test('VID_03: Upload file rỗng (0 bytes) -> Báo lỗi 400 The uploaded file is empty', async ({ request }) => {
    const res = await request.post('/video-analysis', {
      headers,
      multipart: {
        file: {
          name: 'empty.mp4',
          mimeType: 'video/mp4',
          buffer: Buffer.from(''),
        },
      },
    });
    expect(res.status()).toBe(400);
    const data = await res.json();
    expect(data.detail.toLowerCase()).toContain('empty');
  });

  test('VID_04: Điều khiển Playback (POST /video-analysis/{job_id}/playback) với job không tồn tại -> 404', async ({ request }) => {
    const res = await request.post('/video-analysis/non_existent_job_123/playback', {
      headers,
      data: { action: 'pause' },
    });
    expect(res.status()).toBe(404);
    const data = await res.json();
    expect(data.detail).toBe('Analysis job not found');
  });

  test('VID_05: Điều khiển Playback với action không hợp lệ -> 422 Unprocessable Entity', async ({ request }) => {
    const res = await request.post('/video-analysis/non_existent_job_123/playback', {
      headers,
      data: { action: 'forward_fast' },
    });
    expect(res.status()).toBe(422);
  });

  test('VID_06: Hủy tác vụ phân tích (POST /video-analysis/{job_id}/cancel) với job không tồn tại -> 404', async ({ request }) => {
    const res = await request.post('/video-analysis/non_existent_job_123/cancel', { headers });
    expect(res.status()).toBe(404);
  });

  test('VID_07: Tra cứu chi tiết job (GET /video-analysis/{job_id}) không tồn tại -> 404', async ({ request }) => {
    const res = await request.get('/video-analysis/non_existent_job_123', { headers });
    expect(res.status()).toBe(404);
  });
});
