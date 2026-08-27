const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const ExcelJS = require('exceljs');
const { buildComparison } = require('./processor');
const { exportWorkbookBuffer } = require('./exporter');
const { Database } = require('./storage');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function runSelfCheck(options = {}) {
  const rootDir = options.rootDir || path.join(__dirname, '..');
  const startedAt = Date.now();
  const checks = [];

  async function check(id, name, action) {
    const started = Date.now();
    try {
      const detail = await action();
      checks.push({ id, name, passed:true, detail:detail || 'Hoạt động đúng', durationMs:Date.now() - started });
    } catch (error) {
      checks.push({ id, name, passed:false, detail:error.message || String(error), durationMs:Date.now() - started });
    }
  }

  await check('files', 'Tệp cốt lõi và dữ liệu Job Code', async () => {
    const required = ['main.js', 'preload.js', 'renderer/index.html', 'assets/app-logo.png'];
    for (const relative of required) {
      const stat = await fs.stat(path.join(rootDir, relative));
      assert(stat.size > 0, `${relative} đang trống`);
    }
    const jobCodeFile = options.jobCodeFile || path.join(rootDir, 'assets', 'MKAC Monthly Timesheet.xlsx');
    assert((await fs.stat(jobCodeFile)).size > 0, 'Dữ liệu Job Code tích hợp đang trống');
    return `Đủ ${required.length + 1} tệp bắt buộc`;
  });

  await check('configuration', 'Cấu hình desktop và cập nhật GitHub', async () => {
    const packageJson = JSON.parse(await fs.readFile(path.join(rootDir, 'package.json'), 'utf8'));
    assert(packageJson.main === 'main.js', 'Điểm khởi động Electron không phải main.js');
    assert(packageJson.scripts?.start === 'electron .', 'npm start chưa được cấu hình chạy Electron');
    assert(packageJson.build?.publish?.provider === 'github', 'Chưa cấu hình nhà cung cấp cập nhật GitHub');
    assert(packageJson.build?.publish?.owner === 'pokemon1742000-commits', 'Sai tài khoản GitHub phát hành');
    assert(packageJson.build?.publish?.repo === 'PU', 'Sai repository GitHub phát hành');
    return `Desktop v${packageJson.version}, GitHub pokemon1742000-commits/PU`;
  });

  await check('exact-match', 'Đối chiếu mã chính xác và số lượng', () => {
    const result = buildComparison(
      [{ projectCode:'AUT-CHECK', purchaseOrder:'PR-CHECK', itemCode:'PART-001', quantity:4 }],
      [{ projectCode:'AUT-CHECK', drawingCode:'PART-001', quantity:3 }],
      [{ projectCode:'AUT-CHECK', itemCode:'PART-001', orderedQuantity:4, receivedQuantity:2 }],
      91, new Map(), 90
    );
    const row = result.comparison[0];
    assert(result.review.length === 0, 'Mã giống nhau lại bị đưa vào xác nhận');
    assert(row.purchaseQuantity === 4 && row.scanQuantity === 3 && row.warehouseQuantity === 2, 'Tổng số lượng đối chiếu không đúng');
    assert(result.shortage.length === 1, 'Dòng thiếu chưa được phân loại đúng');
    return 'Khớp dự án + mã hàng và phân loại thiếu đúng';
  });

  await check('gc-match', 'Quy tắc hậu tố _GC', () => {
    const result = buildComparison(
      [{ projectCode:'AUT-GC', purchaseOrder:'PR-GC', itemCode:'PART-002', quantity:2 }],
      [{ projectCode:'AUT-GC', drawingCode:'PART-002_GC', quantity:2 }],
      [{ projectCode:'AUT-GC', itemCode:'PART-002_GC', orderedQuantity:2, receivedQuantity:2, sourceKind:'workshop' }],
      100, new Map(), 99
    );
    const row = result.comparison[0];
    assert(result.review.length === 0, 'Mã chỉ khác _GC không được tự ghép');
    assert(row.purchaseQuantity === 2 && row.scanQuantity === 2 && row.warehouseQuantity === 2, 'Số lượng mã _GC không đúng');
    return 'PART-002 ↔ PART-002_GC được ghép đúng';
  });

  await check('pu-check', 'Quy tắc Note PU Check khi thiếu nguồn nhận hàng', async () => {
    const result = buildComparison(
      [{ projectCode:'AUT-PU', purchaseOrder:'PR-PU-001', itemCode:'PART-003', quantity:1 }],
      [{ projectCode:'AUT-PU', drawingCode:'PART-003', quantity:0 }],
      [], 91, new Map(), 90
    );
    const row = result.comparison[0];
    assert(row.hasReceiptRecord === false, 'Không nhận diện được việc thiếu dữ liệu Nhập Kho/XGC');
    const buffer = await exportWorkbookBuffer({ comparison:result.comparison });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.worksheets[0];
    assert(sheet.getCell('L10').value === 'PU Check', 'Excel không ghi PU Check vào cột Note');
    assert(!sheet.getCell('N10').value && !sheet.getCell('O10').value, 'Dòng không có nguồn nhận hàng lại xuất PO/hạn giao');
    return 'Note PU Check và PO/hạn giao được xuất đúng';
  });

  await check('database', 'Lưu và cập nhật cơ sở dữ liệu tạm', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'doi-chieu-self-check-'));
    try {
      const database = new Database(tempDir);
      await database.init();
      const first = await database.mergePurchases([{ projectCode:'AUT-DB', purchaseOrder:'PR-DB', itemCode:'PART-004', quantity:1 }]);
      const second = await database.mergePurchases([{ projectCode:'AUT-DB', purchaseOrder:'PR-DB', itemCode:'PART-004', quantity:2 }]);
      const workshop = await database.mergeWorkshop([{ projectCode:'AUT-DB', purchaseRequest:'MKS-DB', poNumber:'PO-DB', itemCode:'PART-004_GC', receivedQuantity:1 }]);
      assert(first.stats.added === 1, 'Không thêm được dữ liệu Mua Hàng mới');
      assert(second.stats.updated === 1 && second.rows[0].quantity === 2, 'Không cập nhật được dữ liệu Mua Hàng');
      assert(workshop.stats.added === 1 && (await database.readWorkshop()).length === 1, 'Không lưu được dữ liệu Xưởng Gia Công');
      return 'Thêm/cập nhật Mua Hàng và lưu XGC thành công';
    } finally {
      await fs.rm(tempDir, { recursive:true, force:true });
    }
  });

  const passed = checks.filter(item => item.passed).length;
  return {
    ok:passed === checks.length,
    passed,
    failed:checks.length - passed,
    total:checks.length,
    durationMs:Date.now() - startedAt,
    checkedAt:new Date().toISOString(),
    checks
  };
}

module.exports = { runSelfCheck };
