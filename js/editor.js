(function (root) {
  'use strict';
  const M = root.WorkMateModel;
  const U = root.WorkMateUI;
  const { el, icon, button, group, field, input, select, form, modal, close, run, panel } = U;
  const A = () => root.WorkMateApp;
  const value = field => field || null;
  const verbs = { c: 'categoría', t: 'herramienta' };
  let dragged;

  function categories(data, access, kind, item, includeRoot = true) {
    const result = includeRoot ? [['', 'Nivel principal']] : [];
    for (const category of data.categories) {
      if (!access.see(category, 'c', true)) continue;
      if (item ? !M.permitsMove(data, access, kind, item, category.id) && category.id !== item.parent :
        !access.can(kind === 't' ? 'c.place' : 'c.nest')) continue;
      result.push([category.id, A().categoryPath(data, category.id)]);
    }
    return result.sort((a, b) => (a[0] ? 1 : 0) - (b[0] ? 1 : 0) || a[1].localeCompare(b[1], 'es'));
  }

  function edit(kind, id = null, startParent = null) {
    const app = A();
    const data = app.db();
    const access = app.ctx();
    const tool = kind === 't';
    const item = id ? M.get(tool ? data.tools : data.categories, id) : null;
    const owns = item?.owner === app.actor;
    M.check(app.editing && (item ? access.manage(item, kind + (owns ? '.editOwn' : '.editOther')) :
      access.can(kind + '.create')), 'Tu cuenta no puede editar este recurso.');
    const movable = !item || access.manage(item, kind + '.move');
    const scopeValues = Object.entries(M.scopes).filter(([scope]) =>
      scope === item?.scope || ((scope !== 'global' || access.can('s.global')) &&
      (scope !== 'team' || access.user.role !== 'user')));
    const scope = select('scope', scopeValues, item?.scope || (access.can('s.global') ? 'global' : 'personal'),
      { disabled: !!item && !owns && app.actor !== data.owner });
    const iconEditable = !tool || (item ? access.manage(item, 't.icon') : access.can('t.icon'));
    const iconNames = { grid: 'Cuadrícula', folder: 'Carpeta', file: 'Archivo', compare: 'Comparación', link: 'Enlace',
      image: 'Imagen', settings: 'Ajustes', users: 'Equipo' };
    const image = input('image', '', { type: 'file', accept: 'image/png,image/jpeg,image/gif,image/webp,image/svg+xml',
      disabled: !iconEditable });
    const existingIcon = item?.icon || (tool ? 'file' : 'folder');
    const iconSelect = select('icon', [
      ...M.icons.map(name => [name, iconNames[name]]),
      ...(M.icons.includes(existingIcon) ? [] : [['custom', 'Imagen actual']])
    ], M.icons.includes(existingIcon) ? existingIcon : 'custom', { disabled: !iconEditable });
    const canLink = !item || access.manage(item, 't.link');
    const target = input('target', item?.target || '', { placeholder: './Carpeta/index.html', required: true,
      maxLength: 2048, disabled: !canLink });
    const type = select('type', Object.entries(M.types), item?.type || 'html', { disabled: !canLink });
    if (tool && canLink) type.onchange = () => {
      target.placeholder = type.value === 'html' ? './Carpeta/index.html' :
        type.value === 'web' ? 'https://…' : type.value === 'protocol' ? 'mailto:…' : 'C:\\Carpeta\\archivo';
    };
    const parent = select('parent', categories(data, access, kind, movable ? item : null),
      item?.parent || startParent || '', { disabled: !movable });
    if (parent.selectedIndex < 0 && movable) parent.value = '';
    const node = form([
      field('Nombre', input('name', item?.name || '', { required: true, maxLength: 100 })),
      field('Alcance', scope),
      field('Descripción', el('textarea', { name: 'description', value: item?.description || '', maxLength: 1000 }), null, true),
      field(tool ? 'Categoría' : 'Categoría superior', parent),
      field('Icono', iconSelect),
      iconEditable ? field('Importar imagen o SVG', image, 'PNG, JPEG, GIF, WebP o SVG simple de hasta 256 KiB.', true) : null,
      tool ? field('Tipo de destino', type) : null,
      tool ? field('Palabras clave', input('keywords', item?.keywords || '', { maxLength: 300 })) : null,
      tool ? field('Ruta o URL', target, 'Los destinos locales se tratan como rutas literales. En protocolos se admiten ' + M.protocols.join(' '), true) : null
    ], async (values, formNode) => {
      const imported = values.image?.size ? await U.readIcon(values.image) : null;
      if (!formNode.isConnected) return;
      const fields = {
        name: values.name.trim(), description: values.description.trim(), scope: values.scope || item.scope,
        parent: movable ? value(values.parent) : item.parent,
        icon: imported || (values.icon && values.icon !== 'custom' ? values.icon : existingIcon)
      };
      if (tool) {
        Object.assign(fields, { type: values.type || item.type, target: (values.target || item.target).trim(), keywords: values.keywords.trim() });
      }
      app.stage({ kind, action: item ? 'edit' : 'create', id, fields });
      close();
    }, item ? 'Preparar cambios' : 'Crear ' + verbs[kind]);
    modal((item ? 'Editar ' : 'Nueva ') + verbs[kind], node);
  }

  function deleteResource(kind, item) {
    const data = A().db();
    const access = A().ctx();
    const cats = kind === 'c' ? M.members(data.categories, item.id) : [];
    const tools = kind === 'c' ? M.members(data.tools, item.id) : [];
    const hasChildren = !!(cats.length || tools.length);
    const destinations = [['', 'Nivel principal'], ...data.categories
      .filter(category => access.see(category, 'c', true))
      .map(category => [category.id, A().categoryPath(data, category.id)])]
      .filter(([id]) => [...cats.map(cat => ['c', cat]), ...tools.map(tool => ['t', tool])]
        .every(([kind, child]) => value(id) !== item.id && M.permitsMove(data, access, kind, child, value(id))));
    const destination = select('destination', destinations, item.parent || '');
    if (destination.selectedIndex < 0) destination.selectedIndex = 0;
    modal('Eliminar ' + verbs[kind], el('div', { className: 'stack' },
      el('p', { className: 'warning' }, '¿Eliminar «' + item.name + '» del catálogo?'),
      hasChildren ? el('p', {}, cats.length + ' subcategorías y ' + tools.length + ' herramientas directas se conservarán.') : null,
      hasChildren && destinations.length ? field('Reubicar el contenido en', destination) : null,
      hasChildren && !destinations.length ? el('p', {}, 'No hay un destino autorizado para todos los elementos.') : null,
      group(button('Confirmar eliminación', run(() => {
        A().stage({ kind, action: 'delete', id: item.id, parent: value(destination.value) });
        close();
      }), { className: 'danger', disabled: hasChildren && !destinations.length }), button('Cancelar', close))));
  }

  function options(kind, id) {
    const app = A();
    const db = app.db();
    const access = app.ctx();
    const tool = kind === 't';
    const items = tool ? db.tools : db.categories;
    const item = M.get(items, id);
    if (!access.see(item, kind, app.editing, true)) return;
    const owns = item.owner === app.actor;
    const actions = [];
    const label = tool ? M.types[item.type] : 'Categoría';
    const stage = (title, cmd, glyph) => button(title, run(() => {
      app.stage({ kind, id, ...cmd });
      close();
    }), { glyph });
    const path = app.categoryPath(db, item.parent) || 'Nivel principal';
    const hidden = tool && access.pref.hidden.includes(id);
    if (tool && access.open(item)) {
      actions.push(button('Abrir ' + item.name, () => { close(); app.openTool(id, app.editing); }, { glyph: 'open', className: 'primary' }));
    }
    if (tool && item.type === 'html' && access.open(item) && !app.editing) {
      actions.push(el('a', { className: 'button', href: M.route(item.type, item.target, location.href), target: '_blank',
        rel: 'noopener noreferrer' }, icon('open'), 'Otra pestaña'));
    }
    if (app.editing) {
      if (access.manage(item, kind + (owns ? '.editOwn' : '.editOther'))) {
        actions.push(button('Editar datos', run(() => edit(kind, id)), { glyph: 'edit' }));
      }
      if (tool && access.see(item, 't') && access.can(hidden ? 't.recover' : 't.hide')) {
        actions.push(button(hidden ? 'Recuperar para mí' : 'Ocultar para mí', run(() => {
          app.stage({ action: 'personalHidden', id, value: !hidden });
          close();
        }), { glyph: hidden ? 'eye' : 'hidden' }));
      }
      if (tool && access.manage(item, item.enabled ? 't.disable' : 't.enable')) {
        actions.push(stage(item.enabled ? 'Deshabilitar' : 'Habilitar', { action: 'enabled', value: !item.enabled }, 'lock'));
      }
      if (access.manage(item, tool ? (item.visible ? 't.hide' : 't.recover') : ('c.edit' + (owns ? 'Own' : 'Other')))) {
        const state = item.visible ? 'Ocultar' : 'Mostrar';
        actions.push(stage(state + (item.scope === 'global' ? ' globalmente' : ' en su ámbito'),
          { action: 'visible', value: !item.visible }, item.visible ? 'hidden' : 'eye'));
      }
      if (!tool && access.can('c.create') && access.can('c.nest')) {
        actions.push(button('Crear subcategoría', run(() => edit('c', null, id)), { glyph: 'plus' }));
      }
      if (access.manage(item, kind + '.move')) {
        const siblings = M.members(items, item.parent);
        const index = siblings.indexOf(item);
        const up = siblings.slice(0, index).reverse().find(other => access.see(other, kind, true));
        const down = siblings.slice(index + 1).findIndex(other => access.see(other, kind, true));
        if (up) actions.push(stage('Mover arriba', { action: 'move', parent: item.parent, before: up.id }, 'up'));
        if (down >= 0) {
          const anchor = siblings.slice(index + down + 2).find(other => access.see(other, kind, true));
          actions.push(stage('Mover abajo', { action: 'move', parent: item.parent, before: anchor?.id || null }, 'down'));
        }
        actions.push(button('Cambiar categoría', () => {
          const entries = categories(db, access, kind, item).filter(([key]) => value(key) !== item.parent);
          modal('Cambiar categoría · ' + item.name, entries.length ? form([
            field('Destino', select('parent', entries), null, true)
          ], fields => { app.stage({ kind, action: 'move', id, parent: value(fields.parent), before: null }); close(); },
          'Preparar movimiento') : el('p', {}, 'No hay otro destino autorizado.'));
        }, { glyph: 'folder' }));
      }
      if (access.manage(item, kind + (owns ? '.deleteOwn' : '.deleteOther'))) {
        actions.push(button('Eliminar', () => deleteResource(kind, item), { className: 'danger' }));
      }
    }
    const state = tool ? app.toolState(item, access, true) : item.visible ? '' : 'Oculta';
    modal(item.name, el('div', { className: 'stack' }, el('p', { className: 'muted small' }, [label, path, M.scopes[item.scope], state].filter(Boolean).join(' · ')),
      item.description ? el('p', {}, item.description) : null,
      tool ? el('code', { className: 'path' }, item.target) : null,
      tool ? el('p', { className: 'small muted' }, 'Estado del destino · No verificable') : null,
      actions.length ? group(actions) : el('p', { className: 'muted small' }, 'Tu cuenta puede consultar la ficha.')));
  }

  function clearDrop() {
    for (const row of document.querySelectorAll('.drop-target, .drop-blocked')) {
      row.classList.remove('drop-target', 'drop-blocked', 'before');
      row.removeAttribute('data-drop');
    }
  }

  function bindDrag(row, kind, item) {
    const app = A();
    const data = app.db();
    const access = app.ctx();
    if (item && access.manage(item, kind + '.move')) {
      row.draggable = true;
      row.addEventListener('dragstart', event => {
        dragged = { kind, id: item.id };
        event.dataTransfer.setData('text/plain', item.name);
        event.dataTransfer.effectAllowed = 'move';
      });
      row.addEventListener('dragend', () => { dragged = null; clearDrop(); });
    }
    function destination(event) {
      if (!dragged) return null;
      if (!item) return { parent: null, before: null };
      if (kind === 't') {
        return dragged.kind === 't' && dragged.id !== item.id ? { parent: item.parent, before: item.id } : null;
      }
      const before = dragged.kind === 'c' && event.clientY < row.getBoundingClientRect().top + row.clientHeight * .3;
      if (dragged.id === item.id) return null;
      return before ? { parent: item.parent, before: item.id } : { parent: item.id, before: null };
    }
    function valid(dest) {
      const moving = dragged && M.get(dragged.kind === 'c' ? data.categories : data.tools, dragged.id);
      return dest && M.permitsMove(data, access, dragged.kind, moving, dest.parent, dest.before);
    }
    row.addEventListener('dragover', event => {
      if (!dragged) return;
      event.preventDefault();
      event.stopPropagation();
      const dest = destination(event);
      const allowed = valid(dest);
      clearDrop();
      row.classList.add(allowed ? 'drop-target' : 'drop-blocked');
      row.classList.toggle('before', !!dest?.before);
      event.dataTransfer.dropEffect = allowed ? 'move' : 'none';
    });
    row.addEventListener('dragleave', event => {
      if (!row.contains(event.relatedTarget)) row.classList.remove('drop-target', 'drop-blocked', 'before');
    });
    row.addEventListener('drop', run(event => {
      if (!dragged) return;
      event.preventDefault();
      event.stopPropagation();
      const dest = destination(event);
      const allowed = valid(dest);
      const { kind, id } = dragged;
      dragged = null;
      clearDrop();
      if (!allowed) return U.notify('Ese destino está bloqueado o crearía un ciclo.', true);
      app.stage({ kind, action: 'move', id, ...dest });
    }));
  }

  function accountForm(item) {
    const app = A();
    const data = app.db();
    const access = app.ctx();
    const canParent = access.can('u.parent') && (!item || access.can('u.edit'));
    const isOwner = app.actor === data.owner;
    const changeableRole = !item || canParent;
    const selectedRole = item?.role || (access.user.role === 'admin' ? 'manager' : 'user');
    const role = select('role', Object.entries(M.roles).filter(([key]) =>
      key === selectedRole || (access.user.role === 'admin' && (key !== 'admin' || isOwner))), selectedRole, { disabled: !changeableRole });
    const parent = select('parent', []);
    function parents() {
      const expected = { admin: null, manager: 'admin', user: 'manager' }[role.value];
      const list = data.accounts.filter(account => account.id !== item?.id && account.role === expected &&
        (account.enabled || account.id === item?.parent) && (account.id === app.actor || (canParent && M.subordinate(data, app.actor, account.id))));
      const next = expected ? list.map(account => [account.id, account.name]) : [['', 'Sin superior directo']];
      const chosen = item?.parent || app.actor;
      parent.replaceChildren(...next.map(([id, label]) => el('option', { value: id }, label)));
      if (next.some(([id]) => id === chosen)) parent.value = chosen;
      parent.disabled = !expected || (!!item && !canParent);
      parent.required = !!expected;
    }
    role.onchange = parents;
    parents();
    const fields = [
      field('Nombre visible', input('name', item?.name || '', { required: true, maxLength: 100 })),
      field('Identificador de acceso', input('login', item?.login || '', { required: true, maxLength: 80 })),
      field('Rol', role),
      field('Superior', parent, role.value === 'admin' ? 'Las cuentas secundarias dependen del límite del propietario.' : null)
    ];
    if (!item) fields.push(field('Contraseña inicial', input('password', '', { type: 'password', required: true, minLength: 12,
      maxLength: 256, autocomplete: 'new-password' }), 'Mínimo 12 caracteres.', true));
    modal(item ? 'Editar cuenta · ' + item.name : 'Nueva cuenta', form(fields, async (values, node) => {
      const data = app.db();
      const next = { name: values.name.trim(), login: values.login.trim(), role: values.role || item.role,
        parent: parent.disabled && item && !canParent ? item.parent : value(values.parent) };
      if (!item) next.password = await M.passwordHash(values.password, data.settings.iterations);
      if (!node.isConnected) return;
      app.stage({ action: item ? 'accountEdit' : 'accountCreate', id: item?.id, fields: next });
      accounts(item?.id || app.db().accounts.at(-1).id);
    }, item ? 'Preparar cambios' : 'Crear cuenta'));
  }

  function passwordForm(item) {
    modal('Restablecer contraseña · ' + item.name, form([
      field('Nueva contraseña', input('password', '', { type: 'password', required: true, minLength: 12, maxLength: 256, autocomplete: 'new-password' })),
      field('Repetir contraseña', input('repeat', '', { type: 'password', required: true, minLength: 12, maxLength: 256, autocomplete: 'new-password' }))
    ], async (values, node) => {
      M.check(values.password === values.repeat, 'Las contraseñas no coinciden.');
      const password = await M.passwordHash(values.password, A().db().settings.iterations);
      if (!node.isConnected) return;
      A().stage({ action: 'accountPassword', id: item.id, fields: { password } });
      accounts(item.id);
    }, 'Preparar restablecimiento'));
  }

  function policyTable(data, access, item, self) {
    const result = M.rights(data, item.id);
    const upper = M.rights(data, M.parentOf(data, item));
    const editable = !self && access.can('p.edit');
    const controls = [];
    const rows = Object.entries(M.permissions).map(([key, title]) => {
      const current = item.rules[key] || (item.id === data.owner ? { mode: 'allow', delegate: true } :
        { mode: 'inherit', delegate: false });
      const effective = result[key];
      const issuer = M.get(data.accounts, current.issuer);
      const canChange = M.canChangeIssuer(data, A().actor, current.issuer);
      const canRestrict = editable && canChange && access.can('p.restrict') && M.configurable(item.role, key);
      const canGrant = editable && canChange && access.can('p.delegate') && access.policy[key].delegate &&
        upper[key]?.delegate && M.configurable(item.role, key);
      const mode = select('mode-' + key, [
        ['inherit', 'Heredado', !canGrant && current.mode !== 'inherit'],
        ['allow', 'Permitido', !canGrant && current.mode !== 'allow'],
        ['deny', 'Denegado', !canRestrict && current.mode !== 'deny']
      ], current.mode, { disabled: !(canRestrict || canGrant), 'aria-label': 'Regla: ' + title });
      const delegate = input('delegate-' + key, 'yes', { type: 'checkbox', checked: current.delegate,
        disabled: current.mode === 'deny' || !(canGrant || (canRestrict && current.delegate)), 'aria-label': 'Delegable: ' + title });
      mode.onchange = () => {
        if (mode.value === 'deny') delegate.checked = false;
        delegate.disabled = mode.value === 'deny' || !(canGrant || (canRestrict && current.delegate));
      };
      controls.push({ key, current, mode, delegate });
      return el('tr', {}, el('td', {}, title), el('td', {}, mode),
        el('td', {}, effective.allowed ? 'Permitido' : 'Bloqueado'), el('td', {}, delegate,
          el('small', {}, effective.delegate ? ' Sí' : ' No')),
        el('td', {}, effective.reason, !canChange && issuer ? el('small', {}, ' · Regla fijada por ' + issuer.name) : null));
    });
    const table = el('div', { className: 'table-wrap' }, el('table', {}, el('thead', {}, el('tr', {},
      ['Permiso', 'Regla', 'Efectivo', 'Delegación', 'Motivo'].map(label => el('th', { scope: 'col' }, label)))),
    el('tbody', {}, rows)));
    if (!editable) return table;
    return el('div', { className: 'stack' }, table, group(button('Preparar permisos', run(() => {
      const commands = controls.filter(({ current, mode, delegate }) => current.mode !== mode.value || current.delegate !== delegate.checked)
        .map(({ key, mode, delegate }) => ({ action: 'accountPolicy', id: item.id,
          fields: { key, mode: mode.value, delegate: delegate.checked } }));
      A().stageMany(commands);
      accounts(item.id);
    }), { className: 'primary', glyph: 'check' })));
  }

  function restrictions(data, access, item, self) {
    const inherited = new Set(M.lineage(data, item.id).slice(1).flatMap(account => account.denied.map(rule => rule.resource)));
    const direct = new Map(item.denied.map(rule => [rule.resource, rule]));
    const editable = !self && access.can('p.edit') && access.can('p.restrict');
    const resources = [...data.categories.map(resource => ['c', resource]), ...data.tools.map(resource => ['t', resource])]
      .filter(([kind, resource]) => access.see(resource, kind, true, true));
    const options = resources.filter(([, resource]) => !inherited.has(resource.id) && !direct.has(resource.id))
      .map(([kind, resource]) => [resource.id, (kind === 'c' ? 'Categoría · ' : 'Herramienta · ') +
        [A().categoryPath(data, resource.parent), resource.name].filter(Boolean).join(' / ')]);
    return el('div', { className: 'stack' }, el('p', { className: 'muted small' },
      'Una restricción de categoría bloquea todo su árbol. Se heredan las restricciones de los superiores.'),
    ...resources.filter(([, resource]) => direct.has(resource.id) || inherited.has(resource.id)).map(([kind, resource]) =>
      group(el('span', {}, resource.name + (inherited.has(resource.id) ? ' · Heredada' : ' · Directa') +
        (direct.has(resource.id) ? ' · ' + M.get(data.accounts, direct.get(resource.id).issuer).name : '')),
        editable && direct.has(resource.id) && M.canChangeIssuer(data, A().actor, direct.get(resource.id).issuer) &&
          access.can('p.delegate') && access.policy[kind + '.view'].delegate ?
          button('Retirar restricción directa', run(() => {
            A().stage({ action: 'accountRestriction', id: item.id, fields: { resource: resource.id, deny: false } });
            accounts(item.id);
          })) : null)),
    editable && options.length ? form([field('Recurso que quieres restringir', select('resource', options), null, true)], fields => {
      A().stage({ action: 'accountRestriction', id: item.id, fields: { resource: fields.resource, deny: true } });
      accounts(item.id);
    }, 'Restringir recurso') : null);
  }

  function accounts(selected = A().actor, tab = 'general') {
    const app = A();
    const data = app.db();
    const access = app.ctx();
    M.check(app.editing && access.can('u.view'), 'Tu cuenta no puede administrar usuarios.');
    const visible = data.accounts.filter(item => item.id === app.actor || M.subordinate(data, app.actor, item.id));
    const item = M.get(visible, selected) || access.user;
    const self = item.id === app.actor;
    const parent = M.get(data.accounts, item.parent);
    const tree = [];
    function add(parent, depth) {
      for (const account of visible.filter(item => item.id !== app.actor && M.parentOf(data, item) === parent)) {
        const row = button(account.name + ' · ' + M.roles[account.role] + (account.enabled ? '' : ' · Deshabilitada'),
          () => accounts(account.id), { glyph: 'user', pressed: account.id === item.id });
        row.style.marginInlineStart = depth * 10 + 'px';
        tree.push(row);
        add(account.id, depth + 1);
      }
    }
    tree.push(button(access.user.name + ' · Tú', () => accounts(app.actor), { glyph: 'user', pressed: self }));
    add(app.actor, 0);
    const tabs = access.can('p.view') ? group(button('Cuenta', () => accounts(item.id), { pressed: tab === 'general' }),
      button('Permisos', () => accounts(item.id, 'policy'), { pressed: tab === 'policy' }),
      button('Acceso a recursos', () => accounts(item.id, 'resources'), { pressed: tab === 'resources' })) : null;
    const general = group(
      !self && access.can('u.edit') ? button('Editar cuenta', () => accountForm(item), { glyph: 'edit' }) : null,
      !self && access.can(item.enabled ? 'u.disable' : 'u.enable') ? button(item.enabled ? 'Deshabilitar cuenta' : 'Habilitar cuenta',
        run(() => {
          if (item.enabled && !window.confirm('¿Deshabilitar a ' + item.name + '?')) return;
          app.stage({ action: 'accountEnabled', id: item.id, value: !item.enabled });
          accounts(item.id);
        }), { glyph: 'lock' }) : null,
      !self && access.can('u.reset') ? button('Restablecer contraseña', () => passwordForm(item), { glyph: 'lock' }) : null
    );
    modal('Cuentas y permisos', el('div', { className: 'account-grid' },
      el('div', { className: 'stack' }, el('div', { className: 'accounts-tree panel', 'aria-label': 'Jerarquía de cuentas' }, tree),
        access.can('u.create') ? button('Nueva cuenta', () => accountForm(null), { glyph: 'plus', className: 'primary' }) : null),
      el('section', { className: 'stack account-section' }, el('h3', {}, item.name),
        el('p', { className: 'muted small' }, item.login + ' · ' + M.roles[item.role] + ' · ' +
          (item.enabled ? 'Activa' : 'Deshabilitada') + ' · Superior: ' + (parent?.name ||
          (item.id === data.owner ? 'Cuenta propietaria' : 'Ámbito administrativo propio'))),
        tabs, tab === 'policy' && access.can('p.view') ? policyTable(data, access, item, self) :
          tab === 'resources' && access.can('p.view') ? restrictions(data, access, item, self) : general)), true);
  }

  root.WorkMateEditor = { edit, options, bindDrag, accounts };
})(globalThis);
