const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { runFileParser, runProgressWorker, runStreamingFileParser } = require('../src/file-runner');
const { createRawImportWorker } = require('../src/raw-import-runner');
const { Database } = require('../src/storage');

async function withScript(source, request = {}, options = {}) {
  const file = path.join(os.tmpdir(), `file-runner-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.js`);
  await fs.writeFile(file, source);
  try { return await runFileParser(file, request, options); }
  finally { await fs.rm(file, { force:true }); }
}

test('resolves parser responses from a child process', async () => {
  const result = await withScript("process.once('message', request => process.send({ ok:true, result:{ received:request.value } }, error => process.exit(error ? 1 : 0)));", { value:'value' }, { timeoutMs:5000 });
  assert.deepEqual(result, { received:'value' });
});

test('rejects when the parser child exits unexpectedly', async () => {
  await assert.rejects(withScript('process.exit(23);', {}, { timeoutMs:5000 }), /mã lỗi 23|dừng với/);
});

test('rejects and terminates a parser that exceeds its timeout', async () => {
  await assert.rejects(withScript("setInterval(() => {}, 1000);", {}, { timeoutMs:50 }), /quá thời gian/);
});

test('streams batches in order and waits for async persistence before acknowledgement', async () => {
  const script = `
    function wait(sequence) { return new Promise(resolve => process.on('message', message => message?.action === 'ack' && message.sequence === sequence && resolve())); }
    process.once('message', async request => {
      await new Promise((resolve, reject) => process.send({ type:'batch', sequence:1, rows:[{ id:1 }], warnings:[], progress:{ processed:1 } }, error => error ? reject(error) : resolve()));
      await wait(1);
      await new Promise((resolve, reject) => process.send({ type:'batch', sequence:2, rows:[{ id:2 }], warnings:[], progress:{ processed:2 } }, error => error ? reject(error) : resolve()));
      await wait(2);
      process.send({ type:'completed', result:{ emitted:2 } });
    });`;
  const file = path.join(os.tmpdir(), `file-stream-${process.pid}-${Date.now()}.js`);
  await fs.writeFile(file, script);
  const received = [];
  try {
    const result = await runStreamingFileParser(file, {}, {
      onBatch: async rows => {
        received.push(rows[0].id);
        if (rows[0].id === 1) await new Promise(resolve => setTimeout(resolve, 30));
      }
    }, { timeoutMs:5000 });
    assert.deepEqual(received, [1, 2]);
    assert.deepEqual(result, { emitted:2 });
  } finally { await fs.rm(file, { force:true }); }
});

test('cancels a streaming parser through an abort signal', async () => {
  const controller = new AbortController();
  const file = path.join(os.tmpdir(), `file-stream-cancel-${process.pid}-${Date.now()}.js`);
  await fs.writeFile(file, "process.once('message', () => setInterval(() => {}, 1000));");
  try {
    const pending = runStreamingFileParser(file, {}, {}, { timeoutMs:5000, signal:controller.signal });
    controller.abort();
    await assert.rejects(pending, /Đã hủy nạp dữ liệu/);
  } finally { await fs.rm(file, { force:true }); }
});

test('runs parser with custom heap limit option', async () => {
  const result = await withScript("process.once('message', () => { const v8 = require('v8'); process.send({ ok:true, result:{ heapLimitMb: Math.round(v8.getHeapStatistics().heap_size_limit / 1024 / 1024) } }); });", {}, { heapLimitMb:512, timeoutMs:5000 });
  assert.ok(result.heapLimitMb >= 400 && result.heapLimitMb <= 600, `Expected ~512MB heap limit, got ${result.heapLimitMb}`);
});

test('resolves a progress worker only after completion', async () => {
  const file = path.join(os.tmpdir(), `progress-worker-${process.pid}-${Date.now()}.js`);
  await fs.writeFile(file, "process.once('message', async () => { process.send({ type:'progress', progress:{ phase:'rebuilding' } }); await new Promise(resolve => setTimeout(resolve, 20)); process.send({ type:'completed', result:{ ok:true } }); });");
  const phases = [];
  try {
    const result = await runProgressWorker(file, {}, { onProgress: progress => phases.push(progress.phase) }, { timeoutMs:5000 });
    assert.deepEqual(phases, ['rebuilding']);
    assert.deepEqual(result, { ok:true });
  } finally { await fs.rm(file, { force:true }); }
});

test('raw import worker stages, commits, and discards through SQLite child process', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'raw-import-worker-'));
  const database = new Database(dir);
  await database.init();
  const worker = createRawImportWorker(dir, { timeoutMs:5000 });
  t.after(async () => { await worker.close().catch(() => {}); await database.close(); await fs.rm(dir, { recursive:true, force:true }); });

  const committed = await worker.beginRawImport('purchase', { path:path.join(dir, 'purchase.xlsx') });
  await worker.importRawBatch('purchase', [{ purchaseOrder:'PR-1', itemCode:'A', sourceFile:'purchase.xlsx', sourceSheet:'Data', sourceRow:1 }], committed);
  await worker.commitRawImport('purchase', committed);
  assert.equal((await database.readRawPurchases()).length, 1);

  const discarded = await worker.beginRawImport('purchase', { path:path.join(dir, 'discard.xlsx') });
  await worker.importRawBatch('purchase', [{ purchaseOrder:'PR-2', itemCode:'B', sourceFile:'discard.xlsx', sourceSheet:'Data', sourceRow:1 }], discarded);
  await worker.discardRawImport(discarded);
  assert.equal((await database.readRawPurchases()).length, 1);
});
