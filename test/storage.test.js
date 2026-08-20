const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const { Database } = require('../src/storage');

test('incremental database adds, updates, and avoids duplicates', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'doi-chieu-'));
  t.after(() => fs.rm(dir, { recursive:true, force:true }));
  const db = new Database(dir); await db.init();
  const base = { projectCode:'AUT1', purchaseOrder:'AUT1-PR', itemCode:'X1', marker:'M', itemName:'M', quantity:2 };
  const a = await db.mergePurchases([base]);
  assert.deepEqual(a.stats, { loaded:1, added:1, updated:0, unchanged:0, total:1 });
  const b = await db.mergePurchases([base]);
  assert.equal(b.stats.unchanged, 1);
  const c = await db.mergePurchases([{...base, quantity:3}]);
  assert.equal(c.stats.updated, 1);
  assert.equal(c.rows[0].previousQuantity, 2);
  const d = await db.mergePurchases([{...base, marker:'Tên mới', itemName:'Tên mới', quantity:3}]);
  assert.equal(d.stats.updated, 1);
  assert.equal(d.rows.length, 1);
  assert.equal(d.rows[0].marker, 'Tên mới');
});

test('persists, updates, and deletes project-scoped purchase code links', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'db-code-links-'));
  t.after(() => fs.rm(dir, { recursive:true, force:true }));
  const db = new Database(dir); await db.init();
  let rows = await db.savePurchaseReplacement('aut1', 'old-01', 'new-01');
  assert.deepEqual(rows.map(({ projectCode, oldCode, newCode }) => ({ projectCode, oldCode, newCode })), [{ projectCode:'AUT1', oldCode:'OLD-01', newCode:'NEW-01' }]);
  rows = await db.savePurchaseReplacement('AUT1', 'OLD-01', 'NEW-02');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].newCode, 'NEW-02');
  rows = await db.deletePurchaseReplacement('AUT1', 'OLD-01');
  assert.deepEqual(rows, []);
  assert.deepEqual(await db.readPurchaseReplacements(), []);
});

test('sums duplicate purchase lines before saving and keeps their source rows', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'purchase-duplicates-'));
  t.after(() => fs.rm(dir, { recursive:true, force:true }));
  const db = new Database(dir); await db.init();
  const common = {
    projectCode:'AUTM260552', purchaseOrder:'DES-AUTM260552-03-260701',
    itemCode:'KQ2H06-08A', marker:'Đầu nối khí', itemName:'Đầu nối khí',
    quantity:10, sourceFile:'MuaHang.xlsx'
  };
  const result = await db.mergePurchases([
    { ...common, sourceRow:384708 },
    { ...common, sourceRow:384709 }
  ]);
  assert.equal(result.stats.loaded, 2);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].quantity, 20);
  assert.equal(result.rows[0].mergedRowCount, 2);
  assert.equal(result.rows[0].note, 'Gộp 2 dòng: MuaHang.xlsx dòng 384708; MuaHang.xlsx dòng 384709');
});

test('Job Code database keeps old codes and only appends new unique codes', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'job-codes-'));
  t.after(() => fs.rm(dir, { recursive:true, force:true }));
  const db = new Database(dir); await db.init();
  const first = await db.mergeJobCodes(['MEC2405010','MEC2405011']);
  assert.deepEqual(first.stats, { loaded:2, added:2, unchanged:0, total:2 });
  const second = await db.mergeJobCodes(['mec2405011','MEC2405012']);
  assert.deepEqual(second.stats, { loaded:2, added:1, unchanged:1, total:3 });
  assert.deepEqual(await db.readJobCodes(), ['MEC2405010','MEC2405011','MEC2405012']);
});

test('persists raw imports and archives the original Excel files', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'raw-imports-'));
  t.after(() => fs.rm(dir, { recursive:true, force:true }));
  const source = path.join(dir, 'Job Code.xlsx');
  await fs.writeFile(source, 'excel-source');
  const db = new Database(path.join(dir, 'database')); await db.init();
  const purchaseRows = [{ projectCode:'MEC1', purchaseOrder:'MEC1-PR' }];
  const jobRows = [{ code:'MEC1', note:'Trùng 2 dòng', sourceRow:5 }];
  await db.writeRawPurchases(purchaseRows);
  await db.writeRawJobCodes(jobRows);
  assert.deepEqual(await db.readRawPurchases(), purchaseRows);
  assert.deepEqual(await db.readRawJobCodes(), jobRows);
  const archived = await db.archiveSourceFiles('reference', [source]);
  assert.equal(archived.length, 1);
  assert.equal(await fs.readFile(archived[0].archivedPath, 'utf8'), 'excel-source');
  assert.equal((await db.read(db.archiveManifestFile)).length, 1);
});

test('raw purchase and Job Code rows accumulate without duplicating a reimported source row', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'raw-merge-'));
  t.after(() => fs.rm(dir, { recursive:true, force:true }));
  const db = new Database(dir); await db.init();
  await db.mergeRawPurchases([{ purchaseOrder:'PR-1', quantity:1, sourceFile:'A.xlsx', sourceSheet:'Data', sourceRow:7 }]);
  await db.mergeRawPurchases([{ purchaseOrder:'PR-2', quantity:2, sourceFile:'B.xlsx', sourceSheet:'Data', sourceRow:8 }]);
  const purchases = await db.mergeRawPurchases([{ purchaseOrder:'PR-1', quantity:3, sourceFile:'A.xlsx', sourceSheet:'Data', sourceRow:7 }]);
  assert.equal(purchases.length, 2);
  assert.equal(purchases.find(row => row.purchaseOrder === 'PR-1').quantity, 3);

  await db.mergeRawJobCodes([{ code:'MEC1', sourceFile:'Jobs-1.xlsx', sourceSheet:'Job code', sourceRow:5 }]);
  const jobs = await db.mergeRawJobCodes([{ code:'MEC2', sourceFile:'Jobs-2.xlsx', sourceSheet:'Job code', sourceRow:5 }]);
  assert.deepEqual(jobs.map(row => row.code), ['MEC1','MEC2']);
});

test('scan and warehouse data persist incrementally until the working session is cleared', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'working-session-'));
  t.after(() => fs.rm(dir, { recursive:true, force:true }));
  const db = new Database(dir); await db.init();

  const scanA = { projectCode:'MEC1', drawingCode:'A-01', manufacturer:'MK', scanDate:'15/Aug', quantity:1 };
  const scanB = { projectCode:'MEC1', drawingCode:'B-01', manufacturer:'MK', scanDate:'15/Aug', quantity:2 };
  await db.mergeScans([scanA]);
  let scans = await db.mergeScans([scanB]);
  assert.deepEqual(scans.stats, { loaded:1, added:1, updated:0, unchanged:0, total:2 });
  scans = await db.mergeScans([{ ...scanA, quantity:3 }]);
  assert.equal(scans.stats.updated, 1);
  assert.equal(scans.rows.find(row => row.drawingCode === 'A-01').quantity, 3);
  assert.equal(scans.rows.find(row => row.drawingCode === 'B-01').quantity, 2);

  const warehouseA = { projectCode:'MEC1', itemCode:'A-01', supplier:'NCC', dueDate:'01/08/2026', deliveryDate:'02/08/2026', orderedQuantity:3, receivedQuantity:1 };
  await db.mergeWarehouse([warehouseA]);
  const warehouse = await db.mergeWarehouse([{ ...warehouseA, receivedQuantity:3 }]);
  assert.equal(warehouse.stats.updated, 1);
  assert.equal((await db.readWarehouse())[0].receivedQuantity, 3);

  await db.mergeRawScans([{ sourceFile:'scan.xlsx', sourceSheet:'Data', sourceRow:1, quantity:3 }]);
  await db.mergeRawWarehouse([{ sourceFile:'warehouse.xlsx', sourceSheet:'Data', sourceRow:2, receivedQuantity:3 }]);
  await db.writeWorkingSession({ sources:[{ kind:'scan', file:'scan.xlsx' }], decisions:[['MEC1|A-01', { action:'ignored' }]] });
  assert.equal((await db.readWorkingSession()).sources.length, 1);

  await db.clearWorkingSession();
  assert.deepEqual(await db.readScans(), []);
  assert.deepEqual(await db.readWarehouse(), []);
  assert.deepEqual(await db.readRawScans(), []);
  assert.deepEqual(await db.readRawWarehouse(), []);
  assert.deepEqual(await db.readWorkingSession(), {});
});
