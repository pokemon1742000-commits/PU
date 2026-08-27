const path = require('path');
const { runSelfCheck } = require('../src/self-check');

runSelfCheck({ rootDir:path.join(__dirname, '..') }).then(result => {
  console.log(`\nTỰ KIỂM TRA PHẦN MỀM: ${result.ok ? 'ĐẠT' : 'KHÔNG ĐẠT'} (${result.passed}/${result.total})`);
  for (const item of result.checks) {
    console.log(`${item.passed ? '✓' : '✗'} ${item.name}: ${item.detail} (${item.durationMs} ms)`);
  }
  console.log(`Tổng thời gian: ${result.durationMs} ms\n`);
  if (!result.ok) process.exitCode = 1;
}).catch(error => {
  console.error(`Không thể chạy tự kiểm tra: ${error.stack || error.message}`);
  process.exitCode = 1;
});
