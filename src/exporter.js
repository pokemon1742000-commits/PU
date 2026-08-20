const ExcelJS = require('exceljs');

const projectReportDefinition = ['STT','Mã dự án','Mã hàng','Tên hàng','Số lượng BOOM','Số liệu XK','Maker','Ngày bắn code','Ngày nhập kho','Số lượng nhập kho','Tình trạng','Note','Người Vận Hành','Mã PO','Hạn Giao Hàng','Note đổi mã','Đổi PR'];
const statusOptions = ['OK','Chưa về','Chưa về đủ','Đã về','Chưa bắn code'];

async function exportWorkbook(file, _selected, session) {
  const rows = session.comparison || [];
  const projects = [...new Set(rows.map(row => String(row.projectCode || '').trim()).filter(Boolean))];
  const sheetName = projects.length === 1 ? projects[0] : projects.length > 1 ? 'NHIỀU DỰ ÁN' : 'So Sánh';
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Đối Chiếu Dữ Liệu';
  wb.created = new Date();
  const ws = wb.addWorksheet(safeWorksheetName(sheetName));
  formatProjectReportSheet(ws, rows);
  await wb.xlsx.writeFile(file);
}

function formatProjectReportSheet(ws, rows) {
  ws.mergeCells('A3:Q4');
  const title = ws.getCell('A3');
  title.value = 'SỐ LIỆU XUẤT KHO';
  title.font = { name:'Times New Roman', size:20, bold:true };
  title.alignment = { horizontal:'center', vertical:'middle' };
  for (let row = 3; row <= 4; row++) for (let col = 1; col <= projectReportDefinition.length; col++) {
    const cell = ws.getRow(row).getCell(col);
    cell.border = {
      top: row === 3 ? { style:'thin' } : undefined,
      bottom: row === 4 ? { style:'thin' } : undefined,
      left: col === 1 ? { style:'thin' } : undefined,
      right: col === projectReportDefinition.length ? { style:'thin' } : undefined
    };
  }
  ws.getRow(3).height = 22;
  ws.getRow(4).height = 22;
  const header = ws.getRow(9);
  header.values = projectReportDefinition;
  header.height = 34.5;
  header.font = { name:'Aptos Narrow', size:11, bold:true };
  header.alignment = { horizontal:'center', vertical:'middle', wrapText:true };
  for (let col = 1; col <= projectReportDefinition.length; col++) {
    header.getCell(col).fill = fill(col <= 5 ? 'FF92D050' : 'FFFFC000');
  }
  rows.forEach((row, index) => {
    const shortage = isShortage(row);
    const output = ws.addRow([
      index + 1, row.projectCode, row.drawingCode, row.itemName,
      row.purchaseQuantity, row.scanQuantity, row.maker, row.scanDate,
      row.warehouseDate, row.warehouseQuantity, exportStatus(row), exportNote(row), exportOperator(row),
      shortage ? (row.poNumber || '') : '', shortage ? (row.dueDate || '') : '', '', ''
    ]);
    output.font = { name:'Aptos Narrow', size:11 };
    output.alignment = { vertical:'top' };
    output.getCell(11).dataValidation = {
      type:'list', allowBlank:false, showErrorMessage:true,
      errorTitle:'Tình trạng không hợp lệ', error:'Hãy chọn một tình trạng trong danh sách.',
      formulae:[`"${statusOptions.join(',')}"`]
    };
    output.getCell(1).font = { name:'Aptos Narrow', size:11, bold:true };
    output.getCell(2).font = { name:'Aptos Narrow', size:11, bold:true };
    if (row.originalItemCode && row.replacementItemCode) {
      output.getCell(3).value = replacementText(row.originalItemCode, row.replacementItemCode);
      output.getCell(16).value = replacementText(row.originalItemCode, row.replacementItemCode);
    }
    if (row.originalPurchaseOrder && row.replacementPurchaseOrder) output.getCell(17).value = replacementText(row.originalPurchaseOrder, row.replacementPurchaseOrder);
    [1,2,5,6,7,8,9,10,11,13,14,15].forEach(col => output.getCell(col).alignment = { horizontal:'center', vertical:'middle' });
    [11,12,16,17].forEach(col => { output.getCell(col).alignment = { vertical:'top', wrapText:true }; });
    const difference = numeric(row.scanQuantity) - numeric(row.purchaseQuantity);
    if (difference < -1e-8) output.getCell(6).fill = fill('FFFFFF00');
    else if (difference > 1e-8) output.getCell(6).fill = fill('FF92D050');
  });
  const widths = [9,17,29,29,14,14,14,14,14,17,18,14,18,18,18,35,35];
  widths.forEach((width, index) => { ws.getColumn(index + 1).width = width; });
  [1,5,6,10].forEach(col => { ws.getColumn(col).numFmt = '0'; });
  ws.views = [{ state:'frozen', xSplit:5, ySplit:9, topLeftCell:'F10', activeCell:'A10' }];
  ws.autoFilter = { from:'A9', to:`Q${Math.max(9, 9 + rows.length)}` };
  ws.pageSetup = { orientation:'landscape', fitToPage:true, fitToWidth:1, fitToHeight:0, paperSize:9 };
}

function safeWorksheetName(value) {
  return String(value || 'So Sánh').replace(/[\\/*?:\[\]]/g, '-').replace(/^'+|'+$/g, '').slice(0, 31) || 'So Sánh';
}

function numeric(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function exportNote(row) {
  const purchase = numeric(row.purchaseQuantity);
  const scanned = numeric(row.scanQuantity);
  const difference = quantityValue(scanned - purchase);
  if (difference > 1e-8) return `Thừa ${difference}`;
  if (difference < -1e-8) return `Thiếu ${Math.abs(difference)}`;
  return '';
}

function isShortage(row) {
  return numeric(row.scanQuantity) < numeric(row.purchaseQuantity) - 1e-8;
}

function quantityValue(value) {
  return Number(Number(value || 0).toFixed(6));
}

function exportStatus(row) {
  const purchase = numeric(row.purchaseQuantity), scanned = numeric(row.scanQuantity), received = numeric(row.warehouseQuantity);
  if (Math.abs(scanned - purchase) < 1e-8) return 'OK';
  if (received <= 1e-8) return 'Chưa về';
  if (received < purchase - 1e-8) return 'Chưa về đủ';
  if (scanned < purchase - 1e-8) return 'Chưa bắn code';
  return 'Đã về';
}

function exportOperator(row) {
  const purchase = numeric(row.purchaseQuantity), scanned = numeric(row.scanQuantity), received = numeric(row.warehouseQuantity);
  if (scanned > purchase + 1e-8) return 'Kho';
  if (scanned >= purchase - 1e-8) return '';
  if (received >= purchase - 1e-8 && purchase > 0) return 'Kho';
  const hasWarehouseOrder = row.warehouseOrderPlaced === true || Boolean(row.poNumber || row.dueDate || row.supplier || received > 0);
  return hasWarehouseOrder ? (row.supplier || 'PU check') : 'PU check';
}

function replacementText(oldValue, newValue) {
  return { richText: [
    { font:{ name:'Aptos Narrow', size:11, strike:true, color:{ argb:'FF7A8791' } }, text:String(oldValue) },
    { font:{ name:'Aptos Narrow', size:11, bold:true }, text:` → ${newValue}` }
  ] };
}

function fill(argb) {
  return { type:'pattern', pattern:'solid', fgColor:{argb} };
}

module.exports = { exportWorkbook };
