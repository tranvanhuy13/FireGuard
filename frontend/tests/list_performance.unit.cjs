/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

function load(file, deps) {
  const filename = path.resolve(__dirname, '../src', file);
  const loaded = new Module(filename, module);
  loaded.require = name => deps[name] ?? require(name);
  loaded._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, filename);
  return loaded.exports;
}

test('list cache expires, separates sessions, and refresh invalidates pending reads', async t => {
  let auth = 'Bearer owner-a', now = 100, calls = 0;
  t.mock.method(Date, 'now', () => now);
  let deliver = async () => new Response(JSON.stringify({ calls: ++calls }));
  const { fetchPage, clearPageCache } = load('lib/api/pageCache.ts', {
    './client': { getAuthHeader: () => auth }, './authFetch': { authFetch: (...args) => deliver(...args) },
  });
  assert.equal((await (await fetchPage('/history')).json()).calls, 1);
  assert.equal((await (await fetchPage('/history')).json()).calls, 1);
  now += 5001;
  assert.equal((await (await fetchPage('/history')).json()).calls, 2);
  auth = 'Bearer owner-b';
  assert.equal((await (await fetchPage('/history')).json()).calls, 3);
  clearPageCache();
  let resolve;
  deliver = () => new Promise(done => { resolve = done; });
  const pending = fetchPage('/history');
  clearPageCache();
  resolve(new Response(JSON.stringify({ stale: true })));
  await pending;
  deliver = async () => new Response(JSON.stringify({ calls: ++calls }));
  assert.equal((await (await fetchPage('/history')).json()).calls, 4);
});

test('list cache never retains errors or aborted results', async () => {
  let calls = 0;
  const { fetchPage } = load('lib/api/pageCache.ts', {
    './client': { getAuthHeader: () => 'Bearer owner' },
    './authFetch': { authFetch: async () => { calls++; return new Response('{}', { status: 503 }); } },
  });
  await fetchPage('/history'); await fetchPage('/history');
  assert.equal(calls, 2);
});

test('login stores the returned session instead of password credentials', async () => {
  let header, request;
  class ApiError extends Error {}
  const { api } = load('lib/api/auth.ts', { './client': {
    isMockAuth: false, ApiError,
    apiClient: async (url, options) => {
      request = { url, options };
      return { id: 1, username: 'admin', email: 'admin@example.com', role: 'admin', access_token: 'signed-session' };
    },
    setAuthHeader: value => { header = value; },
  } });
  const result = await api.login({ identifier: 'admin', password: 'password' });
  assert.equal(request.url, '/auth/login');
  assert.match(request.options.headers.Authorization, /^Basic /);
  assert.equal(header, 'Bearer signed-session');
  assert.equal(result.token, header);
});

test('list cache enforces 30-page FIFO eviction, pre-aborted signals, and login Basic fallback', async () => {
  let calls = 0;
  const { fetchPage, clearPageCache } = load('lib/api/pageCache.ts', {
    './client': { getAuthHeader: () => 'Bearer owner-fifo' },
    './authFetch': {
      authFetch: async url => {
        calls++;
        return new Response(JSON.stringify({ url, calls }), { status: 200 });
      },
    },
  });
  clearPageCache();

  // 1. Pre-aborted signal passes an aborted signal to authFetch and never stores response in cache
  const preAborted = new AbortController();
  preAborted.abort(new Error('pre-aborted'));
  await assert.rejects(() => fetchPage('/history?page=aborted', preAborted.signal));
  assert.equal(calls, 1);
  calls = 0;

  // 2. Fill 30 distinct pages into the cache
  for (let i = 1; i <= 30; i++) {
    const res = await fetchPage(`/history?page=${i}`);
    assert.equal((await res.json()).calls, i);
  }
  assert.equal(calls, 30);

  // Page 1 is still cached before adding the 31st entry
  assert.equal((await (await fetchPage('/history?page=1')).json()).calls, 1);
  assert.equal(calls, 30);

  // Adding a 31st page evicts the oldest entry (page 1)
  await fetchPage('/history?page=31');
  assert.equal(calls, 31);

  // Page 2 is still cached, while page 1 must be re-fetched
  assert.equal((await (await fetchPage('/history?page=2')).json()).calls, 2);
  assert.equal(calls, 31);
  assert.equal((await (await fetchPage('/history?page=1')).json()).calls, 32);

  // 3. Abort on a cache hit still throws AbortError
  const hitAbort = new AbortController();
  hitAbort.abort(new Error('aborted-on-hit'));
  await assert.rejects(() => fetchPage('/history?page=2', hitAbort.signal));

  // 4. Login falls back to Basic header if server response omits access_token
  let fallbackHeader;
  class ApiError extends Error {}
  const { api } = load('lib/api/auth.ts', {
    './client': {
      isMockAuth: false,
      ApiError,
      apiClient: async () => ({ id: 2, username: 'operator', email: 'op@example.com', role: 'user' }),
      setAuthHeader: value => { fallbackHeader = value; },
    },
  });
  const loginRes = await api.login({ identifier: '  operator  ', password: 'secret' });
  assert.match(fallbackHeader, /^Basic /);
  assert.equal(loginRes.token, fallbackHeader);
  assert.equal(loginRes.user.role, 'user');
});

test('audit log page enforces 4-column table layout and 4-column CSV export without expanded details', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/app/dashboard/audit-log/page.tsx'), 'utf8');
  // Verify 4 equal-width columns (w-1/4) in table header
  const headerMatches = source.match(/<th className="p-4 w-1\/4/g) || [];
  assert.equal(headerMatches.length, 4, 'Audit log table must have exactly 4 equal-width (w-1/4) columns');
  // Verify CSV export headers have exactly 4 columns: time, user, action, target
  assert.match(source, /const headers = \[n\.cols\.time, n\.cols\.user, n\.cols\.action, n\.cols\.target\];/);
  // Verify expanded row details and colSpan={7} were removed
  assert.equal(source.includes('expandedRow'), false);
  assert.equal(source.includes('colSpan={7}'), false);
  assert.equal(source.includes('colSpan={4}'), true);
});
