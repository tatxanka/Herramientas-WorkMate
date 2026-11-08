(() => {
  'use strict';

  const appURL = document.currentScript.src;
  const styleURL = new URL('../css/styles.css', appURL).href;
  const createEngine = globalThis.CSVMatchEngine;
  const engine = createEngine();
  const integer = new Intl.NumberFormat('es-ES', { useGrouping: 'always' });
  const decimal = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 });
  const iconPaths = {
    logo: '<path d="M16 22H3V2h12l4 4v5M14 2v5h5M7 8h3M7 12h7M7 16h4"/><circle cx="17" cy="16" r="4"/><path d="m20 19 3 3"/>',
    file: '<path d="M6 2h8l5 5v15H6zM13 2v6h6M9 12h7M9 16h7"/>',
    folder: '<path d="M3 18V6h7l2 2h9v3M3 18l4-8h15l-4 8z"/>',
    settings: '<circle cx="12" cy="12" r="4"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2"/>',
    chart: '<path d="M4 20v-6m5 6v-9m5 9V7m5 13V4"/>',
    check: '<path d="m6 12 4 4 8-8"/>',
    cross: '<path d="m7 7 10 10M17 7 7 17"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
    data: '<ellipse cx="12" cy="6" rx="8" ry="4"/><path d="M4 6v12c0 2 4 4 8 4s8-2 8-4V6M4 12c0 2 4 4 8 4s8-2 8-4"/>',
    play: '<path d="m8 4 13 8-13 8z" fill="currentColor" stroke="none"/>',
    download: '<path d="M12 3v12m-5-5 5 5 5-5M3 15v6h18v-6"/>',
    chevron: '<path d="m7 10 5 5 5-5"/>'
  };

  function icon(name, extra = '') {
    return `<svg class="icon ${extra}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${iconPaths[name]}</svg>`;
  }

  function panel(number, description) {
    return `<section class="panel file-panel" data-panel="${number - 1}" aria-labelledby="csv-${number}">
      <h2 id="csv-${number}">${icon('file')} CSV ${number} <small>${description}</small></h2>
      <div class="file-body">
        <div class="file-line">
          <div class="file-status"><span class="file-check" hidden>${icon('check', 'positive badge')}</span><strong class="file-name">Sin archivo</strong><span class="file-meta"></span></div>
          <label class="file-picker">${icon('folder')}<span>Seleccionar archivo</span><input class="file-input" type="file" accept=".csv,.xlsx,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" aria-label="Seleccionar archivo CSV o XLSX en el panel ${number}"></label>
        </div>
        <div class="file-settings" hidden>
          <div class="columns"></div>
          <p class="header-warning" hidden></p>
          <p class="preview-label" id="preview-${number}">Vista previa (primeros 10 registros)</p>
          <div class="table-wrap" tabindex="0" role="region" aria-labelledby="preview-${number}"></div>
        </div>
        <p class="file-hint">CSV UTF-8 con coma o punto y coma, o Excel (.xlsx).</p>
      </div>
    </section>`;
  }

  const template = document.createElement('template');
  template.innerHTML = `<link rel="stylesheet" href="${styleURL}">
    <main class="frame" aria-label="CSV MATCH">
      <header class="top">
        <div class="identity">${icon('logo')} <h1>CSV <span>MATCH</span></h1></div>
        <p class="subtitle">Comparador y buscador de archivos CSV y XLSX</p>
        <ol class="steps" aria-label="Pasos del proceso">
          <li aria-current="step"><span>1</span> Cargar archivos</li><li><span>2</span> Configurar</li><li><span>3</span> Ejecutar</li>
        </ol>
      </header>
      <div class="body">
        <div class="tabs" role="tablist" aria-label="Herramienta">
          <button id="tab-compare" role="tab" aria-selected="true" aria-controls="workspace" type="button" data-mode="compare">Comparar archivos</button>
          <button id="tab-search" role="tab" aria-selected="false" aria-controls="workspace" tabindex="-1" type="button" data-mode="search">Buscar texto</button>
        </div>
        <div id="workspace" role="tabpanel" aria-labelledby="tab-compare">
          <div class="files">${panel(1, 'Archivo origen')}${panel(2, 'Archivo de comparación')}</div>
          <section class="panel config" aria-labelledby="config-title">
            <h2 id="config-title">${icon('settings')} <span>Configuración de comparación</span></h2>
            <form novalidate>
              <div class="query" hidden>
                <label for="query">Texto que deseas buscar</label>
                <input id="query" type="text" placeholder="Escribe un nombre, teléfono, código, palabra o frase..." autocomplete="off" spellcheck="false">
                <fieldset class="scope"><legend>Buscar en</legend>
                  <label><input type="radio" name="scope" value="0" checked> CSV 1</label>
                  <label><input type="radio" name="scope" value="1"> CSV 2</label>
                  <label><input type="radio" name="scope" value="both"> Ambos</label>
                </fieldset>
              </div>
              <div class="config-grid">
                <fieldset><legend>Tipo de coincidencia</legend>
                  <label><input type="radio" name="match" value="exact" checked> <span id="exact-label">Coincidencia exacta</span></label>
                  <label><input type="radio" name="match" value="partial"> <span id="partial-label">Coincidencia parcial</span></label>
                </fieldset>
                <fieldset><legend>Normalización (opcional)</legend>
                  <label><input type="checkbox" name="caseFold"> Ignorar mayúsculas y minúsculas</label>
                  <label><input type="checkbox" name="trim"> Ignorar espacios al inicio y al final</label>
                  <label><input type="checkbox" name="accents"> Ignorar acentos y diacríticos</label>
                </fieldset>
                <div class="run-area"><button class="action green run" type="button">${icon('play')} <span>Ejecutar comparación</span></button></div>
              </div>
              <p class="instructions" id="instructions"></p>
            </form>
          </section>
          <p class="notice" role="alert" hidden></p>
          <p class="sr-only announce" role="status"></p>
          <section class="panel progress-panel" aria-labelledby="progress-title" hidden>
            <h2 id="progress-title">${icon('chart')} Progreso del proceso</h2>
            <div class="progress-grid">
              <div class="progress-main"><div class="phase" id="phase">Preparando…</div><div class="track"><progress aria-labelledby="phase" max="1"></progress><span class="percent" aria-hidden="true"></span></div></div>
              <div class="metric">${icon('data')}<div><span>Procesados</span><strong class="processed">0</strong></div></div>
              <div class="metric">${icon('check', 'positive badge')}<div><span class="found-label">Coincidencias</span><strong class="found">0</strong></div></div>
              <div class="metric">${icon('clock')}<div><span>Tiempo</span><strong class="elapsed">00:00:00</strong></div></div>
              <button class="cancel" type="button">Cancelar</button>
            </div>
          </section>
          <section class="panel results" aria-labelledby="results-title" hidden>
            <h2 id="results-title">${icon('file')} Resumen de resultados</h2><div class="results-body"></div>
          </section>
        </div>
      </div>
    </main>`;

  function timeLabel(ms) {
    const seconds = Math.floor(ms / 1000);
    return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map(n => String(n).padStart(2, '0')).join(':');
  }

  function sizeLabel(bytes) {
    const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
    let unit = 0;
    while (bytes >= 1024 && unit < units.length - 1) { bytes /= 1024; unit++; }
    return `${decimal.format(bytes)} ${units[unit]}`;
  }

  function percent(found, total) { return `${decimal.format(total ? found * 100 / total : 0)} %`; }

  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  function table(headings, rows) {
    if (!rows.length) return element('p', 'Sin registros para mostrar.', 'empty');
    const node = element('table');
    const header = node.createTHead().insertRow();
    headings.forEach((value, index) => {
      const cell = element('th', value || `Columna ${index + 1}`);
      cell.scope = 'col';
      header.append(cell);
    });
    const body = node.createTBody();
    for (const row of rows) {
      const tr = body.insertRow();
      row.forEach(value => { tr.insertCell().textContent = value; });
    }
    return node;
  }

  let xlsxLibrary;
  function getXlsxLibrary() {
    xlsxLibrary ??= new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = new URL('vendor/sheetjs-0.20.3.js', appURL).href;
      script.onload = () => resolve(globalThis.CSVMatchXlsxLibrary);
      script.onerror = () => {
        script.remove();
        xlsxLibrary = null;
        reject(new Error('No se pudo cargar el lector XLSX local. Comprueba que la carpeta js/vendor esté junto a la aplicación.'));
      };
      document.head.append(script);
    });
    return xlsxLibrary;
  }

  async function runJob(type, data, io) {
    const library = type === 'importXlsx' ? await getXlsxLibrary() : undefined;
    io.signal.throwIfAborted();
    const fallback = () => (library ? createEngine(library) : engine).run(type, data, { ...io, mainThread: true });
    let worker;
    const librarySource = library ? `(${library.toString()})` : '';
    const url = URL.createObjectURL(new Blob([`(${createEngine.toString()})(${librarySource}).listen();`], { type: 'text/javascript' }));
    try { worker = new Worker(url); }
    catch { URL.revokeObjectURL(url); return fallback(); }
    let ready = false;
    let cancel;
    try {
      return await new Promise((resolve, reject) => {
        cancel = () => reject(io.signal.reason);
        io.signal.addEventListener('abort', cancel, { once: true });
        if (io.signal.aborted) { cancel(); return; }
        worker.onerror = event => {
          event.preventDefault();
          reject(new Error('El motor de procesamiento se ha interrumpido.'));
        };
        worker.onmessageerror = () => reject(new Error('No se pudo leer la respuesta del motor de procesamiento.'));
        worker.onmessage = async ({ data: message }) => {
          try {
            switch (message.kind) {
              case 'ready':
                worker.postMessage({ type, data });
                ready = true;
                break;
              case 'progress': io.progress(message.progress); break;
              case 'chunk':
                await io.write(message.data);
                io.signal.throwIfAborted();
                worker.postMessage({ kind: 'ack' });
                break;
              case 'done': resolve(message.result); break;
              case 'error': reject(new Error(message.message)); break;
            }
          } catch (error) { reject(error); }
        };
      });
    } catch (error) {
      if (ready || io.signal.aborted) throw error;
    } finally {
      io.signal.removeEventListener('abort', cancel);
      worker.terminate();
      URL.revokeObjectURL(url);
    }
    return fallback();
  }

  function defaultOptions() { return { caseFold: false, trim: false, accents: false }; }

  function sharesTopOrigin() {
    try { return Boolean(window.top.document); }
    catch { return false; }
  }

  const STAGED_LIMIT = 512 * 1024 * 1024;
  const STAGED_TTL = 10 * 60 * 1000;

  async function stageDownload(bytes) {
    if (!sharesTopOrigin() || !navigator.storage?.getDirectory || bytes > STAGED_LIMIT) return null;
    let directory;
    try {
      const root = await navigator.storage.getDirectory();
      const quota = await navigator.storage.estimate?.();
      if (quota?.quota !== undefined && quota.quota - (quota.usage ?? 0) < bytes) {
        throw new Error('No hay espacio temporal suficiente para esta descarga. Usa el guardado directo o libera espacio en el navegador.');
      }
      directory = await root.getDirectoryHandle('csv-match-exports-v1', { create: true });
    } catch (error) {
      if (['SecurityError', 'NotAllowedError', 'NotSupportedError'].includes(error.name)) return null;
      throw error;
    }
    for await (const [name, entry] of directory.entries()) {
      const created = /^([0-9]{13})-[0-9a-f-]{36}\.csv$/.exec(name);
      if (entry.kind === 'file' && created && Date.now() - Number(created[1]) > STAGED_TTL) {
        await directory.removeEntry(name).catch(() => {});
      }
    }
    const key = `${Date.now()}-${crypto.randomUUID()}.csv`;
    const handle = await directory.getFileHandle(key, { create: true });
    const discard = () => directory.removeEntry(key).catch(() => {});
    try { return { handle, writer: await handle.createWritable({ mode: 'exclusive' }), discard }; }
    catch (error) { await discard(); throw error; }
  }

  class CsvMatch extends HTMLElement {
    constructor() {
      super();
      this.ui = this.attachShadow({ mode: 'open' });
      this.ui.append(template.content.cloneNode(true));
      this.mode = 'compare';
      this.files = [null, null];
      this.config = {
        compare: { columns: [[], []], partial: false, options: defaultOptions() },
        search: { columns: [null, null], partial: true, options: defaultOptions(), scope: '0', query: '' }
      };
      this.panels = [...this.ui.querySelectorAll('.file-panel')];
      this.tabs = [...this.ui.querySelectorAll('[role=tab]')];
      this.form = this.$('form');
      this.runButton = this.$('.run');
      this.cancelButton = this.$('.cancel');
      this.progressPanel = this.$('.progress-panel');
      this.resultsPanel = this.$('.results');
      this.downloadURLs = new Set();
      this.bind();
      this.renderMode();
    }

    $(selector) { return this.ui.querySelector(selector); }

    bind() {
      this.panels.forEach((panel, index) => {
        const input = panel.querySelector('.file-input');
        input.addEventListener('click', event => {
          if (!event.isTrusted || this.job || !sharesTopOrigin() || typeof window.showOpenFilePicker !== 'function') return;
          event.preventDefault();
          this.pickInput(index, input);
        });
        input.addEventListener('change', ({ target }) => {
          const file = target.files[0];
          target.value = '';
          if (file) this.load(index, file);
        });
      });
      for (const tab of this.tabs) tab.addEventListener('click', () => this.switchMode(tab.dataset.mode));
      this.$('.tabs').addEventListener('keydown', event => {
        const index = this.tabs.indexOf(event.target);
        if (index < 0 || this.job || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const next = this.tabs[event.key === 'Home' ? 0 : event.key === 'End' ? 1 : 1 - index];
        this.switchMode(next.dataset.mode);
        next.focus();
      });
      this.form.addEventListener('input', ({ target }) => {
        if (target.id === 'query') this.config.search.query = target.value;
        else if (target.name === 'scope') this.config.search.scope = target.value;
        else if (target.name === 'match') this.config[this.mode].partial = target.value === 'partial';
        else this.config[this.mode].options[target.name] = target.checked;
        this.invalidate();
      });
      this.form.addEventListener('submit', event => event.preventDefault());
      this.runButton.addEventListener('click', () => this.execute());
      this.$('#query').addEventListener('keydown', event => {
        if (event.key !== 'Enter' || event.isComposing) return;
        event.preventDefault();
        this.runButton.click();
      });
      this.cancelButton.addEventListener('click', () => this.job?.controller.abort());
      this.ui.addEventListener('click', ({ target }) => {
        for (const details of this.ui.querySelectorAll('details[open]')) {
          if (!details.contains(target)) details.open = false;
        }
      });
      this.ui.addEventListener('keydown', event => {
        const details = event.target.closest('details[open]');
        if (event.key === 'Escape' && details) {
          details.open = false;
          details.querySelector('summary').focus();
        }
      });
    }

    disconnectedCallback() {
      this.job?.controller.abort();
      for (const url of this.downloadURLs) URL.revokeObjectURL(url);
      this.downloadURLs.clear();
    }

    switchMode(mode) {
      if (this.job || mode === this.mode) return;
      this.mode = mode;
      this.renderMode();
      this.invalidate();
    }

    renderMode() {
      const search = this.mode === 'search';
      const config = this.config[this.mode];
      for (const tab of this.tabs) {
        const active = tab.dataset.mode === this.mode;
        tab.setAttribute('aria-selected', String(active));
        tab.tabIndex = active ? 0 : -1;
      }
      this.$('#workspace').setAttribute('aria-labelledby', `tab-${this.mode}`);
      this.$('.query').hidden = !search;
      this.$('#config-title span').textContent = search ? 'Configuración de búsqueda' : 'Configuración de comparación';
      this.$('#exact-label').textContent = search ? 'Exacta' : 'Coincidencia exacta';
      this.$('#partial-label').textContent = search ? 'Contiene' : 'Coincidencia parcial';
      this.$('.run span').textContent = search ? 'Buscar texto' : 'Ejecutar comparación';
      this.$('#instructions').textContent = search
        ? 'Carga uno o dos archivos, escribe el texto y elige dónde buscar. Después podrás descargar los registros encontrados.'
        : 'Cada fila del CSV 1 coincide si su valor aparece en cualquiera de las columnas seleccionadas del CSV 2.';
      this.form.elements.match.value = config.partial ? 'partial' : 'exact';
      for (const [key, value] of Object.entries(config.options)) this.form.elements[key].checked = value;
      this.form.elements.scope.value = this.config.search.scope;
      this.$('#query').value = this.config.search.query;
      this.panels.forEach((panel, index) => this.renderColumns(index));
      this.updateControls();
    }

    invalidate() {
      this.result = null;
      this.resultsPanel.hidden = this.progressPanel.hidden = true;
      this.$('.results-body').replaceChildren();
      this.notice('');
      this.updateControls();
    }

    notice(message, status = false, openTool = false) {
      const node = this.$('.notice');
      node.textContent = message;
      if (openTool) {
        const link = element('a', 'Abrir CSV MATCH en otra pestaña');
        link.href = new URL('../index.html', appURL).href;
        link.target = '_blank';
        link.rel = 'noopener';
        node.append(' ', link);
      }
      node.classList.toggle('info', status);
      node.hidden = !message;
    }

    activeFiles() {
      if (this.mode === 'compare' || this.config.search.scope === 'both') return [0, 1];
      return [Number(this.config.search.scope)];
    }

    selectedColumns(index) {
      return this.config[this.mode].columns[index] ?? this.files[index].columns.map((_, position) => position);
    }

    updateControls() {
      const busy = Boolean(this.job);
      const active = this.activeFiles();
      const config = this.config[this.mode];
      const search = this.mode === 'search';
      const ready = active.every(index => this.files[index] && this.selectedColumns(index).length) &&
        (!search || Boolean(config.query.trim() && engine.normalizer(config.options)(config.query)));
      this.runButton.disabled = busy || !ready;
      for (const control of this.ui.querySelectorAll('input, select, [role=tab], .download')) {
        control.disabled = busy;
      }
      for (const details of this.ui.querySelectorAll('details')) {
        if (busy) details.open = false;
        details.querySelector('summary').tabIndex = busy ? -1 : 0;
        details.querySelector('summary').setAttribute('aria-disabled', String(busy));
      }
      this.$('.frame').classList.toggle('busy', busy);
      const step = this.result || busy ? 2 : active.every(index => this.files[index]) ? 1 : 0;
      [...this.$('.steps').children].forEach((item, index) => {
        if (step === index) item.setAttribute('aria-current', 'step');
        else item.removeAttribute('aria-current');
      });
    }

    async pickInput(index, input) {
      try {
        const [handle] = await window.showOpenFilePicker({ types: [{ description: 'CSV o Excel', accept: {
          'text/csv': ['.csv'], 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx']
        } }] });
        if (handle) await this.load(index, await handle.getFile(), handle);
      } catch (error) {
        if (['SecurityError', 'NotSupportedError', 'NotAllowedError'].includes(error.name)) input.click();
        else if (error.name !== 'AbortError') this.notice('No se pudo abrir el archivo seleccionado.');
      }
    }

    async load(index, file, handle) {
      this.invalidate();
      await this.withJob(`Leyendo el archivo ${index + 1}`, async io => {
        const format = /\.xlsx$/i.test(file.name) ? 'importXlsx' : 'inspect';
        const metadata = await runJob(format, file, io);
        this.files[index] = { file, originalFile: file, handle, ...metadata };
        this.config.compare.columns[index] = [0];
        this.config.search.columns[index] = null;
        if (!this.files[1 - index]) this.config.search.scope = String(index);
        this.form.elements.scope.value = this.config.search.scope;
        this.renderFile(index);
        this.renderColumns(index);
        this.progressPanel.hidden = true;
        this.$('.announce').textContent = `Archivo ${index + 1} cargado. ${metadata.columns.length} columnas.`;
      });
    }

    renderFile(index) {
      const panel = this.panels[index];
      const { originalFile: file, columns, rows, count, duplicates, unnamed, sheetName } = this.files[index];
      panel.querySelector('.file-name').textContent = file.name;
      const summary = [count === null ? null : `${integer.format(count)} registros`, `${integer.format(columns.length)} columnas`, sizeLabel(file.size)];
      panel.querySelector('.file-meta').textContent = `(${summary.filter(Boolean).join(', ')})${sheetName ? ` · Hoja: ${sheetName}` : ''}`;
      panel.querySelector('.file-check').hidden = false;
      panel.querySelector('.file-picker span').textContent = 'Cambiar archivo';
      panel.querySelector('.file-input').setAttribute('aria-label', `Cambiar archivo del panel ${index + 1}`);
      panel.querySelector('.file-hint').hidden = true;
      panel.querySelector('.file-settings').hidden = false;
      const warning = panel.querySelector('.header-warning');
      warning.textContent = duplicates || unnamed ? 'Hay encabezados repetidos o vacíos. Selecciona las columnas por su posición.' : '';
      warning.hidden = !warning.textContent;
      panel.querySelector('.table-wrap').replaceChildren(table(columns, rows));
    }

    renderColumns(index) {
      const loaded = this.files[index];
      if (!loaded) return;
      const mount = this.panels[index].querySelector('.columns');
      const search = this.mode === 'search';
      const single = !search && index === 0;
      const label = element('label', single ? 'Columna de búsqueda' : 'Columnas de búsqueda (una o más)', 'column-label');
      label.id = `columns-label-${index}`;
      const labelFor = position => `${position + 1}. ${loaded.columns[position] || '(sin nombre)'}`;
      const config = this.config[this.mode];
      if (single) {
        const select = element('select');
        select.id = `columns-${index}`;
        label.htmlFor = select.id;
        loaded.columns.forEach((_, position) => {
          const option = element('option', labelFor(position));
          option.value = position;
          select.append(option);
        });
        select.value = config.columns[index][0];
        select.addEventListener('change', () => {
          config.columns[index] = [Number(select.value)];
          this.invalidate();
        });
        mount.replaceChildren(label, select);
        return;
      }

      const details = element('details', undefined, 'multiselect');
      const summary = element('summary');
      const chips = element('span', undefined, 'chips');
      chips.id = `chips-${index}`;
      summary.setAttribute('aria-labelledby', `${label.id} ${chips.id}`);
      summary.append(chips);
      summary.insertAdjacentHTML('beforeend', icon('chevron'));
      summary.addEventListener('click', event => { if (this.job) event.preventDefault(); });
      const list = element('div', undefined, 'column-options');
      const refresh = () => {
        const selected = config.columns[index];
        if (selected?.length > 3) {
          const columns = selected.map(labelFor).join(' · ');
          summary.title = columns;
          summary.setAttribute('aria-description', columns);
        } else {
          summary.removeAttribute('title');
          summary.removeAttribute('aria-description');
        }
        chips.replaceChildren();
        if (selected === null) chips.append(element('span', 'Todas las columnas', 'chip'));
        else if (!selected.length) chips.append(element('span', 'Selecciona columnas'));
        else {
          for (const position of selected.slice(0, 3)) chips.append(element('span', labelFor(position), 'chip'));
          if (selected.length > 3) chips.append(element('span', `+${selected.length - 3}`, 'chip'));
        }
      };
      const change = (input, caption, listener) => {
        input.type = 'checkbox';
        const option = element('label');
        option.append(input, document.createTextNode(caption));
        input.addEventListener('change', listener);
        list.append(option);
      };
      const all = search ? element('input') : null;
      if (all) change(all, 'Todas las columnas', () => {
        config.columns[index] = all.checked ? null : [];
        for (const checkbox of inputs) checkbox.checked = all.checked;
        refresh();
        this.invalidate();
      });
      const inputs = loaded.columns.map((_, position) => {
        const input = element('input');
        input.checked = config.columns[index]?.includes(position) ?? true;
        change(input, labelFor(position), () => {
          const selected = inputs.flatMap((checkbox, offset) => checkbox.checked ? [offset] : []);
          config.columns[index] = search && selected.length === inputs.length ? null : selected;
          if (all) all.checked = config.columns[index] === null;
          refresh();
          this.invalidate();
        });
        return input;
      });
      if (all) all.checked = config.columns[index] === null;
      refresh();
      details.append(summary, list);
      mount.replaceChildren(label, details);
    }

    async withJob(phase, action) {
      if (this.job) return;
      const controller = new AbortController();
      this.job = { controller };
      this.notice('');
      this.progressPanel.hidden = false;
      this.cancelButton.hidden = false;
      this.showProgress({ phase, processed: 0, found: 0, foundLabel: 'Coincidencias', time: 0 });
      this.updateControls();
      const started = performance.now();
      const timer = setInterval(() => { this.$('.elapsed').textContent = timeLabel(performance.now() - started); }, 250);
      try {
        await action({ signal: controller.signal, progress: progress => this.showProgress(progress) });
      } catch (error) {
        this.progressPanel.hidden = true;
        const cancelled = controller.signal.aborted || error.name === 'AbortError';
        this.notice(cancelled ? 'Operación cancelada.' : error.message, cancelled, !cancelled && error.openTool);
      } finally {
        clearInterval(timer);
        this.cancelButton.hidden = true;
        this.job = null;
        this.updateControls();
      }
    }

    showProgress({ phase, bytes, total, processed, found, foundLabel, time }) {
      if (this.$('.phase').textContent !== phase) {
        this.$('.phase').textContent = phase;
        this.$('.announce').textContent = phase;
      }
      const bar = this.$('progress');
      if (total > 0) bar.value = bytes / total;
      else bar.removeAttribute('value');
      this.$('.percent').textContent = total > 0 ? percent(bytes, total) : '';
      this.$('.processed').textContent = integer.format(processed);
      this.$('.found').textContent = integer.format(found);
      this.$('.found-label').textContent = foundLabel;
      this.$('.elapsed').textContent = timeLabel(time);
    }

    async execute() {
      const mode = this.mode;
      const config = this.config[mode];
      const active = this.activeFiles();
      const files = this.files.map((loaded, index) => active.includes(index) ? loaded.file : null);
      const columns = files.map((file, index) => file ? this.selectedColumns(index) : []);
      this.invalidate();
      await this.withJob('Preparando el procesamiento…', async io => {
        await this.validateInputs(active);
        const delimiters = this.files.map(loaded => loaded?.delimiter);
        this.result = await runJob(mode, { ...config, files, columns, delimiters }, io);
        const counts = this.result.totals ?? this.result.reports.map(report => report?.count);
        counts.forEach((count, index) => {
          if (count === undefined || this.files[index].count === count) return;
          this.files[index].count = count;
          this.renderFile(index);
        });
        this.$('.phase').textContent = mode === 'compare' ? 'Comparación completada' : 'Búsqueda completada';
        this.$('.elapsed').textContent = timeLabel(this.result.time);
        this.renderResults();
        this.$('.announce').textContent = this.$('.phase').textContent;
      });
    }

    metric(label, value, glyph = '', percentage = '') {
      const item = element('div', undefined, 'metric');
      if (glyph) item.insertAdjacentHTML('beforeend', icon(glyph, glyph === 'check' ? 'positive badge' : glyph === 'cross' ? 'negative badge' : ''));
      const text = element('div');
      text.append(element('span', label), element('strong', value));
      if (percentage) text.append(element('span', ` (${percentage})`, 'percentage'));
      item.append(text);
      return item;
    }

    downloadButton(name, data, color) {
      const button = element('button', undefined, `action ${color} download`);
      button.type = 'button';
      button.insertAdjacentHTML('beforeend', icon('download'));
      const text = element('span');
      text.append(element('span', 'Descargar'), element('strong', name), element('small', `${integer.format(data.expected)} registros`));
      button.append(text);
      button.addEventListener('click', () => this.export(name, data));
      return button;
    }

    renderResults() {
      const result = this.result;
      const body = this.$('.results-body');
      const summary = element('div', undefined, `summary ${result.mode}`);
      const duration = this.metric('Tiempo total', timeLabel(result.time), 'clock');
      body.replaceChildren(summary);
      if (result.mode === 'compare') {
        const total = result.totals[0];
        const excluded = total - result.found;
        const { file, delimiter } = this.files[0];
        const data = { file, delimiter, blocks: result.blocks, total };
        const downloads = element('div', undefined, 'downloads');
        downloads.append(
          this.downloadButton('COINCIDEN.csv', { ...data, invert: false, expected: result.found }, 'green'),
          this.downloadButton('NO_COINCIDEN.csv', { ...data, invert: true, expected: excluded }, 'blue')
        );
        summary.append(
          this.metric('Registros CSV 1', integer.format(total)),
          this.metric('Coinciden', integer.format(result.found), 'check', percent(result.found, total)),
          this.metric('No coinciden', integer.format(excluded), 'cross', percent(excluded, total)), duration, downloads
        );
      } else {
        const total = result.reports.reduce((sum, report) => sum + (report?.count ?? 0), 0);
        summary.append(this.metric('Total consultado', integer.format(total), 'data'), duration);
        const previews = element('div', undefined, 'search-results');
        result.reports.forEach((report, index) => {
          if (!report) return;
          const section = element('section', undefined, 'search-result');
          const title = element('h3', `CSV ${index + 1} · ${integer.format(report.found)} encontrados`);
          const header = element('div', undefined, 'search-result-head');
          const { file, delimiter } = this.files[index];
          const button = this.downloadButton(`BUSQUEDA_CSV${index + 1}.csv`, {
            file, delimiter, blocks: report.blocks, invert: false, expected: report.found, total: report.count
          }, index ? 'blue' : 'green');
          header.append(title, button);
          const label = element('p', `Vista previa · ${report.rows.length} de ${integer.format(report.found)} registros`, 'preview-label');
          const scroll = element('div', undefined, 'table-wrap');
          scroll.tabIndex = 0;
          scroll.setAttribute('role', 'region');
          scroll.setAttribute('aria-label', `Vista previa de resultados de CSV ${index + 1}`);
          scroll.append(table(this.files[index].columns, report.rows));
          section.append(header, label, scroll);
          previews.append(section);
        });
        body.append(previews);
      }
      body.append(element('p', 'El CSV conserva los valores originales. Si los datos no son de confianza, importa las columnas como texto para evitar fórmulas en Excel.', 'instructions'));
      this.resultsPanel.hidden = false;
    }

    async validateInputs(indices) {
      for (const index of indices) {
        const { handle, originalFile } = this.files[index];
        try {
          if (handle) {
            const current = await handle.getFile();
            if (current.size !== originalFile.size || current.lastModified !== originalFile.lastModified) throw new Error();
          }
          await originalFile.slice(0, 1).arrayBuffer();
        } catch {
          this.invalidate();
          throw new Error(`El archivo del panel ${index + 1} cambió o dejó de estar disponible. Vuelve a cargarlo.`);
        }
      }
    }

    requestDownload(name, file, discard) {
      const url = URL.createObjectURL(file);
      if (!discard) this.bufferedDownloadURL = url;
      this.downloadURLs.add(url);
      const link = element('a');
      link.href = url;
      link.download = name;
      this.ui.append(link);
      link.click();
      link.remove();
      setTimeout(() => {
        URL.revokeObjectURL(url);
        this.downloadURLs.delete(url);
        if (this.bufferedDownloadURL === url) this.bufferedDownloadURL = null;
        discard?.();
      }, discard ? STAGED_TTL : 15000);
    }

    async export(name, data) {
      await this.withJob('Preparando la exportación…', async io => {
        let writer;
        let stage;
        let handedOff = false;
        const chunks = [];
        try {
          let handle;
          const originals = this.files.filter(Boolean);
          if (sharesTopOrigin() && typeof window.showSaveFilePicker === 'function' &&
            originals.every(loaded => typeof loaded.handle?.isSameEntry === 'function')) {
            try {
              handle = await window.showSaveFilePicker({ suggestedName: name, types: [{ description: 'Archivo CSV', accept: { 'text/csv': ['.csv'] } }] });
            } catch (error) {
              if (error.name !== 'SecurityError' && error.name !== 'NotSupportedError') throw error;
            }
          }
          io.signal.throwIfAborted();
          if (handle) {
            for (const loaded of originals) {
              if (await loaded.handle.isSameEntry(handle)) {
                throw new Error('El destino coincide con un archivo cargado. Elige otro nombre para conservar el original.');
              }
            }
          }
          await this.validateInputs(this.activeFiles());
          io.signal.throwIfAborted();
          if (handle) writer = await handle.createWritable({ mode: 'exclusive' });
          let measured;
          if (!writer) {
            const frame = window.frameElement;
            if (frame?.hasAttribute('sandbox') && !frame.sandbox.contains('allow-downloads')) {
              throw new Error('Este iframe tiene las descargas bloqueadas. Habilita allow-downloads o abre CSV MATCH en una pestaña propia.');
            }
            measured = await runJob('export', { ...data, measure: true }, io);
            if (measured.bytes > engine.BLOB_LIMIT) {
              stage = await stageDownload(measured.bytes);
              if (!stage) {
                const error = new Error(`La salida ocuparía ${sizeLabel(measured.bytes)}. En este contexto la descarga en memoria admite hasta 32 MiB. Usa el guardado directo en Chrome con los originales seleccionados mediante su selector.`);
                error.openTool = location.protocol === 'file:' && window !== window.top;
                throw error;
              }
              writer = stage.writer;
            }
          }
          if (!writer && this.bufferedDownloadURL) {
            URL.revokeObjectURL(this.bufferedDownloadURL);
            this.downloadURLs.delete(this.bufferedDownloadURL);
            this.bufferedDownloadURL = null;
          }
          const report = await runJob('export', { ...data, buffered: !writer, byteLimit: measured?.bytes }, {
            ...io,
            write: async chunk => {
              io.signal.throwIfAborted();
              if (writer) await writer.write(chunk);
              else chunks.push(chunk);
            }
          });
          if (measured && report.bytes !== measured.bytes) throw new Error('El tamaño de la salida cambió. Vuelve a cargar el archivo.');
          io.signal.throwIfAborted();
          this.cancelButton.hidden = true;
          if (writer) {
            this.$('.phase').textContent = 'Guardando el archivo…';
            await writer.close();
            writer = null;
          }
          if (handle) this.$('.phase').textContent = 'Archivo guardado';
          else {
            const file = stage ? await stage.handle.getFile() : new Blob(chunks, { type: 'text/csv;charset=utf-8' });
            this.requestDownload(name, file, stage?.discard);
            handedOff = true;
            this.$('.phase').textContent = 'Descarga solicitada al navegador';
          }
          this.$('.announce').textContent = `${this.$('.phase').textContent}. ${integer.format(report.count)} registros.`;
        } catch (error) {
          if (writer) await writer.abort().catch(() => {});
          throw error;
        } finally {
          if (stage && !handedOff) await stage.discard();
        }
      });
    }
  }

  if (!customElements.get('csv-match')) customElements.define('csv-match', CsvMatch);
})();
