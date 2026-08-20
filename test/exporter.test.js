const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const ExcelJS = require('exceljs');
const { exportWorkbook } = require('../src/exporter');

test('comparison export follows the single-sheet template, excludes confirmations, and colors XK cells', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'comparison-export-'));
  t.after(() => fs.rm(dir, { recursive:true, force:true }));
  const file = path.join(dir, 'report.xlsx');
  const session = {
    comparison: [
      { projectCode:'MEC001', drawingCode:'DWG-1', itemName:'Item', scanQuantity:1, warehouseQuantity:2, purchaseQuantity:3, maker:'Maker A', scanDate:'15/Aug', warehouseDate:'14/08/2026', note:'Thiếu 2' },
      { projectCode:'MEC001', drawingCode:'DWG-2', itemName:'Item 2', scanQuantity:5, warehouseQuantity:4, purchaseQuantity:3, maker:'Maker B', scanDate:'16/Aug', warehouseDate:'15/08/2026', note:'Thừa 2' }
    ],
    review: [{ projectCode:'MEC001', scanDrawingCode:'DWG-1', purchaseCandidateCode:'DWG-I', purchaseScore:92, warehouseCandidateCode:'DWG-01', warehouseScore:90, status:'Chờ xác nhận' }]
  };

  await exportWorkbook(file, ['purchase', 'comparison', 'review', 'shortage', 'excess'], session);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(file);
  assert.deepEqual(workbook.worksheets.map(sheet => sheet.name), ['MEC001']);
  const sheet = workbook.getWorksheet('MEC001');
  assert.equal(sheet.getCell('A3').value, 'SỐ LIỆU XUẤT KHO');
  assert.deepEqual(sheet.getRow(9).values.slice(1), ['STT','Mã dự án','Mã hàng','Tên hàng','Số lượng BOOM','Số liệu XK','Maker','Ngày bắn code','Ngày nhập kho','Số lượng nhập kho','Note']);
  assert.deepEqual(sheet.getRow(10).values.slice(1), [1,'MEC001','DWG-1','Item',3,1,'Maker A','15/Aug','14/08/2026',2,'Thiếu 2']);
  assert.equal(sheet.getCell('A9').fill.fgColor.argb, 'FF92D050');
  assert.equal(sheet.getCell('F9').fill.fgColor.argb, 'FFFFC000');
  assert.equal(sheet.views[0].xSplit, 5);
  assert.equal(sheet.views[0].ySplit, 9);
  assert.equal(sheet.getCell('F10').fill.fgColor.argb, 'FFFFFF00');
  assert.equal(sheet.getCell('F11').fill.fgColor.argb, 'FF92D050');
  const values = sheet.getColumn(1).values.map(String);
  assert.ok(!values.includes('CẦN XÁC NHẬN'));
});

test('comparison export combines multiple scan projects into one sheet', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'project-export-'));
  t.after(() => fs.rm(dir, { recursive:true, force:true }));
  const file = path.join(dir, 'projects.xlsx');
  const session = {
    comparison: [
      { projectCode:'AUTM260552', drawingCode:'A', purchaseQuantity:1, scanQuantity:1, warehouseQuantity:1 },
      { projectCode:'MEC260001', drawingCode:'B', purchaseQuantity:2, scanQuantity:2, warehouseQuantity:2 }
    ],
    review:[]
  };
  await exportWorkbook(file, ['comparison'], session);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(file);
  assert.deepEqual(workbook.worksheets.map(sheet => sheet.name), ['NHIỀU DỰ ÁN']);
  assert.equal(workbook.getWorksheet('NHIỀU DỰ ÁN').getCell('A10').value, 1);
  assert.equal(workbook.getWorksheet('NHIỀU DỰ ÁN').getCell('A11').value, 2);
});

test('comparison export strikes an old linked code and shows the new code', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'linked-code-export-'));
  t.after(() => fs.rm(dir, { recursive:true, force:true }));
  const file = path.join(dir, 'linked-code.xlsx');
  await exportWorkbook(file, ['comparison'], { comparison:[{
    projectCode:'AUT1', drawingCode:'NEW-01', originalItemCode:'OLD-01', replacementItemCode:'NEW-01',
    purchaseQuantity:1, scanQuantity:1, warehouseQuantity:1
  }] });
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.readFile(file);
  const value = workbook.getWorksheet('AUT1').getCell('C10').value;
  assert.equal(value.richText[0].text, 'OLD-01');
  assert.equal(value.richText[0].font.strike, true);
  assert.equal(value.richText[1].text, ' → NEW-01');
});
