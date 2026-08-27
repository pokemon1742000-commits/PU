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

function auditRow(row, index) {
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
    purchaseOrder:clean(row.purchaseOrder)
  };
}

function auditSessionData(session) {
  const comparison = session?.comparison || [];
  const rows = comparison.map(auditRow);
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

module.exports = { auditSessionData };
