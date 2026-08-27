const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const packageJson = require('../package.json');
const server = fs.readFileSync(path.join(root, 'web-server.js'), 'utf8');
const webApi = fs.readFileSync(path.join(root, 'renderer', 'web-api.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'renderer', 'index.html'), 'utf8');

test('web server only runs through the explicit web command', () => {
  assert.equal(packageJson.scripts.start, 'electron .');
  assert.equal(packageJson.scripts['start:desktop'], 'electron .');
  assert.equal(packageJson.scripts['start:web'], 'node web-server.js');
  assert.match(server, /express\.static\(path\.join\(ROOT_DIR, 'renderer'\)\)/);
  assert.match(server, /app\.get\('\/api\/state'/);
  assert.match(server, /app\.post\('\/api\/files\/inspect'/);
  assert.match(server, /app\.get\('\/api\/export'/);
});

test('browser adapter covers the API previously exposed by Electron preload', () => {
  assert.match(html, /<script src="web-api\.js"><\/script>[\s\S]*<script src="app\.js"><\/script>/);
  for (const method of ['getState','pickFiles','loadFiles','runComparison','getRows','resolveReview','savePurchaseReplacement','deletePurchaseReplacement','clearSession','deleteDatabase','exportExcel']) {
    assert.match(webApi, new RegExp(`${method}:`));
  }
  assert.match(webApi, /new FormData\(\)/);
  assert.match(webApi, /URL\.createObjectURL\(blob\)/);
});

test('web uploads are tokenized, size-limited, and never accept client file paths', () => {
  assert.match(server, /fileSize:150 \* 1024 \* 1024/);
  assert.match(server, /uploadedFiles\.get\(selection\.path\)/);
  assert.match(server, /File táº£i lÃªn Ä‘Ã£ háº¿t háº¡n/);
  assert.match(server, /mutationQueue/);
});
