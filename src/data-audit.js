function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function clean(value) {
  return String(value || '').trim();
}

function sameQuantity(a, b) {
  return Math.abs(number(a) - number(b)) < 1e-8;
}

function norm(value) {
  return clean(value).toUpperCase();
}

function baseCode(value) {
  const code = norm(value);
  return code.endsWith('_GC') ? code.slice(0, -3) : code;
}

function sourceRows(session, detailKey, mergedKey) {
  const details = session?.[detailKey] || [];
  return details.length ? details : (session?.[mergedKey] || []);
}

function loadedOccurrences(session) {
  const configs = [
    ['purchase','Mua Hàng',sourceRows(session, 'purchaseDetails', 'purchase'),'itemCode','quantity'],
    ['scan','Quét Mã',sourceRows(session, 'scanDetails', 'scans'),'drawingCode','quantity'],
    ['warehouse','Nhập Kho',sourceRows(session, 'warehouseDetails', 'warehouse'),'itemCode','receivedQuantity'],
    ['workshop','Xưởng Gia Công',sourceRows(session, 'workshopDetails', 'workshop'),'itemCode','receivedQuantity']
  ];
  const rows = [];
  for (const [source, sourceLabel, data, codeField, quantityField] of configs) for (const row of data) {
    const code = clean(row[codeField]);
    if (!code) continue;
    rows.push({
      source, sourceLabel, projectCode:clean(row.projectCode), code,
      file:clean(row.sourceFile) || '(Dữ liệu đã lưu)', sheet:clean(row.sourceSheet),
      row:row.sourceRow ?? '', quantity:number(row[quantityField])
    });
  }
  return rows;
}

function occurrenceIndex(session) {
  const index = new Map();
  for (const row of loadedOccurrences(session)) {
    const key = `${norm(row.projectCode)}|${baseCode(row.code)}`;
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(row);
  }
  return index;
}

function findOccurrences(index, projectCode, code, sources) {
  if (!clean(code)) return [];
  const allowed = new Set(sources);
  return (index.get(`${norm(projectCode)}|${baseCode(code)}`) || []).filter(row => allowed.has(row.source));
}

function locationText(rows) {
  const locations = rows.map(row => `${row.file}${row.sheet ? ` [${row.sheet}]` : ''}${row.row !== '' ? ` dòng ${row.row}` : ''}`);
  return [...new Set(locations)].join(' • ');
}

function matchDescription(row) {
  const kinds = [row.purchaseMatchKind, row.warehouseMatchKind].filter(Boolean);
  const scores = [row.purchaseMatchScore, row.warehouseMatchScore].filter(value => Number.isFinite(Number(value)));
  if (row.missingScan) return 'Không có trong file Quét Mã';
  if (kinds.includes('pending')) return 'Đang chờ xác nhận mã';
  if (kinds.includes('ignored')) return 'Đã bỏ qua ứng viên ghép';
  if (kinds.includes('different')) return 'Không tìm thấy mã tương ứng';
  if (kinds.includes('confirmed')) return 'Đã xác nhận thủ công';
  if (kinds.includes('auto') && scores.some(score => Number(score) < 100)) return `Tự ghép gần đúng (${Math.min(...scores)}%)`;
  if (kinds.includes('auto')) return 'Tự ghép theo hậu tố _GC';
  return 'Khớp chính xác';
}

function auditRow(row, index, locations) {
  const purchase = number(row.purchaseQuantity);
  const scan = number(row.scanQuantity);
  const receipt = number(row.warehouseQuantity);
  const matchKinds = [row.purchaseMatchKind, row.warehouseMatchKind].filter(Boolean);
  const fuzzy = matchKinds.includes('confirmed') || (matchKinds.includes('auto') && [row.purchaseMatchScore, row.warehouseMatchScore].some(score => Number(score) < 100));
  const invalidMatch = matchKinds.some(kind => ['pending','ignored','different','missing'].includes(kind));
  const noPurchase = purchase <= 1e-8;
  const noReceiptRecord = row.hasReceiptRecord === false;
  const reasons = [];

  if (row.missingScan) reasons.push('Không có dòng tương ứng trong file Quét Mã');
  if (noPurchase) reasons.push('Không có số lượng Mua Hàng làm chuẩn');
  if (invalidMatch) reasons.push(matchDescription(row));
  else if (fuzzy) reasons.push(matchDescription(row));
  if (!sameQuantity(scan, purchase)) reasons.push(`Quét Mã ${scan} / Mua Hàng ${purchase}`);
  if (!sameQuantity(receipt, purchase)) reasons.push(`Nhập Kho/XGC ${receipt} / Mua Hàng ${purchase}`);
  if (noReceiptRecord && clean(row.purchaseOrder)) reasons.push('Có PR nhưng không có mã trong Nhập Kho/XGC — PU Check');

  let auditStatus = 'KHỚP';
  if (noPurchase || invalidMatch || row.missingScan || fuzzy || noReceiptRecord) auditStatus = 'CẦN KIỂM TRA';
  else if (!sameQuantity(scan, purchase) || !sameQuantity(receipt, purchase)) auditStatus = 'CHÊNH LỆCH';

  return {
    stt:index + 1,
    auditStatus,
    projectCode:clean(row.projectCode),
    scanCode:clean(row.drawingCode),
    purchaseCode:clean(row.purchaseMatchedCode || row.replacementItemCode),
    receiptCode:clean(row.warehouseMatchedCode),
    receiptSource:clean(row.receiptSource),
    purchaseQuantity:purchase,
    scanQuantity:scan,
    receiptQuantity:receipt,
    matchMethod:matchDescription(row),
    reason:reasons.join('; ') || 'Mã và số lượng của ba nguồn đều khớp',
    purchaseOrder:clean(row.purchaseOrder),
    scanLocation:locationText(findOccurrences(locations, row.projectCode, row.drawingCode, ['scan'])),
    purchaseLocation:locationText(findOccurrences(locations, row.projectCode, row.purchaseMatchedCode || row.replacementItemCode, ['purchase'])),
    receiptLocation:locationText(findOccurrences(locations, row.projectCode, row.warehouseMatchedCode, ['warehouse','workshop']))
  };
}

function auditSessionData(session) {
  const comparison = session?.comparison || [];
  const locations = occurrenceIndex(session);
  const rows = comparison.map((row, index) => auditRow(row, index, locations));
  const counts = { matched:0, difference:0, review:0 };
  for (const row of rows) {
    if (row.auditStatus === 'KHỚP') counts.matched++;
    else if (row.auditStatus === 'CHÊNH LỆCH') counts.difference++;
    else counts.review++;
  }
  return {
    ready:comparison.length > 0,
    total:rows.length,
    ...counts,
    ok:comparison.length > 0 && counts.difference === 0 && counts.review === 0,
    checkedAt:new Date().toISOString(),
    rows
  };
}

function searchLoadedCode(session, projectCode, code) {
  const requestedCode = clean(code);
  if (!clean(projectCode) || !requestedCode) return { projectCode:clean(projectCode), code:requestedCode, total:0, sourceCount:0, duplicate:false, occurrences:[] };
  const rows = occurrenceIndex(session).get(`${norm(projectCode)}|${baseCode(requestedCode)}`) || [];
  const occurrences = rows.map(row => ({ ...row, matchType:norm(row.code) === norm(requestedCode) ? 'Trùng chính xác' : 'Tương ứng _GC' }));
  return {
    projectCode:clean(projectCode), code:requestedCode,
    total:occurrences.length,
    sourceCount:new Set(occurrences.map(row => row.source)).size,
    fileCount:new Set(occurrences.map(row => `${row.source}|${row.file}|${row.sheet}`)).size,
    duplicate:occurrences.length > 1,
    truncated:occurrences.length > 500,
    occurrences:occurrences.slice(0, 500)
  };
}

module.exports = { auditSessionData, searchLoadedCode };
