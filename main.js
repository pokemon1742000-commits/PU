const { app, BrowserWindow, dialog, ipcMain, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const fileSystem = require('fs');
const https = require('https');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { runFileParser } = require('./src/file-runner');
const { autoUpdater } = require('electron-updater');
const { buildComparison, resolveReview, filterPurchasesByProjectPrefix, prioritizeProjectWarnings, mergePurchaseRows, mergeWarehouseRows, mergeWorkshopRows } = require('./src/processor');
const { exportWorkbook, EXPORT_TYPES } = require('./src/exporter');
const { Database } = require('./src/storage');
const { runSelfCheck } = require('./src/self-check');
const { auditSessionData, searchLoadedCode } = require('./src/data-audit');
const { REPOSITORY, selectPreviousRelease, selectInstallerAsset } = require('./src/update-release');

let win;
let session = emptySession();
let database;
let isQuitting = false;
let comparisonThreshold = 91;
let confirmationThreshold = 90;
let mutationQueue = Promise.resolve();
let updateState = { status:'idle', operation:'update', message:'Sẵn sàng kiểm tra cập nhật', percent:0, currentVersion:app.getVersion() };
const DEFAULT_PAGE_SIZE = 100;
const BUILT_IN_JOB_CODE_FILE = path.join(app.isPackaged ? process.resourcesPath : __dirname, 'assets', 'MKAC Monthly Timesheet.xlsx');
let builtInJobCodeReference;

app.commandLine.appendSwitch('js-flags', '--max-old-space-size=4096');

function emptySession() {
  return { purchase: [], purchaseAll: [], purchaseDetails: [], purchaseReplacements: [], scans: [], scanDetails: [], warehouse: [], warehouseDetails: [], workshop: [], workshopDetails: [], comparisonWarehouse: [], comparison: [], dataAudit: [], review: [], warnings: [], formatWarnings: [], jobCodes: [], jobCodeDetails: [], jobCodeNotes: new Map(), decisions: new Map(), sources: [] };
}

function serializeMutation(task) {
  const next = mutationQueue.then(task, task);
  mutationQueue = next.catch(() => {});
  return next;
}

function applyThresholdSettings(settings = {}) {
  const auto = Number(settings.autoThreshold);
  comparisonThreshold = Number.isFinite(auto) && auto > 0 ? Math.min(auto, 100) : 91;
  const confirmation = Number(settings.confirmationThreshold);
  confirmationThreshold = Math.max(0, Math.min(Number.isFinite(confirmation) ? confirmation : 90, comparisonThreshold - 1));
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1050, minHeight: 680,
    backgroundColor: '#f4f1ea',
    icon: path.join(__dirname, 'assets', 'app-logo.png'),
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

async function initializeApplication() {
  database = database || new Database(path.join(app.getPath('userData'), 'data'));
  await database.init();
  const [purchaseAll, purchaseDetails, purchaseReplacements, scans, scanDetails, warehouse, warehouseDetails, workshop, workshopDetails, workingSession, jobCodeReference] = await Promise.all([
    database.readPurchases(), database.readRawPurchases(), database.readPurchaseReplacements(),
    database.readScans(), database.readRawScans(), database.readWarehouse(), database.readRawWarehouse(),
    database.readWorkshop(), database.readRawWorkshop(), database.readWorkingSession(), readBuiltInJobCodeReference()
  ]);
  applyThresholdSettings(workingSession);
  session = sessionWithBuiltInJobCodes({ ...session, purchaseAll, purchaseDetails, purchaseReplacements, scans, scanDetails, warehouse, warehouseDetails, workshop, workshopDetails, formatWarnings:workingSession.formatWarnings || [], sources:workingSession.sources || [], decisions:new Map(workingSession.decisions || []) }, jobCodeReference);
  refreshValidatedSession();
  autoCompareWhenReady();
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win || win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });
  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    await initializeApplication();
    configureAutoUpdater();
    registerIpc();
    createWindow();
    app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
  }).catch(async error => {
    if (error?.code === 'DATABASE_CORRUPT_NO_BACKUP') {
      const choice = dialog.showMessageBoxSync({
        type:'warning',
        buttons:['Tạo database mới','Thoát'],
        defaultId:1,
        cancelId:1,
        title:'Không thể khôi phục dữ liệu',
        message:'Cơ sở dữ liệu SQLite bị hỏng và không có backup hợp lệ.',
        detail:'Ứng dụng sẽ giữ nguyên file bị hỏng để bạn có thể phục hồi thủ công. Tạo database mới sẽ mở ứng dụng với dữ liệu trống và không khôi phục được dữ liệu cũ.'
      });
      if (choice === 0) {
        try {
          await database.createFreshDatabaseAfterRecovery();
          await initializeApplication();
          configureAutoUpdater();
          registerIpc();
          createWindow();
          app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
          return;
        } catch (recoveryError) {
          error = recoveryError;
        }
      } else {
        app.quit();
        return;
      }
    }
    try { await database?.close(); } finally {
      dialog.showErrorBox('Không thể khởi động ứng dụng', error.message || String(error));
      app.quit();
    }
  });
}
app.on('before-quit', async event => {
  if (isQuitting) return;
  isQuitting = true;
  event.preventDefault();
  try { await database?.close(); } finally { app.quit(); }
});
app.on('window-all-closed', () => process.platform !== 'darwin' && app.quit());

function registerIpc() {
  ipcMain.handle('state:get', async () => summary());
  ipcMain.handle('self-check:run', async () => runSelfCheck({ rootDir:__dirname, jobCodeFile:BUILT_IN_JOB_CODE_FILE }));
  ipcMain.handle('data-audit:run', async () => {
    const report = auditSessionData(session);
    session.dataAudit = report.rows;
    const { rows, ...summary } = report;
    return summary;
  });
  ipcMain.handle('data-audit:search', async (_event, payload) => searchLoadedCode(session, payload?.projectCode, payload?.code));
  ipcMain.handle('external:open', async (_e, url) => {
    if (url !== 'https://github.com/pokemon1742000-commits/PU') throw new Error('Đường dẫn không được phép.');
    await shell.openExternal(url);
    return true;
  });
  ipcMain.handle('update:check', async () => {
    if (!app.isPackaged) return setUpdateState({ status:'development', operation:'update', message:'Chức năng Update chỉ hoạt động trên bản đã cài đặt.' });
    if (['checking','downloading','installing','rollback-checking','rollback-downloading','rollback-installing'].includes(updateState.status)) return updateState;
    setUpdateState({ status:'checking', operation:'update', message:'Đang kiểm tra bản cập nhật...', percent:0 });
    try { await autoUpdater.checkForUpdates(); }
    catch (error) { setUpdateState({ status:'error', operation:'update', message:`Không thể kiểm tra cập nhật: ${error.message}` }); }
    return updateState;
  });
  ipcMain.handle('update:rollback', async () => rollbackPreviousVersion());
  ipcMain.handle('files:pick', async (_e, kind) => {
    if (!['purchase', 'scan', 'warehouse', 'workshop'].includes(kind)) throw new Error('Loại file không được phép nạp thủ công.');
    const result = await dialog.showOpenDialog(win, {
      title: 'Chọn file dữ liệu',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Excel', extensions: ['xlsx', 'xlsm'] }]
    });
    if (result.canceled) return { canceled: true };
    const files = [];
    for (const filePath of result.filePaths) {
      files.push({ path: filePath, file: path.basename(filePath), sheets: await inspectFileInWorker(filePath) });
    }
    return { canceled: false, files };
  });
  ipcMain.handle('files:load', async (_e, kind, selections) => serializeMutation(() => load(kind, selections)));
  ipcMain.handle('comparison:run', async (_e, settings) => {
    const autoThreshold = typeof settings === 'object' ? settings.autoThreshold : settings;
    const confirmThreshold = typeof settings === 'object' ? settings.confirmationThreshold : confirmationThreshold;
    runComparison(Number(autoThreshold) || 91, Number(confirmThreshold));
    return saveWorkingSession().then(() => summary());
  });
  ipcMain.handle('review:resolve', async (_e, payload) => serializeMutation(async () => {
    const out = resolveReview(session, payload);
    Object.assign(session, out);
    await saveWorkingSession();
    return summary();
  }));
  ipcMain.handle('purchase-replacement:save', async (_e, payload) => serializeMutation(async () => {
    const projectCodes = [...new Set(String(payload?.projectCode || '').split(',').map(value => value.trim().toUpperCase()).filter(Boolean))];
    const oldCode = String(payload?.oldCode || '').trim().toUpperCase();
    const newCode = String(payload?.newCode || '').trim().toUpperCase();
    if (!projectCodes.length || !oldCode || !newCode) throw new Error('Cần nhập đủ mã dự án, mã cũ và mã mới.');
    if (oldCode === newCode) throw new Error('Mã mới phải khác mã cũ.');
    for (const projectCode of projectCodes) {
      const projectRows = session.purchase.filter(row => String(row.projectCode || '').trim().toUpperCase() === projectCode);
      if (!projectRows.some(row => String(row.itemCode || '').trim().toUpperCase() === oldCode)) throw new Error(`Không tìm thấy mã cũ ${oldCode} trong dự án ${projectCode}.`);
      if (!projectRows.some(row => String(row.itemCode || '').trim().toUpperCase() === newCode)) throw new Error(`Không tìm thấy PR của mã mới ${newCode} trong dự án ${projectCode}.`);
    }
    for (const projectCode of projectCodes) session.purchaseReplacements = await database.savePurchaseReplacement(projectCode, oldCode, newCode);
    autoCompareWhenReady();
    return summary();
  }));
  ipcMain.handle('purchase-replacement:delete', async (_e, payload) => serializeMutation(async () => {
    session.purchaseReplacements = await database.deletePurchaseReplacement(payload?.projectCode, payload?.oldCode);
    autoCompareWhenReady();
    return summary();
  }));
  ipcMain.handle('data:rows', (_e, name, options) => rowsFor(name, options));
  ipcMain.handle('session:clear', async () => serializeMutation(async () => {
    await database.clearWorkingSession();
    const [purchaseAll, purchaseDetails, purchaseReplacements, warehouse, warehouseDetails, workshop, workshopDetails, workingSession, jobCodeReference] = await Promise.all([
      database.readPurchases(), database.readRawPurchases(), database.readPurchaseReplacements(),
      database.readWarehouse(), database.readRawWarehouse(), database.readWorkshop(), database.readRawWorkshop(), database.readWorkingSession(), readBuiltInJobCodeReference()
    ]);
    session = sessionWithBuiltInJobCodes({ ...emptySession(), purchaseAll, purchaseDetails, purchaseReplacements, warehouse, warehouseDetails, workshop, workshopDetails, formatWarnings:workingSession.formatWarnings || [], sources:workingSession.sources || [] }, jobCodeReference);
    refreshValidatedSession();
    return summary();
  }));
  ipcMain.handle('database:delete', async (_e, keyword) => serializeMutation(async () => {
    if (keyword !== 'XÓA') throw new Error('Từ khóa xác nhận không đúng.');
    await database.backupAndClear();
    const [purchaseDetails, jobCodeReference] = await Promise.all([
      database.readRawPurchases(), readBuiltInJobCodeReference()
    ]);
    session = sessionWithBuiltInJobCodes({ ...emptySession(), purchaseDetails }, jobCodeReference);
    refreshValidatedSession();
    return summary();
  }));
  ipcMain.handle('database:backups', async () => database.listBackups());
  ipcMain.handle('database:restore', async (_e, fileName) => serializeMutation(async () => {
    await database.restoreBackup(fileName);
    const [purchaseAll, purchaseDetails, purchaseReplacements, scans, scanDetails, warehouse, warehouseDetails, workshop, workshopDetails, workingSession, jobCodeReference] = await Promise.all([
      database.readPurchases(), database.readRawPurchases(), database.readPurchaseReplacements(),
      database.readScans(), database.readRawScans(), database.readWarehouse(), database.readRawWarehouse(),
      database.readWorkshop(), database.readRawWorkshop(), database.readWorkingSession(), readBuiltInJobCodeReference()
    ]);
    applyThresholdSettings(workingSession);
    session = sessionWithBuiltInJobCodes({ ...session, purchaseAll, purchaseDetails, purchaseReplacements, scans, scanDetails, warehouse, warehouseDetails, workshop, workshopDetails, formatWarnings:workingSession.formatWarnings || [], sources:workingSession.sources || [], decisions:new Map(workingSession.decisions || []) }, jobCodeReference);
    refreshValidatedSession();
    autoCompareWhenReady();
    return summary();
  }));
  ipcMain.handle('export:save', async (_e, sheetNames) => {
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
    const list = Array.isArray(sheetNames) ? sheetNames.map(String) : [];
    const wantPu = list.includes(EXPORT_TYPES.PU), wantSource = list.includes(EXPORT_TYPES.SOURCE);
    const onlyPu = wantPu && !wantSource, onlySource = wantSource && !wantPu;
    // Chọn cả 2 (hoặc không truyền loại nào, tương thích ngược với bản cũ) giữ
    // nguyên tên file mặc định như trước: `DoiChieu_${stamp}.xlsx`.
    const defaultPath = onlyPu ? `DoiChieu_PU_${stamp}.xlsx` : onlySource ? `DoiChieu_PR_PO_XGC_${stamp}.xlsx` : `DoiChieu_${stamp}.xlsx`;
    const result = await dialog.showSaveDialog(win, { defaultPath, filters: [{ name: 'Excel', extensions: ['xlsx'] }] });
    if (result.canceled) return { canceled: true };
    await exportWorkbook(result.filePath, sheetNames, session);
    return { canceled: false, path: result.filePath };
  });
  ipcMain.handle('export:open', async (_e, filePath) => {
    const target = String(filePath || '');
    if (!target || path.extname(target).toLowerCase() !== '.xlsx') throw new Error('File xuất không hợp lệ.');
    try { await fs.access(target); }
    catch { throw new Error('Không tìm thấy file xuất.'); }
    const error = await shell.openPath(target);
    if (error) throw new Error(error);
    return true;
  });
  ipcMain.handle('export:show-in-folder', async (_e, filePath) => {
    const target = String(filePath || '');
    if (!target || path.extname(target).toLowerCase() !== '.xlsx') throw new Error('File xuất không hợp lệ.');
    try { await fs.access(target); }
    catch { throw new Error('Không tìm thấy file xuất.'); }
    shell.showItemInFolder(target);
    return true;
  });
}

async function load(kind, selections) {
  try {
    const selectedPaths = selections.map(selection => selection.path);
    const result = await processFilesInWorker(kind, selections);
    const filePaths = result.successfulFiles || selectedPaths;
    if (kind === 'purchase') {
      const merged = await database.mergePurchases(result.rows);
      session.purchaseAll = merged.rows;
      [session.purchaseDetails] = await Promise.all([
        database.mergeRawPurchases(result.details || result.rows), database.archiveSourceFiles(kind, filePaths)
      ]);
      result.stats = merged.stats;
    } else if (kind === 'scan') {
      const merged = await database.mergeScans(result.rows);
      session.scans = merged.rows;
      session.scanDetails = await database.mergeRawScans(result.details || result.rows);
      result.stats = merged.stats;
    } else if (kind === 'warehouse') {
      const merged = await database.mergeWarehouse(result.rows);
      session.warehouse = merged.rows;
      session.warehouseDetails = await database.mergeRawWarehouse(result.details || result.rows);
      result.stats = merged.stats;
    } else if (kind === 'workshop') {
      const merged = await database.mergeWorkshop(result.rows);
      session.workshop = merged.rows;
      session.workshopDetails = await database.mergeRawWorkshop(result.details || result.rows);
      result.stats = merged.stats;
    }
    session.formatWarnings.push(...(result.warnings || []));
    refreshValidatedSession();
    session.sources.push(...filePaths.map(p => ({ kind, file: path.basename(p), path: p, loadedAt: new Date().toISOString() })));
    await saveWorkingSession();
    autoCompareWhenReady();
    return { ...summary(), loadStats: { ...(result.stats || { loaded: result.rows.length }), fileErrors: result.fileErrors || [] } };
  } catch (error) { throw new Error(error.message || String(error)); }
}

function rowsFor(name, options = {}) {
  const map = {
    purchase: session.purchase, scan: session.scans, warehouse: session.warehouse, workshop: session.workshop, dataAudit:session.dataAudit,
    comparison: session.comparison, enough: session.enough, shortage: session.shortage,
    excess: session.excess, review: session.review, warnings: session.warnings,
    sources: session.sources, purchaseDetails: session.purchaseDetails, scanDetails: session.scanDetails, warehouseDetails: session.warehouseDetails, workshopDetails: session.workshopDetails,
    jobCodeDetails: session.jobCodeDetails
  };
  let sourceRows = name === 'jobCodes'
    ? session.jobCodes.map(code => ({ code, note: session.jobCodeNotes.get(code) || '' }))
    : (map[name] || []);
  if (name === 'purchase') sourceRows = annotatePurchaseReplacements(sourceRows);
  if (name === 'warnings') sourceRows = prioritizeProjectWarnings(sourceRows);
  const query = String(options.query || '').trim().toLowerCase();
  const filtered = query
    ? sourceRows.filter(row => Object.values(row).some(value => String(value ?? '').toLowerCase().includes(query)))
    : sourceRows;
  const pageSize = Math.min(Math.max(Number(options.pageSize) || DEFAULT_PAGE_SIZE, 20), 2000);
  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(Number(options.page) || 1, 1), totalPages);
  const start = (page - 1) * pageSize;
  const numberedTables = ['purchase', 'scan', 'warehouse', 'workshop', 'dataAudit', 'jobCodes', 'comparison', 'enough', 'shortage', 'excess', 'review', 'warnings', 'purchaseDetails', 'scanDetails', 'warehouseDetails', 'workshopDetails', 'jobCodeDetails'];
  const rows = filtered.slice(start, start + pageSize).map((row, index) =>
    numberedTables.includes(name) ? { ...row, stt: start + index + 1 } : row
  );
  return { rows, page, pageSize, total, totalPages };
}

function readBuiltInJobCodeReference() {
  if (!builtInJobCodeReference) {
    builtInJobCodeReference = processFilesInWorker('reference', [{ path: BUILT_IN_JOB_CODE_FILE, sheets: ['Job code'] }])
      .then(result => ({
        rows: [...new Set(result.rows || [])],
        details: result.details || []
      }))
      .catch(error => {
        builtInJobCodeReference = null;
        throw new Error(`Không thể đọc file Job Code mặc định: ${error.message}`);
      });
  }
  return builtInJobCodeReference;
}

function sessionWithBuiltInJobCodes(base, reference) {
  const jobCodeDetails = annotateJobCodeDetails(reference.details || []);
  return {
    ...base,
    jobCodes: [...(reference.rows || [])],
    jobCodeDetails,
    jobCodeNotes: jobNotesFromDetails(jobCodeDetails)
  };
}

function processSingleFileInWorker(kind, source) {
  return runFileParser(path.join(__dirname, 'src', 'file-worker.js'), { kind, files: [source] });
}

function inspectFileInWorker(filePath) {
  return runFileParser(path.join(__dirname, 'src', 'file-worker.js'), { action: 'inspect', filePath });
}

function parserFileName(source) {
  return path.basename(source?.path || source?.file || 'file Excel');
}

async function processFilesInWorker(kind, files) {
  const results = [], fileErrors = [];
  for (const source of files) {
    try {
      const result = await processSingleFileInWorker(kind, source);
      results.push({ ...result, sourcePath: source.path });
    }
    catch (error) { fileErrors.push({ file: parserFileName(source), message: error.message || String(error) }); }
  }
  if (!results.length) {
    const detail = fileErrors.map(error => `${error.file}: ${error.message}`).join('; ');
    throw new Error(`Không thể đọc file ${kind === 'warehouse' ? 'Nhập Kho' : 'Excel'}: ${detail}`);
  }
  return { ...combineFileResults(kind, results), fileErrors, successfulFiles:results.map(result => result.sourcePath).filter(Boolean) };
}

function combineFileResults(kind, results) {
  if (results.length === 1) return results[0];
  const warnings = results.flatMap(result => result.warnings || []);
  if (kind === 'warehouse') return { rows: mergeWarehouseRows(results.flatMap(result => result.rows || [])), details: results.flatMap(result => result.details || []), warnings };
  if (kind === 'workshop') return { rows: mergeWorkshopRows(results.flatMap(result => result.rows || [])), details: results.flatMap(result => result.details || []), warnings };
  if (kind !== 'scan') return { rows: results.flatMap(result => result.rows || []), details: results.flatMap(result => result.details || []), warnings };
  const groups = new Map();
  for (const row of results.flatMap(result => result.rows || [])) {
    const key = [row.projectCode, row.drawingCode, row.manufacturer, row.scanDate].map(value => String(value || '').trim().toUpperCase()).join('|');
    const old = groups.get(key);
    if (!old) {
      const mergedRowCount = Number(row.mergedRowCount) || 1;
      groups.set(key, { ...row, mergedRowCount, note: mergedRowCount > 1 ? `Gộp ${mergedRowCount} dòng` : '', scanHistory: [...(row.scanHistory || [])] });
    }
    else {
      old.quantity += Number(row.quantity) || 0;
      old.mergedRowCount += Number(row.mergedRowCount) || 1;
      old.note = old.mergedRowCount > 1 ? `Gộp ${old.mergedRowCount} dòng` : '';
      old.scanHistory.push(...(row.scanHistory || []));
      if (row.scanDate && (!old.scanDate || row.scanDate > old.scanDate)) old.scanDate = row.scanDate;
    }
  }
  return { rows: [...groups.values()], details: results.flatMap(result => result.details || []), warnings };
}

function summary() {
  const counts = Object.fromEntries(['purchase','scans','warehouse','workshop','jobCodes','comparison','enough','shortage','excess','review','warnings'].map(k => [k, (session[k] || []).length]));
  counts.review = (session.review || []).filter(row => row.status === 'Chờ xác nhận').length;
  return {
    counts,
    sources: session.sources,
    rawCounts: { purchase: session.purchaseDetails.length, scan: session.scanDetails.length, warehouse: session.warehouseDetails.length, workshop: session.workshopDetails.length, jobCodes: session.jobCodeDetails.length, warnings: session.purchaseDetails.length },
    autoThreshold: comparisonThreshold,
    confirmationThreshold,
    purchaseReplacements: session.purchaseReplacements,
    appVersion: app.getVersion()
  };
}

function refreshValidatedSession() {
  const purchases = filterPurchasesByProjectPrefix(session.purchaseAll);
  session.purchase = mergePurchaseRows(purchases.valid);
  const warningSource = session.purchaseDetails.length ? session.purchaseDetails : session.purchaseAll;
  const purchaseWarnings = filterPurchasesByProjectPrefix(warningSource).warnings;
  const purchaseFormatWarnings = session.formatWarnings.filter(row => row.source === 'Mua Hàng');
  session.warnings = [...purchaseFormatWarnings, ...purchaseWarnings];
}

function runComparison(threshold = 91, confirmThreshold = confirmationThreshold) {
  comparisonThreshold = Number(threshold) || 91;
  confirmationThreshold = Math.max(0, Math.min(Number.isFinite(Number(confirmThreshold)) ? Number(confirmThreshold) : 90, comparisonThreshold - 1));
  session.comparisonWarehouse = mergeWarehouseRows([...(session.warehouse || []), ...(session.workshop || [])]);
  const out = buildComparison(session.purchase, session.scans, session.comparisonWarehouse, comparisonThreshold, session.decisions || new Map(), confirmationThreshold, session.purchaseReplacements);
  Object.assign(session, out);
  session.dataAudit = [];
}

function autoCompareWhenReady() {
  if (session.scans.length && (session.purchase.length || session.warehouse.length || session.workshop.length)) runComparison(comparisonThreshold, confirmationThreshold);
}

function saveWorkingSession() {
  return database.writeWorkingSession({
    sources:session.sources,
    formatWarnings:session.formatWarnings,
    decisions:[...(session.decisions || new Map()).entries()],
    autoThreshold:comparisonThreshold,
    confirmationThreshold
  });
}

function jobNotesFromDetails(rows) {
  const notes = new Map();
  for (const row of rows || []) if (row.code && row.note) notes.set(row.code, row.note);
  return notes;
}

function annotateJobCodeDetails(rows) {
  const counts = new Map();
  for (const row of rows || []) if (row.code) counts.set(row.code, (counts.get(row.code) || 0) + 1);
  return (rows || []).map(row => ({ ...row, note: counts.get(row.code) > 1 ? `Trùng ${counts.get(row.code)} dòng` : '' }));
}

function annotatePurchaseReplacements(rows) {
  const rules = new Map((session.purchaseReplacements || []).map(rule => [`${rule.projectCode}|${rule.oldCode}`, rule]));
  const purchases = new Map((session.purchase || []).map(row => [`${String(row.projectCode || '').trim().toUpperCase()}|${String(row.itemCode || '').trim().toUpperCase()}`, row]));
  return (rows || []).map(row => {
    const project = String(row.projectCode || '').trim().toUpperCase();
    const itemCode = String(row.itemCode || '').trim().toUpperCase();
    const rule = rules.get(`${project}|${itemCode}`);
    if (!rule) return row;
    const replacement = purchases.get(`${project}|${rule.newCode}`);
    return { ...row, replacementCode:rule.newCode, replacementPurchaseOrder:replacement?.purchaseOrder || '' };
  });
}

function setUpdateState(patch) {
  updateState = { ...updateState, ...patch, currentVersion:app.getVersion() };
  if (win && !win.isDestroyed()) win.webContents.send('update:status', updateState);
  return updateState;
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers:{ Accept:'application/vnd.github+json', 'User-Agent':'doi-chieu-du-lieu' } }, response => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        return fetchJson(response.headers.location).then(resolve, reject);
      }
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => {
        if (response.statusCode !== 200) return reject(new Error(`GitHub trả về HTTP ${response.statusCode}.`));
        try { resolve(JSON.parse(body)); } catch { reject(new Error('GitHub trả về dữ liệu không hợp lệ.')); }
      });
    });
    request.on('error', reject);
    request.setTimeout(20000, () => request.destroy(new Error('Kết nối GitHub quá thời gian.')));
  });
}

function downloadFile(url, target, onProgress) {
  return new Promise((resolve, reject) => {
    const output = fileSystem.createWriteStream(target);
    const request = https.get(url, { headers:{ Accept:'application/octet-stream', 'User-Agent':'doi-chieu-du-lieu' } }, response => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        output.close();
        return downloadFile(response.headers.location, target, onProgress).then(resolve, reject);
      }
      if (response.statusCode !== 200) {
        response.resume();
        output.close();
        return reject(new Error(`Không thể tải bộ cài (HTTP ${response.statusCode}).`));
      }
      const total = Number(response.headers['content-length']) || 0;
      let received = 0;
      response.on('data', chunk => {
        received += chunk.length;
        onProgress(total ? Math.round(received / total * 100) : 0);
      });
      response.pipe(output);
      output.on('finish', async () => {
        output.close();
        try {
          const stat = await fs.stat(target);
          if (!stat.size) throw new Error('Bộ cài tải xuống rỗng.');
          resolve(target);
        } catch (error) { reject(error); }
      });
    });
    request.on('error', error => { output.destroy(); reject(error); });
    request.setTimeout(120000, () => request.destroy(new Error('Tải bộ cài quá thời gian.')));
  });
}

async function verifyDownloadedAsset(filePath, asset) {
  const digest = String(asset?.digest || '');
  if (!digest) return;
  const match = digest.match(/^sha256:([a-f0-9]{64})$/i);
  if (!match) throw new Error('GitHub trả về checksum bộ cài không được hỗ trợ.');
  const hash = crypto.createHash('sha256');
  const input = fileSystem.createReadStream(filePath);
  await new Promise((resolve, reject) => {
    input.on('data', chunk => hash.update(chunk));
    input.on('error', reject);
    input.on('end', resolve);
  });
  if (hash.digest('hex').toLowerCase() !== match[1].toLowerCase()) throw new Error('Checksum bộ cài không khớp với release GitHub.');
}

async function rollbackPreviousVersion() {
  if (!app.isPackaged) return setUpdateState({ status:'development', operation:'rollback', message:'Chức năng Restore chỉ hoạt động trên bản đã cài đặt.' });
  if (['checking','downloading','installing','rollback-checking','rollback-downloading','rollback-installing'].includes(updateState.status)) return updateState;
  const temporaryFile = path.join(app.getPath('temp'), `doi-chieu-restore-${Date.now()}.exe`);
  setUpdateState({ status:'rollback-checking', operation:'rollback', message:'Đang tìm bản stable ngay trước latest trên GitHub...', percent:0 });
  try {
    const releases = await fetchJson(`https://api.github.com/repos/${REPOSITORY.owner}/${REPOSITORY.name}/releases?per_page=30`);
    const selection = selectPreviousRelease(releases, app.getVersion());
    if (!selection.previous) {
      return setUpdateState({ status:'rollback-unavailable', operation:'rollback', latestVersion:selection.latest?.version || '', targetVersion:'', message:'Không tìm thấy bản stable trước latest phù hợp để khôi phục.' });
    }
    const asset = selectInstallerAsset(selection.previous);
    if (!asset) throw new Error(`Bản ${selection.previous.version} không có bộ cài Setup hợp lệ.`);
    setUpdateState({ status:'rollback-downloading', operation:'rollback', latestVersion:selection.latest.version, targetVersion:selection.previous.version, message:`Đang tải bộ cài bản ${selection.previous.version}...`, percent:0 });
    await downloadFile(asset.browser_download_url, temporaryFile, percent => setUpdateState({ status:'rollback-downloading', operation:'rollback', latestVersion:selection.latest.version, targetVersion:selection.previous.version, percent, message:`Đang tải Restore ${percent}%` }));
    await verifyDownloadedAsset(temporaryFile, asset);
    const choice = dialog.showMessageBoxSync(win, {
      type:'warning', buttons:['Cài bản Restore và khởi động lại','Để sau'], defaultId:1, cancelId:1,
      title:'Khôi phục phiên bản ứng dụng',
      message:`Khôi phục từ v${app.getVersion()} về v${selection.previous.version}?`,
      detail:`Latest trên GitHub hiện là v${selection.latest.version}. Restore sẽ cài bản stable ngay trước latest, không xóa dữ liệu SQLite, rồi đóng ứng dụng để chạy bộ cài.`
    });
    if (choice !== 0) {
      await fs.rm(temporaryFile, { force:true });
      return setUpdateState({ status:'idle', operation:'rollback', targetVersion:selection.previous.version, latestVersion:selection.latest.version, message:'Đã hủy khôi phục phiên bản.' });
    }
    setUpdateState({ status:'rollback-installing', operation:'rollback', latestVersion:selection.latest.version, targetVersion:selection.previous.version, message:`Đang cài bản Restore v${selection.previous.version}...`, percent:100 });
    const child = spawn(temporaryFile, ['/S'], { detached:true, stdio:'ignore', windowsHide:true });
    child.unref();
    setTimeout(() => app.quit(), 250);
    return updateState;
  } catch (error) {
    await fs.rm(temporaryFile, { force:true }).catch(() => {});
    return setUpdateState({ status:'error', operation:'rollback', message:`Restore thất bại: ${error.message}`, percent:0 });
  }
}

function configureAutoUpdater() {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => setUpdateState({ status:'checking', message:'Đang kiểm tra bản cập nhật...', percent:0 }));
  autoUpdater.on('update-available', info => {
    setUpdateState({ status:'downloading', message:`Đang tải bản ${info.version}...`, availableVersion:info.version, percent:0 });
    autoUpdater.downloadUpdate().catch(error => setUpdateState({ status:'error', message:`Không thể tải cập nhật: ${error.message}` }));
  });
  autoUpdater.on('update-not-available', info => setUpdateState({ status:'current', message:`Đang dùng bản mới nhất (${info.version || app.getVersion()}).`, availableVersion:'' }));
  autoUpdater.on('download-progress', progress => setUpdateState({ status:'downloading', message:`Đang tải cập nhật ${Math.round(progress.percent)}%`, percent:Math.round(progress.percent) }));
  autoUpdater.on('update-downloaded', info => {
    setUpdateState({ status:'ready', message:`Đã tải bản ${info.version}. Chọn Update để cài đặt khi bạn đã sẵn sàng.`, percent:100 });
    if (!win || win.isDestroyed()) return;
    const choice = dialog.showMessageBoxSync(win, {
      type:'info',
      buttons:['Cài đặt và khởi động lại','Để sau'],
      defaultId:1,
      cancelId:1,
      title:'Bản cập nhật đã sẵn sàng',
      message:`Bản ${info.version} đã được tải xuống.`,
      detail:'Bạn có muốn cài đặt và khởi động lại ứng dụng ngay không?'
    });
    if (choice === 0) autoUpdater.quitAndInstall(true, true);
  });
  autoUpdater.on('error', error => setUpdateState({ status:'error', message:`Cập nhật thất bại: ${error.message}` }));
}
