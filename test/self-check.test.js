const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { runSelfCheck } = require('../src/self-check');

test('self-check validates core files, rules, Excel export, and temporary persistence', async () => {
  const report = await runSelfCheck({ rootDir:path.join(__dirname, '..') });
  assert.equal(report.ok, true, report.checks.filter(item => !item.passed).map(item => item.detail).join('; '));
  assert.equal(report.failed, 0);
  assert.equal(report.passed, report.total);
  assert.deepEqual(report.checks.map(item => item.id), ['files','configuration','exact-match','gc-match','pu-check','database']);
});
