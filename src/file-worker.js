const { processFiles, listWorkbookSheets } = require('./processor');

async function execute(request) {
  return request.action === 'inspect'
    ? listWorkbookSheets(request.filePath)
    : processFiles(request.kind, request.files || request.filePaths);
}

function sendResult(message) {
  if (typeof process.send !== 'function') return;
  try {
    process.send(message, error => process.exit(error ? 1 : 0));
  } catch {
    process.exit(1);
  }
}

process.once('message', request => {
  Promise.resolve()
    .then(() => execute(request))
    .then(result => sendResult({ ok: true, result }))
    .catch(error => sendResult({ ok: false, error: error.message || String(error), stack: error.stack }));
});
setTimeout(() => process.exit(1), 10 * 60 * 1000).unref();
