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
      { projectCode:'MEC001', drawingCode:'DWG-1', itemName:'Item', scanQuantity:1, warehouseQuantity:2, purchaseQuantity:3, supplier:'NCC A', poNumber:'PO-1', dueDate:'20/08/2026', warehouseOrderPlaced:true, maker:'Maker A', scanDate:'15/Aug', warehouseDate:'14/08/2026', note:'Thiếu 2' },
      { projectCode:'MEC001', drawingCode:'DWG-2', itemName:'Item 2', scanQuantity:5, warehouseQuantity:4, purchaseQuantity:3, poNumber:'PO-X', dueDate:'30/08/2026', maker:'Maker B', scanDate:'16/Aug', warehouseDate:'15/08/2026', note:'Thừa 2' }
    ],
    review: [{ projectCode:'MEC001', scanDrawingCode:'DWG-1', purchaseCandidateCode:'DWG-I', purchaseScore:92, warehouseCandidateCode:'DWG-01', warehouseScore:90, status:'Chờ xác nhận' }]
  };

  await exportWorkbook(file, ['purchase', 'comparison', 'review', 'shortage', 'excess'], session);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(file);
  assert.deepEqual(workbook.worksheets.map(sheet => sheet.name), ['MEC001']);
  const sheet = workbook.getWorksheet('MEC001');
  assert.equal(sheet.getCell('A3').value, 'SỐ LIỆU XUẤT KHO');
  assert.deepEqual(sheet.getRow(9).values.slice(1), ['STT','Mã dự án','Mã hàng','Tên hàng','Số lượng BOOM','Số liệu XK','Maker','Ngày bắn code','Ngày nhập kho','Số lượng nhập kho','Tình trạng','Note','Người Vận Hành','Mã PO','Hạn Giao Hàng','Note đổi mã','Đổi PR']);
  assert.deepEqual(sheet.getRow(10).values.slice(1), [1,'MEC001','DWG-1','Item',3,1,'Maker A','15/Aug','14/08/2026',2,'Chưa về đủ','Thiếu 2','NCC A','PO-1','20/08/2026','','']);
  assert.equal(sheet.getCell('K10').dataValidation.type, 'list');
  assert.equal(sheet.getCell('K10').dataValidation.formulae[0], '"OK,Chưa về,Chưa về đủ,Đã về,Chưa bắn code"');
  assert.equal(sheet.getCell('L11').value, 'Thừa 2');
  assert.equal(sheet.getCell('M11').value, 'Kho');
  assert.equal(sheet.getCell('N11').value || '', '');
  assert.equal(sheet.getCell('O11').value || '', '');
  assert.equal(sheet.getCell('A9').fill.fgColor.argb, 'FF92D050');
  assert.equal(sheet.getCell('F9').fill.fgColor.argb, 'FFFFC000');
  assert.equal(sheet.views[0].xSplit, 5);
  assert.equal(sheet.views[0].ySplit, 9);
  assert.equal(sheet.getCell('F10').fill.fgColor.argb, 'FFFFFF00');
  assert.equal(sheet.getCell('F11').fill.fgColor.argb, 'FF92D050');
  for (const column of ['A','E','F','J']) assert.equal(sheet.getColumn(column).numFmt, '0');
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

test('comparison export writes concise notes from quantity status', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'comparison-notes-'));
  t.after(() => fs.rm(dir, { recursive:true, force:true }));
  const file = path.join(dir, 'notes.xlsx');
  await exportWorkbook(file, ['comparison'], { comparison:[
    { projectCode:'MEC1', drawingCode:'ENOUGH', purchaseQuantity:2, scanQuantity:2, warehouseQuantity:0, poNumber:'PO-OK', dueDate:'24/08/2026', note:'old detail' },
    { projectCode:'MEC1', drawingCode:'ARRIVED', purchaseQuantity:3, scanQuantity:1, warehouseQuantity:3 },
    { projectCode:'MEC1', drawingCode:'NOT-ARRIVED', purchaseQuantity:3, scanQuantity:0, warehouseQuantity:0, supplier:'NCC A', poNumber:'PO-01', dueDate:'25/08/2026', warehouseOrderPlaced:true },
    { projectCode:'MEC1', drawingCode:'NO-ORDER', purchaseQuantity:3, scanQuantity:0, warehouseQuantity:0, warehouseOrderPlaced:false },
    { projectCode:'MEC1', drawingCode:'PARTIAL', purchaseQuantity:3, scanQuantity:1, warehouseQuantity:2, supplier:'NCC B', poNumber:'PO-02', dueDate:'26/08/2026', warehouseOrderPlaced:true },
    { projectCode:'MEC1', drawingCode:'EXCESS', purchaseQuantity:3, scanQuantity:4, warehouseQuantity:3, poNumber:'PO-X', dueDate:'30/08/2026' }
  ] });
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.readFile(file);
  const sheet = workbook.getWorksheet('MEC1');
  assert.deepEqual([10, 11, 12, 13, 14, 15].map(row => sheet.getCell(`L${row}`).value || ''), [
    '', 'Thiếu 2', 'Thiếu 3', 'Thiếu 3', 'Thiếu 2', 'Thừa 1'
  ]);
  assert.deepEqual([10, 11, 12, 13, 14, 15].map(row => sheet.getCell(`M${row}`).value || ''), [
    '', 'Kho', 'NCC A', 'PU check', 'NCC B', 'Kho'
  ]);
  assert.deepEqual([10, 11, 12, 13, 14, 15].map(row => sheet.getCell(`K${row}`).value), [
    'OK', 'Chưa bắn code', 'Chưa về', 'Chưa về', 'Chưa về đủ', 'Đã về'
  ]);
  for (let row = 10; row <= 15; row++) assert.equal(sheet.getCell(`K${row}`).dataValidation.type, 'list');
  assert.deepEqual([sheet.getCell('N12').value, sheet.getCell('O12').value], ['PO-01','25/08/2026']);
  assert.deepEqual([sheet.getCell('N10').value || '', sheet.getCell('O10').value || '', sheet.getCell('N15').value || '', sheet.getCell('O15').value || ''], ['','','','']);
});

test('comparison export strikes an old linked code and shows the new code', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'linked-code-export-'));
  t.after(() => fs.rm(dir, { recursive:true, force:true }));
  const file = path.join(dir, 'linked-code.xlsx');
  await exportWorkbook(file, ['comparison'], { comparison:[{
    projectCode:'AUT1', drawingCode:'NEW-01', originalItemCode:'OLD-01', replacementItemCode:'NEW-01',
    originalPurchaseOrder:'PR-OLD', replacementPurchaseOrder:'PR-NEW',
    purchaseQuantity:1, scanQuantity:1, warehouseQuantity:1
  }] });
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.readFile(file);
  const value = workbook.getWorksheet('AUT1').getCell('C10').value;
  assert.equal(value.richText[0].text, 'OLD-01');
  assert.equal(value.richText[0].font.strike, true);
  assert.equal(value.richText[1].text, ' → NEW-01');
  const codeNote = workbook.getWorksheet('AUT1').getCell('P10').value;
  assert.equal(codeNote.richText[0].text, 'OLD-01');
  assert.equal(codeNote.richText[0].font.strike, true);
  assert.equal(codeNote.richText[1].text, ' → NEW-01');
  const prNote = workbook.getWorksheet('AUT1').getCell('Q10').value;
  assert.equal(prNote.richText[0].text, 'PR-OLD');
  assert.equal(prNote.richText[0].font.strike, true);
  assert.equal(prNote.richText[1].text, ' → PR-NEW');
});
