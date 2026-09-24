const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const ExcelJS = require('exceljs');
const { Database } = require('../src/storage');
const { exportWorkbook, exportWorkbookLarge } = require('../src/exporter');
const { canonicalProject } = require('../src/processor');

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
  assert.deepEqual(workbook.worksheets.map(sheet => sheet.name), ['MEC001', 'PR vs PO + XGC']);
  const sheet = workbook.getWorksheet('MEC001');
  assert.equal(sheet.getCell('A3').value, 'SỐ LIỆU XUẤT KHO');
  assert.deepEqual(sheet.getRow(9).values.slice(1), ['STT','Mã dự án','Mã hàng','Tên hàng','Số lượng BOOM','Số liệu XK','Maker','Ngày bắn code','Ngày nhập kho','Số lượng nhập kho','Tình trạng','Note','Người Vận Hành','Mã PO','Hạn Giao Hàng','Note đổi mã','Đổi PR']);
  assert.deepEqual(sheet.getRow(10).values.slice(1), [1,'MEC001','DWG-1','Item',3,1,'Maker A','15/Aug','14/08/2026',2,'Chưa về đủ','','NCC A','PO-1','20/08/2026','','']);
  assert.equal(sheet.getCell('K10').dataValidation.type, 'list');
  assert.equal(sheet.getCell('K10').dataValidation.formulae[0], '"OK,Chưa về,Chưa về đủ,Đã về,Chưa bắn code,Check lại,Hủy,Tồn,Common"');
  assert.equal(sheet.getCell('L11').value || '', '');
  assert.equal(sheet.getCell('M11').value || '', '');
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
  assert.deepEqual(workbook.worksheets.map(sheet => sheet.name), ['NHIỀU DỰ ÁN', 'PR vs PO + XGC']);
  assert.equal(workbook.getWorksheet('NHIỀU DỰ ÁN').getCell('A10').value, 1);
  assert.equal(workbook.getWorksheet('NHIỀU DỰ ÁN').getCell('A11').value, 2);
});

test('comparison export only notes PU Check when a purchase PR has no warehouse or workshop record', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'comparison-notes-'));
  t.after(() => fs.rm(dir, { recursive:true, force:true }));
  const file = path.join(dir, 'notes.xlsx');
  await exportWorkbook(file, ['comparison'], { comparison:[
    { projectCode:'MEC1', drawingCode:'ENOUGH', purchaseQuantity:2, scanQuantity:2, warehouseQuantity:0, poNumber:'PO-OK', dueDate:'24/08/2026', note:'old detail' },
    { projectCode:'MEC1', drawingCode:'ARRIVED', purchaseQuantity:3, scanQuantity:1, warehouseQuantity:3, poNumber:'PO-ARRIVED', dueDate:'24/08/2026' },
    { projectCode:'MEC1', drawingCode:'NOT-ARRIVED', purchaseQuantity:3, scanQuantity:0, warehouseQuantity:0, supplier:'NCC A', poNumber:'PO-01', dueDate:'25/08/2026', warehouseOrderPlaced:true },
    { projectCode:'MEC1', drawingCode:'NO-ORDER', purchaseOrder:'PR-NO-ORDER', purchaseQuantity:3, scanQuantity:0, warehouseQuantity:0, warehouseOrderPlaced:false, hasReceiptRecord:false },
    { projectCode:'MEC1', drawingCode:'PARTIAL', purchaseQuantity:3, scanQuantity:1, warehouseQuantity:2, supplier:'NCC B', poNumber:'PO-02', dueDate:'26/08/2026', warehouseOrderPlaced:true },
    { projectCode:'MEC1', drawingCode:'EXCESS', purchaseQuantity:3, scanQuantity:4, warehouseQuantity:3, poNumber:'PO-X', dueDate:'30/08/2026' },
    { projectCode:'MEC1', drawingCode:'NO-PURCHASE-SCAN', purchaseQuantity:0, scanQuantity:2, warehouseQuantity:0, poNumber:'PO-NP1', dueDate:'31/08/2026' },
    { projectCode:'MEC1', drawingCode:'NO-PURCHASE-WH', purchaseQuantity:0, scanQuantity:0, warehouseQuantity:2, poNumber:'PO-NP2', dueDate:'31/08/2026' }
  ] });
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.readFile(file);
  const sheet = workbook.getWorksheet('MEC1');
  assert.deepEqual([10, 11, 12, 13, 14, 15, 16, 17].map(row => sheet.getCell(`L${row}`).value || ''), [
    '', '', '', 'PU Check', '', '', '', ''
  ]);
  assert.deepEqual([10, 11, 12, 13, 14, 15, 16, 17].map(row => sheet.getCell(`M${row}`).value || ''), [
    '', 'Kho', 'NCC A', 'PU check', 'NCC B', '', 'PU check', 'PU check'
  ]);
  assert.deepEqual([10, 11, 12, 13, 14, 15, 16, 17].map(row => sheet.getCell(`K${row}`).value), [
    'OK', 'Chưa bắn code', 'Chưa về', 'Chưa về', 'Chưa về đủ', 'OK', 'Check lại', 'Check lại'
  ]);
  for (let row = 10; row <= 17; row++) assert.equal(sheet.getCell(`K${row}`).dataValidation.type, 'list');
  assert.deepEqual([sheet.getCell('N12').value, sheet.getCell('O12').value], ['PO-01','25/08/2026']);
  assert.deepEqual([sheet.getCell('N14').value, sheet.getCell('O14').value], ['PO-02','26/08/2026']);
  assert.deepEqual([
    sheet.getCell('N10').value || '', sheet.getCell('O10').value || '',
    sheet.getCell('N11').value || '', sheet.getCell('O11').value || '',
    sheet.getCell('N15').value || '', sheet.getCell('O15').value || '',
    sheet.getCell('N16').value || '', sheet.getCell('O16').value || ''
  ], ['','','','','','','','']);
  assert.equal(sheet.getCell('M11').fill.fgColor.argb, 'FFD9EAF7');
  assert.equal(sheet.getCell('M13').fill.fgColor.argb, 'FFFFE5CC');
  assert.notEqual(sheet.getCell('M11').fill.fgColor.argb, sheet.getCell('M13').fill.fgColor.argb);
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

test('large database export streams selected sheets and preserves canonical project variants', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'large-export-'));
  const database = new Database(dir);
  await database.init();
  t.after(async () => { await database.close(); await fs.rm(dir, { recursive:true, force:true }); });

  await database.mergePurchases([{
    projectCode:'Project MEC1', purchaseOrder:'PR-1', itemCode:'ITEM-1', itemName:'Item 1', quantity:4
  }]);
  await database.mergeScans([{
    projectCode:'MEC1', drawingCode:'ITEM-1', manufacturer:'Maker', scanDate:'24/Sep', quantity:4
  }]);
  await database.mergeWarehouse([{
    projectCode:'Tên dự án MEC1', itemCode:'ITEM-1', itemName:'Item 1', supplier:'NCC', poNumber:'PO-1',
    orderedQuantity:4, receivedQuantity:4, dueDate:'24/09/2026', deliveryDate:'24/09/2026'
  }]);

  const puFile = path.join(dir, 'pu.xlsx');
  await exportWorkbookLarge(puFile, ['pu'], {
    database,
    canonicalizeProject: canonicalProject
  });
  const puWorkbook = new ExcelJS.Workbook();
  await puWorkbook.xlsx.readFile(puFile);
  assert.deepEqual(puWorkbook.worksheets.map(sheet => sheet.name), ['MEC1']);
  assert.deepEqual(puWorkbook.getWorksheet('MEC1').getRow(10).values.slice(1, 7), [1, 'MEC1', 'ITEM-1', 'Item 1', 4, 4]);
  assert.equal(puWorkbook.getWorksheet('MEC1').getCell('K10').value, 'OK');

  const sourceFile = path.join(dir, 'source.xlsx');
  await exportWorkbookLarge(sourceFile, ['source'], { database, canonicalizeProject: value => require('../src/processor').canonicalProject(value) });
  const sourceWorkbook = new ExcelJS.Workbook();
  await sourceWorkbook.xlsx.readFile(sourceFile);
  assert.deepEqual(sourceWorkbook.worksheets.map(sheet => sheet.name), ['PR vs PO + XGC']);
  const sourceSheet = sourceWorkbook.getWorksheet('PR vs PO + XGC');
  assert.equal(sourceSheet.rowCount, 10);
  assert.deepEqual(sourceSheet.getRow(10).values.slice(1, 12), [1, 'MEC1', 'ITEM-1', 'Item 1', 4, 4, 4, 0, 0, 4, 0]);
});

test('large PU export compares each project once and writes scan rows before missing rows', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'large-export-order-'));
  t.after(() => fs.rm(dir, { recursive:true, force:true }));
  const calls = [];
  const rows = {
    purchases: [
      { projectCode:'Project MEC1', purchaseOrder:'PR-SCAN', itemCode:'ITEM-1', itemName:'Scanned item', quantity:2 },
      { projectCode:'MEC1', purchaseOrder:'PR-MISSING', itemCode:'ITEM-2', itemName:'Missing item', quantity:3 }
    ],
    scans: [{ projectCode:'MEC1', drawingCode:'ITEM-1', quantity:2 }],
    warehouse: [{ projectCode:'Tên dự án MEC1', itemCode:'ITEM-1', orderedQuantity:2, receivedQuantity:2 }],
    workshop: []
  };
  const database = {
    async listProjectsInTableOrder(tables) {
      return tables.length === 1 && tables[0] === 'scans' ? ['MEC1'] : ['Project MEC1', 'MEC1'];
    },
    async readTableRowsByProject(table, project) {
      calls.push({ table, project });
      return rows[table] || [];
    }
  };
  const file = path.join(dir, 'ordered.xlsx');
  await exportWorkbookLarge(file, ['pu'], { database, canonicalizeProject:canonicalProject });
  assert.deepEqual(calls, [
    { table:'purchases', project:'MEC1' }, { table:'scans', project:'MEC1' },
    { table:'warehouse', project:'MEC1' }, { table:'workshop', project:'MEC1' }
  ]);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(file);
  const sheet = workbook.getWorksheet('MEC1');
  assert.equal(sheet.rowCount, 11);
  assert.deepEqual([sheet.getCell('C10').value, sheet.getCell('C11').value], ['ITEM-1', 'ITEM-2']);
  assert.equal(sheet.getCell('K10').value, 'OK');
  assert.equal(sheet.getCell('K11').value, 'Chưa về');
});

test('large export uses grouped rows once and preserves canonical project variants', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'large-export-grouped-'));
  t.after(() => fs.rm(dir, { recursive:true, force:true }));
  const calls = [];
  const grouped = {
    projects:['MEC1'],
    tables:new Map([
      ['purchases', new Map([['MEC1', [{ projectCode:'Project MEC1', purchaseOrder:'PR-1', itemCode:'ITEM-1', itemName:'Item', quantity:2 }]]])],
      ['scans', new Map([['MEC1', [{ projectCode:'MEC1', drawingCode:'ITEM-1', quantity:2 }]]])],
      ['warehouse', new Map([['MEC1', [{ projectCode:'Tên dự án MEC1', itemCode:'ITEM-1', orderedQuantity:2, receivedQuantity:2 }]]])],
      ['workshop', new Map([['MEC1', []]])]
    ])
  };
  const database = {
    async readTablesGroupedByProject(tables) { calls.push(tables); return grouped; }
  };
  const file = path.join(dir, 'grouped.xlsx');
  await exportWorkbookLarge(file, ['pu', 'source'], { database, canonicalizeProject:canonicalProject });
  assert.deepEqual(calls, [['purchases', 'scans', 'warehouse', 'workshop']]);
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.readFile(file);
  assert.equal(workbook.getWorksheet('MEC1').getCell('K10').value, 'OK');
  assert.equal(workbook.getWorksheet('PR vs PO + XGC').getCell('C10').value, 'ITEM-1');
});

test('export adds a PR versus PO and XGC sheet with quantity and code checks', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'source-comparison-export-'));
  t.after(() => fs.rm(dir, { recursive:true, force:true }));
  const file = path.join(dir, 'source-comparison.xlsx');
  await exportWorkbook(file, ['comparison'], {
    comparison:[],
    purchase:[
      { projectCode:'MEC1', purchaseOrder:'PR-A', itemCode:'A', itemName:'A item', quantity:10, remainingQuantity:'Powder Coating - Gray E1117' },
      { projectCode:'MEC1', purchaseOrder:'PR-B', itemCode:'B', quantity:5, remainingQuantity:'' },
      { projectCode:'MEC1', purchaseOrder:'PR-C', itemCode:'C', quantity:2, remainingQuantity:'Anod hóa' }
    ],
    warehouse:[
      { projectCode:'MEC1', itemCode:'A', poNumber:'PO-A', orderedQuantity:8, receivedQuantity:7 },
      { projectCode:'MEC1', itemCode:'C', poNumber:'PO-C', orderedQuantity:3, receivedQuantity:3 },
      { projectCode:'MEC1', itemCode:'D', poNumber:'PO-D', orderedQuantity:4, receivedQuantity:4 }
    ],
    workshop:[
      { projectCode:'MEC1', itemCode:'A_GC', poNumber:'XGC-A', orderedQuantity:2, receivedQuantity:2, sourceKind:'workshop' },
      { projectCode:'MEC1', itemCode:'E_GC', poNumber:'XGC-E', orderedQuantity:1, receivedQuantity:1, sourceKind:'workshop' }
    ]
  });
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.readFile(file);
  const sheet = workbook.getWorksheet('PR vs PO + XGC');
  assert.deepEqual(sheet.getRow(9).values.slice(1), ['STT','Mã dự án','Mã hàng','Tên hàng','Số lượng PR','Số lượng PO đặt','Số lượng PO đã về','Số lượng XGC đặt','Số lượng XGC đã nhập','Tổng PO + XGC','Chênh lệch','Kết luận','Ghi chú','Mã PR','Mã PO','Nguồn XGC','Note']);
  const rows = new Map(sheet.getRows(10, sheet.rowCount - 9).map(row => [row.getCell(3).value, row.values.slice(1)]));
  assert.deepEqual(rows.get('A').slice(9, 13), [10, 0, 'Đủ', '']);
  assert.deepEqual(rows.get('B').slice(9, 13), [0, -5, 'Chưa đặt hàng', 'Có trong PR nhưng chưa có trong PO và XGC']);
  assert.deepEqual(rows.get('C').slice(9, 13), [3, 1, 'Thừa', 'Thừa 1']);
  assert.deepEqual(rows.get('D').slice(9, 13), [4, 4, 'Check lại', 'Có trong PO/XGC nhưng không có trong PR']);
  assert.deepEqual(rows.get('E').slice(9, 13), [1, 1, 'Check lại', 'Có trong PO/XGC nhưng không có trong PR']);
  assert.equal(rows.get('A')[15], 'A_GC');
  assert.equal(rows.get('A')[16], 'Powder Coating - Gray E1117');
  assert.equal(rows.get('B')[16], '');
  assert.equal(rows.get('C')[16], 'Anod hóa');
});
