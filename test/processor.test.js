const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const ExcelJS = require('exceljs');
const { Worker } = require('worker_threads');
const { processFiles, parseUsDate, parseDmyDate, parseScanMarker, projectCode, buildComparison, resolveReview, validateProjectCodes, filterPurchasesByProjectPrefix, prioritizeProjectWarnings, mergePurchaseRows, mergeWarehouseRows, quantityComparisonNote } = require('../src/processor');

function processWithWorker(kind, file, sheets) {
  return new Promise((resolve, reject) => {
    const workerData = sheets ? { kind, files:[{ path:file, sheets }] } : { kind, filePaths:[file] };
    const worker = new Worker(path.join(__dirname, '..', 'src', 'file-worker.js'), { workerData });
    worker.once('message', message => message.ok ? resolve(message.result) : reject(new Error(message.error)));
    worker.once('error', reject);
  });
}

test('parses scan marker and normalizes warehouse dates as DD/MM/YYYY', () => {
  assert.equal(parseUsDate('8/15/2026'), '2026-08-15');
  assert.equal(parseUsDate('15/8/2026'), null);
  assert.deepEqual(parseScanMarker('15/Aug'), { display:'15/Aug', sort:'0000-08-15' });
  assert.equal(parseDmyDate('20/5/2026'), '20/05/2026');
  assert.equal(parseDmyDate('2026-05-20'), '20/05/2026');
  assert.equal(parseDmyDate('2026-07-08 00:00:00'), '08/07/2026');
  assert.equal(parseDmyDate('09/Jul/2026'), '09/07/2026');
  assert.equal(parseDmyDate('06/Aug/2026'), '06/08/2026');
  assert.equal(parseDmyDate('04/08/2026'), '04/08/2026');
  assert.equal(parseDmyDate(new Date(Date.UTC(2026, 4, 20))), '20/05/2026');
});

test('extracts MEC/AUT project codes from purchase order text', () => {
  assert.equal(projectCode('AUTS260311-PR-09'), 'AUTS260311');
  assert.equal(projectCode('DES-AUTM260552-03-260701'), 'AUTM260552');
  assert.equal(projectCode('ref MEC2510010 / 003'), 'MEC2510010');
  assert.equal(projectCode('PR-0001'), '');
});

test('uses purchase quantity as baseline and describes each warehouse supplier', () => {
  const purchases = [{ projectCode:'AUT1', itemCode:'ABC-01', itemName:'Motor', quantity:12 }];
  const scans = [
    { projectCode:'AUT1', drawingCode:'ABC-01', quantity:4, manufacturer:'PMA', scanDate:'15/Aug' },
    { projectCode:'AUT1', drawingCode:'ABC-01', quantity:6, manufacturer:'PMA', scanDate:'16/Aug' }
  ];
  const warehouse = [
    { projectCode:'AUT1', itemCode:'ABC-01', itemName:'Motor warehouse', supplier:'NCC A', poNumber:'PO-A', orderedQuantity:8, receivedQuantity:7, dueDate:'10/08/2026', deliveryDate:'02/08/2026' },
    { projectCode:'AUT1', itemCode:'ABC-01', itemName:'Motor warehouse', supplier:'NCC B', poNumber:'PO-B', orderedQuantity:4, receivedQuantity:3, dueDate:'11/08/2026', deliveryDate:'03/08/2026' }
  ];
  const result = buildComparison(purchases, scans, warehouse, 95);
  assert.equal(result.comparison.length, 1);
  assert.equal(result.comparison[0].scanQuantity, 10);
  assert.equal(result.comparison[0].scanDate, '15/Aug; 16/Aug');
  assert.equal(result.comparison[0].warehouseStatus, 'Thiếu (2)');
  assert.equal(result.comparison[0].scanStatus, 'Thiếu (2)');
  assert.equal(result.comparison[0].drawingCode, 'ABC-01');
  assert.equal(result.comparison[0].itemName, 'Motor');
  assert.equal(result.comparison[0].maker, 'PMA');
  assert.equal(result.comparison[0].warehouseDate, '03/08/2026');
  assert.equal(result.comparison[0].supplier, 'NCC A; NCC B');
  assert.equal(result.comparison[0].operator, 'NCC A; NCC B');
  assert.equal(result.comparison[0].poNumber, 'PO-A; PO-B');
  assert.equal(result.comparison[0].dueDate, '10/08/2026; 11/08/2026');
  assert.equal(result.comparison[0].warehouseOrderPlaced, true);
  assert.match(result.comparison[0].supplierNote, /NCC A: đã mua:8, đã nhập kho:7, đã quét mã:10/);
  assert.match(result.comparison[0].supplierNote, /NCC B: đã mua:4, đã nhập kho:3, đã quét mã:10/);
  assert.match(result.comparison[0].note, /^Thiếu 2: số lượng quét mã thấp hơn số lượng mua hàng; đã nhập kho 10\/12\nNCC A:/);
  assert.equal(result.shortage.length, 1);
  assert.equal(result.excess.length, 0);
});

test('supplier detail uses purchase quantity instead of warehouse ordered quantity', () => {
  const purchases = [{ projectCode:'AUT1', itemCode:'ABC-01', quantity:7 }];
  const scans = [{ projectCode:'AUT1', drawingCode:'ABC-01', quantity:12, manufacturer:'MVN' }];
  const warehouse = [{ projectCode:'AUT1', itemCode:'ABC-01', supplier:'MVN', orderedQuantity:5, receivedQuantity:5 }];
  const row = buildComparison(purchases, scans, warehouse, 95).comparison[0];
  assert.equal(row.purchaseQuantity, 7);
  assert.equal(row.warehouseQuantity, 5);
  assert.equal(row.scanQuantity, 12);
  assert.match(row.note, /MVN: đã mua:7, đã nhập kho:5, đã quét mã:12/);
  assert.doesNotMatch(row.note, /MVN: đã mua:5/);
});

test('classifies by scan versus purchase quantity and only adds warehouse quantity to shortage notes', () => {
  const cases = [
    [8,0,8,'Đủ: số lượng quét mã bằng số lượng mua hàng'],
    [8,3,10,'Thừa 2: số lượng quét mã lớn hơn số lượng mua hàng'],
    [8,3,5,'Thiếu 3: số lượng quét mã thấp hơn số lượng mua hàng; đã nhập kho 3/8']
  ];
  for (const [a, b, c, expected] of cases) assert.equal(quantityComparisonNote(a, b, c), expected);
});

test('treats equal scan and purchase quantities as enough regardless of warehouse quantity', () => {
  assert.equal(quantityComparisonNote(8, 0, 8), 'Đủ: số lượng quét mã bằng số lượng mua hàng');
  assert.equal(quantityComparisonNote(8, 3, 8), 'Đủ: số lượng quét mã bằng số lượng mua hàng');
});

test('assigns export operators from warehouse arrival and ordering state', () => {
  const purchases = [
    { projectCode:'AUT1', itemCode:'ARRIVED', quantity:3 },
    { projectCode:'AUT1', itemCode:'ORDERED', quantity:3 },
    { projectCode:'AUT1', itemCode:'NO-ORDER', quantity:3 }
  ];
  const scans = [
    { projectCode:'AUT1', drawingCode:'ARRIVED', quantity:1 },
    { projectCode:'AUT1', drawingCode:'ORDERED', quantity:0 },
    { projectCode:'AUT1', drawingCode:'NO-ORDER', quantity:0 }
  ];
  const warehouse = [
    { projectCode:'AUT1', itemCode:'ARRIVED', supplier:'NCC A', poNumber:'PO-A', orderedQuantity:3, receivedQuantity:3, dueDate:'20/08/2026' },
    { projectCode:'AUT1', itemCode:'ORDERED', supplier:'NCC B', poNumber:'PO-B', orderedQuantity:3, receivedQuantity:0, dueDate:'21/08/2026' }
  ];
  const rows = buildComparison(purchases, scans, warehouse, 95).comparison;
  assert.equal(rows.find(row => row.drawingCode === 'ARRIVED').operator, 'Kho');
  assert.equal(rows.find(row => row.drawingCode === 'ORDERED').operator, 'NCC B');
  assert.equal(rows.find(row => row.drawingCode === 'NO-ORDER').operator, 'PU check');
});

test('uses the purchase supplier when the shortage has no warehouse supplier', () => {
  const purchases = [{ projectCode:'AUT1', itemCode:'A-01', itemName:'Item', supplier:'IDEC', quantity:3 }];
  const scans = [{ projectCode:'AUT1', drawingCode:'A-01', quantity:1 }];
  const row = buildComparison(purchases, scans, [], 95).shortage[0];
  assert.equal(row.supplier, 'IDEC');
  assert.equal(row.operator, 'PU check');
});

test('marks scan and warehouse as excess when they are greater than purchase quantity', () => {
  const purchases = [{ projectCode:'AUT1', itemCode:'ABC-01', quantity:8 }];
  const scans = [{ projectCode:'AUT1', drawingCode:'ABC-01', quantity:10 }];
  const warehouse = [{ projectCode:'AUT1', itemCode:'ABC-01', orderedQuantity:10, receivedQuantity:10 }];
  const result = buildComparison(purchases, scans, warehouse, 95);
  assert.equal(result.comparison[0].warehouseStatus, 'Thừa (2)');
  assert.equal(result.comparison[0].scanStatus, 'Thừa (2)');
  assert.equal(result.shortage.length, 0);
  assert.equal(result.excess.length, 1);
});

test('ignores a warehouse shortage when scan quantity is greater than purchase quantity', () => {
  const purchases = [{ projectCode:'AUT1', itemCode:'ABC-01', quantity:10 }];
  const scans = [{ projectCode:'AUT1', drawingCode:'ABC-01', quantity:12 }];
  const warehouse = [{ projectCode:'AUT1', itemCode:'ABC-01', orderedQuantity:10, receivedQuantity:8 }];
  const result = buildComparison(purchases, scans, warehouse, 95);
  assert.equal(result.comparison[0].warehouseStatus, 'Thiếu (2)');
  assert.equal(result.comparison[0].scanStatus, 'Thừa (2)');
  assert.equal(result.shortage.length, 0);
  assert.equal(result.excess.length, 1);
  assert.equal(result.enough.length, 0);
});

test('fuzzy matches scan drawing codes within the same project and accepts a decision', () => {
  const purchases = [{ projectCode:'MEC1', itemCode:'ABCD-100', quantity:2 }];
  const scans = [{ projectCode:'MEC1', drawingCode:'ABCD-10O', quantity:2 }];
  const warehouse = [{ projectCode:'MEC1', itemCode:'ABCD-100', orderedQuantity:2, receivedQuantity:2 }];
  const first = buildComparison(purchases, scans, warehouse, 100, new Map(), 80);
  assert.equal(first.review.length, 1);
  assert.equal(first.review[0].scanDrawingCode, 'ABCD-10O');
  assert.equal(first.review[0].purchaseOptions[0].score, 88);
  assert.equal(first.review[0].warehouseOptions[0].code, 'ABCD-100');
  const decisions = new Map([
    [first.review[0].purchaseDecisionId, { action:'matched', code:'ABCD-100' }],
    [first.review[0].warehouseDecisionId, { action:'matched', code:'ABCD-100' }]
  ]);
  const accepted = buildComparison(purchases, scans, warehouse, 100, decisions, 80);
  assert.equal(accepted.review.length, 0);
  assert.equal(accepted.comparison[0].purchaseQuantity, 2);
  assert.equal(accepted.comparison[0].warehouseQuantity, 2);
  assert.equal(accepted.comparison[0].matchStatus, 'Đã xác nhận');
});

test('automatically matches item codes that only differ by the _GC suffix', () => {
  const purchases = [{ projectCode:'AUTM260552', itemCode:'2208022-TO-033', quantity:2 }];
  const scans = [{ projectCode:'AUTM260552', drawingCode:'2208022-TO-033_GC', quantity:2 }];
  const warehouse = [{ projectCode:'AUTM260552', itemCode:'2208022-TO-033', receivedQuantity:2 }];
  const result = buildComparison(purchases, scans, warehouse, 100, new Map(), 99);
  assert.equal(result.review.length, 0);
  assert.equal(result.comparison[0].purchaseQuantity, 2);
  assert.equal(result.comparison[0].warehouseQuantity, 2);
  assert.equal(result.comparison[0].scanQuantity, 2);
  assert.match(result.comparison[0].matchStatus, /100%/);
});

test('does not use the _GC shortcut when characters before the suffix differ', () => {
  const purchases = [{ projectCode:'AUTM260552', itemCode:'2208022-TO-999', quantity:2 }];
  const scans = [{ projectCode:'AUTM260552', drawingCode:'2208022-TO-033_GC', quantity:2 }];
  const strict = buildComparison(purchases, scans, [], 100, new Map(), 99);
  assert.equal(strict.review.length, 0);
  assert.equal(strict.comparison[0].purchaseQuantity, 0);
  const relaxed = buildComparison(purchases, scans, [], 50, new Map(), 40);
  assert.equal(relaxed.comparison[0].purchaseQuantity, 2);
});

test('does not fuzzy match an item from a different project', () => {
  const purchases = [{ projectCode:'MEC2', itemCode:'ABC-01', itemName:'Wrong project', quantity:1 }];
  const scans = [{ projectCode:'MEC1', drawingCode:'ABC-01', quantity:1 }];
  const warehouse = [{ projectCode:'MEC2', itemCode:'ABC-01', receivedQuantity:1 }];
  const result = buildComparison(purchases, scans, warehouse, 95);
  assert.equal(result.review.length, 0);
  assert.equal(result.comparison[0].itemName, '');
  assert.equal(result.comparison[0].purchaseQuantity, 0);
  assert.equal(result.comparison[0].warehouseQuantity, 0);
  assert.equal(result.comparison[0].matchStatus, 'Mã khác nhau');
  assert.equal(result.comparison[0].warehouseStatus, 'Đủ');
  assert.equal(result.shortage.length, 0);
  assert.equal(result.excess.length, 1);
  assert.equal(result.enough.length, 0);
});

test('uses a lower confirmation threshold and treats lower scores as different codes', () => {
  const purchases = [{ projectCode:'MEC1', itemCode:'ABCD-100', quantity:2 }];
  const scans = [{ projectCode:'MEC1', drawingCode:'ABCD-10O', quantity:2 }];
  const warehouse = [{ projectCode:'MEC1', itemCode:'ABCD-100', receivedQuantity:2 }];
  const needsReview = buildComparison(purchases, scans, warehouse, 100, new Map(), 80);
  assert.equal(needsReview.review.length, 1);
  const different = buildComparison(purchases, scans, warehouse, 100, new Map(), 90);
  assert.equal(different.review.length, 0);
  assert.equal(different.comparison[0].matchStatus, 'Mã khác nhau');
  assert.equal(different.excess.length, 1);
  assert.equal(different.shortage.length, 1);
  assert.equal(different.shortage[0].missingScan, true);
});

test('resolves mixed confirmation actions in one comparison rebuild', () => {
  const session = {
    purchase:[{ projectCode:'MEC1', itemCode:'ABCD-100', quantity:2 }],
    scans:[{ projectCode:'MEC1', drawingCode:'ABCD-10O', quantity:2 }],
    warehouse:[{ projectCode:'MEC1', itemCode:'ABCD-10Q', receivedQuantity:2 }],
    decisions:new Map()
  };
  const pending = buildComparison(session.purchase, session.scans, session.warehouse, 100, session.decisions, 70);
  const row = pending.review[0];
  const resolved = resolveReview(session, {
    items:[
      { id:row.purchaseDecisionId, code:'ABCD-100', action:'match' },
      { id:row.warehouseDecisionId, action:'ignore' }
    ],
    threshold:100,
    confirmationThreshold:70
  });
  assert.equal(resolved.review.length, 1);
  assert.equal(resolved.review[0].purchaseKind, 'confirmed');
  assert.equal(resolved.review[0].warehouseKind, 'ignored');
});

test('skipping only the warehouse candidate still classifies by scan versus purchase', () => {
  const purchases = [{ projectCode:'MEC1', itemCode:'ABC-01', quantity:5 }];
  const scans = [{ projectCode:'MEC1', drawingCode:'ABC-01', quantity:5 }];
  const warehouse = [{ projectCode:'MEC1', itemCode:'ABC-O1', receivedQuantity:3, supplier:'NCC' }];
  const pending = buildComparison(purchases, scans, warehouse, 100, new Map(), 70);
  assert.equal(pending.review.length, 1);
  const ignored = new Map([[pending.review[0].warehouseDecisionId, { action:'ignored' }]]);
  const result = buildComparison(purchases, scans, warehouse, 100, ignored, 70);
  assert.equal(result.comparison[0].purchaseQuantity, 5);
  assert.equal(result.comparison[0].warehouseQuantity, 0);
  assert.equal(result.enough.length, 1);
  assert.equal(result.shortage.length, 1);
  assert.equal(result.shortage[0].drawingCode, 'ABC-O1');
  assert.equal(result.shortage[0].missingScan, true);
  assert.equal(result.excess.length, 0);
});

test('adds purchased and warehoused items missing from scan data to shortage as not issued', () => {
  const purchases = [
    { projectCode:'MEC1', itemCode:'BASE', quantity:1 },
    { projectCode:'MEC1', itemCode:'ITEM-01', itemName:'Motor', quantity:7 },
    { projectCode:'MEC2', itemCode:'OUTSIDE', quantity:9 }
  ];
  const warehouse = [
    { projectCode:'MEC1', itemCode:'BASE', orderedQuantity:1, receivedQuantity:1 },
    { projectCode:'MEC1', itemCode:'ITEM-01', itemName:'Motor', supplier:'NCC A', orderedQuantity:7, receivedQuantity:7 },
    { projectCode:'MEC2', itemCode:'OUTSIDE', orderedQuantity:9, receivedQuantity:9 }
  ];
  const result = buildComparison(purchases, [{ projectCode:'MEC1', drawingCode:'BASE', quantity:1 }], warehouse, 95);
  assert.equal(result.comparison.length, 2);
  assert.equal(result.shortage.length, 1);
  assert.equal(result.enough.length, 1);
  assert.equal(result.shortage[0].scanQuantity, 0);
  assert.equal(result.shortage[0].purchaseQuantity, 7);
  assert.equal(result.shortage[0].warehouseQuantity, 7);
  assert.match(result.shortage[0].note, /^Chưa xuất:/);
  assert.match(result.shortage[0].note, /NCC A: đã mua:7, đã nhập kho:7, đã quét mã:0/);
});

test('adds purchased items missing from warehouse and scan data to shortage as not arrived', () => {
  const purchases = [{ projectCode:'AUT1', itemCode:'BASE', quantity:1 }, { projectCode:'AUT1', itemCode:'ITEM-02', itemName:'Valve', quantity:4 }];
  const result = buildComparison(purchases, [{ projectCode:'AUT1', drawingCode:'BASE', quantity:1 }], [], 95);
  assert.equal(result.shortage.length, 1);
  assert.equal(result.shortage[0].warehouseQuantity, 0);
  assert.match(result.shortage[0].note, /^Hàng chưa về:/);
});

test('treats a zero received quantity as not arrived even when a warehouse row exists', () => {
  const purchases = [{ projectCode:'MEC1', itemCode:'BASE', quantity:1 }, { projectCode:'MEC1', itemCode:'ITEM-04', quantity:2 }];
  const warehouse = [{ projectCode:'MEC1', itemCode:'BASE', receivedQuantity:1 }, { projectCode:'MEC1', itemCode:'ITEM-04', receivedQuantity:0 }];
  const result = buildComparison(purchases, [{ projectCode:'MEC1', drawingCode:'BASE', quantity:1 }], warehouse, 95);
  assert.equal(result.shortage.length, 1);
  assert.equal(result.shortage[0].purchaseQuantity, 2);
  assert.equal(result.shortage[0].warehouseQuantity, 0);
  assert.match(result.shortage[0].note, /^Hàng chưa về:/);
  assert.doesNotMatch(result.shortage[0].note, /^Chưa xuất:/);
});

test('matches an unscanned warehouse code through its exact purchase code in item name', () => {
  const purchases = [{ projectCode:'AUTM260552', itemCode:'2505080-TD-001', itemName:'TỦ ĐIỆN - P02', quantity:1 }];
  const warehouse = [{
    projectCode:'AUTM260552', itemCode:'2505080-TD-001_GC', itemName:'2505080-TD-001',
    supplier:'COKHIVIET', orderedQuantity:1, receivedQuantity:0
  }];
  const scans = [{ projectCode:'AUTM260552', drawingCode:'BASE', quantity:0 }];
  const result = buildComparison(purchases, scans, warehouse, 95);
  const row = result.comparison.find(item => item.purchaseQuantity === 1);
  assert.ok(row);
  assert.equal(row.warehouseQuantity, 0);
  assert.equal(row.scanQuantity, 0);
  assert.equal(row.supplier, 'COKHIVIET');
  assert.equal(result.enough.some(item => item.drawingCode === '2505080-TD-001_GC'), false);
  assert.equal(result.shortage.includes(row), true);
});

test('does not classify an unscanned zero-quantity warehouse row as enough', () => {
  const scans = [{ projectCode:'AUT1', drawingCode:'BASE', quantity:0 }];
  const warehouse = [{ projectCode:'AUT1', itemCode:'EMPTY', orderedQuantity:0, receivedQuantity:0 }];
  const result = buildComparison([], scans, warehouse, 95);
  assert.equal(result.enough.some(item => item.drawingCode === 'EMPTY'), false);
  assert.equal(result.shortage.some(item => item.drawingCode === 'EMPTY'), true);
});

test('adds warehouse-only items missing from purchase and scan data to shortage', () => {
  const purchases = [{ projectCode:'AUT1', itemCode:'BASE', quantity:1 }];
  const warehouse = [{ projectCode:'AUT1', itemCode:'BASE', receivedQuantity:1 }, { projectCode:'AUT1', itemCode:'ITEM-03', supplier:'NCC B', orderedQuantity:3, receivedQuantity:3 }];
  const result = buildComparison(purchases, [{ projectCode:'AUT1', drawingCode:'BASE', quantity:1 }], warehouse, 95);
  assert.equal(result.shortage.length, 1);
  assert.equal(result.shortage[0].purchaseQuantity, 0);
  assert.equal(result.shortage[0].warehouseQuantity, 3);
  assert.match(result.shortage[0].note, /^Thiếu dữ liệu mua hàng và quét mã/);
});

test('normalizes decorated scan project codes before matching warehouse quantities', () => {
  const purchases = [{ projectCode:'AUTM260552', itemCode:'KQ2H06-08A', quantity:8 }];
  const scans = [{ projectCode:'DES-AUTM260552-03-260701', drawingCode:'KQ2H06-08A', quantity:8 }];
  const warehouse = [{ projectCode:'AUTM260552', itemCode:'KQ2H06-08A', orderedQuantity:8, receivedQuantity:8 }];
  const result = buildComparison(purchases, scans, warehouse, 95);
  assert.equal(result.comparison[0].projectCode, 'AUTM260552');
  assert.equal(result.comparison[0].warehouseQuantity, 8);
  assert.equal(result.comparison[0].warehouseStatus, 'Đủ');
  assert.equal(result.comparison[0].scanStatus, 'Đủ');
  assert.equal(result.enough.length, 1);
});

test('links old and new purchase PR codes without counting the cancelled old quantity', () => {
  const purchases = [
    { projectCode:'AUT1', purchaseOrder:'PR-OLD', itemCode:'OLD-01', itemName:'Mã đã hủy', quantity:1 },
    { projectCode:'AUT1', purchaseOrder:'PR-NEW', itemCode:'NEW-01', itemName:'Mã thay thế', quantity:1 }
  ];
  const scans = [{ projectCode:'AUT1', drawingCode:'NEW-01', quantity:1 }];
  const warehouse = [{ projectCode:'AUT1', itemCode:'NEW-01', receivedQuantity:1 }];
  const replacements = [{ projectCode:'AUT1', oldCode:'OLD-01', newCode:'NEW-01' }];
  const result = buildComparison(purchases, scans, warehouse, 95, new Map(), 70, replacements);
  assert.equal(result.comparison.length, 1);
  assert.equal(result.enough.length, 1);
  assert.equal(result.comparison[0].purchaseQuantity, 1);
  assert.equal(result.comparison[0].itemName, 'Mã thay thế');
  assert.equal(result.comparison[0].originalItemCode, 'OLD-01');
  assert.equal(result.comparison[0].replacementItemCode, 'NEW-01');
  assert.equal(result.comparison[0].originalPurchaseOrder, 'PR-OLD');
  assert.equal(result.comparison[0].replacementPurchaseOrder, 'PR-NEW');
});

test('does not apply a purchase replacement outside its project', () => {
  const purchases = [
    { projectCode:'AUT1', itemCode:'OLD-01', quantity:1 },
    { projectCode:'AUT1', itemCode:'NEW-01', quantity:1 },
    { projectCode:'AUT2', itemCode:'OLD-01', quantity:2 }
  ];
  const scans = [
    { projectCode:'AUT1', drawingCode:'NEW-01', quantity:1 },
    { projectCode:'AUT2', drawingCode:'OLD-01', quantity:2 }
  ];
  const replacements = [{ projectCode:'AUT1', oldCode:'OLD-01', newCode:'NEW-01' }];
  const result = buildComparison(purchases, scans, [], 95, new Map(), 70, replacements);
  assert.equal(result.enough.length, 2);
  assert.equal(result.comparison.find(row => row.projectCode === 'AUT2').originalItemCode, '');
});

test('creates Job Code warnings without removing source rows', () => {
  const session = { jobCodes:['AUT1'], purchase:[{projectCode:'MEC9',purchaseOrder:'MEC9-PR',sourceFile:'a.xlsm'}] };
  const warnings = validateProjectCodes(session);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0].note, /Job Code/);
});

test('accepts all MEC and AUT purchase projects without checking Job Code', () => {
  const rows = [
    { projectCode:'MEC1', purchaseOrder:'MEC1-PR', sourceFile:'a.xlsx' },
    { projectCode:'AUT2', purchaseOrder:'AUT2-PR', sourceFile:'a.xlsx' },
    { projectCode:'', purchaseOrder:'PR-3', sourceFile:'a.xlsx' },
    { projectCode:'OTHER4', purchaseOrder:'OTHER4-PR', sourceFile:'a.xlsx' }
  ];
  const result = filterPurchasesByProjectPrefix(rows);
  assert.deepEqual(result.valid, [rows[0], rows[1]]);
  assert.equal(result.warnings.length, 2);
  assert.match(result.warnings[0].note, /Không trích xuất/);
  assert.match(result.warnings[1].note, /không bắt đầu/);
  assert.equal(result.warnings[1].purchaseOrder, 'OTHER4-PR');
  assert.equal(result.warnings[1].sourceFile, 'a.xlsx');
});

test('prioritizes MEC and AUT project codes in warnings', () => {
  const rows = [
    { projectCode:'(trống)', original:'1' },
    { projectCode:'OTHER1', original:'2' },
    { projectCode:'MEC2401', original:'3' },
    { projectCode:'AUT2402', original:'4' },
    { projectCode:'', original:'5' }
  ];
  const sorted = prioritizeProjectWarnings(rows);
  assert.deepEqual(sorted.map(row => row.original), ['3','4','1','2','5']);
});

test('merges matching warehouse rows and only notes real merges', () => {
  const base = { projectCode:'MEC1', itemCode:'A-01', supplier:'NCC', dueDate:'01/08/2026', deliveryDate:'02/08/2026' };
  const rows = mergeWarehouseRows([
    { ...base, itemCode:'A-02', orderedQuantity:4, receivedQuantity:4 },
    { ...base, orderedQuantity:1, receivedQuantity:1 },
    { ...base, orderedQuantity:2, receivedQuantity:0 }
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].itemCode, 'A-01');
  assert.equal(rows[0].orderedQuantity, 3);
  assert.equal(rows[0].receivedQuantity, 1);
  assert.equal(rows[0].shortageQuantity, 2);
  assert.equal(rows[0].isShortage, true);
  assert.equal(rows[0].note, 'Gộp 2 dòng');
  assert.equal(rows[1].isShortage, false);
  assert.equal(rows[1].note, '');
});

test('merges purchase rows by project and item code with source line details', () => {
  const rows = mergePurchaseRows([
    { projectCode:'MEC1', purchaseOrder:'PR-01', itemCode:'A-01', itemName:'Motor', marker:'Motor', quantity:1, sourceFile:'MH.xlsx', sourceRow:7 },
    { projectCode:'MEC1', purchaseOrder:'PR-02', itemCode:'A-01', itemName:'Motor', marker:'Motor', quantity:2, sourceFile:'MH.xlsx', sourceRow:12 },
    { projectCode:'MEC1', purchaseOrder:'PR-03', itemCode:'B-01', itemName:'Sensor', marker:'Sensor', quantity:4, sourceFile:'MH.xlsx', sourceRow:13 },
    { projectCode:'AUT1', purchaseOrder:'PR-04', itemCode:'A-01', itemName:'Motor', marker:'Motor', quantity:5, sourceFile:'MH2.xlsx', sourceRow:8 }
  ]);
  assert.equal(rows.length, 3);
  const merged = rows.find(row => row.projectCode === 'MEC1' && row.itemCode === 'A-01');
  assert.equal(merged.quantity, 3);
  assert.equal(merged.purchaseOrder, 'PR-01; PR-02');
  assert.equal(merged.sourceRow, '7, 12');
  assert.equal(merged.note, 'Gộp 2 dòng: MH.xlsx dòng 7; MH.xlsx dòng 12');
  assert.equal(rows.find(row => row.itemCode === 'B-01').note, '');
});

test('isolated Excel parsers run sequentially', async t => {
 await t.test('reads a real Excel scan file, handles marker dates and swapped fields', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'scan-excel-'));
  t.after(() => fs.rm(dir, { recursive:true, force:true }));
  const file = path.join(dir, 'scan.xlsm');
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Data');
  ws.addRow(['8/15/2026']);
  ws.addRow(['AUTS260311, S260311-FR7-001, 2, PMA, NK-PMA-260520, 20/05/2026, MKAC-1']);
  ws.addRow(['AUTS260311, S260311-FR7-001, PMA, 3, NK-PMA-260520, 20/05/2026, MKAC-2']);
  await wb.xlsx.writeFile(file);
  const result = await processWithWorker('scan', file);
  assert.equal(result.rows.length, 1);
  assert.equal(result.details.length, 2);
  assert.deepEqual(result.details.map(row => row.quantity), [2, 3]);
  assert.equal(result.rows[0].quantity, 5);
  assert.equal(result.rows[0].mergedRowCount, 2);
  assert.equal(result.rows[0].note, 'Gộp 2 dòng');
  assert.equal(result.rows[0].scanDate, '2026-08-15');
  assert.equal(result.rows[0].reference, 'MKAC-1');
 });

 await t.test('reads and reconciles every data sheet instead of only the first sheet', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'multi-sheet-'));
  t.after(() => fs.rm(dir, { recursive:true, force:true }));

  const purchaseFile = path.join(dir, 'purchase.xlsx');
  const purchaseBook = new ExcelJS.Workbook();
  purchaseBook.addWorksheet('Bìa').addRow(['Không phải dữ liệu']);
  for (const [sheetName, quantity] of [['Mua hàng 1', 10], ['Mua hàng 2', 10]]) {
    const ws = purchaseBook.addWorksheet(sheetName);
    ws.addRow(['STT','Mã hàng','Tên mặt hàng','ĐVT','Maker','Ngày giao hàng','Tình trạng']);
    ws.addRow([1,'DES-AUTM260552-03-260701','7/2/2026','KQ2H06-08A','Đầu nối khí','Chiếc',quantity]);
  }
  await purchaseBook.xlsx.writeFile(purchaseFile);
  const purchase = await processWithWorker('purchase', purchaseFile);
  assert.equal(purchase.details.length, 2);
  assert.equal(purchase.details.reduce((total, row) => total + row.quantity, 0), 20);
  assert.deepEqual(new Set(purchase.details.map(row => row.sourceSheet)), new Set(['Mua hàng 1','Mua hàng 2']));
  const selectedPurchase = await processWithWorker('purchase', purchaseFile, ['Mua hàng 2']);
  assert.equal(selectedPurchase.details.length, 1);
  assert.equal(selectedPurchase.details[0].sourceSheet, 'Mua hàng 2');

  const warehouseFile = path.join(dir, 'warehouse.xlsx');
  const warehouseBook = new ExcelJS.Workbook();
  for (const [sheetName, quantity] of [['NK 1', 3], ['NK 2', 4]]) {
    const ws = warehouseBook.addWorksheet(sheetName);
    ws.addRow(['Tên dự án','Mã Hàng','Tên Hàng','NCC','Số lượng đặt hàng','Hạn giao hàng','Ngày giao hàng','Số lượng đã về']);
    ws.addRow(['AUTM260552 - Dự án','KQ2H06-08A','Đầu nối khí','NCC A',quantity,'01/08/2026','02/08/2026',quantity]);
  }
  await warehouseBook.xlsx.writeFile(warehouseFile);
  const warehouse = await processWithWorker('warehouse', warehouseFile);
  assert.equal(warehouse.details.length, 2);
  assert.equal(warehouse.rows[0].orderedQuantity, 7);
  assert.equal(warehouse.rows[0].receivedQuantity, 7);

  const scanFile = path.join(dir, 'scan.xlsx');
  const scanBook = new ExcelJS.Workbook();
  for (const [sheetName, quantity] of [['Quét 1', 2], ['Quét 2', 3]]) {
    const ws = scanBook.addWorksheet(sheetName);
    ws.addRow(['15/Aug']);
    ws.addRow([`AUTM260552, KQ2H06-08A, ${quantity}, PMA, NK-1, 20/05/2026, REF`]);
  }
  await scanBook.xlsx.writeFile(scanFile);
  const scan = await processWithWorker('scan', scanFile);
  assert.equal(scan.details.length, 2);
  assert.equal(scan.rows[0].quantity, 5);
 });

 await t.test('accepts day/month scan markers and notes rows before the first marker', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'scan-day-month-'));
  t.after(() => fs.rm(dir, { recursive:true, force:true }));
  const file = path.join(dir, 'scan.xlsx');
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Data');
  ws.addRow(['AUT1, PRE-001, 1, PMA, NK-1, 20/05/2026, A']);
  ws.addRow(['15/Aug']);
  ws.addRow(['AUT1, POST-001, 2, PMA, NK-1, 20/05/2026, B']);
  await wb.xlsx.writeFile(file);
  const result = await processWithWorker('scan', file);
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows.find(row => row.drawingCode === 'PRE-001').scanDate, 'Trước 15/Aug');
  assert.equal(result.rows.find(row => row.drawingCode === 'POST-001').scanDate, '15/Aug');
  assert.equal(result.rows.find(row => row.drawingCode === 'PRE-001').note, '');
  assert.equal(result.rows.find(row => row.drawingCode === 'POST-001').note, '');
 });

 await t.test('keeps raw warehouse rows alongside the merged view', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'warehouse-raw-'));
  t.after(() => fs.rm(dir, { recursive:true, force:true }));
  const file = path.join(dir, 'warehouse.xlsx');
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Data');
  ws.addRow(['Tên dự án','Mã Hàng','Tên Hàng','NCC','Mã PO','Số lượng đặt hàng','Hạn giao hàng','Ngày giao hàng','Số lượng đã về']);
  ws.addRow(['MEC1 - Dự án','A-01','Tên hàng','NCC','PO-001',1,'01/08/2026','02/08/2026',1]);
  ws.addRow(['MEC1 - Dự án','A-01','Tên hàng','NCC','PO-001',2,'01/08/2026','02/08/2026',0]);
  ws.addRow(['Dự án nội bộ','B-01','Tên hàng khác','NCC','PO-002',1,'01/08/2026','02/08/2026',1]);
  ws.addRow(['','C-01','Tên hàng thiếu dự án','NCC','PO-003',1,'01/08/2026','02/08/2026',1]);
  await wb.xlsx.writeFile(file);
  const result = await processWithWorker('warehouse', file);
  assert.equal(result.details.length, 2);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].orderedQuantity, 3);
  assert.equal(result.rows[0].poNumber, 'PO-001');
  assert.equal(result.rows[0].note, 'Gộp 2 dòng');
  assert.equal(result.warnings.length, 2);
  assert.match(result.warnings[0].note, /bỏ qua/);
 });

 await t.test('reads the real purchase layout with Maker as the item-name column', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'purchase-excel-'));
  t.after(() => fs.rm(dir, { recursive:true, force:true }));
  const file = path.join(dir, 'purchase.xlsx');
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Sheet1');
  ws.addRow([]); ws.addRow(['Tên đơn vị :']); ws.addRow([]); ws.addRow([]);
  ws.addRow(['TỔNG HỢP TÌNH HÌNH ĐẶT HÀNG']);
  ws.addRow(['STT','Mã hàng','Tên mặt hàng','DVT','Maker','Ngày giao hàng','Tình trạng','Trễ hạn','Số lượng còn lại']);
  ws.addRow([1,'DES-MEC2205011-17-240102',new Date('2024-01-02'),'HW9Z-KL1','Cover','PCS','1,000.00','1,000.00','IDEC']);
  await wb.xlsx.writeFile(file);
  const result = await processWithWorker('purchase', file);
  assert.equal(result.rows.length, 1);
  assert.equal(result.details.length, 1);
  assert.deepEqual(
    { projectCode:result.rows[0].projectCode, purchaseOrder:result.rows[0].purchaseOrder, itemCode:result.rows[0].itemCode, itemName:result.rows[0].itemName, supplier:result.rows[0].supplier, quantity:result.rows[0].quantity },
    { projectCode:'MEC2205011', purchaseOrder:'DES-MEC2205011-17-240102', itemCode:'HW9Z-KL1', itemName:'Cover', supplier:'IDEC', quantity:1000 }
  );
 });

 await t.test('loads a 20,000-row purchase workbook in an isolated worker', { timeout: 60000 }, async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'large-purchase-'));
  t.after(() => fs.rm(dir, { recursive:true, force:true }));
  const file = path.join(dir, 'large-purchase.xlsx');
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Data');
  ws.addRow(['STT','Mã hàng','Tên mặt hàng','ĐVT','Maker','Ngày giao hàng','Tình trạng']);
  for (let i = 1; i <= 20000; i++) ws.addRow([i,'DES-MEC2405001-01',null,`ITEM-${i}`,'Tên hàng','PCS',1]);
  await wb.xlsx.writeFile(file);
  const result = await processWithWorker('purchase', file);
  assert.equal(result.rows.length, 20000);
  assert.equal(result.rows[19999].itemCode, 'ITEM-20000');
 });

 await t.test('accepts Job code sheet name case-insensitively and CODE header below row 1', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'job-code-excel-'));
  t.after(() => fs.rm(dir, { recursive:true, force:true }));
  const file = path.join(dir, 'jobs.xlsx');
  const wb = new ExcelJS.Workbook();
  const other = wb.addWorksheet('Other'); other.addRow(['CODE']); other.addRow(['WRONG-CODE']);
  const ws = wb.addWorksheet('Job code');
  ws.addRow([]); ws.addRow([]); ws.addRow([]);
  ws.addRow(['STT','CODE']);
  ws.addRow([1,'MEC2405010']); ws.addRow([2,'MEC2405011']); ws.addRow([3,'MEC2405010']);
  await wb.xlsx.writeFile(file);
  const result = await processWithWorker('reference', file);
  assert.deepEqual(result.rows, ['MEC2405010','MEC2405011','MEC2405010']);
  assert.equal(result.details.length, 3);
  assert.equal(result.details[0].note, 'Trùng 2 dòng');
  assert.equal(result.details[1].note, '');
  assert.deepEqual(result.notes, [['MEC2405010','Trùng 2 dòng']]);
 });

 await t.test('reads the bundled MKAC Monthly Timesheet Job code reference', async () => {
  const file = path.join(__dirname, '..', 'assets', 'MKAC Monthly Timesheet.xlsx');
  const result = await processWithWorker('reference', file);
  assert.equal(result.rows.length, 2156);
  assert.equal(new Set(result.rows).size, 2151);
  assert.equal(result.details[0].sourceSheet, 'Job code');
  assert.equal(result.rows.includes('MEC1808001'), true);
 });
});
