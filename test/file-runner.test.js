const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { runFileParser, runStreamingFileParser } = require('../src/file-runner');

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
