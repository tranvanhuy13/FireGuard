/* eslint-disable @typescript-eslint/no-require-imports */
// Offline transport regressions: npm run test:connection
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const filename = path.resolve(__dirname, '../src/lib/dashboardConnection.ts');
const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const loaded = new Module(filename, module);
loaded._compile(compiled, filename);
const { startPolling, startAlertStream, mergeAlerts } = loaded.exports;
const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
const response = (data = {}, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers });

function harness(t, overrides = {}) {
  let now = 0;
  let id = 0;
  const tasks = new Map();
  const states = [], data = [], requests = [];
  t.mock.method(Date, 'now', () => now);
  const clock = {
    schedule: (fn, delay) => { const key = ++id; tasks.set(key, { fn, at: now + delay }); return key; },
    cancel: key => tasks.delete(key),
    async advance(duration) {
      const end = now + duration;
      while (true) {
        const next = [...tasks.entries()].filter(([, value]) => value.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        now = next[1].at; tasks.delete(next[0]); next[1].fn(); await flush();
      }
      now = end; await flush();
    },
    size: () => tasks.size,
  };
  const request = (_, { signal }) => new Promise((resolve, reject) => {
    requests.push({ resolve, reject, signal });
    signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  });
  const controller = startPolling({ url: '/alerts', interval: 3000,
    onState: state => states.push(state), onData: value => data.push(value),
    request, online: () => true, visible: () => true, ...clock, ...overrides });
  t.after(() => controller.dispose());
  return { controller, states, data, requests, clock };
}

test('a response slower than the old 8-second deadline succeeds', async t => {
  const h = harness(t);
  await h.clock.advance(9000);
  assert.equal(h.requests[0].signal.aborted, false);
  h.requests[0].resolve(response({ alerts: [] })); await flush();
  assert.equal(h.states.at(-1), 'ready');
});

test('30-second timeout retries with backoff and recovers', async t => {
  const h = harness(t);
  await h.clock.advance(30000);
  assert.equal(h.requests[0].signal.aborted, true);
  assert.equal(h.states.at(-1), 'retrying');
  await h.clock.advance(1999); assert.equal(h.requests.length, 1);
  await h.clock.advance(1); assert.equal(h.requests.length, 2);
  h.requests[1].resolve(response({ alerts: [] })); await flush();
  assert.equal(h.states.at(-1), 'ready');
});

test('polling waits for completion instead of overlapping slow requests', async t => {
  const h = harness(t);
  await h.clock.advance(15000); assert.equal(h.requests.length, 1);
  h.requests[0].resolve(response({})); await flush();
  await h.clock.advance(2999); assert.equal(h.requests.length, 1);
  await h.clock.advance(1); assert.equal(h.requests.length, 2);
});

test('retry ignores a late response even when transport ignores abort', async t => {
  const pending = [];
  const h = harness(t, { request: () => new Promise(resolve => pending.push(resolve)) });
  h.controller.retry();
  pending[1](response({ version: 'new' })); await flush();
  pending[0](response({ version: 'old' })); await flush();
  assert.deepEqual(h.data, [{ version: 'new' }]);
  assert.equal(h.states.at(-1), 'ready');
});

test('dispose aborts requests, clears timers and ignores late callbacks', async t => {
  const h = harness(t);
  h.controller.dispose(); await flush();
  const count = h.states.length;
  await h.clock.advance(100000);
  assert.equal(h.requests[0].signal.aborted, true);
  assert.equal(h.clock.size(), 0);
  assert.equal(h.states.length, count);
});

for (const status of [401, 403, 404]) {
  test(`HTTP ${status} does not loop retries`, async t => {
    const h = harness(t);
    h.requests[0].resolve(response({}, status)); await flush();
    await h.clock.advance(100000);
    assert.equal(h.requests.length, 1);
    assert.equal(h.states.at(-1), status === 404 ? 'failed' : 'forbidden');
  });
}

test('429 Retry-After is respected by automatic and manual retries', async t => {
  const h = harness(t);
  h.requests[0].resolve(response({}, 429, { 'Retry-After': '60' })); await flush();
  h.controller.retry();
  await h.clock.advance(59999); assert.equal(h.requests.length, 1);
  await h.clock.advance(1); assert.equal(h.requests.length, 2);
});

test('repeated server failures stop after five automatic retries', async t => {
  const h = harness(t);
  for (let i = 0; i < 6; i++) {
    h.requests[i].resolve(response({}, 500)); await flush();
    if (i < 5) await h.clock.advance(Math.min(30000, 2000 * 2 ** i));
  }
  assert.equal(h.states.at(-1), 'failed');
  assert.equal(h.clock.size(), 0);
});

test('offline and hidden tabs defer requests and recover on retry', async t => {
  let online = false, visible = true;
  const h = harness(t, { online: () => online, visible: () => visible });
  assert.equal(h.states.at(-1), 'offline'); assert.equal(h.requests.length, 0);
  online = true; visible = false; h.controller.retry();
  await h.clock.advance(15000); assert.equal(h.requests.length, 0);
  visible = true; h.controller.retry(); assert.equal(h.requests.length, 1);
});

function sockets(t) {
  const h = harness(t);
  h.controller.dispose();
  const instances = [], states = [], alerts = [];
  let connected = 0, refreshed = 0;
  const stop = startAlertStream({ url: 'wss://example/ws/alerts', ...h.clock,
    onState: value => states.push(value), onAlert: value => alerts.push(value),
    onConnected: () => connected++, refreshToken: async () => refreshed++,
    createSocket: () => {
      const socket = { close() { this.onclose?.({ code: 1006 }); } };
      instances.push(socket); return socket;
    },
  });
  t.after(stop);
  return { ...h, stop, instances, states, alerts, connected: () => connected, refreshed: () => refreshed };
}

test('WebSocket reconnects once and ignores events from the old socket', async t => {
  const h = sockets(t);
  const old = h.instances[0]; const staleOpen = old.onopen;
  old.onopen(); old.onclose({ code: 1006 });
  staleOpen(); assert.equal(h.connected(), 1);
  await h.clock.advance(2000); assert.equal(h.instances.length, 2);
  h.instances[1].onopen(); assert.equal(h.states.at(-1), 'connected');
  h.instances[1].onmessage({ data: JSON.stringify({ id: 1 }) });
  assert.deepEqual(h.alerts, [{ id: 1 }]);
  h.stop(); await h.clock.advance(100000); assert.equal(h.instances.length, 2);
});

test('policy close refreshes credentials; disposing prevents later reconnect', async t => {
  const h = sockets(t);
  await h.instances[0].onclose({ code: 1008 });
  assert.equal(h.refreshed(), 1);
  h.stop(); await h.clock.advance(100000);
  assert.equal(h.instances.length, 1);
});

test('history responses preserve newer live alerts without duplicating IDs', () => {
  const live = { id: 2, timestamp: '2026-10-30 12:00:02', type: 'fire' };
  const history = { id: 1, timestamp: '2026-10-30 12:00:01', type: 'smoke' };
  assert.deepEqual(mergeAlerts([history], [live, history]), [live, history]);
});
