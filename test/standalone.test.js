const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const packageJson = require('../package.json');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'standalone', 'app.js'), 'utf8');
const builder = fs.readFileSync(path.join(root, 'scripts', 'build-standalone.js'), 'utf8');

test('standalone web build is backend-free and stores state in IndexedDB', () => {
  assert.equal(packageJson.scripts['build:web'], 'node scripts/build-standalone.js');
  assert.match(source, /indexedDB\.open/);
  assert.doesNotMatch(source, /fetch\('\/api|fetch\("\/api/);
  assert.match(source, /processFiles\('reference'/);
  assert.match(source, /exportWorkbookBuffer/);
});

test('standalone builder inlines scripts, styles, images, and the Job Code workbook', () => {
  assert.match(builder, /bundle:true/);
  assert.match(builder, /'\.xlsx':'dataurl'/);
  assert.match(builder, /data:image\/png;base64/);
  assert.match(builder, /<style>/);
  assert.match(builder, /standalone', 'index\.html'/);
});
