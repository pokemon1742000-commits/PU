const fs = require('fs/promises');
const ExcelJS = require('exceljs');
const { buildComparison, mergeWarehouseRows, canonicalProject } = require('./processor');

const projectReportDefinition = ['STT','Mã dự án','Mã hàng','Tên hàng','Số lượng BOOM','Số liệu XK','Maker','Ngày bắn code','Ngày nhập kho','Số lượng nhập kho','Tình trạng','Note','Người Vận Hành','Mã PO','Hạn Giao Hàng','Note đổi mã','Đổi PR'];
const sourceComparisonDefinition = ['STT','Mã dự án','Mã hàng','Tên hàng','Số lượng PR','Số lượng PO đặt','Số lượng PO đã về','Số lượng XGC đặt','Số lượng XGC đã nhập','Tổng PO + XGC','Chênh lệch','Kết luận','Ghi chú','Mã PR','Mã PO','Nguồn XGC','Note'];
const statusOptions = ['OK','Chưa về','Chưa về đủ','Đã về','Chưa bắn code','Check lại','Hủy','Tồn','Common'];
const projectRowFont = { name:'Aptos Narrow', size:11 };
const projectBoldFont = { name:'Aptos Narrow', size:11, bold:true };
const sourceRowFont = projectRowFont;
const rowTopAlignment = { vertical:'top' };
const centeredAlignment = { horizontal:'center', vertical:'middle' };
const centeredWrapAlignment = { horizontal:'center', vertical:'middle', wrapText:true };
const topWrapAlignment = { vertical:'top', wrapText:true };
const statusValidation = {
  type:'list', allowBlank:false, showErrorMessage:true,
  errorTitle:'Tình trạng không hợp lệ', error:'Hãy chọn một tình trạng trong danh sách.',
  formulae:[`"${statusOptions.join(',')}"`]
};
const projectWarehouseFill = fill('FFD9EAF7');
const projectPuCheckFill = fill('FFFFE5CC');
const projectShortFill = fill('FFFFFF00');
const projectExcessFill = fill('FF92D050');
const sourceCompleteFill = fill('FF92D050');
const sourceReviewFill = fill('FFFFC000');
const sourceIncompleteFill = fill('FFFFFF00');

// Các loại báo cáo có thể xuất, mỗi loại tương ứng với đúng 1 sheet trong 1 file riêng.
const EXPORT_TYPES = { PU: 'pu', SOURCE: 'source' };

async function exportWorkbook(file, selected, session) {
  const wb = createWorkbook(session, normalizeSelection(selected));
  await wb.xlsx.writeFile(file);
}

async function exportWorkbookLarge(file, selected, options = {}) {
  const database = options.database;
  if (!database) throw new Error('Không có cơ sở dữ liệu để xuất dữ liệu lớn.');
  const selection = normalizeSelection(selected);
  const onProgress = options.onProgress;
  const emit = (phase, detail, processed, total, project) => {
    if (onProgress) onProgress({ phase, detail, processed, total, project });
  };
  const temporaryFile = `${file}.tmp-${process.pid}-${Date.now()}`;
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
    filename:temporaryFile,
    useStyles:true,
    useSharedStrings:false,
    // Lower ZIP compression spends less CPU while keeping a valid XLSX.
    zip:{ zlib:{ level:1 } }
  });
  try {
    workbook.creator = 'Đối Chiếu Dữ Liệu';
    workbook.created = new Date();
    const groupedCache = new Map();
    if (selection.pu) await writeLargeProjectSheet(workbook, database, options, emit, groupedCache);
    if (selection.source) await writeLargeSourceSheet(workbook, database, options, emit, groupedCache);
    await workbook.commit();
    await fs.rename(temporaryFile, file);
  } catch (error) {
    await fs.rm(temporaryFile, { force:true });
    throw error;
  }
}

async function writeLargeProjectSheet(workbook, database, options, emit, groupedCache) {
  const canonicalizeProject = options.canonicalizeProject || canonicalProject;
  const tables = ['purchases', 'scans', 'warehouse', 'workshop'];
  emit('preparing', 'Đang tải dữ liệu xuất theo lô…', 0, tables.length);
  const grouped = await getGroupedRows(database, tables, canonicalizeProject, groupedCache, info => {
    emit('preparing', `Đã tải ${info.table} (${info.processed}/${info.total})…`, info.processed, info.total);
  });
  const projects = grouped.projects;
  const scanProjects = [...(grouped.rows.get('scans') || new Map()).keys()];
  const puProjects = scanProjects.length ? scanProjects : projects;
  if (!puProjects.length) {
    const sheet = workbook.addWorksheet('So Sánh');
    formatStreamingProjectHeader(sheet, 'So Sánh');
    sheet.commit();
    return;
  }
  const sheetName = puProjects.length === 1 ? puProjects[0] : 'NHIỀU DỰ ÁN';
  const sheet = workbook.addWorksheet(safeWorksheetName(sheetName));
  formatStreamingProjectHeader(sheet);
  let outputIndex = 0;
  // Process all projects in parallel — the grouped rows are already in memory,
  // so the CPU work (fuzzy matching, comparisons) can run concurrently.
  const results = await Promise.all(puProjects.map((project, idx) => {
    emit('comparing', `Đang đối chiếu ${project} (${idx + 1}/${puProjects.length})…`, idx + 1, puProjects.length, project);
    return loadProjectComparison(database, project, options, grouped.rows);
  }));
  emit('writing', 'Đang ghi dữ liệu PU…', 0, results.length);
  for (const rows of results) {
    for (const row of rows) if (!row.missingScan) writeProjectRow(sheet, row, outputIndex++);
  }
  for (const rows of results) {
    for (const row of rows) if (row.missingScan) writeProjectRow(sheet, row, outputIndex++);
  }
  emit('finalizing', `Hoàn tất PU: ${outputIndex} dòng`, outputIndex, outputIndex);
  sheet.autoFilter = { from:'A9', to:`Q${Math.max(9, 9 + outputIndex)}` };
  sheet.commit();
}

async function getGroupedRows(database, tables, canonicalizeProject, cache, onProgress) {
  const key = tables.join('|');
  if (cache?.has(key)) return cache.get(key);
  if (cache) {
    for (const [cachedKey, cached] of cache) {
      const cachedTables = new Set(cachedKey.split('|'));
      if (tables.every(table => cachedTables.has(table))) {
        const rows = new Map(tables.map(table => [table, cached.rows.get(table) || new Map()]));
        const projects = [...new Set(tables.flatMap(table => [...rows.get(table).keys()]))];
        const result = { rows, projects };
        cache.set(key, result);
        return result;
      }
    }
  }
  const grouped = await prepareGroupedRows(database, tables, canonicalizeProject, onProgress);
  if (cache) cache.set(key, grouped);
  return grouped;
}

async function prepareGroupedRows(database, tables, canonicalizeProject, onProgress) {
  if (typeof database.readTablesGroupedByProject === 'function') {
    const result = await database.readTablesGroupedByProject(tables, canonicalizeProject, onProgress);
    const rows = result?.tables instanceof Map ? result.tables : new Map();
    for (const table of tables) if (!rows.has(table)) rows.set(table, new Map());
    const projects = Array.isArray(result?.projects)
      ? [...new Set(result.projects.map(canonicalizeProject).filter(Boolean))]
      : [...new Set(tables.flatMap(table => [...rows.get(table).keys()]))];
    return { rows, projects };
  }

  const projects = [...new Set((await database.listProjectsInTableOrder(tables)).map(canonicalizeProject).filter(Boolean))];
  const rows = new Map(tables.map(table => [table, new Map()]));
  for (const project of projects) {
    for (const table of tables) {
      const matches = (await database.readTableRowsByProject(table, project))
        .filter(row => canonicalizeProject(row.projectCode) === project);
      if (matches.length) rows.get(table).set(project, matches);
    }
  }
  return { rows, projects };
}

async function loadProjectComparison(database, project, options = {}, groupedRows = null) {
  const canonicalize = options.canonicalizeProject || (value => String(value || '').trim().toUpperCase());
  const canonical = canonicalize(options.canonicalProject || project);
  const read = async table => {
    if (groupedRows?.has(table)) return groupedRows.get(table).get(canonical) || [];
    return (await database.readTableRowsByProject(table, canonical))
      .filter(row => canonicalize(row.projectCode) === canonical);
  };
  const purchase = await read('purchases');
  const scans = await read('scans');
  const warehouse = await read('warehouse');
  const workshop = await read('workshop');
  const decisions = options.decisions instanceof Map ? options.decisions : new Map(options.decisions || []);
  const replacements = (options.purchaseReplacements || [])
    .filter(row => canonicalize(row.projectCode) === canonical);
  return buildComparison(
    purchase,
    scans,
    mergeWarehouseRows([...warehouse, ...workshop]),
    options.comparisonThreshold || 91,
    decisions,
    options.confirmationThreshold || 90,
    replacements
  ).comparison;
}

function formatStreamingProjectHeader(ws) {
  ws.mergeCells('A3:Q4');
  ws.getCell('A3').value = 'SỐ LIỆU XUẤT KHO';
  ws.getCell('A3').font = { name:'Times New Roman', size:20, bold:true };
  ws.getCell('A3').alignment = { horizontal:'center', vertical:'middle' };
  ws.getRow(3).height = 22; ws.getRow(4).height = 22;
  const header = ws.getRow(9);
  header.values = projectReportDefinition;
  header.height = 34.5;
  header.font = { name:'Aptos Narrow', size:11, bold:true };
  header.alignment = { horizontal:'center', vertical:'middle', wrapText:true };
  for (let col = 1; col <= projectReportDefinition.length; col++) header.getCell(col).fill = fill(col <= 5 ? 'FF92D050' : 'FFFFC000');
  [9,17,29,29,14,14,14,14,14,17,18,14,18,18,18,35,35].forEach((width, index) => { ws.getColumn(index + 1).width = width; });
  [1,5,6,10].forEach(col => { ws.getColumn(col).numFmt = '0'; });
  ws.views = [{ state:'frozen', xSplit:5, ySplit:9, topLeftCell:'F10', activeCell:'A10' }];
  ws.pageSetup = { orientation:'landscape', fitToPage:true, fitToWidth:1, fitToHeight:0, paperSize:9 };
}

function writeProjectRow(ws, row, index) {
  const statusValue = exportStatus(row);
  const showOrderDetails = ['Chưa về','Chưa về đủ'].includes(statusValue);
  const output = ws.addRow([index + 1, row.projectCode, row.drawingCode, row.itemName, row.purchaseQuantity, row.scanQuantity, row.maker, row.scanDate, row.warehouseDate, row.warehouseQuantity, statusValue, exportNote(row), exportOperator(row), showOrderDetails ? (row.poNumber || '') : '', showOrderDetails ? (row.dueDate || '') : '', '', '']);
  output.font = projectRowFont; output.alignment = rowTopAlignment;
  output.getCell(11).dataValidation = statusValidation;
  const operator = exportOperator(row);
  if (operator === 'Kho') output.getCell(13).fill = projectWarehouseFill; else if (operator === 'PU check') output.getCell(13).fill = projectPuCheckFill;
  output.getCell(1).font = projectBoldFont; output.getCell(2).font = projectBoldFont;
  if (row.originalItemCode && row.replacementItemCode) { output.getCell(3).value = replacementText(row.originalItemCode, row.replacementItemCode); output.getCell(16).value = replacementText(row.originalItemCode, row.replacementItemCode); }
  if (row.originalPurchaseOrder && row.replacementPurchaseOrder) output.getCell(17).value = replacementText(row.originalPurchaseOrder, row.replacementPurchaseOrder);
  [1,2,5,6,7,8,9,10,11,13,14,15].forEach(col => output.getCell(col).alignment = centeredAlignment);
  [11,12,16,17].forEach(col => { output.getCell(col).alignment = topWrapAlignment; });
  const difference = numeric(row.scanQuantity) - numeric(row.purchaseQuantity);
  if (difference < -1e-8) output.getCell(6).fill = projectShortFill; else if (difference > 1e-8) output.getCell(6).fill = projectExcessFill;
  output.commit();
}

async function writeLargeSourceSheet(workbook, database, options, emit, groupedCache) {
  const sheet = workbook.addWorksheet('PR vs PO + XGC');
  formatStreamingSourceHeader(sheet);
  const canonicalizeProject = options.canonicalizeProject || canonicalProject;
  emit('preparing', 'Đang tải dữ liệu xuất theo lô…', 0, 3);
  const grouped = await getGroupedRows(database, ['purchases', 'warehouse', 'workshop'], canonicalizeProject, groupedCache, info => {
    emit('preparing', `Đã tải ${info.table} (${info.processed}/${info.total})…`, info.processed, info.total);
  });
  let index = 0;
  // Process all projects in parallel — grouped data is already in memory.
  const sourceResults = await Promise.all(grouped.projects.map((project, idx) => {
    emit('comparing', `Đang đọc PR/PO/XGC ${project} (${idx + 1}/${grouped.projects.length})…`, idx + 1, grouped.projects.length, project);
    return buildSourceComparisonRows({
      purchase: grouped.rows.get('purchases')?.get(project) || [],
      warehouse: grouped.rows.get('warehouse')?.get(project) || [],
      workshop: grouped.rows.get('workshop')?.get(project) || []
    });
  }));
  for (const rows of sourceResults) {
    for (const row of rows) writeSourceRow(sheet, row, index++);
  }
  emit('finalizing', `Hoàn tất PR/PO/XGC: ${index} dòng`, index, index);
  sheet.autoFilter = { from:'A9', to:`Q${Math.max(9, 9 + index)}` };
  sheet.commit();
}

function formatStreamingSourceHeader(ws) {
  ws.mergeCells('A3:Q4'); ws.getCell('A3').value = 'ĐỐI CHIẾU PR VỚI PO + XGC'; ws.getCell('A3').font = { name:'Times New Roman', size:20, bold:true }; ws.getCell('A3').alignment = { horizontal:'center', vertical:'middle' }; ws.getRow(3).height = 22; ws.getRow(4).height = 22;
  const header = ws.getRow(9); header.values = sourceComparisonDefinition; header.height = 34.5; header.font = { name:'Aptos Narrow', size:11, bold:true }; header.alignment = { horizontal:'center', vertical:'middle', wrapText:true }; for (let col = 1; col <= sourceComparisonDefinition.length; col++) header.getCell(col).fill = fill(col <= 4 ? 'FF92D050' : 'FFFFC000');
  [9,17,29,29,14,16,16,16,17,16,14,14,28,24,24,24,17].forEach((width, index) => { ws.getColumn(index + 1).width = width; }); [1,5,6,7,8,9,10,11].forEach(col => { ws.getColumn(col).numFmt = '0'; }); ws.views = [{ state:'frozen', xSplit:4, ySplit:9, topLeftCell:'E10', activeCell:'A10' }]; ws.pageSetup = { orientation:'landscape', fitToPage:true, fitToWidth:1, fitToHeight:0, paperSize:9 };
}

function writeSourceRow(ws, row, index) {
  const output = ws.addRow([index + 1, row.projectCode, row.itemCode, row.itemName, row.prQuantity, row.poOrderedQuantity, row.poReceivedQuantity, row.xgcOrderedQuantity, row.xgcReceivedQuantity, row.sourceQuantity, row.difference, row.status, row.note, row.prCodes, row.poCodes, row.xgcCodes, row.remainingQuantity]);
  output.font = sourceRowFont; output.alignment = rowTopAlignment; [1,2,5,6,7,8,9,10,11,12].forEach(col => output.getCell(col).alignment = centeredWrapAlignment); [3,4,13,14,15,16,17].forEach(col => output.getCell(col).alignment = topWrapAlignment); output.getCell(12).fill = row.status === 'Đủ' ? sourceCompleteFill : row.status === 'Check lại' ? sourceReviewFill : sourceIncompleteFill; output.commit();
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
    output.font = projectRowFont;
    output.alignment = rowTopAlignment;
    output.getCell(11).dataValidation = statusValidation;
    if (operatorValue === 'Kho') output.getCell(13).fill = projectWarehouseFill;
    else if (operatorValue === 'PU check') output.getCell(13).fill = projectPuCheckFill;
    output.getCell(1).font = projectBoldFont;
    output.getCell(2).font = projectBoldFont;
    if (row.originalItemCode && row.replacementItemCode) {
      output.getCell(3).value = replacementText(row.originalItemCode, row.replacementItemCode);
      output.getCell(16).value = replacementText(row.originalItemCode, row.replacementItemCode);
    }
    if (row.originalPurchaseOrder && row.replacementPurchaseOrder) output.getCell(17).value = replacementText(row.originalPurchaseOrder, row.replacementPurchaseOrder);
    [1,2,5,6,7,8,9,10,11,13,14,15].forEach(col => output.getCell(col).alignment = centeredAlignment);
    [11,12,16,17].forEach(col => { output.getCell(col).alignment = topWrapAlignment; });
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
    output.getCell(12).fill = row.status === 'Đủ' ? sourceCompleteFill : row.status === 'Check lại' ? sourceReviewFill : sourceIncompleteFill;
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
    const projectCode = canonicalProject(row.projectCode);
    const itemCode = sourceCode(row.itemCode);
    if (!projectCode || !itemCode) return;
    const key = `${projectCode}|${itemCode}`;
    const group = groups.get(key) || {
      projectCode, itemCode, itemName:'', prEntries:[], poOrderedQuantity:0, poReceivedQuantity:0,
      xgcOrderedQuantity:0, xgcReceivedQuantity:0, poCodes:[], xgcCodes:[], poCodeSet:new Set(), xgcCodeSet:new Set(), hasPr:false, hasSource:false
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
        appendUnique(group.xgcCodes, group.xgcCodeSet, row.itemCode);
      } else {
        group.poOrderedQuantity += ordered;
        group.poReceivedQuantity += received;
        appendUnique(group.poCodes, group.poCodeSet, row.poNumber);
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

function appendUnique(values, seen, value) {
  const text = String(value || '').trim();
  if (text && !seen.has(text)) { seen.add(text); values.push(text); }
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

module.exports = { exportWorkbook, exportWorkbookLarge, exportWorkbookBuffer, EXPORT_TYPES };
