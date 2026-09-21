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

module.exports = { runFileParser, DEFAULT_HEAP_LIMIT, DEFAULT_TIMEOUT_MS };
