(function (root) {
  'use strict';
  const M = root.WorkMateModel;
  const S = root.WorkMateStorage;
  const U = root.WorkMateUI;
  const { $, el, icon, button, group, field, input, select, form, modal, close, pickFile, notify, run, panel } = U;

  let history, source, actor, locked, role;
  let editing = false, saving = false, inactivity;
  let section = 'catalog', selected = null, query = '', drawer = false, framed = null;
  let displayPrefs = null, navigationBeforeRestore = null;
  const replacements = new WeakMap();
  const mobile = matchMedia('(max-width: 500px)');
  const divider = $('menu-divider');
  let menuDrag = null;
  const descriptions = { admin: 'Configura el catálogo y administra cuentas y permisos.',
    manager: 'Organiza las herramientas y gestiona tu equipo.', user: 'Accede a tus herramientas y favoritos.' };
  const roleIcons = { admin: 'shield', manager: 'users', user: 'user' };
  const sections = { catalog: 'Catálogo', favorites: 'Favoritos', recent: 'Recientes', hidden: 'Herramientas ocultas' };
  const editingRights = ['t.create', 't.editOwn', 't.editOther', 't.deleteOwn', 't.deleteOther', 't.move', 't.enable', 't.disable',
    't.hide', 't.recover', 'c.create', 'c.editOwn', 'c.editOther', 'c.deleteOwn', 'c.deleteOther', 'c.move',
    'u.view', 's.settings', 's.restore', 's.import'];
  const dateText = value => new Date(value).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });
  const db = () => editing ? history.draft : history.active;
  const ctx = () => M.context(db(), actor);
  const manualSource = data => ({ ...data, handle: null, mode: 'manual' });

  function pendingMessage(text = 'Hay cambios sin guardar. ¿Descartarlos?') {
    return !saving && (!history?.dirty || window.confirm(text));
  }

  function setSource(next) {
    source = next;
    history = new M.History(next.db);
  }

  function diskMessage(next, cached) {
    return (next.mode === 'direct' ? 'Archivo guardado y verificado' : 'Copia JSON comprobada') + ' · ' +
      next.name + (cached ? '.' : '. Vuelve a seleccionar el JSON al abrir el portal.');
  }

  function backup(raw, prefix = 'workmate-copia') {
    S.download(raw, prefix + '-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json');
  }

  async function directSave(next, baseline, asNew) {
    const handle = !asNew && baseline?.handle ? baseline.handle : await S.selectSave();
    if (asNew && baseline?.handle) M.check(!await handle.isSameEntry(baseline.handle),
      'Selecciona un archivo distinto del JSON vinculado.');
    const existing = !asNew && baseline?.handle ? baseline.raw : undefined;
    if (existing !== undefined) {
      const granted = await handle.queryPermission({ mode: 'readwrite' });
      if (granted !== 'granted') M.check(await handle.requestPermission({ mode: 'readwrite' }) === 'granted',
        'Concede permiso de escritura o guarda una copia JSON manual.');
      if (replacements.has(history?.draft)) backup(existing, 'workmate-antes-de-restaurar');
    }
    return S.write(handle, next, existing, (raw, name) => {
      if (!window.confirm('¿Sustituir el JSON WorkMate existente «' + name + '»? Se ofrecerá una copia previa.')) return false;
      backup(raw, 'workmate-antes-de-sustituir');
      return true;
    });
  }

  function manualSave(next, complete, cancel, fallback) {
    const raw = S.serialize(next);
    const filename = 'workmate-config-' + next.revision.slice(0, 8) + '.json';
    let exported = false;
    const status = el('p', { className: 'info-box', role: 'status' }, 'Descarga el JSON y selecciona esa misma copia para comprobar que puede recuperarse.');
    let verifying = false;
    const verify = button('Seleccionar copia descargada', () => pickFile(async file => {
      if (verifying) return;
      verifying = verify.disabled = true;
      try {
        const read = await S.read(file);
        M.check(read.raw === raw, 'El archivo seleccionado no coincide con la exportación pendiente.');
        if (!verify.isConnected) return;
        await complete(manualSource(read));
        close();
      } finally { verifying = verify.disabled = false; }
    }), { glyph: 'folder', disabled: true });
    const download = button('Descargar JSON', () => {
      S.download(raw, filename);
      if (!exported) {
        exported = true;
        verify.disabled = false;
      }
      status.textContent = 'Descarga solicitada · ' + filename + '. Selecciona el archivo descargado para verificarlo.';
    }, { glyph: 'disk', className: 'primary' });
    const actions = group(download, verify, fallback, button('Volver', () => { close(); cancel?.(); }));
    modal('Guardar mediante JSON manual', el('div', { className: 'stack' }, status,
      el('p', { className: 'muted small' }, 'La descarga crea una copia nueva. Conserva la última copia verificada como configuración activa.'), actions));
  }

  function fileOpenControls() {
    return group(button('Abrir JSON', () => pickFile(async file => finishOpen(manualSource(await S.read(file)))), { glyph: 'folder' }),
      typeof showOpenFilePicker === 'function' ? button('Vincular archivo directo', run(async () => finishOpen(await S.selectOpen())),
        { glyph: 'link' }) : null);
  }

  async function finishOpen(next) {
    if (saving || actor) return;
    setSource(next);
    role = undefined;
    locked = undefined;
    close();
    renderGate();
    const cached = await S.remember(next);
    if (!cached) notify('JSON abierto. Conserva el archivo para volver a seleccionarlo al recargar.');
  }

  function showSetup(reconnect = null, error = null) {
    $('gate').hidden = false;
    $('portal').hidden = true;
    const welcome = el('div', { className: 'stack' }, el('h2', {}, reconnect ? 'Reconectar configuración' : 'Configurar WorkMate'),
      el('p', { className: 'muted' }, reconnect ? 'Chrome debe volver a autorizar la lectura de «' + reconnect + '».' :
        'Crea la cuenta propietaria del catálogo o abre un archivo de configuración existente.'));
    const reconnectButton = reconnect && button('Reconectar ' + reconnect, run(async () => {
      const recovered = await S.recover(true);
      M.check(recovered?.db, 'El navegador no concedió la lectura. Puedes seleccionar el JSON manualmente.');
      await finishOpen(recovered);
    }), { className: 'primary', glyph: 'link' });
    const fresh = button('Primera configuración', () => setupForm(), { glyph: 'plus', className: reconnect ? '' : 'primary' });
    $('gate-body').replaceChildren(welcome, error && el('p', { className: 'warning' }, error) || el('span', { hidden: true }),
      group(reconnectButton, fresh), fileOpenControls(), el('p', { className: 'muted small' },
        'Las cuentas y permisos organizan el uso del portal. El acceso a los archivos depende de los permisos de Windows.'));
  }

  function setupForm() {
    const include = input('csv', 'yes', { type: 'checkbox', checked: true });
    const fileCheck = el('p', { className: 'full muted small', role: 'status' },
      'Ruta conocida · ' + M.csvPath + '. Si tu copia no incluye CSV MATCH, desmarca la opción.');
    const next = form([
      field('Nombre del administrador', input('name', '', { required: true, maxLength: 100, autocomplete: 'name' })),
      field('Identificador de acceso', input('login', '', { required: true, maxLength: 80, autocomplete: 'username' })),
      field('Contraseña', input('password', '', { type: 'password', required: true, minLength: 12, maxLength: 256, autocomplete: 'new-password' }), 'Mínimo 12 caracteres.'),
      field('Repetir contraseña', input('repeat', '', { type: 'password', required: true, minLength: 12, maxLength: 256, autocomplete: 'new-password' })),
      el('label', { className: 'full small' }, include,
        ' Registrar CSV MATCH en la ruta incluida con esta distribución'),
      typeof showDirectoryPicker === 'function' ? group(button('Verificar carpeta del portal', run(async () => {
        const folder = await showDirectoryPicker({ mode: 'read', id: 'workmate-portal' });
        try {
          const tools = await folder.getDirectoryHandle('BUSCAR Y COMPARAR');
          const csv = await tools.getDirectoryHandle('CSV-MATCH');
          await (await csv.getFileHandle('index.html')).getFile();
          include.checked = true;
          fileCheck.textContent = 'CSV MATCH encontrado en la carpeta que has seleccionado.';
        } catch (error) {
          if (error.name !== 'NotFoundError' && error.name !== 'TypeMismatchError') throw error;
          include.checked = false;
          fileCheck.textContent = 'CSV MATCH no figura en la ruta prevista de la carpeta seleccionada.';
        }
      }), { glyph: 'folder' })) : null, fileCheck
    ], async (data, node) => {
      M.check(data.password === data.repeat, 'Las contraseñas no coinciden.');
      const password = await M.passwordHash(data.password, 600_000);
      const db = M.createCatalog(data.name.trim(), data.login.trim(), password, !!data.csv);
      if (!node.isConnected) return;
      node.reset();
      setupStorage(db);
    }, 'Elegir almacenamiento');
    $('gate-body').replaceChildren(el('h2', {}, 'Cuenta propietaria'), next, group(button('Volver', () => showSetup())));
    next.querySelector('input').focus();
  }

  function setupStorage(data) {
    const finish = async next => {
      if (actor) return;
      const cached = await S.remember(next);
      setSource(next);
      enter(next.db.owner);
      notify(diskMessage(next, cached));
    };
    $('gate-body').replaceChildren(el('h2', {}, 'Almacenamiento del catálogo'),
      el('p', { className: 'muted' }, 'El JSON será la copia de referencia. Guarda en un lugar accesible solo para las personas autorizadas.'),
      group(typeof showSaveFilePicker === 'function' ? button('Guardar archivo directo', run(async event => {
        if (saving) return;
        const control = event.currentTarget;
        saving = control.disabled = true;
        try { await finish(await directSave(S.snapshot(data), null, true)); }
        finally { saving = control.disabled = false; }
      }), { glyph: 'disk', className: 'primary' }) : null,
      button('Usar JSON manual', () => { if (!saving) manualSave(S.snapshot(data), finish); }, { glyph: 'file' }),
      button('Volver', () => { if (!saving) setupForm(); })));
  }

  function renderGate() {
    $('gate').hidden = false;
    $('portal').hidden = true;
    if (!history) return showSetup();
    const data = history.saved;
    const chosen = M.get(data.accounts, locked);
    const accounts = data.accounts.filter(account => account.role === role && account.enabled);
    const body = $('gate-body');
    const status = el('p', { className: 'muted small' }, source.name + ' · ' +
      (source.mode === 'direct' ? 'Archivo directo' : 'Copia JSON manual') + ' · ' + dateText(data.saved));
    if (!role) {
      body.replaceChildren(el('div', { className: 'stack' }, el('h2', {}, 'Iniciar sesión'),
        el('p', { className: 'muted' }, 'Selecciona tu perfil para acceder al catálogo de herramientas.')),
      el('div', { className: 'role-grid' }, Object.entries(M.roles).map(([key, title]) => el('button', {
        type: 'button', className: 'role-card', onclick: () => { role = key; renderGate(); }
      }, icon(roleIcons[key]), el('strong', {}, title), el('small', {}, descriptions[key])))),
      status, fileOpenControls(), button('Recuperación del propietario', recovery, { glyph: 'lock' }));
      return;
    }
    const title = el('h2', {}, chosen ? 'Sesión bloqueada · ' + chosen.name : 'Acceso · ' + M.roles[role]);
    const loginForm = form([
      chosen ? input('login', chosen.login, { type: 'hidden' }) :
        field('Cuenta', select('login', accounts.map(account => [account.login, account.name + ' · ' + account.login]), undefined, { required: true })),
      field('Contraseña', input('password', '', { type: 'password', required: true, maxLength: 256, autocomplete: 'current-password' }))
    ], async (values, node) => {
      const current = history;
      const requestedRole = role;
      const id = await M.authenticate(current.saved, requestedRole, values.login, values.password);
      node.reset();
      if (!node.isConnected || current !== history || requestedRole !== role) return;
      if (locked === id) {
        actor = id;
        locked = undefined;
        render();
        resetTimer();
      } else enter(id);
    }, chosen ? 'Desbloquear' : 'Entrar');
    body.replaceChildren(title,
      accounts.length ? loginForm : el('p', { className: 'info-box' }, 'No hay cuentas habilitadas para este perfil.'),
      status, group(button(chosen ? 'Cambiar usuario' : 'Volver a perfiles', () => {
        if (chosen && !pendingMessage('Cambiar de usuario descarta los cambios pendientes. ¿Continuar?')) return;
        if (chosen) { history.discard(); clearSession(); }
        role = undefined;
        renderGate();
      })));
    if (accounts.length) loginForm.querySelector('[name=password]').focus();
  }

  function recovery() {
    modal('Recuperación del propietario', el('div', { className: 'stack' },
      el('p', { className: 'warning' }, 'La posesión de una copia JSON permite restablecer la cuenta propietaria. ' +
        'Usa esta recuperación local solo si tienes autorización y conserva el original por separado.'),
      button('Seleccionar copia JSON', () => pickFile(async file => {
        const { db } = await S.read(file);
        const owner = M.get(db.accounts, db.owner);
        modal('Restablecer propietario', el('div', { className: 'stack' },
          el('p', {}, file.name + ' · ' + owner.name + ' · ' + db.accounts.length + ' cuentas'),
          form([field('Nueva contraseña', input('password', '', { type: 'password', required: true, minLength: 12, maxLength: 256 })),
            field('Repetir contraseña', input('repeat', '', { type: 'password', required: true, minLength: 12, maxLength: 256 }))],
          async (values, node) => {
            M.check(values.password === values.repeat, 'Las contraseñas no coinciden.');
            owner.password = await M.passwordHash(values.password, db.settings.iterations);
            if (!node.isConnected) return;
            owner.updated = M.stamp();
            M.audit(db, owner.id, 'Recuperación local', owner.id, 'Restablecimiento mediante posesión de una copia JSON');
            manualSave(S.snapshot(db), finishOpen);
          }, 'Preparar copia recuperada')));
      }), { glyph: 'folder' })));
  }

  function clearSession() {
    finishMenuDrag();
    actor = locked = undefined;
    displayPrefs = navigationBeforeRestore = null;
    editing = drawer = false;
    selected = query = framed = null;
    section = 'catalog';
    closeViewer();
    close();
  }

  function enter(id) {
    clearSession();
    actor = id;
    const saved = history.saved;
    const fallback = M.clone(saved.preferences[actor]);
    const cached = S.personal(saved.catalog, actor);
    displayPrefs = fallback;
    if (cached?.revision === saved.revision) {
      try {
        const candidate = { ...cached.preferences, hidden: fallback.hidden };
        const check = { ...saved, preferences: { ...saved.preferences, [actor]: candidate } };
        M.validate(check);
        displayPrefs = candidate;
      } catch { /* The JSON's preferences remain available. */ }
    }
    render();
    resetTimer();
  }

  function closeViewer() {
    $('viewer').hidden = true;
    $('viewer').removeAttribute('src');
    $('viewer').title = 'Visor de aplicaciones';
    framed = null;
  }

  function leave(lock = false) {
    if (saving) return;
    if (!lock && !pendingMessage()) return;
    finishMenuDrag();
    clearTimeout(inactivity);
    if (lock) {
      locked = actor;
      role = ctx().user.role;
      actor = undefined;
      selected = null;
      closeViewer();
      close();
    } else {
      history.discard();
      clearSession();
      role = undefined;
    }
    renderGate();
  }

  function resetTimer() {
    clearTimeout(inactivity);
    if (actor) inactivity = setTimeout(() => {
      if (saving) resetTimer();
      else leave(true);
    }, history.active.settings.idle * 60_000);
  }

  function pref(key, value) {
    if (saving) return;
    const data = history.active;
    const candidate = { ...data, preferences: { ...data.preferences, [actor]: checkedPrefs(data) } };
    const updated = M.preference(candidate, actor, key, value);
    displayPrefs = updated.preferences[actor];
    // Entries created in a preview are merged into the JSON when saved.
    if (replacements.get(data) !== 'restore') {
      S.personal(data.catalog, actor, { revision: history.saved.revision, preferences: checkedPrefs(history.saved) });
    }
  }

  function menuBounds() {
    const { min, max } = M.menuWidths;
    if (mobile.matches) return { min, max };
    const available = $('portal').clientWidth;
    return { min, max: Math.max(min, Math.min(max, Math.floor(available * .6), available - 292)) };
  }

  function syncMenuWidth(width = menuDrag?.width ?? displayPrefs.width) {
    const { min, max } = menuBounds();
    const applied = Math.round(Math.max(min, Math.min(max, width)));
    $('portal').style.setProperty('--menu-width', applied + 'px');
    divider.setAttribute('aria-valuemin', min);
    divider.setAttribute('aria-valuemax', max);
    divider.setAttribute('aria-valuenow', applied);
    return applied;
  }

  function setMenuWidth(width) {
    if (width !== Number(divider.getAttribute('aria-valuenow'))) {
      pref('width', width);
      syncMenuWidth();
    }
  }

  function finishMenuDrag(commit = false) {
    if (!menuDrag) return;
    const { pointer, width, startWidth } = menuDrag;
    menuDrag = null;
    $('portal').classList.remove('is-resizing');
    if (divider.hasPointerCapture(pointer)) divider.releasePointerCapture(pointer);
    if (commit && !saving && width !== startWidth) pref('width', width);
    syncMenuWidth();
  }

  function checkedPrefs(data, current = displayPrefs) {
    const fallback = data.preferences[actor];
    const result = { ...current, hidden: fallback.hidden };
    result.expanded = Object.fromEntries(Object.entries(result.expanded).filter(([id]) => M.get(data.categories, id)));
    result.favorites = result.favorites.filter(id => M.get(data.tools, id));
    const access = M.context(data, actor);
    result.recent = result.recent.filter(id => access.open(M.get(data.tools, id)));
    return result;
  }

  function stage(cmd, refresh = true) {
    stageMany([cmd], refresh);
  }

  function stageMany(commands, refresh = true) {
    M.check(!saving && actor && editing, 'Activa el modo edición.');
    const original = history.draft;
    const next = commands.reduce((draft, command) => M.change(draft, actor, command), original);
    if (replacements.has(original)) replacements.set(next, replacements.get(original));
    history.push(next);
    if (refresh) render();
  }

  function changeSection(next) {
    section = next;
    query = '';
    $('search') && ($('search').value = '');
    renderTree();
    renderQuick();
  }

  function render() {
    if (!actor) return;
    $('portal').hidden = false;
    $('gate').hidden = true;
    const menu = $('portal');
    menu.classList.toggle('is-collapsed', displayPrefs.collapsed && !drawer);
    const collapse = $('collapse');
    const collapsed = displayPrefs.collapsed && !drawer;
    divider.hidden = mobile.matches || collapsed;
    if (divider.hidden) finishMenuDrag();
    syncMenuWidth();
    $('workspace').inert = mobile.matches && !collapsed;
    collapse.replaceChildren(icon(collapsed ? 'expand' : 'menu'));
    collapse.title = collapsed ? 'Expandir menú' : 'Contraer menú';
    collapse.setAttribute('aria-label', collapse.title);
    collapse.setAttribute('aria-expanded', String(!collapsed));
    const account = ctx().user;
    const accountLabel = account.name + ' · ' + M.roles[account.role];
    $('account').replaceChildren(el('div', { className: 'identity', title: accountLabel, role: 'group', 'aria-label': accountLabel },
      icon(roleIcons[account.role]), el('div', { className: 'expanded' }, el('strong', {}, account.name), el('small', {}, M.roles[account.role]))),
      button('Bloquear sesión', () => leave(true), { only: true, glyph: 'lock' }),
      button('Cerrar sesión', () => leave(), { only: true, glyph: 'logout' }));
    renderQuick();
    renderTree();
    renderManage();
    renderEditBar();
    renderViewer();
    renderFileStatus();
  }

  function renderQuick() {
    const collapsed = displayPrefs.collapsed && !drawer;
    const existing = $('search');
    const search = existing || input('search', '', { id: 'search', type: 'search', placeholder: 'Buscar herramientas…', autocomplete: 'off',
      'aria-label': 'Buscar herramientas' });
    search.value = query || '';
    search.oninput = () => {
      query = search.value;
      renderTree();
    };
    const quick = key => button(sections[key], () => {
      if (collapsed) { drawer = true; section = key; query = ''; render(); $('search')?.focus(); }
      else changeSection(section === key ? 'catalog' : key);
    }, { glyph: key === 'favorites' ? 'star' : key === 'recent' ? 'clock' : 'folder', only: true, pressed: section === key });
    const view = mode => button(mode === 'list' ? 'Vista lista' : 'Vista cubos', () => {
      pref('mode', mode);
      renderQuick();
      renderTree();
      $('quick').querySelector('[aria-pressed="true"].view-option')?.focus();
    }, { only: true, glyph: mode === 'list' ? 'list' : 'grid', pressed: displayPrefs.mode === mode, className: 'view-option' });
    $('quick').replaceChildren(el('div', { className: 'quick-search' }, icon('search'), search),
      el('div', { className: 'quick-actions' }, group(quick('catalog'), quick('favorites'), quick('recent')),
        el('div', { className: 'view-toggle', 'aria-label': 'Presentación del catálogo' }, view('list'), view('tiles'))));
  }

  function hiddenAllowed() {
    const access = ctx();
    return access.can('t.recover') || access.can('t.hide') ||
      db().categories.some(item => !item.visible && access.see(item, 'c', true));
  }

  function renderManage() {
    const access = ctx();
    const collapsed = displayPrefs.collapsed && !drawer;
    const item = (label, action, glyph, pressed) => button(label, action, { glyph, only: collapsed, pressed });
    $('manage').replaceChildren(...[
      hiddenAllowed() && item(sections.hidden, () => {
        if (collapsed) drawer = true;
        section = section === 'hidden' ? 'catalog' : 'hidden';
        query = '';
        render();
      }, 'hidden', section === 'hidden'),
      (editing || editingRights.some(access.can)) && item(editing ? 'Salir de edición' : 'Modo edición', toggleEdit, 'edit', editing),
      item('Preferencias y archivo', config, 'settings')
    ].filter(Boolean));
  }

  function toggleEdit() {
    if (saving) return;
    if (editing && history.dirty && !history.applied) {
      notify('Aplica, guarda o descarta los cambios antes de salir del modo edición.');
      return;
    }
    editing = !editing;
    if (editing && mobile.matches) {
      if (!displayPrefs.collapsed) pref('collapsed', true);
      drawer = false;
    } else if (editing && displayPrefs.collapsed) drawer = true;
    render();
    $('manage').querySelector('[aria-pressed="true"]')?.focus();
  }

  function renderEditBar() {
    const bar = $('edit-bar');
    bar.hidden = !editing;
    if (!editing) return;
    const access = ctx();
    const update = action => () => {
      if (saving) return;
      const previous = history.active;
      history[action]();
      if (previous !== history.active) {
        if (replacements.get(history.active) === 'restore') {
          navigationBeforeRestore ||= displayPrefs;
          displayPrefs = M.clone(history.active.preferences[actor]);
        } else if (navigationBeforeRestore) {
          displayPrefs = navigationBeforeRestore;
          navigationBeforeRestore = null;
        }
      }
      render();
    };
    bar.replaceChildren(group(
      access.can('t.create') && access.can('t.link') ? button('Herramienta', () => root.WorkMateEditor.edit('t'), { glyph: 'plus' }) : null,
      access.can('c.create') ? button('Categoría', () => root.WorkMateEditor.edit('c'), { glyph: 'plus' }) : null,
      access.can('u.view') ? button('Cuentas y permisos', () => root.WorkMateEditor.accounts(), { glyph: 'users' }) : null,
      button('Deshacer', update('undo'), { glyph: 'undo', disabled: saving || !history.undoStack.length }),
      button('Rehacer', update('redo'), { glyph: 'redo', disabled: saving || !history.redoStack.length }),
      button('Aplicar', update('apply'), { glyph: 'check', disabled: saving || history.applied }),
      button('Guardar', run(() => save()), { className: 'save', glyph: 'disk', disabled: saving || !history.dirty }),
      button('Descartar', () => { if (pendingMessage()) update('discard')(); }, { disabled: saving || !history.dirty }),
      el('small', { className: 'status', role: 'status' }, history.dirty ?
        (history.applied ? 'Aplicado · pendiente de guardar' : 'Borrador · pendiente de aplicar') : 'Sin cambios de catálogo')));
  }

  async function save(asNew = false, forceManual = false) {
    if (!actor || saving) return;
    const data = history.draft;
    const id = actor;
    const previousNavigation = replacements.get(data) === 'restore' && data !== history.active ? data.preferences[id] :
      navigationBeforeRestore && replacements.get(data) !== 'restore' ? navigationBeforeRestore : displayPrefs;
    const next = S.snapshot(M.clone(data));
    next.preferences[id] = checkedPrefs(data, previousNavigation);
    if (replacements.get(data) !== 'restore') {
      for (const account of next.accounts) {
        if (account.id === id) continue;
        const cached = S.personal(data.catalog, account.id);
        const preferences = cached?.preferences;
        if (cached?.revision === history.saved.revision && Number.isInteger(preferences?.width) &&
            preferences.width >= M.menuWidths.min && preferences.width <= M.menuWidths.max &&
            typeof preferences.collapsed === 'boolean') {
          Object.assign(next.preferences[account.id], { width: preferences.width, collapsed: preferences.collapsed });
        }
      }
    }
    M.prune(next);
    let confirming = false;
    const finish = async result => {
      M.check(actor === id && history.draft === data, 'La sesión o el borrador cambió. Vuelve a guardar.');
      confirming = true;
      const cached = await S.remember(result);
      setSource(result);
      displayPrefs = M.clone(result.db.preferences[id]);
      S.personal(result.db.catalog, id, null);
      navigationBeforeRestore = null;
      saving = false;
      render();
      close();
      notify(diskMessage(result, cached));
    };
    if (forceManual || (source.mode === 'manual' && !asNew)) {
      // Lock edits until the verification dialog is dismissed or the file is confirmed.
      S.serialize(next);
      saving = true;
      const onClose = () => { if (saving && !confirming) { saving = false; render(); } };
      $('modal').addEventListener('close', onClose, { once: true });
      manualSave(next, async result => {
        if (replacements.has(data)) backup(source.raw, 'workmate-antes-de-restaurar');
        await finish(result);
      });
      return;
    }
    saving = true;
    renderEditBar();
    try {
      await finish(await directSave(next, source, asNew));
    } catch (error) {
      if (error.name !== 'AbortError') {
        modal('No se pudo guardar en el archivo', el('div', { className: 'stack' },
          el('p', { className: 'warning' }, U.message(error)), group(
            button('Guardar mediante JSON manual', run(() => save(false, true)), { className: 'primary', glyph: 'file' }),
            button('Guardar en otro archivo', run(() => save(true)), { glyph: 'disk' }))));
      }
    } finally {
      saving = false;
      renderEditBar();
    }
  }

  function renderFileStatus() {
    $('file-status').replaceChildren(icon('disk'), el('span', {}, source.name + ' · ' +
      (source.mode === 'manual' ? 'Copia JSON manual' : 'Archivo directo') + ' · ' +
      'Último guardado ' + dateText(history.saved.saved) + (history.dirty ? ' · Cambios pendientes' : '')));
  }

  function config() {
    const access = ctx();
    const isOwner = actor === db().owner;
    const options = el('div', { className: 'stack' },
      group(button(history.dirty ? 'Guardar cambios y preferencias' : 'Guardar preferencias en el JSON', run(() => save()), { glyph: 'disk' }),
        isOwner && typeof showSaveFilePicker === 'function' ?
          button('Guardar en otro archivo', run(() => save(true)), { glyph: 'file' }) : null),
      el('p', { className: 'info-box' }, source.name + ' · ' +
        (source.mode === 'direct' ? 'Archivo vinculado. Los permisos los gestiona el navegador' : 'Copia seleccionada manualmente') + '. ' +
        'Las copias en equipos distintos son independientes.'));
    if (access.can('s.settings') && editing) {
      options.append(group(button('Ajustes generales', () => modal('Ajustes generales', form([
        el('p', { className: 'full muted small' }, 'Los ajustes se incorporan al borrador de edición. Guarda para conservarlos en el JSON.'),
        field('Bloqueo por inactividad (minutos)', input('idle', db().settings.idle, { type: 'number', min: 1, max: 240, required: true })),
        field('Iteraciones PBKDF2', input('iterations', db().settings.iterations, { type: 'number', min: 600000, max: 2000000, required: true }),
          'Se aplica al crear o restablecer contraseñas.')
      ], fields => { stage({ action: 'settings', fields: { idle: Number(fields.idle), iterations: Number(fields.iterations) } }); close(); }, 'Aplicar')),
      { glyph: 'settings' })));
    }
    if (isOwner) {
      options.append(panel('Copias y bitácora', 'disk', group(
        access.can('s.export') ? button('Exportar copia', run(() => {
          backup(S.serialize(history.saved, true));
          notify('Se solicitó la descarga de una copia del último guardado.');
        }), { glyph: 'file' }) : null,
        editing && access.can('s.import') ? button('Importar catálogo', () => importBackup(false), { glyph: 'folder' }) : null,
        editing && access.can('s.restore') ? button('Restaurar copia', () => importBackup(true), { glyph: 'undo' }) : null,
        access.can('p.view') ? button('Bitácora', auditDialog, { glyph: 'list' }) : null),
      el('p', { className: 'muted small' }, 'La exportación recoge el último estado guardado. La importación de catálogo conserva las cuentas.')));
    }
    modal('Preferencias y archivo', options);
  }

  function auditDialog() {
    const rows = [...db().audit].reverse().map(entry => [
      dateText(entry.time), M.get(db().accounts, entry.actor).name, entry.action, entry.summary
    ]);
    modal('Bitácora administrativa', el('div', { className: 'stack' }, el('p', { className: 'muted small' },
      'Últimas 300 operaciones del estado seleccionado. El registro se conserva en el JSON local.'),
    el('div', { className: 'table-wrap' }, el('table', {}, el('thead', {}, el('tr', {},
      ['Fecha', 'Cuenta', 'Operación', 'Detalle'].map(value => el('th', { scope: 'col' }, value)))),
    el('tbody', {}, rows.map(row => el('tr', {}, row.map(value => el('td', {}, value)))))))), true);
  }

  function importBackup(restore) {
    pickFile(async file => {
      const parsed = await S.read(file);
      const current = history.draft;
      M.check(actor === current.owner && editing && ctx().can(restore ? 's.restore' : 's.import'),
        'Tu cuenta no tiene permiso para utilizar esta copia.');
      const imported = parsed.db;
      M.check(!restore || (imported.catalog === current.catalog && imported.owner === current.owner),
        'Para restaurar, selecciona una copia del mismo catálogo y propietario. Para trasladar otro catálogo, ábrelo en la pantalla de acceso.');
      modal(restore ? 'Restaurar configuración' : 'Importar catálogo', el('div', { className: 'stack' },
        el('p', {}, parsed.name + ' · versión ' + imported.version + ' · ' + dateText(imported.saved)),
        el('p', { className: 'info-box' }, imported.accounts.length + ' cuentas · ' + imported.categories.length + ' categorías · ' +
          imported.tools.length + ' herramientas'),
        el('p', { className: 'warning' }, restore ? 'La restauración sustituye cuentas, preferencias y catálogo al guardar.' :
          'La importación sustituye el árbol y las herramientas. Conserva las cuentas y restricciones que sigan teniendo un recurso asociado.'),
        group(button(restore ? 'Confirmar restauración' : 'Confirmar importación', run(() => {
          M.check(history.draft === current && actor === current.owner, 'El borrador cambió. Vuelve a seleccionar la copia.');
          const next = M.clone(restore ? imported : current);
          if (!restore) {
            const known = new Set(current.accounts.map(account => account.id));
            for (const key of ['categories', 'tools']) {
              next[key] = imported[key].map(item => ({ ...item,
                owner: known.has(item.owner) ? item.owner : current.owner,
                creator: known.has(item.creator) ? item.creator : current.owner }));
            }
            const catIds = new Set(next.categories.map(item => item.id));
            const toolIds = new Set(next.tools.map(item => item.id));
            for (const account of next.accounts) {
              account.denied = account.denied.filter(rule => catIds.has(rule.resource) || toolIds.has(rule.resource));
              const pref = next.preferences[account.id];
              pref.expanded = Object.fromEntries(Object.entries(pref.expanded).filter(([id]) => catIds.has(id)));
              for (const key of ['hidden', 'favorites', 'recent']) pref[key] = pref[key].filter(id => toolIds.has(id));
            }
          }
          M.audit(next, actor, restore ? 'Restaurar copia' : 'Importar catálogo', null, parsed.name.slice(0, 240));
          M.prune(next);
          history.push(M.validate(next));
          replacements.set(next, restore ? 'restore' : 'import');
          close();
          render();
        }), { className: 'primary' }), button('Cancelar', close))));
    });
  }

  function toolState(item, access, force = false) {
    if (!item.enabled) return access.manage(item, 't.enable') || access.manage(item, 't.disable') ? 'Deshabilitada' : '';
    if (!item.visible) return 'Ocultación global';
    if (access.pref.hidden.includes(item.id)) return 'Oculta para ti';
    if (!access.open(item) && (force || access.see(item, 't'))) return 'Apertura restringida';
    return '';
  }

  function visibleTool(item, access, hidden = false) {
    if (hidden) return (access.pref.hidden.includes(item.id) && access.can('t.recover') && access.see(item, 't')) ||
      (!item.visible && access.manage(item, 't.recover') && access.see(item, 't', editing, true));
    return access.see(item, 't', editing) && item.visible && !access.pref.hidden.includes(item.id) &&
      (item.enabled || access.manage(item, 't.enable') || access.manage(item, 't.disable'));
  }

  function categoryPath(data, id) {
    const path = [];
    for (let cat = M.get(data.categories, id); cat; cat = M.get(data.categories, cat.parent)) path.unshift(cat.name);
    return path.join(' / ');
  }

  function renderTree() {
    const tree = $('tree');
    const scroll = tree.scrollTop;
    const focus = tree.contains(document.activeElement) ? document.activeElement.dataset.focus : null;
    const data = db();
    const access = ctx();
    const activeAccess = data === history.active ? access : M.context(history.active, actor);
    const activeTools = new Map(history.active.tools.map(item => [item.id, item]));
    const collapsed = displayPrefs.collapsed && !drawer;
    const term = M.fold(query || '').trim();
    const visible = data.tools.filter(item => visibleTool(item, access, section === 'hidden' && !term));
    const order = visible.slice().sort(M.byOrder);
    const heading = (label, glyph) => el('h2', { className: 'tree-heading' }, icon(glyph), label);
    const none = text => el('p', { className: 'muted small panel-body' }, text);
    function favorite(item) {
      const pressed = displayPrefs.favorites.includes(item.id);
      return button(pressed ? 'Quitar de favoritos: ' + item.name : 'Marcar como favorito: ' + item.name, run(() => {
        pref('favorite', item.id);
        renderTree();
      }), { only: true, glyph: 'star', pressed, className: pressed ? 'favorite' : '',
        disabled: !activeAccess.see(activeTools.get(item.id), 't') });
    }
    function toolRow(item) {
      const state = toolState(item, access);
      const canOpen = item.enabled && access.open(item);
      const main = el('button', { type: 'button', className: collapsed ? 'icon-button' : 'row-main',
        disabled: !canOpen, title: [item.name, item.description, state].filter(Boolean).join(' · '),
        'aria-label': item.name + (state ? ' · ' + state : ''), onclick: () => openTool(item.id, editing), 'data-focus': 'tool-' + item.id },
      icon(item.icon), collapsed ? null : el('span', {}, item.name),
      !collapsed && state ? el('span', { className: 'chip off' }, state) : null);
      const more = button('Opciones de ' + item.name, () => root.WorkMateEditor.options('t', item.id), { only: true, glyph: 'more', className: 'row-more' });
      more.dataset.focus = 'more-' + item.id;
      const row = el('div', { className: 'row', 'aria-current': selected === item.id ? 'true' : undefined },
        main, !collapsed && access.see(item, 't') && favorite(item), !collapsed && more);
      if (editing && !collapsed && !term && section === 'catalog') root.WorkMateEditor.bindDrag(row, 't', item);
      return row;
    }
    const tools = list => list.length ? el('div', {
      className: 'tool-group' + (displayPrefs.mode === 'tiles' ? ' tiles' : '')
    }, list.map(toolRow)) : null;
    function branch(parent, depth = 0) {
      return el('div', { className: 'branch' },
        M.members(data.categories, parent).filter(item => access.see(item, 'c', editing)).map(item => {
          const expanded = displayPrefs.expanded[item.id] ?? depth === 0;
          const childId = 'branch-' + item.id;
          const main = el('button', { type: 'button', className: 'row-main', 'aria-expanded': expanded, 'aria-controls': childId,
            'data-focus': 'category-' + item.id, title: item.description || item.name, onclick: () => {
              const active = history.active;
              if (M.get(active.categories, item.id)) pref('expanded', { ...checkedPrefs(active).expanded, [item.id]: !expanded });
              else displayPrefs.expanded[item.id] = !expanded;
              renderTree();
            } }, icon(expanded ? 'down' : 'right'), icon(item.icon), el('span', {}, item.name),
          !item.visible ? el('span', { className: 'chip off' }, 'Oculta') : null);
          main.firstElementChild.classList.add('twisty');
          const options = button('Opciones de ' + item.name, () => root.WorkMateEditor.options('c', item.id), { glyph: 'more', only: true });
          options.dataset.focus = 'more-' + item.id;
          const row = el('div', { className: 'row category' }, main, editing ? options : null);
          if (editing) root.WorkMateEditor.bindDrag(row, 'c', item);
          const children = el('div', { id: childId, hidden: !expanded });
          if (expanded) {
            const content = branch(item.id, depth + 1);
            if (content.childElementCount) children.append(content);
          }
          return el('div', {}, row, children);
        }), tools(order.filter(item => item.parent === parent)));
    }

    if (collapsed) {
      const quickIds = [...new Set([...displayPrefs.favorites, ...displayPrefs.recent, ...order.map(item => item.id)])].slice(0, 24);
      tree.replaceChildren(...quickIds.map(id => order.find(item => item.id === id)).filter(Boolean).map(toolRow));
    } else if (term) {
      const list = order.filter(item => (access.open(item) || (editing && access.inspect(item, 't'))) &&
        M.fold([item.name, item.description, item.keywords, categoryPath(data, item.parent)].join(' ')).includes(term));
      tree.replaceChildren(heading('Resultados · ' + list.length, 'search'), list.length ? tools(list) : none('No hay herramientas para esta búsqueda.'));
    } else if (section === 'catalog') {
      const rootDrop = editing ? el('p', { className: 'drop-root small muted' }, 'Soltar en el nivel principal') : null;
      if (rootDrop) root.WorkMateEditor.bindDrag(rootDrop, 'c', null);
      tree.replaceChildren(heading('Catálogo', 'folder'), branch(null), rootDrop || el('span', { hidden: true }));
    } else {
      const ids = section === 'favorites' ? displayPrefs.favorites : displayPrefs.recent;
      const list = section === 'hidden' ? order : ids.map(id => order.find(item => item.id === id)).filter(Boolean);
      const hiddenCategories = section === 'hidden' && editing ? data.categories.filter(item => !item.visible && access.see(item, 'c', true))
        .map(item => button(item.name, () => root.WorkMateEditor.options('c', item.id), { glyph: 'folder' })) : [];
      tree.replaceChildren(heading(sections[section], section === 'hidden' ? 'hidden' : section === 'favorites' ? 'star' : 'clock'),
        list.length ? tools(list) : none('No hay herramientas en esta sección.'), ...hiddenCategories);
    }
    tree.scrollTop = scroll;
    if (focus) [...tree.querySelectorAll('[data-focus]')].find(node => node.dataset.focus === focus)?.focus({ preventScroll: true });
  }

  function external(item, href) {
    const browserControlled = ['folder', 'executable', 'protocol', 'file'].includes(item.type);
    const explain = browserControlled ?
      'El navegador y Windows deciden cómo tratar este destino. Para ejecutables o carpetas puedes copiar la ruta y usarla en el Explorador.' :
      'El navegador abrirá una pestaña o gestionará el archivo según su configuración.';
    modal(item.name, el('div', { className: 'stack' }, el('p', {}, item.description || M.types[item.type]),
      el('p', { className: 'info-box' }, 'Estado del destino · No verificable'),
      el('code', { className: 'path' }, item.target), el('p', { className: 'muted' }, explain),
      group(el('a', { className: 'button primary', href, target: '_blank', rel: 'noopener noreferrer',
        onclick: event => {
          if (!actor || !M.context(history.active, actor).open(M.get(history.active.tools, item.id))) event.preventDefault();
        } }, icon('open'), 'Intentar apertura'),
      button('Copiar destino', run(() => U.copy(item.target)), { glyph: 'copy' }))));
  }

  function openTool(id, preview = false) {
    const data = history.active;
    const item = M.get(data.tools, id);
    const draft = preview ? M.get(history.draft.tools, id) : item;
    if (!M.context(data, actor).open(item) || !draft || draft.target !== item.target || draft.type !== item.type) {
      notify(preview ? 'Aplica los cambios antes de abrir esta herramienta.' : 'La herramienta no está disponible para tu cuenta.', true);
      return;
    }
    let href;
    try { href = M.route(item.type, item.target, location.href); }
    catch (error) { return notify(U.message(error), true); }
    pref('opened', id);
    if (item.type !== 'html') {
      external(item, href);
      renderTree();
      return;
    }
    selected = id;
    if (mobile.matches && !displayPrefs.collapsed) pref('collapsed', true);
    drawer = false;
    render();
  }

  function renderViewer() {
    const active = history.active;
    const access = M.context(active, actor);
    let item = M.get(active.tools, selected);
    if (!access.open(item) || item.type !== 'html') { selected = null; item = null; closeViewer(); }
    const landing = $('landing');
    landing.hidden = !!item;
    const title = item ? item.name : 'Área de trabajo';
    $('workspace-top').replaceChildren(icon(item?.icon || 'home'), el('div', { className: 'workspace-title' },
      el('h2', {}, title), el('small', {}, item ? categoryPath(active, item.parent) || 'Aplicación local' : 'Inicio del catálogo')),
    ...(item ? [group(button('Inicio', () => { selected = null; render(); }, { glyph: 'home' }),
      el('a', { className: 'button', href: M.route(item.type, item.target, location.href), target: '_blank', rel: 'noopener noreferrer',
        title: 'Abrir ' + item.name + ' en otra pestaña' }, icon('open'), 'Otra pestaña'))] : []));
    if (item) {
      const viewer = $('viewer');
      const url = M.route(item.type, item.target, location.href);
      if (framed !== url) {
        viewer.src = url;
        framed = url;
      }
      viewer.title = item.name;
      viewer.hidden = false;
      return;
    }
    const available = active.tools.filter(tool => access.open(tool) && !access.pref.hidden.includes(tool.id));
    const ordered = [...new Set([...displayPrefs.favorites, ...displayPrefs.recent, ...available.sort(M.byOrder).map(tool => tool.id)])]
      .map(id => available.find(tool => tool.id === id)).filter(Boolean).slice(0, 12);
    const cards = ordered.map(tool => el('button', { type: 'button', className: 'home-tool',
      onclick: () => openTool(tool.id) }, icon(tool.icon), el('div', {},
      el('strong', {}, tool.name), el('small', {}, tool.description || M.types[tool.type]))));
    landing.replaceChildren(el('div', { className: 'landing-inner' }, el('section', { className: 'hero' },
      el('span', { className: 'eyebrow' }, icon('grid'), 'Herramientas WorkMate'),
      el('h2', {}, 'Tu espacio de trabajo'), el('p', {}, 'Abre una herramienta desde el catálogo. Las aplicaciones locales se muestran aquí y los demás recursos se abren por separado.')),
    panel('Acceso rápido', 'star', cards.length ? el('div', { className: 'home-grid' }, cards) :
      el('p', { className: 'muted' }, 'Aún no hay herramientas disponibles para esta cuenta.'))));
  }

  $('collapse').addEventListener('click', () => {
    if (saving) return;
    finishMenuDrag();
    if (drawer) drawer = false;
    else pref('collapsed', !displayPrefs.collapsed);
    render();
    $('collapse').focus();
  });
  $('mobile-backdrop').addEventListener('click', () => $('collapse').click());
  mobile.addEventListener('change', () => { if (actor) render(); });
  window.addEventListener('resize', () => { if (actor) { finishMenuDrag(); syncMenuWidth(); } });
  divider.addEventListener('pointerdown', event => {
    if (divider.hidden || saving || menuDrag || event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    divider.focus({ preventScroll: true });
    divider.setPointerCapture(event.pointerId);
    const width = Number(divider.getAttribute('aria-valuenow'));
    menuDrag = { pointer: event.pointerId, x: event.clientX, startWidth: width, width };
    $('portal').classList.add('is-resizing');
  });
  function moveDivider(event) {
    menuDrag.width = syncMenuWidth(menuDrag.startWidth + event.clientX - menuDrag.x);
  }
  divider.addEventListener('pointermove', event => { if (menuDrag?.pointer === event.pointerId) moveDivider(event); });
  divider.addEventListener('pointerup', event => {
    if (menuDrag?.pointer === event.pointerId) {
      moveDivider(event);
      finishMenuDrag(true);
    }
  });
  for (const name of ['pointercancel', 'lostpointercapture']) {
    divider.addEventListener(name, event => { if (menuDrag?.pointer === event.pointerId) finishMenuDrag(); });
  }
  divider.addEventListener('keydown', event => {
    if (divider.hidden || saving || menuDrag) return;
    const { min, max } = menuBounds();
    const current = Number(divider.getAttribute('aria-valuenow'));
    const step = event.shiftKey ? 32 : 8;
    const widths = { ArrowLeft: current - step, ArrowRight: current + step, Home: min, End: max };
    if (!Object.hasOwn(widths, event.key)) return;
    event.preventDefault();
    setMenuWidth(Math.max(min, Math.min(max, widths[event.key])));
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && menuDrag) {
      event.preventDefault();
      finishMenuDrag();
      return;
    }
    if (event.key === 'Escape' && actor && !$('modal').open &&
        (drawer || (mobile.matches && !displayPrefs.collapsed))) $('collapse').click();
  });
  $('viewer').addEventListener('error', () => {
    if (selected) notify('No se pudo cargar la herramienta. Comprueba su ruta o ábrela en otra pestaña.', true);
  });
  for (const event of ['pointerdown', 'pointermove', 'keydown', 'focusin']) {
    document.addEventListener(event, () => { if (actor) resetTimer(); }, { passive: true });
  }
  window.addEventListener('blur', () => { if (actor) resetTimer(); });
  window.addEventListener('beforeunload', event => {
    if (history?.dirty || saving) { event.preventDefault(); event.returnValue = ''; }
  });

  root.WorkMateApp = { db, ctx, stage, stageMany, get actor() { return actor; }, get editing() { return editing; },
    categoryPath, openTool, notify, render, toolState };

  (async () => {
    try {
      const recovered = await S.recover();
      if (recovered?.db) { setSource(recovered); renderGate(); }
      else showSetup(recovered?.reconnect);
    } catch (error) { showSetup(null, 'No se recuperó la configuración anterior. Selecciona una copia válida. ' + U.message(error)); }
  })();
})(globalThis);
