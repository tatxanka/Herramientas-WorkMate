'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { existsSync } = require('node:fs');
const fs = require('node:fs/promises');
const { createHash, randomUUID } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.WORKMATE_PLAYWRIGHT || 'playwright-core');
const M = require('../js/model');

const root = path.resolve(__dirname, '..');
const url = pathToFileURL(path.join(root, 'index.html')).href;
const scratch = path.join(__dirname, '.work');
const csvInstalled = existsSync(path.resolve(root, M.csvPath));
const ownerPass = randomUUID();
const managerPass = randomUUID();
const userPass = randomUUID();
let browser;
const downloadPaths = new WeakMap();

before(async () => {
  await fs.mkdir(scratch, { recursive: true });
  browser = await chromium.launch({ channel: 'chrome', headless: true, downloadsPath: scratch });
});
after(async () => { await browser?.close(); });

const button = (page, name) => page.getByRole('button', { name, exact: true });
const dialog = page => page.locator('#modal');
const sidebar = page => page.locator('#tree');
const option = (page, name) => button(sidebar(page), 'Opciones de ' + name);
const shown = async locator => locator.waitFor({ state: 'visible' });
const active = page => shown(page.locator('#portal'));
const hidden = async locator => locator.waitFor({ state: 'hidden' });
const config = async page => button(page, 'Preferencias y archivo').click();
const edit = async page => button(page, 'Modo edición').click();
const close = async page => button(page, 'Cerrar ventana').click();
const type = (page, name, value) => page.locator('[name="' + name + '"]').fill(value);

async function context(t, settings = {}) {
  const ctx = await browser.newContext({ offline: true, viewport: { width: 1420, height: 900 }, ...settings });
  t.after(() => ctx.close());
  const page = await ctx.newPage();
  const copies = [];
  downloadPaths.set(page, copies);
  t.after(async () => {
    for (const { target, folder } of copies) {
      await fs.unlink(target).catch(() => {});
      await fs.rmdir(folder).catch(() => {});
    }
  });
  page.setDefaultTimeout(5500);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, []));
  page.on('dialog', dialog => dialog.accept());
  await page.goto(url);
  return { page, ctx };
}

async function download(page, title) {
  const [file] = await Promise.all([page.waitForEvent('download'), button(page, title).click()]);
  assert.equal(await file.failure(), null);
  const folder = await fs.mkdtemp(path.join(scratch, 'descarga-'));
  const target = path.join(folder, file.suggestedFilename());
  downloadPaths.get(page).push({ target, folder });
  await file.saveAs(target);
  return { name: file.suggestedFilename(), path: target };
}

async function choose(page, label, file) {
  const [picker] = await Promise.all([page.waitForEvent('filechooser'), button(page, label).click()]);
  await picker.setFiles(file);
}

async function verifySave(page) {
  const saved = await download(page, 'Descargar JSON');
  await choose(page, 'Seleccionar copia descargada', saved.path);
  await hidden(dialog(page));
  await active(page);
  return JSON.parse(await fs.readFile(saved.path, 'utf8'));
}

async function setup(page, registerCSV = true) {
  await button(page, 'Primera configuración').click();
  await type(page, 'name', 'Propietaria QA');
  await type(page, 'login', 'propietaria');
  await type(page, 'password', ownerPass);
  await type(page, 'repeat', ownerPass);
  if (!registerCSV) await page.getByRole('checkbox', { name: /Registrar CSV MATCH/ }).uncheck();
  await button(page, 'Elegir almacenamiento').click();
  await button(page, 'Usar JSON manual').click();
  return verifySave(page);
}

async function login(page, role, password, loginName, expectError = false) {
  await page.getByRole('button', { name: new RegExp('^' + role + ' ') }).click();
  if (loginName) await page.locator('select[name=login]').selectOption(loginName);
  await type(page, 'password', password);
  await button(page, 'Entrar').click();
  if (!expectError) await active(page);
}

async function createCategory(page, name, { parent, scope, buttonName = 'Categoría' } = {}) {
  await button(page, buttonName).click();
  await type(dialog(page), 'name', name);
  if (parent) await dialog(page).locator('[name=parent]').selectOption({ label: parent });
  if (scope) await dialog(page).locator('[name=scope]').selectOption(scope);
  await button(page, 'Crear categoría').click();
  await hidden(dialog(page));
}

async function createLink(page, name, { parent, scope = 'global', typeName = 'document', target = 'C:\\Temp\\Plan #1.xlsx' } = {}) {
  await button(page, 'Herramienta').click();
  await type(dialog(page), 'name', name);
  await dialog(page).locator('[name=scope]').selectOption(scope);
  await dialog(page).locator('[name=type]').selectOption(typeName);
  if (parent) await dialog(page).locator('[name=parent]').selectOption({ label: parent });
  await type(dialog(page), 'target', target);
  await button(page, 'Crear herramienta').click();
  await hidden(dialog(page));
}

async function createAccount(page, name, loginName, password) {
  await button(page, 'Nueva cuenta').click();
  await type(dialog(page), 'name', name);
  await type(dialog(page), 'login', loginName);
  await type(dialog(page), 'password', password);
  await button(page, 'Crear cuenta').click();
  await shown(button(page, name + (loginName === 'gestora' ? ' · Gestor' : ' · Usuario')));
}

async function applyAndSave(page) {
  await button(page, 'Aplicar').click();
  await button(page, 'Guardar').click();
  return verifySave(page);
}

test('Chrome offline file:// · instalación independiente y reapertura sin registrar CSV MATCH', async t => {
  const { page } = await context(t);
  const initial = await setup(page, false);
  assert.deepEqual(initial.tools, []);
  await page.reload();
  await login(page, 'Admin', ownerPass, 'propietaria');
  await shown(page.getByText('Aún no hay herramientas disponibles para esta cuenta.'));
  assert.equal(await page.locator('#viewer').getAttribute('src'), null);
});

test('Chrome offline file:// · instalación, relectura real, login, navegación, teclado y CSV MATCH en iframe',
  { skip: !csvInstalled && 'CSV MATCH se distribuye por separado' }, async t => {
  const { page } = await context(t);
  t.diagnostic('Chrome ' + browser.version());
  const initial = await setup(page);
  assert.equal(initial.tools[0].name, 'CSV MATCH');
  assert.equal(initial.accounts[0].password.algorithm, 'PBKDF2-SHA-256');
  assert.ok(!JSON.stringify(initial).includes(ownerPass));
  await page.reload();
  if (process.env.WORKMATE_SHOTS) {
    await shown(page.getByRole('heading', { name: 'Iniciar sesión' }));
    await page.screenshot({ path: path.join(scratch, 'perfiles.png') });
  }
  await login(page, 'Admin', 'incorrecta', 'propietaria', true);
  await shown(page.getByRole('alert').getByText('La contraseña no es correcta.'));
  await type(page, 'password', ownerPass);
  await page.locator('[name=password]').press('Enter');
  await active(page);
  await button(page, 'Vista cubos').click();
  await shown(sidebar(page).locator('.tiles .row-main').filter({ hasText: 'CSV MATCH' }));
  await page.getByRole('searchbox').fill('comparacion');
  await shown(sidebar(page).getByText('Resultados · 1'));
  await button(page, 'Marcar como favorito: CSV MATCH').click();
  await button(page, 'Contraer menú').press('Enter');
  await shown(page.locator('.is-collapsed'));
  await button(sidebar(page), 'CSV MATCH').press('Enter');
  const csv = page.frameLocator('#viewer');
  await shown(csv.getByRole('heading', { name: 'CSV MATCH', exact: true }));
  const files = csv.locator('.file-input');
  await files.nth(0).setInputFiles({ name: 'origen.csv', mimeType: 'text/csv', buffer: Buffer.from('ID,Nombre\n01,Ana\n02,Luz\n') });
  await shown(csv.locator('.file-settings').nth(0));
  await files.nth(1).setInputFiles({ name: 'destino.csv', mimeType: 'text/csv', buffer: Buffer.from('ID,Nombre\n01,Ana\n03,Mar\n') });
  await shown(csv.locator('.file-settings').nth(1));
  await csv.locator('.columns select').selectOption('0');
  await csv.locator('.multiselect summary').click();
  await csv.getByRole('checkbox', { name: '1. ID', exact: true }).check();
  await csv.locator('.multiselect summary').press('Escape');
  await button(csv, 'Ejecutar comparación').click();
  await shown(csv.locator('.results'));
  const [result] = await Promise.all([page.waitForEvent('download'), csv.locator('.download').first().click()]);
  assert.equal(result.suggestedFilename(), 'COINCIDEN.csv');
  assert.equal(await fs.readFile(await result.path(), 'utf8'), '\ufeffID;Nombre\r\n01;Ana\r\n');
  await button(page, 'Expandir menú').click();
  await button(page, 'Recientes').click();
  await shown(button(sidebar(page), 'CSV MATCH'));
  await page.setViewportSize({ width: 390, height: 780 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await button(page, 'Bloquear sesión').click();
  await shown(page.getByRole('heading', { name: 'Sesión bloqueada · Propietaria QA' }));
  assert.equal(await page.locator('#viewer').getAttribute('src'), null);
  await type(page, 'password', ownerPass);
  await button(page, 'Desbloquear').click();
  await active(page);
  if (process.env.WORKMATE_SHOTS) await page.screenshot({ path: path.join(scratch, 'movil.png') });
});

test('Chrome · edición, drag and drop, deshacer, rehacer, guardado y restauración validada', async t => {
  const { page } = await context(t);
  await setup(page);
  await config(page);
  const original = await download(page, 'Exportar copia');
  await close(page);
  await edit(page);
  await createCategory(page, 'Auditoría');
  await option(page, 'CSV MATCH').click();
  await button(page, 'Editar datos').click();
  await type(dialog(page), 'name', 'CSV MATCH QA');
  await type(dialog(page), 'description', '<script>window.injected=true</script>');
  await dialog(page).locator('[name=image]').setInputFiles({ name: 'icono.svg', mimeType: 'image/svg+xml',
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="#0865db"/></svg>') });
  await button(page, 'Preparar cambios').click();
  await hidden(dialog(page));
  await sidebar(page).getByRole('button', { name: 'CSV MATCH QA', exact: true }).locator('..').dragTo(
    sidebar(page).getByRole('button', { name: 'Auditoría', exact: true }).locator('..'), { targetPosition: { x: 60, y: 20 } });
  await shown(sidebar(page).getByText('Auditoría', { exact: true }));
  await button(page, 'Deshacer').click();
  await button(page, 'Rehacer').click();
  const saved = await applyAndSave(page);
  assert.equal(saved.tools[0].parent, saved.categories.find(item => item.name === 'Auditoría').id);
  assert.equal(saved.tools[0].description, '<script>window.injected=true</script>');
  assert.match(saved.tools[0].icon, /^data:image\/png;base64,/);
  assert.equal(await page.evaluate(() => window.injected), undefined);
  await page.reload();
  await login(page, 'Admin', ownerPass, 'propietaria');
  await shown(button(sidebar(page), 'CSV MATCH QA'));
  await edit(page);
  await config(page);
  await choose(page, 'Restaurar copia', original.path);
  await shown(page.getByRole('heading', { name: 'Restaurar configuración' }));
  await button(page, 'Confirmar restauración').click();
  const restored = await applyAndSave(page);
  assert.equal(restored.tools[0].name, 'CSV MATCH');
  assert.equal(restored.categories.length, 2);
  assert.equal(restored.audit.at(-1).action, 'Restaurar copia');
  await createCategory(page, 'Descartar QA');
  await button(page, 'Descartar').click();
  assert.equal(await sidebar(page).getByText('Descartar QA', { exact: true }).count(), 0);
});

test('Chrome · cuentas individuales, gestor limitado, vínculo externo y ocultación personal', async t => {
  const { page } = await context(t);
  await setup(page);
  await edit(page);
  await button(page, 'Cuentas y permisos').click();
  await createAccount(page, 'Gestora QA', 'gestora', managerPass);
  await button(page, 'Permisos').click();
  await dialog(page).getByLabel('Regla: Deshabilitar herramientas', { exact: true }).selectOption('deny');
  await button(page, 'Preparar permisos').click();
  await close(page);
  await applyAndSave(page);
  await button(page, 'Cerrar sesión').click();
  await login(page, 'Gestor', managerPass, 'gestora');
  await edit(page);
  await option(page, 'CSV MATCH').click();
  assert.equal(await button(page, 'Editar datos').count(), 0);
  await close(page);
  await createCategory(page, 'Equipo QA', { scope: 'team' });
  await createLink(page, 'Excel QA', { scope: 'team', parent: 'Equipo QA' });
  await button(page, 'Cuentas y permisos').click();
  await createAccount(page, 'Usuaria QA', 'usuaria', userPass);
  await button(page, 'Permisos').click();
  assert.equal(await dialog(page).getByLabel('Regla: Crear herramientas', { exact: true })
    .locator('option[value=allow]').isDisabled(), true);
  await close(page);
  await applyAndSave(page);
  await button(page, 'Cerrar sesión').click();
  await login(page, 'Usuario', userPass, 'usuaria');
  await button(sidebar(page), 'Excel QA').click();
  await shown(dialog(page).getByText('Estado del destino · No verificable'));
  assert.equal(await page.locator('#viewer').getAttribute('src'), null);
  const link = dialog(page).getByRole('link', { name: 'Intentar apertura' });
  assert.equal(await link.getAttribute('href'), 'file:///C:/Temp/Plan%20%231.xlsx');
  assert.equal(await link.getAttribute('rel'), 'noopener noreferrer');
  await shown(button(page, 'Copiar destino'));
  await close(page);
  await edit(page);
  assert.equal(await button(page, 'Cuentas y permisos').count(), 0);
  await option(page, 'CSV MATCH').click();
  await button(page, 'Ocultar para mí').click();
  assert.equal(await button(sidebar(page), 'CSV MATCH').count(), 0);
  await button(page, 'Herramientas ocultas').click();
  await option(page, 'CSV MATCH').click();
  await button(page, 'Recuperar para mí').click();
  await button(page, 'Catálogo').click();
  await shown(button(sidebar(page), 'CSV MATCH'));
  await applyAndSave(page);
  await button(page, 'Cerrar sesión').click();
  await login(page, 'Admin', ownerPass, 'propietaria');
  await edit(page);
  await option(page, 'CSV MATCH').click();
  await button(page, 'Deshabilitar').click();
  await applyAndSave(page);
  await button(page, 'Cerrar sesión').click();
  await login(page, 'Usuario', userPass, 'usuaria');
  await page.getByRole('searchbox').fill('CSV MATCH');
  await shown(sidebar(page).getByText('Resultados · 0'));
  assert.equal(await page.locator('#viewer').getAttribute('src'), null);
});

test('Chrome · rechazo de JSON corrupto, SVG activo y copia de guardado distinta', async t => {
  const { page } = await context(t);
  const initial = await setup(page);
  await edit(page);
  await button(page, 'Herramienta').click();
  await type(dialog(page), 'name', 'SVG inseguro');
  await type(dialog(page), 'target', './prueba.html');
  await dialog(page).locator('[name=image]').setInputFiles({ name: 'imagen.svg', mimeType: 'image/svg+xml',
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>') });
  await button(page, 'Crear herramienta').click();
  await shown(dialog(page).getByRole('alert').getByText(/sin código/));
  await close(page);
  await config(page);
  await choose(page, 'Restaurar copia', { name: 'corrupto.json', mimeType: 'application/json', buffer: Buffer.from('{') });
  await shown(page.getByText('El archivo no contiene JSON válido.'));
  await close(page);
  await createCategory(page, 'No perder');
  await button(page, 'Guardar').click();
  await download(page, 'Descargar JSON');
  await choose(page, 'Seleccionar copia descargada', { name: 'otro.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(initial)) });
  await shown(page.getByText('El archivo seleccionado no coincide con la exportación pendiente.'));
  await button(page, 'Volver').click();
  await shown(sidebar(page).getByText('No perder'));
  await shown(page.getByText(/Borrador · pendiente/));
});

test('Chrome · ensayo de capacidades reales file:// y ausencia de salida de red', async t => {
  const { page, ctx } = await context(t);
  const network = [];
  ctx.on('request', request => { if (/^https?:/.test(request.url())) network.push(request.url()); });
  await setup(page);
  const capabilities = await page.evaluate(async () => {
    let opfs;
    try { await navigator.storage.getDirectory(); opfs = true; }
    catch (error) { opfs = error.name; }
    return { protocol: location.protocol, secure: isSecureContext, crypto: !!crypto.subtle,
      indexedDB: !!indexedDB, filePicker: typeof showSaveFilePicker, opfs };
  });
  assert.equal(capabilities.protocol, 'file:');
  assert.equal(capabilities.crypto, true);
  assert.deepEqual(network, []);
  t.diagnostic(JSON.stringify(capabilities));
  await page.evaluate(() => {
    const control = document.createElement('button');
    control.textContent = 'Sondear selector nativo';
    control.addEventListener('click', async () => {
      try {
        await WorkMateStorage.selectSave();
        control.dataset.outcome = 'seleccionado';
      } catch (error) { control.dataset.outcome = error.name; }
    });
    document.querySelector('#landing').prepend(control);
  });
  const probe = button(page, 'Sondear selector nativo');
  await probe.click();
  let outcome;
  try { await page.waitForFunction(() => document.querySelector('[data-outcome]'), undefined, { timeout: 3000 });
    outcome = await probe.getAttribute('data-outcome'); }
  catch (error) { if (error.name !== 'TimeoutError') throw error; outcome = 'sin selección nativa en Chrome sin interfaz'; }
  await probe.evaluate(node => node.remove());
  t.diagnostic('Selector nativo en Chrome sin interfaz: ' + outcome);
  if (csvInstalled) {
    const css = await fs.readFile(path.join(path.dirname(path.resolve(root, M.csvPath)), 'css', 'styles.css'));
    t.diagnostic('CSS CSV MATCH SHA-256 ' + createHash('sha256').update(css).digest('hex'));
  }
  if (process.env.WORKMATE_SHOTS) await page.screenshot({ path: path.join(scratch, 'portal.png') });
});

test('Chrome · destino local real en otra pestaña y cambio entre herramientas en un único iframe', async t => {
  const { page, ctx } = await context(t);
  const fixture = await fs.mkdtemp(path.join(scratch, 'destino-'));
  const document = path.join(fixture, 'prueba.txt');
  const html = path.join(fixture, 'visor.html');
  t.after(async () => {
    await fs.unlink(document).catch(() => {});
    await fs.unlink(html).catch(() => {});
    await fs.rmdir(fixture).catch(() => {});
  });
  await fs.writeFile(document, 'Contenido de prueba de apertura local');
  await fs.writeFile(html, '<!doctype html><title>Visor QA</title><h1>Segunda herramienta QA</h1><div style="height:1800px"></div>');
  await setup(page);
  await edit(page);
  await createLink(page, 'Documento real', { target: document });
  await createLink(page, 'Segundo visor', { typeName: 'html', target: './' + path.relative(root, html).replaceAll('\\', '/') });
  await createLink(page, 'Archivo ausente', { typeName: 'html',
    target: './' + path.relative(root, path.join(fixture, 'ausente.html')).replaceAll('\\', '/') });
  await button(page, 'Aplicar').click();
  if (csvInstalled) {
    await button(sidebar(page), 'CSV MATCH').click();
    await shown(page.frameLocator('#viewer').getByRole('heading', { name: 'CSV MATCH' }));
  }
  await button(sidebar(page), 'Segundo visor').click();
  const second = page.frameLocator('#viewer');
  await shown(second.getByRole('heading', { name: 'Segunda herramienta QA' }));
  assert.ok(await second.locator('html').evaluate(node => { window.scrollTo(0, 400); return node.scrollTop; }));
  assert.equal(await page.evaluate(() => document.scrollingElement.scrollTop), 0);
  await divider(page).press('Shift+ArrowRight');
  await geometry(page, { width: 334, frame: true });
  await button(sidebar(page), 'Documento real').click();
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  await button(dialog(page), 'Copiar destino').click();
  await shown(page.getByText('Destino copiado.', { exact: true }));
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), document);
  const [external] = await Promise.all([ctx.waitForEvent('page'),
    dialog(page).getByRole('link', { name: 'Intentar apertura' }).click()]);
  await shown(external.getByText('Contenido de prueba de apertura local'));
  assert.equal(await page.locator('iframe').count(), 1);
  await shown(page.frameLocator('#viewer').getByRole('heading', { name: 'Segunda herramienta QA' }));
  await external.close();
  await close(page);
  const failed = page.waitForEvent('requestfailed', request => request.url().endsWith('/ausente.html'));
  await button(sidebar(page), 'Archivo ausente').click();
  assert.equal((await failed).failure().errorText, 'net::ERR_FILE_NOT_FOUND');
  await geometry(page, { width: 334, frame: true });
  await button(page, 'Inicio').click();
  await hidden(page.locator('#viewer'));
  await button(page, 'Descartar').click();
});

test('Chrome · recuperación explícita con archivo real y acceso con nueva contraseña', async t => {
  const { page } = await context(t);
  await setup(page);
  await config(page);
  const original = await download(page, 'Exportar copia');
  await close(page);
  await button(page, 'Cerrar sesión').click();
  await button(page, 'Recuperación del propietario').click();
  await choose(page, 'Seleccionar copia JSON', original.path);
  const nextPass = randomUUID();
  await type(dialog(page), 'password', nextPass);
  await type(dialog(page), 'repeat', nextPass);
  await button(page, 'Preparar copia recuperada').click();
  const saved = await download(page, 'Descargar JSON');
  await choose(page, 'Seleccionar copia descargada', saved.path);
  await hidden(dialog(page));
  await login(page, 'Admin', nextPass, 'propietaria');
  assert.equal(JSON.parse(await fs.readFile(saved.path, 'utf8')).audit.at(-1).action, 'Recuperación local');
});

const divider = page => page.getByRole('separator', { name: 'Ancho del menú' });

async function geometry(page, { width, collapsed = false, mobile = false, frame = false } = {}) {
  const boxes = await page.evaluate(() => {
    const box = id => {
      const { x, y, width, height, right, bottom } = document.getElementById(id).getBoundingClientRect();
      return { x, y, width, height, right, bottom };
    };
    const portal = document.querySelector('#portal');
    return { portal: box('portal'), sidebar: box('sidebar'), workspace: box('workspace'), iframe: box('viewer'),
      divider: box('menu-divider'), track: getComputedStyle(portal).gridTemplateColumns,
      width: portal.style.getPropertyValue('--menu-width'), screenWidth: innerWidth, screenHeight: innerHeight,
      scrollWidth: document.documentElement.scrollWidth };
  });
  assert.equal(boxes.portal.height, boxes.screenHeight);
  assert.equal(boxes.portal.width, boxes.screenWidth);
  assert.equal(boxes.scrollWidth, boxes.screenWidth);
  assert.match(boxes.width, /^\d+px$/);
  assert.equal(boxes.sidebar.y, boxes.workspace.y);
  assert.equal(boxes.sidebar.bottom, boxes.workspace.bottom);
  assert.equal(boxes.workspace.right, boxes.portal.right - 1);
  assert.equal(boxes.divider.width, collapsed || mobile ? 0 : 12);
  if (collapsed) assert.equal(boxes.sidebar.width, 55);
  if (width !== undefined) {
    assert.equal(boxes.sidebar.width, width);
    assert.equal(boxes.width, width + 'px');
  }
  if (!mobile || collapsed) assert.equal(boxes.workspace.x, boxes.sidebar.right + boxes.divider.width);
  assert.equal(boxes.track.split(' ').length, 3);
  if (frame) {
    assert.equal(boxes.iframe.x, boxes.workspace.x);
    assert.equal(boxes.iframe.width, boxes.workspace.width);
    assert.ok(boxes.iframe.height > 150);
  }
  return boxes;
}

async function auditShot(page, name) {
  if (process.env.WORKMATE_SHOTS) await page.screenshot({ path: path.join(scratch, 'layout-' + name + '.png'),
    style: '#notice { visibility: hidden; }' });
}

test('Chrome · divisor real, captura, teclado, límites, modales, iframe y geometría responsive', async t => {
  const { page } = await context(t, { viewport: { width: 1440, height: 900 } });
  await setup(page, csvInstalled);
  const title = csvInstalled ? 'CSV MATCH' : 'Visor de prueba';
  if (!csvInstalled) {
    const folder = await fs.mkdtemp(path.join(scratch, 'visor-'));
    const html = path.join(folder, 'index.html');
    t.after(async () => { await fs.unlink(html); await fs.rmdir(folder); });
    await fs.writeFile(html, '<!doctype html><meta charset="utf-8"><h1>Visor de prueba</h1>');
    await edit(page);
    await createLink(page, title, { typeName: 'html', target: './' + path.relative(root, html).replaceAll('\\', '/') });
    await applyAndSave(page);
    await button(page, 'Salir de edición').click();
  }
  await button(sidebar(page), title).click();
  await shown(page.frameLocator('#viewer').getByRole('heading', { name: title }));
  const initial = await geometry(page, { width: 302, frame: true });
  const x = initial.divider.x + 6;
  const y = initial.divider.y + initial.divider.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 116, y, { steps: 5 });
  await geometry(page, { width: 418, frame: true });
  assert.equal(await page.locator('#viewer').evaluate(node => getComputedStyle(node).pointerEvents), 'none');
  assert.equal(await page.locator('#portal').evaluate(node => getComputedStyle(node).userSelect), 'none');
  await page.mouse.move(x - 62, y, { steps: 5 });
  await geometry(page, { width: 240, frame: true });
  await page.mouse.up();
  assert.equal(await page.locator('#viewer').evaluate(node => getComputedStyle(node).pointerEvents), 'auto');
  await geometry(page, { width: 240, frame: true });

  const grip = divider(page);
  await grip.press('ArrowRight');
  await geometry(page, { width: 248, frame: true });
  await grip.press('Shift+ArrowRight');
  await geometry(page, { width: 280, frame: true });
  await grip.press('Home');
  await geometry(page, { width: 200, frame: true });
  await grip.press('End');
  await geometry(page, { width: 560, frame: true });
  await grip.press('ArrowLeft');
  await grip.press('Shift+ArrowLeft');
  await geometry(page, { width: 520, frame: true });

  // Escape abandona un arrastre sin cambiar la preferencia.
  const handle = await grip.boundingBox();
  await page.mouse.move(handle.x + 6, y);
  await page.mouse.down();
  await page.mouse.move(handle.x - 64, y);
  await geometry(page, { width: 450, frame: true });
  await grip.press('Escape');
  await page.mouse.up();
  await geometry(page, { width: 520, frame: true });
  const handleState = await grip.evaluate(node => {
    node.addEventListener('gotpointercapture', event => {
      node.dataset.captured = String(event.pointerId);
    }, { once: true });
    return getComputedStyle(node).cursor;
  });
  assert.equal(handleState, 'col-resize');
  await page.mouse.move(handle.x + 6, y);
  await page.mouse.down();
  await page.mouse.move(handle.x - 24, y);
  const pointer = await grip.getAttribute('data-captured');
  assert.ok(pointer);
  await grip.evaluate((node, id) => node.releasePointerCapture(Number(id)), pointer);
  await page.mouse.move(handle.x - 30, y);
  await page.mouse.up();
  await geometry(page, { width: 520, frame: true });
  await page.mouse.move(handle.x + 6, y);
  await page.mouse.down();
  await page.mouse.move(handle.x - 24, y);
  await grip.evaluate((node, id) => node.dispatchEvent(new PointerEvent('pointercancel', { pointerId: Number(id) })), pointer);
  await page.mouse.up();
  await geometry(page, { width: 520, frame: true });

  const beforeModal = await geometry(page, { width: 520, frame: true });
  await config(page);
  assert.equal(await dialog(page).locator('input[type=range], output').count(), 0);
  assert.deepEqual(await geometry(page, { width: 520, frame: true }), beforeModal);
  await close(page);
  assert.deepEqual(await geometry(page, { width: 520, frame: true }), beforeModal);
  await auditShot(page, '1440x900');
  await button(page, 'Contraer menú').click();
  await geometry(page, { collapsed: true, frame: true });
  assert.equal(await page.locator('.sidebar .expanded:visible').count(), 0);
  await button(page, 'Expandir menú').click();
  await geometry(page, { width: 520, frame: true });
  await page.setViewportSize({ width: 1024, height: 720 });
  await geometry(page, { width: 520, frame: true });
  await auditShot(page, '1024x720');
  await page.setViewportSize({ width: 640, height: 640 });
  await page.waitForFunction(() => document.querySelector('#menu-divider').getAttribute('aria-valuemax') === '346');
  await geometry(page, { width: 346, frame: true });
  await auditShot(page, '640x640');
  await page.setViewportSize({ width: 390, height: 780 });
  await hidden(grip);
  await geometry(page, { mobile: true, frame: true });
  await auditShot(page, '390x780-menu');
  await button(page, 'Contraer menú').click();
  await geometry(page, { mobile: true, collapsed: true, frame: true });
  await auditShot(page, '390x780-visor');
  await page.setViewportSize({ width: 1440, height: 900 });
  await button(page, 'Expandir menú').click();
  await geometry(page, { width: 520, frame: true });
});

test('Chrome · cada perfil conserva ancho y contracción tras guardados de otras cuentas y recarga', async t => {
  const { page } = await context(t);
  await setup(page);
  await edit(page);
  await button(page, 'Cuentas y permisos').click();
  await createAccount(page, 'Gestora QA', 'gestora', managerPass);
  await close(page);
  await applyAndSave(page);
  await divider(page).press('End');
  await divider(page).press('Shift+ArrowLeft');
  await geometry(page, { width: 528 });
  await button(page, 'Contraer menú').click();
  await button(page, 'Cerrar sesión').click();

  await login(page, 'Gestor', managerPass, 'gestora');
  await geometry(page, { width: 302 });
  await edit(page);
  await config(page);
  assert.equal(await button(dialog(page), 'Ajustes generales').count(), 0);
  await close(page);
  await divider(page).press('Shift+ArrowRight');
  await geometry(page, { width: 334 });
  await button(page, 'Cuentas y permisos').click();
  await createAccount(page, 'Usuaria QA', 'usuaria', userPass);
  await close(page);
  const managerSaved = await applyAndSave(page);
  assert.equal(managerSaved.preferences[managerSaved.owner].width, 528);
  assert.equal(managerSaved.preferences[managerSaved.owner].collapsed, true);
  await button(page, 'Cerrar sesión').click();

  await login(page, 'Usuario', userPass, 'usuaria');
  await geometry(page, { width: 302 });
  await divider(page).press('Home');
  await divider(page).press('ArrowRight');
  await button(page, 'Contraer menú').click();
  await config(page);
  await button(page, 'Guardar preferencias en el JSON').click();
  const userSaved = await verifySave(page);
  const preferences = login => userSaved.preferences[userSaved.accounts.find(item => item.login === login).id];
  assert.equal(preferences('usuaria').width, 208);
  assert.equal(preferences('usuaria').collapsed, true);
  assert.equal(preferences('gestora').width, 334);
  assert.equal(preferences('propietaria').width, 528);
  assert.deepEqual(userSaved.tools, managerSaved.tools);
  assert.deepEqual(userSaved.categories, managerSaved.categories);
  await page.reload();
  await login(page, 'Admin', ownerPass, 'propietaria');
  await geometry(page, { collapsed: true });
  await button(page, 'Expandir menú').click();
  await geometry(page, { width: 528 });
  await button(page, 'Cerrar sesión').click();
  await login(page, 'Usuario', userPass, 'usuaria');
  await geometry(page, { collapsed: true });
  await button(page, 'Expandir menú').click();
  await geometry(page, { width: 208 });
});

test('Chrome · importa un catálogo multinivel, mantiene cuentas y permite cancelar un cierre con borrador', async t => {
  const { page } = await context(t, { viewport: { width: 1024, height: 480 } });
  const initial = await setup(page);
  let fixture = M.createCatalog('Origen sintético', 'origen', initial.accounts[0].password, true);
  const category = (name, parent) => ({ name, parent, description: '', icon: 'folder', scope: 'global' });
  for (let i = 1; i <= 15; i++) fixture = M.change(fixture, fixture.owner, {
    kind: 'c', action: 'create', fields: category('Carpeta QA ' + i, null)
  });
  fixture = M.change(fixture, fixture.owner, { kind: 'c', action: 'create',
    fields: category('Subnivel QA', fixture.categories.find(item => item.name === 'Buscar y comparar').id) });
  await edit(page);
  await config(page);
  await button(dialog(page), 'Ajustes generales').click();
  await shown(button(dialog(page), 'Aplicar'));
  await close(page);
  await config(page);
  await choose(page, 'Importar catálogo', { name: 'catalogo-sintetico.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(fixture)) });
  await button(page, 'Confirmar importación').click();
  await shown(button(sidebar(page), 'Subnivel QA'));
  await button(sidebar(page), 'Subnivel QA').click();
  const scrolled = await sidebar(page).evaluate(node => {
    node.scrollTop = node.scrollHeight;
    return node.scrollTop > 0 && document.scrollingElement.scrollTop === 0;
  });
  assert.equal(scrolled, true);
  page.removeAllListeners('dialog');
  page.once('dialog', confirmation => confirmation.dismiss());
  await button(page, 'Cerrar sesión').click();
  await active(page);
  await shown(button(sidebar(page), 'Carpeta QA 15'));
  const saved = await applyAndSave(page);
  assert.deepEqual(saved.accounts, initial.accounts);
  assert.equal(saved.categories.length, 18);
  assert.ok(saved.tools.every(item => item.owner === initial.owner && item.creator === initial.owner));
  await page.reload();
  await login(page, 'Admin', ownerPass, 'propietaria');
  await shown(button(sidebar(page), 'Subnivel QA'));
  await geometry(page, { width: 302 });
});
