const fs = require('fs/promises');
const path = require('path');

class Database {
  constructor(dir) {
    this.dir = dir;
    this.purchaseFile = path.join(dir, 'purchases.json');
    this.scanFile = path.join(dir, 'scans.json');
    this.warehouseFile = path.join(dir, 'warehouse.json');
    this.jobFile = path.join(dir, 'job-codes.json');
    this.purchaseRawFile = path.join(dir, 'purchase-raw.json');
    this.scanRawFile = path.join(dir, 'scan-raw.json');
    this.warehouseRawFile = path.join(dir, 'warehouse-raw.json');
    this.purchaseReplacementFile = path.join(dir, 'purchase-code-replacements.json');
    this.jobRawFile = path.join(dir, 'job-codes-raw.json');
    this.workingSessionFile = path.join(dir, 'working-session.json');
    this.archiveManifestFile = path.join(dir, 'source-archives.json');
    this.backupDir = path.join(dir, 'backups');
    this.originalDir = path.join(dir, 'original-files');
  }
  async init() { await Promise.all([fs.mkdir(this.backupDir, { recursive: true }), fs.mkdir(this.originalDir, { recursive: true })]); }
  async read(file, fallback = []) { try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return fallback; throw e; } }
  async atomicWrite(file, value) { const temp = `${file}.tmp`; await fs.writeFile(temp, JSON.stringify(value, null, 2), 'utf8'); await fs.rename(temp, file); }
  readPurchases() { return this.read(this.purchaseFile); }
  readScans() { return this.read(this.scanFile); }
  readWarehouse() { return this.read(this.warehouseFile); }
  readJobCodes() { return this.read(this.jobFile); }
  readRawPurchases() { return this.read(this.purchaseRawFile); }
  readRawScans() { return this.read(this.scanRawFile); }
  readRawWarehouse() { return this.read(this.warehouseRawFile); }
  readRawJobCodes() { return this.read(this.jobRawFile); }
  readPurchaseReplacements() { return this.read(this.purchaseReplacementFile); }
  readWorkingSession() { return this.read(this.workingSessionFile, {}); }
  writeWorkingSession(value) { return this.atomicWrite(this.workingSessionFile, value || {}); }
  async savePurchaseReplacement(projectCode, oldCode, newCode) {
    const project = String(projectCode || '').trim().toUpperCase();
    const oldItemCode = String(oldCode || '').trim().toUpperCase();
    const newItemCode = String(newCode || '').trim().toUpperCase();
    if (!project || !oldItemCode || !newItemCode) throw new Error('Cần nhập đủ mã dự án, mã cũ và mã mới.');
    if (oldItemCode === newItemCode) throw new Error('Mã mới phải khác mã cũ.');
    const rows = await this.readPurchaseReplacements();
    const key = `${project}|${oldItemCode}`;
    const current = rows.find(row => `${String(row.projectCode || '').trim().toUpperCase()}|${String(row.oldCode || '').trim().toUpperCase()}` === key);
    const replacement = { projectCode:project, oldCode:oldItemCode, newCode:newItemCode, updatedAt:new Date().toISOString() };
    const updated = current
      ? rows.map(row => row === current ? { ...row, ...replacement } : row)
      : [...rows, replacement];
    await this.atomicWrite(this.purchaseReplacementFile, updated);
    return updated;
  }
  async deletePurchaseReplacement(projectCode, oldCode) {
    const project = String(projectCode || '').trim().toUpperCase();
    const oldItemCode = String(oldCode || '').trim().toUpperCase();
    const rows = await this.readPurchaseReplacements();
    const updated = rows.filter(row => String(row.projectCode || '').trim().toUpperCase() !== project || String(row.oldCode || '').trim().toUpperCase() !== oldItemCode);
    if (updated.length !== rows.length) await this.atomicWrite(this.purchaseReplacementFile, updated);
    return updated;
  }
  writeRawPurchases(rows) { return this.atomicWrite(this.purchaseRawFile, rows || []); }
  writeRawJobCodes(rows) { return this.atomicWrite(this.jobRawFile, rows || []); }
  rawKey(row) {
    const file = String(row.sourceFile || '').trim().toUpperCase();
    const sheet = String(row.sourceSheet || '').trim().toUpperCase();
    const sourceRow = row.sourceRow ?? '';
    return file || sheet || sourceRow !== '' ? `${file}|${sheet}|${sourceRow}` : JSON.stringify(row);
  }
  async mergeRaw(file, incoming) {
    const existing = await this.read(file);
    const map = new Map(existing.map(row => [this.rawKey(row), row]));
    for (const row of incoming || []) {
      if (row.sourceSheet) {
        const legacyKey = `${String(row.sourceFile || '').trim().toUpperCase()}||${row.sourceRow ?? ''}`;
        map.delete(legacyKey);
      }
      map.set(this.rawKey(row), row);
    }
    const rows = [...map.values()];
    await this.atomicWrite(file, rows);
    return rows;
  }
  mergeRawPurchases(rows) { return this.mergeRaw(this.purchaseRawFile, rows); }
  mergeRawScans(rows) { return this.mergeRaw(this.scanRawFile, rows); }
  mergeRawWarehouse(rows) { return this.mergeRaw(this.warehouseRawFile, rows); }
  mergeRawJobCodes(rows) { return this.mergeRaw(this.jobRawFile, rows); }
  writeJobCodes(codes) { return this.atomicWrite(this.jobFile, codes); }
  async archiveSourceFiles(kind, filePaths) {
    if (!['purchase', 'reference'].includes(kind)) return [];
    const targetDir = path.join(this.originalDir, kind === 'purchase' ? 'purchase' : 'job-code');
    await fs.mkdir(targetDir, { recursive: true });
    const importedAt = new Date().toISOString();
    const stamp = importedAt.replace(/[:.]/g, '-');
    const archived = [];
    for (let index = 0; index < filePaths.length; index++) {
      const sourcePath = filePaths[index];
      const safeName = path.basename(sourcePath).replace(/[^\p{L}\p{N}._ -]/gu, '_');
      const targetPath = path.join(targetDir, `${stamp}-${index + 1}-${safeName}`);
      await fs.copyFile(sourcePath, targetPath);
      archived.push({ kind, originalName: path.basename(sourcePath), archivedPath: targetPath, importedAt });
    }
    const manifest = await this.read(this.archiveManifestFile);
    await this.atomicWrite(this.archiveManifestFile, [...manifest, ...archived]);
    return archived;
  }
  async mergeJobCodes(incoming) {
    const existing = await this.readJobCodes();
    const map = new Map(existing.map(code => [String(code).trim().toUpperCase(), code]));
    let added = 0, unchanged = 0;
    for (const rawCode of incoming) {
      const code = String(rawCode || '').trim().toUpperCase();
      if (!code) continue;
      if (map.has(code)) unchanged++;
      else { map.set(code, code); added++; }
    }
    const rows = [...map.values()];
    if (added) await this.atomicWrite(this.jobFile, rows);
    return { rows, stats: { loaded: incoming.length, added, unchanged, total: rows.length } };
  }
  key(row) { return [row.purchaseOrder, row.itemCode].map(x => String(x || '').trim().toUpperCase()).join('|'); }
  async mergePurchases(incoming) {
    const imported = new Map();
    for (const row of incoming) {
      const key = this.key(row);
      const location = [row.sourceFile, row.sourceSheet ? `[${row.sourceSheet}]` : '', row.sourceRow !== undefined && row.sourceRow !== '' ? `dòng ${row.sourceRow}` : ''].filter(Boolean).join(' ');
      const current = imported.get(key);
      if (!current) {
        const mergedRowCount = Number(row.mergedRowCount) || 1;
        const sourceLocations = row.sourceLocations?.length ? [...row.sourceLocations] : (location ? [location] : []);
        imported.set(key, { ...row, quantity: Number(row.quantity) || 0, mergedRowCount, sourceLocations });
        continue;
      }
      current.quantity += Number(row.quantity) || 0;
      current.mergedRowCount += Number(row.mergedRowCount) || 1;
      if (location && !current.sourceLocations.includes(location)) current.sourceLocations.push(location);
    }
    const groupedIncoming = [...imported.values()].map(row => ({
      ...row,
      note: row.mergedRowCount > 1
        ? `Gộp ${row.mergedRowCount} dòng${row.sourceLocations.length ? `: ${row.sourceLocations.join('; ')}` : ''}`
        : (row.note || '')
    }));
    const incomingTotal = incoming.reduce((total, row) => total + (Number(row.quantity) || 0), 0);
    const groupedTotal = groupedIncoming.reduce((total, row) => total + (Number(row.quantity) || 0), 0);
    if (Math.abs(incomingTotal - groupedTotal) > 1e-8) {
      throw new Error(`Mua Hàng: tổng số lượng trước và sau khi lưu không khớp (${incomingTotal} / ${groupedTotal}).`);
    }
    const existing = await this.readPurchases();
    const map = new Map(existing.map(x => [this.key(x), x]));
    const deduplicated = existing.length - map.size;
    let added = 0, updated = 0, unchanged = 0;
    for (const row of groupedIncoming) {
      const key = this.key(row), old = map.get(key);
      if (!old) { map.set(key, row); added++; }
      else if (['projectCode','purchaseOrder','itemCode','itemName','marker','quantity','mergedRowCount','note'].some(field => old[field] !== row[field])) {
        map.set(key, { ...old, ...row, previousQuantity: old.quantity, updatedAt: new Date().toISOString() }); updated++;
      } else unchanged++;
    }
    const rows = [...map.values()];
    if (added || updated || deduplicated) { await this.backup(); await this.atomicWrite(this.purchaseFile, rows); }
    return { rows, stats: { loaded: incoming.length, added, updated, unchanged, total: rows.length } };
  }
  async mergeDataset(file, incoming, keyFields, compareFields) {
    const key = row => keyFields.map(field => String(row[field] ?? '').trim().toUpperCase()).join('|');
    const existing = await this.read(file);
    const map = new Map(existing.map(row => [key(row), row]));
    let added = 0, updated = 0, unchanged = 0;
    for (const row of incoming || []) {
      const rowKey = key(row), old = map.get(rowKey);
      if (!old) { map.set(rowKey, row); added++; }
      else if (compareFields.some(field => JSON.stringify(old[field] ?? null) !== JSON.stringify(row[field] ?? null))) {
        map.set(rowKey, { ...old, ...row, updatedAt:new Date().toISOString() }); updated++;
      } else unchanged++;
    }
    const rows = [...map.values()];
    if (added || updated) await this.atomicWrite(file, rows);
    return { rows, stats:{ loaded:(incoming || []).length, added, updated, unchanged, total:rows.length } };
  }
  mergeScans(rows) {
    return this.mergeDataset(this.scanFile, rows,
      ['projectCode','drawingCode','manufacturer','scanDate'],
      ['quantity','warehouseDate','receiptCode','reference','scanDateSort','manualReview']);
  }
  mergeWarehouse(rows) {
    return this.mergeDataset(this.warehouseFile, rows,
      ['projectCode','itemCode','supplier','dueDate','deliveryDate'],
      ['projectName','itemName','orderedQuantity','receivedQuantity','mergedRowCount','note']);
  }
  async backup() {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    for (const [file, name] of [[this.purchaseFile, 'purchases'], [this.warehouseFile, 'warehouse']]) {
      try { await fs.writeFile(path.join(this.backupDir, `${name}-${stamp}.json`), await fs.readFile(file)); }
      catch (e) { if (e.code !== 'ENOENT') throw e; }
    }
  }
  async clearWorkingSession() {
    const state = await this.readWorkingSession();
    const persistentState = {
      sources:(state.sources || []).filter(source => source.kind === 'warehouse'),
      formatWarnings:(state.formatWarnings || []).filter(warning => warning.source === 'Nhập Kho')
    };
    await Promise.all([
      this.atomicWrite(this.scanFile, []), this.atomicWrite(this.scanRawFile, []),
      this.atomicWrite(this.workingSessionFile, persistentState)
    ]);
  }
  async backupAndClear() {
    await this.backup();
    await Promise.all([
      this.atomicWrite(this.purchaseFile, []), this.atomicWrite(this.purchaseRawFile, []),
      this.atomicWrite(this.purchaseReplacementFile, []),
      this.atomicWrite(this.scanFile, []), this.atomicWrite(this.scanRawFile, []),
      this.atomicWrite(this.warehouseFile, []), this.atomicWrite(this.warehouseRawFile, []),
      this.atomicWrite(this.workingSessionFile, {})
    ]);
  }
}
module.exports = { Database };
