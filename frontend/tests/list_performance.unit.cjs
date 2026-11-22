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
