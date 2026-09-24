const { finalizeImport } = require('./import-finalizer');

function send(message) {
  return new Promise((resolve, reject) => {
    process.send(message, error => error ? reject(error) : resolve());
  });
}

process.once('message', request => {
  finalizeImport({
    ...request,
    onProgress: progress => send({ type:'progress', progress }).catch(() => {})
  }).then(result => send({ type:'completed', result }))
    .catch(async error => {
      try { await send({ type:'failed', error:error.message || String(error) }); } catch {}
      process.exitCode = 1;
    });
});

setTimeout(() => process.exit(1), 30 * 60 * 1000).unref();
