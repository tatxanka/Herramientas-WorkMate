(function (root) {
  'use strict';
  const M = root.WorkMateModel;
  const namespace = 'workmate.portal:' + location.href.split(/[?#]/)[0];
  const jsonTypes = [{ description: 'Configuración WorkMate (JSON)', accept: { 'application/json': ['.json'] } }];
  let database;

  function openStore() {
    database ||= new Promise((resolve, reject) => {
      const request = indexedDB.open(namespace, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('local');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }).catch(error => { database = null; throw error; });
    return database;
  }

  async function local(key, ...args) {
    const db = await openStore();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('local', args.length ? 'readwrite' : 'readonly');
      const store = tx.objectStore('local');
      const request = args.length ? (args[0] === null ? store.delete(key) : store.put(args[0], key)) : store.get(key);
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = () => reject(tx.error || new Error('El navegador canceló el almacenamiento.'));
    });
  }

  async function read(file) {
    M.check(file.size <= M.maxBytes, 'El JSON supera el límite de 8 MiB.');
    const bytes = await file.arrayBuffer();
    let raw;
    try { raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { throw new Error('El archivo no está codificado en UTF-8 válido.'); }
    return { raw, db: M.parse(raw), name: file.name };
  }

  function serialize(db, asBackup = false) {
    M.validate(db);
    const value = asBackup ? { schema: 'workmate.backup', version: 1, exported: M.stamp(), configuration: db } : db;
    const raw = JSON.stringify(value, null, 2) + '\n';
    M.check(new Blob([raw]).size <= M.maxBytes, 'La configuración supera 8 MiB. Reduce el tamaño de los iconos importados.');
    return raw;
  }

  function snapshot(db) {
    return { ...db, saved: M.stamp(), revision: M.uid() };
  }

  function download(raw, name) {
    const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' }));
    const link = Object.assign(document.createElement('a'), { href: url, download: name });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }

  async function selectOpen() {
    const [handle] = await showOpenFilePicker({ id: 'workmate-config', types: jsonTypes, multiple: false });
    const data = await read(await handle.getFile());
    return { ...data, handle, mode: 'direct' };
  }

  async function selectSave() {
    return showSaveFilePicker({ id: 'workmate-config', suggestedName: 'workmate-config.json', types: jsonTypes });
  }

  async function write(handle, db, expectedRaw, confirmExisting) {
    const raw = serialize(db);
    const old = await handle.getFile();
    M.check(old.size <= M.maxBytes, 'El destino ya contiene un archivo demasiado grande. Selecciona otro.');
    const existing = await old.text();
    if (expectedRaw !== undefined) {
      M.check(existing === expectedRaw, 'El JSON cambió en disco. Abre su versión actual o usa un archivo distinto.');
    } else if (old.size) {
      // Keep unrelated files safe even if the native picker accepted an overwrite.
      M.parse(existing);
      M.check(confirmExisting(existing, old.name), 'Se ha cancelado la sustitución del archivo existente.');
    }
    let writer;
    try {
      writer = await handle.createWritable({ mode: 'exclusive' });
      const now = await handle.getFile();
      M.check(now.size === old.size && now.lastModified === old.lastModified && await now.text() === existing,
        'El archivo cambió mientras se preparaba el guardado.');
      await writer.write(raw);
      await writer.close();
    } catch (error) {
      if (writer) await writer.abort().catch(() => {});
      throw error;
    }
    const checked = await read(await handle.getFile());
    M.check(checked.raw === raw, 'La relectura del archivo guardado no coincide. Comprueba el JSON en disco.');
    return { ...checked, handle, mode: 'direct' };
  }

  async function remember(source) {
    const value = { mode: source.mode, name: source.name, handle: source.handle || null };
    // Only remember manual JSON after the user has selected an actual disk copy.
    if (source.mode === 'manual') value.raw = source.raw;
    try {
      await local('source', value);
      return true;
    } catch {
      // The JSON remains authoritative even if the browser cannot cache it.
      return false;
    }
  }

  async function recover(request = false) {
    const value = await local('source');
    if (!value) return null;
    if (value.mode === 'manual') return { ...value, db: M.parse(value.raw) };
    const handle = value.handle;
    if (!handle) return null;
    const permission = request ? await handle.requestPermission({ mode: 'read' }) : await handle.queryPermission({ mode: 'read' });
    if (permission !== 'granted') return { reconnect: handle.name };
    return { ...await read(await handle.getFile()), handle, mode: 'direct' };
  }

  // Personal navigation is a convenience cache, scoped to this index and catalog.
  function personal(catalog, actor, data) {
    const key = namespace + ':' + catalog + ':' + actor;
    try {
      if (data === null) return localStorage.removeItem(key);
      if (data !== undefined) return localStorage.setItem(key, JSON.stringify(data));
      return JSON.parse(localStorage.getItem(key)) || null;
    } catch { return null; }
  }

  root.WorkMateStorage = { read, serialize, snapshot, download, selectOpen, selectSave, write, recover, remember, personal };
})(globalThis);
