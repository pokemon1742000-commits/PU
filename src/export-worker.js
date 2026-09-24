/**
 * Export worker — runs in a child process to prevent the Electron main process
 * and renderer from freezing during large Excel exports.
 *
 * Protocol:
 *   Parent sends a start message (handled by the 'message' event below).
 *   This process sends progress messages: { type:'progress', progress:{ phase, processed, total, detail } }
 *   On success:                     { type:'completed', result:{ path } }
 *   On failure:                     { type:'failed', error:String }
 */

const fs = require('fs/promises');
const path = require('path');

async function removeTemporaryFiles(filePath) {
  if (!filePath) return;
  try {
    const directory = path.dirname(filePath);
    const prefix = `${path.basename(filePath)}.tmp-`;
    const names = await fs.readdir(directory);
    await Promise.all(names.filter(name => name.startsWith(prefix)).map(name => fs.rm(path.join(directory, name), { force:true })));
  } catch (_) { /* Best effort cleanup after a failed export. */ }
}

process.once('message', async (request) => {
  let temporaryFile = '';
  let database = null;
  try {
    const dataDir = String(request.dataDir || '');
    const filePath = String(request.filePath || '');
    temporaryFile = `${filePath}.tmp-${process.pid}-${Date.now()}`; /* normal exports use this path; large exporter creates its own temp */
    if (!filePath) throw new Error('Thiếu đường dẫn file xuất.');
    if (process.send) process.send({ type: 'progress', progress: { phase: 'preparing', detail: 'Đang chuẩn bị…', processed: 0, total: 0 } });

    const dataDirValue = dataDir;
    const sheetNamesValue = Array.isArray(request.sheetNames) ? request.sheetNames : [];
    const isLargeValue = Boolean(request.isLarge);
    const comparisonThresholdValue = Number(request.comparisonThreshold) || 91;
    const confirmationThresholdValue = Number(request.confirmationThreshold) || 90;
    const decisionsEntriesValue = Array.isArray(request.decisions) ? request.decisions : [];
    const purchaseReplacementsValue = Array.isArray(request.purchaseReplacements) ? request.purchaseReplacements : [];

    const send = (msg) => {
      if (process.send) process.send(msg);
    };

    let exportResult = null;

    if (isLargeValue) {
      const { Database } = require('./storage');
      database = new Database(dataDirValue);
      await database.init();

      const decisions = new Map(decisionsEntriesValue);

      send({ type: 'progress', progress: { phase: 'comparing', detail: 'Đang đọc dữ liệu và đối chiếu…', processed: 0, total: 0 } });

      const { exportWorkbookLarge } = require('./exporter');
      exportResult = await exportWorkbookLarge(filePath, sheetNamesValue, {
        database,
        comparisonThreshold: comparisonThresholdValue,
        confirmationThreshold: confirmationThresholdValue,
        decisions,
        purchaseReplacements: purchaseReplacementsValue,
        canonicalizeProject: require('./processor').canonicalProject,
        onProgress: (info) => {
          send({
            type: 'progress',
            progress: {
              phase: info.phase || 'comparing',
              detail: info.detail || 'Đang đối chiếu dữ liệu…',
              processed: info.processed || 0,
              total: info.total || 0,
              project: info.project || ''
            }
          });
        }
      });
    } else {
      const { exportWorkbook } = require('./exporter');
      send({ type: 'progress', progress: { phase: 'comparing', detail: 'Đang xây dựng báo cáo…', processed: 0, total: 0 } });
      send({ type: 'progress', progress: { phase: 'writing', detail: 'Đang ghi file Excel…', processed: 0, total: 0 } });
      await exportWorkbook(temporaryFile, sheetNamesValue, request.session || {});
      send({ type: 'progress', progress: { phase: 'finalizing', detail: 'Đang hoàn tất file Excel…', processed: 0, total: 0 } });
      await fs.rename(temporaryFile, filePath);
      temporaryFile = '';
    }

    send({ type: 'progress', progress: { phase: 'complete', detail: 'Hoàn tất!', processed: 0, total: 0 } });
    send({ type: 'completed', result: { path: filePath } });
  } catch (err) {
    if (temporaryFile) await fs.rm(temporaryFile, { force: true }).catch(() => {});
    await removeTemporaryFiles(request?.filePath);
    send({ type: 'failed', error: String(err.message || err) });
  } finally {
    if (database) {
      try { await database.close(); } catch (_) { /* ignore */ }
    }
  }
});

