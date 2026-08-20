const $ = s => document.querySelector(s); const $$ = s => [...document.querySelectorAll(s)];
let state = { counts:{}, rawCounts:{}, sources:[] }, activeTable = 'comparison', rawMode = false, tableRows = [], tablePage = { page:1, pageSize:100, total:0, totalPages:1 }, replacementPage = 1, tableRequest = 0, searchTimer, thresholdTimer, confirmationTimer, confirmationInFlight = false, confirmationQueue = new Map(), sheetPickerFiles = [], sheetPickerResolve;
const REPLACEMENT_PAGE_SIZE = 100;
const tableLabels = { purchase:'Dữ Liệu Đặt Hàng — Sheet kiểm tra', scan:'Dữ Liệu Quét Mã — Sheet kiểm tra', warehouse:'Dữ Liệu Nhập Kho — Sheet kiểm tra', jobCodes:'Job Code — Cơ sở dữ liệu tích lũy', comparison:'Xác Nhận Mã Đối Chiếu', enough:'Đủ hàng', shortage:'Thiếu hàng', excess:'Thừa hàng', warnings:'Cảnh Báo' };
const columns = {
  purchase:[['stt','STT'],['projectCode','Mã dự án'],['purchaseOrder','Số PR'],['itemCode','Mã hàng'],['itemName','Tên hàng'],['quantity','Số lượng'],['note','Ghi chú'],['sourceFile','File nguồn'],['sourceRow','Dòng']],
  scan:[['stt','STT'],['projectCode','Mã dự án'],['drawingCode','Mã bản vẽ'],['quantity','Số lượng quét mã'],['manufacturer','Nhà sản xuất'],['warehouseDate','Ngày nhập kho'],['scanDate','Ngày quét mã'],['note','Ghi chú'],['sourceFile','File nguồn']],
  warehouse:[['stt','STT'],['projectCode','Mã dự án'],['itemCode','Mã hàng'],['itemName','Tên hàng'],['supplier','NCC'],['orderedQuantity','SL đặt hàng'],['receivedQuantity','SL đã về'],['deliveryDate','Ngày giao hàng'],['note','Ghi chú'],['sourceFile','File nguồn']],
  jobCodes:[['stt','STT'],['code','Code'],['note','Ghi chú']],
  comparison:[['stt','STT'],['projectCode','Mã dự án'],['drawingCode','Mã bản vẽ'],['purchaseOrder','Số PR'],['supplier','Nhà cung cấp'],['itemName','Tên hàng'],['scanQuantity','Số lượng quét mã'],['warehouseQuantity','SL nhập kho'],['purchaseQuantity','SL mua hàng'],['warehouseStatus','TT Nhập kho'],['scanStatus','TT Quét mã'],['note','Ghi chú'],['maker','Maker'],['scanDate','Ngày quét mã'],['warehouseDate','Ngày nhập kho'],['matchStatus','Khớp mã']],
  enough:[['stt','STT'],['projectCode','Mã dự án'],['drawingCode','Mã bản vẽ'],['purchaseOrder','Số PR'],['supplier','Nhà cung cấp'],['itemName','Tên hàng'],['scanQuantity','Số lượng quét mã'],['warehouseQuantity','SL nhập kho'],['purchaseQuantity','SL mua hàng'],['warehouseStatus','TT Nhập kho'],['scanStatus','TT Quét mã'],['note','Ghi chú'],['maker','Maker'],['scanDate','Ngày quét mã'],['warehouseDate','Ngày nhập kho'],['matchStatus','Khớp mã']],
  shortage:[['stt','STT'],['projectCode','Mã dự án'],['drawingCode','Mã bản vẽ'],['purchaseOrder','Số PR'],['supplier','Nhà cung cấp'],['itemName','Tên hàng'],['scanQuantity','Số lượng quét mã'],['warehouseQuantity','SL nhập kho'],['purchaseQuantity','SL mua hàng'],['warehouseStatus','TT Nhập kho'],['scanStatus','TT Quét mã'],['note','Ghi chú'],['maker','Maker'],['scanDate','Ngày quét mã'],['warehouseDate','Ngày nhập kho'],['matchStatus','Khớp mã']],
  excess:[['stt','STT'],['projectCode','Mã dự án'],['drawingCode','Mã bản vẽ'],['purchaseOrder','Số PR'],['supplier','Nhà cung cấp'],['itemName','Tên hàng'],['scanQuantity','Số lượng quét mã'],['warehouseQuantity','SL nhập kho'],['purchaseQuantity','SL mua hàng'],['warehouseStatus','TT Nhập kho'],['scanStatus','TT Quét mã'],['note','Ghi chú'],['maker','Maker'],['scanDate','Ngày quét mã'],['warehouseDate','Ngày nhập kho'],['matchStatus','Khớp mã']],
  warnings:[['stt','STT'],['projectCode','Mã dự án'],['purchaseOrder','Số PR'],['itemCode','Mã hàng'],['itemName','Tên hàng'],['quantity','Số lượng'],['sourceFile','File nguồn'],['sourceRow','Dòng'],['note','Ghi chú']]
};

async function init(){ $('#sheetOptions').innerHTML='<div class="export-single-sheet"><strong>1 sheet dữ liệu đối chiếu</strong><span>Theo mẫu SỐ LIỆU XUẤT KHO, không kèm bảng xác nhận.</span></div>'; applyTheme(localStorage.getItem('theme')||'default'); bind(); await refresh(await window.api.getState()); requestAnimationFrame(updateNavIndicator); }
function bind(){
  $$('.nav').forEach(b=>b.onclick=async()=>{show(b.dataset.view,b);if(b.dataset.openTable)await showTable(b.dataset.openTable)});
  $$('.load').forEach(b=>b.onclick=()=>handleLoad(b));
  $('#threshold').oninput=()=>{if(Number($('#confirmationThreshold').value)>=Number($('#threshold').value))$('#confirmationThreshold').value=Math.max(0,Number($('#threshold').value)-1);scheduleThresholdUpdate()};
  $('#confirmationThreshold').oninput=()=>{if(Number($('#confirmationThreshold').value)>=Number($('#threshold').value))$('#confirmationThreshold').value=Math.max(0,Number($('#threshold').value)-1);scheduleThresholdUpdate()};
  $('#cancelSheetPicker').onclick=()=>closeSheetPicker(null);
  $('#confirmSheetPicker').onclick=confirmSheetSelection;
  $('#codeReplacementForm').onsubmit=saveCodeReplacement;
  $$('[data-table]').forEach(b=>b.onclick=async()=>{show('data',$(`.nav[data-open-table="${b.dataset.table}"]`));await showTable(b.dataset.table)});
  $('#tableSearch').oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>loadTablePage(1),250)};
  $('#rawToggle').onclick=async()=>{rawMode=!rawMode;updateRawToggle();await loadTablePage(1)};
  $('#warningShortcut').onclick=async()=>{const target=activeTable==='warnings'?'purchase':'warnings';show('data',$('.nav-item[data-open-table="purchase"]'));await showTable(target)};
  $('#exportBtn').onclick=async()=>run(async()=>{const r=await window.api.exportExcel(['comparison']);if(!r.canceled)toast(`Đã xuất: ${r.path}`)},null);
  $('#infoBtn').onclick=()=>{showInfoPanel('releaseInfo');$('#infoDialog').showModal()};
  $$('.info-tab').forEach(button=>button.onclick=()=>showInfoPanel(button.dataset.infoPanel));
  $('#closeInfo').onclick=()=>$('#infoDialog').close();
  $('#infoDialog').onclick=event=>{if(event.target===$('#infoDialog'))$('#infoDialog').close()};
  $('#githubLink').onclick=()=>run(()=>window.api.openExternal('https://github.com/pokemon1742000-commits/PU'),null);
  $('#exportPageBtn').onclick=$('#exportBtn').onclick;
  $('#updateBtn').onclick=checkForUpdates;
  window.api.onUpdateStatus(renderUpdateStatus);
  $('#clearSession').onclick=async()=>{if(confirm('Bạn có chắc muốn xóa dữ liệu Quét Mã và các xác nhận? Dữ liệu Mua Hàng và Nhập Kho sẽ được giữ lại.')) await run(async()=>refresh(await window.api.clearSession()),'Đã clear phiên làm việc');};
  $('#deleteDatabase').onclick=()=>startDelete();
  $('#confirmDelete').onclick=e=>{e.preventDefault();advanceDelete();};
  $$('.theme-dot').forEach(b=>b.onclick=()=>applyTheme(b.dataset.theme));
  window.addEventListener('resize',updateNavIndicator);
}
function showInfoPanel(panelId){$$('.info-panel').forEach(panel=>panel.hidden=panel.id!==panelId);$$('.info-tab').forEach(button=>button.classList.toggle('active',button.dataset.infoPanel===panelId))}
async function checkForUpdates(){
  const button=$('#updateBtn');
  button.disabled=true;
  try { renderUpdateStatus(await window.api.checkForUpdates()); }
  catch(e){renderUpdateStatus({status:'error',message:`Cập nhật thất bại: ${e.message}`})}
}
function renderUpdateStatus(update){
  const button=$('#updateBtn'),busy=['checking','downloading','installing'].includes(update?.status);
  button.disabled=busy;
  button.classList.toggle('updating',busy);
  button.querySelector('span').textContent=update?.status==='downloading'?`Update ${update.percent||0}%`:update?.status==='installing'?'Đang cài...':update?.status==='checking'?'Đang kiểm tra...':'Update';
  if(update?.message&&update.status!=='idle')toast(update.message,update.status==='error');
}
function show(id,button){ $$('.view').forEach(x=>x.classList.toggle('active',x.id===id)); $$('.nav').forEach(x=>x.classList.remove('active')); button?.classList.add('active'); requestAnimationFrame(updateNavIndicator); }
async function refresh(s){ if(s?.canceled)return; state=s; const c=s.counts||{},version=s.appVersion||'—',versionLabel=version==='—'?'v—':`v${version}`; for(const k of ['comparison','enough','shortage','excess','warnings']) $(`#${k}Count`) && ($(`#${k}Count`).textContent=c[k]||0); $('#dashPurchase').textContent=c.purchase||0;$('#dashScan').textContent=c.scans||0;$('#dashReview').textContent=c.review||0;$('#reviewBadge').textContent=c.review||0;$('#appVersion').textContent=versionLabel;$('#headerVersion').textContent=versionLabel;$$('.release-note').forEach(note=>{const current=note.dataset.version===version;note.classList.toggle('current',current);note.querySelector('.current-version-badge').hidden=!current}); if(s.autoThreshold!==undefined)$('#threshold').value=s.autoThreshold;if(s.confirmationThreshold!==undefined)$('#confirmationThreshold').value=s.confirmationThreshold;syncThresholdLabels();updateRawToggle();renderCodeReplacements(); }

async function handleLoad(button){
  try {
    document.body.style.cursor='progress';
    const picked=await window.api.pickFiles(button.dataset.kind);
    document.body.style.cursor='';
    if(picked?.canceled)return;
    const selections=await chooseSheets(picked.files||[]);
    if(!selections?.length)return;
    await run(async()=>{
      const result=await window.api.loadFiles(button.dataset.kind,selections);
      await refresh(result);
      const table=button.dataset.kind;
      show('data',$(`.nav[data-open-table="${table}"]`));
      await showTable(table);
      const stats=result.loadStats||{};
      const changes=Number.isFinite(stats.added)&&Number.isFinite(stats.updated)
        ? ` · thêm ${stats.added}, cập nhật ${stats.updated}, không đổi ${stats.unchanged||0}`:'';
      toast(`Đã nạp ${selections.length} file ${labelKind(button.dataset.kind)}${changes}`);
    },null);
  } catch(e){ document.body.style.cursor=''; toast(`Lỗi: ${e.message}`,true); }
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

async function applyThreshold(){
  if(!(state.counts?.scans&&(state.counts?.purchase||state.counts?.warehouse)))return;
  await run(async()=>{await refresh(await window.api.runComparison(comparisonSettings()));if(['comparison','enough','shortage','excess'].includes(activeTable))await loadTablePage(1)},null);
}
function comparisonSettings(){return {autoThreshold:Number($('#threshold').value),confirmationThreshold:Number($('#confirmationThreshold').value)}}
function syncThresholdLabels(){$('#thresholdValue').textContent=`${$('#threshold').value}%`;$('#confirmationThresholdValue').textContent=`${$('#confirmationThreshold').value}%`}
function scheduleThresholdUpdate(){syncThresholdLabels();clearTimeout(thresholdTimer);thresholdTimer=setTimeout(applyThreshold,350)}
async function showTable(name){ activeTable=name;rawMode=false; $('#tableTitle').textContent=tableLabels[name]; $('#tableSearch').value='';updateRawToggle();await loadTablePage(1); }
function rawSourceName(){return {purchase:'purchaseDetails',scan:'scanDetails',warehouse:'warehouseDetails',jobCodes:'jobCodeDetails',warnings:'purchaseDetails'}[activeTable]||activeTable}
function updateRawToggle(){const button=$('#rawToggle'),supported=['purchase','scan','warehouse','jobCodes','warnings'].includes(activeTable),available=(state.rawCounts?.[activeTable]||0)>0,warningMode=['purchase','warnings'].includes(activeTable);if(!available)rawMode=false;button.hidden=!supported;button.disabled=!available;button.classList.toggle('active',rawMode);button.setAttribute('aria-pressed',String(rawMode));button.title=available?'Chuyển giữa dữ liệu đã gộp và file gốc':'Hãy nạp lại file để có dữ liệu gốc';button.querySelector('span').textContent=rawMode?'Đang xem file gốc':available?'Xem file gốc':'Chưa có file gốc';$('#warningShortcut').hidden=!warningMode;$('#warningShortcut').textContent=activeTable==='warnings'?'← Mua Hàng':'⚠ Cảnh Báo';$('#warningShortcut').classList.toggle('active',activeTable==='warnings');$('#tableSideActions').hidden=!supported&&!warningMode}
async function loadTablePage(page){ const request=++tableRequest,source=rawMode?rawSourceName():(activeTable==='comparison'?'review':activeTable),result=await window.api.getRows(source,{page,pageSize:100,query:$('#tableSearch').value});if(request!==tableRequest)return;tableRows=result.rows;tablePage=result;renderTable(); }
function displayedTable(){return activeTable==='warnings'&&rawMode?'purchase':activeTable}
function renderTable(){ if(activeTable==='comparison'&&!rawMode){renderConfirmations();return}const tableName=displayedTable(),cols=columns[tableName],rows=tableRows; $('#tableHead').closest('table').dataset.table=tableName; $('#tableHead').innerHTML=`<tr>${cols.map(x=>`<th data-column="${x[0]}">${x[1]}</th>`).join('')}</tr>`; $('#tableBody').innerHTML=rows.length?rows.map(r=>`<tr class="${tableRowClass(r)}">${cols.map(x=>tableCell(x,r)).join('')}</tr>`).join(''):`<tr><td colspan="${cols.length}" class="placeholder">Chưa có dữ liệu.</td></tr>`;renderPagination(); }
function renderConfirmations(){const table=$('#tableHead').closest('table');table.dataset.table='confirmation';$('#tableHead').innerHTML='<tr><th>Mã file Quét Mã</th><th>Mã file Mua Hàng</th><th>Mã file Nhập Kho</th><th>Trạng thái</th></tr>';$('#tableBody').innerHTML=tableRows.length?tableRows.map((row,index)=>`<tr class="${row.status==='Đã bỏ qua'?'confirmation-ignored':''}"><td><strong>${escapeHtml(row.projectCode)}</strong><br><span>${escapeHtml(row.scanDrawingCode)}</span></td><td>${confirmationCandidate(row,'purchase',index)}</td><td>${confirmationCandidate(row,'warehouse',index)}</td><td><span class="confirmation-status">${escapeHtml(row.status)}</span></td></tr>`).join(''):'<tr><td colspan="4" class="placeholder">Không có mã nào cần xác nhận hoặc đã bỏ qua.</td></tr>';renderPagination()}
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
function tableRowClass(row){if(activeTable==='warehouse'&&!rawMode&&row.isShortage)return 'warehouse-shortage';return activeTable==='shortage'?'status-missing':activeTable==='excess'?'status-extra':activeTable==='enough'?'status-ok':''}
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
    const index=(result.purchaseReplacements||[]).findIndex(row=>row.projectCode===payload.projectCode.trim().toUpperCase()&&row.oldCode===payload.oldCode.trim().toUpperCase());
    if(index>=0)replacementPage=Math.floor(index/REPLACEMENT_PAGE_SIZE)+1;
    await refresh(result);
    event.target.reset();
  },`Đã liên kết ${payload.oldCode} → ${payload.newCode}`);
}
async function removeCodeReplacement(projectCode,oldCode){
  if(!confirm(`Xóa liên kết đổi mã ${oldCode} trong dự án ${projectCode}?`))return;
  await run(async()=>{await refresh(await window.api.deletePurchaseReplacement({projectCode,oldCode}))},'Đã loại bỏ liên kết đổi mã');
}
function paginationSequence(current,total){const pages=[1,2,3,current-1,current,current+1,total-1,total].filter(page=>page>=1&&page<=total);const unique=[...new Set(pages)].sort((a,b)=>a-b),items=[];unique.forEach((page,index)=>{if(index&&page-unique[index-1]>1)items.push('…');items.push(page)});return items}
function renderPagination(){const {page,total,totalPages,pageSize}=tablePage,start=total?(page-1)*pageSize+1:0,end=Math.min(page*pageSize,total),items=paginationSequence(page,totalPages);const html=`<span class="page-summary">${start}–${end} / ${total} dòng</span><div class="page-icons">${items.map(item=>item==='…'?'<span class="page-ellipsis">…</span>':`<button class="page-icon${item===page?' active':''}" data-page="${item}" aria-label="Trang ${item}" ${item===page?'aria-current="page"':''}>${item}</button>`).join('')}</div>`;$('#paginationTop').innerHTML=html;$$('#paginationTop .page-icon').forEach(button=>button.onclick=()=>loadTablePage(Number(button.dataset.page)))}
let deleteStep=1; function startDelete(){deleteStep=1;renderDelete();$('#deleteDialog').showModal()} function renderDelete(){const titles=['Xóa toàn bộ dữ liệu Mua Hàng?','Hành động không thể hoàn tác','Xác nhận lần cuối'];const texts=['Baseline tích lũy sẽ bị xóa sau ba bước xác nhận.','Toàn bộ dữ liệu Mua Hàng từ trước đến nay sẽ mất. Một backup cuối sẽ được tạo.','Nhập chính xác từ XÓA để tiếp tục.'];$('#confirmStep').textContent=deleteStep;$('#confirmTitle').textContent=titles[deleteStep-1];$('#confirmText').textContent=texts[deleteStep-1];$('#deleteKeyword').classList.toggle('hidden',deleteStep!==3);$('#confirmDelete').textContent=deleteStep===3?'XÓA VĨNH VIỄN':'Xác nhận';} async function advanceDelete(){if(deleteStep<3){deleteStep++;renderDelete();return}await run(async()=>{await refresh(await window.api.deleteDatabase($('#deleteKeyword').value));$('#deleteDialog').close()},'Đã xóa database; backup cuối đã được tạo');}
function updateNavIndicator(){const indicator=$('.nav-indicator'),active=$('.nav-item.active');if(!indicator||!active)return;const parent=active.parentElement,p=parent.getBoundingClientRect(),b=active.getBoundingClientRect();indicator.style.width=`${b.width}px`;indicator.style.transform=`translateX(${b.left-p.left+parent.scrollLeft}px)`}
function applyTheme(theme){document.body.classList.remove('theme-mint','theme-sky','theme-lavender');if(theme!=='default')document.body.classList.add(`theme-${theme}`);$$('.theme-dot').forEach(b=>b.classList.toggle('active',b.dataset.theme===theme));localStorage.setItem('theme',theme)}
async function run(fn,success){try{document.body.style.cursor='progress';await fn();if(success)toast(success)}catch(e){toast(`Lỗi: ${e.message}`,true)}finally{document.body.style.cursor=''}}function toast(msg,error=false){const t=$('#toast');t.textContent=msg;t.style.background=error?'#9f3732':'';t.hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>t.hidden=true,4200)}function labelKind(k){return {purchase:'Mua Hàng',scan:'Quét Mã',warehouse:'Nhập Kho'}[k]}function escapeHtml(v){return String(v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
init();
