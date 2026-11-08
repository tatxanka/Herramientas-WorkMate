const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.CSV_MATCH_PW || 'playwright-core');
const loadSheetJS = require('../js/vendor/sheetjs-0.20.3.js');

const root = path.resolve(__dirname, '..');
const indexURL = pathToFileURL(path.join(root, 'index.html')).href;
const source = '\ufeffID,Nombre,Nota,Nombre\r\n001,Ána,"Con, coma",A\r\n002,Ana,"Comillas ""y""\r\nlínea",B\n002,Ana,"Comillas ""y""\r\nlínea",B\n003,Lucía,verde,C\n004,,gris,D\n005,Cadiz,azul,E';
const target = 'Folio,Referencia,Descripción\n010,Ana,Ana\n011,otro,Visita Lucía centro\n012,otro,Cadiz centro\n013,,sin dato';
const heading = '\ufeffID,Nombre,Nota,Nombre\r\n';
const anaRows = '001,Ána,"Con, coma",A\r\n' + '002,Ana,"Comillas ""y""\r\nlínea",B\r\n'.repeat(2);
const downloadText = async (page, button) => {
  const [download] = await Promise.all([page.waitForEvent('download'), button.click()]);
  return [download.suggestedFilename(), await fs.readFile(await download.path(), 'utf8')];
};

function selectFile(page, number, content, name) {
  return page.locator('.file-input').nth(number - 1).setInputFiles({ name, mimeType: 'text/csv', buffer: Buffer.from(content) });
}

async function loaded(page, number) { await page.locator('.file-settings').nth(number - 1).waitFor({ state: 'visible' }); }
async function completed(page) {
  const result = page.locator('.results');
  const error = page.getByRole('alert');
  await result.or(error).waitFor({ state: 'visible', timeout: 6000 });
  if (await error.isVisible()) assert.fail(await error.innerText());
}
async function createBrowser(t) {
  const executablePath = process.env.CSV_MATCH_BROWSER_PATH;
  const browser = await chromium.launch(executablePath ? { executablePath } : { channel: process.env.CSV_MATCH_BROWSER || 'chrome' });
  t.after(() => browser.close());
  t.diagnostic(`Chromium ${browser.version()}, ${os.version()}`);
  return browser;
}

test('file:// sin red, Worker, dos modos, descargas, cancelación y vista estrecha', async t => {
  const browser = await createBrowser(t);
  const context = await browser.newContext({ offline: true, viewport: { width: 1540, height: 930 } });
  await context.addInitScript(() => { window.showSaveFilePicker = undefined; });
  const page = await context.newPage();
  const errors = [];
  let workers = 0;
  page.on('pageerror', error => errors.push(error.message));
  page.on('worker', () => workers++);
  await page.goto(indexURL);
  assert.equal(await page.locator('.results').isVisible(), false);
  assert.equal(await page.locator('.run').isEnabled(), false);
  await selectFile(page, 1, source, 'clientes.csv');
  await loaded(page, 1);
  await selectFile(page, 2, target, 'operaciones.csv');
  await loaded(page, 2);
  assert.match(await page.locator('.header-warning').first().innerText(), /repetidos/);
  assert.equal(await page.locator('.file-panel').first().locator('tbody tr').count(), 6);
  await page.locator('select').selectOption('1');
  await page.locator('.multiselect summary').click();
  await page.getByRole('checkbox', { name: '1. Folio', exact: true }).uncheck();
  await page.getByRole('checkbox', { name: '2. Referencia', exact: true }).check();
  await page.getByRole('checkbox', { name: '3. Descripción', exact: true }).check();
  await page.locator('.multiselect summary').press('Escape');
  await page.getByLabel('Ignorar acentos y diacríticos').check();
  await page.locator('.run').click();
  await completed(page);
  assert.deepEqual(await downloadText(page, page.locator('.download').nth(0)), ['COINCIDEN.csv', heading + anaRows]);
  assert.deepEqual(await downloadText(page, page.locator('.download').nth(1)), ['NO_COINCIDEN.csv', heading + '003,Lucía,verde,C\r\n004,,gris,D\r\n005,Cadiz,azul,E\r\n']);
  await page.getByLabel('Coincidencia parcial').check();
  assert.equal(await page.locator('.results').isVisible(), false);
  await page.locator('.run').click();
  await completed(page);
  assert.deepEqual(await downloadText(page, page.locator('.download').nth(0)), ['COINCIDEN.csv', heading + anaRows + '003,Lucía,verde,C\r\n005,Cadiz,azul,E\r\n']);
  if (process.env.CSV_MATCH_SHOTS) {
    await page.screenshot({ path: path.join(process.env.CSV_MATCH_SHOTS, 'comparar.png'), fullPage: true });
  }
  await page.getByRole('tab', { name: 'Comparar archivos' }).press('ArrowRight');
  assert.equal(await page.getByRole('tab', { name: 'Buscar texto' }).getAttribute('aria-selected'), 'true');
  assert.equal(await page.locator('.file-name').first().innerText(), 'clientes.csv');
  await page.getByLabel('Texto que deseas buscar').fill('Lucía');
  await page.getByLabel('Ambos', { exact: true }).check();
  await page.locator('.run').click();
  await completed(page);
  assert.deepEqual(await downloadText(page, page.locator('.download').nth(0)), ['BUSQUEDA_CSV1.csv', heading + '003,Lucía,verde,C\r\n']);
  assert.deepEqual(await downloadText(page, page.locator('.download').nth(1)), ['BUSQUEDA_CSV2.csv', '\ufeffFolio,Referencia,Descripción\r\n011,otro,Visita Lucía centro\r\n']);
  await page.getByLabel('Exacta', { exact: true }).check();
  await page.locator('.run').click();
  await completed(page);
  assert.match(await page.locator('.search-result h3').nth(1).innerText(), /0 encontrados/);
  await page.getByLabel('CSV 2', { exact: true }).check();
  await page.locator('.run').click();
  await completed(page);
  assert.equal(await page.locator('.download').count(), 1);
  assert.deepEqual(await downloadText(page, page.locator('.download')), ['BUSQUEDA_CSV2.csv', '\ufeffFolio,Referencia,Descripción\r\n']);
  await page.locator('csv-match').evaluate(app => {
    app.$('.run').click();
    app.$('.cancel').click();
  });
  await page.getByRole('alert').waitFor({ state: 'visible' });
  assert.equal(await page.getByRole('alert').innerText(), 'Operación cancelada.');
  assert.equal(await page.locator('.results').isVisible(), false);
  await page.getByRole('tab', { name: 'Comparar archivos' }).click();
  assert.equal(await page.locator('select').inputValue(), '1');
  assert.equal(await page.getByLabel('Ignorar acentos y diacríticos').isChecked(), true);
  await page.setViewportSize({ width: 360, height: 850 });
  await page.locator('.run').click();
  await completed(page);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 360);
  if (process.env.CSV_MATCH_SHOTS) {
    await page.screenshot({ path: path.join(process.env.CSV_MATCH_SHOTS, 'estrecho.png'), fullPage: true });
  }
  assert.deepEqual(errors, []);
  assert.ok(workers >= 10, `Se observaron ${workers} Workers`);
});

test('un solo archivo, error tardío y recuperación sin Worker', async t => {
  const browser = await createBrowser(t);
  const context = await browser.newContext();
  await context.addInitScript(() => {
    window.Worker = class { constructor() { throw new DOMException('Bloqueado', 'SecurityError'); } };
    window.showSaveFilePicker = undefined;
  });
  const page = await context.newPage();
  await page.goto(indexURL);
  await selectFile(page, 2, 'a,b\n' + 'x,y\n'.repeat(10) + 'z', 'tardio.csv');
  await loaded(page, 2);
  await page.getByRole('tab', { name: 'Buscar texto' }).click();
  assert.equal(await page.getByLabel('CSV 2', { exact: true }).isChecked(), true);
  await page.getByLabel('Texto que deseas buscar').fill('x');
  await page.locator('.run').click();
  await page.getByRole('alert').waitFor({ state: 'visible' });
  assert.match(await page.getByRole('alert').innerText(), /tardio.csv: Registro 12/);
  assert.equal(await page.locator('.results').isVisible(), false);
  await selectFile(page, 2, 'a,b\nx,y\nz,x', 'valido.csv');
  await page.getByText('valido.csv', { exact: true }).waitFor();
  await page.locator('.multiselect summary').click();
  await page.getByRole('checkbox', { name: 'Todas las columnas', exact: true }).uncheck();
  assert.equal(await page.locator('.run').isEnabled(), false);
  await page.getByRole('checkbox', { name: '2. b', exact: true }).check();
  await page.locator('.multiselect summary').press('Escape');
  await page.locator('.run').click();
  await completed(page);
  assert.deepEqual(await downloadText(page, page.locator('.download')), ['BUSQUEDA_CSV2.csv', '\ufeffa,b\r\nz,x\r\n']);
});

test('compara XLSX y CSV con punto y coma y exporta ambos orígenes sin red', async t => {
  const xlsx = loadSheetJS();
  const workbook = xlsx.utils.book_new();
  const sheet = xlsx.utils.aoa_to_sheet([['ID', 'Nota'], [1, 'a; b'], [2, 'Texto\ncon salto'],
    [123456789012345, 'General'], [123456789012346, 'Científico']]);
  sheet.A2.z = sheet.A3.z = '000';
  sheet.A5.z = '0.00E+00';
  xlsx.utils.book_append_sheet(workbook, sheet, 'Brutos');
  xlsx.utils.book_append_sheet(workbook, xlsx.utils.aoa_to_sheet([['ID'], ['003']]), 'Otra hoja');
  const bytes = Buffer.from(xlsx.write(workbook, { type: 'array', bookType: 'xlsx', compression: true }));
  const browser = await createBrowser(t);
  const context = await browser.newContext({ offline: true });
  await context.addInitScript(() => { window.showSaveFilePicker = undefined; });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(indexURL);
  await page.locator('.file-input').nth(0).setInputFiles({
    name: 'brutos.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: bytes
  });
  await loaded(page, 1);
  assert.match(await page.locator('.file-meta').first().innerText(), /4 registros, 2 columnas.*Hoja: Brutos/);
  await selectFile(page, 2, 'ID;Nota\n001;"uno, dos"\n003;fuera\n123456789012345;largo', 'activos.csv');
  await loaded(page, 2);
  await page.locator('.run').click();
  await completed(page);
  assert.deepEqual(await downloadText(page, page.locator('.download').first()), ['COINCIDEN.csv', '\ufeffID,Nota\r\n001,"a; b"\r\n123456789012345,General\r\n']);
  assert.deepEqual(await downloadText(page, page.locator('.download').nth(1)), ['NO_COINCIDEN.csv', '\ufeffID,Nota\r\n002,"Texto\ncon salto"\r\n123456789012346,Científico\r\n']);

  await page.getByRole('tab', { name: 'Buscar texto' }).click();
  await page.getByLabel('Ambos', { exact: true }).check();
  await page.getByLabel('Texto que deseas buscar').fill('001');
  await page.locator('.run').click();
  await completed(page);
  assert.deepEqual(await downloadText(page, page.locator('.download').nth(1)), ['BUSQUEDA_CSV2.csv', '\ufeffID,Nota\r\n001,"uno, dos"\r\n']);
  assert.deepEqual(errors, []);
});

test('integración por componente e iframe y escritura progresiva con un FileSystemWritableFileStream real', async t => {
  const browser = await createBrowser(t);
  const server = http.createServer(async (req, res) => {
    const routes = { '/index.html': 'text/html', '/js/engine.js': 'text/javascript', '/js/app.js': 'text/javascript', '/css/styles.css': 'text/css' };
    if (req.url === '/') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end('<meta charset="utf-8"><style>button { background:red; } .narrow { width:340px }</style><button id="outside">Anfitrión</button><div class="narrow"><csv-match></csv-match></div><script src="js/engine.js"></script><script src="js/app.js"></script><iframe src="index.html" title="Herramienta" sandbox="allow-scripts allow-downloads"></iframe>');
    } else if (routes[req.url]) {
      res.setHeader('Content-Type', routes[req.url]);
      res.end(await fs.readFile(path.join(root, req.url.slice(1))));
    } else { res.statusCode = 404; res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.evaluate(async () => {
    const storage = await navigator.storage.getDirectory();
    const handle = await storage.getFileHandle('guardado.csv', { create: true });
    window.showSaveFilePicker = async () => handle;
    window.csvTestHandle = handle;
  });
  assert.equal(await page.locator('#outside').evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(255, 0, 0)');
  assert.notEqual(await page.locator('.run').evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(255, 0, 0)');
  const wide = Array.from({ length: 80 }, (_, i) => `Columna_${i + 1}`).join(',');
  await selectFile(page, 1, `${wide}\n${wide}\n${wide}`, 'ancho.csv');
  await loaded(page, 1);
  assert.equal(await page.locator('.table-wrap').first().evaluate(node => node.scrollWidth > node.clientWidth), true);
  assert.equal(await page.locator('.narrow').evaluate(node => node.scrollWidth), 340);
  await page.getByRole('tab', { name: 'Buscar texto' }).click();
  await page.getByLabel('Texto que deseas buscar').fill('Columna_1');
  await page.locator('.run').click();
  await completed(page);
  await page.locator('.download').click();
  await page.getByText('Archivo guardado', { exact: true }).waitFor();
  assert.equal(await page.evaluate(async () => (await window.csvTestHandle.getFile()).text()), `${wide}\r\n${wide}\r\n${wide}\r\n`);
  await page.evaluate(async () => {
    const handle = window.csvTestHandle;
    const original = await handle.createWritable();
    await original.write('contenido anterior');
    await original.close();
    window.showSaveFilePicker = async () => ({
      getFile: () => handle.getFile(),
      createWritable: async () => {
        const writer = await handle.createWritable();
        return {
          async write(chunk) {
            await writer.write(chunk);
            document.querySelector('csv-match').$('.cancel').click();
          },
          close: () => writer.close(),
          abort: () => writer.abort()
        };
      }
    });
  });
  await page.locator('.download').click();
  await page.getByRole('alert').waitFor({ state: 'visible' });
  assert.equal(await page.getByRole('alert').innerText(), 'Operación cancelada.');
  assert.equal(await page.evaluate(async () => (await window.csvTestHandle.getFile()).text()), 'contenido anterior');
  assert.equal(await page.locator('.results').isVisible(), true);

  const iframe = page.frameLocator('iframe');
  await selectFile(iframe, 2, 'c\nvalor', 'iframe.csv');
  await loaded(iframe, 2);
  await iframe.getByRole('tab', { name: 'Buscar texto' }).click();
  await iframe.getByLabel('Texto que deseas buscar').fill('valor');
  await iframe.locator('.run').click();
  await completed(iframe);
  assert.deepEqual(await downloadText(page, iframe.locator('.download')), ['BUSQUEDA_CSV2.csv', '\ufeffc\r\nvalor\r\n']);
});
