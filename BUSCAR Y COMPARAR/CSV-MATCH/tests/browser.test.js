const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const { createHash } = require('node:crypto');
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
  await page.locator('.columns select').selectOption('1');
  await page.locator('.multiselect summary').click();
  await page.getByRole('checkbox', { name: '1. Folio', exact: true }).uncheck();
  await page.getByRole('checkbox', { name: '2. Referencia', exact: true }).check();
  await page.getByRole('checkbox', { name: '3. Descripción', exact: true }).check();
  await page.locator('.multiselect summary').press('Escape');
  await page.getByLabel('Ignorar acentos y diacríticos').check();
  await page.locator('.run').click();
  await completed(page);
  assert.equal(await page.getByLabel('Formato de exportación').inputValue(), ';');
  await page.getByLabel('Formato de exportación').selectOption(',');
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
  assert.equal(await page.locator('.columns select').inputValue(), '1');
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
  assert.deepEqual(await downloadText(page, page.locator('.download')), ['BUSQUEDA_CSV2.csv', '\ufeffa;b\r\nz;x\r\n']);
});

test('quita cada archivo por separado, invalida resultados y conserva la búsqueda y sus acentos verdes', async t => {
  const browser = await createBrowser(t);
  const page = await browser.newPage({ offline: true });
  await page.goto(indexURL);
  const first = page.locator('.file-panel').first();
  const second = page.locator('.file-panel').nth(1);
  await selectFile(page, 1, 'clave,nota,\nlocal,uno,', 'primero.csv');
  await loaded(page, 1);
  await selectFile(page, 2, 'clave,nota,\nlocal,dos,', 'segundo.csv');
  await loaded(page, 2);
  const app = page.locator('csv-match');
  const accents = () => app.evaluate(node => ['.tabs [aria-selected=true]', '.steps [aria-current] span', '.config > h2', '.run']
    .map(selector => getComputedStyle(node.$(selector)).backgroundColor));
  const compareColors = await accents();
  await app.evaluate(node => {
    window.keptFile = node.files[1];
    node.$('.run').click();
    if (![...node.ui.querySelectorAll('.remove-file, .file-input')].every(control => control.disabled)) {
      throw new Error('Los controles de archivo deben quedar deshabilitados durante el proceso.');
    }
  });
  await completed(page);
  assert.deepEqual(await downloadText(page, page.locator('.download').first()), ['COINCIDEN.csv', '\ufeffclave;nota;\r\nlocal;uno;\r\n']);
  await first.getByRole('button', { name: 'Quitar archivo' }).click();
  assert.equal(await first.locator('.file-name').innerText(), 'Sin archivo');
  assert.equal(await first.locator('.file-meta').innerText(), '');
  assert.equal(await first.locator('table, .columns input, .columns select').count(), 0);
  assert.equal(await app.evaluate(node => node.files[0] === null && node.files[1] === window.keptFile && !node.result), true);
  assert.equal(await page.locator('.results').isVisible(), false);
  assert.equal(await page.locator('.run').isEnabled(), false);

  await page.getByRole('tab', { name: 'Buscar texto' }).click();
  assert.equal(await page.getByLabel('CSV 2', { exact: true }).isChecked(), true);
  await page.getByLabel('Texto que deseas buscar').fill('local');
  const searchColors = await accents();
  assert.ok(searchColors.every((color, index) => color !== compareColors[index]));
  await page.locator('.run').click();
  await completed(page);
  assert.deepEqual(await downloadText(page, page.locator('.download')), ['BUSQUEDA_CSV2.csv', '\ufeffclave;nota;\r\nlocal;dos;\r\n']);
  await selectFile(page, 1, 'clave,nota,\nlocal,uno,', 'primero.csv');
  await loaded(page, 1);
  await page.getByLabel('Ambos', { exact: true }).check();
  await page.locator('.run').click();
  await completed(page);
  await app.evaluate(node => { window.keptFile = node.files[0]; });
  await second.getByRole('button', { name: 'Quitar archivo' }).click();
  assert.equal(await page.locator('.results').isVisible(), false);
  assert.equal(await app.evaluate(node => node.files[1] === null && node.files[0] === window.keptFile), true);
  assert.equal(await second.locator('.file-picker span').innerText(), 'Seleccionar archivo');
  assert.equal(await page.getByLabel('CSV 1', { exact: true }).isChecked(), true);
  await page.locator('.run').click();
  await completed(page);
  assert.deepEqual(await downloadText(page, page.locator('.download')), ['BUSQUEDA_CSV1.csv', '\ufeffclave;nota;\r\nlocal;uno;\r\n']);
  await page.getByRole('tab', { name: 'Comparar archivos' }).click();
  await page.mouse.move(0, 0);
  assert.deepEqual((await accents()).slice(0, 3), compareColors.slice(0, 3));
  assert.equal(await page.locator('.run').isEnabled(), false);
});

test('compara XLSX y CSV con punto y coma y exporta ambos orígenes sin red', async t => {
  const xlsx = loadSheetJS();
  const workbook = xlsx.utils.book_new();
  const markup = '<img src=x onerror=window.csvExecuted=true>';
  const sheet = xlsx.utils.aoa_to_sheet([['ID', 'Nota'], [1, 'a; b'], [2, 'Texto\ncon salto'],
    [123456789012345, 'General'], [123456789012346, markup]]);
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
  assert.equal(await page.getByText(markup, { exact: true }).count(), 1);
  assert.equal(await page.locator('csv-match img').count(), 0);
  await selectFile(page, 2, 'ID;Nota\n001;"uno, dos"\n003;fuera\n123456789012345;largo', 'activos.csv');
  await loaded(page, 2);
  await page.locator('.run').click();
  await completed(page);
  assert.deepEqual(await downloadText(page, page.locator('.download').first()), ['COINCIDEN.csv', '\ufeffID;Nota\r\n001;"a; b"\r\n123456789012345;General\r\n']);
  assert.deepEqual(await downloadText(page, page.locator('.download').nth(1)), ['NO_COINCIDEN.csv', `\ufeffID;Nota\r\n002;"Texto\ncon salto"\r\n123456789012346;${markup}\r\n`]);

  await page.getByRole('tab', { name: 'Buscar texto' }).click();
  await page.getByLabel('Ambos', { exact: true }).check();
  await page.getByLabel('Texto que deseas buscar').fill('001');
  await page.locator('.run').click();
  await completed(page);
  assert.deepEqual(await downloadText(page, page.locator('.download').nth(1)), ['BUSQUEDA_CSV2.csv', '\ufeffID;Nota\r\n001;"uno, dos"\r\n']);
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
  const wide = Array.from({ length: 80 }, (_, i) => `Columna_${i + 1}`).join(',');
  await page.evaluate(async wide => {
    const storage = await navigator.storage.getDirectory();
    const origin = await storage.getDirectoryHandle('origin', { create: true });
    const destination = await storage.getDirectoryHandle('destination', { create: true });
    window.csvSourceHandle = await origin.getFileHandle('ancho.csv', { create: true });
    window.csvTestHandle = await destination.getFileHandle('ancho.csv', { create: true });
    for (const handle of [window.csvSourceHandle, window.csvTestHandle]) {
      const writer = await handle.createWritable();
      await writer.write(`${wide}\n${wide}\n${wide}`);
      await writer.close();
    }
    window.showOpenFilePicker = async () => [window.csvSourceHandle];
    window.showSaveFilePicker = async () => window.csvSourceHandle;
  }, wide);
  assert.equal(await page.locator('#outside').evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(255, 0, 0)');
  assert.notEqual(await page.locator('.run').evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(255, 0, 0)');
  await page.locator('.file-input').first().click();
  await loaded(page, 1);
  assert.equal(await page.locator('.table-wrap').first().evaluate(node => node.scrollWidth > node.clientWidth), true);
  assert.equal(await page.locator('.narrow').evaluate(node => node.scrollWidth), 340);
  await page.getByRole('tab', { name: 'Buscar texto' }).click();
  await page.getByLabel('Texto que deseas buscar').fill('Columna_1');
  await page.locator('.run').click();
  await completed(page);
  await page.locator('.download').click();
  assert.match(await page.getByRole('alert').innerText(), /destino coincide/);
  assert.equal(await page.evaluate(async () => (await window.csvSourceHandle.getFile()).text()), `${wide}\n${wide}\n${wide}`);
  await page.evaluate(() => { window.showSaveFilePicker = async () => window.csvTestHandle; });
  await page.locator('.download').click();
  await page.getByText('Archivo guardado', { exact: true }).waitFor();
  const semicolonWide = wide.replaceAll(',', ';');
  assert.equal(await page.evaluate(async () => (await window.csvTestHandle.getFile()).text()), `${semicolonWide}\r\n${semicolonWide}\r\n${semicolonWide}\r\n`);
  await page.evaluate(async () => {
    const handle = window.csvTestHandle;
    const original = await handle.createWritable();
    await original.write('contenido anterior');
    await original.close();
    const create = handle.createWritable.bind(handle);
    handle.createWritable = async () => {
      const writer = await create();
      return {
        async write(chunk) {
          await writer.write(chunk);
          document.querySelector('csv-match').$('.cancel').click();
        },
        close: () => writer.close(),
        abort: () => writer.abort()
      };
    };
  });
  await page.locator('.download').click();
  await page.getByRole('alert').waitFor({ state: 'visible' });
  assert.equal(await page.getByRole('alert').innerText(), 'Operación cancelada.');
  assert.equal(await page.evaluate(async () => (await window.csvTestHandle.getFile()).text()), 'contenido anterior');
  assert.equal(await page.locator('.results').isVisible(), true);

  await page.evaluate(async () => {
    const writer = await window.csvSourceHandle.createWritable();
    await writer.write('cabecera\ncambio');
    await writer.close();
  });
  await page.locator('.download').click();
  await page.getByRole('alert').waitFor();
  assert.match(await page.getByRole('alert').innerText(), /cambió o dejó de estar disponible/);
  assert.equal(await page.locator('.results').isVisible(), false);

  const iframe = page.frameLocator('iframe');
  await selectFile(iframe, 2, 'c\nvalor', 'iframe.csv');
  await loaded(iframe, 2);
  await iframe.getByRole('tab', { name: 'Buscar texto' }).click();
  await iframe.getByLabel('Texto que deseas buscar').fill('valor');
  await iframe.locator('.run').click();
  await completed(iframe);
  assert.deepEqual(await downloadText(page, iframe.locator('.download')), ['BUSQUEDA_CSV2.csv', '\ufeffc\r\nvalor\r\n']);
});

async function enterpriseServer(t) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/frame') {
      const port = Number(url.searchParams.get('port') ?? server.address().port);
      const sandbox = url.searchParams.has('sandbox') ? ' sandbox="allow-scripts allow-downloads"' : '';
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(`<iframe title="CSV MATCH"${sandbox} src="http://127.0.0.1:${port}/index.html"></iframe>`);
      return;
    }
    if (url.pathname === '/csp') {
      res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; worker-src 'none'; connect-src 'none'; img-src 'none'");
    }
    const routes = {
      '/csp': ['index.html', 'text/html'], '/index.html': ['index.html', 'text/html'],
      '/js/engine.js': ['js/engine.js', 'text/javascript'], '/js/app.js': ['js/app.js', 'text/javascript'],
      '/js/vendor/sheetjs-0.20.3.js': ['js/vendor/sheetjs-0.20.3.js', 'text/javascript'],
      '/css/styles.css': ['css/styles.css', 'text/css']
    };
    const route = routes[url.pathname];
    if (!route) { res.statusCode = 404; res.end(); return; }
    res.setHeader('Content-Type', `${route[1]}; charset=utf-8`);
    res.end(await fs.readFile(path.join(root, route[0])));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  return server.address().port;
}

test('CSP real sin Worker, CSV literal y vistas previas sin HTML ejecutable', async t => {
  const browser = await createBrowser(t);
  const port = await enterpriseServer(t);
  const page = await browser.newPage();
  const requests = [];
  page.on('request', request => requests.push(request.url()));
  await page.goto(`http://127.0.0.1:${port}/csp`);
  const headline = '<img src="https://example.invalid/leak" onerror="window.csvExecuted=true">';
  const formula = '=1+1';
  await selectFile(page, 1, `"${headline.replaceAll('"', '""')}"\n${formula}\n+34\n-12\n@A1\n\ttext`, 'literal.csv');
  await loaded(page, 1);
  assert.equal(await page.locator('th').first().innerText(), headline);
  assert.equal(await page.locator('csv-match img').count(), 0);
  await selectFile(page, 2, 'destino\nprefijo =1+1 sufijo', 'destino.csv');
  await loaded(page, 2);
  await page.getByLabel('Coincidencia parcial').check();
  await page.locator('.run').click();
  await completed(page);
  assert.match(await page.locator('.results').innerText(), /evitar fórmulas en Excel/);
  const [, yes] = await downloadText(page, page.locator('.download').first());
  const [, no] = await downloadText(page, page.locator('.download').nth(1));
  assert.ok(yes.endsWith('\r\n=1+1\r\n'));
  assert.ok(no.endsWith('\r\n+34\r\n-12\r\n@A1\r\n\ttext\r\n'));
  await selectFile(page, 1, 'c\n' + 'a\n'.repeat(280000), 'grande.csv');
  await page.getByRole('alert').waitFor();
  assert.match(await page.getByRole('alert').innerText(), /bloqueó el Worker.*512 KiB/);
  assert.equal(await page.evaluate(() => window.csvExecuted), undefined);
  assert.ok(requests.every(url => url.startsWith(`http://127.0.0.1:${port}/`)));
});

test('descarga >32 MiB desde iframe del mismo origen, cancelación y límites de file:// y marcos de terceros', async t => {
  const browser = await chromium.launch({ channel: process.env.CSV_MATCH_BROWSER || 'chrome', args: ['--js-flags=--max-old-space-size=128'] });
  t.after(() => browser.close());
  const port = await enterpriseServer(t);
  const other = await enterpriseServer(t);
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'csv-match-export-'));
  const sourcePath = path.join(folder, 'grande.csv');
  const portal = path.join(folder, 'index.html');
  const installed = path.join(folder, 'CSV-MATCH');
  const assets = ['index.html', 'js/engine.js', 'js/app.js', 'css/styles.css'];
  t.after(async () => {
    for (const asset of assets) await fs.unlink(path.join(installed, asset));
    for (const directory of ['js', 'css']) await fs.rmdir(path.join(installed, directory));
    await fs.rmdir(installed);
    await fs.unlink(portal);
    await fs.unlink(sourcePath);
    await fs.rmdir(folder);
  });
  for (const asset of assets) {
    const destination = path.join(installed, asset);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.copyFile(path.join(root, asset), destination);
  }
  await fs.writeFile(portal, '<meta charset="utf-8"><iframe title="CSV MATCH" src="./CSV-MATCH/index.html"></iframe>');
  const line = `valor-${'m'.repeat(62)}`;
  const rows = 500000;
  const expected = createHash('sha256').update('\ufeffcodigo;nota;\r\n');
  const stream = await fs.open(sourcePath, 'w');
  try {
    await stream.writeFile('codigo,nota,\n');
    for (let index = 0; index < rows; index += 5000) {
      await stream.writeFile(`${line},detalle,\n`.repeat(5000));
      expected.update(`${line};detalle;\r\n`.repeat(5000));
    }
  } finally { await stream.close(); }
  const expectedHash = expected.digest('hex');
  const context = await browser.newContext();
  await context.addInitScript(() => { window.showSaveFilePicker = undefined; });
  const page = await context.newPage();
  const requests = [];
  page.on('request', request => requests.push(request.url()));
  async function searchLarge(scope) {
    await scope.locator('.file-input').first().setInputFiles(sourcePath);
    await loaded(scope, 1);
    await scope.getByRole('tab', { name: 'Buscar texto' }).click();
    await scope.getByLabel('Texto que deseas buscar').fill(line);
    await scope.locator('.run').click();
    await completed(scope);
  }
  async function verifyDownload(scope) {
    const [download] = await Promise.all([page.waitForEvent('download'), scope.locator('.download').click()]);
    const output = await download.path();
    const size = (await fs.stat(output)).size;
    assert.ok(size > 32 * 1024 * 1024);
    const hash = createHash('sha256');
    for await (const data of createReadStream(output)) hash.update(data);
    assert.equal(hash.digest('hex'), expectedHash);
    t.diagnostic(`Salida íntegra de ${size} bytes, V8 limitado a 128 MiB de old space`);
    await download.delete();
  }
  await page.goto(`http://127.0.0.1:${port}/frame`);
  let iframe = page.frameLocator('iframe');
  await searchLarge(iframe);
  await iframe.locator('csv-match').evaluate(app => {
    const prototype = FileSystemFileHandle.prototype;
    const create = prototype.createWritable;
    prototype.createWritable = async function (...args) {
      const writer = await create.apply(this, args);
      prototype.createWritable = create;
      return {
        async write(chunk) {
          await writer.write(chunk);
          app.$('.cancel').click();
        },
        abort: () => writer.abort(), close: () => writer.close()
      };
    };
  });
  await iframe.locator('.download').click();
  await iframe.getByRole('alert').waitFor();
  assert.equal(await iframe.getByRole('alert').innerText(), 'Operación cancelada.');
  assert.equal(await iframe.locator('csv-match').evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle('csv-match-exports-v1');
    for await (const _ of dir.keys()) return false;
    return true;
  }), true);
  await verifyDownload(iframe);

  await page.goto(indexURL);
  await context.setOffline(true);
  await searchLarge(page);
  const localStorageAvailable = await page.evaluate(async () => {
    try { return Boolean(await navigator.storage.getDirectory()); }
    catch { return false; }
  });
  if (localStorageAvailable) await verifyDownload(page);
  else {
    await page.locator('.download').click();
    await page.getByRole('alert').waitFor();
    assert.match(await page.getByRole('alert').innerText(), /descarga en memoria admite hasta 32 MiB/);
  }

  await page.goto(pathToFileURL(portal).href);
  iframe = page.frameLocator('iframe');
  await searchLarge(iframe);
  const localFrameOrigin = await iframe.locator('csv-match').evaluate(() => {
    try { return Boolean(top.document); }
    catch { return false; }
  });
  t.diagnostic(`iframe relativo file:// sin sandbox con acceso al origen superior: ${localFrameOrigin}`);
  if (localFrameOrigin && localStorageAvailable) await verifyDownload(iframe);
  else {
    await iframe.locator('.download').click();
    await iframe.getByRole('alert').waitFor();
    assert.match(await iframe.getByRole('alert').innerText(), /descarga en memoria admite hasta 32 MiB/);
    const open = iframe.getByRole('link', { name: 'Abrir CSV MATCH en otra pestaña' });
    const installedURL = pathToFileURL(path.join(installed, 'index.html')).href;
    assert.equal(await open.getAttribute('href'), installedURL);
    const [standalone] = await Promise.all([context.waitForEvent('page'), open.click()]);
    await standalone.waitForURL(installedURL);
    await standalone.getByRole('tab', { name: 'Comparar archivos' }).waitFor();
    await standalone.close();
  }
  await selectFile(iframe, 1, 'codigo\nlocal', 'pequeno.csv');
  await iframe.getByText('pequeno.csv', { exact: true }).waitFor();
  await iframe.getByLabel('Texto que deseas buscar').fill('local');
  await iframe.locator('.run').click();
  await completed(iframe);
  assert.deepEqual(await downloadText(page, iframe.locator('.download')), ['BUSQUEDA_CSV1.csv', '\ufeffcodigo\r\nlocal\r\n']);
  await selectFile(iframe, 2, 'texto\nprefijo local', 'destino.csv');
  await loaded(iframe, 2);
  await iframe.getByRole('tab', { name: 'Comparar archivos' }).click();
  await iframe.locator('.run').click();
  await completed(iframe);
  assert.deepEqual(await downloadText(page, iframe.locator('.download').first()), ['COINCIDEN.csv', '\ufeffcodigo\r\n']);
  await iframe.getByLabel('Coincidencia parcial').check();
  await iframe.locator('.run').click();
  await completed(iframe);
  assert.deepEqual(await downloadText(page, iframe.locator('.download').first()), ['COINCIDEN.csv', '\ufeffcodigo\r\nlocal\r\n']);
  await iframe.locator('csv-match').evaluate(app => { app.$('.run').click(); app.$('.cancel').click(); });
  await iframe.getByRole('alert').waitFor();
  assert.equal(await iframe.getByRole('alert').innerText(), 'Operación cancelada.');
  await context.setOffline(false);

  await page.goto(`http://127.0.0.1:${port}/frame?port=${other}&sandbox`);
  iframe = page.frameLocator('iframe');
  await searchLarge(iframe);
  await iframe.locator('.download').click();
  await iframe.getByRole('alert').waitFor();
  assert.match(await iframe.getByRole('alert').innerText(), /descarga en memoria admite hasta 32 MiB/);
  assert.doesNotMatch(await iframe.locator('.phase').innerText(), /Generando el archivo/);
  const external = requests.filter(url => /^https?:/.test(url) &&
    !url.startsWith(`http://127.0.0.1:${port}/`) && !url.startsWith(`http://127.0.0.1:${other}/`));
  assert.deepEqual(external, []);
});
