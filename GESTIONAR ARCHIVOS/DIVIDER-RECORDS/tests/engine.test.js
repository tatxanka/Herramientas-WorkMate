'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { crc32 } = require('node:zlib');
const E = require('../js/engine');
const F = require('./fixtures');

const make = (data, name = 'captaciones.csv') => new File([data], name);
const options = { header: true, mode: 'records', amount: 2, delimiter: ';', name: 'Captación 2026' };

function memory() {
  let list, name;
  const files = [];
  return {
    files,
    async begin(filename) { name = filename; list = []; },
    async write(bytes) { list.push(bytes); },
    async end(meta) {
      assert.equal(meta.name, name);
      files.push({ ...meta, blob: new Blob(list) });
      list = null;
    },
    async abort() { list = null; files.length = 0; }
  };
}

async function verify(file, expected, sizes, settings = {}, inspect = {}) {
  const config = { ...options, ...settings };
  const source = await E.inspect(file, inspect);
  const sink = memory();
  const result = await E.split(file, source, config, sink);
  assert.equal(result.input, expected.length - Number(config.header));
  assert.equal(result.assigned, result.input);
  assert.equal(result.written, result.input);
  assert.deepEqual(result.parts.map(part => part.records), sizes);
  const joined = [];
  for (let index = 0; index < sink.files.length; index++) {
    const part = sink.files[index];
    const bytes = Buffer.from(await part.blob.arrayBuffer());
    assert.deepEqual([...bytes.subarray(0, 3)], [239, 187, 191]);
    assert.equal(bytes.length, part.bytes);
    assert.equal(crc32(bytes), part.checksum);
    const rows = F.parseCsv(bytes, config.delimiter);
    if (config.header) assert.deepEqual(rows.shift(), expected[0]);
    assert.equal(rows.length, sizes[index]);
    for (const row of rows) joined.push(row);
  }
  assert.deepEqual(joined, expected.slice(config.header ? 1 : 0));
  return sink.files;
}

for (const [count, mode, amount, sizes] of [
  [100000, 'files', 5, Array(5).fill(20000)],
  [100003, 'files', 5, [20001, 20001, 20001, 20000, 20000]],
  [100003, 'records', 20000, [20000, 20000, 20000, 20000, 20000, 3]],
  [20000, 'records', 20000, [20000]],
  [20001, 'records', 20000, [20000, 1]],
  [1, 'files', 20000, [1]],
  [3, 'files', 9, [1, 1, 1]]
]) {
  test(count + ' registros, ' + mode + ' ' + amount + ': reconstrucción independiente', async () => {
    const rows = [['ID', 'Texto', 'Final']];
    for (let index = 0; index < count; index++) rows.push([String(index % 997), 'Ñ-' + index % 19, '']);
    await verify(make(rows.map(row => row.join(';')).join('\n')), rows, sizes, { mode, amount });
  });
}

test('cero registros, cabecera sola y archivo vacío no producen partes', async () => {
  for (const input of ['', '\ufeffA,B\r\n']) {
    const file = make(input);
    const summary = await E.inspect(file);
    const sink = memory();
    await assert.rejects(E.split(file, summary, options, sink), /No hay registros/);
    assert.deepEqual(sink.files, []);
  }
});

test('rechaza parámetros inválidos y exceso de partes, conserva nomenclatura', () => {
  for (const value of ['0', '-1', '0.9', '5e2', '2.0', 'Infinity', ' ', '1000000001']) {
    assert.throws(() => E.plan(12, 'files', value), /entero/);
  }
  assert.throws(() => E.plan(5001, 'records', 1), /máximo/);
  assert.equal(E.plan(3, 'files', 7).reduced, true);
  assert.equal(E.partName('Ñ.2026', 1, 1001), 'Ñ.2026_0001.csv');
  assert.equal(E.safeName('CON'), '_CON');
  assert.equal(E.safeName('ventas:/2 .'), 'ventas__2');
  assert.throws(() => E.safeName('..'), /válido/);
});

test('BOM, columnas finales, vacíos, duplicados, saltos internos, comillas y ambos delimitadores de salida', async () => {
  for (const delimiter of [';', ',']) {
    const parts = await verify(make(F.csvText), [F.headings, ...F.records], [2, 2], { delimiter });
    const zip = E.archive.zip(parts);
    const files = F.unzipStore(await zip.arrayBuffer());
    for (const part of parts) assert.deepEqual(files.get(part.name), Buffer.from(await part.blob.arrayBuffer()));
  }
});

test('coma sin BOM, sin cabecera y con CRLF final; vacío real de una columna', async () => {
  await verify(make('1,"a,b",\r\n2,"a;b",\r\n'), [['1', 'a,b', ''], ['2', 'a;b', '']], [2],
    { header: false });
  await verify(make('Título\n\nvalor\n'), [['Título'], [''], ['valor']], [2]);
  await verify(make('\nA;B\n1;2'), [['', ''], ['A', 'B'], ['1', '2']], [2]);
});

test('un registro largo cruza bloques, incluyendo comillas y un UTF-8 multibyte en un borde', async () => {
  const prefix = 'id;texto;\n1;"';
  const field = 'x'.repeat(256 * 1024 - Buffer.byteLength(prefix) - 1) + '😀' + 'y'.repeat(350000) + '"\r\nÑ';
  const file = make(prefix + field.replaceAll('"', '""') + '";\n2;corto;\n');
  await verify(file, [['id', 'texto', ''], ['1', field, ''], ['2', 'corto', '']], [1, 1], { amount: 1 });
});

test('rechaza sintaxis inválida, UTF-8 incorrecto y detección ambigua', async () => {
  await assert.rejects(E.inspect(make('A;B\n1;"sin cerrar'), { delimiter: ';' }), /comillas sin cerrar/);
  await assert.rejects(E.inspect(make('A,B\n1,2,3'), { delimiter: ',' }), /2 columnas/);
  await assert.rejects(E.inspect(make('A,B\n1,2,3')), /ambiguo|columnas/);
  await assert.rejects(E.inspect(make('A,B;C\n1,2;3')), /ambiguo/);
  const explicit = await E.inspect(make('A,B;C\n1,2;3'), { delimiter: ';' });
  assert.equal(explicit.columns, 2);
  await assert.rejects(E.inspect(make(Uint8Array.of(0xff, 0x80))), /UTF-8/);
  await assert.rejects(E.inspect(make('a,b\n1,"a"extra\n'), { delimiter: ',' }), /cierre/);
});

test('la segunda pasada rechaza cambios del mismo tamaño y no deja partes válidas', async () => {
  const summary = await E.inspect(make('ID\n1\n2\n'));
  const sink = memory();
  await assert.rejects(E.split(make('ID\n3\n4\n'), summary, options, sink), /origen cambió/);
  assert.equal(sink.files.length, 0);
});

test('cancelación durante escritura y errores de salida invalidan el conjunto', async () => {
  const file = make('A\n1\n2\n3\n4');
  const source = await E.inspect(file);
  for (const cancel of [true, false]) {
    const controller = new AbortController();
    const sink = memory();
    const write = sink.write;
    sink.write = async value => {
      if (cancel) { await write(value); controller.abort(); }
      else throw new Error('Escritura interrumpida');
    };
    await assert.rejects(E.split(file, source, { ...options, amount: 1 }, sink, { signal: controller.signal }),
      cancel ? { name: 'AbortError' } : /interrumpida/);
    assert.equal(sink.files.length, 0);
  }
});

test('XLSX elige primera hoja con datos, conserva formato y avisa de fórmulas sin resultado', async () => {
  const file = make(F.workbook(), 'libro.xlsx');
  const summary = await E.inspect(file);
  assert.equal(summary.sheet, 'Datos');
  assert.deepEqual(summary.sheets.map(sheet => [sheet.name, sheet.rows]), [['Vacía', 0], ['Datos', 4], ['Alternativa', 2]]);
  assert.equal(summary.missing, 1);
  await verify(file, F.expectedSheet, [2, 1]);
  await verify(file, [['A', 'B'], ['segunda', 'hoja']], [1], {}, { sheet: 'Alternativa' });
  assert.equal((await E.inspect(file, { sheet: 'Vacía' })).rows, 0);
});

test('XLSX de una hoja, entrada corrupta y CRC falsificado', async () => {
  const XLSX = require('../vendor/sheetjs-0.20.3')();
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['A'], ['00001']]), 'Única');
  await verify(make(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }), 'una.xlsx'), [['A'], ['00001']], [1]);
  await assert.rejects(E.inspect(make('no es XLSX', 'falso.xlsx')), /dañado/);
  const damaged = Buffer.from(F.workbook());
  const firstPayload = 30 + damaged.readUInt16LE(26) + damaged.readUInt16LE(28);
  damaged[firstPayload + 1] ^= 0xff;
  await assert.rejects(E.inspect(make(damaged, 'corrupto.xlsx')), /dañado/);
});

module.exports = { verify };

test('límites de seguridad del XLSX antes de analizar un libro o recorrer una hoja', async () => {
  const large = Buffer.from(F.workbook());
  const end = large.length - 22;
  const directory = large.readUInt32LE(end + 16);
  const local = large.readUInt32LE(directory + 42);
  large.writeUInt32LE(100 * 1024 * 1024, directory + 24);
  large.writeUInt32LE(100 * 1024 * 1024, local + 22);
  await assert.rejects(E.inspect(make(large, 'expansion.xlsx')), /expansión|dañado/);
  const XLSX = require('../vendor/sheetjs-0.20.3')();
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['dato']]), 'Extensa');
  const zip = XLSX.CFB.read(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }), { type: 'buffer' });
  const xml = XLSX.CFB.find(zip, '/xl/worksheets/sheet1.xml');
  xml.content = Buffer.from(Buffer.from(xml.content).toString().replace(/<dimension ref="[^"]+"/, '<dimension ref="A1:XFD1048576"'));
  xml.size = xml.content.length;
  const file = make(XLSX.CFB.write(zip, { type: 'buffer', fileType: 'zip' }), 'extensa.xlsx');
  const summary = await E.inspect(file);
  assert.match(summary.error, /celdas de rango/);
  await assert.rejects(E.split(file, summary, options, memory()), /no es válida/);
});
