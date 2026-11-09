/* eslint-disable @typescript-eslint/no-require-imports */
// Camera paging + demo flag: npm run test:camera-view
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const filename = path.resolve(__dirname, '../src/lib/cameraView.ts');
const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const loaded = new Module(filename, module);
loaded._compile(compiled, filename);
const { computeDemoEnabled, pageCount, clampPage, pageSlice, apiPathname, effectiveStatus, isFrameFresh, applyStreamFailures } = loaded.exports;

const cams = n => Array.from({ length: n }, (_, i) => ({ id: i + 1 }));

test('26 cameras on the 25-CAM layout: camera #26 is reachable on page 2', () => {
  const all = cams(26);
  assert.equal(pageCount(26, 25), 2);
  assert.equal(pageSlice(all, 0, 25).length, 25);
  const last = pageSlice(all, 1, 25);
  assert.deepEqual(last.map(c => c.id), [26]);
});

test('every camera appears exactly once across pages for all layouts', () => {
  for (const per of [4, 9, 16, 25]) {
    const all = cams(26);
    const seen = [];
    for (let p = 0; p < pageCount(26, per); p++) seen.push(...pageSlice(all, p, per).map(c => c.id));
    assert.deepEqual(seen, all.map(c => c.id));
  }
});

test('page is clamped when cameras are removed or the layout grows', () => {
  assert.equal(clampPage(5, 26, 25), 1);
  assert.equal(clampPage(-1, 26, 25), 0);
  assert.equal(clampPage(3, 0, 4), 0);
  assert.equal(pageCount(0, 4), 1);
  assert.deepEqual(pageSlice(cams(26), 9, 25).map(c => c.id), [26]);
});

test('demoEnabled = isMockData && USE_DEMO_CAMERAS for all four combinations', () => {
  assert.equal(computeDemoEnabled(false, false), false);
  assert.equal(computeDemoEnabled(false, true), false); // real data: no DEMO label, add-camera visible
  assert.equal(computeDemoEnabled(true, false), false);
  assert.equal(computeDemoEnabled(true, true), true);
});

test('API prefix is stripped before matching /cameras (NEXT_PUBLIC_API_URL with /api)', () => {
  assert.equal(apiPathname('/api/cameras', 'https://host/api'), '/cameras');
  assert.equal(apiPathname('/api/cameras/3/toggle', 'https://host/api/'), '/cameras/3/toggle');
  assert.equal(apiPathname('/cameras', 'http://localhost:8000'), '/cameras');
  assert.equal(apiPathname('/api/cameras', '/api'), '/cameras');
  assert.equal(apiPathname('/apix/cameras', 'https://host/api'), '/apix/cameras');
  assert.equal(apiPathname('/api', 'https://host/api'), '/');
});

test('a failed HLS stream is shown as disconnected and recovers', () => {
  assert.equal(effectiveStatus(true, 'connected', true), 'disconnected');
  assert.equal(effectiveStatus(true, 'connected', false), 'connected');
  assert.equal(effectiveStatus(false, 'disconnected', true), 'disconnected');
  const cams = [{ id: 1, is_active: true, status: 'connected' }, { id: 2, is_active: true, status: 'connected' }];
  const kpi = list => list.filter(c => c.is_active && c.status === 'connected').length;
  assert.equal(kpi(applyStreamFailures(cams, [2])), 1);
  assert.equal(kpi(applyStreamFailures(cams, [])), 2);
});

test('timestamp is only "live" while video frames keep arriving', () => {
  assert.equal(isFrameFresh(undefined, 10000), false);
  assert.equal(isFrameFresh(9000, 10000), true);
  assert.equal(isFrameFresh(1000, 10000), false);
});
