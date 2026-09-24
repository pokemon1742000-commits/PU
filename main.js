const { app, BrowserWindow, dialog, ipcMain, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const fileSystem = require('fs');
const https = require('https');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { runFileParser, runProgressWorker, runStreamingFileParser } = require('./src/file-runner');
const { createRawImportWorker } = require('./src/raw-import-runner');
const { buildComparison, resolveReview, filterPurchasesByProjectPrefix, prioritizeProjectWarnings, mergePurchaseRows, mergeWarehouseRows, mergeWorkshopRows } = require('./src/processor');
const { EXPORT_TYPES } = require('./src/exporter');
const { Database } = require('./src/storage');
const { runSelfCheck } = require('./src/self-check');
const { auditSessionData, searchLoadedCode } = require('./src/data-audit');
const { REPOSITORY, releasesForOperation, selectReleaseForOperation, selectInstallerAsset } = require('./src/update-release');
const { prepareDataVersion, completeDataVersion } = require('./src/version-data');

let win;
let session = emptySession();
let database;
let isQuitting = false;
let comparisonThreshold = 91;
let confirmationThreshold = 90;
let mutationQueue = Promise.resolve();
let updateState = { status:'idle', operation:'update', message:'Sẵn sàng kiểm tra cập nhật', percent:0, currentVersion:app.getVersion() };
const DEFAULT_PAGE_SIZE = 100;
const RAW_TABLES = { purchaseDetails:'purchase_raw', scanDetails:'scan_raw', warehouseDetails:'warehouse_raw', workshopDetails:'workshop_raw' };
const PERSISTED_TABLES = { purchase:'purchases', scan:'scans', warehouse:'warehouse', workshop:'workshop' };
const MAX_SESSION_ROWS = 50000;
// Keep the streaming parser bounded while reducing one IPC + SQLite transaction
// for every few hundred rows on large workbooks.
const IMPORT_BATCH_SIZE = 5000;
const BUILT_IN_JOB_CODE_FILE = path.join(app.isPackaged ? process.resourcesPath : __dirname, 'assets', 'MKAC Monthly Timesheet.xlsx');
let builtInJobCodeReference;
let activeImport = null;
let activeLoadPromise = null;
let activeExport = null;
const MAX_FORMAT_WARNINGS = 2000;

app.commandLine.appendSwitch('js-flags', '--max-old-space-size=4096');

function emptySession() {
  return { purchase: [], purchaseAll: [], purchaseDetails: [], purchaseReplacements: [], scans: [], scanDetails: [], warehouse: [], warehouseDetails: [], workshop: [], workshopDetails: [], comparisonWarehouse: [], comparison: [], dataAudit: [], review: [], warnings: [], formatWarnings: [], jobCodes: [], jobCodeDetails: [], jobCodeNotes: new Map(), decisions: new Map(), sources: [], largeDatasets:new Set() };
}

async function readRowsForSession(table) {
  const total = await database.countTableRows(table);
  if (total > MAX_SESSION_ROWS) {
    session.largeDatasets.add(table);
    return [];
  }
  session.largeDatasets.delete(table);
  return database.readTablePage(table, { limit:MAX_SESSION_ROWS });
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
  if (!database) {
    const userDataDir = app.getPath('userData');
    await prepareDataVersion({ userDataDir, currentVersion:app.getVersion() });
    database = new Database(path.join(userDataDir, 'data'));
  }
  await database.init();
  const [purchaseAll, purchaseReplacements, scans, warehouse, workshop, workingSession, jobCodeReference] = await Promise.all([
    readRowsForSession('purchases'), database.readPurchaseReplacements(), readRowsForSession('scans'),
    readRowsForSession('warehouse'), readRowsForSession('workshop'), database.readWorkingSession(), readBuiltInJobCodeReference()
  ]);
  applyThresholdSettings(workingSession);
  session = sessionWithBuiltInJobCodes({ ...session, purchaseAll, purchaseReplacements, scans, warehouse, workshop, formatWarnings:workingSession.formatWarnings || [], sources:workingSession.sources || [], decisions:new Map(workingSession.decisions || []) }, jobCodeReference);
  await refreshValidatedSession();
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
    await completeDataVersion({ userDataDir:app.getPath('userData'), currentVersion:app.getVersion() });
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
          await completeDataVersion({ userDataDir:app.getPath('userData'), currentVersion:app.getVersion() });
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
  try {
    if (activeImport) {
      activeImport.controller.abort();
      await activeLoadPromise?.catch(() => {});
    }
    if (activeExport) {
      activeExport.controller.abort();
      await removeExportTemporaryFiles(activeExport.filePath);
    }
    await database?.close();
  } finally { app.quit(); }
});
app.on('window-all-closed', () => process.platform !== 'darwin' && app.quit());

function registerIpc() {
  ipcMain.handle('state:get', async () => await summary());
  ipcMain.handle('self-check:run', async () => runSelfCheck({ rootDir:__dirname, jobCodeFile:BUILT_IN_JOB_CODE_FILE }));
  ipcMain.handle('data-audit:run', async () => {
    ensureFullDatasetAvailable('kiểm tra dữ liệu');
    const report = auditSessionData(await sessionWithRawDetails());
    session.dataAudit = report.rows;
    const { rows, ...summary } = report;
    return summary;
  });
  ipcMain.handle('data-audit:search', async (_event, payload) => {
    ensureFullDatasetAvailable('tìm kiếm dữ liệu');
    return searchLoadedCode(await sessionWithRawDetails(), payload?.projectCode, payload?.code);
  });
  ipcMain.handle('external:open', async (_e, url) => {
    if (url !== 'https://github.com/pokemon1742000-commits/PU') throw new Error('Đường dẫn không được phép.');
    await shell.openExternal(url);
    return true;
  });
  ipcMain.handle('update:list-versions', async (_event, operation) => listAvailableVersions(operation));
  ipcMain.handle('update:install-version', async (_event, operation, version) => installSelectedVersion(operation, version));
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
  ipcMain.handle('files:load', async (_e, kind, selections) => {
    const pending = serializeMutation(() => load(kind, selections));
    activeLoadPromise = pending;
    pending.then(
      () => { if (activeLoadPromise === pending) activeLoadPromise = null; },
      () => { if (activeLoadPromise === pending) activeLoadPromise = null; }
    );
    return pending;
  });
  ipcMain.handle('files:cancel', async () => {
    if (!activeImport || activeImport.phase === 'finalizing') return false;
    activeImport.controller.abort();
    return true;
  });
  ipcMain.handle('comparison:run', async (_e, settings) => {
    ensureFullDatasetAvailable('đối chiếu');
    const autoThreshold = typeof settings === 'object' ? settings.autoThreshold : settings;
    const confirmThreshold = typeof settings === 'object' ? settings.confirmationThreshold : confirmationThreshold;
    runComparison(Number(autoThreshold) || 91, Number(confirmThreshold));
    await saveWorkingSession();
    return await summary();
  });
  ipcMain.handle('review:resolve', async (_e, payload) => serializeMutation(async () => {
    const out = resolveReview(session, payload);
    Object.assign(session, out);
    await saveWorkingSession();
    return await summary();
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
    session.purchaseReplacements = await database.savePurchaseReplacements(projectCodes.map(projectCode => ({ projectCode, oldCode, newCode })));
    autoCompareWhenReady();
    return await summary();
  }));
  ipcMain.handle('purchase-replacement:delete', async (_e, payload) => serializeMutation(async () => {
    session.purchaseReplacements = await database.deletePurchaseReplacement(payload?.projectCode, payload?.oldCode);
    autoCompareWhenReady();
    return await summary();
  }));
  ipcMain.handle('data:rows', (_e, name, options) => rowsFor(name, options));
  ipcMain.handle('session:clear', async () => serializeMutation(async () => {
    // Chỉ xóa dữ liệu phiên trong SQLite; các bảng còn lại đã có bản sao giới hạn
    // trong session nên không cần đọc lại toàn bộ dữ liệu sau khi clear.
    const previousSession = session;
    const retainedLargeDatasets = new Set(previousSession.largeDatasets || []);
    retainedLargeDatasets.delete('scans');
    retainedLargeDatasets.delete('scan_raw');
    await database.clearWorkingSession();
    const workingSession = await database.readWorkingSession();
    applyThresholdSettings(workingSession);
    session = {
      ...emptySession(),
      purchaseAll:previousSession.purchaseAll,
      purchaseReplacements:previousSession.purchaseReplacements,
      warehouse:previousSession.warehouse,
      workshop:previousSession.workshop,
      jobCodes:previousSession.jobCodes,
      jobCodeDetails:previousSession.jobCodeDetails,
      jobCodeNotes:previousSession.jobCodeNotes,
      formatWarnings:workingSession.formatWarnings || [],
      sources:workingSession.sources || [],
      largeDatasets:retainedLargeDatasets
    };
    await refreshValidatedSession();
    return await summary();
  }));
  ipcMain.handle('database:delete', async (_e, keyword) => serializeMutation(async () => {
    if (keyword !== 'XÓA') throw new Error('Từ khóa xác nhận không đúng.');
    await database.backupAndClear();
    const jobCodeReference = await readBuiltInJobCodeReference();
    session = sessionWithBuiltInJobCodes(emptySession(), jobCodeReference);
    await refreshValidatedSession();
    return await summary();
  }));
  ipcMain.handle('database:backups', async () => database.listBackups());
  ipcMain.handle('database:restore', async (_e, fileName) => serializeMutation(async () => {
    await database.restoreBackup(fileName);
    const [purchaseAll, purchaseReplacements, scans, warehouse, workshop, workingSession, jobCodeReference] = await Promise.all([
      database.readPurchases(), database.readPurchaseReplacements(), database.readScans(), database.readWarehouse(), database.readWorkshop(), database.readWorkingSession(), readBuiltInJobCodeReference()
    ]);
    applyThresholdSettings(workingSession);
    session = sessionWithBuiltInJobCodes({ ...emptySession(), purchaseAll, purchaseReplacements, scans, warehouse, workshop, formatWarnings:workingSession.formatWarnings || [], sources:workingSession.sources || [], decisions:new Map(workingSession.decisions || []) }, jobCodeReference);
    await refreshValidatedSession();
    autoCompareWhenReady();
    return await summary();
  }));
  ipcMain.handle('export:save', async (_e, sheetNames) => {
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
    const list = Array.isArray(sheetNames) ? sheetNames.map(String) : [];
    const wantPu = list.includes(EXPORT_TYPES.PU), wantSource = list.includes(EXPORT_TYPES.SOURCE);
    const onlyPu = wantPu && !wantSource, onlySource = wantSource && !wantPu;
    const defaultPath = onlyPu ? `DoiChieu_PU_${stamp}.xlsx` : onlySource ? `DoiChieu_PR_PO_XGC_${stamp}.xlsx` : `DoiChieu_${stamp}.xlsx`;
    const result = await dialog.showSaveDialog(win, { defaultPath, filters: [{ name: 'Excel', extensions: ['xlsx'] }] });
    if (result.canceled) return { canceled: true };

    if (activeExport) throw new Error('Đang có tác vụ xuất khác đang chạy.');
    const controller = new AbortController();
    const isLarge = Boolean(session.largeDatasets?.size);
    activeExport = { controller, filePath:result.filePath };

    try {
      const workerResult = await runProgressWorker(
        path.join(__dirname, 'src', 'export-worker.js'),
        {
          dataDir: database.dir,
          filePath: result.filePath,
          sheetNames,
          isLarge,
          comparisonThreshold,
          confirmationThreshold,
          decisions: [...(session.decisions || new Map()).entries()],
          purchaseReplacements: session.purchaseReplacements,
          session: {
            comparison: session.comparison,
            purchase: session.purchase,
            scans: session.scans,
            warehouse: session.warehouse,
            workshop: session.workshop
          }
        },
        {
          onProgress: progress => sendExportProgress(progress)
        },
        { signal: controller.signal, timeoutMs:30 * 60 * 1000, heapLimitMb:1024, cancelCode:'EXPORT_CANCELLED' }
      );
      return { canceled: false, path: workerResult.path || result.filePath };
    } catch (error) {
      if (error?.code === 'EXPORT_CANCELLED') return { canceled:true };
      throw error;
    } finally {
      activeExport = null;
    }
  });
  ipcMain.handle('export:cancel', async () => {
    if (!activeExport) return false;
    const { controller, filePath } = activeExport;
    controller.abort();
    await removeExportTemporaryFiles(filePath);
    return true;
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

function sendImportProgress(progress) {
  if (win && !win.isDestroyed()) win.webContents.send('import:progress', progress);
}

function sendExportProgress(progress) {
  if (win && !win.isDestroyed()) win.webContents.send('export:progress', progress);
}

async function removeExportTemporaryFiles(filePath) {
  if (!filePath) return;
  try {
    const names = await fs.readdir(path.dirname(filePath));
    const prefix = `${path.basename(filePath)}.tmp-`;
    await Promise.all(names.filter(name => name.startsWith(prefix)).map(name => fs.rm(path.join(path.dirname(filePath), name), { force:true })));
  } catch (_) { /* The worker also removes its own temporary file. */ }
}

async function load(kind, selections) {
  if (activeImport) throw new Error('Đang có một tác vụ nạp dữ liệu khác.');
  const controller = new AbortController();
  const fileErrors = [];
  const successfulFiles = [];
  const warnings = [];
  let warningCount = 0;
  let loaded = 0;
  let rawImportWorker;
  activeImport = { controller, kind, phase:'staging', rawImportWorker:null };
  try {
    rawImportWorker = createRawImportWorker(database.dir);
    activeImport.rawImportWorker = rawImportWorker;

    for (const source of selections || []) {
      if (controller.signal.aborted) throw new Error('Đã hủy nạp dữ liệu.');
      let importId;
      try {
        importId = await rawImportWorker.beginRawImport(kind, source);
        const result = await runStreamingFileParser(
          path.join(__dirname, 'src', 'file-worker.js'),
          { kind, source, batchSize:IMPORT_BATCH_SIZE },
          {
            onBatch: async (rows, batchWarnings, progress) => {
              if (controller.signal.aborted) throw new Error('Đã hủy nạp dữ liệu.');
              await rawImportWorker.importRawBatch(kind, rows, importId);
              loaded += rows.length;
              warningCount += batchWarnings.length;
              if (warnings.length < MAX_FORMAT_WARNINGS) warnings.push(...batchWarnings.slice(0, MAX_FORMAT_WARNINGS - warnings.length));
              sendImportProgress({ kind, file:path.basename(source.path), ...progress, loaded, warningCount });
            }
          },
          { signal:controller.signal }
        );
        await rawImportWorker.commitRawImport(kind, importId);
        importId = null;
        successfulFiles.push(source.path);
        sendImportProgress({ kind, file:path.basename(source.path), complete:true, ...result, loaded, warningCount });
      } catch (error) {
        if (importId) await rawImportWorker.discardRawImport(importId);
        if (error?.code === 'IMPORT_CANCELLED' || controller.signal.aborted) throw error;
        fileErrors.push({ file:parserFileName(source), message:error.message || String(error) });
      }
    }
    await rawImportWorker.close();
    rawImportWorker = null;
    activeImport.rawImportWorker = null;
    if (!successfulFiles.length) {
      const detail = fileErrors.map(error => `${error.file}: ${error.message}`).join('; ');
      throw new Error(`Không thể đọc file ${kind === 'warehouse' ? 'Nhập Kho' : 'Excel'}: ${detail}`);
    }

    activeImport.phase = 'finalizing';
    sendImportProgress({ kind, phase:'finalizing', cancelable:false, loaded, warningCount, detail:'Đang hoàn tất dữ liệu đã nạp…' });
    await database.close();
    let finalized;
    try {
      finalized = await runProgressWorker(
        path.join(__dirname, 'src', 'import-finalizer-worker.js'),
        {
          dataDir:database.dir,
          kind,
          maxSessionRows:MAX_SESSION_ROWS,
          formatWarnings:warnings,
          decisions:[...(session.decisions || new Map()).entries()],
          comparisonThreshold,
          confirmationThreshold,
          purchaseReplacements:session.purchaseReplacements
        },
        { onProgress:progress => sendImportProgress({ kind, loaded, warningCount, ...progress }) },
        { signal:controller.signal }
      );
    } catch (error) {
      if (error?.code === 'IMPORT_CANCELLED') throw error;
      throw new Error(`Đã lưu dữ liệu gốc nhưng chưa thể hoàn tất bảng tổng hợp: ${error.message || String(error)}`);
    } finally {
      await database.init();
    }

    const patch = finalized.sessionPatch || {};
    Object.assign(session, patch);
    session.largeDatasets = new Set(patch.largeDatasets || []);
    const existingWarningKeys = new Set(session.formatWarnings.map(row => JSON.stringify([row.source, row.sourceFile, row.sourceRow, row.note, row.original])));
    for (const warning of warnings) {
      const key = JSON.stringify([warning.source, warning.sourceFile, warning.sourceRow, warning.note, warning.original]);
      if (!existingWarningKeys.has(key)) { session.formatWarnings.push(warning); existingWarningKeys.add(key); }
    }
    if (warningCount > warnings.length) session.formatWarnings.push({ source:'Hệ thống', note:`Đã ghi nhận thêm ${warningCount - warnings.length} cảnh báo định dạng; chỉ giữ ${MAX_FORMAT_WARNINGS} cảnh báo mới nhất trong phiên này.` });
    session.warnings = [...session.formatWarnings, ...(patch.warnings || [])].filter((row, index, rows) => {
      const key = JSON.stringify([row.source, row.sourceFile, row.sourceRow, row.note, row.original]);
      return rows.findIndex(candidate => JSON.stringify([candidate.source, candidate.sourceFile, candidate.sourceRow, candidate.note, candidate.original]) === key) === index;
    });
    session.sources.push(...successfulFiles.map(filePath => ({ kind, file:path.basename(filePath), path:filePath, loadedAt:new Date().toISOString() })));
    await Promise.all([
      kind === 'purchase' ? database.archiveSourceFiles(kind, successfulFiles) : Promise.resolve(),
      saveWorkingSession()
    ]);
    sendImportProgress({ kind, phase:'complete', cancelable:false, loaded, warningCount });
    return {
      ...(await summary()),
      loadStats:{ loaded, total:finalized.mergedStats?.total || 0, fileErrors, warningCount }
    };
  } finally {
    if (rawImportWorker) await rawImportWorker.close().catch(() => {});
    activeImport = null;
  }
}

async function rowsFor(name, options = {}) {
  const pageSize = Math.min(Math.max(Number(options.pageSize) || DEFAULT_PAGE_SIZE, 20), 2000);
  const requestedPage = Math.max(Number(options.page) || 1, 1);
  const query = String(options.query || '').trim().toLowerCase();
  const persistedTable = RAW_TABLES[name] || PERSISTED_TABLES[name];
  if (persistedTable) {
    const total = await database.countTableRows(persistedTable, query);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(requestedPage, totalPages);
    const start = (page - 1) * pageSize;
    let sourceRows = await database.readTablePage(persistedTable, { limit:pageSize, offset:start, query });
    if (name === 'purchase') sourceRows = annotatePurchaseReplacements(sourceRows);
    return { rows:sourceRows.map((row, index) => ({ ...row, stt:start + index + 1 })), page, pageSize, total, totalPages };
  }
  const map = {
    purchase: session.purchase, scan: session.scans, warehouse: session.warehouse, workshop: session.workshop, dataAudit:session.dataAudit,
    comparison: session.comparison, enough: session.enough, shortage: session.shortage,
    excess: session.excess, review: session.review, warnings: session.warnings,
    sources: session.sources, jobCodeDetails: session.jobCodeDetails
  };
  let sourceRows = name === 'jobCodes'
    ? session.jobCodes.map(code => ({ code, note: session.jobCodeNotes.get(code) || '' }))
    : (map[name] || []);
  if (name === 'purchase') sourceRows = annotatePurchaseReplacements(sourceRows);
  if (name === 'warnings') sourceRows = prioritizeProjectWarnings(sourceRows);
  const filtered = query
    ? sourceRows.filter(row => Object.values(row).some(value => String(value ?? '').toLowerCase().includes(query)))
    : sourceRows;
  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const start = (page - 1) * pageSize;
  const numberedTables = ['purchase', 'scan', 'warehouse', 'workshop', 'dataAudit', 'jobCodes', 'comparison', 'enough', 'shortage', 'excess', 'review', 'warnings', 'jobCodeDetails'];
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
  return runFileParser(path.join(__dirname, 'src', 'file-worker.js'), { action: 'inspect', filePath }, { heapLimitMb: 512 });
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

async function summary() {
  const counts = Object.fromEntries(['purchase','scans','warehouse','workshop','jobCodes','comparison','enough','shortage','excess','review','warnings'].map(k => [k, (session[k] || []).length]));
  counts.review = (session.review || []).filter(row => row.status === 'Chờ xác nhận').length;
  const [purchase, scan, warehouse, workshop, mergedPurchase, mergedScan, mergedWarehouse, mergedWorkshop] = await Promise.all([
    database.countTableRows('purchase_raw'), database.countTableRows('scan_raw'), database.countTableRows('warehouse_raw'), database.countTableRows('workshop_raw'),
    database.countTableRows('purchases'), database.countTableRows('scans'), database.countTableRows('warehouse'), database.countTableRows('workshop')
  ]);
  counts.purchase = mergedPurchase;
  counts.scans = mergedScan;
  counts.warehouse = mergedWarehouse;
  counts.workshop = mergedWorkshop;
  return {
    counts,
    sources: session.sources,
    rawCounts: { purchase, scan, warehouse, workshop, jobCodes: session.jobCodeDetails.length, warnings: purchase },
    autoThreshold: comparisonThreshold,
    confirmationThreshold,
    purchaseReplacements: session.purchaseReplacements,
    appVersion: app.getVersion()
  };
}

function ensureFullDatasetAvailable(action) {
  if (!session.largeDatasets?.size) return;
  throw new Error(`Chưa thể ${action} toàn bộ dữ liệu vì tập dữ liệu quá lớn để giữ an toàn trong RAM. Hãy lọc hoặc chia nhỏ file trước khi dùng chức năng này.`);
}

async function sessionWithRawDetails() {
  ensureFullDatasetAvailable('đọc toàn bộ dữ liệu');
  const [purchaseDetails, scanDetails, warehouseDetails, workshopDetails] = await Promise.all([
    database.readRawPurchases(), database.readRawScans(), database.readRawWarehouse(), database.readRawWorkshop()
  ]);
  return { ...session, purchaseDetails, scanDetails, warehouseDetails, workshopDetails };
}

async function refreshValidatedSession() {
  if (session.largeDatasets.has('purchases') || session.largeDatasets.has('purchase_raw')) {
    session.purchase = [];
    session.warnings = session.formatWarnings;
    return;
  }
  const purchases = filterPurchasesByProjectPrefix(session.purchaseAll);
  session.purchase = mergePurchaseRows(purchases.valid);
  const rawTotal = await database.countTableRows('purchase_raw');
  const purchaseDetails = rawTotal > MAX_SESSION_ROWS ? [] : await database.readTablePage('purchase_raw', { limit:MAX_SESSION_ROWS });
  if (rawTotal > MAX_SESSION_ROWS) session.largeDatasets.add('purchase_raw');
  const warningSource = purchaseDetails.length ? purchaseDetails : session.purchaseAll;
  const purchaseWarnings = filterPurchasesByProjectPrefix(warningSource).warnings;
  const purchaseFormatWarnings = session.formatWarnings.filter(row => row.source === 'Mua Hàng');
  session.warnings = [...purchaseFormatWarnings, ...session.formatWarnings.filter(row => row.source !== 'Mua Hàng'), ...purchaseWarnings].filter((row, index, rows) => {
    const key = JSON.stringify([row.source, row.sourceFile, row.sourceRow, row.note, row.original]);
    return rows.findIndex(candidate => JSON.stringify([candidate.source, candidate.sourceFile, candidate.sourceRow, candidate.note, candidate.original]) === key) === index;
  });
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
  if (session.largeDatasets?.size) return;
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

async function listAvailableVersions(operation) {
  if (!['update', 'rollback'].includes(operation)) throw new Error('Thao tác phiên bản không hợp lệ.');
  if (!app.isPackaged) return { operation, currentVersion:app.getVersion(), releases:[], message:`Chức năng ${operation === 'update' ? 'Update' : 'Restore'} chỉ hoạt động trên bản đã cài đặt.` };
  const releases = await fetchJson(`https://api.github.com/repos/${REPOSITORY.owner}/${REPOSITORY.name}/releases?per_page=100`);
  const candidates = releasesForOperation(releases, app.getVersion(), operation);
  return {
    operation,
    currentVersion:app.getVersion(),
    releases:candidates.map(release => ({ version:release.version, name:release.name || `v${release.version}`, publishedAt:release.published_at, hasInstaller:Boolean(selectInstallerAsset(release)) })),
    message:candidates.length ? '' : operation === 'update' ? 'Không có bản Update mới hơn.' : 'Không có bản Restore cũ hơn.'
  };
}

async function installSelectedVersion(operation, version) {
  if (!app.isPackaged) return setUpdateState({ status:'development', operation, message:`Chức năng ${operation === 'update' ? 'Update' : 'Restore'} chỉ hoạt động trên bản đã cài đặt.` });
  if (!['update', 'rollback'].includes(operation)) throw new Error('Thao tác phiên bản không hợp lệ.');
  if (['checking','downloading','installing','rollback-checking','rollback-downloading','rollback-installing'].includes(updateState.status)) return updateState;
  const temporaryFile = path.join(app.getPath('temp'), `doi-chieu-${operation}-${Date.now()}.exe`);
  const checkingStatus = operation === 'update' ? 'checking' : 'rollback-checking';
  const downloadingStatus = operation === 'update' ? 'downloading' : 'rollback-downloading';
  const installingStatus = operation === 'update' ? 'installing' : 'rollback-installing';
  const label = operation === 'update' ? 'Update' : 'Restore';
  setUpdateState({ status:checkingStatus, operation, targetVersion:String(version || ''), message:`Đang kiểm tra bản ${label}...`, percent:0, latestVersion:'' });
  try {
    const releases = await fetchJson(`https://api.github.com/repos/${REPOSITORY.owner}/${REPOSITORY.name}/releases?per_page=100`);
    const release = selectReleaseForOperation(releases, app.getVersion(), operation, version);
    if (!release) throw new Error(`Phiên bản ${version || ''} không hợp lệ hoặc không phù hợp với ${label}.`);
    const asset = selectInstallerAsset(release);
    if (!asset) throw new Error(`Bản ${release.version} không có bộ cài Setup hợp lệ.`);
    setUpdateState({ status:downloadingStatus, operation, targetVersion:release.version, message:`Đang tải bộ cài bản ${release.version}...`, percent:0 });
    await downloadFile(asset.browser_download_url, temporaryFile, percent => setUpdateState({ status:downloadingStatus, operation, targetVersion:release.version, percent, message:`Đang tải ${label} ${percent}%` }));
    await verifyDownloadedAsset(temporaryFile, asset);
    const choice = dialog.showMessageBoxSync(win, {
      type:'warning', buttons:[`Cài bản ${label} và khởi động lại`, 'Để sau'], defaultId:1, cancelId:1,
      title:`${label} phiên bản ứng dụng`,
      message:`${label} từ v${app.getVersion()} ${operation === 'update' ? 'lên' : 'về'} v${release.version}?`,
      detail:`Ứng dụng sẽ cài bộ cài chính thức v${release.version} rồi khởi động lại. Khi mở bản khác, toàn bộ dữ liệu SQLite cũ sẽ được xóa.`
    });
    if (choice !== 0) {
      await fs.rm(temporaryFile, { force:true });
      return setUpdateState({ status:'idle', operation, targetVersion:'', latestVersion:'', percent:0, message:`Đã hủy ${label}.` });
    }
    setUpdateState({ status:installingStatus, operation, targetVersion:release.version, message:`Đang cài bản ${label} v${release.version}...`, percent:100 });
    const child = spawn(temporaryFile, ['/S'], { detached:true, stdio:'ignore', windowsHide:true });
    child.unref();
    setTimeout(() => app.quit(), 250);
    return updateState;
  } catch (error) {
    await fs.rm(temporaryFile, { force:true }).catch(() => {});
    return setUpdateState({ status:'error', operation, targetVersion:'', message:`${label} thất bại: ${error.message}`, percent:0 });
  }
}
