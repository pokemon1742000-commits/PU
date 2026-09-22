const { app, BrowserWindow } = require('electron');
const fs = require('fs/promises');
const path = require('path');

const root = path.join(__dirname, '..');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function addCallouts(win, items) {
  await win.webContents.executeJavaScript(`(() => {
    document.querySelectorAll('.capture-target-box,.capture-callout-style').forEach(node => node.remove());
    const style=document.createElement('style');
    style.className='capture-callout-style';
    style.textContent='.capture-target-box{position:fixed;z-index:99999;border:3px solid #e52424;border-radius:4px;background:rgba(255,245,245,.08);box-shadow:0 0 0 2px rgba(255,255,255,.9),0 5px 18px rgba(80,0,0,.22);pointer-events:none}.capture-target-box b{position:absolute;top:-15px;left:-15px;display:grid;place-items:center;width:27px;height:27px;border:2px solid #fff;border-radius:4px;background:#e52424;color:#fff;font:800 14px/1 Segoe UI,Arial;box-shadow:0 3px 8px rgba(80,0,0,.28)}';
    document.head.appendChild(style);
    const items=${JSON.stringify(items)};
    for(const item of items){
      const el=document.querySelector(item.selector);
      if(!el)continue;
      const r=el.getBoundingClientRect();
      const node=document.createElement('div');
      node.className='capture-target-box';
      node.innerHTML='<b>'+item.number+'</b>';
      node.style.left=Math.max(2,r.left-5)+'px';
      node.style.top=Math.max(2,r.top-5)+'px';
      node.style.width=Math.min(innerWidth-4,r.width+10)+'px';
      node.style.height=Math.min(innerHeight-4,r.height+10)+'px';
      document.body.appendChild(node);
    }
  })()`);
  await wait(120);
}

async function capture(win, name) {
  win.webContents.invalidate();
  await wait(500);
  const image = await win.webContents.capturePage();
  await fs.writeFile(path.join(root, 'assets', name), image.toPNG());
}

async function navigate(win, script) {
  await win.webContents.executeJavaScript(script);
  await wait(900);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width:1440,
    height:900,
    show:false,
    useContentSize:true,
    backgroundColor:'#f4f8fb',
    webPreferences:{
      preload:path.join(__dirname, 'guide-preload.js'),
      contextIsolation:true,
      nodeIntegration:false,
      backgroundThrottling:false
    }
  });
  await win.loadFile(path.join(root, 'renderer', 'index.html'));
  await wait(700);

  await addCallouts(win, [
    { selector:'.load[data-kind="purchase"]', number:1 },
    { selector:'.load[data-kind="warehouse"]', number:2 },
    { selector:'.load[data-kind="workshop"]', number:3 },
    { selector:'.load[data-kind="scan"]', number:4 }
  ]);
  await capture(win, 'guide-01-import.png');

  await win.webContents.executeJavaScript(`(() => {
    const picker=document.querySelector('#sheetPicker');
    const list=document.querySelector('#sheetPickerList');
    list.innerHTML='<div class="sheet-picker-row"><div class="sheet-file-name">MuaHang-demo.xlsx</div><div class="sheet-options"><label class="sheet-option"><input type="checkbox" checked><span>PR tháng 08 <small>(24 dòng)</small></span></label><label class="sheet-option"><input type="checkbox" checked><span>Danh sách phụ <small>(8 dòng)</small></span></label></div></div>';
    picker.hidden=false;
  })()`);
  await wait(300);
  await addCallouts(win, [
    { selector:'#sheetPickerList input[type="checkbox"]', number:1 },
    { selector:'#confirmSheetPicker', number:2 }
  ]);
  await capture(win, 'guide-02-sheet-picker.png');
  await win.webContents.executeJavaScript(`document.querySelector('#sheetPicker').hidden=true`);

  await navigate(win, `document.querySelector('.nav[data-open-table="purchase"]').click()`);
  await addCallouts(win, [
    { selector:'#tableSearch', number:1 },
    { selector:'#warningShortcut', number:2 },
    { selector:'#rawToggle', number:3 },
    { selector:'#paginationTop', number:4 }
  ]);
  await capture(win, 'guide-03-table-tools.png');

  await navigate(win, `document.querySelector('.theme-dot[data-theme="mint"]').click()`);
  await addCallouts(win, [
    { selector:'#threshold', number:1 },
    { selector:'#confirmationThreshold', number:2 },
    { selector:'.theme-dots', number:3 }
  ]);
  await capture(win, 'guide-04-threshold-theme.png');

  await navigate(win, `document.querySelector('.nav[data-open-table="comparison"]').click()`);
  await addCallouts(win, [
    { selector:'.nav[data-open-table="comparison"]', number:1 },
    { selector:'.confirmation-select[data-source="purchase"]', number:2 },
    { selector:'.candidate-buttons button.primary', number:3 },
    { selector:'.candidate-buttons button.outline', number:4 }
  ]);
  await capture(win, 'guide-05-confirm.png');

  await navigate(win, `document.querySelector('.nav[data-open-table="enough"]').click()`);
  await addCallouts(win, [
    { selector:'.nav[data-open-table="enough"]', number:1 },
    { selector:'.nav[data-open-table="shortage"]', number:2 },
    { selector:'.nav[data-open-table="excess"]', number:3 },
    { selector:'#tableSearch', number:4 },
    { selector:'#exportBtn', number:5 }
  ]);
  await capture(win, 'guide-06-results-export.png');

  await navigate(win, `document.querySelector('.nav[data-view="replacements"]').click()`);
  await addCallouts(win, [
    { selector:'#replacementProject', number:1 },
    { selector:'#replacementOldCode', number:2 },
    { selector:'#replacementNewCode', number:3 },
    { selector:'#codeReplacementForm button[type="submit"]', number:4 }
  ]);
  await capture(win, 'guide-07-replacements.png');

  await navigate(win, `document.querySelector('.nav[data-view="settings"]').click()`);
  await win.webContents.executeJavaScript(`document.querySelector('#runSelfCheck').closest('.technical-check').open=true`);
  await win.webContents.executeJavaScript(`document.querySelector('#backupList').innerHTML='<article class="backup-entry"><div><strong>data-demo.sqlite</strong><small>22/09/2026 · 128 KB · Hợp lệ</small></div><button class="button backup-restore" type="button">Khôi phục</button></article>`);
  await addCallouts(win, [
    { selector:'#runDataAudit', number:1 },
    { selector:'#runSelfCheck', number:2 },
    { selector:'#refreshBackups', number:3 },
    { selector:'#deleteDatabase', number:4 }
  ]);
  await capture(win, 'guide-08-database.png');

  await navigate(win, `document.querySelector('#exportBtn').click()`);
  await addCallouts(win, [
    { selector:'.export-type-option[data-export-type="pu"]', number:1 },
    { selector:'.export-type-option[data-export-type="source"]', number:2 },
    { selector:'#confirmExportTypePicker', number:3 }
  ]);
  await capture(win, 'guide-09-export.png');

  win.destroy();
  app.quit();
}).catch(error => { console.error(error); app.exit(1); });
