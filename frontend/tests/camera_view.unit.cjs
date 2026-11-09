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
const { computeDemoEnabled, pageCount, clampPage, pageSlice } = loaded.exports;

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
