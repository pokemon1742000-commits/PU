const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { Database } = require('../src/storage');
const { finalizeImport } = require('../src/import-finalizer');

test('finalizer rebuilds imported data without returning raw rows', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'import-finalizer-'));
  const database = new Database(dir);
  await database.init();
  t.after(async () => { await database.close(); await fs.rm(dir, { recursive:true, force:true }); });

  const source = { path:path.join(dir, 'purchase.xlsx'), sheets:['Data'] };
  const importId = await database.beginRawImport('purchase', source);
  await database.importRawBatch('purchase', [
    { projectCode:'MEC1', purchaseOrder:'PR-1', itemCode:'A', quantity:2, sourceFile:'purchase.xlsx', sourceSheet:'Data', sourceRow:1 },
    { projectCode:'MEC1', purchaseOrder:'PR-1', itemCode:'A', quantity:3, sourceFile:'purchase.xlsx', sourceSheet:'Data', sourceRow:2 }
  ], importId);
  await database.commitRawImport('purchase', importId);
  await database.close();

  const result = await finalizeImport({ dataDir:dir, kind:'purchase', maxSessionRows:50 });
  assert.equal(result.mergedStats.total, 1);
  assert.equal(result.sessionPatch.purchase.length, 1);
  assert.equal(result.sessionPatch.purchase[0].quantity, 5);
  assert.equal(result.sessionPatch.largeDatasets.length, 0);
  assert.equal(Object.hasOwn(result, 'rawRows'), false);
});

test('finalizer marks oversized datasets instead of materializing them', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'import-finalizer-large-'));
  const database = new Database(dir);
  await database.init();
  t.after(async () => { await database.close(); await fs.rm(dir, { recursive:true, force:true }); });
  await database.writeRawPurchases(Array.from({ length:3 }, (_, index) => ({
    projectCode:'MEC1', purchaseOrder:`PR-${index}`, itemCode:`A-${index}`, quantity:1
  })));
  await database.close();

  const result = await finalizeImport({ dataDir:dir, kind:'purchase', maxSessionRows:2 });
  assert.deepEqual(result.sessionPatch.purchaseAll, []);
  assert.ok(result.sessionPatch.largeDatasets.includes('purchases'));
  assert.ok(result.sessionPatch.largeDatasets.includes('purchase_raw'));
});
