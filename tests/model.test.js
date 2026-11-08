'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const M = require('../js/model');

const secret = crypto.randomUUID();
const pass = M.passwordHash(secret, 600_000);
const newDB = async (csv = true) => M.createCatalog('Propietaria', 'owner', await pass, csv);
const last = list => list.at(-1);
const category = (name, parent = null, scope = 'global') => ({ name, parent, scope, icon: 'folder', description: '' });
const tool = (name, parent = null, scope = 'global') => ({ name, parent, scope, icon: 'file', description: '',
  type: 'document', target: 'D:\\Datos\\Hoja #1.xlsx', keywords: 'datos' });
const create = (db, actor, kind, fields) => M.change(db, actor, { kind, action: 'create', fields });
const move = (db, actor, kind, id, parent, before = null) => M.change(db, actor, { kind, action: 'move', id, parent, before });
const account = async (db, actor, name, role, parent) => M.change(db, actor, { action: 'accountCreate',
  fields: { name, login: name.toLowerCase(), role, parent, password: await pass } });
const policy = (db, actor, id, key, mode, delegate = false) => M.change(db, actor, { action: 'accountPolicy', id,
  fields: { key, mode, delegate } });
const restriction = (db, actor, id, resource, deny = true) => M.change(db, actor, { action: 'accountRestriction', id,
  fields: { resource, deny } });
async function team() {
  let db = await newDB();
  db = await account(db, db.owner, 'Gestora', 'manager', db.owner);
  const manager = last(db.accounts).id;
  db = await account(db, manager, 'Trabajadora', 'user', manager);
  return { db, manager, user: last(db.accounts).id, owner: db.owner, csv: db.tools[0] };
}

test('crea, edita y elimina manteniendo identidad y referencias', async () => {
  let db = await newDB();
  db = create(db, db.owner, 't', tool('Enlace', db.categories[1].id));
  const id = last(db.tools).id;
  db = M.change(db, db.owner, { kind: 't', action: 'edit', id, fields: { ...last(db.tools), name: '<b>Texto</b>', icon: 'link' } });
  assert.equal(last(db.tools).id, id);
  assert.equal(last(db.tools).name, '<b>Texto</b>');
  db = M.preference(db, db.owner, 'favorite', id);
  db = M.preference(db, db.owner, 'opened', id);
  db = M.change(db, db.owner, { kind: 't', action: 'delete', id });
  assert.equal(db.tools.length, 1);
  assert.deepEqual(db.preferences[db.owner].favorites, []);
  assert.deepEqual(db.preferences[db.owner].recent, []);
});

test('mueve árboles y herramientas, rechaza ciclos y conserva orden tras serializar', async () => {
  let db = await newDB();
  const [a, b] = db.categories;
  db = create(db, db.owner, 'c', category('Subcategoría', a.id));
  const child = last(db.categories).id;
  db = create(db, db.owner, 'c', category('Nieta', child));
  const leaf = last(db.categories).id;
  assert.throws(() => move(db, db.owner, 'c', a.id, leaf), /permiso/);
  db = move(db, db.owner, 'c', child, b.id);
  db = move(db, db.owner, 'c', b.id, null, a.id);
  db = move(db, db.owner, 't', db.tools[0].id, leaf);
  const copy = M.parse(JSON.stringify(db));
  assert.deepEqual(M.members(copy.categories, null).map(item => item.id), [b.id, a.id]);
  assert.equal(copy.tools[0].parent, leaf);
});

test('elimina categorías de forma atómica y reubica hijos directos', async () => {
  let db = await newDB();
  const parent = db.categories[0].id;
  db = create(db, db.owner, 'c', category('Hija', parent));
  const child = last(db.categories).id;
  const remove = destination => M.change(db, db.owner, { kind: 'c', action: 'delete', id: parent, parent: destination });
  assert.throws(() => remove(child), /permiso/);
  assert.equal(db.tools[0].parent, parent);
  const next = remove(null);
  assert.equal(M.get(next.categories, child).parent, null);
  assert.equal(next.tools[0].parent, null);
});

test('ocultación personal y global conservan categoría y orden', async () => {
  const { db, csv, user, owner } = await team();
  let draft = M.change(db, user, { action: 'personalHidden', id: csv.id, value: true });
  assert.deepEqual(draft.preferences[user].hidden, [csv.id]);
  assert.deepEqual(draft.preferences[owner].hidden, []);
  draft = M.change(draft, user, { action: 'personalHidden', id: csv.id, value: false });
  assert.deepEqual(draft.preferences[user].hidden, []);
  assert.deepEqual(draft.tools[0], csv);
  draft = M.change(draft, owner, { kind: 't', action: 'visible', id: csv.id, value: false });
  assert.equal(M.context(draft, user).see(draft.tools[0], 't'), false);
  assert.equal(M.context(draft, owner).see(draft.tools[0], 't', true, true), true);
  draft = M.change(draft, owner, { kind: 't', action: 'visible', id: csv.id, value: true });
  assert.equal(draft.tools[0].order, csv.order);
});

test('deshabilitar bloquea apertura y limpia recientes de todos los afectados', async () => {
  const { db, csv, user, owner } = await team();
  let draft = M.preference(db, user, 'opened', csv.id);
  draft = M.preference(draft, user, 'opened', csv.id);
  assert.deepEqual(draft.preferences[user].recent, [csv.id]);
  draft = M.change(draft, owner, { kind: 't', action: 'enabled', id: csv.id, value: false });
  assert.equal(M.context(draft, user).open(draft.tools[0]), false);
  assert.deepEqual(draft.preferences[user].recent, []);
  assert.throws(() => M.preference(draft, user, 'opened', csv.id), /permiso/);
  assert.throws(() => M.change(draft, user, { kind: 't', action: 'enabled', id: csv.id, value: true }), /permiso/);
});

test('autenticación con sal individual, contraseña incorrecta y cuenta deshabilitada', async () => {
  const { db, user, manager } = await team();
  assert.equal(await M.authenticate(db, 'user', 'TRABAJADORA', secret), user);
  await assert.rejects(M.authenticate(db, 'user', 'trabajadora', 'incorrecta'), /no es correcta/);
  await assert.rejects(M.authenticate(db, 'admin', 'trabajadora', secret), /no está disponible/);
  const different = await M.passwordHash(secret, 600_000);
  assert.notEqual(different.salt, (await pass).salt);
  assert.notEqual(different.hash, (await pass).hash);
  const disabled = M.change(db, manager, { action: 'accountEnabled', id: user, value: false });
  await assert.rejects(M.authenticate(disabled, 'user', 'trabajadora', secret), /no está disponible/);
});

test('gestor crea recursos de equipo sin poder modificar el catálogo ajeno', async () => {
  const { db, manager, user, csv } = await team();
  let draft = create(db, manager, 'c', category('Equipo', null, 'team'));
  draft = create(draft, manager, 't', tool('Hoja', last(draft.categories).id, 'team'));
  assert.equal(M.context(draft, user).open(last(draft.tools)), true);
  assert.throws(() => create(draft, manager, 't', tool('Global')), /permiso/);
  assert.throws(() => M.change(draft, manager, { kind: 't', action: 'edit', id: csv.id, fields: { ...csv, name: 'Cambio' } }), /permiso/);
  assert.throws(() => M.change(draft, user, { action: 'accountEdit', id: user, fields: { role: 'admin' } }), /permiso/);
});

test('denegación y falta de delegación cortan la cadena', async () => {
  const { db, manager, user, owner } = await team();
  assert.equal(M.rights(db, user)['t.open'].allowed, true);
  const restricted = policy(db, owner, manager, 't.open', 'allow', false);
  assert.equal(M.rights(restricted, manager)['t.open'].allowed, true);
  assert.equal(M.rights(restricted, user)['t.open'].allowed, false);
  assert.throws(() => policy(restricted, manager, user, 't.open', 'inherit'), /permiso/);
  const denied = policy(db, owner, manager, 't.open', 'deny');
  assert.equal(M.rights(denied, user)['t.open'].allowed, false);
  assert.equal(M.rights(denied, user)['t.open'].reason, 'Restringido por Gestora');
  assert.throws(() => policy(db, manager, manager, 't.open', 'allow', true), /permiso/);
});

test('reglas directas impuestas por Admin no se pueden levantar desde Gestor', async () => {
  const { db, manager, user, owner, csv } = await team();
  let draft = policy(db, owner, user, 't.open', 'deny');
  assert.throws(() => policy(draft, manager, user, 't.open', 'allow'), /permiso/);
  draft = restriction(db, owner, user, csv.id);
  assert.equal(M.context(draft, user).see(csv, 't'), false);
  assert.throws(() => restriction(draft, manager, user, csv.id, false), /permiso/);
  assert.equal(M.context(restriction(draft, owner, user, csv.id, false), user).open(csv), true);
});

test('restricciones sobre categorías se heredan y filtran herramientas', async () => {
  const { db, manager, user, owner, csv } = await team();
  const restricted = restriction(db, owner, manager, csv.parent);
  assert.equal(M.context(restricted, user).see(csv, 't'), false);
  assert.equal(M.context(restricted, user).open(csv), false);
  assert.throws(() => restriction(restricted, manager, user, csv.parent, false), /permiso/);
});

test('no se puede eludir una restricción superior moviendo una herramienta ni su subárbol', async () => {
  const { db, manager, user, owner } = await team();
  let next = create(db, manager, 'c', category('Raíz de equipo', null, 'team'));
  const root = last(next.categories).id;
  next = create(next, manager, 'c', category('Subcarpeta', root, 'team'));
  const child = last(next.categories).id;
  next = create(next, manager, 't', tool('Herramienta de equipo', child, 'team'));
  const resource = last(next.tools);
  assert.equal(M.context(next, user).open(resource), true);
  next = restriction(next, owner, user, root);
  assert.equal(M.context(next, user).open(resource), false);
  assert.throws(() => move(next, manager, 't', resource.id, null), /permiso/);
  assert.throws(() => move(next, manager, 'c', child, null), /permiso/);
  assert.throws(() => M.change(next, manager, { kind: 'c', action: 'delete', id: root, parent: null }), /permiso/);
  assert.equal(M.context(move(next, owner, 'c', child, null), user).open(resource), true);
});

test('una categoría propia no da control sobre recursos globales alojados en ella', async () => {
  const { db, manager, owner, csv } = await team();
  let next = create(db, manager, 'c', category('Carpeta de equipo', null, 'team'));
  const parent = last(next.categories);
  next = move(next, owner, 't', csv.id, parent.id);
  assert.throws(() => M.change(next, manager, { kind: 'c', action: 'visible', id: parent.id, value: false }), /permiso/);
  assert.throws(() => M.change(next, manager, { kind: 'c', action: 'edit', id: parent.id,
    fields: { ...parent, scope: 'personal' } }), /permiso/);
  assert.throws(() => move(next, manager, 'c', parent.id, db.categories[1].id), /permiso/);
  const renamed = M.change(next, manager, { kind: 'c', action: 'edit', id: parent.id, fields: { ...parent, name: 'Renombrada' } });
  assert.equal(last(renamed.categories).name, 'Renombrada');
});

test('rechaza comandos de cuenta y de catálogo forjados fuera del ámbito autorizado', async () => {
  const { db, manager, user, owner, csv } = await team();
  let next = await account(db, owner, 'OtraGestora', 'manager', owner);
  const other = last(next.accounts).id;
  next = await account(next, other, 'OtroUsuario', 'user', other);
  const target = last(next.accounts).id;
  const attacks = [
    [manager, { action: 'accountPassword', id: target, fields: { password: await pass } }],
    [manager, { action: 'accountEnabled', id: other, value: false }],
    [manager, { action: 'accountEdit', id: user, fields: { name: 'Elevada', login: 'trabajadora', role: 'manager', parent: owner } }],
    [manager, { action: 'accountPolicy', id: manager, fields: { key: 'u.parent', mode: 'allow', delegate: true } }],
    [manager, { action: 'accountPolicy', id: user, fields: { key: 't.create', mode: 'allow', delegate: true } }],
    [manager, { kind: 't', action: 'delete', id: csv.id }],
    [user, { action: 'settings', fields: { ...next.settings, idle: 240 } }]
  ];
  const snapshot = M.clone(next);
  for (const [actor, command] of attacks) assert.throws(() => M.change(next, actor, command), /permiso/);
  assert.deepEqual(next, snapshot);
});

test('anchos personales válidos nuevos y antiguos sobreviven al JSON sin tocar el catálogo', async () => {
  const { db, owner, manager, user } = await team();
  let next = M.preference(db, owner, 'width', 270);
  next = M.preference(next, manager, 'width', M.menuWidths.max);
  next = M.preference(next, user, 'width', M.menuWidths.min);
  next = M.preference(next, user, 'collapsed', true);
  assert.deepEqual(M.parse(JSON.stringify(next)).preferences, next.preferences);
  assert.deepEqual(next.tools, db.tools);
  assert.deepEqual(next.audit, db.audit);
  assert.throws(() => M.preference(next, user, 'width', M.menuWidths.max + 1), /preferencias/);
  assert.throws(() => M.preference(next, user, 'width', '273 px'), /preferencias/);
});

test('jerarquía válida, múltiples ámbitos administrativos y traslado sin escalada', async () => {
  const { db, manager, user, owner } = await team();
  let draft = await account(db, owner, 'Admin2', 'admin', null);
  const admin2 = last(draft.accounts).id;
  assert.equal(M.rights(draft, admin2)['s.global'].allowed, false);
  assert.equal(M.subordinate(draft, admin2, user), false);
  draft = await account(draft, owner, 'Gestora2', 'manager', owner);
  const manager2 = last(draft.accounts).id;
  draft = policy(draft, owner, manager, 't.open', 'deny');
  draft = M.change(draft, owner, { action: 'accountEdit', id: user,
    fields: { role: 'user', parent: manager2, name: 'Usuaria trasladada', login: 'trabajadora' } });
  assert.equal(M.rights(draft, user)['t.open'].allowed, false);
  assert.throws(() => M.change(db, owner, { action: 'accountEnabled', id: manager, value: false }), /primero/);
  assert.throws(() => M.change(db, owner, { action: 'accountEdit', id: manager,
    fields: { role: 'manager', parent: user, name: 'Gestora', login: 'gestora' } }), /jerárquica/);
});

test('deshacer, rehacer, aplicar, descartar y confirmar guardado', async () => {
  const db = await newDB();
  const history = new M.History(db);
  const edit = create(db, db.owner, 'c', category('Borrador'));
  history.push(edit);
  assert.equal(history.active, db);
  history.apply();
  assert.equal(history.active, edit);
  history.undo();
  assert.equal(history.draft, db);
  assert.equal(history.active, edit);
  history.redo();
  assert.equal(history.draft, edit);
  history.undo();
  history.push(create(db, db.owner, 'c', category('Otra rama')));
  assert.equal(history.redoStack.length, 0);
  history.discard();
  assert.equal(history.active, db);
  history.commit(M.parse(JSON.stringify(edit)));
  assert.equal(history.dirty, false);
  assert.equal(last(history.saved.categories).name, 'Borrador');
});

test('JSON estricto, migración v0 y corrupción sin sobreescritura', async () => {
  const db = await newDB();
  const roundtrip = M.parse(JSON.stringify(db));
  assert.deepEqual(roundtrip, db);
  const bad = (fn, pattern) => { const copy = M.clone(db); fn(copy); assert.throws(() => M.parse(JSON.stringify(copy)), pattern); };
  bad(copy => { copy.categories[1].id = copy.categories[0].id; }, /duplicados/);
  bad(copy => { copy.tools[0].parent = M.uid(); }, /referencias/);
  bad(copy => { copy.categories[0].parent = copy.categories[0].id; }, /ciclo/);
  bad(copy => { copy.accounts[0].rules['p.fake'] = { mode: 'allow', delegate: true, issuer: db.owner }; }, /permisos/);
  bad(copy => { copy.accounts[0].parent = copy.owner; }, /jerárquica/);
  bad(copy => { copy.version = 7; }, /versión/);
  bad(copy => { copy.tools[0].icon = 'data:image/svg+xml;base64,PHN2Zy8+'; }, /inválidos/);
  bad(copy => { copy.tools[0].target = 'javascript:alert(1)'; }, /ruta local/);
  assert.throws(() => M.parse('{'), /JSON válido/);
  const v0 = { ...db, version: 0 };
  delete v0.preferences;
  assert.equal(M.parse(JSON.stringify(v0)).preferences[db.owner].mode, 'list');
});

test('valida rutas relativas, absolutas, protocolos y esquemas peligrosos', () => {
  const base = 'file:///C:/carpeta%20portal/index.html';
  assert.equal(M.route('html', M.csvPath, base), 'file:///C:/carpeta%20portal/BUSCAR%20Y%20COMPARAR/CSV-MATCH/index.html');
  assert.equal(M.route('document', 'D:\\Datos\\Hoja #1.xlsx', base), 'file:///D:/Datos/Hoja%20%231.xlsx');
  assert.equal(M.route('folder', '\\\\equipo\\carpeta', base), 'file://equipo/carpeta');
  assert.equal(M.route('protocol', 'mailto:a@example.com'), 'mailto:a@example.com');
  assert.throws(() => M.route('html', './../privado.html'), /ruta relativa/);
  assert.throws(() => M.route('html', '//example.com/prueba.html'), /ruta local/);
  assert.throws(() => M.route('protocol', 'javascript:alert(1)'), /protocolo/);
  assert.throws(() => M.route('web', 'data:text/html,hola'), /HTTP/);
  assert.throws(() => M.route('web', 'https://usuario:secreto@example.com/'), /credenciales/);
});
