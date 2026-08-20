const ExcelJS = require('exceljs');
const fuzz = require('fuzzball');
const path = require('path');

const clean = v => String(v ?? '').trim();
const norm = v => clean(v).toUpperCase().replace(/\s+/g, ' ');
const headerKey = v => norm(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/Đ/g, 'D');
const number = v => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  let text = clean(v).replace(/[\s\u00a0]/g, '');
  if (text.includes(',') && text.includes('.')) {
    const decimal = text.lastIndexOf(',') > text.lastIndexOf('.') ? ',' : '.';
    const thousands = decimal === ',' ? /\./g : /,/g;
    text = text.replace(thousands, '').replace(decimal, '.');
  } else if ((text.match(/,/g) || []).length > 1) text = text.replace(/,/g, '');
  else if ((text.match(/\./g) || []).length > 1) text = text.replace(/\./g, '');
  else text = text.replace(',', '.');
  const n = Number(text);
  return Number.isFinite(n) ? n : 0;
};
function ensureTotals(label, sourceRows, groupedRows, fields) {
  for (const field of fields) {
    const sourceTotal = sourceRows.reduce((total, row) => total + number(row[field]), 0);
    const groupedTotal = groupedRows.reduce((total, row) => total + number(row[field]), 0);
    if (Math.abs(sourceTotal - groupedTotal) > 1e-8) {
      throw new Error(`${label}: tổng ${field} trước và sau khi gộp không khớp (${sourceTotal} / ${groupedTotal}).`);
    }
  }
}
const cellValue = c => {
  if (c instanceof Date) return c;
  return c && typeof c === 'object' ? (c.result ?? c.text ?? c.richText?.map(x => x.text).join('') ?? c.hyperlink ?? '') : c;
};
const rowData = row => ({ rowNo: row.number, values: row.values.slice(1).map(cellValue) });
async function* workbookSheets(file, selectedSheets) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(file, {
    ignoreNodes: ['dataValidations','hyperlinks','printOptions','pageMargins','pageSetup','headerFooter','drawing','picture','sheetProtection','conditionalFormatting','extLst']
  });
  const selected = new Set((selectedSheets || []).map(norm));
  for (const worksheet of workbook.worksheets) {
    if (!selected.size || selected.has(norm(worksheet.name))) yield worksheet;
  }
}

async function listWorkbookSheets(file) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(file, {
    ignoreNodes: ['dataValidations','hyperlinks','printOptions','pageMargins','pageSetup','headerFooter','drawing','picture','sheetProtection','conditionalFormatting','extLst']
  });
  return workbook.worksheets.map(worksheet => ({ name: worksheet.name, rowCount: worksheet.rowCount }));
}
async function* worksheetRows(worksheet) {
  for (let rowNo = 1; rowNo <= worksheet.rowCount; rowNo++) {
    const row = worksheet.getRow(rowNo);
    if (row.hasValues) yield row;
  }
}

function findHeader(rows, required, max = 30) {
  for (const r of rows.slice(0, max)) {
    const names = r.values.map(headerKey);
    if (required.every(group => group.some(x => names.includes(headerKey(x))))) return r;
  }
  return null;
}
function isHeader(row, required) {
  const names = row.values.map(headerKey);
  return required.every(group => group.some(x => names.includes(headerKey(x))));
}

function headerMap(header) { return new Map(header.values.map((v, i) => [headerKey(v), i])); }
function getBy(map, values, names) { for (const n of names) if (map.has(headerKey(n))) return values[map.get(headerKey(n))]; return ''; }
function projectCode(value) { const match = norm(value).match(/(?:^|[^A-Z0-9])((?:MEC|AUT)[A-Z0-9]*)/); return match ? match[1] : ''; }
function canonicalProject(value) { return projectCode(value) || norm(value); }

let processingQueue = Promise.resolve();
function processFiles(kind, files) {
  const job = processingQueue.then(() => processFilesInternal(kind, files));
  processingQueue = job.catch(() => undefined);
  return job;
}

async function processFilesInternal(kind, files) {
  if (!files?.length) throw new Error('Chưa chọn file.');
  if (kind === 'purchase') return processPurchases(files);
  if (kind === 'scan') return processScans(files);
  if (kind === 'warehouse') return processWarehouse(files);
  if (kind === 'reference') return processReferences(files);
  throw new Error('Loại file không hợp lệ.');
}

async function processPurchases(files) {
  const out = [], warnings = [];
  for (const source of files) {
    const { file, sheets } = sourceSpec(source);
    const required = [['Mã hàng'], ['ĐVT'], ['Maker', 'Marker'], ['Tình trạng']];
    let hasSheet = false, foundHeader = false;
    for await (const ws of workbookSheets(file, sheets)) {
      hasSheet = true;
      let header = null, map = null;
      for await (const excelRow of worksheetRows(ws)) {
        const r = rowData(excelRow);
        if (!header) {
          if (r.rowNo <= 30 && isHeader(r, required)) { header = r; map = headerMap(r); foundHeader = true; }
          continue;
        }
        const purchaseOrder = clean(getBy(map, r.values, ['Mã hàng']));
        const itemCode = clean(getBy(map, r.values, ['ĐVT']));
        const marker = clean(getBy(map, r.values, ['Maker', 'Marker']));
        const quantity = number(getBy(map, r.values, ['Tình trạng']));
        if (!purchaseOrder && !itemCode) continue;
        out.push({ projectCode: projectCode(purchaseOrder), purchaseOrder, itemCode, itemName: marker, marker, quantity, sourceFile: path.basename(file), sourceSheet: ws.name || '', sourceRow: r.rowNo });
      }
    }
    if (!hasSheet) throw new Error(`File ${path.basename(file)} không có sheet dữ liệu.`);
    if (!foundHeader) throw new Error(`${path.basename(file)}: không tìm thấy đủ cột Mã hàng, ĐVT, Maker/Marker, Tình trạng trong 30 dòng đầu của bất kỳ sheet nào.`);
  }
  return { rows: out, details: out.map(row => ({ ...row })), warnings };
}

function parseUsDate(s) {
  const m = clean(s).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[3], +m[1] - 1, +m[2]));
  return d.getUTCMonth() === +m[1] - 1 && d.getUTCDate() === +m[2] ? d.toISOString().slice(0, 10) : null;
}
const scanMonths = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function formatScanDayMonth(date) {
  return `${date.getUTCDate()}/${scanMonths[date.getUTCMonth()]}`;
}
function parseScanMarker(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return { display: formatScanDayMonth(value), sort: value.toISOString().slice(0, 10) };
  }
  const text = clean(value);
  const usDate = parseUsDate(text);
  if (usDate) return { display: usDate, sort: usDate };
  const match = text.match(/^(\d{1,2})[\/-]([A-Za-z]{3})(?:[\/-](\d{2,4}))?$/);
  if (!match) return null;
  const monthIndex = scanMonths.findIndex(month => month.toLowerCase() === match[2].toLowerCase());
  if (monthIndex < 0) return null;
  const day = Number(match[1]);
  const year = match[3] ? Number(match[3].length === 2 ? `20${match[3]}` : match[3]) : 2000;
  const date = new Date(Date.UTC(year, monthIndex, day));
  if (date.getUTCMonth() !== monthIndex || date.getUTCDate() !== day) return null;
  return {
    display: `${day}/${scanMonths[monthIndex]}`,
    sort: `${match[3] ? year : '0000'}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  };
}
function parseDmyDate(s) {
  if (s instanceof Date && !Number.isNaN(s.getTime())) {
    return `${String(s.getUTCDate()).padStart(2, '0')}/${String(s.getUTCMonth() + 1).padStart(2, '0')}/${s.getUTCFullYear()}`;
  }
  const text = clean(s);
  const formatValidated = (year, month, day) => {
    const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    if (date.getUTCFullYear() !== Number(year) || date.getUTCMonth() !== Number(month) - 1 || date.getUTCDate() !== Number(day)) return text;
    return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;
  };
  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T].*)?$/);
  if (iso) return formatValidated(iso[1], iso[2], iso[3]);
  const namedMonth = text.match(/^(\d{1,2})[\/-]([A-Za-z]{3})[\/-](\d{4})$/);
  if (namedMonth) {
    const monthIndex = scanMonths.findIndex(month => month.toLowerCase() === namedMonth[2].toLowerCase());
    if (monthIndex >= 0) return formatValidated(namedMonth[3], monthIndex + 1, namedMonth[1]);
  }
  const dmy = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!dmy) return text;
  return formatValidated(dmy[3], dmy[2], dmy[1]);
}

async function processScans(files) {
  const groups = new Map(), details = [], warnings = [];
  const addParsed = parsed => {
    details.push({ ...parsed, mergedRowCount: 1, note: '' });
    const key = [norm(parsed.projectCode), norm(parsed.drawingCode), norm(parsed.manufacturer), parsed.scanDate].join('|');
    const group = groups.get(key) || { ...parsed, quantity: 0, mergedRowCount: 0, note: '', scanHistory: [] };
    group.quantity += parsed.quantity;
    group.mergedRowCount += 1;
    group.note = group.mergedRowCount > 1 ? `Gộp ${group.mergedRowCount} dòng` : '';
    if (parsed.scanDate) group.scanHistory.push({ date: parsed.scanDate, quantity: parsed.quantity });
    groups.set(key, group);
  };
  for (const source of files) {
    const { file, sheets } = sourceSpec(source);
    let hasSheet = false;
    for await (const ws of workbookSheets(file, sheets)) {
      hasSheet = true;
      let currentScanMarker = null;
      let firstMarkerSeen = false;
      const pendingBeforeFirstMarker = [];
      for await (const excelRow of worksheetRows(ws)) {
        const r = rowData(excelRow), rawValue = r.values[0], value = clean(rawValue);
        if (!value) continue;
        const markerDate = value.includes(',') ? null : parseScanMarker(rawValue);
        if (markerDate) {
          if (!firstMarkerSeen) {
            pendingBeforeFirstMarker.forEach(row => addParsed({ ...row, scanDate: `Trước ${markerDate.display}`, scanDateSort: '' }));
            pendingBeforeFirstMarker.length = 0;
            firstMarkerSeen = true;
          }
          currentScanMarker = markerDate;
          continue;
        }
        const p = value.split(',').map(clean);
        if (p.length !== 7) { warnings.push(warning('Quét Mã', '', value, `${ws.name || 'Sheet'} dòng ${r.rowNo}: cần đúng 7 trường`, file)); continue; }
        let quantity, manufacturer, manualReview = false;
        const p3num = /^\d+$/.test(p[2]), p4num = /^\d+$/.test(p[3]);
        if (p3num && !p4num) { quantity = number(p[2]); manufacturer = p[3]; }
        else if (!p3num && p4num) { quantity = number(p[3]); manufacturer = p[2]; }
        else { quantity = number(p[2]); manufacturer = p[3]; manualReview = true; warnings.push(warning('Quét Mã', p[0], p[1], `${ws.name || 'Sheet'} dòng ${r.rowNo}: không xác định được thứ tự số lượng/NXS`, file)); }
        const parsed = { projectCode: canonicalProject(p[0]), drawingCode: p[1], quantity, manufacturer, receiptCode: p[4], warehouseDate: parseDmyDate(p[5]), reference: p[6], scanDate: currentScanMarker?.display || '', scanDateSort: currentScanMarker?.sort || '', manualReview, sourceFile: path.basename(file), sourceSheet: ws.name || '', sourceRow: r.rowNo };
        if (!firstMarkerSeen) pendingBeforeFirstMarker.push(parsed);
        else addParsed(parsed);
      }
      if (!firstMarkerSeen) pendingBeforeFirstMarker.forEach(row => addParsed({ ...row, scanDate: 'Chưa có ngày quét mã', scanDateSort: '' }));
    }
    if (!hasSheet) throw new Error(`File ${path.basename(file)} không có sheet dữ liệu.`);
  }
  const rows = [...groups.values()];
  ensureTotals('Quét Mã', details, rows, ['quantity']);
  return { rows, details, warnings };
}

async function processWarehouse(files) {
  const out = [], warnings = [];
  const cols = {
    projectName: ['Tên dự án'], itemCode: ['Mã Hàng', 'Mã hàng'], itemName: ['Tên Hàng', 'Tên hàng'],
    supplier: ['NCC'], orderedQuantity: ['Số lượng đặt hàng'], dueDate: ['Hạn giao hàng'], deliveryDate: ['Ngày giao hàng'], receivedQuantity: ['Số lượng đã về']
  };
  for (const source of files) {
    const { file, sheets } = sourceSpec(source);
    const required = Object.values(cols).map(x => x);
    let hasSheet = false, foundHeader = false;
    for await (const ws of workbookSheets(file, sheets)) {
      hasSheet = true;
      let header = null, map = null;
      for await (const excelRow of worksheetRows(ws)) {
        const r = rowData(excelRow);
        if (!header) {
          if (r.rowNo <= 30 && isHeader(r, required)) { header = r; map = headerMap(r); foundHeader = true; }
          continue;
        }
        const row = Object.fromEntries(Object.entries(cols).map(([k, names]) => [k, cellValue(getBy(map, r.values, names))]));
        if (!clean(row.projectName) && !clean(row.itemCode)) continue;
        row.projectName = clean(row.projectName); row.itemCode = clean(row.itemCode); row.itemName = clean(row.itemName); row.supplier = clean(row.supplier);
        row.projectCode = projectCode(row.projectName);
        if (!row.projectCode) {
          warnings.push(warning('Nhập Kho', '', row.projectName || row.itemCode, `${ws.name || 'Sheet'} dòng ${r.rowNo}: bỏ qua vì Tên dự án không chứa mã MEC... hoặc AUT...`, file));
          continue;
        }
        row.orderedQuantity = number(row.orderedQuantity); row.receivedQuantity = number(row.receivedQuantity);
        row.dueDate = parseDmyDate(row.dueDate); row.deliveryDate = parseDmyDate(row.deliveryDate);
        row.sourceFile = path.basename(file); row.sourceSheet = ws.name || ''; row.sourceRow = r.rowNo; out.push(row);
      }
    }
    if (!hasSheet) throw new Error(`File ${path.basename(file)} không có sheet dữ liệu.`);
    if (!foundHeader) throw new Error(`${path.basename(file)}: không tìm thấy đủ các cột Nhập Kho trong 30 dòng đầu của bất kỳ sheet nào.`);
  }
  const rows = mergeWarehouseRows(out);
  return { rows, details: out.map(row => ({ ...row, mergedRowCount: 1, note: '' })), warnings };
}

function mergeWarehouseRows(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = [row.projectCode, row.itemCode, row.supplier, row.dueDate, row.deliveryDate].map(norm).join('|');
    const count = Number(row.mergedRowCount) || 1;
    const old = groups.get(key);
    if (!old) {
      groups.set(key, {
        ...row,
        orderedQuantity: number(row.orderedQuantity),
        receivedQuantity: number(row.receivedQuantity),
        mergedRowCount: count,
        note: count > 1 ? `Gộp ${count} dòng` : ''
      });
      continue;
    }
    old.orderedQuantity += number(row.orderedQuantity);
    old.receivedQuantity += number(row.receivedQuantity);
    old.mergedRowCount += count;
    old.note = `Gộp ${old.mergedRowCount} dòng`;
  }
  const merged = [...groups.values()].map((row, index) => {
    const shortageQuantity = Math.max(number(row.orderedQuantity) - number(row.receivedQuantity), 0);
    return { ...row, shortageQuantity, isShortage: shortageQuantity > 0, originalOrder: index };
  }).sort((a, b) => Number(b.isShortage) - Number(a.isShortage) || a.originalOrder - b.originalOrder)
    .map(({ originalOrder, ...row }) => row);
  ensureTotals('Nhập Kho', rows, merged, ['orderedQuantity', 'receivedQuantity']);
  return merged;
}

function mergePurchaseRows(rows) {
  const groups = new Map();
  for (const row of rows || []) {
    const key = [row.projectCode, row.itemCode].map(norm).join('|');
    const group = groups.get(key) || {
      ...row, quantity: 0, mergedRowCount: 0,
      purchaseOrders: [], sourceFiles: [], sourceRows: [], sourceLocations: []
    };
    group.quantity += number(row.quantity);
    group.mergedRowCount += Number(row.mergedRowCount) || 1;
    if (!group.itemName && row.itemName) group.itemName = row.itemName;
    if (!group.marker && row.marker) group.marker = row.marker;
    if (row.purchaseOrder && !group.purchaseOrders.includes(row.purchaseOrder)) group.purchaseOrders.push(row.purchaseOrder);
    if (row.sourceFile && !group.sourceFiles.includes(row.sourceFile)) group.sourceFiles.push(row.sourceFile);
    if (row.sourceRow !== undefined && row.sourceRow !== '' && !group.sourceRows.includes(row.sourceRow)) group.sourceRows.push(row.sourceRow);
    const locations = row.sourceLocations?.length
      ? row.sourceLocations
      : (row.sourceFile || row.sourceRow !== undefined ? [{ sourceFile: row.sourceFile || '', sourceRow: row.sourceRow ?? '' }] : []);
    for (const location of locations) {
      const label = typeof location === 'string'
        ? location
        : [location.sourceFile, location.sourceSheet ? `[${location.sourceSheet}]` : '', location.sourceRow !== '' ? `dòng ${location.sourceRow}` : ''].filter(Boolean).join(' ');
      if (label && !group.sourceLocations.includes(label)) group.sourceLocations.push(label);
    }
    groups.set(key, group);
  }
  const merged = [...groups.values()].map(group => {
    const note = group.mergedRowCount > 1
      ? `Gộp ${group.mergedRowCount} dòng${group.sourceLocations.length ? `: ${group.sourceLocations.join('; ')}` : ''}`
      : '';
    return {
      ...group,
      purchaseOrder: group.purchaseOrders.join('; '),
      sourceFile: group.sourceFiles.join('; '),
      sourceRow: group.sourceRows.join(', '),
      note
    };
  }).map(({ purchaseOrders, sourceFiles, sourceRows, ...row }) => row);
  ensureTotals('Mua Hàng', rows || [], merged, ['quantity']);
  return merged;
}

async function processReference(source) {
  const { file, sheets } = sourceSpec(source);
  const candidates = [];
  for await (const ws of workbookSheets(file, sheets)) {
    let candidateHeader = null, candidateMap = null;
    const rows = [], details = [];
    for await (const excelRow of worksheetRows(ws)) {
      const r = rowData(excelRow);
      if (!candidateHeader) {
        if (r.rowNo <= 30 && isHeader(r, [['Code']])) { candidateHeader = r; candidateMap = headerMap(r); }
        continue;
      }
      const code = norm(getBy(candidateMap, r.values, ['Code']));
      if (code) { rows.push(code); details.push({ code, sourceFile: path.basename(file), sourceSheet: ws.name || '', sourceRow: r.rowNo }); }
    }
    if (candidateHeader) candidates.push({ name: ws.name || '', rows, details });
  }
  const selected = candidates.find(sheet => norm(sheet.name) === 'JOB CODE') || candidates[0];
  if (!selected) throw new Error('File tham chiếu không có sheet "Job Code" hoặc sheet có cột Code trong 30 dòng đầu.');
  const { rows, details } = selected;
  const counts = new Map();
  for (const code of rows) counts.set(code, (counts.get(code) || 0) + 1);
  for (const row of details) row.note = counts.get(row.code) > 1 ? `Trùng ${counts.get(row.code)} dòng` : '';
  const notes = [...counts].filter(([, count]) => count > 1).map(([code, count]) => [code, `Trùng ${count} dòng`]);
  return { rows, details, notes, warnings: [] };
}

async function processReferences(files) {
  const results = [];
  for (const source of files) results.push(await processReference(source));
  return {
    rows: results.flatMap(result => result.rows || []),
    details: results.flatMap(result => result.details || []),
    notes: results.flatMap(result => result.notes || []),
    warnings: results.flatMap(result => result.warnings || [])
  };
}

function sourceSpec(source) {
  if (typeof source === 'string') return { file: source, sheets: [] };
  return { file: source.path, sheets: source.sheets || [] };
}

function status(q, bom) { const d = q - bom; return { status: d === 0 ? 'Đủ' : d < 0 ? `Thiếu (${Math.abs(d)})` : `Thừa (${d})`, delta: d }; }
function candidate(target, rows, field) {
  let best = null;
  for (const row of rows) { const score = fuzz.ratio(norm(target), norm(row[field])); if (!best || score > best.score) best = { row, score }; }
  return best;
}

function sum(rows, field) { return rows.reduce((total, row) => total + number(row[field]), 0); }
const purchaseReplacementCache = new WeakMap();

function purchaseReplacementSignature(replacements) {
  return (replacements || []).map(replacement => [
    canonicalProject(replacement.projectCode), norm(replacement.oldCode), norm(replacement.newCode)
  ].join('|')).join('\n');
}

function applyPurchaseReplacements(rows, replacements) {
  const source = rows || [];
  if (!Array.isArray(rows) || !replacements?.length) return source;
  const signature = purchaseReplacementSignature(replacements);
  const cached = purchaseReplacementCache.get(rows);
  if (cached?.signature === signature) return cached.rows;
  const byKey = new Map(source.map(row => [sourceItemKey(row.projectCode, row.itemCode), row]));
  const oldKeys = new Set(), aliasesByTarget = new Map();
  for (const replacement of replacements || []) {
    const oldKey = sourceItemKey(replacement.projectCode, replacement.oldCode);
    const targetKey = sourceItemKey(replacement.projectCode, replacement.newCode);
    const oldRow = byKey.get(oldKey), targetRow = byKey.get(targetKey);
    if (!oldRow || !targetRow || oldKey === targetKey) continue;
    oldKeys.add(oldKey);
    if (!aliasesByTarget.has(targetKey)) aliasesByTarget.set(targetKey, []);
    aliasesByTarget.get(targetKey).push(oldRow);
  }
  const result = source.filter(row => !oldKeys.has(sourceItemKey(row.projectCode, row.itemCode))).map(row => {
    const aliases = aliasesByTarget.get(sourceItemKey(row.projectCode, row.itemCode)) || [];
    if (!aliases.length) return row;
    return {
      ...row,
      originalItemCode: aliases.map(item => clean(item.itemCode)).filter(Boolean).join('; '),
      originalPurchaseOrder: aliases.map(item => clean(item.purchaseOrder)).filter(Boolean).join('; '),
      replacementPurchaseOrder: clean(row.purchaseOrder)
    };
  });
  purchaseReplacementCache.set(rows, { signature, rows:result });
  return result;
}
function uniqueBy(rows, field) {
  const found = new Map();
  for (const row of rows) if (!found.has(norm(row[field]))) found.set(norm(row[field]), row);
  return [...found.values()];
}
function dateSortValue(value) {
  const match = clean(value).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : '';
}
function latestWarehouseDate(rows) {
  return rows.map(row => clean(row.deliveryDate)).filter(Boolean)
    .sort((a, b) => dateSortValue(b).localeCompare(dateSortValue(a)))[0] || '';
}
function supplierSummary(rows, purchaseQuantity, scanQuantity) {
  const suppliers = new Map();
  for (const row of rows) {
    const label = clean(row.supplier) || '(Không có NCC)';
    const current = suppliers.get(norm(label)) || { label, ordered: 0, received: 0 };
    current.ordered += number(row.orderedQuantity);
    current.received += number(row.receivedQuantity);
    suppliers.set(norm(label), current);
  }
  const purchase = number(purchaseQuantity), scan = number(scanQuantity);
  if (!suppliers.size) return `Không có NCC: đã mua:${purchase}, đã nhập kho:0, đã quét mã:${scan}`;
  const entries = [...suppliers.values()];
  const totalOrdered = entries.reduce((total, entry) => total + entry.ordered, 0);
  let allocated = 0;
  return entries.map(({ label, ordered, received }, index) => {
    const bought = entries.length === 1
      ? purchase
      : index === entries.length - 1
        ? purchase - allocated
        : quantityRound(totalOrdered ? purchase * ordered / totalOrdered : purchase / entries.length);
    allocated += bought;
    return `${label}: đã mua:${quantityRound(bought)}, đã nhập kho:${received}, đã quét mã:${scan}`;
  }).join('; ');
}

function quantityRound(value) {
  return Math.round(number(value) * 1000000) / 1000000;
}

function quantityComparisonNote(purchaseQuantity, warehouseQuantity, scanQuantity) {
  const purchase = number(purchaseQuantity), warehouse = number(warehouseQuantity), scan = number(scanQuantity);
  const delta = scan - purchase;
  if (Math.abs(delta) < 1e-8) return 'Đủ: số lượng quét mã bằng số lượng mua hàng';
  if (delta > 0) return `Thừa ${delta}: số lượng quét mã lớn hơn số lượng mua hàng`;
  return `Thiếu ${Math.abs(delta)}: số lượng quét mã thấp hơn số lượng mua hàng; đã nhập kho ${warehouse}/${purchase}`;
}

const comparisonScanCache = new WeakMap();
const comparisonSourceCache = new WeakMap();
const candidateOptionsCache = new WeakMap();

function aggregateScansForComparison(scans) {
  if (Array.isArray(scans) && comparisonScanCache.has(scans)) return comparisonScanCache.get(scans);
  const groups = new Map();
  for (const row of scans || []) {
    const key = [canonicalProject(row.projectCode), norm(row.drawingCode)].join('|');
    const group = groups.get(key) || { ...row, projectCode: canonicalProject(row.projectCode), quantity: 0, manufacturers: [], scanDates: [] };
    group.quantity += number(row.quantity);
    const manufacturer = clean(row.manufacturer);
    const scanDate = clean(row.scanDate);
    if (manufacturer && !group.manufacturers.some(value => norm(value) === norm(manufacturer))) group.manufacturers.push(manufacturer);
    if (scanDate && !group.scanDates.includes(scanDate)) group.scanDates.push(scanDate);
    groups.set(key, group);
  }
  const aggregated = [...groups.values()].map(group => ({
    ...group,
    manufacturer: group.manufacturers.join('; '),
    scanDate: group.scanDates.join('; ')
  })).map(({ manufacturers, scanDates, ...row }) => row);
  ensureTotals('So Sánh Quét Mã', scans || [], aggregated, ['quantity']);
  if (Array.isArray(scans)) comparisonScanCache.set(scans, aggregated);
  return aggregated;
}

function candidateOptions(target, rows, field) {
  let cache = candidateOptionsCache.get(rows);
  if (!cache) {
    cache = new Map();
    candidateOptionsCache.set(rows, cache);
  }
  const cacheKey = `${field}|${norm(target)}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);
  const options = uniqueBy(rows, field).map(row => ({ code: norm(row[field]), score: fuzz.ratio(norm(target), norm(row[field])) }))
    .sort((a, b) => b.score - a.score).slice(0, 8);
  cache.set(cacheKey, options);
  return options;
}

function matchSource(source, scan, rows, field, threshold, decisions, confirmationThreshold) {
  const drawingCode = norm(scan.drawingCode);
  const options = candidateOptions(scan.drawingCode, rows, field);
  const exact = options.find(option => option.code === drawingCode);
  if (exact) return { code: exact.code, score: 100, kind: 'exact', options:[exact] };
  const best = options[0];
  if (!best) return { code:'', score:0, kind:'different', options:[] };
  const decisionKey = `${source}|${canonicalProject(scan.projectCode)}|${drawingCode}|${best.code}`;
  const decision = decisions.get(decisionKey);
  const action = typeof decision === 'object' ? decision.action : decision;
  if (action === 'matched') return { code: norm(decision.code || best.code), score: options.find(option => option.code === norm(decision.code))?.score || best.score, kind: 'confirmed', decisionId:decisionKey, options };
  if (action === 'ignored') return { code: '', score: best.score, kind: 'ignored', decisionId:decisionKey, options };
  if (best.score >= threshold) return { code: best.code, score: best.score, kind: 'auto', decisionId:decisionKey, options };
  if (best.score < confirmationThreshold) return { code:'', score:best.score, kind:'different', decisionId:decisionKey, options };
  return { code: '', score: best.score, kind: 'pending', decisionId:decisionKey, options };
}

function comparisonMatchStatus(purchaseMatch, warehouseMatch) {
  const matches = [purchaseMatch, warehouseMatch];
  if (matches.some(match => match.kind === 'pending')) return 'Cần xác nhận';
  if (matches.some(match => match.kind === 'ignored')) return 'Đã bỏ qua';
  if (matches.some(match => match.kind === 'different')) return 'Mã khác nhau';
  const missing = [];
  if (purchaseMatch.kind === 'missing') missing.push('Mua Hàng');
  if (warehouseMatch.kind === 'missing') missing.push('Nhập Kho');
  if (missing.length) return `Không tìm thấy ${missing.join(' và ')}`;
  if (matches.some(match => match.kind === 'confirmed')) return 'Đã xác nhận';
  if (matches.some(match => match.kind === 'auto')) {
    const score = Math.min(...matches.filter(match => match.kind === 'auto').map(match => match.score));
    return `Ghép gần đúng (${score}%)`;
  }
  return 'Khớp chính xác';
}

function buildComparison(purchases, scans, warehouse, threshold = 95, decisions = new Map(), confirmationThreshold = 70, purchaseReplacements = []) {
  const comparison = [], review = [];
  const usedPurchaseKeys = new Set(), usedWarehouseKeys = new Set(), reservedPurchaseKeys = new Set(), reservedWarehouseKeys = new Set();
  let id = 1;
  const comparisonScans = aggregateScansForComparison(scans);
  const comparisonPurchases = applyPurchaseReplacements(purchases, purchaseReplacements);
  const purchaseIndex = comparisonSourceIndex(comparisonPurchases);
  const warehouseIndex = comparisonSourceIndex(warehouse);
  const scanProjects = new Set(comparisonScans.map(scan => canonicalProject(scan.projectCode)).filter(Boolean));
  for (const scan of comparisonScans) {
    const project = canonicalProject(scan.projectCode);
    const projectPurchases = purchaseIndex.byProject.get(project) || [];
    const projectWarehouse = warehouseIndex.byProject.get(project) || [];
    const purchaseMatch = matchSource('Mua Hàng', scan, projectPurchases, 'itemCode', threshold, decisions, confirmationThreshold);
    const warehouseMatch = matchSource('Nhập Kho', scan, projectWarehouse, 'itemCode', threshold, decisions, confirmationThreshold);
    if (['exact','auto','confirmed'].includes(purchaseMatch.kind)) usedPurchaseKeys.add(sourceItemKey(project, purchaseMatch.code));
    if (['exact','auto','confirmed'].includes(warehouseMatch.kind)) usedWarehouseKeys.add(sourceItemKey(project, warehouseMatch.code));
    if (purchaseMatch.kind === 'pending') purchaseMatch.options.forEach(option => reservedPurchaseKeys.add(sourceItemKey(project, option.code)));
    if (warehouseMatch.kind === 'pending') warehouseMatch.options.forEach(option => reservedWarehouseKeys.add(sourceItemKey(project, option.code)));
    if ([purchaseMatch, warehouseMatch].some(match => ['pending','missing','ignored'].includes(match.kind))) {
      const confirmationStatus = [purchaseMatch, warehouseMatch].some(match => ['pending','missing'].includes(match.kind)) ? 'Chờ xác nhận' : 'Đã bỏ qua';
      review.push({
        id:`${project}|${norm(scan.drawingCode)}`, projectCode:scan.projectCode, scanDrawingCode:scan.drawingCode,
        purchaseDecisionId:['pending','missing','ignored'].includes(purchaseMatch.kind) ? purchaseMatch.decisionId : '', purchaseKind:purchaseMatch.kind,
        purchaseCandidateCode:purchaseMatch.code || purchaseMatch.options[0]?.code || '', purchaseScore:purchaseMatch.score, purchaseOptions:purchaseMatch.options,
        warehouseDecisionId:['pending','missing','ignored'].includes(warehouseMatch.kind) ? warehouseMatch.decisionId : '', warehouseKind:warehouseMatch.kind,
        warehouseCandidateCode:warehouseMatch.code || warehouseMatch.options[0]?.code || '', warehouseScore:warehouseMatch.score, warehouseOptions:warehouseMatch.options,
        status:confirmationStatus
      });
    }
    const matchedPurchases = purchaseMatch.code ? projectPurchases.filter(row => norm(row.itemCode) === purchaseMatch.code) : [];
    const matchedWarehouse = warehouseMatch.code ? projectWarehouse.filter(row => norm(row.itemCode) === warehouseMatch.code) : [];
    const scanQuantity = number(scan.quantity);
    const purchaseQuantity = sum(matchedPurchases, 'quantity');
    const warehouseQuantity = sum(matchedWarehouse, 'receivedQuantity');
    const matchStatus = comparisonMatchStatus(purchaseMatch, warehouseMatch);
    const comparisonReady = [purchaseMatch, warehouseMatch].every(match => ['exact', 'auto', 'confirmed', 'ignored', 'different'].includes(match.kind));
    const scanResult = comparisonReady ? status(scanQuantity, purchaseQuantity) : null;
    const warehouseResult = comparisonReady ? status(warehouseQuantity, purchaseQuantity) : null;
    const supplier = [...new Set(matchedWarehouse.map(row => clean(row.supplier)).filter(Boolean))].join('; ');
    const supplierNote = supplierSummary(matchedWarehouse, purchaseQuantity, scanQuantity);
    const quantityNote = comparisonReady
      ? quantityComparisonNote(purchaseQuantity, warehouseQuantity, scanQuantity)
      : `Cần xác nhận đối chiếu mã: ${matchStatus}`;
    const changedPurchase = matchedPurchases.find(row => clean(row.originalItemCode));
    comparison.push({
      stt: id++, projectCode: scan.projectCode, drawingCode: scan.drawingCode,
      purchaseOrder: matchedPurchases.map(row => clean(row.purchaseOrder)).filter(Boolean).join('; '),
      originalItemCode: changedPurchase?.originalItemCode || '', replacementItemCode: changedPurchase?.itemCode || '',
      originalPurchaseOrder: changedPurchase?.originalPurchaseOrder || '', replacementPurchaseOrder: changedPurchase?.replacementPurchaseOrder || '',
      itemName: matchedPurchases.find(row => clean(row.itemName))?.itemName || matchedWarehouse.find(row => clean(row.itemName))?.itemName || '',
      scanQuantity, warehouseQuantity, purchaseQuantity,
      warehouseStatus: warehouseResult?.status || 'Cần xác nhận', scanStatus: scanResult?.status || 'Cần xác nhận',
      warehouseDelta: warehouseResult?.delta ?? null, scanDelta: scanResult?.delta ?? null,
      quantityNote, supplierNote,
      note: `${quantityNote}\n${supplierNote}`,
      supplier,
      maker: scan.manufacturer || '',
      scanDate: scan.scanDate || '', warehouseDate: latestWarehouseDate(matchedWarehouse),
      matchStatus
    });
  }
  const purchaseGroups = purchaseIndex.groups;
  const warehouseGroups = warehouseIndex.groups;
  const remainingKeys = new Set();
  for (const project of scanProjects) {
    for (const row of purchaseIndex.byProject.get(project) || []) remainingKeys.add(sourceItemKey(project, row.itemCode));
    for (const row of warehouseIndex.byProject.get(project) || []) remainingKeys.add(sourceItemKey(project, row.itemCode));
  }
  const handledRemainingKeys = new Set();
  for (const key of remainingKeys) {
    if (handledRemainingKeys.has(key)) continue;
    const keyProject = key.split('|', 1)[0];
    if (!scanProjects.has(keyProject)) continue;
    const purchaseRows = usedPurchaseKeys.has(key) || reservedPurchaseKeys.has(key) ? [] : (purchaseGroups.get(key) || []);
    let warehouseRows = usedWarehouseKeys.has(key) || reservedWarehouseKeys.has(key) ? [] : (warehouseGroups.get(key) || []);
    if (purchaseRows.length && !warehouseRows.length) {
      const purchaseCode = norm(purchaseRows[0].itemCode);
      const aliasKeys = warehouseIndex.itemNameKeys.get(`${keyProject}|${purchaseCode}`) || [];
      const aliases = [...aliasKeys].map(warehouseKey => [warehouseKey, warehouseGroups.get(warehouseKey) || []]).filter(([warehouseKey]) =>
        !handledRemainingKeys.has(warehouseKey)
        && !usedWarehouseKeys.has(warehouseKey)
        && !reservedWarehouseKeys.has(warehouseKey)
      );
      if (aliases.length === 1) {
        handledRemainingKeys.add(aliases[0][0]);
        warehouseRows = aliases[0][1];
      }
    }
    if (!purchaseRows.length && !warehouseRows.length) continue;
    const sourceRow = purchaseRows[0] || warehouseRows[0];
    const changedPurchase = purchaseRows.find(row => clean(row.originalItemCode));
    const purchaseQuantity = sum(purchaseRows, 'quantity');
    const warehouseQuantity = sum(warehouseRows, 'receivedQuantity');
    const supplier = [...new Set(warehouseRows.map(row => clean(row.supplier)).filter(Boolean))].join('; ');
    const supplierNote = supplierSummary(warehouseRows, purchaseQuantity, 0);
    const hasPurchasedQuantity = purchaseQuantity > 0;
    const hasWarehouseQuantity = warehouseQuantity > 0;
    const quantityNote = hasPurchasedQuantity && hasWarehouseQuantity
      ? 'Chưa xuất: đã có dữ liệu mua hàng và nhập kho nhưng chưa có dữ liệu quét mã'
      : hasPurchasedQuantity
        ? 'Hàng chưa về: số lượng nhập kho bằng 0 và chưa có dữ liệu quét mã'
        : hasWarehouseQuantity
          ? 'Thiếu dữ liệu mua hàng và quét mã; đã có dữ liệu nhập kho'
          : 'Không có số lượng mua hàng, nhập kho và quét mã';
    const warehouseResult = status(warehouseQuantity, purchaseQuantity);
    comparison.push({
      stt:id++, projectCode:canonicalProject(sourceRow.projectCode), drawingCode:sourceRow.itemCode,
      purchaseOrder:purchaseRows.map(row => clean(row.purchaseOrder)).filter(Boolean).join('; '),
      originalItemCode:changedPurchase?.originalItemCode || '', replacementItemCode:changedPurchase?.itemCode || '',
      originalPurchaseOrder:changedPurchase?.originalPurchaseOrder || '', replacementPurchaseOrder:changedPurchase?.replacementPurchaseOrder || '',
      supplier, itemName:purchaseRows.find(row => clean(row.itemName))?.itemName || warehouseRows.find(row => clean(row.itemName))?.itemName || '',
      scanQuantity:0, warehouseQuantity, purchaseQuantity,
      warehouseStatus:warehouseResult.status, scanStatus:purchaseQuantity > 0 ? `Thiếu (${purchaseQuantity})` : 'Không có dữ liệu quét mã',
      warehouseDelta:warehouseResult.delta, scanDelta:-purchaseQuantity,
      quantityNote, supplierNote, note:`${quantityNote}\n${supplierNote}`,
      maker:'', scanDate:'', warehouseDate:latestWarehouseDate(warehouseRows),
      matchStatus:'Không có trong file Quét Mã', missingScan:Boolean(purchaseRows.length || warehouseRows.length)
    });
  }
  const classified = comparison.filter(row => Number.isFinite(row.scanDelta));
  const shortage = classified.filter(row => row.missingScan || row.scanDelta < 0);
  const excess = classified.filter(row => !row.missingScan && row.scanDelta > 0);
  const enough = classified.filter(row => !row.missingScan && row.scanDelta === 0);
  return { comparison, review: review.sort((a,b) => Number(a.status === 'Đã bỏ qua')-Number(b.status === 'Đã bỏ qua') || Math.max(b.purchaseScore,b.warehouseScore)-Math.max(a.purchaseScore,a.warehouseScore)), enough, shortage, excess, decisions };
}

function sourceItemKey(project, itemCode) {
  return `${canonicalProject(project)}|${norm(itemCode)}`;
}

function groupSourceItems(rows) {
  const groups = new Map();
  for (const row of rows || []) {
    const key = sourceItemKey(row.projectCode, row.itemCode);
    if (!canonicalProject(row.projectCode) || !norm(row.itemCode)) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return groups;
}

function comparisonSourceIndex(rows) {
  if (Array.isArray(rows) && comparisonSourceCache.has(rows)) return comparisonSourceCache.get(rows);
  const byProject = new Map(), itemNameKeys = new Map();
  for (const row of rows || []) {
    const project = canonicalProject(row.projectCode);
    if (!project) continue;
    if (!byProject.has(project)) byProject.set(project, []);
    byProject.get(project).push(row);
    const itemName = norm(row.itemName), itemKey = sourceItemKey(project, row.itemCode);
    if (itemName && norm(row.itemCode)) {
      const lookupKey = `${project}|${itemName}`;
      if (!itemNameKeys.has(lookupKey)) itemNameKeys.set(lookupKey, new Set());
      itemNameKeys.get(lookupKey).add(itemKey);
    }
  }
  const index = { byProject, groups: groupSourceItems(rows), itemNameKeys };
  if (Array.isArray(rows)) comparisonSourceCache.set(rows, index);
  return index;
}

function resolveReview(session, { id, action, code, items, threshold, confirmationThreshold }) {
  const decisions = session.decisions || new Map();
  const updates = items?.length ? items : [{ id, code }];
  for (const item of updates) if (item.id) {
    const itemAction = item.action || action;
    if (itemAction === 'reset') decisions.delete(item.id);
    else decisions.set(item.id, itemAction === 'match' ? { action:'matched', code:item.code } : { action:'ignored' });
  }
  return buildComparison(session.purchase, session.scans, session.warehouse, threshold, decisions, confirmationThreshold, session.purchaseReplacements);
}
function warning(source, projectCodeValue, original, note, file='') { return { source, projectCode: projectCodeValue, original, note, sourceFile: path.basename(file) }; }

function validateProjectCodes(session) {
  const valid = new Set((session.jobCodes || []).map(norm));
  if (!valid.size) return [];
  const configs = [
    ['Mua Hàng', session.purchase || [], r => r.purchaseOrder],
    ['Quét Mã', session.scans || [], r => r.drawingCode],
    ['Nhập Kho', session.warehouse || [], r => r.itemCode]
  ];
  const out = [];
  for (const [source, rows, original] of configs) for (const r of rows) {
    const code = norm(r.projectCode);
    if (!code || !valid.has(code)) out.push(warning(source, code || '(không trích xuất được)', original(r), 'Không tìm thấy trong Job Code', r.sourceFile));
  }
  return out;
}

function filterPurchasesByProjectPrefix(rows) {
  const valid = [], warnings = [];
  for (const row of rows || []) {
    const code = norm(row.projectCode);
    if (/^(MEC|AUT)/.test(code)) { valid.push(row); continue; }
    const note = !code
      ? 'Không trích xuất được mã dự án MEC... hoặc AUT...'
      : 'Mã dự án không bắt đầu bằng MEC hoặc AUT';
    warnings.push({ ...row, source: 'Mua Hàng', projectCode: code || '', original: row.purchaseOrder || row.itemCode, note });
  }
  return { valid, warnings };
}

function prioritizeProjectWarnings(rows) {
  return (rows || []).map((row, index) => ({ row, index })).sort((a, b) => {
    const aPriority = /^(MEC|AUT)/i.test(clean(a.row.projectCode)) ? 0 : 1;
    const bPriority = /^(MEC|AUT)/i.test(clean(b.row.projectCode)) ? 0 : 1;
    return aPriority - bPriority || a.index - b.index;
  }).map(item => item.row);
}

module.exports = { processFiles, listWorkbookSheets, buildComparison, resolveReview, validateProjectCodes, filterPurchasesByProjectPrefix, prioritizeProjectWarnings, mergePurchaseRows, mergeWarehouseRows, quantityComparisonNote, parseUsDate, parseDmyDate, parseScanMarker, projectCode, norm };
