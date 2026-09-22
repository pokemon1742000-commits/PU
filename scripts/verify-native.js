'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const rootDir = path.join(__dirname, '..');
const packageRoot = path.join(rootDir, 'node_modules', 'better-sqlite3');
const bindingRelativePath = path.join('build', 'Release', 'better_sqlite3.node');

function electronExecutable(baseDir = rootDir) {
  const executable = process.platform === 'win32' ? 'electron.exe' : 'electron';
  return path.join(baseDir, 'node_modules', 'electron', 'dist', executable);
}

function sourceBindingPath(baseDir = rootDir) {
  return path.join(baseDir, 'node_modules', 'better-sqlite3', bindingRelativePath);
}

function packagedBindingPath(unpackedDir) {
  const unpackedRoot = path.join(unpackedDir, 'resources', 'app.asar.unpacked');
  return path.join(unpackedRoot, 'node_modules', 'better-sqlite3', bindingRelativePath);
}

function runElectronProbe(bindingPath, jsPackageRoot = packageRoot, electronPath = electronExecutable()) {
  if (!fs.existsSync(bindingPath)) throw new Error(`Không tìm thấy native binding: ${bindingPath}`);
  if (!fs.existsSync(electronPath)) throw new Error(`Không tìm thấy Electron runtime: ${electronPath}`);
  if (!fs.existsSync(path.join(jsPackageRoot, 'lib', 'database.js'))) {
    throw new Error(`Không tìm thấy mã JavaScript better-sqlite3: ${jsPackageRoot}`);
  }

  const probe = path.join(__dirname, 'probe-native.js');
  const result = spawnSync(electronPath, [probe, jsPackageRoot, bindingPath], {
    cwd: rootDir,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    encoding: 'utf8',
    windowsHide: true
  });
  const output = `${result.stdout || ''}${result.stderr || ''}`.trim();
  if (result.error) throw new Error(`Không thể chạy Electron native probe: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`Electron native binding không tải được (exit ${result.status}): ${output}`);
  }
  if (!output.includes('better-sqlite3 native probe: ok')) {
    throw new Error(`Electron native probe không trả về kết quả thành công: ${output}`);
  }
  return { bindingPath, electronPath, output };
}

function verifyElectronSource(baseDir = rootDir) {
  const bindingPath = sourceBindingPath(baseDir);
  return runElectronProbe(bindingPath, path.join(baseDir, 'node_modules', 'better-sqlite3'), electronExecutable(baseDir));
}

function verifyPackaged(unpackedDir) {
  const outputDir = path.resolve(unpackedDir || '');
  if (!unpackedDir) throw new Error('Cách dùng: node scripts/verify-native.js packaged <win-unpacked>');
  const bindingPath = packagedBindingPath(outputDir);
  const unpackedPackageRoot = path.join(outputDir, 'resources', 'app.asar.unpacked', 'node_modules', 'better-sqlite3');
  return runElectronProbe(bindingPath, unpackedPackageRoot);
}

function main() {
  const mode = String(process.argv[2] || '').toLowerCase();
  const result = mode === 'electron'
    ? verifyElectronSource()
    : mode === 'packaged'
      ? verifyPackaged(process.argv[3])
      : (() => { throw new Error('Cách dùng: node scripts/verify-native.js <electron|packaged> [path]'); })();
  console.log(`Native binding OK for Electron: ${result.bindingPath}`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message || String(error));
    process.exitCode = 1;
  }
}

module.exports = {
  bindingRelativePath,
  electronExecutable,
  sourceBindingPath,
  packagedBindingPath,
  runElectronProbe,
  verifyElectronSource,
  verifyPackaged
};
