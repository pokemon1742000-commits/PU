const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const rebuildScript = fs.readFileSync(path.join(root, 'scripts', 'rebuild-native.js'), 'utf8');

test('native SQLite dependency has explicit Node and Electron rebuild hooks', () => {
  assert.equal(packageJson.scripts.pretest, 'npm run rebuild:node');
  assert.equal(packageJson.scripts.prestart, 'npm run rebuild:electron');
  assert.equal(packageJson.scripts['prestart:desktop'], 'npm run rebuild:electron');
  assert.equal(packageJson.scripts['rebuild:node'], 'node scripts/rebuild-native.js node');
  assert.equal(packageJson.scripts['rebuild:electron'], 'node scripts/rebuild-native.js electron');
  assert.match(packageJson.scripts.check, /scripts\/rebuild-native\.js/);
  assert.match(packageJson.scripts.test, /test\/native-runtime\.test\.js/);
  assert.match(rebuildScript, /better-sqlite3/);
  assert.match(rebuildScript, /npm_config_runtime = 'node'/);
  assert.match(rebuildScript, /electron-rebuild/);
  assert.match(rebuildScript, /--which-module/);
  assert.match(rebuildScript, /--version/);
  assert.equal(typeof packageJson.devDependencies['@electron/rebuild'], 'string');
});
