const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const rebuildScript = fs.readFileSync(path.join(root, 'scripts', 'rebuild-native.js'), 'utf8');
const verifyNativeScript = fs.readFileSync(path.join(root, 'scripts', 'verify-native.js'), 'utf8');
const probeScript = fs.readFileSync(path.join(root, 'scripts', 'probe-native.js'), 'utf8');
const releaseScript = fs.readFileSync(path.join(root, 'scripts', 'release-auto.ps1'), 'utf8');
const publishScript = fs.readFileSync(path.join(root, 'scripts', 'publish.ps1'), 'utf8');

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

test('packaging owns Electron native preparation and verification', () => {
  assert.equal(packageJson.scripts['prepare:electron-native'], 'npm run rebuild:electron && node scripts/verify-native.js electron');
  assert.equal(packageJson.scripts['verify:packaged'], 'node scripts/verify-native.js packaged');
  assert.equal(packageJson.scripts['pre-dist'], 'npm run prepare:electron-native');
  assert.match(packageJson.scripts.dist, /--x64/);
  assert.match(packageJson.scripts.dist, /--config\.npmRebuild=false/);
  assert.equal(packageJson.build.npmRebuild, false);
  assert.ok(packageJson.build.asarUnpack.includes('node_modules/better-sqlite3/**/*'));
  assert.match(verifyNativeScript, /ELECTRON_RUN_AS_NODE/);
  assert.match(verifyNativeScript, /resources.*app\.asar\.unpacked/);
  assert.match(verifyNativeScript, /better_sqlite3\.node/);
  assert.match(probeScript, /SELECT 1 AS value/);
  assert.match(probeScript, /process\.versions\.modules !== '136'/);
  assert.match(probeScript, /process\.versions\.electron !== '37\.10\.3'/);
  assert.match(verifyNativeScript, /app\.asar\.unpacked/);
  assert.match(rebuildScript, /electronVersion/);
  assert.match(releaseScript, /prepare:electron-native/);
  assert.match(releaseScript, /verify:packaged/);
  assert.ok(releaseScript.indexOf('prepare:electron-native') < releaseScript.indexOf('electron-builder'));
  assert.ok(releaseScript.indexOf('electron-builder') < releaseScript.indexOf('verify:packaged'));
  assert.match(releaseScript, /Join-Path \$buildOutput 'win-unpacked'/);
  assert.match(publishScript, /prepare:electron-native/);
  assert.match(publishScript, /verify:packaged/);
  assert.match(publishScript, /Join-Path \$portableOutput 'win-unpacked'/);
});
