const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', 'renderer');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const js = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const preload = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
const exporter = fs.readFileSync(path.join(__dirname, '..', 'src', 'exporter.js'), 'utf8');
const processor = fs.readFileSync(path.join(__dirname, '..', 'src', 'processor.js'), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
const releaseAuto = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'release-auto.ps1'), 'utf8');
const builtInJobCodeFile = path.join(__dirname, '..', 'assets', 'MKAC Monthly Timesheet.xlsx');
const appLogoFile = path.join(__dirname, '..', 'assets', 'app-logo.png');

test('all direct renderer ID references exist in the HTML', () => {
  const referenced = [...js.matchAll(/\$\('#([A-Za-z][\w:-]*)'\)/g)].map(match => match[1]);
  const missing = [...new Set(referenced)].filter(id => !html.includes(`id="${id}"`));
  assert.deepEqual(missing, []);
});

test('HTML element IDs are unique', () => {
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
  const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  assert.deepEqual(duplicates, []);
});

test('reference UI structure and all four themes are present', () => {
  for (const className of ['app-header','app-shell','sidebar','tabbar','stats-grid','table-wrap','theme-dots']) {
    assert.match(html, new RegExp(`class="[^"]*${className}`));
  }
  for (const theme of ['theme-mint','theme-sky','theme-lavender']) assert.match(css, new RegExp(theme));
});

test('navigation uses one table selector and keeps compact controls in their requested positions', () => {
  assert.doesNotMatch(html, /Xem nhanh/);
  assert.doesNotMatch(html, /File đã nạp/);
  assert.doesNotMatch(html, /class="side-status"/);
  assert.doesNotMatch(html, /class="[^"]*raw-tabs/);
  assert.doesNotMatch(css, /\.raw-tabs/);
  assert.match(html, /class="sidebar-threshold"[\s\S]*class="[^"]*sidebar-job-code/);
  assert.doesNotMatch(html, /id="runComparison"/);
  assert.match(html, /class="[^"]*sidebar-job-code[\s\S]*class="theme-dots"/);

  const topTabs = html.match(/<div class="tab-items">([\s\S]*?)<\/div><\/nav>/)?.[1] || '';
  assert.doesNotMatch(topTabs, /data-open-table="jobCodes"/);
});

test('file import supports multiple files and explicit multi-sheet selection', () => {
  assert.match(main, /properties: \['openFile', 'multiSelections'\]/);
  assert.match(main, /files:load/);
  assert.match(main, /inspectFileInWorker/);
  assert.match(html, /id="sheetPicker"/);
  assert.match(html, /một hoặc nhiều sheet/);
  assert.match(js, /chooseSheets/);
  assert.match(js, /window\.api\.loadFiles/);
  assert.match(js, /button\.disabled=true/);
  assert.match(js, /setImportBusy\(false\)/);
  assert.match(js, /setTimeout\(applyThreshold,350\)/);
});

test('workshop import exposes the XGC button, table, mapping, and raw-data view', () => {
  assert.match(html, /data-kind="workshop"[\s\S]*Tổng hợp đơn hàng sản xuất/);
  assert.match(html, /data-open-table="workshop"/);
  assert.match(html, /id="dashWorkshop"/);
  for (const label of ['Số PR \\(MKS\\)','Số PO','Ngày PR','Mã hàng','Tên hàng','Số lượng đặt','Hạn ngày về','Số lượng nhập kho','Ngày nhập kho']) {
    assert.match(js, new RegExp(label));
  }
  assert.match(js, /workshop:'workshopDetails'/);
  assert.match(processor, /if \(kind === 'workshop'\) return processWorkshop\(files\)/);
  assert.match(processor, /if \(!itemCode\) continue/);
  assert.doesNotMatch(processor, /if \(!\/_GC\$\/i\.test\(itemCode\)\) continue/);
});

test('imports stream into SQLite with staging, progress, cancellation, and durable source data', () => {
  assert.match(main, /runStreamingFileParser/);
  assert.match(main, /createRawImportWorker\(database\.dir\)/);
  assert.match(main, /rawImportWorker\.beginRawImport\(kind, source\)/);
  assert.match(main, /rawImportWorker\.importRawBatch\(kind, rows, importId\)/);
  assert.match(main, /rawImportWorker\.commitRawImport\(kind, importId\)/);
  assert.match(main, /rawImportWorker\.discardRawImport\(importId\)/);
  assert.match(main, /await rawImportWorker\.close\(\)/);
  assert.match(main, /runProgressWorker/);
  assert.match(main, /phase:'finalizing'/);
  assert.match(main, /cancelable:false/);
  assert.doesNotMatch(main, /database\.rebuildMergedFromRaw\(kind, \{ includeRows:false \}\)/);
  assert.match(main, /ipcMain\.handle\('files:cancel'/);
  assert.match(preload, /cancelImport:.*files:cancel/);
  assert.match(preload, /onImportProgress/);
  assert.match(html, /id="importProgress"/);
  assert.match(html, /id="cancelImport"/);
  assert.match(js, /window\.api\.onImportProgress\(renderImportProgress\)/);
  assert.match(js, /window\.api\.cancelImport\(\)/);
  assert.match(main, /database\.clearWorkingSession\(\)/);
  assert.match(main, /decisions:new Map\(workingSession\.decisions \|\| \[\]\)/);
  assert.match(js, /Dữ liệu Mua Hàng, Nhập Kho và Xưởng Gia Công sẽ được giữ lại/);
});

test('Job Code uses the bundled MKAC reference without a manual import row', () => {
  assert.equal(fs.existsSync(builtInJobCodeFile), true);
  assert.doesNotMatch(html, /data-kind="reference"/);
  assert.doesNotMatch(html, /Danh sách Job Code/);
  assert.match(html, /data-open-table="jobCodes"[\s\S]*Xem Job Code/);
  assert.match(main, /BUILT_IN_JOB_CODE_FILE = path\.join\(app\.isPackaged \? process\.resourcesPath : __dirname, 'assets', 'MKAC Monthly Timesheet\.xlsx'\)/);
  assert.match(main, /processFilesInWorker\('reference', \[\{ path: BUILT_IN_JOB_CODE_FILE, sheets: \['Job code'\] \}\]\)/);
  assert.match(main, /sessionWithBuiltInJobCodes/);
  assert.equal(packageJson.build.extraResources[0].from, 'assets/MKAC Monthly Timesheet.xlsx');
  assert.match(releaseAuto, /'assets'/);
});

test('sidebar exposes separate auto-match and confirmation thresholds', () => {
  assert.match(html, /id="threshold"[\s\S]*id="confirmationThreshold"/);
  assert.match(html, /value="91"[\s\S]*value="90"/);
  assert.match(html, /Dưới ngưỡng xác nhận sẽ tự động bỏ qua việc ghép và không đưa vào trang Xác Nhận/);
  assert.match(js, /confirmationThreshold:Number/);
  assert.match(main, /let comparisonThreshold = 91/);
  assert.match(main, /let confirmationThreshold = 90/);
  assert.match(main, /confirmationThreshold = Math\.max\(0, Math\.min\([^\n]*comparisonThreshold - 1\)\)/);
  assert.match(css, /\.threshold-setting/);
});

test('data tables expose column keys for compact wrapping rules', () => {
  assert.match(js, /data-column=/);
  assert.match(css, /data-column="itemName"/);
  assert.match(css, /overflow-wrap: anywhere/);
  assert.match(js, /title=.*escapeHtml\(value\)/);
  assert.match(css, /-webkit-line-clamp: 3/);
  assert.match(js, /tooltip=value!==''/);
  assert.match(css, /td \.cell-value/);
  assert.match(js, /warehouse:.*\['note','Ghi chú'\]/);
  assert.match(css, /white-space: nowrap/);
});

test('tables provide one centered numbered pagination above the data', () => {
  assert.match(html, /id="paginationTop"/);
  assert.doesNotMatch(html, /id="paginationBottom"/);
  assert.match(js, /paginationSequence/);
  assert.match(js, /#paginationTop \.page-icon/);
  assert.doesNotMatch(js, /paginationBottom/);
  assert.match(html, /id="tablePageSize"/);
  assert.match(html, /<option value="50">50<\/option>[\s\S]*<option value="100" selected>100<\/option>[\s\S]*<option value="200">200<\/option>/);
  assert.match(js, /tablePageSize/);
  assert.match(js, /pageSize=Number\(\$\('#tablePageSize'\)\.value\)\|\|100/);
  assert.match(js, /tablePageSize.*loadTablePage\(1\)/);
  assert.match(css, /\.page-size-control/);
  assert.match(css, /\.page-icon/);
  assert.match(css, /border-radius: 50%/);
  assert.match(css, /\.pagination[\s\S]*justify-content: center/);
  assert.match(css, /\.page-summary[\s\S]*position: absolute[\s\S]*left: 2px/);
  assert.match(css, /#data\.active[\s\S]*overflow: hidden/);
  assert.match(css, /#data \.discrepancy-block \.table-wrap[\s\S]*max-height: none/);
});

test('Excel export contains the report sheet and PR versus PO/XGC sheet without confirmations', () => {
  assert.match(html, /class="header-actions"[\s\S]*id="infoBtn"[\s\S]*id="exportBtn"/);
  assert.doesNotMatch(html, /id="exportSettingsBtn"/);
  const topTabs = html.match(/<div class="tab-items">([\s\S]*?)<\/div><\/nav>/)?.[1] || '';
  assert.doesNotMatch(topTabs, /Xuất báo cáo/);
  assert.doesNotMatch(js, /review:'Xác Nhận'/);
  assert.match(exporter, /const rows = session\.comparison \|\| \[\]/);
  assert.match(exporter, /const ws = wb\.addWorksheet/);
  assert.doesNotMatch(exporter, /session\.review|appendReviewSection/);
  assert.match(html, /một file gồm sheet số liệu xuất kho và sheet đối chiếu PR với PO \+ XGC/);
  assert.match(js, /exportExcel\(\['comparison'\]\)/);
  assert.match(js, /2 sheet dữ liệu đối chiếu/);
  assert.doesNotMatch(js, /sheetOptions input:checked/);
});

test('export page offers opening the most recently exported file', () => {
  assert.match(html, /id="openExportFileBtn"[^>]*hidden[^>]*>Mở file xuất/);
  assert.match(preload, /openExportFile:.*export:open/);
  assert.match(main, /ipcMain\.handle\('export:open'/);
  assert.match(main, /shell\.openPath\(target\)/);
  assert.match(js, /lastExportPath=r\.path/);
  assert.match(js, /window\.api\.openExportFile\(lastExportPath\)/);
});

test('application branding hides the native menu and shows the logo with the current version', () => {
  assert.equal(fs.existsSync(appLogoFile), true);
  assert.match(html, /class="app-brand"[\s\S]*src="\.\.\/assets\/app-logo\.png"[\s\S]*id="headerVersion"/);
  assert.match(js, /headerVersion'\)\.textContent=versionLabel/);
  assert.match(main, /Menu\.setApplicationMenu\(null\)/);
  assert.match(main, /autoHideMenuBar: true/);
  assert.match(main, /win\.setMenuBarVisibility\(false\)/);
  assert.match(main, /icon: path\.join\(__dirname, 'assets', 'app-logo\.png'\)/);
  assert.equal(packageJson.build.win.icon, 'assets/app-logo.ico');
  assert.equal(fs.existsSync(path.join(__dirname, '..', packageJson.build.win.icon)), true);
  assert.equal(packageJson.build.compression, 'store');
  assert.equal(packageJson.build.files.includes('assets/app-logo.png'), true);
});

test('application information dialog shows version-specific improvements and the GitHub project link', () => {
  assert.match(html, /id="infoDialog"[\s\S]*id="appVersion"[\s\S]*id="githubLink"/);
  for (const version of ['1.0.11','1.0.10','1.0.9','1.0.8','1.0.7','1.0.6','1.0.5','1.0.4','1.0.3','1.0.2','1.0.1','1.0.0']) assert.match(html, new RegExp(`data-version="${version.replaceAll('.', '\\.')}"`));
  assert.match(html, /Lịch sử cải tiến/);
  assert.match(html, /current-version-badge/);
  assert.match(js, /note\.dataset\.version===version/);
  assert.match(js, /infoDialog'\)\.showModal\(\)/);
  assert.match(js, /window\.api\.openExternal\('https:\/\/github\.com\/pokemon1742000-commits\/PU'\)/);
  assert.match(preload, /openExternal: url => ipcRenderer\.invoke\('external:open', url\)/);
  assert.match(main, /appVersion: app\.getVersion\(\)/);
  assert.match(main, /app\.requestSingleInstanceLock\(\)/);
  assert.match(main, /showErrorBox/);
  assert.match(main, /DATABASE_CORRUPT_NO_BACKUP/);
  assert.match(main, /showMessageBoxSync/);
  assert.match(main, /Tạo database mới/);
  assert.match(main, /defaultId:1/);
  assert.match(main, /cancelId:1/);
  assert.match(main, /createFreshDatabaseAfterRecovery/);
  assert.match(main, /không có backup hợp lệ/);
  assert.match(main, /prepareDataVersion/);
  assert.match(main, /completeDataVersion/);
  assert.ok(main.indexOf('prepareDataVersion') < main.indexOf('new Database'));
  assert.ok(main.indexOf('await initializeApplication();') < main.indexOf('await completeDataVersion'));
  assert.match(main, /ipcMain\.handle\('external:open'/);
  assert.match(main, /shell\.openExternal\(url\)/);
});

test('information dialog includes a detailed first-use guide with one screenshot per feature step', () => {
  assert.match(html, /data-info-panel="releaseInfo"/);
  assert.match(html, /data-info-panel="guideInfo"/);
  for (const title of ['Bắt đầu và nạp dữ liệu','Đọc dữ liệu và tinh chỉnh đối chiếu','Xác nhận và xem kết quả','Các chức năng quản trị dữ liệu','Gặp lỗi thì xử lý theo thứ tự này']) assert.match(html, new RegExp(title));
  const guideFiles = ['guide-01-import.png','guide-02-sheet-picker.png','guide-03-table-tools.png','guide-04-threshold-theme.png','guide-05-confirm.png','guide-06-results-export.png','guide-07-replacements.png','guide-08-database.png','guide-09-export.png'];
  for (const file of guideFiles) assert.match(html, new RegExp(file.replace('.', '\\.'), 'g'));
  assert.match(js, /function showInfoPanel\(panelId\)/);
  assert.match(css, /\.guide-feature/);
  assert.match(css, /\.guide-troubleshooting/);
  assert.doesNotMatch(html, /guide-actual-controls\.png/);
  assert.equal(packageJson.build.files.includes('assets/guide-*.png'), true);
});

test('guide screenshot generator uses square target boxes and safe demo states', () => {
  const generator = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'generate-guide-images.js'), 'utf8');
  const guidePreload = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'guide-preload.js'), 'utf8');
  assert.match(generator, /capture-target-box/);
  assert.match(generator, /getBoundingClientRect\(\)/);
  assert.match(generator, /guide-09-export\.png/);
  assert.match(guidePreload, /MEC2205011/);
  assert.match(guidePreload, /AUTM260552/);
  assert.doesNotMatch(generator, /border-radius:999px/);
});

test('raw-data eye control is placed below the table heading', () => {
  assert.match(html, /class="[^"]*table-view-header[^"]*"[\s\S]*class="table-toolbar"[\s\S]*id="rawToggle"/);
  assert.match(css, /\.table-side-actions/);
});

test('purchase warning shortcut sits above the raw-data eye in a taller glass toolbar', () => {
  const topTabs = html.match(/<div class="tab-items">([\s\S]*?)<\/div><\/nav>/)?.[1] || '';
  assert.doesNotMatch(topTabs, /data-open-table="warnings"/);
  assert.match(html, /id="tableSideActions"[\s\S]*id="warningShortcut"[\s\S]*id="rawToggle"/);
  assert.match(js, /activeTable==='warnings'\?'purchase':'warnings'/);
  assert.match(css, /\.table-toolbar[\s\S]*min-height: 96px/);
  assert.match(css, /\.table-side-actions[\s\S]*backdrop-filter: blur\(20px\)/);
  assert.match(css, /Translucent glass surfaces[\s\S]*\.tabbar[\s\S]*\.table-wrap[\s\S]*backdrop-filter: blur\(22px\)/);
});

test('grouped sheets provide an eye toggle for raw imported rows', () => {
  assert.match(html, /id="rawToggle"/);
  assert.match(html, /<svg[^>]*viewBox="0 0 24 24"/);
  assert.match(js, /scanDetails/);
  assert.match(js, /purchase:'purchaseDetails'/);
  assert.match(js, /warehouseDetails/);
  assert.match(js, /jobCodeDetails/);
  assert.match(js, /warnings:'purchaseDetails'/);
  assert.match(js, /displayedTable/);
  assert.match(js, /button\.disabled=!available/);
  assert.match(js, /Chưa có file gốc/);
  assert.match(css, /\.raw-toggle/);
  assert.match(css, /\.raw-toggle:disabled/);
});

test('warning table keeps the purchase columns and adds a note', () => {
  assert.match(js, /warnings:\[\['stt','STT'\],\['projectCode','Mã dự án'\],\['purchaseOrder','Số PR'\]/);
  assert.match(js, /\['sourceRow','Dòng'\],\['note','Ghi chú'\]/);
  assert.match(css, /th\[data-column="note"\],[\s\S]*white-space: nowrap/);
  assert.match(main, /purchaseFormatWarnings/);
  assert.doesNotMatch(main, /otherWarnings = validateProjectCodes/);
});

test('purchase and warning key fields prefer one line with compact text columns', () => {
  assert.match(css, /data-table="purchase"[\s\S]*data-table="warnings"/);
  for (const column of ['projectCode','purchaseOrder','itemCode','quantity']) assert.match(css, new RegExp(`data-column="${column}"`));
  assert.match(css, /data-column="itemName"[\s\S]*width: 220px/);
  assert.match(css, /data-column="sourceFile"[\s\S]*width: 155px/);
  assert.match(js, /purchase:.*\['note','Ghi chú'\]/);
  assert.match(css, /data-table="purchase"[\s\S]*data-column="note"[\s\S]*width: 320px/);
});

test('sidebar opens a dedicated page for project-scoped old-to-new code links', () => {
  for (const id of ['codeReplacementPanel','codeReplacementForm','replacementProject','replacementOldCode','replacementNewCode','replacementPagination','codeReplacementList']) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(html, /data-view="replacements"/);
  assert.match(html, /id="replacements" class="view"/);
  const dataView = html.match(/<section id="data" class="view">([\s\S]*?)<section id="replacements"/)?.[1] || '';
  assert.doesNotMatch(dataView, /id="codeReplacementPanel"/);
  assert.match(html, /Mã hàng cũ[\s\S]*Mã hàng mới[\s\S]*Thao tác/);
  assert.match(js, /savePurchaseReplacement/);
  assert.match(js, /deletePurchaseReplacement/);
  assert.match(js, /class="replacement-delete"/);
  assert.match(js, /REPLACEMENT_PAGE_SIZE = 100/);
  assert.match(js, /rows\.slice\(start,start\+REPLACEMENT_PAGE_SIZE\)/);
  assert.match(js, /renderReplacementPagination/);
  assert.match(js, /changed-code/);
  assert.match(preload, /purchase-replacement:save/);
  assert.match(preload, /purchase-replacement:delete/);
  assert.match(main, /purchaseReplacements/);
  assert.match(css, /\.code-replacement-panel/);
  assert.match(css, /\.replacement-table/);
  assert.match(css, /\.replacement-delete/);
  assert.match(css, /\.changed-code s/);
  assert.match(js, /changed-pr/);
  assert.match(css, /td\[data-column="purchaseOrder"\] \.cell-value\.changed-code\.changed-pr[\s\S]*flex-direction: column/);
});

test('sidebar exposes database management, backup restore, and protected delete action', () => {
  assert.match(html, /data-view="settings"[\s\S]*Quản lý cơ sở dữ liệu/);
  assert.match(html, /id="settings" class="view"[\s\S]*id="runDataAudit"[\s\S]*id="refreshBackups"[\s\S]*id="backupList"[\s\S]*id="deleteDatabase"/);
  assert.match(js, /deleteDatabase'\)\.onclick=\(\)=>startDelete\(\)/);
  assert.match(js, /refreshBackups'\)\.onclick=loadBackups/);
  assert.match(js, /window\.api\.listBackups\(\)/);
  assert.match(js, /window\.api\.restoreBackup\(fileName\)/);
  assert.match(preload, /database:backups/);
  assert.match(preload, /database:restore/);
  assert.match(main, /ipcMain\.handle\('database:backups'/);
  assert.match(main, /ipcMain\.handle\('database:restore'/);
  assert.match(main, /serializeMutation\(async \(\) => \{[\s\S]*database\.restoreBackup/);
  assert.match(js, /deleteStep=1/);
});

test('application exposes actual-data audit and a separate non-destructive technical check', () => {
  assert.doesNotMatch(html, /id="selfCheckNav"/);
  assert.doesNotMatch(html, /id="selfCheck" class="view"/);
  assert.match(html, /id="settings" class="view"[\s\S]*Kiểm tra dữ liệu có khớp hay không[\s\S]*id="runDataAudit"[\s\S]*id="auditBody"[\s\S]*id="runSelfCheck"/);
  assert.match(preload, /runDataAudit:.*data-audit:run/);
  assert.match(preload, /searchLoadedCode:.*data-audit:search/);
  assert.match(main, /ipcMain\.handle\('data-audit:run'/);
  assert.match(main, /ipcMain\.handle\('data-audit:search'/);
  assert.match(js, /window\.api\.runDataAudit\(\)/);
  assert.match(js, /window\.api\.searchLoadedCode\(/);
  assert.match(html, /id="codeSearchDialog"[\s\S]*id="codeSearchBody"/);
  assert.match(preload, /runSelfCheck:.*self-check:run/);
  assert.match(main, /ipcMain\.handle\('self-check:run'/);
  assert.match(js, /window\.api\.runSelfCheck\(\)/);
  assert.match(js, /report\.ok\?'ĐẠT':'KHÔNG ĐẠT'/);
});

test('updates wait for explicit restart confirmation', () => {
  assert.match(main, /Bản cập nhật đã sẵn sàng/);
  assert.match(main, /Cài đặt và khởi động lại/);
  assert.match(main, /choice === 0/);
  assert.doesNotMatch(main, /setTimeout\(\(\) => autoUpdater\.quitAndInstall/);
});

test('installed app exposes separate Update and Restore controls', () => {
  assert.match(html, /id="updateBtn"/);
  assert.match(html, /id="restoreBtn"/);
  assert.match(html, /Restore bản stable ngay trước latest/);
  assert.match(preload, /update:check/);
  assert.match(preload, /update:rollback/);
  assert.match(js, /window\.api\.restorePreviousVersion\(\)/);
  assert.match(js, /rollback-downloading/);
  assert.match(main, /ipcMain\.handle\('update:rollback'/);
  assert.match(main, /selectPreviousRelease/);
  assert.match(main, /selectInstallerAsset/);
  assert.match(main, /rollbackPreviousVersion/);
  assert.match(main, /spawn\(temporaryFile/);
  assert.match(main, /toàn bộ dữ liệu SQLite cũ sẽ được xóa/);
  assert.match(js, /toàn bộ dữ liệu SQLite cũ sẽ bị xóa/);
});

test('installed app exposes a silent GitHub update button and automated release command', () => {
  assert.match(html, /id="updateBtn"/);
  assert.match(preload, /update:check/);
  assert.match(preload, /update:status/);
  assert.match(main, /checkForUpdates/);
  assert.match(main, /downloadUpdate/);
  assert.match(main, /quitAndInstall\(true, true\)/);
  assert.equal(packageJson.scripts['release:auto'], 'powershell -NoProfile -ExecutionPolicy Bypass -File scripts/release-auto.ps1');
  assert.equal(packageJson.build.publish.owner, 'pokemon1742000-commits');
  assert.equal(packageJson.build.publish.repo, 'PU');
  assert.equal(packageJson.build.nsis.perMachine, false);
  assert.match(releaseAuto, /npm version patch --no-git-tag-version/);
  assert.match(releaseAuto, /electron-builder --win nsis --x64 --publish never/);
  assert.match(releaseAuto, /--config\.npmRebuild=false/);
  assert.match(releaseAuto, /prepare:electron-native/);
  assert.match(releaseAuto, /verify:packaged/);
  assert.ok(releaseAuto.indexOf('prepare:electron-native') < releaseAuto.indexOf('electron-builder'));
  assert.ok(releaseAuto.indexOf('electron-builder') < releaseAuto.indexOf('verify:packaged'));
  assert.match(releaseAuto, /gh release create/);
  assert.match(releaseAuto, /gh release upload/);
  assert.match(releaseAuto, /Join-Path \$buildOutput 'latest\.yml'/);
  assert.match(releaseAuto, /function Get-Sha512Base64/);
  assert.match(releaseAuto, /latest\.yml does not match the built installer/);
  assert.match(releaseAuto, /Resume version v\$currentVersion after the interrupted release/);
  assert.match(releaseAuto, /release-\$version-\$buildStamp/);
  assert.match(releaseAuto, /--config\.directories\.output=\$buildOutput/);
  assert.doesNotMatch(releaseAuto, /electron-builder --win nsis --publish always/);
  assert.match(releaseAuto, /git add -- \$releasePaths/);
  assert.match(releaseAuto, /function Invoke-Probe/);
  assert.match(releaseAuto, /\$repositoryProbe = Invoke-Probe \{ git rev-parse --is-inside-work-tree \}/);
  assert.match(releaseAuto, /\$originProbe = Invoke-Probe \{ git remote get-url origin \}/);
  assert.doesNotMatch(releaseAuto, /git add --all|git add -A/);
});

test('warehouse and workshop key fields prefer one line with compact item names and wide notes', () => {
  assert.match(js, /warehouse:.*\['poNumber','PO'\]/);
  assert.match(js, /workshop:.*\['poNumber','Số PO'\]/);
  assert.match(css, /data-table="warehouse"\], \[data-table="workshop"[\s\S]*data-column="supplier"/);
  assert.match(css, /data-table="warehouse"\], \[data-table="workshop"[\s\S]*data-column="itemName"[\s\S]*width: 195px/);
  assert.match(css, /data-table="warehouse"\], \[data-table="workshop"[\s\S]*data-column="note"[\s\S]*width: 190px/);
  assert.match(css, /data-table="warehouse"\], \[data-table="workshop"[\s\S]*text-overflow: clip/);
});

test('warehouse and workshop shortage rows use the red missing status style', () => {
  assert.match(js, /\['warehouse','workshop'\]\.includes\(activeTable\)&&!rawMode&&row\.isShortage/);
  assert.match(js, /return 'warehouse-shortage'/);
  assert.match(css, /warehouse-shortage[^}]*orderedQuantity/);
  assert.match(css, /warehouse-shortage[^}]*receivedQuantity/);
});

test('comparison is scan-led, exposes requested fields and runs automatically when ready', () => {
  assert.match(js, /comparison:\[\['stt','STT'\],\['projectCode','Mã dự án'\],\['drawingCode','Mã bản vẽ'\]/);
  for (const field of ['scanQuantity','warehouseQuantity','purchaseQuantity','note','maker','scanDate','warehouseDate']) {
    assert.match(js, new RegExp(`\\['${field}'`));
  }
  assert.match(js, /scanDrawingCode/);
  assert.match(main, /autoCompareWhenReady\(\)/);
  assert.match(main, /session\.scans\.length/);
  assert.match(main, /session\.purchase\.length \|\| session\.warehouse\.length/);
  assert.match(css, /data-table="comparison"[\s\S]*data-column="note"/);
});

test('comparison tab is the only confirmation workspace with three source columns', () => {
  assert.match(html, /data-open-table="comparison">Xác Nhận/);
  assert.doesNotMatch(html, /id="review" class="view"/);
  assert.doesNotMatch(html, /data-view="review"/);
  assert.match(js, /Mã file Quét Mã/);
  assert.match(js, /Mã file Mua Hàng/);
  assert.match(js, /Mã file Nhập Kho/);
  assert.match(js, /confirmationCandidate/);
  assert.match(js, /Ghép \$\{label\}/);
  assert.match(js, /Bỏ qua \$\{label\}/);
  assert.match(js, /Xác nhận lại/);
  assert.match(js, /confirmComparison\(index,source,action\)/);
  assert.match(css, /\.candidate-control/);
  assert.doesNotMatch(css, /\.confirmation-actions\s*\{[^}]*display:\s*flex/);
  assert.match(main, /counts\.review = \(session\.review \|\| \[\]\)\.filter/);
});

test('confirmation clicks are queued optimistically and sent as one batch', () => {
  assert.match(js, /confirmationQueue\.set\(id,\{id,code,action\}\)/);
  assert.match(js, /setTimeout\(flushConfirmations,140\)/);
  assert.match(js, /items=\[\.\.\.confirmationQueue\.values\(\)\]/);
  assert.match(js, /markConfirmationQueued/);
  assert.match(css, /\.confirmation-saving/);
});

test('confirmation rebuild reuses purchase indexes and only scans active projects', () => {
  assert.match(processor, /const purchaseReplacementCache = new WeakMap\(\)/);
  assert.match(processor, /if \(!Array\.isArray\(rows\) \|\| !replacements\?\.length\) return source/);
  assert.match(processor, /if \(cached\?\.signature === signature\) return cached\.rows/);
  assert.match(processor, /for \(const project of scanProjects\)/);
  assert.match(processor, /warehouseIndex\.itemNameKeys\.get/);
  assert.doesNotMatch(processor, /new Set\(\[\.\.\.purchaseGroups\.keys\(\), \.\.\.warehouseGroups\.keys\(\)\]\)/);
  assert.doesNotMatch(processor, /\[\.\.\.warehouseGroups\.entries\(\)\]\.filter/);
});

test('result tables keep key fields on one line and notes on exactly two lines', () => {
  assert.match(js, /\['supplier','Nhà cung cấp'\]/);
  assert.doesNotMatch(js, /SL\/máy|Số lượng\/máy/);
  assert.match(js, /Số lượng quét mã/);
  assert.match(css, /data-column="projectCode"[\s\S]*data-column="drawingCode"[\s\S]*data-column="supplier"/);
  assert.match(css, /data-column="note"[\s\S]*white-space: pre-line[\s\S]*-webkit-line-clamp: 2/);
  assert.match(main, /autoCompareWhenReady/);
});

test('every table renumbers STT independently and keeps project codes on one line', () => {
  assert.match(main, /numberedTables = \[[^\]]*'comparison'[^\]]*'shortage'[^\]]*'excess'/);
  assert.match(main, /\{ \.\.\.row, stt: start \+ index \+ 1 \}/);
  assert.match(exporter, /index \+ 1, row\.projectCode, row\.drawingCode/);
  assert.match(css, /td\[data-column="projectCode"\][\s\S]*white-space: nowrap/);
  assert.match(css, /td\[data-column="projectCode"\] \.cell-value[\s\S]*white-space: nowrap/);
});

test('result highlighting stays on quantities and Excel colors only XK by shortage or excess', () => {
  for (const field of ['scanQuantity','warehouseQuantity','purchaseQuantity']) {
    assert.match(css, new RegExp(`status-missing td\\[data-column="${field}"\\]`));
  }
  assert.doesNotMatch(css, /tr\.status-missing td\s*\{/);
  assert.match(exporter, /difference < -1e-8\) output\.getCell\(6\)\.fill = fill\('FFFFFF00'\)/);
  assert.match(exporter, /difference > 1e-8\) output\.getCell\(6\)\.fill = fill\('FF92D050'\)/);
  assert.doesNotMatch(exporter, /output\.fill/);
});
