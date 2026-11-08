const { test } = require('node:test');
const assert = require('node:assert/strict');
const { crc32, deflateRawSync } = require('node:zlib');
const createEngine = require('../js/engine.js');
const loadSheetJS = require('../js/vendor/sheetjs-0.20.3.js');

function archive(entries) {
  const locals = [];
  const directory = [];
  let offset = 0;
  for (const { name, contents, declared = contents.length, badCrc = false } of entries) {
    const filename = Buffer.from(name);
    const data = deflateRawSync(contents);
    const crc = (crc32(contents) + Number(badCrc)) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(declared, 22);
    local.writeUInt16LE(filename.length, 26);
    locals.push(local, filename, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(declared, 24);
    central.writeUInt16LE(filename.length, 28);
    central.writeUInt32LE(offset, 42);
    directory.push(central, filename);
    offset += local.length + filename.length + data.length;
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.reduce((length, value) => length + value.length, 0), 12);
  end.writeUInt32LE(offset, 16);
  return new File([...locals, ...directory, end], 'sintetico.xlsx');
}

test('rechaza tamaños ZIP falsos, expansión excesiva, CRC incorrecto y densidad antes de SheetJS', async () => {
  const { run } = createEngine(() => assert.fail('No se debe iniciar SheetJS con estos ZIP'));
  const name = 'xl/worksheets/sheet1.xml';
  const expanded = Buffer.alloc(65 * 1024 * 1024, 65);
  const oversized = archive([{ name, contents: expanded }]);
  assert.ok(oversized.size < 100 * 1024);
  await assert.rejects(run('importXlsx', oversized), /64 MiB/);
  await assert.rejects(run('importXlsx', archive([{ name, contents: expanded, declared: 1024 }])), /XLSX válido/);
  await assert.rejects(run('importXlsx', archive([{ name, contents: Buffer.from('<a/>'), badCrc: true }])), /XLSX válido/);
  await assert.rejects(run('importXlsx', archive([{ name, contents: Buffer.from('<c/>'.repeat(500001)) }])), /celdas con datos/);
  await assert.rejects(run('importXlsx', archive([{ name, contents: Buffer.from('<c/>'.repeat(20001)) }]), { mainThread: true }), /celdas con datos/);
});

test('importa 400.000 celdas sintéticas en un proceso con presupuesto de heap limitado', async t => {
  const xlsx = loadSheetJS();
  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbook, xlsx.utils.aoa_to_sheet([['A', 'B', 'C', 'D']]), 'Datos');
  const seed = xlsx.CFB.read(new Uint8Array(xlsx.write(workbook, { type: 'array', bookType: 'xlsx' })), { type: 'array' });
  const rows = 100000;
  const xml = ['<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'];
  for (let r = 1; r <= rows; r++) {
    xml.push(`<row r="${r}"><c r="A${r}"><v>${r}</v></c><c r="B${r}"><v>2</v></c><c r="C${r}"><v>3</v></c><c r="D${r}"><v>4</v></c></row>`);
  }
  xml.push('</sheetData></worksheet>');
  const sheet = Buffer.from(xml.join(''));
  const entries = seed.FullPaths.flatMap((entry, index) => {
    const name = entry.slice('Root Entry/'.length);
    if (!name || name.startsWith('\x01')) return [];
    return [{ name, contents: name === 'xl/worksheets/sheet1.xml' ? sheet : Buffer.from(seed.FileIndex[index].content) }];
  });
  const file = archive(entries);
  const start = performance.now();
  const base = process.memoryUsage.rss();
  let peak = base;
  const { run } = createEngine(loadSheetJS);
  const result = await run('importXlsx', file, { progress() { peak = Math.max(peak, process.memoryUsage.rss()); } });
  assert.equal(result.count, rows - 1);
  assert.deepEqual(result.columns, ['1', '2', '3', '4']);
  assert.deepEqual(result.rows[0], ['2', '2', '3', '4']);
  t.diagnostic(`XLSX ${file.size} bytes, XML ${sheet.length} bytes, ${Math.round(performance.now() - start)} ms, RSS muestreada ${Math.round(base / 1048576)}–${Math.round(peak / 1048576)} MiB`);
});
