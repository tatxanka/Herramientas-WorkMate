const { test } = require('node:test');
const assert = require('node:assert/strict');
const createEngine = require('../js/engine.js');
const { run, Parser, PartialIndex, BLOB_LIMIT, normalizer } = createEngine();

const file = (content, name = 'fixture.csv') => new File([content], name);
const defaults = { caseFold: false, trim: false, accents: false };
const fixture = file('\ufeffid,nombre,nota,nombre\r\n001,"  CRÚZ Roja  ","A, ""B""\r\nC",🍋\n002,Cruz Roja,,\n002,Cruz Roja,,\r\n003,,x,\n004,azul,z,\n005,amarillo,z,\n006,a😀b,z,\n007,\u00c5,z,\n008,A\u030a,z,\n009,\ufeff,v,\n010,verde,«fin»,');
const target = file('id,referencia,detalle\r\n1,cruz roja,z\r\n2,CRUZ,ROJA\r\n3,x,mar azul cielo\r\n4,azul,azul\r\n5,,\r\n6,😀,\r\n7,\u00c5,\r\n8,\ufeff,z');
const options = { caseFold: true, trim: true, accents: true };

async function exported(file, blocks, total, expected, invert = false) {
  const chunks = [];
  const result = await run('export', { file, blocks, invert, expected, total, buffered: true }, {
    write: chunk => chunks.push(Buffer.from(chunk))
  });
  const text = Buffer.concat(chunks).toString('utf8');
  assert.equal(result.bytes, Buffer.byteLength(text));
  assert.equal(result.count, expected);
  return text;
}

function records(text) {
  const rows = [];
  const parser = new Parser(row => rows.push(row));
  for (const char of text.replace(/^\ufeff/, '')) parser.push(char);
  parser.finish();
  return rows;
}

test('lectura incremental y preservación de UTF-8, BOM, comillas, comas, saltos y duplicados', async () => {
  const meta = await run('inspect', fixture);
  assert.deepEqual(meta.columns, ['id', 'nombre', 'nota', 'nombre']);
  assert.equal(meta.duplicates, true);
  assert.equal(meta.rows.length, 10);
  assert.deepEqual(meta.rows.slice(0, 4), [
    ['001', '  CRÚZ Roja  ', 'A, "B"\r\nC', '🍋'], ['002', 'Cruz Roja', '', ''],
    ['002', 'Cruz Roja', '', ''], ['003', '', 'x', '']
  ]);
  const boundary = 'x'.repeat(256 * 1024 - 4);
  const cross = file(`c\n"${boundary}🍋""\r\nñ"\r\nfinal`);
  const all = await run('search', { files: [cross], columns: [[0]], query: '🍋', partial: true, options: defaults });
  assert.equal(all.reports[0].count, 2);
  assert.equal(await exported(cross, all.reports[0].blocks, 2, 1), `\ufeffc\r\n"${boundary}🍋""\r\nñ"\r\n`);
  assert.deepEqual(records('"",x,\r\n\r\n""\nlast,'), [['', 'x', ''], [''], [''], ['last', '']]);
});

test('detecta punto y coma con comas y saltos interiores y exporta CSV por comas', async () => {
  const source = file('id;"Texto, completo";nota\r\n001;"alfa, beta; gamma";"A\r\nB"\r\n002;sin,comillas;fin');
  const meta = await run('inspect', source);
  assert.equal(meta.delimiter, ';');
  assert.deepEqual(meta.columns, ['id', 'Texto, completo', 'nota']);
  assert.deepEqual(meta.rows, [['001', 'alfa, beta; gamma', 'A\r\nB'], ['002', 'sin,comillas', 'fin']]);
  const lookup = file('valor\n"alfa, beta; gamma"');
  const result = await run('compare', { files: [source, lookup], columns: [[1], [0]], partial: false, options: defaults });
  assert.equal(result.found, 1);
  assert.equal(await exported(source, result.blocks, 2, 1), '\ufeffid,"Texto, completo",nota\r\n001,"alfa, beta; gamma","A\r\nB"\r\n');
  const malformed = file('id;nota\n001;"texto"extra\n002;fin');
  await assert.rejects(run('inspect', malformed), /Registro 2: se esperaba un punto y coma/);
});

test('teléfonos literales: última columna, duplicados, ceros, espacios y vacíos', async () => {
  const source = file('id,telefono\n1,00123\n2,123\n3,00123\n4, 00123\n5,00123\u00a0\n6,00123\u200b\n7,\n8,987\n9,00123\t\n10,"00123\n"');
  const lookup = file('a;b;c;d;e\n;;;00123;123\n987;987;987;;\n987;;;;');
  const data = { files: [source, lookup], columns: [[1], [0, 1, 2, 3]], partial: false, options: defaults };
  const result = await run('compare', data);
  assert.deepEqual(result.totals, [10, 3]);
  assert.equal(result.found, 3);
  assert.equal(await exported(source, result.blocks, 10, 3), '\ufeffid,telefono\r\n1,00123\r\n3,00123\r\n8,987\r\n');
  const excluded = await exported(source, result.blocks, 10, 7, true);
  assert.deepEqual(records(excluded).slice(1).map(row => row[1]), ['123', ' 00123', '00123\u00a0', '00123\u200b', '', '00123\t', '00123\n']);
  const trimmed = await run('compare', { ...data, options: { ...defaults, trim: true } });
  assert.equal(trimmed.found, 7);
});

test('exacta con normalización simétrica, varias columnas y ambas particiones comprobadas en los CSV', async () => {
  const compare = await run('compare', { files: [fixture, target], columns: [[1], [1, 2]], partial: false, options });
  assert.deepEqual(compare.totals, [11, 8]);
  assert.equal(compare.found, 6);
  const yes = await exported(fixture, compare.blocks, 11, 6);
  const no = await exported(fixture, compare.blocks, 11, 5, true);
  const original = records(await fixture.text());
  const matchingIds = ['001', '002', '002', '004', '007', '008'];
  assert.deepEqual(records(yes), original.filter((row, i) => i === 0 || matchingIds.includes(row[0])));
  assert.deepEqual(records(no), original.filter((row, i) => i === 0 || !matchingIds.includes(row[0])));
  assert.equal(records(yes).length + records(no).length - 2, compare.totals[0]);
});

test('exacta conserva secuencias Unicode canónicamente distintas si no se pide normalización', async () => {
  const source = file('value\n\u00c5\nA\u030a\ntext A\u030a repeat');
  const lookup = file('value\nA\u030a\ntext \u00c5 repeat');
  const result = await run('compare', { files: [source, lookup], columns: [[0], [0]], partial: false, options: defaults });
  assert.equal(await exported(source, result.blocks, 3, 1), '\ufeffvalue\r\nA\u030a\r\n');
  assert.equal(normalizer({ ...defaults, caseFold: true })(' Á '), ' á ');
  assert.equal(normalizer({ ...defaults, accents: true })(' Á '), ' A ');
  assert.equal(normalizer({ ...defaults, trim: true })(' Á '), 'Á');
});

test('parcial con patrones solapados, sufijos, Unicode y celdas independientes', async () => {
  const source = file('q\nhe\nshe\nhers\ners\nrs\n🍋\nhe🍋\nAB\n""\nhe\n🍋b\nheB');
  const lookup = file('a,b\nushers,A\nA,B\n---she🍋b,ushers');
  const result = await run('compare', { files: [source, lookup], columns: [[0], [0, 1]], partial: true, options: defaults });
  assert.deepEqual(records(await exported(source, result.blocks, 12, 9)).slice(1).flat(), ['he', 'she', 'hers', 'ers', 'rs', '🍋', 'he🍋', 'he', '🍋b']);
  const normalized = await run('compare', { files: [fixture, target], columns: [[1], [1, 2]], partial: true, options });
  assert.equal(normalized.found, 6);
});

test('Aho–Corasick coincide con un oráculo de subcadenas con datos reproducibles', async () => {
  let state = 8743;
  function next(max) { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return (state >>> 7) % max; }
  const alphabet = ['a', 'b', 'c', 'd', '🍋', '\u0000'];
  const random = length => Array.from({ length }, () => alphabet[next(alphabet.length)]).join('');
  const patterns = Array.from({ length: 900 }, () => random(1 + next(16)));
  const targets = Array.from({ length: 200 }, () => random(1 + next(100)));
  const index = new PartialIndex();
  patterns.forEach(pattern => index.add(pattern));
  await index.build({ progress() {}, async checkpoint() {} });
  targets.forEach(target => index.mark(target));
  for (const pattern of patterns) assert.equal(index.matched(pattern), targets.some(target => target.includes(pattern)), JSON.stringify(pattern));
});

test('búsqueda en CSV 1, CSV 2 y ambos con una sola fila por registro y exportación íntegra', async () => {
  for (const selected of [[fixture, null], [null, target], [fixture, target]]) {
    const result = await run('search', { files: selected, columns: [[1, 3], [1, 2]], query: 'AZÚL', partial: true, options });
    assert.equal(result.reports[0]?.found, selected[0] ? 1 : undefined);
    assert.equal(result.reports[1]?.found, selected[1] ? 2 : undefined);
    for (let i = 0; i < 2; i++) {
      const report = result.reports[i];
      if (!report) continue;
      const text = await exported(selected[i], report.blocks, report.count, report.found);
      assert.deepEqual(records(text), [records(await selected[i].text())[0], ...report.rows]);
    }
  }
  const empty = await run('search', { files: [fixture], columns: [[3]], query: 'azul', partial: false, options });
  assert.equal(await exported(fixture, empty.reports[0].blocks, 11, 0), '\ufeffid,nombre,nota,nombre\r\n');
  await assert.rejects(run('search', { files: [fixture], columns: [[1]], query: '\u0301', partial: true, options }), /vacío/);
});

test('comparación vacía, archivo solo con cabecera y resultados sin coincidencias', async () => {
  const source = file('"",x\n,abc\n0,def');
  const lookup = file('v\n');
  const result = await run('compare', { files: [source, lookup], columns: [[0], [0]], partial: true, options });
  assert.deepEqual(result.totals, [2, 0]);
  assert.equal(result.found, 0);
  assert.equal(await exported(source, result.blocks, 2, 2, true), '\ufeff,x\r\n,abc\r\n0,def\r\n');
  assert.equal(await exported(source, result.blocks, 2, 0), '\ufeff,x\r\n');
  assert.equal((await run('inspect', lookup)).count, 0);
});

test('CSV inválidos, UTF-8 inválido y error estructural posterior a la vista previa', async () => {
  for (const [content, error] of [
    ['', /vacío/], ['a\n"abc', /sin cerrar/], ['a\nx"', /sin entrecomillar/],
    ['a\n"abc" x', /tras cerrar/], ['a,b\n1,2,3', /cabecera define 2/],
    [new Uint8Array([0xc0, 0xaf]), /UTF-8/], ['a\n""\n' + 'a'.repeat(8 * 1024 * 1024 + 1), /límite/]
  ]) await assert.rejects(run('inspect', file(content)), error);
  const late = file('a,b\n' + '1,2\n'.repeat(20) + '3');
  assert.equal((await run('inspect', late)).rows.length, 10);
  await assert.rejects(run('search', { files: [late], columns: [[0]], query: '1', partial: false, options }), /Registro 22/);
});

test('rechaza un XLSX dañado y aplica el límite antes de leer libros grandes', async () => {
  const { run: runXlsx } = createEngine(require('../js/vendor/sheetjs-0.20.3.js'));
  await assert.rejects(runXlsx('importXlsx', file('id,valor\n001,a', 'dañado.xlsx')), /no contiene un XLSX válido/);
  const oversized = {
    name: 'grande.xlsx', size: 16 * 1024 * 1024 + 1,
    arrayBuffer() { assert.fail('El archivo excede el límite antes de leerlo'); }
  };
  await assert.rejects(runXlsx('importXlsx', oversized), /supera 16 MiB/);
});

test('cancelación durante la lectura y durante una exportación', async () => {
  const many = file('a,b\n' + 'a,b\n'.repeat(150000));
  const controller = new AbortController();
  await assert.rejects(run('search', { files: [many], columns: [[0]], query: 'a', partial: false, options }, {
    signal: controller.signal, progress: () => controller.abort()
  }), { name: 'AbortError' });
  const exportController = new AbortController();
  let writes = 0;
  await assert.rejects(run('export', { file: many, blocks: [], invert: true, total: 150000, expected: 150000, buffered: true }, {
    signal: exportController.signal, write() { writes++; exportController.abort(); }
  }), { name: 'AbortError' });
  assert.equal(writes, 1);
});

test('los límites de salida y del índice parcial fallan de forma controlada', async () => {
  const source = file('q\n' + 'x'.repeat(2 ** 21));
  await assert.rejects(run('compare', { files: [source, target], columns: [[0], [1]], partial: true, options: defaults }), /presupuesto del índice parcial/);
  const row = 'a'.repeat(1023) + '\n';
  const count = Math.ceil(BLOB_LIMIT / row.length);
  const big = file(['q\n', row.repeat(count)].join(''));
  let bytes = 0;
  await assert.rejects(run('export', { file: big, blocks: [], invert: true, total: count, expected: count, buffered: true }, {
    write: data => { bytes += data.byteLength; }
  }), /32 MiB/);
  assert.ok(bytes > BLOB_LIMIT - 512 * 1024 && bytes <= BLOB_LIMIT);
  bytes = 0;
  const streamed = await run('export', { file: big, blocks: [], invert: true, total: count, expected: count, buffered: false }, {
    write: data => { bytes += data.byteLength; }
  });
  assert.equal(streamed.count, count);
  assert.equal(streamed.bytes, bytes);
  assert.ok(bytes > BLOB_LIMIT);
});
