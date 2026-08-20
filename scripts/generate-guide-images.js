const { app, BrowserWindow } = require('electron');
const fs = require('fs/promises');
const path = require('path');

const root = path.join(__dirname, '..');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function addCallouts(win, items) {
  await win.webContents.executeJavaScript(`(() => {
    document.querySelectorAll('.capture-callout,.capture-callout-style').forEach(node => node.remove());
    const style=document.createElement('style');style.className='capture-callout-style';style.textContent='.capture-callout{position:fixed;z-index:99999;display:flex;align-items:center;gap:7px;padding:5px 9px 5px 5px;border:2px solid #e52424;border-radius:999px;background:#fff;color:#a51212;box-shadow:0 5px 15px rgba(80,0,0,.24);font:700 13px/1.2 Segoe UI,Arial;pointer-events:none;white-space:nowrap}.capture-callout b{display:grid;place-items:center;width:25px;height:25px;border-radius:50%;background:#e52424;color:#fff;font-size:14px}';document.head.appendChild(style);
    const items=${JSON.stringify(items)};
    for(const item of items){const el=document.querySelector(item.selector);if(!el)continue;const r=el.getBoundingClientRect(),node=document.createElement('div');node.className='capture-callout';node.innerHTML='<b>'+item.number+'</b><span>'+item.label+'</span>';document.body.appendChild(node);const w=node.offsetWidth,h=node.offsetHeight;let left=r.right+8,top=r.top+(r.height-h)/2;if(item.side==='left')left=r.left-w-8;if(item.side==='bottom'){left=r.left+(r.width-w)/2;top=r.bottom+7}if(item.side==='top'){left=r.left+(r.width-w)/2;top=r.top-h-7}left=Math.max(6,Math.min(innerWidth-w-6,left));top=Math.max(6,Math.min(innerHeight-h-6,top));node.style.left=left+'px';node.style.top=top+'px'}
  })()`);
  await wait(120);
}

async function capture(win, name) {
  win.webContents.invalidate();
  await wait(500);
  await win.webContents.capturePage();
  await wait(250);
  const image = await win.webContents.capturePage();
  await fs.writeFile(path.join(root, 'assets', name), image.toPNG());
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width:1440, height:900, show:false, useContentSize:true, backgroundColor:'#f4f8fb', webPreferences:{ preload:path.join(__dirname, 'guide-preload.js'), contextIsolation:true, nodeIntegration:false, backgroundThrottling:false } });
  await win.loadFile(path.join(root, 'renderer', 'index.html'));
  await wait(700);

  await addCallouts(win, [
    { selector:'.load[data-kind="purchase"]', number:1, label:'Nạp Mua Hàng' },
    { selector:'.load[data-kind="warehouse"]', number:2, label:'Nạp Nhập Kho' },
    { selector:'.load[data-kind="scan"]', number:3, label:'Nạp Quét Mã' },
    { selector:'.nav[data-view="replacements"]', number:4, label:'Đổi mã PR' },
    { selector:'#clearSession', number:5, label:'Clear phiên' },
    { selector:'#infoBtn', number:6, label:'Thông tin', side:'bottom' },
    { selector:'#updateBtn', number:7, label:'Cập nhật', side:'bottom' },
    { selector:'#exportBtn', number:8, label:'Xuất Excel', side:'bottom' }
  ]);
  await capture(win, 'guide-actual-controls.png');

  await win.webContents.executeJavaScript(`document.querySelector('.nav[data-open-table="comparison"]').click()`);
  await wait(900);
  await addCallouts(win, [
    { selector:'.nav[data-open-table="comparison"]', number:1, label:'Trang Xác Nhận', side:'bottom' },
    { selector:'.confirmation-select[data-source="purchase"]', number:2, label:'Chọn mã Mua Hàng', side:'top' },
    { selector:'.candidate-buttons button.primary', number:3, label:'Ghép mã', side:'bottom' },
    { selector:'.candidate-buttons button.outline', number:4, label:'Bỏ qua', side:'bottom' }
  ]);
  await capture(win, 'guide-actual-confirm.png');

  await win.webContents.executeJavaScript(`document.querySelector('.nav[data-open-table="enough"]').click()`);
  await wait(900);
  await addCallouts(win, [
    { selector:'.nav[data-open-table="enough"]', number:1, label:'Đủ Hàng', side:'bottom' },
    { selector:'.nav[data-open-table="shortage"]', number:2, label:'Thiếu', side:'bottom' },
    { selector:'.nav[data-open-table="excess"]', number:3, label:'Thừa', side:'bottom' },
    { selector:'#tableSearch', number:4, label:'Tìm nhanh', side:'bottom' },
    { selector:'#exportBtn', number:5, label:'Xuất báo cáo', side:'bottom' }
  ]);
  await capture(win, 'guide-actual-results.png');
  win.destroy();
  app.quit();
}).catch(error => { console.error(error); app.exit(1); });
