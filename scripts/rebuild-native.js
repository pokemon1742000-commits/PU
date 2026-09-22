'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const runtime = String(process.argv[2] || '').trim().toLowerCase();
if (!['node', 'electron'].includes(runtime)) {
  console.error('Cách dùng: node scripts/rebuild-native.js <node|electron>');
  process.exitCode = 1;
  return;
}

const rootDir = path.join(__dirname, '..');
const electronVersion = require(path.join(rootDir, 'node_modules', 'electron', 'package.json')).version;
const npmCli = process.env.npm_execpath;
const command = npmCli ? process.execPath : (process.platform === 'win32' ? 'npm.cmd' : 'npm');
let args;
const env = { ...process.env };

if (runtime === 'node') {
  args = ['rebuild', 'better-sqlite3', '--update-binary'];
  env.npm_config_runtime = 'node';
  delete env.npm_config_target;
  delete env.npm_config_electron_version;
  console.log(`Rebuilding better-sqlite3 for Node ${process.version} (ABI ${process.versions.modules})...`);
} else {
  args = ['--force', '--which-module', 'better-sqlite3', '--version', electronVersion];
  console.log(`Rebuilding better-sqlite3 for Electron ${electronVersion}...`);
}

const nodeArgs = npmCli ? [npmCli, ...args] : args;
const result = runtime === 'node'
  ? spawnSync(command, nodeArgs, { cwd: rootDir, env, stdio: 'inherit', shell: false })
  : spawnSync(path.join(rootDir, 'node_modules', '.bin', process.platform === 'win32' ? 'electron-rebuild.cmd' : 'electron-rebuild'), args, {
    cwd: rootDir,
    env,
    stdio: 'inherit',
    shell: process.platform === 'win32'
  });

if (result.error) {
  console.error(`Không thể rebuild better-sqlite3: ${result.error.message}`);
  process.exitCode = 1;
} else if (result.status !== 0) {
  process.exitCode = result.status ?? 1;
}
