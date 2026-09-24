const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { Database } = require('../src/storage');
const { markerPath, prepareDataVersion, completeDataVersion } = require('../src/version-data');

async function temporaryUserData(t) {
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'doi-chieu-version-'));
  t.after(() => fs.rm(userDataDir, { recursive:true, force:true }));
  return userDataDir;
}

async function writeMarker(userDataDir, version) {
  await fs.writeFile(markerPath(userDataDir), JSON.stringify({ version }), 'utf8');
}

test('same application version preserves the complete data directory', async t => {
  const userDataDir = await temporaryUserData(t);
  const sentinel = path.join(userDataDir, 'data', 'original-files', 'keep.xlsx');
  await fs.mkdir(path.dirname(sentinel), { recursive:true });
  await fs.writeFile(sentinel, 'keep');
  await writeMarker(userDataDir, '1.0.29');

  const result = await prepareDataVersion({ userDataDir, currentVersion:'1.0.29' });

  assert.equal(result.reset, false);
  assert.equal(await fs.readFile(sentinel, 'utf8'), 'keep');
});

test('a newer application version removes all old application data before initialization', async t => {
  const userDataDir = await temporaryUserData(t);
  const dataDir = path.join(userDataDir, 'data');
  const database = new Database(dataDir);
  await database.init();
  await database.mergePurchases([{ projectCode:'AUT1', purchaseOrder:'PR-1', itemCode:'A', quantity:3 }]);
  await database.close();
  await fs.mkdir(path.join(dataDir, 'original-files'), { recursive:true });
  await fs.writeFile(path.join(dataDir, 'original-files', 'source.xlsx'), 'old source');
  await writeMarker(userDataDir, '1.0.29');

  const result = await prepareDataVersion({ userDataDir, currentVersion:'1.0.30' });

  assert.equal(result.reset, true);
  await assert.rejects(() => fs.access(dataDir));
  const freshDatabase = new Database(dataDir);
  await freshDatabase.init();
  assert.deepEqual(await freshDatabase.readPurchases(), []);
  await assert.rejects(() => fs.access(path.join(dataDir, 'original-files', 'source.xlsx')));
  await freshDatabase.close();
});

test('a downgrade also removes data from the different installed version', async t => {
  const userDataDir = await temporaryUserData(t);
  const sentinel = path.join(userDataDir, 'data', 'app.sqlite');
  await fs.mkdir(path.dirname(sentinel), { recursive:true });
  await fs.writeFile(sentinel, 'newer data');
  await writeMarker(userDataDir, '1.0.30');

  const result = await prepareDataVersion({ userDataDir, currentVersion:'1.0.29' });

  assert.equal(result.reset, true);
  await assert.rejects(() => fs.access(sentinel));
});

test('missing or malformed version markers reset existing data', async t => {
  const userDataDir = await temporaryUserData(t);
  const dataDir = path.join(userDataDir, 'data');
  const sentinel = path.join(dataDir, 'backups', 'old.sqlite');
  await fs.mkdir(path.dirname(sentinel), { recursive:true });
  await fs.writeFile(sentinel, 'old backup');

  let result = await prepareDataVersion({ userDataDir, currentVersion:'1.0.29' });
  assert.equal(result.reset, true);
  await assert.rejects(() => fs.access(sentinel));

  await fs.mkdir(path.dirname(sentinel), { recursive:true });
  await fs.writeFile(sentinel, 'old backup');
  await fs.writeFile(markerPath(userDataDir), '{not-json', 'utf8');
  result = await prepareDataVersion({ userDataDir, currentVersion:'1.0.29' });
  assert.equal(result.reset, true);
  await assert.rejects(() => fs.access(sentinel));
});

test('preparation does not mark a version until successful startup completion', async t => {
  const userDataDir = await temporaryUserData(t);

  await prepareDataVersion({ userDataDir, currentVersion:'1.0.29' });
  await assert.rejects(() => fs.access(markerPath(userDataDir)));

  const completed = await completeDataVersion({ userDataDir, currentVersion:'1.0.29' });
  assert.equal(completed.version, '1.0.29');
  assert.deepEqual(JSON.parse(await fs.readFile(markerPath(userDataDir), 'utf8')).version, '1.0.29');
});

test('first installation completes a marker without needing a data directory', async t => {
  const userDataDir = await temporaryUserData(t);

  const prepared = await prepareDataVersion({ userDataDir, currentVersion:'1.0.29' });
  await completeDataVersion({ userDataDir, currentVersion:'1.0.29' });

  assert.equal(prepared.reset, true);
  assert.deepEqual(JSON.parse(await fs.readFile(markerPath(userDataDir), 'utf8')).version, '1.0.29');
});
