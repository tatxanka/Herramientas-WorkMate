'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { openAsBlob } = require('node:fs');
const fs = require('node:fs/promises');
const path = require('node:path');
const E = require('../js/engine');
const { parseCsv } = require('./fixtures');

const heading = ['Registro', 'Etiqueta', 'Texto', 'Final'];
const labels = ['Ñ', '雪', '🙂', 'A'];
const note = 'Texto sintético repetido';
const row = index => [String(index), labels[index % labels.length], note, ''];
const scratch = path.join(__dirname, '.work');

for (const count of [100000, 500000, 1000000]) {
  test('volumen ' + count + ' registros: dos pasadas y relectura de cada parte en disco', async t => {
    await fs.mkdir(scratch, { recursive: true });
    const folder = await fs.mkdtemp(path.join(scratch, 'volumen-'));
    const sourcePath = path.join(folder, 'sintetico.csv');
    const destinations = [];
    t.after(async () => {
      for (const filename of [sourcePath, ...destinations]) await fs.unlink(filename).catch(() => {});
      await fs.rmdir(folder);
    });
    const input = await fs.open(sourcePath, 'wx');
    try {
      await input.writeFile(heading.join(';') + '\n');
      for (let first = 0; first < count; first += 8192) {
        const chunk = [];
        for (let index = first; index < Math.min(first + 8192, count); index++) chunk.push(row(index).join(';') + '\n');
        await input.writeFile(chunk.join(''));
      }
    } finally { await input.close(); }

    const file = new File([await openAsBlob(sourcePath)], 'sintetico.csv');
    let writer, writtenBytes = 0;
    const sink = {
      async begin(name) {
        const file = path.join(folder, name);
        destinations.push(file);
        writer = await fs.open(file, 'wx');
      },
      async write(bytes) { await writer.writeFile(bytes); writtenBytes += bytes.length; },
      async end() { await writer.close(); writer = null; },
      async abort() { await writer?.close(); }
    };
    const initial = process.memoryUsage.rss();
    let peak = initial;
    const timer = setInterval(() => { peak = Math.max(peak, process.memoryUsage.rss()); }, 8);
    const start = performance.now();
    let analyzed, result, splitTime;
    try {
      const summary = await E.inspect(file);
      analyzed = performance.now();
      result = await E.split(file, summary,
        { header: true, mode: 'records', amount: 100000, delimiter: ';', name: 'sintetico', direct: true }, sink);
      splitTime = performance.now();
      peak = Math.max(peak, process.memoryUsage.rss());
    } finally { clearInterval(timer); }
    assert.equal(result.input, count);
    assert.equal(result.written, count);
    assert.equal(writtenBytes, result.bytes);
    assert.equal(destinations.length, count / 100000);
    let index = 0;
    for (const output of destinations) {
      const rows = parseCsv(await fs.readFile(output), ';');
      assert.deepEqual(rows.shift(), heading);
      assert.equal(rows.length, 100000);
      for (const actual of rows) {
        const expected = row(index++);
        if (actual.length !== expected.length || actual.some((value, column) => value !== expected[column])) {
          assert.deepEqual(actual, expected);
        }
      }
    }
    assert.equal(index, count);
    t.diagnostic(JSON.stringify({ rows: count, inputBytes: file.size, outputBytes: result.bytes,
      parts: result.parts.length, inspectMs: Math.round(analyzed - start), divideMs: Math.round(splitTime - analyzed),
      baselineRssMiB: Math.round(initial / 1024 ** 2), sampledPeakRssMiB: Math.round(peak / 1024 ** 2) }));
  });
}

test('adaptador de carpeta: relee bytes y evita sobrescribir archivos en una salida ya creada', async t => {
  require('../js/bridge');
  const { crc32 } = require('node:zlib');
  await fs.mkdir(scratch, { recursive: true });
  const parent = await fs.mkdtemp(path.join(scratch, 'adaptador-'));
  let outputDirectory, outputFile;
  t.after(async () => {
    if (outputFile) await fs.unlink(outputFile).catch(() => {});
    if (outputDirectory) await fs.rmdir(outputDirectory);
    await fs.rmdir(parent);
  });
  const missing = () => new DOMException('Entrada ausente.', 'NotFoundError');
  const target = {
    async getDirectoryHandle(name, options) {
      const directory = path.join(parent, name);
      if (!options?.create) {
        try { await fs.access(directory); } catch { throw missing(); }
      } else {
        await fs.mkdir(directory);
        outputDirectory = directory;
      }
      return { name, async getFileHandle(filename, options) {
        const full = path.join(directory, filename);
        if (!options?.create) {
          try { await fs.access(full); } catch { throw missing(); }
        } else {
          const created = await fs.open(full, 'wx');
          await created.close();
          outputFile = full;
        }
        return {
          async getFile() { return openAsBlob(full); },
          async createWritable() {
            const stream = await fs.open(full, 'r+');
            return { write: bytes => stream.writeFile(bytes), close: () => stream.close(), abort: () => stream.close() };
          }
        };
      } };
    }
  };
  const source = new File(['ID;Nombre\n1;Ñ'], 'origen.csv');
  const summary = await E.inspect(source);
  const sink = globalThis.DividerBridge.output(E, new AbortController().signal, target);
  const result = await E.split(source, summary,
    { header: true, mode: 'records', amount: 10, delimiter: ';', name: 'salida', direct: true }, sink);
  const stored = await fs.readFile(outputFile);
  assert.equal(sink.directory, path.basename(outputDirectory));
  assert.equal(sink.parts.length, 1);
  assert.equal(crc32(stored), result.parts[0].checksum);
  assert.deepEqual(parseCsv(stored, ';'), [['ID', 'Nombre'], ['1', 'Ñ']]);
  await assert.rejects(sink.begin(result.parts[0].name), /ya existe/);
  await sink.abort();
  assert.deepEqual(await fs.readFile(outputFile), stored);
});
