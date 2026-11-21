import { test, expect } from '@playwright/test';

test.describe('Frontend Health Endpoint (/api/health - PR #72)', () => {
  test('HLTH_01: GET /api/health returns 200 OK with ready status and frontend service', async ({ request }) => {
    const response = await request.get('/api/health');
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body).toEqual({
      status: 'ready',
      service: 'frontend',
    });
  });

  test('HLTH_02: GET /api/health returns public cross-origin and no-store headers', async ({ request }) => {
    const response = await request.get('/api/health', {
      headers: {
        Origin: 'https://launcher.fireguard.test',
      },
    });
    expect(response.status()).toBe(200);

    const headers = response.headers();
    expect(headers['access-control-allow-origin']).toBe('*');
    expect(headers['cache-control']).toBe('no-store');
  });

  test('HLTH_03: Calling /api/health with POST is rejected or handled safely', async ({ request }) => {
    const response = await request.post('/api/health');
    // Next.js Route Handlers only export GET, so POST yields 405 Method Not Allowed
    expect([405, 404]).toContain(response.status());
  });
});
