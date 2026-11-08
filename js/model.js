(function (root) {
  'use strict';

  const roles = { admin: 'Admin', manager: 'Gestor', user: 'Usuario' };
  const types = {
    html: 'Aplicación HTML local', web: 'Página web', document: 'Documento local',
    image: 'Imagen', folder: 'Carpeta', executable: 'Ejecutable o acceso directo',
    protocol: 'Protocolo registrado', file: 'Otro archivo local'
  };
  const scopes = { global: 'Global', personal: 'Personal', team: 'Equipo del propietario' };
  const icons = ['grid', 'folder', 'file', 'compare', 'link', 'image', 'settings', 'users'];
  const protocols = ['mailto:', 'tel:', 'ms-excel:', 'ms-word:', 'ms-powerpoint:', 'ms-settings:'];
  const permissions = {
    't.view': 'Ver herramientas', 't.open': 'Abrir herramientas', 't.create': 'Crear herramientas',
    't.editOwn': 'Editar herramientas propias', 't.editOther': 'Editar herramientas ajenas',
    't.deleteOwn': 'Eliminar herramientas propias', 't.deleteOther': 'Eliminar herramientas ajenas',
    't.enable': 'Habilitar herramientas', 't.disable': 'Deshabilitar herramientas',
    't.hide': 'Ocultar herramientas', 't.recover': 'Recuperar herramientas',
    't.move': 'Mover herramientas', 't.icon': 'Cambiar iconos de herramientas', 't.link': 'Cambiar destinos',
    'c.view': 'Ver categorías', 'c.create': 'Crear categorías', 'c.editOwn': 'Editar categorías propias',
    'c.editOther': 'Editar categorías ajenas', 'c.deleteOwn': 'Eliminar categorías propias',
    'c.deleteOther': 'Eliminar categorías ajenas', 'c.move': 'Mover categorías',
    'c.place': 'Mover herramientas a categorías', 'c.nest': 'Crear o mover subcategorías',
    'u.view': 'Ver subordinados', 'u.create': 'Crear subordinados', 'u.edit': 'Editar subordinados',
    'u.enable': 'Habilitar subordinados', 'u.disable': 'Deshabilitar subordinados',
    'u.reset': 'Restablecer contraseñas', 'u.parent': 'Asignar superiores',
    'p.view': 'Consultar permisos', 'p.restrict': 'Restringir permisos', 'p.delegate': 'Delegar permisos',
    'p.edit': 'Modificar permisos de subordinados', 's.import': 'Importar configuración',
    's.export': 'Exportar copias completas', 's.restore': 'Restaurar copias',
    's.global': 'Modificar catálogo global', 's.settings': 'Modificar configuración del portal'
  };
  const keys = Object.keys(permissions);
  const userRights = ['t.view', 't.open', 't.hide', 't.recover', 'c.view'];
  const managerDefaults = [...userRights, 't.create', 't.editOwn', 't.deleteOwn', 't.enable', 't.disable',
    't.move', 't.icon', 't.link', 'c.create', 'c.editOwn', 'c.deleteOwn', 'c.move', 'c.place', 'c.nest',
    'u.view', 'u.create', 'u.edit', 'u.enable', 'u.disable', 'u.reset', 'p.view', 'p.restrict', 'p.delegate', 'p.edit'];
  const csvPath = './BUSCAR Y COMPARAR/CSV-MATCH/index.html';
  const maxBytes = 8 * 1024 * 1024;
  const stamp = () => new Date().toISOString();
  const uid = () => crypto.randomUUID();
  const clone = value => structuredClone(value);
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const fail = message => { throw new Error(message); };
  const check = (ok, message = 'La configuración contiene datos inválidos.') => { if (!ok) fail(message); };
  const own = (object, key) => Object.hasOwn(object, key);
  const record = value => value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
  const shape = (value, fields) => record(value) && Object.keys(value).length === fields.length && fields.every(key => own(value, key));
  const text = (value, max, required = false) => typeof value === 'string' && value.length <= max && (!required || !!value.trim());
  const id = value => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value);
  const date = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
  const int = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
  const array = (value, limit) => Array.isArray(value) && value.length <= limit;
  const unique = value => new Set(value).size === value.length;
  const bool = value => typeof value === 'boolean';
  const get = (items, key) => items.find(item => item.id === key);
  const loginKey = value => value.trim().normalize('NFKC').toLowerCase();
  const fold = value => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const byOrder = (a, b) => a.order - b.order || a.id.localeCompare(b.id);
  const members = (items, parent) => items.filter(item => item.parent === parent).sort(byOrder);
  const menuWidths = Object.freeze({ min: 200, max: 560 });
  const prefs = () => ({ mode: 'list', collapsed: false, width: 302, expanded: {}, hidden: [], favorites: [], recent: [] });

  function route(type, target, base = 'file:///C:/WorkMate/index.html') {
    check(own(types, type) && text(target, 2048, true) && !/[\x00-\x1f\x7f]/.test(target), 'El destino no es válido.');
    const raw = target.trim();
    if (type === 'web') {
      const url = new URL(raw);
      check(/^https?:\/\//i.test(raw) && ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password,
        'Introduce una dirección HTTP o HTTPS sin credenciales.');
      return url.href;
    }
    if (type === 'protocol') {
      const url = new URL(raw);
      check(protocols.includes(url.protocol), 'El protocolo no está en la lista de protocolos admitidos.');
      return url.href;
    }
    const drive = /^[A-Za-z]:[\\/]/.test(raw);
    const unc = /^\\\\[^\\/]+\\[^\\/]+/.test(raw);
    const fileURL = /^file:\/\/\//i.test(raw) || /^file:\/\/[a-z0-9.-]+\//i.test(raw);
    check(drive || unc || fileURL || !/^(?:[a-z][\w+.-]*:|[\\/])/i.test(raw), 'Usa una ruta local válida.');
    const relative = !drive && !unc && !fileURL;
    let normalized = raw.replaceAll('\\', '/');
    if (drive || unc) {
      normalized = normalized.split('/').map(part => encodeURIComponent(part)).join('/');
      if (drive) normalized = 'file:///' + normalized.replace(/^([A-Za-z])%3A/i, '$1:');
      else normalized = 'file:' + normalized;
    }
    if (relative) {
      // Paths are literal filenames. Query strings and fragments are encoded as filename characters.
      normalized = normalized.split('/').map(part => encodeURIComponent(part)).join('/');
    }
    const url = new URL(normalized, base);
    check(url.protocol === 'file:' && !/%(?:2f|5c|00)/i.test(url.pathname) && !url.username && !url.password,
      'El destino local contiene separadores o caracteres inválidos.');
    if (type === 'html') {
      const segments = raw.replaceAll('\\', '/').split('/');
      check(relative && !segments.includes('..') && /\.html?$/i.test(raw) && url.href.startsWith(new URL('./', base).href),
        'Las aplicaciones HTML deben usar una ruta relativa dentro del portal.');
    }
    return url.href;
  }

  function rasterSignature(type, header) {
    return {
      png: header.startsWith('\x89PNG\r\n\x1a\n'), jpeg: header.startsWith('\xff\xd8\xff'),
      gif: /^GIF8[79]a/.test(header), webp: header.startsWith('RIFF') && header.slice(8) === 'WEBP'
    }[type];
  }

  function validIcon(value) {
    if (icons.includes(value)) return true;
    if (!text(value, 60_000)) return false;
    const match = /^data:image\/png;base64,([a-zA-Z0-9+/]+={0,2})$/.exec(value);
    if (!match || match[1].length < 32 || match[1].length % 4) return false;
    const header = atob(match[1].slice(0, 32));
    return rasterSignature('png', header) && header.slice(12, 24) === 'IHDR\x00\x00\x00\x60\x00\x00\x00\x60';
  }

  function verifier(value) {
    return shape(value, ['algorithm', 'iterations', 'salt', 'hash']) && value.algorithm === 'PBKDF2-SHA-256' &&
      int(value.iterations, 600_000, 2_000_000) && text(value.salt, 32) && /^[0-9a-f]{32}$/.test(value.salt) &&
      text(value.hash, 64) && /^[0-9a-f]{64}$/.test(value.hash);
  }

  const caps = role => keys.filter(key => {
    if (role === 'admin') return true;
    if (key.startsWith('s.') || key === 'u.parent') return false;
    if (role === 'manager') return true;
    return key.startsWith('t.') || key.startsWith('c.');
  });
  const roleCaps = Object.fromEntries(Object.keys(roles).map(role => [role, new Set(caps(role))]));
  const ownerOnly = new Set(['s.import', 's.export', 's.restore']);
  const parentOf = (db, account) => account.id === db.owner ? null : account.parent || db.owner;
  function lineage(db, accountId) {
    const list = [];
    for (let item = get(db.accounts, accountId); item; item = get(db.accounts, parentOf(db, item))) {
      check(!list.includes(item), 'La jerarquía de cuentas contiene un ciclo.');
      list.push(item);
    }
    return list;
  }

  function rights(db, accountId) {
    const result = {};
    const chain = lineage(db, accountId).reverse();
    for (const key of keys) {
      let allowed = true;
      let delegate = true;
      let reason = '';
      for (const account of chain) {
        const isOwner = account.id === db.owner;
        const rule = account.rules[key];
        if (!account.enabled) reason ||= 'Cuenta deshabilitada en la jerarquía';
        else if (!roleCaps[account.role].has(key)) reason ||= 'Límite del rol ' + roles[account.role];
        else if (!isOwner && ownerOnly.has(key)) reason ||= 'Reservado al propietario del archivo completo';
        else if (!isOwner && !delegate) reason ||= 'El superior no puede transmitir este permiso';
        else if (rule?.mode === 'deny') reason ||= 'Restringido por ' + account.name;
        allowed = !reason;
        delegate = allowed && (isOwner || rule?.delegate === true);
      }
      result[key] = { allowed: !!chain.length && allowed, delegate: !!chain.length && delegate,
        reason: reason || (chain.length ? 'Permitido por la cadena jerárquica' : 'Sesión no válida') };
    }
    return result;
  }

  function initialRules(db, actor, parent, role) {
    const issuing = rights(db, actor);
    const upper = rights(db, parent || db.owner);
    const defaults = role === 'manager' ? managerDefaults : userRights;
    return Object.fromEntries(keys.filter(key => roleCaps[role].has(key)).map(key => {
      const allowed = defaults.includes(key) && issuing[key].delegate && upper[key].delegate;
      return [key, { mode: allowed ? 'allow' : 'deny', delegate: allowed && role === 'manager' && userRights.includes(key),
        issuer: parent || actor }];
    }));
  }

  function subordinate(db, actor, target) {
    return actor !== target && !!get(db.accounts, target) && (actor === db.owner ||
      lineage(db, target).slice(1).some(item => item.id === actor));
  }

  const canChangeIssuer = (db, actor, issuer) => !issuer || issuer === actor || subordinate(db, actor, issuer);
  const configurable = (role, key) => roleCaps[role].has(key) && !ownerOnly.has(key);

  function validPreferences(value, categories, tools) {
    return shape(value, ['mode', 'collapsed', 'width', 'expanded', 'hidden', 'favorites', 'recent']) &&
      ['list', 'tiles'].includes(value.mode) && bool(value.collapsed) && int(value.width, menuWidths.min, menuWidths.max) &&
      record(value.expanded) && Object.entries(value.expanded).every(([key, on]) => categories.has(key) && bool(on)) &&
      ['hidden', 'favorites', 'recent'].every(key => array(value[key], key === 'recent' ? 15 : tools.size) &&
        unique(value[key]) && value[key].every(tool => tools.has(tool)));
  }

  const envelope = ['schema', 'version', 'catalog', 'revision', 'owner', 'created', 'saved', 'settings',
    'accounts', 'categories', 'tools', 'preferences', 'audit'];
  const accountFields = ['id', 'name', 'login', 'role', 'parent', 'enabled', 'password', 'rules',
    'denied', 'created', 'updated'];
  const resourceFields = ['id', 'name', 'description', 'icon', 'parent', 'order', 'visible', 'owner',
    'creator', 'scope', 'created', 'updated'];
  const auditFields = ['actor', 'action', 'target', 'time', 'summary'];

  function validate(db) {
    check(shape(db, envelope) && db.schema === 'workmate.portal' && db.version === 1, 'Esquema o versión de WorkMate incompatible.');
    check(id(db.catalog) && id(db.revision) && id(db.owner) && date(db.created) && date(db.saved));
    check(shape(db.settings, ['idle', 'iterations']) && int(db.settings.idle, 1, 240) &&
      int(db.settings.iterations, 600_000, 2_000_000), 'Los ajustes del portal están fuera de rango.');
    const sets = [db.accounts, db.categories, db.tools];
    check(array(db.accounts, 500) && array(db.categories, 1000) && array(db.tools, 2000));
    const all = sets.flat();
    check(all.every(item => record(item) && id(item.id)) && unique(all.map(item => item.id)), 'Hay IDs inválidos o duplicados.');
    const [accounts, categories, tools] = sets.map(items => new Map(items.map(item => [item.id, item])));
    for (const account of db.accounts) {
      check(shape(account, accountFields) && text(account.name, 100, true) && text(account.login, 80, true) &&
        /^[\p{L}\p{N}_.@-]+$/u.test(account.login) && own(roles, account.role) && bool(account.enabled) &&
        verifier(account.password) && date(account.created) && date(account.updated), 'Hay una cuenta incompleta o inválida.');
      const expected = { admin: null, manager: 'admin', user: 'manager' }[account.role];
      const parent = accounts.get(account.parent);
      check(expected ? parent?.role === expected && (!account.enabled || parent.enabled) : account.parent === null,
        'Hay una relación jerárquica inválida o un superior deshabilitado.');
      check(record(account.rules) && Object.entries(account.rules).every(([key, rule]) =>
        roleCaps[account.role].has(key) && shape(rule, ['mode', 'delegate', 'issuer']) &&
        accounts.has(rule.issuer) && rule.issuer !== account.id &&
        ['inherit', 'allow', 'deny'].includes(rule.mode) && bool(rule.delegate) && (rule.mode !== 'deny' || !rule.delegate)),
      'Hay permisos o delegaciones inválidos.');
      check(array(account.denied, 3000) && account.denied.every(rule =>
        shape(rule, ['resource', 'issuer']) && accounts.has(rule.issuer) && rule.issuer !== account.id &&
        (categories.has(rule.resource) || tools.has(rule.resource))) && unique(account.denied.map(rule => rule.resource)),
        'Hay restricciones con referencias inválidas.');
    }
    const owner = accounts.get(db.owner);
    check(owner?.role === 'admin' && owner.enabled && !Object.keys(owner.rules).length && !owner.denied.length,
      'El administrador propietario debe estar activo y conservar sus permisos.');
    check(unique(db.accounts.map(account => loginKey(account.login))), 'Hay identificadores de acceso duplicados.');
    for (const account of db.accounts) lineage(db, account.id);

    for (const [items, tool] of [[db.categories, false], [db.tools, true]]) {
      const positions = new Set();
      for (const item of items) {
        check(shape(item, tool ? [...resourceFields, 'type', 'target', 'enabled', 'keywords'] : resourceFields) &&
          text(item.name, 100, true) && text(item.description, 1000) && validIcon(item.icon) &&
          (item.parent === null || categories.has(item.parent)) && int(item.order, 0, 5000) &&
          bool(item.visible) && accounts.has(item.owner) && accounts.has(item.creator) && own(scopes, item.scope) &&
          date(item.created) && date(item.updated), 'Hay una herramienta o categoría con datos o referencias inválidos.');
        const position = item.parent + '/' + item.order;
        check(!positions.has(position), 'Hay posiciones duplicadas en una categoría.');
        positions.add(position);
        if (tool) {
          check(bool(item.enabled) && text(item.keywords, 300));
          route(item.type, item.target);
        }
      }
    }
    for (const item of db.categories) {
      const visited = new Set([item.id]);
      for (let parent = item.parent; parent !== null; parent = categories.get(parent).parent) {
        check(!visited.has(parent), 'Se ha detectado un ciclo de categorías.');
        visited.add(parent);
        check(visited.size <= 24, 'El árbol admite hasta 24 niveles.');
      }
    }
    check(record(db.preferences) && Object.keys(db.preferences).length === accounts.size &&
      Object.entries(db.preferences).every(([key, value]) => accounts.has(key) && validPreferences(value, categories, tools)),
    'Las preferencias contienen referencias inválidas.');
    check(array(db.audit, 300) && db.audit.every(entry => shape(entry, auditFields) && accounts.has(entry.actor) &&
      (entry.target === null || id(entry.target)) && date(entry.time) && text(entry.action, 60, true) && text(entry.summary, 240)),
    'La bitácora administrativa no es válida.');
    return db;
  }

  function parse(raw) {
    check(typeof raw === 'string' && new TextEncoder().encode(raw).length <= maxBytes, 'El JSON supera el límite de 8 MiB.');
    let db;
    try { db = JSON.parse(raw); } catch { fail('El archivo no contiene JSON válido.'); }
    if (db?.schema === 'workmate.backup') {
      check(shape(db, ['schema', 'version', 'exported', 'configuration']) && db.version === 1 && date(db.exported),
        'Los metadatos de la copia de seguridad son inválidos.');
      db = db.configuration;
    }
    // v0 was the pre-release layout without a preferences section.
    if (db?.schema === 'workmate.portal' && db.version === 0 && !own(db, 'preferences') &&
        array(db.accounts, 500) && db.accounts.every(account => id(account?.id))) {
      db.version = 1;
      db.preferences = Object.fromEntries(db.accounts.map(account => [account.id, prefs()]));
    }
    return validate(db);
  }

  const b16 = bytes => Array.from(bytes, n => n.toString(16).padStart(2, '0')).join('');
  const bytes = hex => Uint8Array.from(hex.match(/../g), part => parseInt(part, 16));
  function cryptoAPI() {
    check(globalThis.crypto?.subtle, 'Este navegador no permite Web Crypto aquí. Abre index.html en un navegador compatible.');
    return crypto.subtle;
  }
  async function derive(password, salt, iterations) {
    const subtle = cryptoAPI();
    const key = await subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
    return new Uint8Array(await subtle.deriveBits({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, key, 256));
  }
  async function passwordHash(password, iterations) {
    check(text(password, 256) && password.length >= 12, 'La contraseña debe tener entre 12 y 256 caracteres.');
    cryptoAPI();
    const salt = crypto.getRandomValues(new Uint8Array(16));
    return { algorithm: 'PBKDF2-SHA-256', iterations, salt: b16(salt), hash: b16(await derive(password, salt, iterations)) };
  }

  async function authenticate(db, role, login, password) {
    const account = db.accounts.find(item => item.role === role && loginKey(item.login) === loginKey(login));
    check(account?.enabled, 'La cuenta no está disponible para este perfil.');
    check(text(password, 256), 'La contraseña no es correcta.');
    const { salt, hash, iterations } = account.password;
    const actual = await derive(password, bytes(salt), iterations);
    const expected = bytes(hash);
    let difference = 0;
    for (let index = 0; index < expected.length; index++) difference |= expected[index] ^ actual[index];
    check(difference === 0, 'La contraseña no es correcta.');
    return account.id;
  }

  function createCatalog(name, login, password, includeCSV) {
    const created = stamp();
    const owner = uid();
    const db = { schema: 'workmate.portal', version: 1, catalog: uid(), revision: uid(), owner, created, saved: created,
      settings: { idle: 15, iterations: 600_000 }, accounts: [
        { id: owner, name, login, password, role: 'admin', parent: null, enabled: true, rules: {}, denied: [], created, updated: created }
      ], categories: [], tools: [], preferences: { [owner]: prefs() }, audit: [] };
    const common = { description: '', visible: true, owner, creator: owner, scope: 'global', created, updated: created };
    for (const [order, name] of ['Buscar y comparar', 'Gestionar archivos'].entries()) {
      db.categories.push({ ...common, id: uid(), name, parent: null, order, icon: 'folder' });
    }
    if (includeCSV) db.tools.push({ ...common, id: uid(), name: 'CSV MATCH', icon: 'compare',
      description: 'Comparador y buscador de archivos CSV y XLSX.', parent: db.categories[0].id, order: 0,
      type: 'html', target: csvPath, enabled: true, keywords: 'excel coincidencias comparación búsqueda' });
    audit(db, owner, 'Configuración inicial', null, 'Creación del catálogo local');
    return validate(db);
  }

  function context(db, actor) {
    const user = get(db.accounts, actor);
    const chain = lineage(db, actor);
    const policy = rights(db, actor);
    const denied = new Set(chain.flatMap(account => account.denied.map(rule => rule.resource)));
    const categories = new Map(db.categories.map(item => [item.id, item]));
    const pref = db.preferences[actor];
    const owner = actor === db.owner;
    const can = key => policy[key]?.allowed === true;
    const scope = item => item.scope === 'global' || item.owner === actor ||
      (item.scope === 'team' && chain.some(account => account.id === item.owner));
    const controls = item => item.scope === 'global' ? can('s.global') :
      owner || item.owner === actor || subordinate(db, actor, item.owner);
    const manage = (item, key) => can(key) && controls(item);
    const inspect = (item, kind) => manage(item, kind + (item.owner === actor ? '.editOwn' : '.editOther')) ||
      manage(item, kind + (item.owner === actor ? '.deleteOwn' : '.deleteOther')) ||
      manage(item, kind + '.move') || (kind === 't' && (manage(item, 't.enable') || manage(item, 't.disable')));
    function see(item, kind, editing = false, includeHidden = false) {
      if (!item || !can(kind + '.view') || denied.has(item.id)) return false;
      if ((!scope(item) || !item.visible) && !(editing && inspect(item, kind)) &&
          !(includeHidden && scope(item) && manage(item, kind === 't' ? 't.recover' : 'c.view'))) return false;
      for (let parent = categories.get(item.parent); parent; parent = categories.get(parent.parent)) {
        if (!can('c.view') || denied.has(parent.id) ||
            ((!scope(parent) || !parent.visible) && !(editing && inspect(parent, 'c')))) return false;
      }
      return true;
    }
    const open = item => can('t.open') && !!item?.enabled && item.visible && see(item, 't');
    return { user, policy, can, controls, manage, inspect, see, open, pref };
  }

  function audit(db, actor, action, target, summary) {
    db.audit.push({ actor, action, target, time: stamp(), summary });
    db.audit = db.audit.slice(-300);
  }
  function requireRight(ok) { check(ok, 'Tu cuenta no tiene permiso para realizar esta operación.'); }
  function scrub(db, key) {
    for (const account of db.accounts) account.denied = account.denied.filter(rule => rule.resource !== key);
    for (const pref of Object.values(db.preferences)) {
      delete pref.expanded[key];
      for (const list of ['hidden', 'favorites', 'recent']) pref[list] = pref[list].filter(value => value !== key);
    }
  }
  function prune(db) {
    for (const account of db.accounts) {
      const ctx = context(db, account.id);
      ctx.pref.recent = ctx.pref.recent.filter(key => ctx.open(get(db.tools, key)));
    }
  }

  function parentAccess(db, ctx, parent, kind) {
    if (parent === null) return;
    requireRight(ctx.can(kind === 't' ? 'c.place' : 'c.nest') &&
      ctx.see(get(db.categories, parent), 'c', true));
  }

  function categoryPath(db, parent) {
    const ids = new Set();
    for (let next = get(db.categories, parent); next; next = get(db.categories, next.parent)) ids.add(next.id);
    return ids;
  }

  function controlsContents(db, ctx, category) {
    if (ctx.user.id === db.owner) return true;
    const tree = new Set([category]);
    for (const parent of tree) {
      for (const child of db.categories) {
        if (child.parent !== parent) continue;
        if (!ctx.controls(child)) return false;
        tree.add(child.id);
      }
    }
    return db.tools.every(tool => !tree.has(tool.parent) || ctx.controls(tool));
  }

  function permitsMove(db, ctx, kind, item, parent, before = null) {
    if (!item || !ctx.see(item, kind, true) || !ctx.manage(item, kind + '.move')) return false;
    if (parent !== item.parent &&
        (!ctx.can(kind === 't' ? 'c.place' : 'c.nest') ||
          (parent !== null && !ctx.see(get(db.categories, parent), 'c', true)))) return false;
    if (before !== null) {
      const anchor = get(kind === 't' ? db.tools : db.categories, before);
      if (!anchor || anchor.parent !== parent || !ctx.see(anchor, kind, true)) return false;
    }
    if (parent !== item.parent) {
      const destination = categoryPath(db, parent);
      if (kind === 'c' && (destination.has(item.id) || !controlsContents(db, ctx, item.id))) return false;
      if (ctx.user.id !== db.owner) {
        const lost = categoryPath(db, item.parent);
        for (const id of destination) lost.delete(id);
        if (lost.size && db.accounts.some(account => account.denied.some(rule =>
          lost.has(rule.resource) && !canChangeIssuer(db, ctx.user.id, rule.issuer)))) return false;
      }
    }
    return true;
  }

  function place(items, item, parent, before = null) {
    if (before === item.id && parent === item.parent) return;
    const previous = item.parent;
    const destination = members(items, parent).filter(other => other !== item);
    const index = before === null ? destination.length : destination.findIndex(other => other.id === before);
    check(index >= 0, 'El destino del movimiento ya no existe.');
    destination.splice(index, 0, item);
    item.parent = parent;
    item.updated = stamp();
    destination.forEach((other, order) => { other.order = order; });
    if (previous !== parent) members(items, previous).forEach((other, order) => { other.order = order; });
  }

  function resource(db, actor, ctx, cmd) {
    const kind = cmd.kind;
    check(['c', 't'].includes(kind));
    const items = kind === 't' ? db.tools : db.categories;
    const item = get(items, cmd.id);
    const fields = cmd.fields || {};
    const isTool = kind === 't';
    if (cmd.action === 'create') {
      requireRight(ctx.can(kind + '.create') && (fields.scope !== 'global' || ctx.can('s.global')) &&
        (fields.scope !== 'team' || ctx.user.role !== 'user'));
      if (isTool) requireRight(ctx.can('t.link'));
      parentAccess(db, ctx, fields.parent, kind);
      const created = stamp();
      const value = { id: uid(), name: fields.name, description: fields.description, icon: fields.icon,
        parent: fields.parent, order: Math.max(-1, ...members(items, fields.parent).map(other => other.order)) + 1,
        owner: actor, creator: actor, scope: fields.scope, visible: true, created, updated: created };
      if (isTool) {
        if (fields.icon !== 'file') requireRight(ctx.can('t.icon'));
        Object.assign(value, { enabled: true, type: fields.type, target: fields.target, keywords: fields.keywords });
      }
      items.push(value);
      return value;
    }
    requireRight(ctx.see(item, kind, true, cmd.action === 'visible'));
    const who = item.owner === actor ? 'Own' : 'Other';
    switch (cmd.action) {
      case 'edit': {
        requireRight(ctx.manage(item, kind + '.edit' + who));
        if (fields.scope !== item.scope) {
          requireRight((fields.scope !== 'global' || ctx.can('s.global')) &&
            (fields.scope !== 'team' || ctx.user.role !== 'user') && (item.owner === actor || actor === db.owner));
          if (!isTool) requireRight(controlsContents(db, ctx, item.id));
        }
        if (isTool) {
          if (fields.target !== item.target || fields.type !== item.type) requireRight(ctx.manage(item, 't.link'));
          if (fields.icon !== item.icon) requireRight(ctx.manage(item, 't.icon'));
          Object.assign(item, { type: fields.type, target: fields.target, keywords: fields.keywords });
        }
        if (fields.parent !== item.parent) {
          requireRight(permitsMove(db, ctx, kind, item, fields.parent));
          place(items, item, fields.parent);
        }
        Object.assign(item, { name: fields.name, description: fields.description, icon: fields.icon,
          scope: fields.scope, updated: stamp() });
        break;
      }
      case 'move':
        requireRight(permitsMove(db, ctx, kind, item, cmd.parent, cmd.before));
        place(items, item, cmd.parent, cmd.before);
        break;
      case 'enabled':
        requireRight(isTool && bool(cmd.value) && ctx.manage(item, cmd.value ? 't.enable' : 't.disable'));
        item.enabled = cmd.value;
        item.updated = stamp();
        break;
      case 'visible':
        requireRight(bool(cmd.value) && ctx.manage(item, isTool ? (cmd.value ? 't.recover' : 't.hide') : 'c.edit' + who));
        if (!isTool && cmd.value !== item.visible) requireRight(controlsContents(db, ctx, item.id));
        item.visible = cmd.value;
        item.updated = stamp();
        break;
      case 'delete': {
        requireRight(ctx.manage(item, kind + '.delete' + who));
        if (!isTool) {
          const categories = members(db.categories, item.id);
          const tools = members(db.tools, item.id);
          for (const [set, childKind, children] of [[db.categories, 'c', categories], [db.tools, 't', tools]]) {
            for (const child of children) {
              requireRight(permitsMove(db, ctx, childKind, child, cmd.parent));
              place(set, child, cmd.parent);
            }
          }
          check(!db.categories.some(other => other.parent === item.id) && !db.tools.some(other => other.parent === item.id),
            'Selecciona otro destino para el contenido.');
        }
        items.splice(items.indexOf(item), 1);
        scrub(db, item.id);
        break;
      }
      default: fail('Operación de catálogo desconocida.');
    }
    return item;
  }

  function accountChange(db, actor, ctx, cmd) {
    const fields = cmd.fields || {};
    if (cmd.action === 'accountCreate') {
      requireRight(ctx.can('u.create') && ctx.can('u.view'));
      const role = fields.role;
      const parent = fields.parent;
      requireRight(ctx.user.role === 'admin' ? role === 'manager' || role === 'user' || (role === 'admin' && actor === db.owner) : role === 'user');
      requireRight(role === 'admin' ? parent === null : parent === actor ||
        (subordinate(db, actor, parent) && ctx.can('u.parent')));
      const created = stamp();
      const value = { id: uid(), name: fields.name, login: fields.login, role, parent, enabled: true,
        password: fields.password, rules: initialRules(db, actor, parent, role), denied: [], created, updated: created };
      db.accounts.push(value);
      db.preferences[value.id] = prefs();
      return value;
    }
    requireRight(ctx.can('u.view') && subordinate(db, actor, cmd.id));
    const item = get(db.accounts, cmd.id);
    if (cmd.action === 'accountEdit') {
      requireRight(ctx.can('u.edit'));
      if (fields.parent !== item.parent || fields.role !== item.role) {
        requireRight(ctx.can('u.parent') && (fields.parent === actor || subordinate(db, actor, fields.parent) ||
          (fields.parent === null && actor === db.owner)));
        const oldPolicy = rights(db, item.id);
        const upper = rights(db, fields.parent || db.owner);
        // A reassignment must preserve current denials and effective ceilings.
        const denied = lineage(db, item.id).reverse().flatMap(account => account.denied);
        const preserved = new Map();
        for (const rule of denied) if (!preserved.has(rule.resource)) preserved.set(rule.resource, rule);
        item.denied = [...preserved.values()];
        item.rules = Object.fromEntries(caps(fields.role).map(key => {
          const allowed = oldPolicy[key].allowed && upper[key].delegate;
          const inheritedIssuer = lineage(db, item.id).slice(1).reverse().find(account =>
            account.rules[key]?.mode === 'deny' || (account.id !== db.owner && !rights(db, account.id)[key].delegate))?.id;
          const prior = item.rules[key]?.issuer;
          const issuer = !canChangeIssuer(db, actor, prior) ? prior :
            !allowed && inheritedIssuer && !canChangeIssuer(db, actor, inheritedIssuer) ? inheritedIssuer : actor;
          return [key, { mode: allowed ? 'allow' : 'deny', delegate: allowed && oldPolicy[key].delegate, issuer }];
        }));
        item.parent = fields.parent;
        item.role = fields.role;
      }
      item.name = fields.name;
      item.login = fields.login;
    } else if (cmd.action === 'accountEnabled') {
      requireRight(bool(cmd.value) && ctx.can(cmd.value ? 'u.enable' : 'u.disable'));
      check(cmd.value || !db.accounts.some(account => account.parent === item.id && account.enabled),
        'Deshabilita primero las cuentas dependientes.');
      item.enabled = cmd.value;
    } else if (cmd.action === 'accountPassword') {
      requireRight(ctx.can('u.reset'));
      item.password = fields.password;
    } else if (cmd.action === 'accountPolicy') {
      requireRight(ctx.can('p.view') && ctx.can('p.edit'));
      const { key, mode, delegate } = fields;
      const ceiling = rights(db, parentOf(db, item))[key];
      const before = item.rules[key] || { mode: 'inherit', delegate: false };
      requireRight(configurable(item.role, key) && ['allow', 'inherit', 'deny'].includes(mode) && bool(delegate));
      if (mode !== before.mode || delegate !== before.delegate) {
        requireRight(canChangeIssuer(db, actor, before.issuer));
        if (mode === 'deny' || (before.delegate && !delegate)) requireRight(ctx.can('p.restrict'));
        if ((mode !== 'deny' && mode !== before.mode) || (delegate && !before.delegate)) {
          requireRight(ctx.can('p.delegate') && ctx.policy[key].delegate && ceiling?.delegate);
        }
      }
      if (mode !== before.mode || delegate !== before.delegate) item.rules[key] = { mode, delegate, issuer: actor };
    } else if (cmd.action === 'accountRestriction') {
      const itemResource = get(db.tools, fields.resource) || get(db.categories, fields.resource);
      const kind = get(db.tools, fields.resource) ? 't' : 'c';
      requireRight(ctx.can('p.view') && ctx.can('p.edit') && ctx.can('p.restrict') && bool(fields.deny) &&
        itemResource && ctx.see(itemResource, kind, true, true));
      const previous = item.denied.find(rule => rule.resource === fields.resource);
      if (fields.deny && !previous) item.denied.push({ resource: fields.resource, issuer: actor });
      if (!fields.deny && previous) {
        requireRight(ctx.can('p.delegate') && ctx.policy[kind + '.view'].delegate && canChangeIssuer(db, actor, previous.issuer));
        item.denied = item.denied.filter(rule => rule !== previous);
      }
    } else fail('Operación de cuenta desconocida.');
    item.updated = stamp();
    return item;
  }

  const labels = {
    create: 'Crear', edit: 'Editar', move: 'Mover', enabled: 'Cambiar disponibilidad', visible: 'Cambiar visibilidad',
    delete: 'Eliminar', accountCreate: 'Crear cuenta', accountEdit: 'Editar cuenta', accountEnabled: 'Cambiar estado de cuenta',
    accountPassword: 'Restablecer contraseña', accountPolicy: 'Cambiar permiso', accountRestriction: 'Cambiar acceso a recurso',
    personalHidden: 'Cambiar ocultación personal', settings: 'Cambiar ajustes'
  };

  function change(db, actor, cmd) {
    const next = clone(db);
    const ctx = context(next, actor);
    requireRight(ctx.user?.enabled);
    let affected;
    let summary = '';
    if (cmd.kind) {
      affected = resource(next, actor, ctx, cmd);
    } else if (cmd.action.startsWith('account')) {
      affected = accountChange(next, actor, ctx, cmd);
      if (cmd.action === 'accountPolicy') summary = ' · ' + permissions[cmd.fields.key];
      if (cmd.action === 'accountRestriction') {
        summary = ' · ' + (get(next.tools, cmd.fields.resource) || get(next.categories, cmd.fields.resource)).name;
      }
    } else if (cmd.action === 'settings') {
      requireRight(ctx.can('s.settings'));
      next.settings = cmd.fields;
    } else if (cmd.action === 'personalHidden') {
      affected = get(next.tools, cmd.id);
      requireRight(ctx.can(cmd.value ? 't.hide' : 't.recover') && ctx.see(affected, 't'));
      check(bool(cmd.value));
      ctx.pref.hidden = cmd.value ? [...new Set([...ctx.pref.hidden, cmd.id])] : ctx.pref.hidden.filter(key => key !== cmd.id);
    } else fail('Operación desconocida.');
    audit(next, actor, labels[cmd.action], affected?.id || null, ((affected?.name || '') + summary).slice(0, 240));
    validate(next);
    prune(next);
    return next;
  }

  function preference(db, actor, key, value) {
    const next = clone(db);
    const ctx = context(next, actor);
    requireRight(ctx.user?.enabled);
    if (key === 'favorite' || key === 'opened') {
      const tool = get(next.tools, value);
      requireRight(key === 'favorite' ? ctx.see(tool, 't') : ctx.open(tool));
      if (key === 'favorite') ctx.pref.favorites = ctx.pref.favorites.includes(value) ?
        ctx.pref.favorites.filter(id => id !== value) : [...ctx.pref.favorites, value];
      else ctx.pref.recent = [value, ...ctx.pref.recent.filter(id => id !== value)].slice(0, 15);
    } else if (['collapsed', 'width', 'mode', 'expanded'].includes(key)) {
      ctx.pref[key] = clone(value);
    } else fail('Preferencia desconocida.');
    return validate(next);
  }

  class History {
    constructor(db) { this.commit(db); }
    get dirty() { return this.draft !== this.saved || this.active !== this.saved; }
    get applied() { return this.active === this.draft; }
    push(next) {
      if (this.draft === next || same(this.draft, next)) return;
      this.undoStack.push(this.draft);
      if (this.undoStack.length > 40) this.undoStack.shift();
      this.draft = next;
      this.redoStack.length = 0;
    }
    undo() {
      if (!this.undoStack.length) return;
      this.redoStack.push(this.draft);
      this.draft = this.undoStack.pop();
      if (same(this.saved, this.draft)) this.draft = this.saved;
    }
    redo() {
      if (!this.redoStack.length) return;
      this.undoStack.push(this.draft);
      this.draft = this.redoStack.pop();
    }
    apply() { this.active = this.draft; }
    discard() { this.commit(this.saved); }
    commit(db) {
      this.saved = this.active = this.draft = db;
      this.undoStack = [];
      this.redoStack = [];
    }
  }

  const model = { roles, types, scopes, icons, protocols, permissions, csvPath, maxBytes, stamp, uid, same, clone,
    check, get, fold, byOrder, members, prefs, menuWidths, route, validIcon, rasterSignature, validate, parse, authenticate, passwordHash,
    createCatalog, rights, context, configurable, initialRules, subordinate, lineage, parentOf, permitsMove, canChangeIssuer,
    change, preference, audit, prune, History };
  if (typeof module === 'object' && module.exports) module.exports = model;
  else root.WorkMateModel = model;
})(globalThis);
