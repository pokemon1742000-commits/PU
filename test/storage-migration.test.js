const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const DatabaseDriver = require('better-sqlite3');
const { Database } = require('../src/storage');

async function writeJson(dir, name, value) {
  await fs.writeFile(path.join(dir, name), JSON.stringify(value), 'utf8');
}

async function makeLegacyData(dir) {
  await writeJson(dir, 'purchases.json', [{ projectCode:'AUT1', purchaseOrder:'PR-1', itemCode:'A', quantity:4 }]);
  await writeJson(dir, 'purchase-raw.json', [{ sourceFile:'purchase.xlsx', sourceSheet:'Data', sourceRow:2, itemCode:'A' }]);
  await writeJson(dir, 'scans.json', [{ projectCode:'AUT1', drawingCode:'A', manufacturer:'MK', scanDate:'15/Aug', quantity:3 }]);
  await writeJson(dir, 'scan-raw.json', [{ sourceFile:'scan.xlsx', sourceSheet:'Data', sourceRow:3, quantity:3 }]);
  await writeJson(dir, 'warehouse.json', [{ projectCode:'AUT1', itemCode:'A', supplier:'NCC', poNumber:'PO-1', dueDate:'20/08/2026', deliveryDate:'19/08/2026', receivedQuantity:2 }]);
  await writeJson(dir, 'warehouse-raw.json', [{ sourceFile:'warehouse.xlsx', sourceSheet:'Data', sourceRow:4, receivedQuantity:2 }]);
  await writeJson(dir, 'workshop.json', [{ projectCode:'AUT1', itemCode:'A_GC', purchaseRequest:'MKS-1', poNumber:'XGC-1', receivedQuantity:1 }]);
  await writeJson(dir, 'workshop-raw.json', [{ sourceFile:'xgc.xlsx', sourceSheet:'Data', sourceRow:5, receivedQuantity:1 }]);
  await writeJson(dir, 'job-codes.json', ['AUT1']);
  await writeJson(dir, 'job-codes-raw.json', [{ code:'AUT1', sourceFile:'jobs.xlsx', sourceRow:2 }]);
  await writeJson(dir, 'purchase-code-replacements.json', [{ projectCode:'AUT1', oldCode:'OLD', newCode:'A' }]);
  await writeJson(dir, 'working-session.json', { sources:[{ kind:'warehouse', file:'warehouse.xlsx' }], formatWarnings:[], decisions:[] });
  await writeJson(dir, 'source-archives.json', [{ kind:'purchase', originalName:'purchase.xlsx', archivedPath:'original-files/purchase.xlsx', importedAt:'2026-09-22T00:00:00.000Z' }]);
}

test('legacy JSON migrates once, preserves data, and leaves a recoverable backup', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sqlite-migration-'));
  const db = new Database(dir);
  t.after(async () => { await db.close(); await fs.rm(dir, { recursive:true, force:true }); });
  await makeLegacyData(dir);

  await db.init();
  assert.equal((await fs.stat(path.join(dir, 'app.sqlite')).then(() => true)), true);
  assert.equal((await db.readPurchases())[0].quantity, 4);
  assert.deepEqual(await db.readJobCodes(), ['AUT1']);
  assert.deepEqual((await db.readWorkingSession()).sources, [{ kind:'warehouse', file:'warehouse.xlsx' }]);
  assert.equal((await db.readPurchaseReplacements())[0].newCode, 'A');
  assert.equal((await db.readSourceArchives()).length, 1);
  const backedUpPurchases = JSON.parse(await fs.readFile(path.join(dir, 'legacy-json-backup', 'purchases.json'), 'utf8'));
  assert.equal(backedUpPurchases[0].itemCode, 'A');

  const before = JSON.stringify({ purchases:await db.readPurchases(), scans:await db.readScans(), warehouse:await db.readWarehouse() });
  await db.close();
  const reopened = new Database(dir);
  await reopened.init();
  const after = JSON.stringify({ purchases:await reopened.readPurchases(), scans:await reopened.readScans(), warehouse:await reopened.readWarehouse() });
  assert.equal(after, before);
  assert.equal((await reopened.readPurchases()).length, 1);
  await reopened.backup();
  const snapshotFiles = (await fs.readdir(path.join(dir, 'backups'))).filter(name => name.endsWith('.sqlite'));
  assert.equal(snapshotFiles.length >= 1, true);
  const checkDb = new DatabaseDriver(path.join(dir, 'app.sqlite'));
  try { assert.equal(checkDb.pragma('integrity_check', { simple:true }), 'ok'); } finally { checkDb.close(); }
  await reopened.close();
});

test('invalid legacy JSON fails without replacing source files', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sqlite-migration-invalid-'));
  t.after(() => fs.rm(dir, { recursive:true, force:true }));
  await fs.writeFile(path.join(dir, 'purchases.json'), '{invalid', 'utf8');
  const db = new Database(dir);
  await assert.rejects(() => db.init(), /Không thể chuyển dữ liệu JSON sang SQLite/);
  assert.equal(await fs.readFile(path.join(dir, 'purchases.json'), 'utf8'), '{invalid');
  assert.equal(await fs.access(path.join(dir, 'app.sqlite.tmp')).then(() => true).catch(() => false), false);
});

test('missing database restores the newest valid SQLite snapshot', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sqlite-recovery-'));
  const db = new Database(dir);
  t.after(async () => { await db.close(); await fs.rm(dir, { recursive:true, force:true }); });
  await db.init();
  await db.mergePurchases([{ projectCode:'AUT1', purchaseOrder:'PR-1', itemCode:'A', quantity:4 }]);
  await db.backup();
  const backupFiles = (await fs.readdir(path.join(dir, 'backups'))).filter(name => name.endsWith('.sqlite'));
  assert.equal(backupFiles.length >= 1, true);
  await db.close();
  await fs.rm(path.join(dir, 'app.sqlite'));
  const reopened = new Database(dir);
  await reopened.init();
  assert.equal((await reopened.readPurchases())[0].quantity, 4);
  await reopened.close();
});

test('missing database fails instead of starting empty when all snapshots are invalid', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sqlite-recovery-invalid-'));
  t.after(() => fs.rm(dir, { recursive:true, force:true }));
  await fs.mkdir(path.join(dir, 'backups'), { recursive:true });
  await fs.writeFile(path.join(dir, 'backups', 'data-broken.sqlite'), 'not sqlite', 'utf8');
  const db = new Database(dir);
  await assert.rejects(() => db.init(), /backup hợp lệ để khôi phục|cơ sở dữ liệu SQLite hợp lệ/);
});

test('ambiguous legacy warehouse PO candidates preserve the existing row', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sqlite-warehouse-ambiguous-'));
  const db = new Database(dir);
  t.after(async () => { await db.close(); await fs.rm(dir, { recursive:true, force:true }); });
  await db.init();
  await db.mergeWarehouse([{ projectCode:'AUT1', itemCode:'A', supplier:'NCC', dueDate:'20/08/2026', deliveryDate:'19/08/2026', poNumber:'PO-1', receivedQuantity:1 }]);
  const raw = await db.readWarehouse();
  const rowWithoutPo = { ...raw[0], poNumber:'' };
  db.db.prepare('DELETE FROM warehouse').run();
  db.upsert('warehouse', db.datasetKey(rowWithoutPo, ['projectCode','itemCode','supplier','poNumber','dueDate','deliveryDate']), rowWithoutPo);
  const result = await db.mergeWarehouse([
    { projectCode:'AUT1', itemCode:'A', supplier:'NCC', dueDate:'20/08/2026', deliveryDate:'19/08/2026', poNumber:'PO-1', receivedQuantity:2 },
    { projectCode:'AUT1', itemCode:'A', supplier:'NCC', dueDate:'20/08/2026', deliveryDate:'19/08/2026', poNumber:'PO-2', receivedQuantity:3 }
  ]);
  assert.equal(result.rows.some(row => row.poNumber === ''), true);
});
