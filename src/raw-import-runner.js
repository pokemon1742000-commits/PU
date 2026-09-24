const { fork } = require('child_process');

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;

function workerError(message) {
  const error = new Error(message?.error || 'Tiến trình lưu dữ liệu trả về lỗi không xác định.');
  if (message?.code) error.code = message.code;
  if (message?.stack) error.stack = message.stack;
  return error;
}

class RawImportWorker {
  constructor(dataDir, options = {}) {
    const heapLimit = Number(options.heapLimitMb) || 768;
    const timeoutMs = Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS;
    this.child = fork(options.entryPath || require.resolve('./raw-import-worker'), [], {
      env:{ ...process.env, ELECTRON_RUN_AS_NODE:'1' },
      execArgv:[`--max-old-space-size=${heapLimit}`],
      stdio:['ignore','ignore','ignore','ipc']
    });
    this.nextId = 1;
    this.pending = new Map();
    this.closed = false;
    this.failed = null;
    this.timeout = setTimeout(() => this.failAll(new Error('Tiến trình lưu dữ liệu quá thời gian cho phép.')), timeoutMs);
    this.timeout.unref?.();
    this.ready = new Promise((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    this.child.on('message', message => this.handleMessage(message));
    this.child.once('error', error => this.failAll(error));
    this.child.once('exit', (code, signal) => {
      if (this.closed) return;
      const reason = signal ? `tín hiệu ${signal}` : `mã lỗi ${code ?? 'không xác định'}`;
      this.failAll(new Error(`Tiến trình lưu dữ liệu đã dừng với ${reason}.`));
    });
    try {
      this.child.send({ action:'init', dataDir }, error => error && this.failAll(error));
    } catch (error) { this.failAll(error); }
  }

  handleMessage(message) {
    if (message?.type === 'ready') {
      this.resolveReady?.(true);
      this.resolveReady = null;
      this.rejectReady = null;
      return;
    }
    if (message?.type === 'failed') {
      this.failAll(workerError(message));
      return;
    }
    if (message?.type === 'closed') {
      this.closed = true;
      clearTimeout(this.timeout);
      this.resolveClose?.(true);
      this.resolveClose = null;
      this.rejectClose = null;
      return;
    }
    if (message?.type !== 'response') return;
    const request = this.pending.get(message.id);
    if (!request) return;
    this.pending.delete(message.id);
    if (message.ok) request.resolve(message.result);
    else request.reject(workerError(message));
  }

  failAll(error) {
    if (this.failed) return;
    this.failed = error;
    clearTimeout(this.timeout);
    this.rejectReady?.(error);
    this.resolveReady = null;
    this.rejectReady = null;
    for (const request of this.pending.values()) request.reject(error);
    this.pending.clear();
    this.rejectClose?.(error);
    this.resolveClose = null;
    this.rejectClose = null;
  }

  async call(method, ...args) {
    await this.ready;
    if (this.failed) throw this.failed;
    if (this.closed) throw new Error('Tiến trình lưu dữ liệu đã đóng.');
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        this.child.send({ action:'call', id, method, args }, error => {
          if (!error) return;
          this.pending.delete(id);
          reject(error);
        });
      } catch (error) {
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  beginRawImport(kind, source) { return this.call('beginRawImport', kind, source); }
  importRawBatch(kind, rows, importId) { return this.call('importRawBatch', kind, rows, importId); }
  commitRawImport(kind, importId) { return this.call('commitRawImport', kind, importId); }
  discardRawImport(importId) { return this.call('discardRawImport', importId); }

  async close() {
    if (this.closed) return;
    if (this.failed) {
      this.closed = true;
      try { if (this.child.connected) this.child.disconnect(); } catch {}
      if (!this.child.killed) this.child.kill();
      return;
    }
    await this.ready;
    if (this.closed) return;
    await new Promise((resolve, reject) => {
      this.resolveClose = resolve;
      this.rejectClose = reject;
      try {
        this.child.send({ action:'close' }, error => error && reject(error));
      } catch (error) { reject(error); }
    });
    try { if (this.child.connected) this.child.disconnect(); } catch {}
  }
}

function createRawImportWorker(dataDir, options) {
  return new RawImportWorker(dataDir, options);
}

module.exports = { RawImportWorker, createRawImportWorker, DEFAULT_TIMEOUT_MS };
