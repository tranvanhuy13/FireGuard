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

  test('VID_08: Giao diện VideoAnalysisModal: tải lên video, nhận luồng WebSocket playback, điều khiển Pause/Play/Stop và Retry thông báo bot', async ({ page }) => {
    const actor = { id: 1, username: 'video_operator', email: 'vid@example.com', role: 'user', is_active: true };
    const corsHeaders = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
    const actions: string[] = [];
    let retried = false;

    await page.addInitScript(profile => {
      sessionStorage.setItem('auth_header', 'Bearer video-ui-session');
      sessionStorage.setItem('user_profile', JSON.stringify(profile));
      localStorage.setItem('language', 'en');
    }, actor);

    await page.route(/.*(18080|:8000)\/.*/, async route => {
      const method = route.request().method();
      if (method === 'OPTIONS') return route.fulfill({ status: 200, headers: corsHeaders });
      const url = new URL(route.request().url());
      if (url.pathname === '/users/me') return route.fulfill({ status: 200, headers: corsHeaders, json: actor });
      if (url.pathname === '/auth/stream-token') return route.fulfill({ status: 200, headers: corsHeaders, json: { token: 'vid-token', expires_in: 3600 } });
      if (url.pathname === '/cameras') return route.fulfill({ status: 200, headers: corsHeaders, json: { cameras: [{ id: 1, name: 'Cam 1', source: '0', is_active: false, status: 'disconnected' }] } });
      if (url.pathname === '/video-analysis' && method === 'POST') {
        return route.fulfill({ status: 200, headers: corsHeaders, json: { job_id: 'job-ui-1' } });
      }
      if (url.pathname === '/video-analysis/job-ui-1/playback' && method === 'POST') {
        const body = route.request().postDataJSON();
        actions.push(body.action);
        return route.fulfill({ status: 200, headers: corsHeaders, json: { job_id: 'job-ui-1' } });
      }
      if (url.pathname === '/video-analysis/job-ui-1/cancel' && method === 'POST') {
        actions.push('cancel');
        return route.fulfill({ status: 200, headers: corsHeaders, json: { status: 'ok' } });
      }
      if (url.pathname === '/video-analysis/job-ui-1/notifications/retry' && method === 'POST') {
        retried = true;
        return route.fulfill({
          status: 200,
          headers: corsHeaders,
          json: {
            id: 'job-ui-1', filename: 'sample.mp4', status: 'processing', progress: 0.5, duration: 10,
            current_time: 5, sample_fps: 10, frames_analyzed: 25, effective_fps: 10, buffering: false,
            detections: [{ class: 'fire', confidence: 0.92, bbox: [10, 10, 50, 50] }],
            confirmed: ['fire'], events: [], summary: {}, verdict: 'fire', error: null,
            notification_pending: 0,
            notifications: { fire: { telegram: { status: 'sent', target_count: 1, sent_count: 1 } } },
          },
        });
      }
      return route.fulfill({ status: 200, headers: corsHeaders, json: { alerts: [], stats: [], settings: {} } });
    });

    await page.routeWebSocket('**/ws/**', socket => {
      if (!socket.url().includes('/ws/video-analysis/job-ui-1')) return;
      socket.send(JSON.stringify({
        id: 'job-ui-1', filename: 'sample.mp4', status: 'processing', revision: retried ? 2 : 1, frame_id: 1,
        progress: 0.5, duration: 10, current_time: 5, sample_fps: 10, frames_analyzed: 25,
        effective_fps: 10, buffering: false,
        detections: [{ class: 'fire', confidence: 0.92, bbox: [10, 10, 50, 50] }],
        confirmed: ['fire'], events: [], summary: {}, verdict: 'fire', error: null,
        notification_pending: 0,
        notifications: {
          fire: {
            telegram: retried
              ? { status: 'sent', target_count: 1, sent_count: 1 }
              : { status: 'failed', description: 'Bot timeout' },
          },
        },
      }));
    });

    await page.goto('http://localhost:3000/dashboard');
    await page.getByRole('button', { name: /Analyze Video/i }).click();
    const dialog = page.getByRole('dialog', { name: 'Analyze Video' });
    await expect(dialog).toBeVisible();

    // Chọn file video hợp lệ và bấm Upload and play
    const fileInput = dialog.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: 'sample.mp4',
      mimeType: 'video/mp4',
      buffer: Buffer.from('fake-mp4-binary-content'),
    });
    await dialog.getByRole('button', { name: 'Upload and play' }).click();

    // Kiểm tra trạng thái nhận diện trực tiếp từ WebSocket
    await expect(dialog.getByText('FIRE CONFIRMED')).toBeVisible();
    await expect(dialog.getByText(/25 frames checked/)).toBeVisible();

    // Thử lại gửi thông báo kênh Telegram bị lỗi
    const retryBtn = dialog.getByRole('button', { name: /Retry this channel|Thử lại kênh này/i });
    await expect(retryBtn).toBeVisible();
    await retryBtn.click();
    await expect.poll(() => retried).toBe(true);
    await expect(dialog.getByText(/FIRE · telegram: Sent/i)).toBeVisible();

    // Điều khiển Pause và Stop
    await dialog.getByRole('button', { name: 'Pause', exact: true }).click();
    await dialog.getByRole('button', { name: 'Stop', exact: true }).click();
    expect(actions).toEqual(['pause', 'cancel']);
  });

  test('VID_09: Giao diện VideoAnalysisModal hiển thị lỗi khi API upload trả về 429 Too many jobs hoặc lỗi mạng', async ({ page }) => {
    const actor = { id: 1, username: 'video_err', email: 'viderr@example.com', role: 'user', is_active: true };
    const corsHeaders = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };

    await page.addInitScript(profile => {
      sessionStorage.setItem('auth_header', 'Bearer video-err-session');
      sessionStorage.setItem('user_profile', JSON.stringify(profile));
      localStorage.setItem('language', 'en');
    }, actor);

    await page.route(/.*(18080|:8000)\/.*/, async route => {
      const method = route.request().method();
      if (method === 'OPTIONS') return route.fulfill({ status: 200, headers: corsHeaders });
      const url = new URL(route.request().url());
      if (url.pathname === '/users/me') return route.fulfill({ status: 200, headers: corsHeaders, json: actor });
      if (url.pathname === '/auth/stream-token') return route.fulfill({ status: 200, headers: corsHeaders, json: { token: 'vid-err', expires_in: 3600 } });
      if (url.pathname === '/cameras') return route.fulfill({ status: 200, headers: corsHeaders, json: { cameras: [] } });
      if (url.pathname === '/video-analysis' && method === 'POST') {
        return route.fulfill({ status: 429, headers: corsHeaders, json: { detail: 'Too many concurrent video analyses' } });
      }
      return route.fulfill({ status: 200, headers: corsHeaders, json: { alerts: [], stats: [], settings: {} } });
    });
    await page.routeWebSocket('**/ws/**', () => {});

    await page.goto('http://localhost:3000/dashboard');
    await page.getByRole('button', { name: /Analyze Video/i }).click();
    const dialog = page.getByRole('dialog', { name: 'Analyze Video' });
    await dialog.locator('input[type="file"]').setInputFiles({
      name: 'clip.mp4',
      mimeType: 'video/mp4',
      buffer: Buffer.from('mp4-bytes'),
    });
    await dialog.getByRole('button', { name: 'Upload and play' }).click();
    await expect(dialog.getByRole('alert')).toContainText('Too many concurrent video analyses');
  });
});
