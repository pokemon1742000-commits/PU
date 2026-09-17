const ExcelJS = require('exceljs');

const projectReportDefinition = ['STT','Mã dự án','Mã hàng','Tên hàng','Số lượng BOOM','Số liệu XK','Maker','Ngày bắn code','Ngày nhập kho','Số lượng nhập kho','Tình trạng','Note','Người Vận Hành','Mã PO','Hạn Giao Hàng','Note đổi mã','Đổi PR'];
const sourceComparisonDefinition = ['STT','Mã dự án','Mã hàng','Tên hàng','Số lượng PR','Số lượng PO đặt','Số lượng PO đã về','Số lượng XGC đặt','Số lượng XGC đã nhập','Tổng PO + XGC','Chênh lệch','Kết luận','Ghi chú','Mã PR','Mã PO','Nguồn XGC','Note'];
const statusOptions = ['OK','Chưa về','Chưa về đủ','Đã về','Chưa bắn code','Check lại','Hủy','Tồn','Common'];

// Các loại báo cáo có thể xuất, mỗi loại tương ứng với đúng 1 sheet trong 1 file riêng.
const EXPORT_TYPES = { PU: 'pu', SOURCE: 'source' };

async function exportWorkbook(file, selected, session) {
  const wb = createWorkbook(session, normalizeSelection(selected));
  await wb.xlsx.writeFile(file);
}

async function exportWorkbookBuffer(session, selected) {
  return createWorkbook(session, normalizeSelection(selected)).xlsx.writeBuffer();
}

// Chuẩn hóa tham số `selected` thành { pu, source }. Có thể chọn 1 hoặc cả 2 loại;
// nếu không truyền gì hoặc giá trị không xác định, mặc định chọn cả 2 (giữ hành vi cũ).
function normalizeSelection(selected) {
  const list = Array.isArray(selected) ? selected.map(String) : [String(selected || '')].filter(Boolean);
  const wantPu = list.includes(EXPORT_TYPES.PU);
  const wantSource = list.includes(EXPORT_TYPES.SOURCE);
  if (!wantPu && !wantSource) return { pu: true, source: true };
  return { pu: wantPu, source: wantSource };
}

function createWorkbook(session, selection) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Đối Chiếu Dữ Liệu';
  wb.created = new Date();
  if (selection.pu) {
    const rows = session.comparison || [];
    const projects = [...new Set(rows.map(row => String(row.projectCode || '').trim()).filter(Boolean))];
    const sheetName = projects.length === 1 ? projects[0] : projects.length > 1 ? 'NHIỀU DỰ ÁN' : 'So Sánh';
    const ws = wb.addWorksheet(safeWorksheetName(sheetName));
    formatProjectReportSheet(ws, rows);
  }
  if (selection.source) {
    const sourceSheet = wb.addWorksheet('PR vs PO + XGC');
    formatSourceComparisonSheet(sourceSheet, buildSourceComparisonRows(session));
  }
  return wb;
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
    const statusValue = exportStatus(row);
    const showOrderDetails = ['Chưa về','Chưa về đủ'].includes(statusValue);
    const operatorValue = exportOperator(row);
    const noteValue = exportNote(row);
    const output = ws.addRow([
      index + 1, row.projectCode, row.drawingCode, row.itemName,
      row.purchaseQuantity, row.scanQuantity, row.maker, row.scanDate,
      row.warehouseDate, row.warehouseQuantity, statusValue, noteValue, operatorValue,
      showOrderDetails ? (row.poNumber || '') : '', showOrderDetails ? (row.dueDate || '') : '', '', ''
    ]);
    output.font = { name:'Aptos Narrow', size:11 };
    output.alignment = { vertical:'top' };
    output.getCell(11).dataValidation = {
      type:'list', allowBlank:false, showErrorMessage:true,
      errorTitle:'Tình trạng không hợp lệ', error:'Hãy chọn một tình trạng trong danh sách.',
      formulae:[`"${statusOptions.join(',')}"`]
    };
    if (operatorValue === 'Kho') output.getCell(13).fill = fill('FFD9EAF7');
    else if (operatorValue === 'PU check') output.getCell(13).fill = fill('FFFFE5CC');
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

function formatSourceComparisonSheet(ws, rows) {
  ws.mergeCells('A3:Q4');
  const title = ws.getCell('A3');
  title.value = 'ĐỐI CHIẾU PR VỚI PO + XGC';
  title.font = { name:'Times New Roman', size:20, bold:true };
  title.alignment = { horizontal:'center', vertical:'middle' };
  for (let row = 3; row <= 4; row++) for (let col = 1; col <= sourceComparisonDefinition.length; col++) {
    const cell = ws.getRow(row).getCell(col);
    cell.border = {
      top: row === 3 ? { style:'thin' } : undefined,
      bottom: row === 4 ? { style:'thin' } : undefined,
      left: col === 1 ? { style:'thin' } : undefined,
      right: col === sourceComparisonDefinition.length ? { style:'thin' } : undefined
    };
  }
  ws.getRow(3).height = 22;
  ws.getRow(4).height = 22;
  const header = ws.getRow(9);
  header.values = sourceComparisonDefinition;
  header.height = 34.5;
  header.font = { name:'Aptos Narrow', size:11, bold:true };
  header.alignment = { horizontal:'center', vertical:'middle', wrapText:true };
  for (let col = 1; col <= sourceComparisonDefinition.length; col++) header.getCell(col).fill = fill(col <= 4 ? 'FF92D050' : 'FFFFC000');
  rows.forEach((row, index) => {
    const output = ws.addRow([
      index + 1, row.projectCode, row.itemCode, row.itemName,
      row.prQuantity, row.poOrderedQuantity, row.poReceivedQuantity,
      row.xgcOrderedQuantity, row.xgcReceivedQuantity, row.sourceQuantity,
      row.difference, row.status, row.note, row.prCodes, row.poCodes, row.xgcCodes, row.remainingQuantity
    ]);
    output.font = { name:'Aptos Narrow', size:11 };
    output.alignment = { vertical:'top' };
    [1,2,5,6,7,8,9,10,11,12].forEach(col => output.getCell(col).alignment = { horizontal:'center', vertical:'middle', wrapText:true });
    [3,4,13,14,15,16,17].forEach(col => output.getCell(col).alignment = { vertical:'top', wrapText:true });
    output.getCell(12).fill = fill(row.status === 'Đủ' ? 'FF92D050' : row.status === 'Check lại' ? 'FFFFC000' : 'FFFFFF00');
  });
  [9,17,29,29,14,16,16,16,17,16,14,14,28,24,24,24,17].forEach((width, index) => { ws.getColumn(index + 1).width = width; });
  [1,5,6,7,8,9,10,11].forEach(col => { ws.getColumn(col).numFmt = '0'; });
  ws.views = [{ state:'frozen', xSplit:4, ySplit:9, topLeftCell:'E10', activeCell:'A10' }];
  ws.autoFilter = { from:'A9', to:`Q${Math.max(9, 9 + rows.length)}` };
  ws.pageSetup = { orientation:'landscape', fitToPage:true, fitToWidth:1, fitToHeight:0, paperSize:9 };
}

function buildSourceComparisonRows(session) {
  const groups = new Map();
  const add = (sourceRows, source) => (sourceRows || []).forEach(row => {
    const projectCode = String(row.projectCode || '').trim();
    const itemCode = sourceCode(row.itemCode);
    if (!projectCode || !itemCode) return;
    const key = `${projectCode.toUpperCase()}|${itemCode}`;
    const group = groups.get(key) || {
      projectCode, itemCode, itemName:'', prEntries:[], poOrderedQuantity:0, poReceivedQuantity:0,
      xgcOrderedQuantity:0, xgcReceivedQuantity:0, poCodes:[], xgcCodes:[], hasPr:false, hasSource:false
    };
    if (row.itemName && !group.itemName) group.itemName = row.itemName;
    if (source === 'pr') {
      group.hasPr = true;
      // Mỗi dòng PR giữ nguyên số lượng và cột I (Số lượng còn lại) riêng của nó,
      // không gộp/nối chuỗi với các dòng PR khác cùng mã hàng.
      group.prEntries.push({
        quantity: numeric(row.quantity),
        remainingQuantity: String(row.remainingQuantity || '').trim(),
        purchaseOrder: String(row.purchaseOrder || '').trim()
      });
    } else {
      group.hasSource = true;
      const ordered = numeric(row.orderedQuantity), received = numeric(row.receivedQuantity);
      if (source === 'xgc') {
        group.xgcOrderedQuantity += ordered;
        group.xgcReceivedQuantity += received;
        appendUnique(group.xgcCodes, row.itemCode);
      } else {
        group.poOrderedQuantity += ordered;
        group.poReceivedQuantity += received;
        appendUnique(group.poCodes, row.poNumber);
      }
    }
    groups.set(key, group);
  });
  add(session.purchase, 'pr');
  add(session.warehouse, 'po');
  add(session.workshop, 'xgc');
  const rows = [];
  for (const group of groups.values()) {
    const prQuantity = group.prEntries.reduce((total, entry) => total + entry.quantity, 0);
    const sourceQuantity = group.poOrderedQuantity + group.xgcOrderedQuantity;
    const difference = sourceQuantity - prQuantity;
    let status, note;
    if (!group.hasPr) { status = 'Check lại'; note = 'Có trong PO/XGC nhưng không có trong PR'; }
    else if (!group.hasSource) { status = 'Chưa đặt hàng'; note = 'Có trong PR nhưng chưa có trong PO và XGC'; }
    else if (difference < -1e-8) { status = 'Thiếu'; note = `Thiếu ${Math.abs(difference)}`; }
    else if (difference > 1e-8) { status = 'Thừa'; note = `Thừa ${difference}`; }
    else { status = 'Đủ'; note = ''; }
    const base = {
      projectCode: group.projectCode, itemCode: group.itemCode, itemName: group.itemName,
      poOrderedQuantity: group.poOrderedQuantity, poReceivedQuantity: group.poReceivedQuantity,
      xgcOrderedQuantity: group.xgcOrderedQuantity, xgcReceivedQuantity: group.xgcReceivedQuantity,
      sourceQuantity, difference, status, note,
      poCodes: group.poCodes.join('; '), xgcCodes: group.xgcCodes.join('; ')
    };
    if (group.prEntries.length) {
      // Tách mỗi dòng PR gốc thành một dòng riêng trong sheet, thay vì gộp
      // số lượng và cột I lại với nhau khi cùng một mã hàng có nhiều dòng PR.
      for (const entry of group.prEntries) {
        rows.push({ ...base, prQuantity: entry.quantity, prCodes: entry.purchaseOrder, remainingQuantity: entry.remainingQuantity });
      }
    } else {
      rows.push({ ...base, prQuantity: 0, prCodes: '', remainingQuantity: '' });
    }
  }
  return rows;
}

function sourceCode(value) {
  return String(value || '').trim().toUpperCase().replace(/_GC$/i, '');
}

function appendUnique(values, value) {
  const text = String(value || '').trim();
  if (text && !values.includes(text)) values.push(text);
}

function safeWorksheetName(value) {
  return String(value || 'So Sánh').replace(/[\\/*?:\[\]]/g, '-').replace(/^'+|'+$/g, '').slice(0, 31) || 'So Sánh';
}

function numeric(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function exportStatus(row) {
  const purchase = numeric(row.purchaseQuantity), scanned = numeric(row.scanQuantity), received = numeric(row.warehouseQuantity);
  if (purchase <= 1e-8 && (scanned > 1e-8 || received > 1e-8)) return 'Check lại';
  if (scanned >= purchase - 1e-8) return 'OK';
  if (received <= 1e-8) return 'Chưa về';
  if (received < purchase - 1e-8) return 'Chưa về đủ';
  return 'Chưa bắn code';
}

function exportOperator(row) {
  const purchase = numeric(row.purchaseQuantity), scanned = numeric(row.scanQuantity), received = numeric(row.warehouseQuantity);
  if (purchase <= 1e-8 && (scanned > 1e-8 || received > 1e-8)) return 'PU check';
  if (scanned >= purchase - 1e-8) return '';
  if (received >= purchase - 1e-8 && purchase > 0) return 'Kho';
  const hasWarehouseOrder = row.warehouseOrderPlaced === true || Boolean(row.poNumber || row.dueDate || row.supplier || received > 0);
  return hasWarehouseOrder ? (row.supplier || 'PU check') : 'PU check';
}

function exportNote(row) {
  const hasPurchaseRequest = Boolean(String(row.purchaseOrder || '').trim());
  return hasPurchaseRequest && row.hasReceiptRecord === false ? 'PU Check' : '';
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

module.exports = { exportWorkbook, exportWorkbookBuffer, EXPORT_TYPES };
