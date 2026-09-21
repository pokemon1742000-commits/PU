const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { runFileParser } = require('../src/file-runner');

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
