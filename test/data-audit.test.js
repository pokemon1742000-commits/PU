const test = require('node:test');
const assert = require('node:assert/strict');
const { auditSessionData, searchLoadedCode } = require('../src/data-audit');

test('actual-data audit separates matched, quantity differences, and rows needing review', () => {
  const base = { projectCode:'AUT1', purchaseMatchKind:'exact', warehouseMatchKind:'exact', purchaseMatchScore:100, warehouseMatchScore:100, hasReceiptRecord:true };
  const report = auditSessionData({ comparison:[
    { ...base, drawingCode:'A', purchaseMatchedCode:'A', warehouseMatchedCode:'A_GC', purchaseQuantity:2, scanQuantity:2, warehouseQuantity:2 },
    { ...base, drawingCode:'B', purchaseMatchedCode:'B', warehouseMatchedCode:'B', purchaseQuantity:3, scanQuantity:2, warehouseQuantity:1 },
    { ...base, drawingCode:'C', purchaseOrder:'PR-C', purchaseMatchedCode:'C', warehouseMatchedCode:'', warehouseMatchKind:'different', warehouseMatchScore:0, purchaseQuantity:1, scanQuantity:1, warehouseQuantity:0, hasReceiptRecord:false }
  ] });
  assert.equal(report.ready, true);
  assert.deepEqual({ matched:report.matched, difference:report.difference, review:report.review }, { matched:1, difference:1, review:1 });
  assert.equal(report.rows[0].auditStatus, 'KHỚP');
  assert.equal(report.rows[1].auditStatus, 'CHÊNH LỆCH');
  assert.equal(report.rows[2].auditStatus, 'CẦN KIỂM TRA');
  assert.match(report.rows[2].reason, /PU Check/);
});

test('actual-data audit reports that comparison data is not ready', () => {
  const report = auditSessionData({ comparison:[] });
  assert.equal(report.ready, false);
  assert.equal(report.ok, false);
  assert.equal(report.total, 0);
});

test('code search finds exact and _GC occurrences with file, sheet, and source rows', () => {
  const session = {
    purchaseDetails:[{ projectCode:'AUT1', itemCode:'PART-01', quantity:2, sourceFile:'purchase.xlsx', sourceSheet:'Data', sourceRow:12 }],
    scanDetails:[{ projectCode:'AUT1', drawingCode:'PART-01_GC', quantity:2, sourceFile:'scan.xlsx', sourceSheet:'Scan', sourceRow:8 }],
    warehouseDetails:[{ projectCode:'AUT1', itemCode:'PART-01', receivedQuantity:2, sourceFile:'warehouse.xlsx', sourceSheet:'NK', sourceRow:25 }],
    workshopDetails:[{ projectCode:'AUT1', itemCode:'PART-01_GC', receivedQuantity:2, sourceFile:'xgc.xlsx', sourceSheet:'XGC', sourceRow:31 }]
  };
  const result = searchLoadedCode(session, 'AUT1', 'PART-01');
  assert.equal(result.total, 4);
  assert.equal(result.sourceCount, 4);
  assert.equal(result.duplicate, true);
  assert.deepEqual(result.occurrences.map(row => row.row), [12,8,25,31]);
  assert.equal(result.occurrences[1].matchType, 'Tương ứng _GC');
});
