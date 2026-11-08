'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.DIVIDER_PLAYWRIGHT || 'playwright-core');
const F = require('./fixtures');

const app = path.resolve(__dirname, '..');
const portal = path.resolve(app, '..', '..');
const index = pathToFileURL(path.join(app, 'index.html')).href;
const portalIndex = pathToFileURL(path.join(portal, 'index.html')).href;
const csvMatch = pathToFileURL(path.join(portal, 'BUSCAR Y COMPARAR', 'CSV-MATCH', 'index.html')).href;
const scratch = path.join(__dirname, '.work');
let browser;

before(async () => {
  await fs.mkdir(scratch, { recursive: true });
  browser = await chromium.launch({ channel: 'chrome', headless: true, downloadsPath: scratch });
});
after(async () => { await browser?.close(); });

const button = (page, name) => page.getByRole('button', { name, exact: true });
const shown = node => node.waitFor({ state: 'visible' });
const hidden = node => node.waitFor({ state: 'hidden' });

async function setup(t, where = index) {
  const context = await browser.newContext({ offline: true, viewport: { width: 1400, height: 970 } });
  context.setDefaultTimeout(7000);
  t.after(() => context.close());
  const requests = [];
  context.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
  const page = await context.newPage();
  const errors = [];
  const workers = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('worker', worker => workers.push(worker.url()));
  t.after(() => { assert.deepEqual(requests, []); assert.deepEqual(errors, []); });
  await page.goto(where);
  return { page, context, workers };
}

const load = (page, content, name = 'Captación.2026.csv') => page.locator('#file').setInputFiles({
  name, mimeType: name.endsWith('.xlsx') ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/csv',
  buffer: Buffer.from(content)
});

async function download(page, control) {
  const [file] = await Promise.all([page.waitForEvent('download'), control.click()]);
  assert.equal(await file.failure(), null);
  return { name: file.suggestedFilename(), bytes: await fs.readFile(await file.path()) };
}

async function finish(page, view = page) {
  await button(view, 'Dividir archivo').click();
  await shown(view.getByRole('heading', { name: 'División completada' }));
  return download(page, button(view, 'Descargar ZIP'));
}

test('Chrome offline · CSV, vista previa, modos, descargas reales, encabezados y cambio de archivo', async t => {
  const { page, workers } = await setup(t);
  t.diagnostic('Chrome ' + browser.version());
  await load(page, F.csvText);
  await shown(page.getByText(/4 registros · 5 columnas · Punto y coma/));
  assert.equal(await page.locator('#preview tbody tr').count(), 4);
  await page.locator('#amount').fill('2.5');
  assert.equal(await button(page, 'Dividir archivo').isDisabled(), true);
  await page.locator('#amount').fill('3');
  await page.locator('#base').fill('Ventas Ñ');
  const zip = await finish(page);
  assert.equal(zip.name, 'Ventas Ñ.zip');
  const entries = [...F.unzipStore(zip.bytes)];
  assert.deepEqual(entries.map(([name]) => name), ['Ventas Ñ_001.csv', 'Ventas Ñ_002.csv']);
  assert.deepEqual(entries.map(([, data]) => F.parseCsv(data, ';')), [[F.headings, ...F.records.slice(0, 3)], [F.headings, F.records[3]]]);
  const individual = await download(page, button(page, 'Descargar Ventas Ñ_002.csv'));
  assert.deepEqual(individual.bytes, entries[1][1]);
  await page.locator('#mode').selectOption('files');
  await page.locator('#amount').fill('3');
  await page.locator('#output-separator').selectOption(',');
  assert.equal(await page.locator('#results').isVisible(), false);
  assert.match(await page.locator('#plan-status').innerText(), /2 \+ 1 \+ 1/);
  const second = await finish(page);
  assert.deepEqual([...F.unzipStore(second.bytes).values()].map(data => F.parseCsv(data, ',')), [
    [F.headings, ...F.records.slice(0, 2)], [F.headings, F.records[2]], [F.headings, F.records[3]]
  ]);
  await page.locator('#header').uncheck();
  assert.equal(await page.locator('#preview thead').count(), 0);
  assert.match(await page.locator('#file-status').innerText(), /5 registros/);
  await page.locator('#header').check();
  await load(page, 'A,B\r\n', 'vacio.csv');
  await shown(page.getByText('0 registros. No hay datos que dividir.'));
  assert.equal(await page.locator('#results').isVisible(), false);
  assert.equal(await button(page, 'Dividir archivo').isDisabled(), true);
  assert.ok(workers.some(url => url.startsWith('blob:')));
  await page.setViewportSize({ width: 390, height: 820 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  if (process.env.DIVIDER_SHOTS) await page.screenshot({ path: path.join(scratch, 'divider-movil.png'), fullPage: true });
});

test('Chrome · XLSX con hojas múltiples, vista previa formateada y ZIP validado', async t => {
  const { page } = await setup(t);
  await load(page, F.workbook(), 'Libro.xlsx');
  await shown(page.getByText(/3 registros · 10 columnas · Hoja «Datos» · 1 fórmula sin valor almacenado/));
  assert.equal(await page.locator('#sheet').inputValue(), 'Datos');
  assert.equal(await page.locator('#preview tbody tr').first().locator('td').first().innerText(), '000027');
  await page.locator('#amount').fill('2');
  const zip = await finish(page);
  assert.deepEqual([...F.unzipStore(zip.bytes).values()].map(data => F.parseCsv(data, ';')), [
    F.expectedSheet.slice(0, 3), [F.expectedSheet[0], F.expectedSheet[3]]
  ]);
  if (process.env.DIVIDER_SHOTS) await page.screenshot({ path: path.join(scratch, 'divider-escritorio.png'), fullPage: true });
  await page.locator('#sheet').selectOption('Vacía');
  await shown(page.getByText('0 registros. No hay datos que dividir.'));
  await page.locator('#sheet').selectOption('Alternativa');
  await shown(page.getByText(/1 registro · 2 columnas · Hoja «Alternativa»/));
  assert.equal(await page.locator('#results').isVisible(), false);
  const alternative = await finish(page);
  assert.deepEqual([...F.unzipStore(alternative.bytes).values()].map(data => F.parseCsv(data, ';')),
    [[['A', 'B'], ['segunda', 'hoja']]]);
});

test('Chrome · error, selección manual, cancelación durante división y reintento', async t => {
  const { page } = await setup(t);
  await load(page, 'A;B\n1;"sin cierre', 'roto.csv');
  await shown(page.getByRole('alert').getByText(/comillas sin cerrar/));
  assert.equal(await button(page, 'Dividir archivo').isDisabled(), true);
  await load(page, 'A,B;C\n1,2;3', 'ambiguo.csv');
  await shown(page.getByRole('alert').getByText(/delimitador es ambiguo/));
  await page.locator('#input-separator').selectOption(';');
  await shown(page.getByText(/1 registro · 2 columnas/));
  const input = 'ID;Texto\n' + '1;prueba de cancelación\n'.repeat(300000);
  await load(page, input, 'cancelar.csv');
  await shown(page.getByText(/300.000 registros · 2 columnas/));
  await page.evaluate(() => {
    const phase = document.querySelector('#phase');
    const observer = new MutationObserver(() => {
      if (phase.textContent === 'Dividiendo archivo') {
        observer.disconnect();
        document.querySelector('#cancel').click();
      }
    });
    observer.observe(phase, { childList: true, characterData: true, subtree: true });
  });
  await button(page, 'Dividir archivo').click();
  await shown(page.getByText('División cancelada', { exact: true }));
  assert.equal(await page.locator('#results').isVisible(), false);
  await load(page, 'ID;Texto\n7;<img src=x onerror=alert(1)>', 'despues.csv');
  await shown(page.getByText(/1 registro · 2 columnas/));
  assert.equal(await page.locator('#preview img').count(), 0);
  const zip = await finish(page);
  assert.deepEqual(F.parseCsv([...F.unzipStore(zip.bytes).values()][0], ';'), [['ID', 'Texto'], ['7', '<img src=x onerror=alert(1)>']]);
});

test('Chrome · registro temporal en WorkMate, visor file://, ZIP y apertura en otra pestaña', async t => {
  const { page, context } = await setup(t, portalIndex);
  await button(page, 'Primera configuración').click();
  await page.locator('[name=name]').fill('Cuenta sintética');
  await page.locator('[name=login]').fill('prueba');
  const password = randomUUID();
  await page.locator('[name=password]').fill(password);
  await page.locator('[name=repeat]').fill(password);
  await page.getByRole('checkbox', { name: /Registrar CSV MATCH/ }).uncheck();
  await button(page, 'Elegir almacenamiento').click();
  await button(page, 'Usar JSON manual').click();
  const configuration = await download(page, button(page, 'Descargar JSON'));
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), button(page, 'Seleccionar copia descargada').click()]);
  await chooser.setFiles({ name: configuration.name, mimeType: 'application/json', buffer: configuration.bytes });
  await shown(page.locator('#portal'));
  await button(page, 'Modo edición').click();
  await button(page, 'Herramienta').click();
  const dialog = page.locator('#modal');
  await dialog.locator('[name=name]').fill('DIVIDER RECORDS');
  await dialog.locator('[name=description]').fill('Divide archivos CSV y XLSX en partes más pequeñas, conservando todos los registros.');
  await dialog.locator('[name=scope]').selectOption('global');
  await dialog.locator('[name=type]').selectOption('html');
  await dialog.locator('[name=parent]').selectOption({ label: 'Gestionar archivos' });
  await dialog.locator('[name=target]').fill('./GESTIONAR ARCHIVOS/DIVIDER-RECORDS/index.html');
  await button(dialog, 'Crear herramienta').click();
  await hidden(dialog);
  await button(page, 'Aplicar').click();
  await button(page.locator('#tree'), 'DIVIDER RECORDS').click();
  const view = page.frameLocator('#viewer');
  await shown(view.getByRole('heading', { name: 'DIVIDER RECORDS', exact: true }));
  await load(view, F.csvText);
  await shown(view.getByText(/4 registros · 5 columnas/));
  assert.equal(await button(view, 'Guardar en carpeta…').isDisabled(), true);
  await view.locator('#amount').fill('2');
  const zip = await finish(page, view);
  assert.deepEqual([...F.unzipStore(zip.bytes).values()].flatMap(data => F.parseCsv(data, ';').slice(1)), F.records);
  const one = await download(page, button(view, 'Descargar Captación.2026_001.csv'));
  assert.deepEqual(F.parseCsv(one.bytes, ';'), [F.headings, ...F.records.slice(0, 2)]);
  const [popup] = await Promise.all([context.waitForEvent('page'), view.getByRole('link', { name: /Abrir en otra pestaña/ }).click()]);
  await shown(popup.getByRole('heading', { name: 'DIVIDER RECORDS', exact: true }));
  assert.equal(popup.url(), index);
  await popup.close();
  // Discard the in-memory portal draft, including the synthetic tool registration.
  page.once('dialog', prompt => prompt.accept());
  await button(page, 'Descartar').click();
  await hidden(page.locator('#viewer'));
});

test('Chrome · CSV MATCH abre resultados reales en coma y punto y coma sin cambios', async t => {
  const { page, context } = await setup(t);
  await load(page, F.csvText);
  await shown(page.getByText(/4 registros · 5 columnas/));
  await page.locator('#amount').fill('4');
  const semicolon = [...F.unzipStore((await finish(page)).bytes).values()][0];
  await page.locator('#output-separator').selectOption(',');
  const comma = [...F.unzipStore((await finish(page)).bytes).values()][0];
  for (const [bytes, separator] of [[semicolon, ';'], [comma, ',']]) {
    assert.deepEqual(F.parseCsv(bytes, separator), [F.headings, ...F.records]);
  }
  const match = await context.newPage();
  await match.goto(csvMatch);
  const inputs = match.locator('.file-input');
  await inputs.nth(0).setInputFiles({ name: 'parte-semicola.csv', mimeType: 'text/csv', buffer: semicolon });
  await shown(match.locator('.file-settings').nth(0));
  await inputs.nth(1).setInputFiles({ name: 'parte-coma.csv', mimeType: 'text/csv', buffer: comma });
  await shown(match.locator('.file-settings').nth(1));
  for (const panel of await match.locator('.file-panel').all()) {
    assert.deepEqual(await panel.locator('thead th').allTextContents(), ['ID', 'Nombre', 'Nombre', 'Columna 4', 'Columna 5']);
    assert.equal(await panel.locator('tbody tr').count(), 4);
  }
  await match.locator('.columns select').selectOption('0');
  await match.locator('.multiselect summary').click();
  await match.getByRole('checkbox', { name: '1. ID', exact: true }).check();
  await match.locator('.multiselect summary').press('Escape');
  await button(match, 'Ejecutar comparación').click();
  await shown(match.locator('.results'));
  const compared = await download(match, match.locator('.download').first());
  assert.deepEqual(F.parseCsv(compared.bytes, ';'), [F.headings, F.records[0], ...F.records.slice(2)]);
});

test('Chrome · sondeo real del selector de carpeta y alternativa de descarga', async t => {
  const { page } = await setup(t);
  await load(page, 'A;B\n1;2');
  await shown(page.getByText(/1 registro · 2 columnas/));
  const direct = button(page, 'Guardar en carpeta…');
  if (await direct.isEnabled()) {
    await direct.click();
    await shown(page.getByText(/La operación se canceló|no permite|deneg|aborted|insecure/i));
    t.diagnostic('El selector real se invocó en Chrome sin interfaz. ' + await page.locator('#phase').innerText());
    assert.equal(await page.locator('#results').isVisible(), false);
  } else t.diagnostic('El selector de carpetas no está expuesto en este contexto.');
  const zip = await finish(page);
  assert.deepEqual(F.parseCsv([...F.unzipStore(zip.bytes).values()][0], ';'), [['A', 'B'], ['1', '2']]);
});

test('Chrome · sin Worker aplica límites reducidos y genera descargas pequeñas', async t => {
  const { page, context } = await setup(t);
  await context.addInitScript(() => { Object.defineProperty(window, 'Worker', { value: undefined }); });
  await page.reload();
  await load(page, 'A;B\n1;2');
  await shown(page.getByText(/1 registro · 2 columnas/));
  await shown(page.getByText(/Worker no disponible/));
  const zip = await finish(page);
  assert.deepEqual(F.parseCsv([...F.unzipStore(zip.bytes).values()][0], ';'), [['A', 'B'], ['1', '2']]);
  await load(page, Buffer.alloc(2 * 1024 * 1024 + 1, 97), 'limite.csv');
  await shown(page.getByRole('alert').getByText(/2 MiB sin Worker/));
  assert.equal(await button(page, 'Dividir archivo').isDisabled(), true);
});

test('Chrome · 1.000.000 de registros, Worker, ZIP y reconstrucción de las diez partes', async t => {
  const { page, workers } = await setup(t);
  page.setDefaultTimeout(30000);
  const folder = await fs.mkdtemp(path.join(scratch, 'chrome-volumen-'));
  const source = path.join(folder, 'volumen.csv');
  t.after(async () => { await fs.unlink(source).catch(() => {}); await fs.rmdir(folder); });
  const count = 1000000;
  const heading = ['Registro', 'Etiqueta', 'Texto', 'Final'];
  const labels = ['Ñ', '雪', '🙂', 'A'];
  const row = index => [String(index), labels[index % labels.length], 'Texto sintético repetido', ''];
  const writer = await fs.open(source, 'wx');
  try {
    await writer.writeFile(heading.join(';') + '\n');
    for (let first = 0; first < count; first += 8192) {
      const chunk = [];
      for (let index = first; index < Math.min(first + 8192, count); index++) chunk.push(row(index).join(';') + '\n');
      await writer.writeFile(chunk.join(''));
    }
  } finally { await writer.close(); }
  const start = performance.now();
  await page.locator('#file').setInputFiles(source);
  await shown(page.getByText(/1\.000\.000 registros · 4 columnas/));
  const analyzed = performance.now();
  await page.locator('#amount').fill('100000');
  const zip = await finish(page);
  const end = performance.now();
  const files = F.unzipStore(zip.bytes);
  assert.equal(files.size, 10);
  let index = 0, bytes = 0;
  for (const data of files.values()) {
    const rows = F.parseCsv(data, ';');
    assert.deepEqual(rows.shift(), heading);
    assert.equal(rows.length, 100000);
    bytes += data.length;
    for (const actual of rows) {
      const expected = row(index++);
      if (actual.length !== expected.length || actual.some((value, column) => value !== expected[column])) assert.deepEqual(actual, expected);
    }
  }
  assert.equal(index, count);
  assert.ok(workers.length >= 2);
  t.diagnostic(JSON.stringify({ rows: count, inputBytes: (await fs.stat(source)).size, outputBytes: bytes,
    zipBytes: zip.bytes.length, parts: files.size, inspectMs: Math.round(analyzed - start), divideAndDownloadMs: Math.round(end - analyzed) }));
});
