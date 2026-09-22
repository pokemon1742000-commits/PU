'use strict';

const path = require('path');

const packageRoot = path.resolve(process.argv[2] || '');
const bindingPath = path.resolve(process.argv[3] || '');
if (!packageRoot || !bindingPath) throw new Error('Native probe requires package and binding paths.');
if (process.versions.modules !== '136') throw new Error(`Expected Electron ABI 136, got ${process.versions.modules}.`);
if (process.versions.electron !== '37.10.3') throw new Error(`Expected Electron 37.10.3, got ${process.versions.electron || 'unknown'}.`);

const Database = require(path.join(packageRoot, 'lib', 'database.js'));
const db = new Database(':memory:', { nativeBinding: bindingPath });
try {
  const row = db.prepare('SELECT 1 AS value').get();
  if (row?.value !== 1) throw new Error('Unexpected SQLite probe result.');
} finally {
  db.close();
}
console.log('better-sqlite3 native probe: ok');
