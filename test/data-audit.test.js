const test = require('node:test');
const assert = require('node:assert/strict');
const { auditSessionData } = require('../src/data-audit');

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
