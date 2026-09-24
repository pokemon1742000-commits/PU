const { processFiles, streamFileRows, listWorkbookSheets } = require('./processor');

function send(message) {
  return new Promise((resolve, reject) => {
    process.send(message, error => error ? reject(error) : resolve());
  });
}

function waitForAck(sequence) {
  return new Promise(resolve => {
    const listener = message => {
      if (message?.action !== 'ack' || message.sequence !== sequence) return;
      process.off('message', listener);
      resolve();
    };
    process.on('message', listener);
  });
}

async function execute(request) {
  return request.action === 'inspect'
    ? listWorkbookSheets(request.filePath)
    : processFiles(request.kind, request.files || request.filePaths);
}

async function stream(request) {
  const source = request.source || request.files?.[0];
  if (!source) throw new Error('Chưa chọn file để nạp.');
  let sequence = 0;
  const result = await streamFileRows(request.kind, source, async (rows, warnings, progress) => {
    const current = ++sequence;
    await send({ type:'batch', sequence:current, rows, warnings, progress });
    await waitForAck(current);
  }, { batchSize:request.batchSize });
  await send({ type:'completed', result });
}

process.once('message', request => {
  const task = request?.action === 'stream' ? stream(request) : execute(request);
  Promise.resolve(task)
    .then(result => {
      if (request?.action !== 'stream') return send({ ok:true, result });
      return undefined;
    })
    .catch(async error => {
      if (request?.action === 'stream') {
        try { await send({ type:'failed', error:error.message || String(error) }); } catch {}
        process.exit(1);
        return;
      }
      try { await send({ ok:false, error:error.message || String(error), stack:error.stack }); }
      finally { process.exit(1); }
    });
});
setTimeout(() => process.exit(1), 30 * 60 * 1000).unref();
