const { fork } = require('child_process');

const DEFAULT_HEAP_LIMIT = 4096;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

function runFileParser(entryPath, request = {}, options = {}) {
  const heapLimit = Number(options.heapLimitMb) || DEFAULT_HEAP_LIMIT;
  const timeoutMs = Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    const child = fork(entryPath, [], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      execArgv: [`--max-old-space-size=${heapLimit}`],
      stdio: ['ignore', 'ignore', 'ignore', 'ipc']
    });
    let settled = false;
    let timer;

    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.removeAllListeners();
      if (child.connected) child.disconnect();
      callback(value);
    };
    const rejectAndTerminate = error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.removeAllListeners();
      if (child.connected) child.disconnect();
      child.kill();
      reject(error);
    };

    timer = setTimeout(() => rejectAndTerminate(new Error('Đọc file Excel quá thời gian cho phép.')), timeoutMs);
    timer.unref?.();
    child.once('spawn', () => {
      if (settled) child.kill();
    });

    child.once('message', message => {
      if (message?.ok) finish(resolve, message.result);
      else finish(reject, new Error(message?.error || 'Tiến trình đọc Excel trả về lỗi không xác định.'));
    });
    child.once('error', error => rejectAndTerminate(error));
    child.once('exit', (code, signal) => {
      if (settled) return;
      const reason = signal
        ? `tín hiệu ${signal}`
        : `mã lỗi ${code ?? 'không xác định'}`;
      finish(reject, new Error(`Tiến trình đọc Excel đã dừng với ${reason}.`));
    });

    try {
      child.send(request, error => {
        if (error) rejectAndTerminate(error);
      });
    } catch (error) {
      rejectAndTerminate(error);
    }
  });
}

function importCancelledError() {
  const error = new Error('Đã hủy nạp dữ liệu.');
  error.code = 'IMPORT_CANCELLED';
  return error;
}

function runProgressWorker(entryPath, request = {}, handlers = {}, options = {}) {
  const heapLimit = Number(options.heapLimitMb) || 768;
  const timeoutMs = Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS;
  const signal = options.signal;
  return new Promise((resolve, reject) => {
    const child = fork(entryPath, [], {
      env:{ ...process.env, ELECTRON_RUN_AS_NODE:'1' },
      execArgv:[`--max-old-space-size=${heapLimit}`],
      stdio:['ignore','ignore','ignore','ipc']
    });
    let settled = false;
    let timer;
    const stop = () => {
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', onAbort);
      child.removeAllListeners();
      if (child.connected) child.disconnect();
      if (!child.killed) child.kill();
    };
    const fail = error => {
      if (settled) return;
      settled = true;
      stop();
      reject(error);
    };
    const done = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', onAbort);
      child.removeAllListeners();
      if (child.connected) child.disconnect();
      resolve(result);
    };
    const onAbort = () => fail(importCancelledError());
    if (signal?.aborted) return onAbort();
    signal?.addEventListener?.('abort', onAbort, { once:true });
    timer = setTimeout(() => fail(new Error('Tác vụ hoàn tất dữ liệu quá thời gian cho phép.')), timeoutMs);
    timer.unref?.();
    child.once('error', fail);
    child.once('exit', (code, exitSignal) => {
      if (settled) return;
      const reason = exitSignal ? `tín hiệu ${exitSignal}` : `mã lỗi ${code ?? 'không xác định'}`;
      fail(new Error(`Tiến trình hoàn tất dữ liệu đã dừng với ${reason}.`));
    });
    child.on('message', message => {
      if (message?.type === 'progress') {
        Promise.resolve(handlers.onProgress?.(message.progress || {})).catch(fail);
      } else if (message?.type === 'completed') {
        done(message.result || {});
      } else if (message?.type === 'failed') {
        fail(new Error(message.error || 'Tiến trình hoàn tất dữ liệu trả về lỗi không xác định.'));
      }
    });
    try {
      child.send(request, error => error && fail(error));
    } catch (error) { fail(error); }
  });
}

function runStreamingFileParser(entryPath, request = {}, handlers = {}, options = {}) {
  const heapLimit = Number(options.heapLimitMb) || 768;
  const timeoutMs = Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS;
  const signal = options.signal;
  return new Promise((resolve, reject) => {
    const child = fork(entryPath, [], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      execArgv: [`--max-old-space-size=${heapLimit}`],
      stdio: ['ignore', 'ignore', 'ignore', 'ipc']
    });
    let settled = false;
    let timer;

    const stop = () => {
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', onAbort);
      child.removeAllListeners();
      if (child.connected) child.disconnect();
      if (!child.killed) child.kill();
    };
    const fail = error => {
      if (settled) return;
      settled = true;
      stop();
      reject(error);
    };
    const done = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', onAbort);
      child.removeAllListeners();
      if (child.connected) child.disconnect();
      resolve(result);
    };
    const onAbort = () => fail(importCancelledError());
    const acknowledge = sequence => {
      if (!child.connected || settled) return;
      child.send({ action:'ack', sequence }, error => error && fail(error));
    };

    if (signal?.aborted) return onAbort();
    signal?.addEventListener?.('abort', onAbort, { once:true });
    timer = setTimeout(() => fail(new Error('Đọc file Excel quá thời gian cho phép.')), timeoutMs);
    timer.unref?.();
    child.once('error', fail);
    child.once('exit', (code, exitSignal) => {
      if (settled) return;
      const reason = exitSignal ? `tín hiệu ${exitSignal}` : `mã lỗi ${code ?? 'không xác định'}`;
      fail(new Error(`Tiến trình đọc Excel đã dừng với ${reason}.`));
    });
    child.on('message', async message => {
      try {
        if (message?.type === 'batch') {
          await handlers.onBatch?.(message.rows || [], message.warnings || [], message.progress || {});
          acknowledge(message.sequence);
          return;
        }
        if (message?.type === 'progress') {
          await handlers.onProgress?.(message.progress || {});
          return;
        }
        if (message?.type === 'completed') {
          done(message.result || {});
          return;
        }
        if (message?.type === 'failed') fail(new Error(message.error || 'Tiến trình đọc Excel trả về lỗi không xác định.'));
      } catch (error) {
        fail(error);
      }
    });
    try {
      child.send({ ...request, action:'stream' }, error => error && fail(error));
    } catch (error) {
      fail(error);
    }
  });
}

module.exports = { runFileParser, runProgressWorker, runStreamingFileParser, DEFAULT_HEAP_LIMIT, DEFAULT_TIMEOUT_MS };
