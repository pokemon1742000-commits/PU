const unzipper = require('unzipper');
const { SaxesParser } = require('saxes');

async function inspectWorkbookSheets(file) {
  let directory;
  if (typeof file === 'string') {
    directory = await unzipper.Open.file(file);
  } else if (file instanceof ArrayBuffer) {
    directory = await unzipper.Open.buffer(Buffer.from(file));
  } else if (file instanceof Uint8Array) {
    directory = await unzipper.Open.buffer(Buffer.from(file.buffer, file.byteOffset, file.byteLength));
  } else if (Buffer.isBuffer(file)) {
    directory = await unzipper.Open.buffer(file);
  } else {
    throw new Error('Đường dẫn hoặc dữ liệu file không hợp lệ.');
  }

  const fileMap = new Map(directory.files.map(f => [f.path.split('\\').join('/'), f]));

  const wbFile = fileMap.get('xl/workbook.xml');
  if (!wbFile) {
    throw new Error('Không tìm thấy xl/workbook.xml trong file Excel.');
  }
  const wbXml = (await wbFile.buffer()).toString('utf8');

  const relsFile = fileMap.get('xl/_rels/workbook.xml.rels');
  const relsMap = new Map();
  if (relsFile) {
    const relsXml = (await relsFile.buffer()).toString('utf8');
    const p = new SaxesParser();
    p.on('opentag', tag => {
      if (tag.name === 'Relationship') {
        const id = tag.attributes.Id;
        const target = tag.attributes.Target;
        if (id && target) relsMap.set(id, target);
      }
    });
    p.write(relsXml).close();
  }

  const sheetDefs = [];
  const pWb = new SaxesParser();
  pWb.on('opentag', tag => {
    if (tag.name === 'sheet') {
      const name = tag.attributes.name;
      const rId = tag.attributes['r:id'] || tag.attributes['id'];
      if (name) sheetDefs.push({ name, rId });
    }
  });
  pWb.write(wbXml).close();

  const results = [];
  for (const sheet of sheetDefs) {
    const target = sheet.rId ? relsMap.get(sheet.rId) : null;
    if (!target) {
      results.push({ name: sheet.name, rowCount: 0 });
      continue;
    }
    let fullPath = target.startsWith('/') ? target.slice(1) : (target.startsWith('xl/') ? target : `xl/${target}`);
    fullPath = fullPath.split('\\').join('/');

    const sheetFile = fileMap.get(fullPath);
    if (!sheetFile) {
      results.push({ name: sheet.name, rowCount: 0 });
      continue;
    }

    const stream = sheetFile.stream();
    const rowCount = await new Promise((resCount, rejCount) => {
      let count = 0;
      let inRow = false;
      let rowHasValue = false;
      let done = false;

      const finish = () => {
        if (done) return;
        done = true;
        resCount(count);
      };

      const parser = new SaxesParser();
      parser.on('opentag', tag => {
        if (tag.name === 'row') {
          inRow = true;
          rowHasValue = false;
        } else if (inRow && (tag.name === 'v' || tag.name === 'is' || tag.name === 'f' || tag.name === 't')) {
          rowHasValue = true;
        }
      });

      parser.on('closetag', tag => {
        if (tag.name === 'row') {
          inRow = false;
          if (rowHasValue) count++;
        } else if (tag.name === 'sheetData') {
          stream.destroy();
          finish();
        }
      });

      parser.on('error', err => {
        if (done) return;
        done = true;
        rejCount(err);
      });

      stream.on('data', chunk => {
        if (done) return;
        parser.write(chunk);
      });
      stream.on('close', finish);
      stream.on('end', () => {
        if (!done) {
          try { parser.close(); } catch (_) {}
          finish();
        }
      });
      stream.on('error', err => {
        if (done) return;
        done = true;
        rejCount(err);
      });
    });

    results.push({ name: sheet.name, rowCount });
  }

  return results;
}

module.exports = { inspectWorkbookSheets };
