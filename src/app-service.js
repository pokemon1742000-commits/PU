const path = require('path');
const { Worker } = require('worker_threads');
const { buildComparison, resolveReview, filterPurchasesByProjectPrefix, prioritizeProjectWarnings, mergePurchaseRows, mergeWarehouseRows, mergeWorkshopRows } = require('./processor');
const { exportWorkbook } = require('./exporter');
const { Database } = require('./storage');

const DEFAULT_PAGE_SIZE = 100;

class AppService {
  constructor({ dataDir, rootDir, version }) {
    this.rootDir = rootDir;
    this.version = version;
    this.database = new Database(dataDir);
    this.session = this.emptySession();
    this.comparisonThreshold = 91;
    this.confirmationThreshold = 90;
    this.builtInJobCodeFile = path.join(rootDir, 'assets', 'MKAC Monthly Timesheet.xlsx');
    this.builtInJobCodeReference = null;
  }

  emptySession() {
    return { purchase:[], purchaseAll:[], purchaseDetails:[], purchaseReplacements:[], scans:[], scanDetails:[], warehouse:[], warehouseDetails:[], workshop:[], workshopDetails:[], comparisonWarehouse:[], comparison:[], review:[], warnings:[], formatWarnings:[], jobCodes:[], jobCodeDetails:[], jobCodeNotes:new Map(), decisions:new Map(), sources:[] };
  }

  async init() {
    await this.database.init();
    const [purchaseAll, purchaseDetails, purchaseReplacements, scans, scanDetails, warehouse, warehouseDetails, workshop, workshopDetails, workingSession, jobCodeReference] = await Promise.all([
      this.database.readPurchases(), this.database.readRawPurchases(), this.database.readPurchaseReplacements(),
      this.database.readScans(), this.database.readRawScans(), this.database.readWarehouse(), this.database.readRawWarehouse(),
      this.database.readWorkshop(), this.database.readRawWorkshop(), this.database.readWorkingSession(), this.readBuiltInJobCodeReference()
    ]);
    this.session = this.sessionWithBuiltInJobCodes({ ...this.session, purchaseAll, purchaseDetails, purchaseReplacements, scans, scanDetails, warehouse, warehouseDetails, workshop, workshopDetails, formatWarnings:workingSession.formatWarnings || [], sources:workingSession.sources || [], decisions:new Map(workingSession.decisions || []) }, jobCodeReference);
    this.refreshValidatedSession();
    this.autoCompareWhenReady();
    return this;
  }

  summary() {
    const counts = Object.fromEntries(['purchase','scans','warehouse','workshop','jobCodes','comparison','enough','shortage','excess','review','warnings'].map(key => [key, (this.session[key] || []).length]));
    counts.review = (this.session.review || []).filter(row => row.status === 'Chá» xÃ¡c nháº­n').length;
    return {
      counts,
      sources:this.session.sources,
      rawCounts:{ purchase:this.session.purchaseDetails.length, scan:this.session.scanDetails.length, warehouse:this.session.warehouseDetails.length, workshop:this.session.workshopDetails.length, jobCodes:this.session.jobCodeDetails.length, warnings:this.session.purchaseDetails.length },
      autoThreshold:this.comparisonThreshold,
      confirmationThreshold:this.confirmationThreshold,
      purchaseReplacements:this.session.purchaseReplacements,
      appVersion:this.version
    };
  }

  async inspectFiles(files) {
    const inspected = [];
    for (const file of files) inspected.push({ path:file.id, file:file.originalName, sheets:await this.inspectFileInWorker(file.path) });
    return { canceled:false, files:inspected };
  }

  async load(kind, selections) {
    if (!['purchase','scan','warehouse','workshop'].includes(kind)) throw new Error('Loáº¡i file khÃ´ng há»£p lá»‡.');
    const filePaths = selections.map(selection => selection.path);
    const result = await this.processFilesInWorker(kind, selections);
    if (kind === 'purchase') {
      const merged = await this.database.mergePurchases(result.rows);
      this.session.purchaseAll = merged.rows;
      this.session.purchaseDetails = await this.database.mergeRawPurchases(result.details || result.rows);
      await this.database.archiveSourceFiles(kind, filePaths);
      result.stats = merged.stats;
    } else if (kind === 'scan') {
      const merged = await this.database.mergeScans(result.rows);
      this.session.scans = merged.rows;
      this.session.scanDetails = await this.database.mergeRawScans(result.details || result.rows);
      result.stats = merged.stats;
    } else if (kind === 'warehouse') {
      const merged = await this.database.mergeWarehouse(result.rows);
      this.session.warehouse = merged.rows;
      this.session.warehouseDetails = await this.database.mergeRawWarehouse(result.details || result.rows);
      result.stats = merged.stats;
    } else {
      const merged = await this.database.mergeWorkshop(result.rows);
      this.session.workshop = merged.rows;
      this.session.workshopDetails = await this.database.mergeRawWorkshop(result.details || result.rows);
      result.stats = merged.stats;
    }
    this.session.formatWarnings.push(...(result.warnings || []));
    this.refreshValidatedSession();
    this.session.sources.push(...filePaths.map(file => ({ kind, file:path.basename(file), path:file, loadedAt:new Date().toISOString() })));
    await this.saveWorkingSession();
    this.autoCompareWhenReady();
    return { ...this.summary(), loadStats:result.stats || { loaded:result.rows.length } };
  }

  runComparison(settings) {
    const autoThreshold = typeof settings === 'object' ? settings.autoThreshold : settings;
    const confirmThreshold = typeof settings === 'object' ? settings.confirmationThreshold : this.confirmationThreshold;
    this.comparisonThreshold = Number(autoThreshold) || 91;
    this.confirmationThreshold = Math.max(0, Math.min(Number.isFinite(Number(confirmThreshold)) ? Number(confirmThreshold) : 90, this.comparisonThreshold - 1));
    this.session.comparisonWarehouse = this.comparisonWarehouseRows();
    Object.assign(this.session, buildComparison(this.session.purchase, this.session.scans, this.session.comparisonWarehouse, this.comparisonThreshold, this.session.decisions || new Map(), this.confirmationThreshold, this.session.purchaseReplacements));
    return this.summary();
  }

  async resolveReview(payload) {
    Object.assign(this.session, resolveReview(this.session, payload));
    await this.saveWorkingSession();
    return this.summary();
  }

  async savePurchaseReplacement(payload) {
      const projectCodes = [...new Set(String(payload?.projectCode || '').split(',').map(value => value.trim().toUpperCase()).filter(Boolean))];
    const oldCode = String(payload?.oldCode || '').trim().toUpperCase();
    const newCode = String(payload?.newCode || '').trim().toUpperCase();
      if (!projectCodes.length || !oldCode || !newCode) throw new Error('Cáº§n nháº­p Ä‘á»§ mÃ£ dá»± Ã¡n, mÃ£ cÅ© vÃ  mÃ£ má»›i.');
    if (oldCode === newCode) throw new Error('MÃ£ má»›i pháº£i khÃ¡c mÃ£ cÅ©.');
      for (const projectCode of projectCodes) {
        const projectRows = this.session.purchase.filter(row => String(row.projectCode || '').trim().toUpperCase() === projectCode);
        if (!projectRows.some(row => String(row.itemCode || '').trim().toUpperCase() === oldCode)) throw new Error(`KhÃ´ng tÃ¬m tháº¥y mÃ£ cÅ© ${oldCode} trong dá»± Ã¡n ${projectCode}.`);
        if (!projectRows.some(row => String(row.itemCode || '').trim().toUpperCase() === newCode)) throw new Error(`KhÃ´ng tÃ¬m tháº¥y PR cá»§a mÃ£ má»›i ${newCode} trong dá»± Ã¡n ${projectCode}.`);
      }
      for (const projectCode of projectCodes) this.session.purchaseReplacements = await this.database.savePurchaseReplacement(projectCode, oldCode, newCode);
    this.autoCompareWhenReady();
    return this.summary();
  }

  async deletePurchaseReplacement(payload) {
    this.session.purchaseReplacements = await this.database.deletePurchaseReplacement(payload?.projectCode, payload?.oldCode);
    this.autoCompareWhenReady();
    return this.summary();
  }

  rowsFor(name, options = {}) {
    const map = { purchase:this.session.purchase, scan:this.session.scans, warehouse:this.session.warehouse, workshop:this.session.workshop, comparison:this.session.comparison, enough:this.session.enough, shortage:this.session.shortage, excess:this.session.excess, review:this.session.review, warnings:this.session.warnings, sources:this.session.sources, purchaseDetails:this.session.purchaseDetails, scanDetails:this.session.scanDetails, warehouseDetails:this.session.warehouseDetails, workshopDetails:this.session.workshopDetails, jobCodeDetails:this.session.jobCodeDetails };
    let sourceRows = name === 'jobCodes' ? this.session.jobCodes.map(code => ({ code, note:this.session.jobCodeNotes.get(code) || '' })) : (map[name] || []);
    if (name === 'purchase') sourceRows = this.annotatePurchaseReplacements(sourceRows);
    if (name === 'warnings') sourceRows = prioritizeProjectWarnings(sourceRows);
    const query = String(options.query || '').trim().toLowerCase();
    const filtered = query ? sourceRows.filter(row => Object.values(row).some(value => String(value ?? '').toLowerCase().includes(query))) : sourceRows;
    const pageSize = Math.min(Math.max(Number(options.pageSize) || DEFAULT_PAGE_SIZE, 20), 2000);
    const total = filtered.length, totalPages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(Math.max(Number(options.page) || 1, 1), totalPages), start = (page - 1) * pageSize;
    const numbered = ['purchase','scan','warehouse','workshop','jobCodes','comparison','enough','shortage','excess','review','warnings','purchaseDetails','scanDetails','warehouseDetails','workshopDetails','jobCodeDetails'];
    const rows = filtered.slice(start, start + pageSize).map((row, index) => numbered.includes(name) ? { ...row, stt:start + index + 1 } : row);
    return { rows, page, pageSize, total, totalPages };
  }

  async clearSession() {
    await this.database.clearWorkingSession();
    const [purchaseAll, purchaseDetails, purchaseReplacements, warehouse, warehouseDetails, workshop, workshopDetails, workingSession, reference] = await Promise.all([
      this.database.readPurchases(), this.database.readRawPurchases(), this.database.readPurchaseReplacements(), this.database.readWarehouse(), this.database.readRawWarehouse(), this.database.readWorkshop(), this.database.readRawWorkshop(), this.database.readWorkingSession(), this.readBuiltInJobCodeReference()
    ]);
    this.session = this.sessionWithBuiltInJobCodes({ ...this.emptySession(), purchaseAll, purchaseDetails, purchaseReplacements, warehouse, warehouseDetails, workshop, workshopDetails, formatWarnings:workingSession.formatWarnings || [], sources:workingSession.sources || [] }, reference);
    this.refreshValidatedSession();
    return this.summary();
  }

  async deleteDatabase(keyword) {
    if (keyword !== 'XÃ“A') throw new Error('Tá»« khÃ³a xÃ¡c nháº­n khÃ´ng Ä‘Ãºng.');
    await this.database.backupAndClear();
    const [purchaseDetails, reference] = await Promise.all([this.database.readRawPurchases(), this.readBuiltInJobCodeReference()]);
    this.session = this.sessionWithBuiltInJobCodes({ ...this.emptySession(), purchaseDetails }, reference);
    this.refreshValidatedSession();
    return this.summary();
  }

  exportWorkbook(file) { return exportWorkbook(file, ['comparison'], this.session); }
  autoCompareWhenReady() { if (this.session.scans.length && (this.session.purchase.length || this.session.warehouse.length || this.session.workshop.length)) this.runComparison({ autoThreshold:this.comparisonThreshold, confirmationThreshold:this.confirmationThreshold }); }
  comparisonWarehouseRows() { return mergeWarehouseRows([...(this.session.warehouse || []), ...(this.session.workshop || [])]); }
  refreshValidatedSession() { const purchases = filterPurchasesByProjectPrefix(this.session.purchaseAll); this.session.purchase = mergePurchaseRows(purchases.valid); const warningSource = this.session.purchaseDetails.length ? this.session.purchaseDetails : this.session.purchaseAll; this.session.warnings = [...this.session.formatWarnings.filter(row => row.source === 'Mua HÃ ng'), ...filterPurchasesByProjectPrefix(warningSource).warnings]; }
  saveWorkingSession() { return this.database.writeWorkingSession({ sources:this.session.sources, formatWarnings:this.session.formatWarnings, decisions:[...(this.session.decisions || new Map()).entries()] }); }
  sessionWithBuiltInJobCodes(base, reference) { const details = this.annotateJobCodeDetails(reference.details || []); return { ...base, jobCodes:[...(reference.rows || [])], jobCodeDetails:details, jobCodeNotes:this.jobNotesFromDetails(details) }; }
  jobNotesFromDetails(rows) { const notes = new Map(); for (const row of rows || []) if (row.code && row.note) notes.set(row.code, row.note); return notes; }
  annotateJobCodeDetails(rows) { const counts = new Map(); for (const row of rows || []) if (row.code) counts.set(row.code, (counts.get(row.code) || 0) + 1); return (rows || []).map(row => ({ ...row, note:counts.get(row.code) > 1 ? `TrÃ¹ng ${counts.get(row.code)} dÃ²ng` : '' })); }
  annotatePurchaseReplacements(rows) { const rules = new Map((this.session.purchaseReplacements || []).map(rule => [`${rule.projectCode}|${rule.oldCode}`, rule])); const purchases = new Map((this.session.purchase || []).map(row => [`${String(row.projectCode || '').trim().toUpperCase()}|${String(row.itemCode || '').trim().toUpperCase()}`, row])); return (rows || []).map(row => { const project = String(row.projectCode || '').trim().toUpperCase(), itemCode = String(row.itemCode || '').trim().toUpperCase(), rule = rules.get(`${project}|${itemCode}`); if (!rule) return row; const replacement = purchases.get(`${project}|${rule.newCode}`); return { ...row, replacementCode:rule.newCode, replacementPurchaseOrder:replacement?.purchaseOrder || '' }; }); }

  readBuiltInJobCodeReference() { if (!this.builtInJobCodeReference) this.builtInJobCodeReference = this.processFilesInWorker('reference', [{ path:this.builtInJobCodeFile, sheets:['Job code'] }]).then(result => ({ rows:[...new Set(result.rows || [])], details:result.details || [] })).catch(error => { this.builtInJobCodeReference = null; throw new Error(`KhÃ´ng thá»ƒ Ä‘á»c file Job Code máº·c Ä‘á»‹nh: ${error.message}`); }); return this.builtInJobCodeReference; }
  async processFilesInWorker(kind, files) { const results = []; for (const source of files) results.push(await this.processSingleFileInWorker(kind, source)); return this.combineFileResults(kind, results); }
  processSingleFileInWorker(kind, source) { return this.runWorker({ kind, files:[source] }); }
  inspectFileInWorker(filePath) { return this.runWorker({ action:'inspect', filePath }); }
  runWorker(workerData) { return new Promise((resolve, reject) => { const worker = new Worker(path.join(this.rootDir, 'src', 'file-worker.js'), { workerData, resourceLimits:{ maxOldGenerationSizeMb:4096 } }); let settled = false; worker.once('message', message => { settled = true; message.ok ? resolve(message.result) : reject(new Error(message.error)); }); worker.once('error', error => { settled = true; reject(error); }); worker.once('exit', code => { if (!settled && code !== 0) reject(new Error(`Tiáº¿n trÃ¬nh Ä‘á»c Excel Ä‘Ã£ dá»«ng vá»›i mÃ£ lá»—i ${code}.`)); }); }); }
  combineFileResults(kind, results) { if (results.length === 1) return results[0]; const warnings = results.flatMap(result => result.warnings || []); if (kind === 'warehouse') return { rows:mergeWarehouseRows(results.flatMap(result => result.rows || [])), details:results.flatMap(result => result.details || []), warnings }; if (kind === 'workshop') return { rows:mergeWorkshopRows(results.flatMap(result => result.rows || [])), details:results.flatMap(result => result.details || []), warnings }; if (kind !== 'scan') return { rows:results.flatMap(result => result.rows || []), details:results.flatMap(result => result.details || []), warnings }; const groups = new Map(); for (const row of results.flatMap(result => result.rows || [])) { const key = [row.projectCode,row.drawingCode,row.manufacturer,row.scanDate].map(value => String(value || '').trim().toUpperCase()).join('|'), old = groups.get(key); if (!old) { const mergedRowCount = Number(row.mergedRowCount) || 1; groups.set(key, { ...row, mergedRowCount, note:mergedRowCount > 1 ? `Gá»™p ${mergedRowCount} dÃ²ng` : '', scanHistory:[...(row.scanHistory || [])] }); } else { old.quantity += Number(row.quantity) || 0; old.mergedRowCount += Number(row.mergedRowCount) || 1; old.note = old.mergedRowCount > 1 ? `Gá»™p ${old.mergedRowCount} dÃ²ng` : ''; old.scanHistory.push(...(row.scanHistory || [])); if (row.scanDate && (!old.scanDate || row.scanDate > old.scanDate)) old.scanDate = row.scanDate; } } return { rows:[...groups.values()], details:results.flatMap(result => result.details || []), warnings }; }
}

module.exports = { AppService };
