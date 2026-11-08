'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const M = require('../js/model');

const sandbox = { WorkMateModel: M };
vm.compileFunction(fs.readFileSync(require.resolve('../js/storage'), 'utf8'), [], {
  contextExtensions: [{ globalThis: sandbox, location: { href: 'file:///C:/WorkMate/index.html' } }]
})();
const S = sandbox.WorkMateStorage;
const catalog = M.passwordHash(crypto.randomUUID(), 600_000).then(password =>
  M.createCatalog('Propietaria', 'propietaria', password, true));

function fakeHandle(initial, { failedWrite, failedClose, mutate, mismatched } = {}) {
  let disk = initial;
  let pending;
  let writes = 0;
  let aborts = 0;
  const handle = {
    get disk() { return disk; },
    get writes() { return writes; },
    get aborts() { return aborts; },
    async getFile() { return new File([disk], 'config.json', { lastModified: 1000 }); },
    async createWritable(options) {
      assert.equal(options.mode, 'exclusive');
      if (mutate) disk = mutate;
      return {
        async write(raw) {
          writes++;
          pending = raw;
          if (failedWrite) throw new Error('Escritura interrumpida');
        },
        async close() {
          if (failedClose) throw new Error('Cierre fallido');
          disk = mismatched || pending;
        },
        async abort() { aborts++; pending = undefined; }
      };
    }
  };
  return handle;
}

test('el adaptador confirma al cerrar y releer el contenido exacto', async () => {
  const db = await catalog;
  const original = S.serialize(db);
  const handle = fakeHandle(original);
  const next = S.snapshot(db);
  const saved = await S.write(handle, next, original);
  assert.equal(saved.mode, 'direct');
  assert.equal(saved.raw, handle.disk);
  assert.equal(saved.db.revision, next.revision);
  assert.equal(handle.writes, 1);
  assert.equal(handle.aborts, 0);
});

test('rechaza cambios concurrentes antes de abrir el archivo y antes de escribir', async () => {
  const db = await catalog;
  const raw = S.serialize(db);
  const modified = S.serialize(S.snapshot(db));
  const next = S.snapshot(db);
  const alreadyChanged = fakeHandle(modified);
  await assert.rejects(S.write(alreadyChanged, next, raw), /cambió en disco/);
  assert.equal(alreadyChanged.writes, 0);
  const whilePreparing = fakeHandle(raw, { mutate: modified });
  await assert.rejects(S.write(whilePreparing, next, raw), /cambió mientras/);
  assert.equal(whilePreparing.writes, 0);
  assert.equal(whilePreparing.aborts, 1);
});

test('conserva el original cuando falla la escritura o el cierre', async () => {
  const db = await catalog;
  const raw = S.serialize(db);
  for (const mode of ['failedWrite', 'failedClose']) {
    const handle = fakeHandle(raw, { [mode]: true });
    await assert.rejects(S.write(handle, S.snapshot(db), raw), /interrumpida|fallido/);
    assert.equal(handle.aborts, 1);
    assert.equal(handle.disk, raw);
  }
});

test('rechaza sobreescrituras ajenas y canceladas y detecta relecturas incoherentes', async () => {
  const db = await catalog;
  const raw = S.serialize(db);
  const invalid = fakeHandle('Documento ajeno');
  await assert.rejects(S.write(invalid, db, undefined, () => true), /JSON válido/);
  assert.equal(invalid.writes, 0);
  const cancelled = fakeHandle(raw);
  await assert.rejects(S.write(cancelled, S.snapshot(db), undefined, () => false), /cancelado/);
  assert.equal(cancelled.disk, raw);
  const wrong = fakeHandle(raw, { mismatched: raw });
  await assert.rejects(S.write(wrong, S.snapshot(db), raw), /relectura/);
});

test('copia fechada se puede abrir y valida su envoltura', async () => {
  const db = await catalog;
  const raw = S.serialize(db, true);
  const backup = JSON.parse(raw);
  assert.equal(backup.schema, 'workmate.backup');
  assert.ok(Date.parse(backup.exported));
  assert.deepEqual(M.parse(raw), db);
  backup.exported = 'sin fecha';
  assert.throws(() => M.parse(JSON.stringify(backup)), /metadatos/);
});
