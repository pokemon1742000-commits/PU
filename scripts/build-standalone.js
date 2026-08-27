const fs = require('fs/promises');
const path = require('path');
const esbuild = require('esbuild');

const root = path.join(__dirname, '..');

async function build() {
  const [{ outputFiles }, template, styles, preview, rendererApp] = await Promise.all([
    esbuild.build({ entryPoints:[path.join(root, 'standalone', 'app.js')], bundle:true, write:false, platform:'browser', format:'iife', target:['chrome100','edge100','firefox100','safari15'], minify:true, loader:{ '.xlsx':'dataurl' }, define:{ 'process.env.NODE_ENV':'"production"' } }),
    fs.readFile(path.join(root, 'renderer', 'index.html'), 'utf8'),
    fs.readFile(path.join(root, 'renderer', 'styles.css'), 'utf8'),
    fs.readFile(path.join(root, 'renderer', 'preview.css'), 'utf8'),
    fs.readFile(path.join(root, 'renderer', 'app.js'), 'utf8')
  ]);
  let html = template
    .replace('<link rel="stylesheet" href="styles.css">\n  <link rel="stylesheet" href="preview.css">', `<style>${styles}\n${preview}</style>`)
    .replace('  <script src="web-api.js"></script>\n  <script src="app.js"></script>', `  <script>${safeScript(outputFiles[0].text)}</script>\n  <script>${safeScript(rendererApp)}</script>`);
  for (const asset of ['app-logo.png','guide-actual-controls.png','guide-actual-confirm.png','guide-actual-results.png']) {
    const data = await fs.readFile(path.join(root, 'assets', asset));
    html = html.replaceAll(`../assets/${asset}`, `data:image/png;base64,${data.toString('base64')}`);
  }
  html = html.replace('<title>', '<title>Bản web độc lập — ');
  await fs.writeFile(path.join(root, 'standalone', 'index.html'), html, 'utf8');
  console.log(`Đã tạo standalone/index.html (${Math.ceil(Buffer.byteLength(html) / 1024)} KB)`);
}

function safeScript(source) { return source.replaceAll('</script', '<\\/script'); }

build().catch(error => { console.error(error); process.exitCode = 1; });
