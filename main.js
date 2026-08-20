const { app, BrowserWindow, dialog, ipcMain, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const { Worker } = require('worker_threads');
const { autoUpdater } = require('electron-updater');
const { buildComparison, resolveReview, filterPurchasesByProjectPrefix, prioritizeProjectWarnings, mergePurchaseRows, mergeWarehouseRows } = require('./src/processor');
const { exportWorkbook } = require('./src/exporter');
const { Database } = require('./src/storage');

let win;
let session = emptySession();
let database;
let comparisonThreshold = 95;
let confirmationThreshold = 70;
let updateState = { status:'idle', message:'Sẵn sàng kiểm tra cập nhật', percent:0, currentVersion:app.getVersion() };
const DEFAULT_PAGE_SIZE = 100;
const BUILT_IN_JOB_CODE_FILE = path.join(app.isPackaged ? process.resourcesPath : __dirname, 'assets', 'MKAC Monthly Timesheet.xlsx');
let builtInJobCodeReference;

app.commandLine.appendSwitch('js-flags', '--max-old-space-size=4096');

function emptySession() {
  return { purchase: [], purchaseAll: [], purchaseDetails: [], purchaseReplacements: [], scans: [], scanDetails: [], warehouse: [], warehouseDetails: [], comparison: [], review: [], warnings: [], formatWarnings: [], jobCodes: [], jobCodeDetails: [], jobCodeNotes: new Map(), decisions: new Map(), sources: [] };
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

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  database = new Database(path.join(app.getPath('userData'), 'data'));
  await database.init();
  const [purchaseAll, purchaseDetails, purchaseReplacements, scans, scanDetails, warehouse, warehouseDetails, workingSession, jobCodeReference] = await Promise.all([
    database.readPurchases(), database.readRawPurchases(), database.readPurchaseReplacements(),
    database.readScans(), database.readRawScans(), database.readWarehouse(), database.readRawWarehouse(), database.readWorkingSession(), readBuiltInJobCodeReference()
  ]);
  session = sessionWithBuiltInJobCodes({ ...session, purchaseAll, purchaseDetails, purchaseReplacements, scans, scanDetails, warehouse, warehouseDetails, formatWarnings:workingSession.formatWarnings || [], sources:workingSession.sources || [], decisions:new Map(workingSession.decisions || []) }, jobCodeReference);
  refreshValidatedSession();
  autoCompareWhenReady();
  configureAutoUpdater();
  registerIpc();
  createWindow();
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});
app.on('window-all-closed', () => process.platform !== 'darwin' && app.quit());

function registerIpc() {
  ipcMain.handle('state:get', async () => summary());
  ipcMain.handle('external:open', async (_e, url) => {
    if (url !== 'https://github.com/pokemon1742000-commits/PU') throw new Error('Đường dẫn không được phép.');
    await shell.openExternal(url);
    return true;
  });
  ipcMain.handle('update:check', async () => {
    if (!app.isPackaged) return setUpdateState({ status:'development', message:'Chức năng Update chỉ hoạt động trên bản đã cài đặt.' });
    if (['checking','downloading','installing'].includes(updateState.status)) return updateState;
    setUpdateState({ status:'checking', message:'Đang kiểm tra bản cập nhật...', percent:0 });
    try { await autoUpdater.checkForUpdates(); }
    catch (error) { setUpdateState({ status:'error', message:`Không thể kiểm tra cập nhật: ${error.message}` }); }
    return updateState;
  });
  ipcMain.handle('files:pick', async (_e, kind) => {
    if (!['purchase', 'scan', 'warehouse'].includes(kind)) throw new Error('Loại file không được phép nạp thủ công.');
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
  ipcMain.handle('files:load', async (_e, kind, selections) => load(kind, selections));
  ipcMain.handle('comparison:run', async (_e, settings) => {
    const autoThreshold = typeof settings === 'object' ? settings.autoThreshold : settings;
    const confirmThreshold = typeof settings === 'object' ? settings.confirmationThreshold : confirmationThreshold;
    runComparison(Number(autoThreshold) || 95, Number(confirmThreshold));
    return summary();
  });
  ipcMain.handle('review:resolve', async (_e, payload) => {
    const out = resolveReview(session, payload);
    Object.assign(session, out);
    await saveWorkingSession();
    return summary();
  });
  ipcMain.handle('purchase-replacement:save', async (_e, payload) => {
    const projectCode = String(payload?.projectCode || '').trim().toUpperCase();
    const oldCode = String(payload?.oldCode || '').trim().toUpperCase();
    const newCode = String(payload?.newCode || '').trim().toUpperCase();
    if (!projectCode || !oldCode || !newCode) throw new Error('Cần nhập đủ mã dự án, mã cũ và mã mới.');
    if (oldCode === newCode) throw new Error('Mã mới phải khác mã cũ.');
    const projectRows = session.purchase.filter(row => String(row.projectCode || '').trim().toUpperCase() === projectCode);
    if (!projectRows.some(row => String(row.itemCode || '').trim().toUpperCase() === oldCode)) throw new Error(`Không tìm thấy mã cũ ${oldCode} trong dự án ${projectCode}.`);
    if (!projectRows.some(row => String(row.itemCode || '').trim().toUpperCase() === newCode)) throw new Error(`Không tìm thấy PR của mã mới ${newCode} trong dự án ${projectCode}.`);
    session.purchaseReplacements = await database.savePurchaseReplacement(projectCode, oldCode, newCode);
    autoCompareWhenReady();
    return summary();
  });
  ipcMain.handle('purchase-replacement:delete', async (_e, payload) => {
    session.purchaseReplacements = await database.deletePurchaseReplacement(payload?.projectCode, payload?.oldCode);
    autoCompareWhenReady();
    return summary();
  });
  ipcMain.handle('data:rows', (_e, name, options) => rowsFor(name, options));
  ipcMain.handle('session:clear', async () => {
    await database.clearWorkingSession();
    const [purchaseAll, purchaseDetails, purchaseReplacements, warehouse, warehouseDetails, workingSession, jobCodeReference] = await Promise.all([
      database.readPurchases(), database.readRawPurchases(), database.readPurchaseReplacements(),
      database.readWarehouse(), database.readRawWarehouse(), database.readWorkingSession(), readBuiltInJobCodeReference()
    ]);
    session = sessionWithBuiltInJobCodes({ ...emptySession(), purchaseAll, purchaseDetails, purchaseReplacements, warehouse, warehouseDetails, formatWarnings:workingSession.formatWarnings || [], sources:workingSession.sources || [] }, jobCodeReference);
    refreshValidatedSession();
    return summary();
  });
  ipcMain.handle('database:delete', async (_e, keyword) => {
    if (keyword !== 'XÓA') throw new Error('Từ khóa xác nhận không đúng.');
    await database.backupAndClear();
    const [purchaseDetails, jobCodeReference] = await Promise.all([
      database.readRawPurchases(), readBuiltInJobCodeReference()
    ]);
    session = sessionWithBuiltInJobCodes({ ...emptySession(), purchaseDetails }, jobCodeReference);
    refreshValidatedSession();
    return summary();
  });
  ipcMain.handle('export:save', async (_e, sheetNames) => {
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
    const result = await dialog.showSaveDialog(win, { defaultPath: `DoiChieu_${stamp}.xlsx`, filters: [{ name: 'Excel', extensions: ['xlsx'] }] });
    if (result.canceled) return { canceled: true };
    await exportWorkbook(result.filePath, sheetNames, session);
    return { canceled: false, path: result.filePath };
  });
}

async function load(kind, selections) {
  try {
    const filePaths = selections.map(selection => selection.path);
    const result = await processFilesInWorker(kind, selections);
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
    }
    session.formatWarnings.push(...(result.warnings || []));
    refreshValidatedSession();
    session.sources.push(...filePaths.map(p => ({ kind, file: path.basename(p), path: p, loadedAt: new Date().toISOString() })));
    await saveWorkingSession();
    autoCompareWhenReady();
    return { ...summary(), loadStats: result.stats || { loaded: result.rows.length } };
  } catch (error) { throw new Error(error.message || String(error)); }
}

function rowsFor(name, options = {}) {
  const map = {
    purchase: session.purchase, scan: session.scans, warehouse: session.warehouse,
    comparison: session.comparison, enough: session.enough, shortage: session.shortage,
    excess: session.excess, review: session.review, warnings: session.warnings,
    sources: session.sources, purchaseDetails: session.purchaseDetails, scanDetails: session.scanDetails, warehouseDetails: session.warehouseDetails,
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
  const numberedTables = ['purchase', 'scan', 'warehouse', 'jobCodes', 'comparison', 'enough', 'shortage', 'excess', 'review', 'warnings', 'purchaseDetails', 'scanDetails', 'warehouseDetails', 'jobCodeDetails'];
  const rows = filtered.slice(start, start + pageSize).map((row, index) =>
    numberedTables.includes(name) ? { ...row, stt: start + index + 1 } : row
  );
  return { rows, page, pageSize, total, totalPages };
}

function processFilesInWorker(kind, files) {
  return (async () => {
    const results = [];
    for (const source of files) results.push(await processSingleFileInWorker(kind, source));
    return combineFileResults(kind, results);
  })();
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
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'src', 'file-worker.js'), {
      workerData: { kind, files: [source] },
      resourceLimits: { maxOldGenerationSizeMb: 4096 }
    });
    let settled = false;
    worker.once('message', message => {
      settled = true;
      if (message.ok) resolve(message.result);
      else reject(new Error(message.error));
    });
    worker.once('error', error => { settled = true; reject(error); });
    worker.once('exit', code => {
      if (!settled && code !== 0) reject(new Error(`Tiến trình đọc Excel đã dừng với mã lỗi ${code}.`));
    });
  });
}

function inspectFileInWorker(filePath) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'src', 'file-worker.js'), {
      workerData: { action: 'inspect', filePath },
      resourceLimits: { maxOldGenerationSizeMb: 4096 }
    });
    let settled = false;
    worker.once('message', message => {
      settled = true;
      if (message.ok) resolve(message.result);
      else reject(new Error(message.error));
    });
    worker.once('error', error => { settled = true; reject(error); });
    worker.once('exit', code => {
      if (!settled && code !== 0) reject(new Error(`Tiến trình đọc danh sách sheet đã dừng với mã lỗi ${code}.`));
    });
  });
}

function combineFileResults(kind, results) {
  if (results.length === 1) return results[0];
  const warnings = results.flatMap(result => result.warnings || []);
  if (kind === 'warehouse') return { rows: mergeWarehouseRows(results.flatMap(result => result.rows || [])), details: results.flatMap(result => result.details || []), warnings };
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
  const counts = Object.fromEntries(['purchase','scans','warehouse','jobCodes','comparison','enough','shortage','excess','review','warnings'].map(k => [k, (session[k] || []).length]));
  counts.review = (session.review || []).filter(row => row.status === 'Chờ xác nhận').length;
  return {
    counts,
    sources: session.sources,
    rawCounts: { purchase: session.purchaseDetails.length, scan: session.scanDetails.length, warehouse: session.warehouseDetails.length, jobCodes: session.jobCodeDetails.length, warnings: session.purchaseDetails.length },
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

function runComparison(threshold = 95, confirmThreshold = confirmationThreshold) {
  comparisonThreshold = Number(threshold) || 95;
  confirmationThreshold = Math.max(0, Math.min(Number.isFinite(Number(confirmThreshold)) ? Number(confirmThreshold) : 70, comparisonThreshold - 1));
  const out = buildComparison(session.purchase, session.scans, session.warehouse, comparisonThreshold, session.decisions || new Map(), confirmationThreshold, session.purchaseReplacements);
  Object.assign(session, out);
}

function autoCompareWhenReady() {
  if (session.scans.length && (session.purchase.length || session.warehouse.length)) runComparison(comparisonThreshold, confirmationThreshold);
}

function saveWorkingSession() {
  return database.writeWorkingSession({ sources:session.sources, formatWarnings:session.formatWarnings, decisions:[...(session.decisions || new Map()).entries()] });
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
    setUpdateState({ status:'installing', message:`Đã tải bản ${info.version}. Ứng dụng sẽ tự cài đặt và mở lại.`, percent:100 });
    setTimeout(() => autoUpdater.quitAndInstall(true, true), 800);
  });
  autoUpdater.on('error', error => setUpdateState({ status:'error', message:`Cập nhật thất bại: ${error.message}` }));
}
