(function (root) {
  'use strict';
  const M = root.WorkMateModel;
  const $ = id => document.getElementById(id);
  const svgNS = 'http://www.w3.org/2000/svg';
  // File, folder and check use the line geometry and weight of CSV MATCH.
  const artwork = {
    file: '<path d="M6 2h8l4 4v16H6zM14 2v5h4M9 12h6m-6 4h6"/>',
    folder: '<path d="M3 6h7l2 2h9v12H3z"/><path d="M3 11h18"/>',
    compare: '<path d="M4 2h9l4 4v6M4 2v19h9M13 2v5h4M7 10h5m-5 4h3"/><circle cx="16" cy="16" r="4"/><path d="m19 19 3 3"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
    link: '<path d="m10 13 4-4m-6 7-2 2a3 3 0 0 1-4-4l5-5a3 3 0 0 1 4 0m2 6a3 3 0 0 0 4 0l5-5a3 3 0 0 0-4-4l-2 2"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8" cy="9" r="1.5"/><path d="m4 17 5-4 3 3 4-5 5 5"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="m10 3 4 0 .7 2.7 2.2 1.3 2.7-.7 2 3.4-1.9 2 .1 2.5 1.7 1.9-2 3.4-2.7-.7-2.2 1.3L14 23h-4l-.7-2.9-2.2-1.3-2.7.7-2-3.4 1.8-2v-2.5L2.4 9.7l2-3.4 2.7.7 2.2-1.3z"/>',
    users: '<circle cx="9" cy="7" r="3"/><path d="M2 20v-2a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v2m1-16a3 3 0 0 1 0 6m2 4a4 4 0 0 1 3 4v2"/>',
    user: '<circle cx="12" cy="7" r="4"/><path d="M4 21v-2a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v2"/>',
    shield: '<path d="m12 2 8 3v6c0 5-3 8-8 11-5-3-8-6-8-11V5z"/><path d="m8 12 3 3 5-6"/>',
    menu: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16m3-8h6m-4-2-2 2 2 2"/>',
    expand: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16m3-8h6m-2-2 2 2-2 2"/>',
    down: '<path d="m6 9 6 6 6-6"/>', right: '<path d="m9 6 6 6-6 6"/>', up: '<path d="m6 15 6-6 6 6"/>',
    star: '<path d="m12 2 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
    list: '<path d="M8 5h13M8 12h13M8 19h13M3 5h1m-1 7h1m-1 7h1"/>',
    more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 4v3"/>',
    logout: '<path d="M12 4H4v16h8m-2-8h12m-4-4 4 4-4 4"/>',
    open: '<path d="M13 3h8v8m0-8-9 9m7 2v7H3V5h7"/>',
    home: '<path d="m2 11 10-8 10 8m-3-2v12h-5v-6h-4v6H5V9"/>',
    edit: '<path d="m4 15-1 6 6-1L21 8l-5-5zM14 5l5 5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    hidden: '<path d="M3 3l18 18M2 12s2-4 6-6m4-1c6 0 10 7 10 7s-1 2-3 4m-3 2a11 11 0 0 1-4 1c-6 0-10-7-10-7"/>',
    disk: '<path d="M4 3h13l3 3v15H4zM8 3v6h8V3M8 21v-7h8v7"/>',
    undo: '<path d="M3 11h11a5 5 0 0 1 0 10h-4M3 11l5-5m-5 5 5 5"/>',
    redo: '<path d="M21 11H10a5 5 0 0 0 0 10h4m7-10-5-5m5 5-5 5"/>',
    check: '<path d="m4 12 5 5 11-11"/>',
    copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/>'
  };

  function el(tag, props, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props || {})) {
      if (value === undefined || value === null) continue;
      if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else if (key in node && !key.startsWith('aria')) node[key] = value;
      else node.setAttribute(key, value);
    }
    node.append(...children.flat(Infinity).filter(child => child !== null && child !== undefined && child !== false));
    return node;
  }

  function icon(name) {
    if (name?.startsWith('data:image/') && M.validIcon(name)) return el('img', { className: 'icon', src: name, alt: '' });
    const node = document.createElementNS(svgNS, 'svg');
    for (const [key, value] of Object.entries({ class: 'icon', viewBox: '0 0 24 24', fill: 'none',
      stroke: 'currentColor', 'stroke-width': 1.7, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) {
      node.setAttribute(key, value);
    }
    node.innerHTML = Object.hasOwn(artwork, name) ? artwork[name] : artwork.file;
    return node;
  }

  function button(label, action, options = {}) {
    const { glyph, only, className = '', title, disabled, pressed, expanded, controls, id } = options;
    return el('button', { type: 'button', id, className: className + (only ? ' icon-button' : ''),
      title: title || (only ? label : undefined), 'aria-label': only ? label : undefined, disabled,
      'aria-pressed': pressed, 'aria-expanded': expanded, 'aria-controls': controls, onclick: action },
    glyph && icon(glyph), !only ? label : null);
  }

  const group = (...children) => el('div', { className: 'actions' }, ...children);
  const field = (label, input, help, full = false) => el('label', { className: 'field' + (full ? ' full' : '') },
    el('span', {}, label), input, help ? el('small', {}, help) : null);
  const input = (name, value = '', options = {}) => el('input', { name, value, ...options });
  function select(name, entries, value, extra = {}) {
    const node = el('select', { name, ...extra }, entries.map(([id, label, disabled]) => el('option', { value: id, disabled }, label)));
    if (value !== undefined) node.value = value;
    return node;
  }

  function form(children, submit, label = 'Aceptar') {
    const error = el('p', { className: 'form-error full', role: 'alert', hidden: true });
    const submitButton = el('button', { type: 'submit', className: 'primary' }, label);
    const node = el('form', { className: 'form-grid' }, children, error,
      el('div', { className: 'modal-actions full' }, submitButton));
    node.addEventListener('submit', async event => {
      event.preventDefault();
      if (submitButton.disabled) return;
      submitButton.disabled = true;
      error.hidden = true;
      try { await submit(Object.fromEntries(new FormData(node)), node); }
      catch (failure) {
        error.textContent = message(failure);
        error.hidden = false;
      } finally { submitButton.disabled = false; }
    });
    return node;
  }

  function modal(title, content, wide = false) {
    $('modal').classList.toggle('wide', wide);
    $('modal-title').textContent = title;
    $('modal-body').replaceChildren(content);
    if (!$('modal').open) $('modal').showModal();
    else $('modal-title').focus({ preventScroll: true });
  }

  function close() {
    if ($('modal').open) $('modal').close();
    $('modal-body').replaceChildren();
  }

  function pickFile(callback, accept = '.json,application/json') {
    const picker = input('archivo', '', { type: 'file', accept, className: 'sr-only', tabIndex: -1 });
    picker.setAttribute('aria-label', 'Seleccionar archivo local');
    picker.addEventListener('change', () => {
      const file = picker.files[0];
      if (file) Promise.resolve().then(() => callback(file)).catch(error => notify(message(error), true));
      picker.remove();
    }, { once: true });
    picker.addEventListener('cancel', () => picker.remove(), { once: true });
    ($('modal').open ? $('modal') : document.body).append(picker);
    picker.click();
  }

  let timer;
  function notify(text, error = false) {
    clearTimeout(timer);
    const node = $('notice');
    node.textContent = text;
    node.classList.toggle('error', error);
    node.hidden = false;
    if ($('modal').open) {
      // Keep notices above the native modal backdrop.
      $('modal').append(node);
    } else document.body.append(node);
    timer = setTimeout(() => { node.hidden = true; }, error ? 10000 : 5500);
  }

  function message(error) {
    const errors = {
      AbortError: 'Se canceló la operación.',
      NotAllowedError: 'El navegador no concedió acceso al archivo. Puedes usar el modo JSON manual.',
      SecurityError: 'Este contexto no permite el selector directo. Usa el modo JSON manual.',
      NotReadableError: 'No se puede leer el archivo seleccionado.',
      NotFoundError: 'No se encontró el archivo seleccionado. Comprueba que no se haya movido.',
      QuotaExceededError: 'El navegador o el disco no tienen espacio disponible para esta operación.',
      NoModificationAllowedError: 'El destino está bloqueado o abierto en otra escritura.'
    };
    return errors[error?.name] || error?.message || 'No se pudo completar la operación.';
  }

  function run(fn) {
    return async event => {
      try { await fn(event); }
      catch (error) { if (error.name !== 'AbortError') notify(message(error), true); }
    };
  }

  async function copy(value) {
    try { await navigator.clipboard.writeText(value); }
    catch {
      const box = el('textarea', { value, className: 'sr-only', 'aria-label': 'Texto para copiar' });
      ($('modal').open ? $('modal') : document.body).append(box);
      box.select();
      let success;
      try { success = document.execCommand('copy'); } finally { box.remove(); }
      M.check(success, 'Selecciona la ruta y cópiala con Ctrl+C.');
    }
    notify('Destino copiado.');
  }

  async function readIcon(file) {
    M.check(file.size <= 256 * 1024, 'La imagen debe ocupar como máximo 256 KiB.');
    let source = file;
    if (file.type === 'image/svg+xml' || /\.svg$/i.test(file.name)) {
      const raw = await file.text();
      M.check(!/<!DOCTYPE|<!ENTITY|<\?/i.test(raw), 'El SVG contiene instrucciones XML no admitidas.');
      const doc = new DOMParser().parseFromString(raw, 'image/svg+xml');
      const allowed = new Set(['svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon']);
      const attrs = new Set(['viewBox', 'width', 'height', 'd', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'rx', 'ry', 'cx',
        'cy', 'r', 'points', 'fill', 'fill-rule', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'opacity']);
      const elements = [...doc.querySelectorAll('*')];
      M.check(doc.documentElement.localName === 'svg' && elements.length <= 200 && elements.every(node =>
        node.namespaceURI === svgNS && allowed.has(node.localName) && [...node.attributes].every(attr =>
          (attr.name === 'xmlns' && attr.value === svgNS) ||
          (attrs.has(attr.name) && /^[a-zA-Z0-9#.,%+\s-]{1,6000}$/.test(attr.value)))),
      'El SVG solo puede contener formas y atributos gráficos sencillos, sin código ni referencias.');
      const svg = doc.documentElement;
      if (!svg.hasAttribute('viewBox')) {
        svg.setAttribute('viewBox', '0 0 ' + (parseFloat(svg.getAttribute('width')) || 96) + ' ' +
          (parseFloat(svg.getAttribute('height')) || 96));
      }
      svg.setAttribute('width', '96');
      svg.setAttribute('height', '96');
      source = new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' });
    } else {
      const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
      M.check(file.type.startsWith('image/') && M.rasterSignature(file.type.slice(6), String.fromCharCode(...header)),
        'Selecciona una imagen PNG, JPEG, WebP, GIF o un SVG de formas sencillas.');
    }

    const url = URL.createObjectURL(source);
    try {
      const image = el('img', { src: url });
      await image.decode();
      M.check(image.naturalWidth && image.naturalHeight && image.naturalWidth <= 4096 && image.naturalHeight <= 4096,
        'La imagen supera el tamaño máximo de 4096 × 4096.');
      const canvas = el('canvas', { width: 96, height: 96 });
      const ratio = Math.min(96 / image.naturalWidth, 96 / image.naturalHeight);
      const w = image.naturalWidth * ratio;
      const h = image.naturalHeight * ratio;
      canvas.getContext('2d').drawImage(image, (96 - w) / 2, (96 - h) / 2, w, h);
      return canvas.toDataURL('image/png');
    } catch (error) {
      if (error.name === 'EncodingError') throw new Error('La imagen está dañada o el navegador no puede leerla.');
      throw error;
    } finally { URL.revokeObjectURL(url); }
  }

  function panel(title, glyph, ...children) {
    return el('section', { className: 'panel' }, el('h2', { className: 'panel-header' }, icon(glyph), title),
      el('div', { className: 'panel-body' }, children));
  }

  $('close-modal').addEventListener('click', close);
  $('modal').addEventListener('close', () => {
    if (!$('modal').open) document.body.append($('notice'));
  });

  root.WorkMateUI = { $, el, icon, button, group, field, input, select, form, modal, close, pickFile,
    notify, message, run, copy, readIcon, panel };
})(globalThis);
