/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const filename = path.resolve(__dirname, '../src/lib/api/client.ts');
const loaded = new Module(filename, module);
loaded.require = name => name === '@/config' ? { API_URL: 'http://offline.invalid' } : require(name);
loaded._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, filename);
const { apiClient } = loaded.exports;
const untilAbort = signal => new Promise((resolve, reject) => {
  if (signal.aborted) reject(signal.reason);
  else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
});

test('timeout still cancels fetch when caller provides its own signal', async t => {
  t.mock.method(global, 'fetch', (_url, init) => untilAbort(init.signal));
  await assert.rejects(apiClient('/history', { signal: new AbortController().signal, timeout: 15 }),
    error => error.status === 408);
});
test('caller cancellation propagates through the combined controller', async t => {
  t.mock.method(global, 'fetch', (_url, init) => untilAbort(init.signal));
  const caller = new AbortController();
  const pending = apiClient('/history', { signal: caller.signal, timeout: 1000 });
  caller.abort();
  await assert.rejects(pending, error => error.status === 408);
});
test('deadline includes reading a stalled JSON body after response headers', async t => {
  t.mock.method(global, 'fetch', async (_url, init) => ({ ok: true, json: () => untilAbort(init.signal) }));
  await assert.rejects(apiClient('/history', { timeout: 15 }), error => error.status === 408);
});
