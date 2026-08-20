const { parentPort, workerData } = require('worker_threads');
const { processFiles, listWorkbookSheets } = require('./processor');

(async () => {
  try {
    const result = workerData.action === 'inspect'
      ? await listWorkbookSheets(workerData.filePath)
      : await processFiles(workerData.kind, workerData.files || workerData.filePaths);
    parentPort.postMessage({ ok: true, result });
  } catch (error) {
    parentPort.postMessage({ ok: false, error: error.message || String(error), stack: error.stack });
  }
})();
