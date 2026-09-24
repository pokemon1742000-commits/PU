const $ = s => document.querySelector(s); const $$ = s => [...document.querySelectorAll(s)];
let state = { counts:{}, rawCounts:{}, sources:[] }, activeTable = 'comparison', rawMode = false, tableRows = [], tablePage = { page:1, pageSize:100, total:0, totalPages:1 }, auditPage = { page:1, pageSize:100, total:0, totalPages:1 }, replacementPage = 1, tableRequest = 0, searchTimer, thresholdTimer, confirmationTimer, confirmationInFlight = false, confirmationQueue = new Map(), sheetPickerFiles = [], sheetPickerResolve, lastExportPath = '', importInFlight = false, exportInFlight = false, exportUnsubscribe = null;
const REPLACEMENT_PAGE_SIZE = 100;
const tableLabels = { purchase:'Dữ Liệu Đặt Hàng — Sheet kiểm tra', scan:'Dữ Liệu Quét Mã — Sheet kiểm tra', warehouse:'Dữ Liệu Nhập Kho — Sheet kiểm tra', workshop:'Dữ Liệu Xưởng Gia Công — Sheet kiểm tra', jobCodes:'Job Code — Cơ sở dữ liệu tích lũy', comparison:'Xác Nhận Mã Đối Chiếu', enough:'Đủ hàng', shortage:'Thiếu hàng', excess:'Thừa hàng', warnings:'Cảnh Báo' };
const columns = {
  purchase:[['stt','STT'],['projectCode','Mã dự án'],['purchaseOrder','Số PR'],['itemCode','Mã hàng'],['itemName','Tên hàng'],['quantity','Số lượng'],['note','Ghi chú'],['sourceFile','File nguồn'],['sourceRow','Dòng']],
  scan:[['stt','STT'],['projectCode','Mã dự án'],['drawingCode','Mã bản vẽ'],['quantity','Số lượng quét mã'],['manufacturer','Nhà sản xuất'],['warehouseDate','Ngày nhập kho'],['scanDate','Ngày quét mã'],['note','Ghi chú'],['sourceFile','File nguồn']],
  warehouse:[['stt','STT'],['projectCode','Mã dự án'],['itemCode','Mã hàng'],['itemName','Tên hàng'],['supplier','NCC'],['poNumber','PO'],['orderedQuantity','SL đặt hàng'],['receivedQuantity','SL đã về'],['dueDate','Hạn giao hàng'],['deliveryDate','Ngày giao hàng'],['note','Ghi chú'],['sourceFile','File nguồn']],
  workshop:[['stt','STT'],['projectCode','Mã dự án'],['purchaseRequest','Số PR (MKS)'],['poNumber','Số PO'],['prDate','Ngày PR'],['itemCode','Mã hàng'],['itemName','Tên hàng'],['orderedQuantity','Số lượng đặt'],['dueDate','Hạn ngày về'],['receivedQuantity','Số lượng nhập kho'],['deliveryDate','Ngày nhập kho'],['note','Ghi chú'],['sourceFile','File nguồn']],
  jobCodes:[['stt','STT'],['code','Code'],['note','Ghi chú']],
  comparison:[['stt','STT'],['projectCode','Mã dự án'],['drawingCode','Mã bản vẽ'],['purchaseOrder','Số PR'],['supplier','Nhà cung cấp'],['itemName','Tên hàng'],['scanQuantity','Số lượng quét mã'],['warehouseQuantity','SL nhập kho'],['purchaseQuantity','SL mua hàng'],['warehouseStatus','TT Nhập kho'],['scanStatus','TT Quét mã'],['note','Ghi chú'],['maker','Maker'],['scanDate','Ngày quét mã'],['warehouseDate','Ngày nhập kho'],['matchStatus','Khớp mã']],
  enough:[['stt','STT'],['projectCode','Mã dự án'],['drawingCode','Mã bản vẽ'],['purchaseOrder','Số PR'],['supplier','Nhà cung cấp'],['itemName','Tên hàng'],['scanQuantity','Số lượng quét mã'],['warehouseQuantity','SL nhập kho'],['purchaseQuantity','SL mua hàng'],['warehouseStatus','TT Nhập kho'],['scanStatus','TT Quét mã'],['note','Ghi chú'],['maker','Maker'],['scanDate','Ngày quét mã'],['warehouseDate','Ngày nhập kho'],['matchStatus','Khớp mã']],
  shortage:[['stt','STT'],['projectCode','Mã dự án'],['drawingCode','Mã bản vẽ'],['purchaseOrder','Số PR'],['supplier','Nhà cung cấp'],['itemName','Tên hàng'],['scanQuantity','Số lượng quét mã'],['warehouseQuantity','SL nhập kho'],['purchaseQuantity','SL mua hàng'],['warehouseStatus','TT Nhập kho'],['scanStatus','TT Quét mã'],['note','Ghi chú'],['maker','Maker'],['scanDate','Ngày quét mã'],['warehouseDate','Ngày nhập kho'],['matchStatus','Khớp mã']],
  excess:[['stt','STT'],['projectCode','Mã dự án'],['drawingCode','Mã bản vẽ'],['purchaseOrder','Số PR'],['supplier','Nhà cung cấp'],['itemName','Tên hàng'],['scanQuantity','Số lượng quét mã'],['warehouseQuantity','SL nhập kho'],['purchaseQuantity','SL mua hàng'],['warehouseStatus','TT Nhập kho'],['scanStatus','TT Quét mã'],['note','Ghi chú'],['maker','Maker'],['scanDate','Ngày quét mã'],['warehouseDate','Ngày nhập kho'],['matchStatus','Khớp mã']],
  warnings:[['stt','STT'],['projectCode','Mã dự án'],['purchaseOrder','Số PR'],['itemCode','Mã hàng'],['itemName','Tên hàng'],['quantity','Số lượng'],['sourceFile','File nguồn'],['sourceRow','Dòng'],['note','Ghi chú']]
};

async function init(){ $('#sheetOptions').innerHTML='<div class="export-single-sheet"><strong>2 sheet dữ liệu đối chiếu</strong><span>Gồm SỐ LIỆU XUẤT KHO và đối chiếu PR với PO + XGC. Chọn 1 hoặc cả 2 loại khi xuất: So sánh PU, hoặc PR vs PO + XGC.</span></div>'; renderReleaseHistory(); applyTheme(localStorage.getItem('theme')||'default'); bind(); await refresh(await window.api.getState()); requestAnimationFrame(updateNavIndicator); }
function renderReleaseHistory(){const history=$('#releaseHistory');if(!history||!Array.isArray(window.RELEASE_NOTES))return;history.innerHTML=window.RELEASE_NOTES.map(note=>`<article class="release-note" data-version="${escapeHtml(note.version)}"><h4>v${escapeHtml(note.version)} <span class="current-version-badge" hidden>Phiên bản hiện tại</span></h4><p>${escapeHtml(note.summary)}</p></article>`).join('')}
function bind(){
  $$('.nav').forEach(b=>b.onclick=async()=>{show(b.dataset.view,b);if(b.dataset.openTable)await showTable(b.dataset.openTable)});
  $$('.load').forEach(b=>b.onclick=()=>handleLoad(b));
  $('#cancelImport').onclick=async()=>{ if($('#cancelImport').disabled)return; $('#cancelImport').disabled=true;$('#importProgressDetail').textContent='Đang dừng và xóa dữ liệu nạp dở…';await window.api.cancelImport(); };
  window.api.onImportProgress(renderImportProgress);
  $('#cancelExport').onclick=async()=>{ if($('#cancelExport').disabled)return; $('#cancelExport').disabled=true;$('#exportProgressDetail').textContent='Đang hủy tác vụ xuất…';await window.api.cancelExport(); };
  $('#exportProgress').onclick=event=>{if(event.target===$('#exportProgress')&&exportInFlight){closeExportProgress();window.api.cancelExport();}};
  $('#threshold').oninput=()=>{if(Number($('#confirmationThreshold').value)>=Number($('#threshold').value))$('#confirmationThreshold').value=Math.max(0,Number($('#threshold').value)-1);scheduleThresholdUpdate()};
  $('#confirmationThreshold').oninput=()=>{if(Number($('#confirmationThreshold').value)>=Number($('#threshold').value))$('#confirmationThreshold').value=Math.max(0,Number($('#threshold').value)-1);scheduleThresholdUpdate()};
  $('#cancelSheetPicker').onclick=()=>closeSheetPicker(null);
  $('#confirmSheetPicker').onclick=confirmSheetSelection;
  $('#codeReplacementForm').onsubmit=saveCodeReplacement;
  $$('[data-table]').forEach(b=>b.onclick=async()=>{show('data',$(`.nav[data-open-table="${b.dataset.table}"]`));await showTable(b.dataset.table)});
  $('#tableSearch').oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>loadTablePage(1),250)};
  $('#tablePageSize').onchange=()=>{tablePage.pageSize=Number($('#tablePageSize').value);loadTablePage(1)};
  $('#rawToggle').onclick=async()=>{rawMode=!rawMode;updateRawToggle();await loadTablePage(1)};
  $('#warningShortcut').onclick=async()=>{const target=activeTable==='warnings'?'purchase':'warnings';show('data',$('.nav-item[data-open-table="purchase"]'));await showTable(target)};
  $('#exportBtn').onclick=openExportTypePicker;
  $('#openExportFileBtn').onclick=()=>run(async()=>{await window.api.openExportFile(lastExportPath)},'Đã mở file xuất');
  $('#cancelExportTypePicker').onclick=()=>closeExportTypePicker();
  $('#closeExportTypePicker').onclick=()=>closeExportTypePicker();
  $('#exportTypePicker').onclick=event=>{if(event.target===$('#exportTypePicker'))closeExportTypePicker()};
  $$('.export-type-option').forEach(button=>button.onclick=()=>toggleExportType(button));
  $('#confirmExportTypePicker').onclick=()=>{const types=selectedExportTypes();if(!types.length)return;closeExportTypePicker();exportFile(types)};
  $('#infoBtn').onclick=()=>{showInfoPanel('releaseInfo');$('#infoDialog').showModal()};
  $$('.info-tab').forEach(button=>button.onclick=()=>showInfoPanel(button.dataset.infoPanel));
  $('#closeInfo').onclick=()=>$('#infoDialog').close();
  $('#infoDialog').onclick=event=>{if(event.target===$('#infoDialog'))$('#infoDialog').close()};
  $('#githubLink').onclick=()=>run(()=>window.api.openExternal('https://github.com/pokemon1742000-commits/PU'),null);
  $('#exportPageBtn').onclick=openExportTypePicker;
  $('#updateBtn').onclick=()=>openVersionPicker('update');
  $('#restoreBtn').onclick=()=>openVersionPicker('rollback');
  $('#closeVersionPicker').onclick=closeVersionPicker;
  $('#cancelVersionPicker').onclick=closeVersionPicker;
  $('#versionPicker').onclick=event=>{if(event.target===$('#versionPicker'))closeVersionPicker()};
  $('#confirmVersionPicker').onclick=installSelectedVersion;
  window.api.onUpdateStatus(renderUpdateStatus);
  $('#clearSession').onclick=async()=>{if(confirm('Bạn có chắc muốn xóa dữ liệu Quét Mã và các xác nhận? Dữ liệu Mua Hàng, Nhập Kho và Xưởng Gia Công sẽ được giữ lại.')) await run(async()=>{rawMode=false;const result=await window.api.clearSession();await refresh(result);tablePage.page=1;await loadTablePage(1)},'Đã clear phiên làm việc');};
  $('#deleteDatabase').onclick=()=>startDelete();
  $('#refreshBackups').onclick=loadBackups;
  $('#runDataAudit').onclick=runCurrentDataAudit;
  $('#runSelfCheck').onclick=runApplicationSelfCheck;
  $('#closeCodeSearch').onclick=()=>$('#codeSearchDialog').close();
  $('#codeSearchDialog').onclick=event=>{if(event.target===$('#codeSearchDialog'))$('#codeSearchDialog').close()};
  $('#confirmDelete').onclick=e=>{e.preventDefault();advanceDelete();};
  $$('.theme-dot').forEach(b=>b.onclick=()=>applyTheme(b.dataset.theme));
  window.addEventListener('resize',updateNavIndicator);
}
function showInfoPanel(panelId){$$('.info-panel').forEach(panel=>panel.hidden=panel.id!==panelId);$$('.info-tab').forEach(button=>button.classList.toggle('active',button.dataset.infoPanel===panelId))}
async function runCurrentDataAudit(){
  const button=$('#runDataAudit'),title=$('#selfCheckTitle'),summary=$('#selfCheckSummary');
  button.disabled=true;button.textContent='Đang đối soát...';title.textContent='Đang kiểm tra dữ liệu';summary.textContent='Đang so sánh từng mã và số lượng giữa các nguồn.';
  try{
    const report=await window.api.runDataAudit();
    $('#auditStats').hidden=false;$('#auditMatched').textContent=report.matched;$('#auditDifference').textContent=report.difference;$('#auditReview').textContent=report.review;
    title.textContent=!report.ready?'CHƯA ĐỦ DỮ LIỆU':report.ok?'DỮ LIỆU KHỚP':'CÓ DÒNG CẦN XEM LẠI';
    title.className=report.ok?'self-check-pass':report.ready?'self-check-fail':'';
    summary.textContent=!report.ready?'Chưa có kết quả đối chiếu. Hãy nạp dữ liệu Quét Mã cùng Mua Hàng hoặc Nhập Kho/XGC.':`${report.matched}/${report.total} dòng khớp · ${report.difference} dòng chênh lệch số lượng · ${report.review} dòng cần kiểm tra mã`;
    await loadAuditPage(1);
    toast(report.ok?'Toàn bộ dữ liệu đang khớp':`Có ${report.difference+report.review} dòng cần xem lại`,!report.ok);
  }catch(error){title.textContent='KHÔNG THỂ KIỂM TRA';title.className='self-check-fail';summary.textContent=error.message;toast(`Lỗi kiểm tra dữ liệu: ${error.message}`,true)}
  finally{button.disabled=false;button.textContent='Kiểm tra lại dữ liệu'}
}
async function loadAuditPage(page){
  const result=await window.api.getRows('dataAudit',{page,pageSize:100});auditPage=result;
  $('#auditBody').innerHTML=result.rows.length?result.rows.map(row=>`<tr class="audit-${row.auditStatus==='KHỚP'?'matched':row.auditStatus==='CHÊNH LỆCH'?'difference':'review'}"><td>${row.stt}</td><td><span class="audit-badge">${escapeHtml(row.auditStatus)}</span></td><td><strong>${escapeHtml(row.projectCode)}</strong></td><td>${auditCodeCell(row.scanCode,row.scanLocation)}</td><td>${auditCodeCell(row.purchaseCode,row.purchaseLocation)}</td><td>${auditCodeCell(row.receiptCode,row.receiptLocation)}${row.receiptSource?`<br><small>${escapeHtml(row.receiptSource)}</small>`:''}</td><td>${escapeHtml(row.purchaseQuantity)}</td><td>${escapeHtml(row.scanQuantity)}</td><td>${escapeHtml(row.receiptQuantity)}</td><td>${escapeHtml(row.matchMethod)}</td><td>${escapeHtml(row.reason)}</td><td><button class="audit-search-button" type="button" data-project="${escapeHtml(row.projectCode)}" data-code="${escapeHtml(row.scanCode||row.purchaseCode||row.receiptCode)}" title="Tìm mã trong các file đã nạp" aria-label="Tìm mã trong các file đã nạp"><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5"></circle><path d="M12.5 12.5L17 17"></path></svg></button></td></tr>`).join(''):'<tr><td colspan="12" class="placeholder">Chưa có dữ liệu đối chiếu để kiểm tra.</td></tr>';
  $$('#auditBody .audit-search-button').forEach(button=>button.onclick=()=>searchAuditCode(button.dataset.project,button.dataset.code));
  const items=paginationSequence(result.page,result.totalPages);$('#auditPagination').innerHTML=`<span class="page-summary">${result.total?(result.page-1)*result.pageSize+1:0}–${Math.min(result.page*result.pageSize,result.total)} / ${result.total} dòng</span><div class="page-icons">${items.map(item=>item==='…'?'<span class="page-ellipsis">…</span>':`<button class="page-icon${item===result.page?' active':''}" data-page="${item}">${item}</button>`).join('')}</div>`;$$('#auditPagination .page-icon').forEach(item=>item.onclick=()=>loadAuditPage(Number(item.dataset.page)));
}
function auditCodeCell(code,location){if(!code)return '<span class="audit-code-empty">—</span>';return `<span class="audit-code" tabindex="0" data-location="${escapeHtml(location||'Không có thông tin file/dòng nguồn')}">${escapeHtml(code)}</span>`}
async function searchAuditCode(projectCode,code){
  const dialog=$('#codeSearchDialog');$('#codeSearchTitle').textContent=`Tìm mã ${code}`;$('#codeSearchSummary').textContent='Đang tìm trong Mua Hàng, Quét Mã, Nhập Kho và Xưởng Gia Công…';$('#codeSearchBody').innerHTML='<tr><td colspan="7" class="placeholder">Đang tìm…</td></tr>';dialog.showModal();
  try{
    const result=await window.api.searchLoadedCode({projectCode,code});
    $('#codeSearchSummary').textContent=result.total?`Tìm thấy ${result.total} dòng trong ${result.sourceCount} nguồn và ${result.fileCount} file/sheet${result.duplicate?' — có mã xuất hiện nhiều lần':' — không có mã trùng'}.`:'Không tìm thấy mã này trong các file đã nạp.';
    $('#codeSearchBody').innerHTML=result.occurrences.length?result.occurrences.map(row=>`<tr><td><strong>${escapeHtml(row.sourceLabel)}</strong></td><td>${escapeHtml(row.code)}</td><td>${escapeHtml(row.matchType)}</td><td>${escapeHtml(row.file)}</td><td>${escapeHtml(row.sheet||'—')}</td><td>${escapeHtml(row.row||'—')}</td><td>${escapeHtml(row.quantity)}</td></tr>`).join(''):'<tr><td colspan="7" class="placeholder">Không có dòng nào.</td></tr>';
  }catch(error){$('#codeSearchSummary').textContent=`Lỗi: ${error.message}`;$('#codeSearchBody').innerHTML='<tr><td colspan="7" class="placeholder">Không thể tìm mã.</td></tr>'}
}
async function runApplicationSelfCheck(){
  const button=$('#runSelfCheck'),title=$('#technicalCheckTitle'),results=$('#selfCheckResults');
  button.disabled=true;button.textContent='Đang kiểm tra...';title.textContent='Đang chạy';results.innerHTML='<div class="self-check-empty">Đang chạy các tình huống kiểm tra…</div>';
  try{
    const report=await window.api.runSelfCheck();
    title.textContent=report.ok?'ĐẠT':'KHÔNG ĐẠT';
    title.className=report.ok?'self-check-pass':'self-check-fail';
    results.innerHTML=report.checks.map(item=>`<article class="self-check-result ${item.passed?'passed':'failed'}"><span class="self-check-mark">${item.passed?'✓':'!'}</span><div><strong>${escapeHtml(item.name)}</strong><p>${escapeHtml(item.detail)}</p></div><small>${item.durationMs} ms</small></article>`).join('');
    toast(report.ok?'Tự kiểm tra: tất cả mục đều đạt':`Tự kiểm tra: ${report.failed} mục không đạt`,!report.ok);
  }catch(error){title.textContent='KHÔNG THỂ KIỂM TRA';title.className='self-check-fail';results.innerHTML='<div class="self-check-empty">Hãy đóng và mở lại ứng dụng rồi thử lại.</div>';toast(`Lỗi tự kiểm tra: ${error.message}`,true)}
  finally{button.disabled=false;button.textContent='Kiểm tra lại'}
}
async function openVersionPicker(operation){
  const picker=$('#versionPicker'), list=$('#versionPickerList'), summary=$('#versionPickerSummary');
  picker.dataset.operation=operation; picker.hidden=false; list.innerHTML='<div class="self-check-empty">Đang tải danh sách phiên bản…</div>'; summary.textContent=operation==='update'?'Chọn bản mới hơn phiên bản đang dùng.':'Chọn bản cũ hơn phiên bản đang dùng.'; $('#confirmVersionPicker').disabled=true;
  try{
    const result=operation==='update'?await window.api.listUpdateVersions():await window.api.listRestoreVersions();
    picker.dataset.currentVersion=result.currentVersion||'';
    if(!result.releases?.length){list.innerHTML=`<div class="self-check-empty">${escapeHtml(result.message||'Không có phiên bản phù hợp.')}</div>`;return}
    list.innerHTML=result.releases.map(release=>`<button type="button" class="version-picker-option${release.hasInstaller?'':' unavailable'}" data-version="${escapeHtml(release.version)}" ${release.hasInstaller?'':'disabled'}><span><strong>v${escapeHtml(release.version)}</strong><small>${escapeHtml(release.name||'')}</small></span><span class="version-picker-date">${escapeHtml(formatReleaseDate(release.publishedAt))}${release.hasInstaller?'':' · Không có Setup'}</span></button>`).join('');
    $$('.version-picker-option:not(:disabled)').forEach(button=>button.onclick=()=>{ $$('.version-picker-option').forEach(item=>item.classList.remove('selected'));button.classList.add('selected');picker.dataset.version=button.dataset.version;$('#confirmVersionPicker').disabled=false; });
  }catch(error){list.innerHTML=`<div class="self-check-empty">Không thể tải danh sách phiên bản: ${escapeHtml(error.message)}</div>`}
}
function closeVersionPicker(){const picker=$('#versionPicker');picker.hidden=true;picker.dataset.version='';$('#versionPickerList').innerHTML='';$('#confirmVersionPicker').disabled=true}
async function installSelectedVersion(){
  const picker=$('#versionPicker'), version=picker.dataset.version, operation=picker.dataset.operation;
  if(!version||!operation)return;
  const label=operation==='update'?'Update':'Restore';
  if(!confirm(`${label} phiên bản v${version}? Ứng dụng sẽ khởi động lại và dữ liệu SQLite của phiên bản hiện tại sẽ được xóa.`))return;
  closeVersionPicker();
  try { renderUpdateStatus(operation==='update'?await window.api.installUpdateVersion(version):await window.api.installRestoreVersion(version)); }
  catch(error){renderUpdateStatus({status:'error',operation,message:`${label} thất bại: ${error.message}`})}
}
function formatReleaseDate(value){if(!value)return 'Ngày chưa rõ';const date=new Date(value);return Number.isNaN(date.getTime())?'Ngày chưa rõ':date.toLocaleDateString('vi-VN')}

function renderUpdateStatus(update){
  const updateButton=$('#updateBtn'),restoreButton=$('#restoreBtn');
  const busy=['checking','downloading','installing','rollback-checking','rollback-downloading','rollback-installing'].includes(update?.status);
  updateButton.disabled=busy;
  restoreButton.disabled=busy;
  updateButton.classList.toggle('updating',busy&&update?.operation==='update');
  restoreButton.classList.toggle('updating',busy&&update?.operation==='rollback');
  updateButton.querySelector('span').textContent=update?.operation==='update'&&update?.status==='downloading'?`Update ${update.percent||0}%`:update?.operation==='update'&&update?.status==='installing'?'Đang cài...':update?.operation==='update'&&update?.status==='checking'?'Đang kiểm tra...':'Update';
  restoreButton.querySelector('span').textContent=update?.operation==='rollback'&&update?.status==='rollback-downloading'?`Restore ${update.percent||0}%`:update?.operation==='rollback'&&update?.status==='rollback-installing'?'Đang cài...':update?.operation==='rollback'&&update?.status==='rollback-checking'?'Đang tìm bản...':'Restore';
  if(update?.message&&update.status!=='idle')toast(update.message,update.status==='error'||update.status==='rollback-unavailable');
}
function show(id,button){ $$('.view').forEach(x=>x.classList.toggle('active',x.id===id)); $$('.nav').forEach(x=>x.classList.remove('active')); button?.classList.add('active'); requestAnimationFrame(updateNavIndicator); }
async function refresh(s){ if(s?.canceled)return; state=s; const c=s.counts||{},version=s.appVersion||'—',versionLabel=version==='—'?'v—':`v${version}`; for(const k of ['comparison','enough','shortage','excess','warnings']) $(`#${k}Count`) && ($(`#${k}Count`).textContent=c[k]||0); $('#dashPurchase').textContent=c.purchase||0;$('#dashScan').textContent=c.scans||0;$('#dashWorkshop').textContent=c.workshop||0;$('#dashReview').textContent=c.review||0;$('#reviewBadge').textContent=c.review||0;$('#appVersion').textContent=versionLabel;$('#headerVersion').textContent=versionLabel;$$('.release-note').forEach(note=>{const current=note.dataset.version===version;note.classList.toggle('current',current);note.querySelector('.current-version-badge').hidden=!current}); if(s.autoThreshold!==undefined)$('#threshold').value=s.autoThreshold;if(s.confirmationThreshold!==undefined)$('#confirmationThreshold').value=s.confirmationThreshold;syncThresholdLabels();updateRawToggle();renderCodeReplacements(); }

function setImportBusy(busy){
  importInFlight=busy;
  $$('.load').forEach(button=>button.disabled=busy);
  document.body.style.cursor=busy?'progress':'';
  $('#importProgress').hidden=!busy;
  $('#cancelImport').disabled=!busy;
}

function renderImportProgress(progress){
  if(!importInFlight)return;
  const finalizing=['rebuilding','refreshing','comparing','finalizing'].includes(progress.phase);
  $('#cancelImport').disabled=progress.cancelable===false||finalizing;
  $('#importProgressFile').textContent=finalizing?'Đang hoàn tất dữ liệu…':progress.file?`Đang đọc: ${progress.file}`:'Đang đọc file Excel…';
  $('#importProgressRows').textContent=`${Number(progress.loaded||0).toLocaleString('vi-VN')} dòng đã lưu tạm`;
  const phaseLabel={rebuilding:'Đang tổng hợp dữ liệu…',refreshing:'Đang cập nhật phiên làm việc…',comparing:'Đang đối chiếu dữ liệu…',finalizing:'Đang hoàn tất dữ liệu đã nạp…'}[progress.phase];
  const detail=phaseLabel||[progress.processed ? `${Number(progress.processed).toLocaleString('vi-VN')} dòng đã đọc` : '', progress.warningCount ? `${Number(progress.warningCount).toLocaleString('vi-VN')} cảnh báo` : ''].filter(Boolean).join(' · ');
  $('#importProgressDetail').textContent=progress.detail||detail||'Dữ liệu được đọc và lưu từng lô để giảm sử dụng RAM.';
}
let exportProgressPercent=0;
function renderExportProgress(progress){
  if(!exportInFlight)return;
  const phaseText={preparing:'Đang chuẩn bị…',comparing:'Đang đối chiếu dữ liệu…',writing:'Đang ghi báo cáo…',finalizing:'Đang hoàn tất…',complete:'Hoàn tất!'}[progress.phase]||progress.phase||'';
  const processed=Number(progress.processed||0),total=Number(progress.total||0);
  const percent=total>0?Math.min(100,Math.round(processed/total*100)):progress.phase==='finalizing'?95:exportProgressPercent;
  exportProgressPercent=Math.max(exportProgressPercent,percent);
  $('#exportProgressBar').style.width=`${exportProgressPercent}%`;
  $('#exportProgressFile').textContent=progress.project?`${phaseText} — ${progress.project}`:phaseText;
  $('#exportProgressRows').textContent=progress.detail||phaseText;
  $('#exportProgressDetail').textContent=progress.detail&&progress.project
    ?progress.detail
    :total>0?`${processed} / ${total} dự án`:'';
}

async function handleLoad(button){
  if(importInFlight)return;
  try {
    button.disabled=true;
    document.body.style.cursor='progress';
    const picked=await window.api.pickFiles(button.dataset.kind);
    document.body.style.cursor='';
    if(picked?.canceled)return;
    const selections=await chooseSheets(picked.files||[]);
    if(!selections?.length)return;
    setImportBusy(true);
    $('#importProgressFile').textContent='Đang chuẩn bị đọc file Excel…';
    $('#importProgressRows').textContent='0 dòng đã lưu tạm';
    $('#importProgressDetail').textContent='Dữ liệu được đọc và lưu từng lô để giảm sử dụng RAM.';
    const result=await window.api.loadFiles(button.dataset.kind,selections);
    await refresh(result);
    const table=button.dataset.kind;
    show('data',$(`.nav[data-open-table="${table}"]`));
    await showTable(table);
    const stats=result.loadStats||{};
    const failures=Array.isArray(stats.fileErrors)&&stats.fileErrors.length
      ? ` · bỏ qua ${stats.fileErrors.length} file lỗi: ${stats.fileErrors.map(error=>`${error.file}: ${error.message}`).join('; ')}`:'';
    const warningNote=stats.warningCount?` · ${stats.warningCount} cảnh báo định dạng`:'';
    toast(`Đã nạp ${Number(stats.loaded||0).toLocaleString('vi-VN')} dòng ${labelKind(button.dataset.kind)}${warningNote}${failures}`,Boolean(failures));
  } catch(e){
    const canceled=e?.code==='IMPORT_CANCELLED'||/Đã hủy nạp dữ liệu/.test(e?.message||'');
    toast(canceled?'Đã hủy nạp dữ liệu; các dòng nạp dở đã được xóa.':`Lỗi: ${e.message}`,!canceled);
  } finally { setImportBusy(false); }
}

function chooseSheets(files){
  if(!files.length)return Promise.resolve(null);
  sheetPickerFiles=files;
  $('#sheetPickerList').innerHTML=files.map((file,fileIndex)=>`<div class="sheet-picker-row"><div class="sheet-file-name">${escapeHtml(file.file)}</div><div class="sheet-options">${file.sheets.length?file.sheets.map((sheet,sheetIndex)=>`<label class="sheet-option"><input type="checkbox" data-file-index="${fileIndex}" data-sheet-index="${sheetIndex}" checked><span>${escapeHtml(sheet.name)} <small>(${sheet.rowCount||0} dòng)</small></span></label>`).join(''):'<span>Không có sheet.</span>'}</div></div>`).join('');
  $('#sheetPicker').hidden=false;
  return new Promise(resolve=>{sheetPickerResolve=resolve});
}

function confirmSheetSelection(){
  const selections=sheetPickerFiles.map((file,fileIndex)=>({path:file.path,sheets:$$(`#sheetPickerList input[data-file-index="${fileIndex}"]:checked`).map(input=>file.sheets[Number(input.dataset.sheetIndex)].name)})).filter(file=>file.sheets.length);
  if(!selections.length){toast('Hãy chọn ít nhất một sheet.',true);return;}
  closeSheetPicker(selections);
}

function closeSheetPicker(value){$('#sheetPicker').hidden=true;const resolve=sheetPickerResolve;sheetPickerResolve=null;sheetPickerFiles=[];resolve?.(value)}
function openExportTypePicker(){$$('.export-type-option').forEach(button=>button.setAttribute('aria-pressed','false'));$('#confirmExportTypePicker').disabled=true;$('#exportTypePicker').hidden=false}
function closeExportTypePicker(){$('#exportTypePicker').hidden=true}
function toggleExportType(button){button.setAttribute('aria-pressed',button.getAttribute('aria-pressed')==='true'?'false':'true');$('#confirmExportTypePicker').disabled=!selectedExportTypes().length}
function selectedExportTypes(){return $$('.export-type-option[aria-pressed="true"]').map(button=>button.dataset.exportType)}
function handleExportResult(r){if(!r.canceled){lastExportPath=r.path;$('#openExportFileBtn').hidden=false;toastActions(`Đã xuất: ${r.path}`,[{label:'Mở file xuất',onClick:()=>run(async()=>{await window.api.openExportFile(lastExportPath)},'Đã mở file xuất')},{label:'Mở thư mục chứa file',onClick:()=>run(async()=>{await window.api.showExportFileInFolder(lastExportPath)},'Đã mở thư mục chứa file')}])}}
function closeExportProgress(){exportInFlight=false;exportProgressPercent=0;$('#exportProgress').hidden=true;$('#exportProgress').setAttribute('aria-busy','false');$('#exportProgressBar').style.width='0%';$('#cancelExport').disabled=false;$('#exportBtn').disabled=false;$('#exportPageBtn').disabled=false;if(exportUnsubscribe){exportUnsubscribe();exportUnsubscribe=null;}}
// Tương thích ngược: nếu không truyền loại nào, gọi giống bản cũ
// exportExcel(['comparison']) — 'comparison' không khớp 'pu' hay 'source' nên
// exporter.js hiểu là xuất đầy đủ cả 2 sheet như hành vi trước đây.
async function exportFile(exportTypes){
  if(exportInFlight)return;
  const types=exportTypes&&exportTypes.length?exportTypes:['comparison'];
  exportUnsubscribe=window.api.onExportProgress(progress=>{
    if(progress.phase==='complete')return;
    renderExportProgress(progress);
  });
  exportInFlight=true;
  $('#exportProgress').hidden=false;
  $('#exportProgress').setAttribute('aria-busy','true');
  $('#exportBtn').disabled=true;$('#exportPageBtn').disabled=true;
  renderExportProgress({phase:'preparing',detail:'Đang chuẩn bị xuất…'});
  try{
    const r=await window.api.exportExcel(types);
    closeExportProgress();
    if(!r.canceled)handleExportResult(r);
  }catch(err){
    closeExportProgress();
    toast(`Lỗi xuất Excel: ${err.message||String(err)}`,true);
  }
}

async function applyThreshold(){
  if(!(state.counts?.scans&&(state.counts?.purchase||state.counts?.warehouse||state.counts?.workshop)))return;
  await run(async()=>{await refresh(await window.api.runComparison(comparisonSettings()));if(['comparison','enough','shortage','excess'].includes(activeTable))await loadTablePage(1)},null);
}
function comparisonSettings(){return {autoThreshold:Number($('#threshold').value),confirmationThreshold:Number($('#confirmationThreshold').value)}}
function syncThresholdLabels(){$('#thresholdValue').textContent=`${$('#threshold').value}%`;$('#confirmationThresholdValue').textContent=`${$('#confirmationThreshold').value}%`}
function scheduleThresholdUpdate(){syncThresholdLabels();clearTimeout(thresholdTimer);thresholdTimer=setTimeout(applyThreshold,350)}
async function showTable(name){ activeTable=name;rawMode=false; $('#tableTitle').textContent=tableLabels[name]; $('#tableSearch').value='';updateRawToggle();await loadTablePage(1); }
function rawSourceName(){return {purchase:'purchaseDetails',scan:'scanDetails',warehouse:'warehouseDetails',workshop:'workshopDetails',jobCodes:'jobCodeDetails',warnings:'purchaseDetails'}[activeTable]||activeTable}
function updateRawToggle(){const button=$('#rawToggle'),supported=['purchase','scan','warehouse','workshop','jobCodes','warnings'].includes(activeTable),available=(state.rawCounts?.[activeTable]||0)>0,warningMode=['purchase','warnings'].includes(activeTable);if(!available)rawMode=false;button.hidden=!supported;button.disabled=!available;button.classList.toggle('active',rawMode);button.setAttribute('aria-pressed',String(rawMode));button.title=available?'Chuyển giữa dữ liệu đã gộp và file gốc':'Hãy nạp lại file để có dữ liệu gốc';button.querySelector('span').textContent=rawMode?'Đang xem file gốc':available?'Xem file gốc':'Chưa có file gốc';$('#warningShortcut').hidden=!warningMode;$('#warningShortcut').textContent=activeTable==='warnings'?'← Mua Hàng':'⚠ Cảnh Báo';$('#warningShortcut').classList.toggle('active',activeTable==='warnings');$('#tableSideActions').hidden=!supported&&!warningMode}
async function loadTablePage(page){ const request=++tableRequest,source=rawMode?rawSourceName():(activeTable==='comparison'?'review':activeTable),pageSize=Number($('#tablePageSize').value)||100,result=await window.api.getRows(source,{page,pageSize,query:$('#tableSearch').value});if(request!==tableRequest)return;tableRows=result.rows;tablePage=result;$('#tablePageSize').value=String(result.pageSize);renderTable(); }
function displayedTable(){return activeTable==='warnings'&&rawMode?'purchase':activeTable}
function renderTable(){ if(activeTable==='comparison'&&!rawMode){renderConfirmations();return}const tableName=displayedTable(),cols=columns[tableName],rows=tableRows; $('#tableHead').closest('table').dataset.table=tableName; $('#tableHead').innerHTML=`<tr>${cols.map(x=>`<th data-column="${x[0]}">${x[1]}</th>`).join('')}</tr>`; $('#tableBody').innerHTML=rows.length?rows.map(r=>`<tr class="${tableRowClass(r)}">${cols.map(x=>tableCell(x,r)).join('')}</tr>`).join(''):`<tr><td colspan="${cols.length}" class="placeholder">Chưa có dữ liệu.</td></tr>`;renderPagination(); }
function renderConfirmations(){const table=$('#tableHead').closest('table');table.dataset.table='confirmation';$('#tableHead').innerHTML='<tr><th>Mã file Quét Mã</th><th>Mã file Mua Hàng</th><th>Mã file Nhập Kho / XGC</th><th>Trạng thái</th></tr>';$('#tableBody').innerHTML=tableRows.length?tableRows.map((row,index)=>`<tr class="${row.status==='Đã bỏ qua'?'confirmation-ignored':''}"><td><strong>${escapeHtml(row.projectCode)}</strong><br><span>${escapeHtml(row.scanDrawingCode)}</span></td><td>${confirmationCandidate(row,'purchase',index)}</td><td>${confirmationCandidate(row,'warehouse',index)}</td><td><span class="confirmation-status">${escapeHtml(row.status)}</span></td></tr>`).join(''):'<tr><td colspan="4" class="placeholder">Không có mã nào cần xác nhận hoặc đã bỏ qua.</td></tr>';renderPagination()}
function confirmationCandidate(row,source,index){const options=row[`${source}Options`]||[],decisionId=row[`${source}DecisionId`],kind=row[`${source}Kind`],label=source==='purchase'?'Mua Hàng':'Nhập Kho';if(kind==='ignored')return `<div class="candidate-control"><span class="candidate-ignored">Đã bỏ qua ${label}</span><button class="outline" onclick="confirmComparison(${index},'${source}','reset')">Xác nhận lại</button></div>`;if(!decisionId)return `<div class="candidate-control"><strong>${escapeHtml(row[`${source}CandidateCode`]||'Không có mã')}</strong><small>Khớp ${row[`${source}Score`]}%</small></div>`;if(!options.length)return `<div class="candidate-control"><span class="candidate-missing">Không tìm thấy mã</span><button class="outline" onclick="confirmComparison(${index},'${source}','ignore')">Bỏ qua ${label}</button></div>`;return `<div class="candidate-control"><select class="confirmation-select" data-row="${index}" data-source="${source}">${options.map(option=>`<option value="${escapeHtml(option.code)}">${escapeHtml(option.code)} — ${option.score}%</option>`).join('')}</select><div class="candidate-buttons"><button class="primary" onclick="confirmComparison(${index},'${source}','match')">Ghép ${label}</button><button class="outline" onclick="confirmComparison(${index},'${source}','ignore')">Bỏ qua</button></div></div>`}
function confirmComparison(index,source,action){
  const row=tableRows[index],id=row?.[`${source}DecisionId`];
  if(!row||!id)return;
  const code=$(`.confirmation-select[data-row="${index}"][data-source="${source}"]`)?.value||row[`${source}CandidateCode`];
  if(action==='match'&&!code){toast('Không có mã ứng viên để ghép. Bạn có thể chọn Bỏ qua.',true);return}
  confirmationQueue.set(id,{id,code,action});
  markConfirmationQueued(index,source,action);
  clearTimeout(confirmationTimer);
  confirmationTimer=setTimeout(flushConfirmations,140);
}

function markConfirmationQueued(index,source,action){
  const row=$('#tableBody').rows[index];
  const cell=row?.cells[source==='purchase'?1:2];
  if(!cell)return;
  cell.classList.add('confirmation-saving');
  cell.querySelectorAll('button,select').forEach(control=>control.disabled=true);
  let status=cell.querySelector('.confirmation-saving-label');
  if(!status){status=document.createElement('small');status.className='confirmation-saving-label';cell.appendChild(status)}
  status.textContent=action==='match'?'Đã chọn · đang lưu…':action==='reset'?'Đang đưa lại vào xác nhận…':'Đã bỏ qua · đang lưu…';
}

async function flushConfirmations(){
  if(confirmationInFlight||!confirmationQueue.size)return;
  confirmationInFlight=true;
  let processed=0,lastResult;
  try{
    do{
      const items=[...confirmationQueue.values()];
      confirmationQueue.clear();
      const settings=comparisonSettings();
      lastResult=await window.api.resolveReview({items,threshold:settings.autoThreshold,confirmationThreshold:settings.confirmationThreshold});
      processed+=items.length;
    }while(confirmationQueue.size);
    await refresh(lastResult);
    await loadTablePage(tablePage.page);
    toast(`Đã xử lý ${processed} lựa chọn`);
  }catch(e){
    toast(`Lỗi: ${e.message}`,true);
    await loadTablePage(tablePage.page);
  }finally{
    confirmationInFlight=false;
    if(confirmationQueue.size){clearTimeout(confirmationTimer);confirmationTimer=setTimeout(flushConfirmations,0)}
  }
}
function tableRowClass(row){if(['warehouse','workshop'].includes(activeTable)&&!rawMode&&row.isShortage)return 'warehouse-shortage';return activeTable==='shortage'?'status-missing':activeTable==='excess'?'status-extra':activeTable==='enough'?'status-ok':''}
function tableCell(column,row){
  const [key]=column,value=row[key]??'';
  if(key==='itemCode'&&row.replacementCode)return changedCodeCell(key,value,row.replacementCode);
  if(key==='drawingCode'&&row.originalItemCode&&row.replacementItemCode)return changedCodeCell(key,row.originalItemCode,row.replacementItemCode);
  if(key==='purchaseOrder'&&row.replacementPurchaseOrder&&row.originalPurchaseOrder)return changedCodeCell(key,row.originalPurchaseOrder,row.replacementPurchaseOrder);
  if(key==='purchaseOrder'&&row.replacementPurchaseOrder)return changedCodeCell(key,value,row.replacementPurchaseOrder);
  const tooltip=value!==''?` title="${escapeHtml(value)}"`:'';
  return `<td data-column="${key}"><span class="cell-value"${tooltip}>${escapeHtml(value)}</span></td>`;
}
function changedCodeCell(key,oldValue,newValue){return `<td data-column="${key}"><span class="cell-value changed-code${key==='purchaseOrder'?' changed-pr':''}"><s>${escapeHtml(oldValue)}</s><span class="changed-code-next"><b>→</b><strong>${escapeHtml(newValue)}</strong></span></span></td>`}
function renderCodeReplacements(){
  const rows=state.purchaseReplacements||[];
  const totalPages=Math.max(1,Math.ceil(rows.length/REPLACEMENT_PAGE_SIZE));
  replacementPage=Math.max(1,Math.min(replacementPage,totalPages));
  const start=(replacementPage-1)*REPLACEMENT_PAGE_SIZE,pageRows=rows.slice(start,start+REPLACEMENT_PAGE_SIZE);
  $('#codeReplacementList').innerHTML=pageRows.length?pageRows.map((row,index)=>`<tr><td>${start+index+1}</td><td><strong>${escapeHtml(row.projectCode)}</strong></td><td><s>${escapeHtml(row.oldCode)}</s></td><td class="replacement-direction">→</td><td><strong>${escapeHtml(row.newCode)}</strong></td><td><button class="replacement-delete" type="button" data-project="${escapeHtml(row.projectCode)}" data-old-code="${escapeHtml(row.oldCode)}" title="Loại bỏ liên kết đổi mã">Loại bỏ</button></td></tr>`).join(''):'<tr><td colspan="6" class="placeholder">Chưa có mã nào được thay đổi.</td></tr>';
  $$('#codeReplacementList .replacement-delete').forEach(button=>button.onclick=()=>removeCodeReplacement(button.dataset.project,button.dataset.oldCode));
  renderReplacementPagination(rows.length,totalPages,start,pageRows.length);
}
function renderReplacementPagination(total,totalPages,start,count){
  const items=paginationSequence(replacementPage,totalPages);
  $('#replacementPagination').innerHTML=`<span class="page-summary">${total?start+1:0}–${start+count} / ${total} dòng</span><div class="page-icons">${items.map(item=>item==='…'?'<span class="page-ellipsis">…</span>':`<button class="page-icon${item===replacementPage?' active':''}" data-page="${item}" aria-label="Trang ${item}" ${item===replacementPage?'aria-current="page"':''}>${item}</button>`).join('')}</div>`;
  $$('#replacementPagination .page-icon').forEach(button=>button.onclick=()=>{replacementPage=Number(button.dataset.page);renderCodeReplacements()});
}
async function saveCodeReplacement(event){
  event.preventDefault();
  const payload={projectCode:$('#replacementProject').value,oldCode:$('#replacementOldCode').value,newCode:$('#replacementNewCode').value};
  await run(async()=>{
    const result=await window.api.savePurchaseReplacement(payload);
    const projectCodes=[...new Set(payload.projectCode.split(',').map(value=>value.trim().toUpperCase()).filter(Boolean))];
    const index=(result.purchaseReplacements||[]).findIndex(row=>projectCodes.includes(row.projectCode)&&row.oldCode===payload.oldCode.trim().toUpperCase());
    if(index>=0)replacementPage=Math.floor(index/REPLACEMENT_PAGE_SIZE)+1;
    await refresh(result);
    event.target.reset();
  },`Đã liên kết ${payload.oldCode} → ${payload.newCode} cho ${payload.projectCode}`);
}
async function removeCodeReplacement(projectCode,oldCode){
  if(!confirm(`Xóa liên kết đổi mã ${oldCode} trong dự án ${projectCode}?`))return;
  await run(async()=>{await refresh(await window.api.deletePurchaseReplacement({projectCode,oldCode}))},'Đã loại bỏ liên kết đổi mã');
}
function paginationSequence(current,total){const pages=[1,2,3,current-1,current,current+1,total-1,total].filter(page=>page>=1&&page<=total);const unique=[...new Set(pages)].sort((a,b)=>a-b),items=[];unique.forEach((page,index)=>{if(index&&page-unique[index-1]>1)items.push('…');items.push(page)});return items}
function renderPagination(){const {page,total,totalPages,pageSize}=tablePage,start=total?(page-1)*pageSize+1:0,end=Math.min(page*pageSize,total),items=paginationSequence(page,totalPages);const html=`<span class="page-summary">${start}–${end} / ${total} dòng</span><div class="page-icons">${items.map(item=>item==='…'?'<span class="page-ellipsis">…</span>':`<button class="page-icon${item===page?' active':''}" data-page="${item}" aria-label="Trang ${item}" ${item===page?'aria-current="page"':''}>${item}</button>`).join('')}</div>`;$('#paginationTop').innerHTML=html;$$('#paginationTop .page-icon').forEach(button=>button.onclick=()=>loadTablePage(Number(button.dataset.page)))}
const backupLabels={purchases:'Mua Hàng',warehouse:'Nhập Kho',workshop:'Xưởng Gia Công'};
async function loadBackups(){const button=$('#refreshBackups'),list=$('#backupList');button.disabled=true;list.innerHTML='<div class="self-check-empty">Đang tải danh sách backup…</div>';try{const backups=await window.api.listBackups();list.innerHTML=backups.length?backups.map(backup=>`<article class="backup-entry"><div><strong>${escapeHtml(backup.fileName)}</strong><small>${escapeHtml(backup.createdAt)} · ${Math.ceil(backup.size/1024)} KB · ${backup.valid?'Hợp lệ':'Không hợp lệ'}</small></div><button class="button backup-restore${backup.valid?'':' hidden'}" type="button" data-file-name="${escapeHtml(backup.fileName)}">Khôi phục</button></article>`).join(''):'<div class="self-check-empty">Chưa có backup SQLite.</div>';$$('.backup-restore').forEach(item=>item.onclick=()=>restoreBackup(item.dataset.fileName));}catch(error){list.innerHTML=`<div class="self-check-empty">Không thể đọc backup: ${escapeHtml(error.message)}</div>`}finally{button.disabled=false}}
async function restoreBackup(fileName){if(!confirm(`Khôi phục dữ liệu từ ${fileName}? Dữ liệu hiện tại sẽ được lưu thành backup trước khi thay thế.`))return;await run(async()=>{await refresh(await window.api.restoreBackup(fileName));await loadTablePage(tablePage.page)},'Đã khôi phục dữ liệu từ backup');}
let deleteStep=1; function startDelete(){deleteStep=1;renderDelete();$('#deleteDialog').showModal()} function renderDelete(){const titles=['Xóa toàn bộ dữ liệu Mua Hàng?','Hành động không thể hoàn tác','Xác nhận lần cuối'];const texts=['Baseline tích lũy sẽ bị xóa sau ba bước xác nhận.','Toàn bộ dữ liệu Mua Hàng từ trước đến nay sẽ mất. Một backup cuối sẽ được tạo.','Nhập chính xác từ XÓA để tiếp tục.'];$('#confirmStep').textContent=deleteStep;$('#confirmTitle').textContent=titles[deleteStep-1];$('#confirmText').textContent=texts[deleteStep-1];$('#deleteKeyword').classList.toggle('hidden',deleteStep!==3);$('#confirmDelete').textContent=deleteStep===3?'XÓA VĨNH VIỄN':'Xác nhận';} async function advanceDelete(){if(deleteStep<3){deleteStep++;renderDelete();return}await run(async()=>{await refresh(await window.api.deleteDatabase($('#deleteKeyword').value));$('#deleteDialog').close()},'Đã xóa database; backup cuối đã được tạo');}
function updateNavIndicator(){const indicator=$('.nav-indicator'),active=$('.nav-item.active');if(!indicator||!active)return;const parent=active.parentElement,p=parent.getBoundingClientRect(),b=active.getBoundingClientRect();indicator.style.width=`${b.width}px`;indicator.style.transform=`translateX(${b.left-p.left+parent.scrollLeft}px)`}
function applyTheme(theme){document.body.classList.remove('theme-mint','theme-sky','theme-lavender');if(theme!=='default')document.body.classList.add(`theme-${theme}`);$$('.theme-dot').forEach(b=>b.classList.toggle('active',b.dataset.theme===theme));localStorage.setItem('theme',theme)}
async function run(fn,success){try{document.body.style.cursor='progress';await fn();if(success)toast(success)}catch(e){toast(`Lỗi: ${e.message}`,true)}finally{document.body.style.cursor=''}}function toast(msg,error=false){const t=$('#toast');t.innerHTML='';t.textContent=msg;t.style.background=error?'#9f3732':'';t.hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>t.hidden=true,4200)}function toastActions(msg,actions){const t=$('#toast');clearTimeout(toast.timer);t.innerHTML='';t.style.background='';const message=document.createElement('div');message.className='toast-message';message.textContent=msg;const actionsRow=document.createElement('div');actionsRow.className='toast-actions';actions.forEach((action,index)=>{const btn=document.createElement('button');btn.type='button';btn.className='toast-action-button'+(index>0?' toast-action-secondary':'');btn.textContent=action.label;btn.onclick=()=>{t.hidden=true;action.onClick()};actionsRow.append(btn)});t.append(message,actionsRow);t.hidden=false;toast.timer=setTimeout(()=>t.hidden=true,8000)}function labelKind(k){return {purchase:'Mua Hàng',scan:'Quét Mã',warehouse:'Nhập Kho',workshop:'Xưởng Gia Công'}[k]}function escapeHtml(v){return String(v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
init();
