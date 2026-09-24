const { Database } = require('./storage');

const METHODS = new Set(['beginRawImport', 'importRawBatch', 'commitRawImport', 'discardRawImport']);
let database = null;
let queue = Promise.resolve();
let closing = false;

function send(message) {
  return new Promise((resolve, reject) => {
    if (!process.connected) return reject(new Error('Tiến trình lưu dữ liệu đã ngắt kết nối.'));
    process.send(message, error => error ? reject(error) : resolve());
  });
}

async function initialize(dataDir) {
  database = new Database(dataDir);
  await database.init();
  await send({ type:'ready' });
}

function enqueue(task) {
  const run = queue.then(task, task);
  queue = run.catch(() => {});
  return run;
}

function serializeError(error) {
  return { error:error?.message || String(error), code:error?.code, stack:error?.stack };
}

process.on('message', message => {
  if (message?.action === 'init') {
    enqueue(() => initialize(message.dataDir)).catch(async error => {
      try { await send({ type:'failed', ...serializeError(error) }); } catch {}
      process.exitCode = 1;
    });
    return;
  }
  if (message?.action === 'call') {
    const id = message.id;
    if (!METHODS.has(message.method)) {
      send({ type:'response', id, ok:false, error:'Phương thức lưu dữ liệu không được phép.' }).catch(() => {});
      return;
    }
    enqueue(async () => {
      if (!database) throw new Error('Tiến trình lưu dữ liệu chưa khởi tạo.');
      if (closing) throw new Error('Tiến trình lưu dữ liệu đang đóng.');
      return database[message.method](...(message.args || []));
    }).then(result => send({ type:'response', id, ok:true, result }))
      .catch(error => send({ type:'response', id, ok:false, ...serializeError(error) }).catch(() => {}));
    return;
  }
  if (message?.action === 'close') {
    closing = true;
    enqueue(async () => {
      if (database) await database.close();
      await send({ type:'closed' });
      process.exit(0);
    }).catch(async error => {
      try { await send({ type:'failed', ...serializeError(error) }); } catch {}
      process.exitCode = 1;
    });
  }
});

setTimeout(() => process.exit(1), 30 * 60 * 1000).unref();
