const fs = require('fs/promises');
const path = require('path');
const DatabaseDriver = require('better-sqlite3');

const SCHEMA_VERSION = 1;
const DATASETS = {
  purchases: { file:'purchases.json', table:'purchases' },
  purchaseRaw: { file:'purchase-raw.json', table:'purchase_raw' },
  scans: { file:'scans.json', table:'scans' },
  scanRaw: { file:'scan-raw.json', table:'scan_raw' },
  warehouse: { file:'warehouse.json', table:'warehouse' },
  warehouseRaw: { file:'warehouse-raw.json', table:'warehouse_raw' },
  workshop: { file:'workshop.json', table:'workshop' },
  workshopRaw: { file:'workshop-raw.json', table:'workshop_raw' },
  jobCodes: { file:'job-codes.json', table:'job_codes' },
  jobRaw: { file:'job-codes-raw.json', table:'job_codes_raw' },
  replacements: { file:'purchase-code-replacements.json', table:'purchase_code_replacements' },
  workingSession: { file:'working-session.json', table:'working_session' },
  sourceArchives: { file:'source-archives.json', table:'source_archives' }
};

function text(value) { return String(value ?? '').trim(); }
function norm(value) { return text(value).toUpperCase(); }
function jsonEqual(a, b) { return JSON.stringify(a ?? null) === JSON.stringify(b ?? null); }

class Database {
  constructor(dir) {
    this.dir = dir;
    this.dbFile = path.join(dir, 'app.sqlite');
    this.legacyBackupDir = path.join(dir, 'legacy-json-backup');
    this.backupDir = path.join(dir, 'backups');
    this.originalDir = path.join(dir, 'original-files');
    this.archiveManifestFile = path.join(dir, 'source-archives.json');
    this.closed = false;
    this.db = null;
  }

  async init() {
    if (this.db && !this.closed) return this;
    await Promise.all([
      fs.mkdir(this.dir, { recursive:true }),
      fs.mkdir(this.backupDir, { recursive:true }),
      fs.mkdir(this.originalDir, { recursive:true })
    ]);
    if (!(await this.exists(this.dbFile))) {
      const backups = await this.backupEntries();
      const legacy = await this.hasLegacyBackup();
      if (backups.length && !(await this.restoreNewestBackup())) {
        throw new Error('Không tìm thấy cơ sở dữ liệu SQLite hợp lệ để khôi phục từ thư mục backups.');
      }
      if (legacy && !(await this.exists(this.dbFile))) throw new Error('Cơ sở dữ liệu SQLite chưa được khởi tạo nhưng vẫn còn dữ liệu JSON cũ trong legacy-json-backup.');
      if (!(await this.exists(this.dbFile))) await this.migrateLegacyFiles();
    } else if (!(await this.isValidDatabase(this.dbFile))) {
      if (!(await this.restoreNewestBackup())) {
        throw new Error('Cơ sở dữ liệu SQLite bị hỏng và không có backup hợp lệ để khôi phục.');
      }
    }
    this.open();
    this.ensureSchema();
    return this;
  }

  async exists(file) { try { await fs.access(file); return true; } catch { return false; } }

  async hasLegacyBackup() {
    try { return (await fs.readdir(this.legacyBackupDir)).length > 0; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  }

  async isValidDatabase(file) {
    let snapshot;
    try {
      snapshot = new DatabaseDriver(file, { readonly:true });
      return snapshot.pragma('integrity_check', { simple:true }) === 'ok';
    } catch { return false; }
    finally { try { snapshot?.close(); } catch {} }
  }

  async backupEntries() {
    let names;
    try { names = await fs.readdir(this.backupDir); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    return names.filter(name => /^data-.+\.sqlite$/i.test(name)).sort().reverse();
  }

  async restoreNewestBackup() {
    for (const fileName of await this.backupEntries()) {
      const source = path.join(this.backupDir, fileName);
      if (!(await this.isValidDatabase(source))) continue;
      const temp = `${this.dbFile}.recovery.tmp`;
      await fs.copyFile(source, temp);
      if (await this.exists(this.dbFile)) {
        const damaged = `${this.dbFile}.corrupted-${Date.now()}`;
        await fs.rename(this.dbFile, damaged);
      }
      await fs.rename(temp, this.dbFile);
      return true;
    }
    return false;
  }

  open() {
    if (this.db) return;
    this.db = new DatabaseDriver(this.dbFile);
    this.closed = false;
    this.db.pragma('journal_mode = DELETE');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('busy_timeout = 5000');
    this.db.pragma('foreign_keys = ON');
  }

  ensureOpen() {
    if (!this.db || this.closed) throw new Error('Cơ sở dữ liệu đã đóng.');
  }

  ensureSchema() {
    this.ensureOpen();
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS purchases (id INTEGER PRIMARY KEY, record_key TEXT NOT NULL UNIQUE, row_json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS purchase_raw (id INTEGER PRIMARY KEY, record_key TEXT NOT NULL UNIQUE, row_json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS scans (id INTEGER PRIMARY KEY, record_key TEXT NOT NULL UNIQUE, row_json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS scan_raw (id INTEGER PRIMARY KEY, record_key TEXT NOT NULL UNIQUE, row_json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS warehouse (id INTEGER PRIMARY KEY, record_key TEXT NOT NULL UNIQUE, row_json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS warehouse_raw (id INTEGER PRIMARY KEY, record_key TEXT NOT NULL UNIQUE, row_json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS workshop (id INTEGER PRIMARY KEY, record_key TEXT NOT NULL UNIQUE, row_json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS workshop_raw (id INTEGER PRIMARY KEY, record_key TEXT NOT NULL UNIQUE, row_json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS job_codes (id INTEGER PRIMARY KEY, record_key TEXT NOT NULL UNIQUE, row_json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS job_codes_raw (id INTEGER PRIMARY KEY, record_key TEXT NOT NULL UNIQUE, row_json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS purchase_code_replacements (id INTEGER PRIMARY KEY, record_key TEXT NOT NULL UNIQUE, row_json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS source_archives (id INTEGER PRIMARY KEY, record_key TEXT NOT NULL UNIQUE, row_json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS working_session (id INTEGER PRIMARY KEY CHECK(id = 1), record_key TEXT NOT NULL UNIQUE, row_json TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS purchases_key_index ON purchases(record_key);
      CREATE INDEX IF NOT EXISTS purchase_raw_key_index ON purchase_raw(record_key);
      CREATE INDEX IF NOT EXISTS scans_key_index ON scans(record_key);
      CREATE INDEX IF NOT EXISTS scan_raw_key_index ON scan_raw(record_key);
      CREATE INDEX IF NOT EXISTS warehouse_key_index ON warehouse(record_key);
      CREATE INDEX IF NOT EXISTS workshop_key_index ON workshop(record_key);
      INSERT INTO meta(key, value) VALUES ('schema_version', '${SCHEMA_VERSION}') ON CONFLICT(key) DO UPDATE SET value=excluded.value;
    `);
  }

  async migrateLegacyFiles() {
    const present = [];
    for (const item of Object.values(DATASETS)) if (await this.exists(path.join(this.dir, item.file))) present.push(item);
    if (!present.length) return;
    const tempFile = `${this.dbFile}.tmp`;
    await fs.rm(tempFile, { force:true });
    const temp = new DatabaseDriver(tempFile);
    try {
      temp.pragma('journal_mode = DELETE');
      temp.exec(`
        CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE purchases (id INTEGER PRIMARY KEY, record_key TEXT NOT NULL UNIQUE, row_json TEXT NOT NULL);
        CREATE TABLE purchase_raw (id INTEGER PRIMARY KEY, record_key TEXT NOT NULL UNIQUE, row_json TEXT NOT NULL);
        CREATE TABLE scans (id INTEGER PRIMARY KEY, record_key TEXT NOT NULL UNIQUE, row_json TEXT NOT NULL);
        CREATE TABLE scan_raw (id INTEGER PRIMARY KEY, record_key TEXT NOT NULL UNIQUE, row_json TEXT NOT NULL);
        CREATE TABLE warehouse (id INTEGER PRIMARY KEY, record_key TEXT NOT NULL UNIQUE, row_json TEXT NOT NULL);
        CREATE TABLE warehouse_raw (id INTEGER PRIMARY KEY, record_key TEXT NOT NULL UNIQUE, row_json TEXT NOT NULL);
        CREATE TABLE workshop (id INTEGER PRIMARY KEY, record_key TEXT NOT NULL UNIQUE, row_json TEXT NOT NULL);
        CREATE TABLE workshop_raw (id INTEGER PRIMARY KEY, record_key TEXT NOT NULL UNIQUE, row_json TEXT NOT NULL);
        CREATE TABLE job_codes (id INTEGER PRIMARY KEY, record_key TEXT NOT NULL UNIQUE, row_json TEXT NOT NULL);
        CREATE TABLE job_codes_raw (id INTEGER PRIMARY KEY, record_key TEXT NOT NULL UNIQUE, row_json TEXT NOT NULL);
        CREATE TABLE purchase_code_replacements (id INTEGER PRIMARY KEY, record_key TEXT NOT NULL UNIQUE, row_json TEXT NOT NULL);
        CREATE TABLE source_archives (id INTEGER PRIMARY KEY, record_key TEXT NOT NULL UNIQUE, row_json TEXT NOT NULL);
        CREATE TABLE working_session (id INTEGER PRIMARY KEY CHECK(id = 1), record_key TEXT NOT NULL UNIQUE, row_json TEXT NOT NULL);
      `);
      const insert = table => temp.prepare(`INSERT INTO ${table}(record_key, row_json) VALUES (?, ?) ON CONFLICT(record_key) DO UPDATE SET row_json=excluded.row_json`);
      for (const item of present) {
        const value = JSON.parse(await fs.readFile(path.join(this.dir, item.file), 'utf8'));
        if (item.table === 'working_session') {
          insert(item.table).run('singleton', JSON.stringify(value || {}));
          continue;
        }
        const rows = Array.isArray(value) ? value : [];
        const statement = insert(item.table);
        const transaction = temp.transaction(() => {
          for (const row of rows) {
            const key = this.legacyKey(item.table, row);
            statement.run(key, JSON.stringify(row));
          }
        });
        transaction();
      }
      temp.prepare(`INSERT INTO meta(key,value) VALUES ('schema_version',?),('migrated_at',?)`).run(String(SCHEMA_VERSION), new Date().toISOString());
      if (temp.prepare("PRAGMA integrity_check").pluck().get() !== 'ok') throw new Error('Kiểm tra integrity SQLite sau migration thất bại.');
      temp.close();
      await fs.rename(tempFile, this.dbFile);
      await fs.mkdir(this.legacyBackupDir, { recursive:true });
      for (const item of present) {
        const source = path.join(this.dir, item.file);
        const target = path.join(this.legacyBackupDir, item.file);
        await fs.rm(target, { force:true });
        await fs.rename(source, target);
      }
    } catch (error) {
      try { temp.close(); } catch {}
      await fs.rm(tempFile, { force:true });
      throw new Error(`Không thể chuyển dữ liệu JSON sang SQLite: ${error.message}`);
    }
  }

  legacyKey(table, row) {
    if (table === 'purchases') return this.purchaseKey(row);
    if (table === 'scans') return this.datasetKey(row, ['projectCode','drawingCode','manufacturer','scanDate']);
    if (table === 'warehouse') return this.datasetKey(row, ['projectCode','itemCode','supplier','poNumber','dueDate','deliveryDate']);
    if (table === 'workshop') return this.datasetKey(row, ['projectCode','itemCode','purchaseRequest','poNumber','dueDate','deliveryDate']);
    if (table === 'purchase_code_replacements') return this.datasetKey(row, ['projectCode','oldCode']);
    if (table === 'job_codes') return norm(typeof row === 'string' ? row : row?.code);
    if (table.endsWith('_raw')) return this.rawKey(row);
    if (table === 'source_archives') return JSON.stringify(row);
    return 'singleton';
  }

  tableRows(table) {
    this.ensureOpen();
    return this.db.prepare(`SELECT row_json FROM ${table} ORDER BY id`).all().map(row => JSON.parse(row.row_json));
  }

  read(file, fallback = []) {
    const item = Object.values(DATASETS).find(value => value.file === path.basename(file));
    if (!item) return Promise.reject(new Error(`Không hỗ trợ đọc file dữ liệu: ${file}`));
    if (item.table === 'working_session') return this.readWorkingSession();
    return Promise.resolve(this.tableRows(item.table));
  }

  rawKey(row) {
    const file = norm(row?.sourceFile);
    const sheet = norm(row?.sourceSheet);
    const sourceRow = row?.sourceRow ?? '';
    return file || sheet || sourceRow !== '' ? `${file}|${sheet}|${sourceRow}` : JSON.stringify(row);
  }

  datasetKey(row, fields) { return fields.map(field => norm(row?.[field])).join('|'); }
  purchaseKey(row) { return this.datasetKey(row, ['purchaseOrder','itemCode']); }

  upsert(table, key, row) {
    this.ensureOpen();
    this.db.prepare(`INSERT INTO ${table}(record_key,row_json) VALUES (?,?) ON CONFLICT(record_key) DO UPDATE SET row_json=excluded.row_json`).run(key, JSON.stringify(row));
  }

  async readPurchases() { return this.tableRows('purchases'); }
  async readScans() { return this.tableRows('scans'); }
  async readWarehouse() { return this.tableRows('warehouse'); }
  async readWorkshop() { return this.tableRows('workshop'); }
  async readJobCodes() { return this.tableRows('job_codes').map(row => typeof row === 'string' ? row : row.code); }
  async readRawPurchases() { return this.tableRows('purchase_raw'); }
  async readRawScans() { return this.tableRows('scan_raw'); }
  async readRawWarehouse() { return this.tableRows('warehouse_raw'); }
  async readRawWorkshop() { return this.tableRows('workshop_raw'); }
  async readRawJobCodes() { return this.tableRows('job_codes_raw'); }
  async readPurchaseReplacements() { return this.tableRows('purchase_code_replacements'); }
  async readSourceArchives() { return this.tableRows('source_archives'); }

  async readWorkingSession() {
    this.ensureOpen();
    const row = this.db.prepare("SELECT row_json FROM working_session WHERE id=1").get();
    return row ? JSON.parse(row.row_json) : {};
  }

  writeWorkingSession(value) {
    this.ensureOpen();
    this.db.prepare(`INSERT INTO working_session(id,record_key,row_json) VALUES (1,'singleton',?) ON CONFLICT(id) DO UPDATE SET row_json=excluded.row_json`).run(JSON.stringify(value || {}));
    return Promise.resolve(value || {});
  }

  async savePurchaseReplacement(projectCode, oldCode, newCode) {
    const project = norm(projectCode), oldItemCode = norm(oldCode), newItemCode = norm(newCode);
    if (!project || !oldItemCode || !newItemCode) throw new Error('Cần nhập đủ mã dự án, mã cũ và mã mới.');
    if (oldItemCode === newItemCode) throw new Error('Mã mới phải khác mã cũ.');
    const replacement = { projectCode:project, oldCode:oldItemCode, newCode:newItemCode, updatedAt:new Date().toISOString() };
    this.upsert('purchase_code_replacements', `${project}|${oldItemCode}`, replacement);
    return this.readPurchaseReplacements();
  }

  async deletePurchaseReplacement(projectCode, oldCode) {
    this.db.prepare('DELETE FROM purchase_code_replacements WHERE record_key=?').run(`${norm(projectCode)}|${norm(oldCode)}`);
    return this.readPurchaseReplacements();
  }

  writeRawPurchases(rows) { return this.replaceRows('purchase_raw', rows || []); }
  writeRawJobCodes(rows) { return this.replaceRows('job_codes_raw', rows || []); }

  replaceRows(table, rows) {
    this.ensureOpen();
    const statement = this.db.prepare(`INSERT INTO ${table}(record_key,row_json) VALUES (?,?) ON CONFLICT(record_key) DO UPDATE SET row_json=excluded.row_json`);
    const transaction = this.db.transaction(() => {
      this.db.prepare(`DELETE FROM ${table}`).run();
      for (const row of rows) statement.run(this.legacyKey(table, row), JSON.stringify(row));
    });
    transaction();
    return Promise.resolve(rows);
  }

  async mergeRaw(file, incoming) {
    const table = Object.values(DATASETS).find(item => item.file === path.basename(file))?.table || file;
    const statement = this.db.prepare(`INSERT INTO ${table}(record_key,row_json) VALUES (?,?) ON CONFLICT(record_key) DO UPDATE SET row_json=excluded.row_json`);
    const remove = this.db.prepare(`DELETE FROM ${table} WHERE record_key=?`);
    const transaction = this.db.transaction(() => {
      for (const row of incoming || []) {
        if (row.sourceSheet) remove.run(`${norm(row.sourceFile)}||${row.sourceRow ?? ''}`);
        statement.run(this.rawKey(row), JSON.stringify(row));
      }
    });
    transaction();
    return this.tableRows(table);
  }

  mergeRawPurchases(rows) { return this.mergeRaw('purchase-raw.json', rows); }
  mergeRawScans(rows) { return this.mergeRaw('scan-raw.json', rows); }
  mergeRawWarehouse(rows) { return this.mergeRaw('warehouse-raw.json', rows); }
  mergeRawWorkshop(rows) { return this.mergeRaw('workshop-raw.json', rows); }
  mergeRawJobCodes(rows) { return this.mergeRaw('job-codes-raw.json', rows); }

  async archiveSourceFiles(kind, filePaths) {
    if (!['purchase','reference'].includes(kind)) return [];
    const targetDir = path.join(this.originalDir, kind === 'purchase' ? 'purchase' : 'job-code');
    await fs.mkdir(targetDir, { recursive:true });
    const importedAt = new Date().toISOString();
    const stamp = importedAt.replace(/[:.]/g, '-');
    const archived = [];
    for (let index = 0; index < filePaths.length; index++) {
      const sourcePath = filePaths[index];
      const safeName = path.basename(sourcePath).replace(/[^\p{L}\p{N}._ -]/gu, '_');
      const targetPath = path.join(targetDir, `${stamp}-${index + 1}-${safeName}`);
      await fs.copyFile(sourcePath, targetPath);
      archived.push({ kind, originalName:path.basename(sourcePath), archivedPath:targetPath, importedAt });
    }
    const statement = this.db.prepare(`INSERT INTO source_archives(record_key,row_json) VALUES (?,?) ON CONFLICT(record_key) DO UPDATE SET row_json=excluded.row_json`);
    const transaction = this.db.transaction(() => archived.forEach(row => statement.run(JSON.stringify(row), JSON.stringify(row))));
    transaction();
    return archived;
  }

  async mergeJobCodes(incoming) {
    const statement = this.db.prepare(`INSERT OR IGNORE INTO job_codes(record_key,row_json) VALUES (?,?)`);
    let added = 0, unchanged = 0;
    const transaction = this.db.transaction(() => {
      for (const rawCode of incoming || []) {
        const code = norm(rawCode);
        if (!code) continue;
        const result = statement.run(code, JSON.stringify(code));
        if (result.changes) added++; else unchanged++;
      }
    });
    transaction();
    const rows = await this.readJobCodes();
    return { rows, stats:{ loaded:(incoming || []).length, added, unchanged, total:rows.length } };
  }

  async mergePurchases(incoming) {
    const imported = new Map();
    for (const row of incoming || []) {
      const key = this.purchaseKey(row);
      const location = [row.sourceFile, row.sourceSheet ? `[${row.sourceSheet}]` : '', row.sourceRow !== undefined && row.sourceRow !== '' ? `dòng ${row.sourceRow}` : ''].filter(Boolean).join(' ');
      const current = imported.get(key);
      if (!current) {
        imported.set(key, { ...row, quantity:Number(row.quantity) || 0, remainingQuantities:row.remainingQuantity ? [row.remainingQuantity] : [], mergedRowCount:Number(row.mergedRowCount) || 1, sourceLocations:row.sourceLocations?.length ? [...row.sourceLocations] : (location ? [location] : []), suppliers:row.supplier ? [row.supplier] : [] });
        continue;
      }
      current.quantity += Number(row.quantity) || 0;
      if (row.remainingQuantity && !current.remainingQuantities.includes(row.remainingQuantity)) current.remainingQuantities.push(row.remainingQuantity);
      current.mergedRowCount += Number(row.mergedRowCount) || 1;
      if (row.supplier && !current.suppliers.some(value => norm(value) === norm(row.supplier))) current.suppliers.push(row.supplier);
      if (location && !current.sourceLocations.includes(location)) current.sourceLocations.push(location);
    }
    const groupedIncoming = [...imported.values()].map(row => ({ ...row, supplier:row.suppliers.join('; '), remainingQuantity:row.remainingQuantities.join('; '), note:row.mergedRowCount > 1 ? `Gộp ${row.mergedRowCount} dòng${row.sourceLocations.length ? `: ${row.sourceLocations.join('; ')}` : ''}` : (row.note || '') })).map(({ suppliers, remainingQuantities, ...row }) => row);
    const incomingTotal = (incoming || []).reduce((total, row) => total + (Number(row.quantity) || 0), 0);
    const groupedTotal = groupedIncoming.reduce((total, row) => total + (Number(row.quantity) || 0), 0);
    if (Math.abs(incomingTotal - groupedTotal) > 1e-8) throw new Error(`Mua Hàng: tổng số lượng trước và sau khi lưu không khớp (${incomingTotal} / ${groupedTotal}).`);
    const existing = new Map(this.tableRows('purchases').map(row => [this.purchaseKey(row), row]));
    let added = 0, updated = 0, unchanged = 0;
    for (const row of groupedIncoming) {
      const old = existing.get(this.purchaseKey(row));
      if (!old) added++;
      else if (['projectCode','purchaseOrder','itemCode','itemName','marker','supplier','quantity','remainingQuantity','mergedRowCount','note'].some(field => old[field] !== row[field])) updated++;
      else unchanged++;
    }
    const deduplicated = this.tableRows('purchases').length - existing.size;
    if (added || updated || deduplicated) await this.backup();
    const transaction = this.db.transaction(() => {
      for (const row of groupedIncoming) {
        const key = this.purchaseKey(row), old = existing.get(key);
        if (!old) { this.upsert('purchases', key, row); existing.set(key, row); }
        else if (['projectCode','purchaseOrder','itemCode','itemName','marker','supplier','quantity','remainingQuantity','mergedRowCount','note'].some(field => old[field] !== row[field])) this.upsert('purchases', key, { ...old, ...row, previousQuantity:old.quantity, updatedAt:new Date().toISOString() });
      }
    });
    transaction();
    const rows = await this.readPurchases();
    return { rows, stats:{ loaded:(incoming || []).length, added, updated, unchanged, total:rows.length } };
  }

  async mergeDataset(file, incoming, keyFields, compareFields) {
    const table = file;
    const key = row => this.datasetKey(row, keyFields);
    const existing = new Map(this.tableRows(table).map(row => [key(row), row]));
    let added = 0, updated = 0, unchanged = 0;
    const transaction = this.db.transaction(() => {
      for (const row of incoming || []) {
        const rowKey = key(row), old = existing.get(rowKey);
        if (!old) { this.upsert(table, rowKey, row); existing.set(rowKey, row); added++; }
        else if (compareFields.some(field => !jsonEqual(old[field], row[field]))) { this.upsert(table, rowKey, { ...old, ...row, updatedAt:new Date().toISOString() }); updated++; }
        else unchanged++;
      }
    });
    transaction();
    const rows = this.tableRows(table);
    return { rows, stats:{ loaded:(incoming || []).length, added, updated, unchanged, total:rows.length } };
  }

  mergeScans(rows) { return this.mergeDataset('scans', rows, ['projectCode','drawingCode','manufacturer','scanDate'], ['quantity','warehouseDate','receiptCode','reference','scanDateSort','manualReview']); }

  async mergeWarehouse(rows) {
    const incoming = rows || [];
    const legacyKey = row => this.datasetKey(row, ['projectCode','itemCode','supplier','dueDate','deliveryDate']);
    const incomingByLegacyKey = new Map();
    for (const row of incoming) { const key = legacyKey(row); if (!incomingByLegacyKey.has(key)) incomingByLegacyKey.set(key, []); incomingByLegacyKey.get(key).push(row); }
    const existing = this.tableRows('warehouse');
    for (const row of existing) {
      if (text(row.poNumber)) continue;
      const candidates = incomingByLegacyKey.get(legacyKey(row)) || [];
      const poNumbers = [...new Set(candidates.map(candidate => text(candidate.poNumber)).filter(Boolean))];
      if (poNumbers.length === 1) {
        this.db.prepare('DELETE FROM warehouse WHERE record_key=?').run(this.datasetKey(row, ['projectCode','itemCode','supplier','poNumber','dueDate','deliveryDate']));
        this.upsert('warehouse', this.datasetKey({ ...row, poNumber:poNumbers[0] }, ['projectCode','itemCode','supplier','poNumber','dueDate','deliveryDate']), { ...row, poNumber:poNumbers[0] });
      }
    }
    return this.mergeDataset('warehouse', incoming, ['projectCode','itemCode','supplier','poNumber','dueDate','deliveryDate'], ['projectName','itemName','orderedQuantity','receivedQuantity','mergedRowCount','note']);
  }

  mergeWorkshop(rows) { return this.mergeDataset('workshop', rows, ['projectCode','itemCode','purchaseRequest','poNumber','dueDate','deliveryDate'], ['projectName','itemName','prDate','orderedQuantity','receivedQuantity','mergedRowCount','note']); }

  async listBackups() {
    const entries = [];
    for (const fileName of await this.backupEntries()) {
      const file = path.join(this.backupDir, fileName);
      let stat;
      try { stat = await fs.stat(file); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      entries.push({ fileName, createdAt:stat.mtime.toISOString(), size:stat.size, valid:await this.isValidDatabase(file) });
    }
    return entries;
  }

  async restoreBackup(fileName) {
    this.ensureOpen();
    if (typeof fileName !== 'string' || path.basename(fileName) !== fileName || !/^data-.+\.sqlite$/i.test(fileName)) throw new Error('Tên file backup không hợp lệ.');
    const source = path.join(this.backupDir, fileName);
    if (!(await this.exists(source))) throw new Error('Không tìm thấy file backup này.');
    if (!(await this.isValidDatabase(source))) throw new Error('File backup bị hỏng hoặc không hợp lệ.');
    await this.backup();
    const staged = `${this.dbFile}.restore.tmp`;
    const previous = `${this.dbFile}.restore.previous`;
    await fs.rm(staged, { force:true });
    await fs.rm(previous, { force:true });
    await fs.copyFile(source, staged);
    await this.close();
    try {
      await fs.rename(this.dbFile, previous);
      await fs.rename(staged, this.dbFile);
      this.open();
      this.ensureSchema();
      await fs.rm(previous, { force:true });
    } catch (error) {
      try { await this.close(); } catch {}
      await fs.rm(this.dbFile, { force:true });
      if (await this.exists(previous)) await fs.rename(previous, this.dbFile);
      this.open();
      this.ensureSchema();
      await fs.rm(staged, { force:true });
      throw new Error(`Không thể khôi phục backup: ${error.message}`);
    }
    return { fileName };
  }

  async backup() {
    this.ensureOpen();
    const stamp = `${new Date().toISOString().replace(/[:.]/g, '-')}-${process.hrtime.bigint().toString(36)}`;
    const target = path.join(this.backupDir, `data-${stamp}.sqlite`);
    await this.db.backup(target);
    const snapshot = new DatabaseDriver(target, { readonly:true });
    try {
      if (snapshot.pragma('integrity_check', { simple:true }) !== 'ok') throw new Error('Kiểm tra integrity snapshot SQLite thất bại.');
    } finally { snapshot.close(); }
    const entries = (await fs.readdir(this.backupDir)).filter(name => name.endsWith('.sqlite')).sort().reverse();
    for (const old of entries.slice(14)) await fs.rm(path.join(this.backupDir, old), { force:true });
    return target;
  }

  async clearWorkingSession() {
    const state = await this.readWorkingSession();
    const persistentState = {
      sources:(state.sources || []).filter(source => ['warehouse','workshop'].includes(source.kind)),
      formatWarnings:(state.formatWarnings || []).filter(warning => ['Nhập Kho','Xưởng Gia Công'].includes(warning.source)),
      autoThreshold:state.autoThreshold,
      confirmationThreshold:state.confirmationThreshold
    };
    const transaction = this.db.transaction(() => {
      this.db.prepare('DELETE FROM scans').run();
      this.db.prepare('DELETE FROM scan_raw').run();
      this.db.prepare('DELETE FROM working_session').run();
      this.db.prepare(`INSERT INTO working_session(id,record_key,row_json) VALUES (1,'singleton',?)`).run(JSON.stringify(persistentState));
    });
    transaction();
  }

  async backupAndClear() {
    await this.backup();
    const transaction = this.db.transaction(() => {
      for (const table of ['purchases','purchase_raw','purchase_code_replacements','scans','scan_raw','warehouse','warehouse_raw','workshop','workshop_raw','working_session']) this.db.prepare(`DELETE FROM ${table}`).run();
    });
    transaction();
  }

  async close() {
    if (!this.db || this.closed) return;
    try { this.db.pragma('wal_checkpoint(TRUNCATE)'); } catch {}
    this.db.close();
    this.db = null;
    this.closed = true;
  }
}

module.exports = { Database, SCHEMA_VERSION };
