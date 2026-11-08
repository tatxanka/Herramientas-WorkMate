(function () {
  'use strict';
  const engine = DividerEngine(DividerArchive, CSVMatchXlsxLibrary);
  const $ = id => document.getElementById(id);
  const text = (id, value) => { $(id).textContent = value; };
  const display = (id, visible) => { $(id).hidden = !visible; };
  const format = number => number.toLocaleString('es-ES');
  const quantity = (number, noun) => format(number) + ' ' + noun + (number === 1 ? '' : 's');
  const size = bytes => bytes < 1024 ? format(bytes) + ' B' :
    (bytes < 1024 ** 2 ? (bytes / 1024).toLocaleString('es-ES', { maximumFractionDigits: 1 }) + ' KiB' :
      (bytes / 1024 ** 2).toLocaleString('es-ES', { maximumFractionDigits: 1 }) + ' MiB');
  const separator = value => value === ';' ? 'Punto y coma (;)' : 'Coma (,)';
  const inFrame = window.top !== window;
  let file, summary, distribution, result, parts, archive, task, partPage = 0;
  let workerFallback = false;
  let directAvailable = !inFrame && isSecureContext && typeof showDirectoryPicker === 'function';
  const amounts = { records: '20000', files: '5' };
  let mode = 'records';

  function node(tag, content) {
    const element = document.createElement(tag);
    if (content !== undefined) element.textContent = content;
    return element;
  }

  function notice(id, value = '') {
    text(id, value);
    display(id, Boolean(value));
  }

  function step(number) {
    [...document.querySelectorAll('.steps li')].forEach((item, index) => {
      if (index + 1 === number) item.setAttribute('aria-current', 'step');
      else item.removeAttribute('aria-current');
    });
  }

  function directHint() {
    text('direct-hint', workerFallback ?
      'Worker no disponible. La lectura y las descargas usan límites reducidos.' :
      inFrame ? 'Para intentar guardar en una carpeta de Windows, abre la herramienta en otra pestaña.' :
      directAvailable ? 'Las descargas admiten hasta 96 MiB. El guardado en carpeta usa una subcarpeta nueva y solicita permiso a Chrome.' :
      'Chrome no ofrece guardado en carpeta en este contexto. Puedes descargar las partes o el ZIP.');
  }

  function controls() {
    const busy = Boolean(task);
    for (const id of ['file', 'remove', 'input-separator', 'sheet', 'mode', 'amount', 'output-separator', 'base', 'header']) {
      $(id).disabled = busy;
    }
    $('divide').disabled = busy || !distribution?.count;
    $('direct').disabled = !directAvailable || busy || !distribution?.count;
    display('cancel', busy);
    if (busy) $('cancel').disabled = task.controller.signal.aborted || task.selecting;
  }

  function clearResults() {
    result = parts = archive = null;
    partPage = 0;
    display('results', false);
    display('part-pages', false);
    $('parts').replaceChildren();
    $('integrity').replaceChildren();
  }

  function table(target, headings, rows) {
    const body = node('tbody');
    for (const values of rows) {
      const row = node('tr');
      for (const value of values) {
        const cell = node('td');
        if (typeof value === 'string') cell.textContent = value;
        else cell.append(value);
        row.append(cell);
      }
      body.append(row);
    }
    const children = [];
    if (headings) {
      const head = node('thead');
      const row = node('tr');
      for (const value of headings) {
        const cell = node('th', value);
        cell.scope = 'col';
        row.append(cell);
      }
      head.append(row);
      children.push(head);
    }
    target.replaceChildren(...children, body);
  }

  const totalRecords = () => Math.max(0, summary.rows - ($('header').checked ? 1 : 0));

  function sourceView() {
    const csv = file && /\.csv$/i.test(file.name);
    const xlsx = file && /\.xlsx$/i.test(file.name);
    display('input-separator-field', csv);
    display('sheet-field', xlsx && $('sheet').options.length > 0);
    display('remove', file);
    text('filename', file?.name || 'Sin archivo');
    text('file-action', file ? 'Cambiar archivo' : 'Seleccionar archivo');
    text('file-meta', file ? '· ' + (csv ? 'CSV' : xlsx ? 'XLSX' : 'Formato no admitido') + ' · ' + size(file.size) : '');
    const data = summary;
    display('preview-section', data && !data.error && data.preview.length);
    if (!data) {
      text('file-status', file ? 'Archivo pendiente de validar.' : 'Selecciona un archivo para contar los registros y consultar su vista previa.');
      $('preview').replaceChildren();
      return;
    }
    const extras = data.type === 'csv' ? separator(data.delimiter) : 'Hoja «' + data.sheet + '»' +
      (data.missing ? ' · ' + quantity(data.missing, 'fórmula') + ' sin valor almacenado. Se exportan como campos vacíos.' : '');
    text('file-status', data.error || quantity(totalRecords(), 'registro') + ' · ' + quantity(data.columns, 'columna') + ' · ' + extras);
    const header = $('header').checked && data.rows ? data.preview[0] : null;
    const rows = data.preview.slice(header ? 1 : 0, header ? 11 : 10);
    text('preview-meta', '· ' + quantity(rows.length, 'registro') +
      (data.columns > 32 ? ' · primeras 32 columnas de ' + format(data.columns) : '') + ' · los textos largos se abrevian aquí');
    if (!data.error) table($('preview'), header, rows);
  }

  function planDetails(sizes) {
    const content = $('plan-list');
    const pageSize = 24;
    const pages = Math.ceil(sizes.length / pageSize);
    let page = 0;
    function draw() {
      const list = node('p', sizes.slice(page * pageSize, (page + 1) * pageSize).map((count, index) =>
        format(page * pageSize + index + 1) + ' → ' + format(count)).join(' · '));
      const controls = node('div');
      controls.className = 'pages';
      const previous = node('button', 'Anterior');
      const next = node('button', 'Siguiente');
      previous.disabled = page === 0;
      next.disabled = page + 1 === pages;
      previous.onclick = () => { page--; draw(); (page ? content.querySelector('button') : content.querySelector('button:last-child')).focus(); };
      next.onclick = () => { page++; draw(); content.querySelector(page + 1 === pages ? 'button' : 'button:last-child').focus(); };
      controls.append(previous, node('span', format(page + 1) + ' / ' + format(pages)), next);
      content.replaceChildren(list, ...(pages > 1 ? [controls] : []));
    }
    draw();
  }

  function planView() {
    distribution = null;
    display('plan-details', false);
    $('plan-list').replaceChildren();
    let message = 'El reparto aparecerá después de validar el archivo.';
    if (summary?.error) message = summary.error;
    else if (summary && !totalRecords()) message = '0 registros. No hay datos que dividir.';
    else if (summary) {
      try {
        const proposed = engine.plan(totalRecords(), mode, $('amount').value);
        const base = engine.safeName($('base').value);
        const { sizes, count, reduced, remainder, total } = proposed;
        message = quantity(total, 'registro') + ' · ' + $('mode').selectedOptions[0].textContent + ' · ' +
          quantity(count, 'parte') + ' · total acumulado ' + format(sizes.reduce((sum, value) => sum + value, 0)) +
          ' · resto ' + format(remainder) + ' · ' + engine.partName(base, 1, count) +
          (reduced ? ' · Se redujo el número solicitado para evitar partes vacías.' : '');
        if (count <= 6) message += ' · Reparto: ' + sizes.map(format).join(' + ');
        else {
          message += ' · Entre ' + format(sizes.at(-1)) + ' y ' + format(sizes[0]) + ' registros por parte';
          planDetails(sizes);
          display('plan-details', true);
        }
        if (base !== $('base').value) message += ' · Se ajustaron caracteres incompatibles del nombre.';
        distribution = proposed;
      } catch (error) { message = error.message; }
    }
    text('plan-status', message);
    controls();
  }

  function renderProgress(event) {
    text('phase', event.phase);
    const progress = $('progress');
    const ratio = event.totalBytes ? event.bytes / event.totalBytes :
      event.totalRecords ? event.records / event.totalRecords : NaN;
    if (Number.isFinite(ratio)) progress.value = Math.min(100, ratio * 100);
    else progress.removeAttribute('value');
    const counters = [];
    if (event.records !== undefined) counters.push(quantity(event.records, 'registro') +
      (event.totalRecords ? ' de ' + format(event.totalRecords) : ' leídos'));
    if (event.parts !== undefined) counters.push(format(event.parts) + ' de ' + format(event.totalParts) + ' partes terminadas');
    if (Number.isFinite(ratio)) counters.push(Math.min(100, Math.floor(ratio * 100)) + ' %');
    text('counters', counters.join(' · '));
  }

  function begin(phase, selecting = false) {
    const current = { controller: new AbortController(), selecting, started: performance.now() };
    task = current;
    const tick = () => text('elapsed', ((performance.now() - current.started) / 1000).toLocaleString('es-ES',
      { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' s');
    tick();
    current.tick = tick;
    current.timer = setInterval(tick, 100);
    notice('error');
    notice('info');
    renderProgress({ phase });
    display('progress-box', true);
    controls();
    return current;
  }

  function end(current) {
    clearInterval(current.timer);
    current.tick();
    task = null;
    controls();
  }

  async function execute(request, current, sink) {
    return DividerBridge.run(engine, request, {
      signal: current.controller.signal,
      progress: value => { if (!current.controller.signal.aborted) renderProgress(value); },
      sink,
      fallback: () => { workerFallback = true; directHint(); }
    });
  }

  async function inspect(selection) {
    if (!file || task) return;
    clearResults();
    summary = null;
    planView();
    sourceView();
    step(1);
    const current = begin('Leyendo archivo');
    try {
      const data = await execute({ type: 'inspect', file, options: { delimiter: $('input-separator').value, sheet: selection } }, current);
      summary = data;
      if (data.sheets) {
        $('sheet').replaceChildren(...data.sheets.map(sheet => {
          const option = node('option', sheet.name + (sheet.rows ? '' : ' · vacía'));
          option.value = sheet.name;
          return option;
        }));
        $('sheet').value = data.sheet;
      }
      if (data.error) notice('error', data.error);
      renderProgress({ phase: data.error ? 'Hoja fuera de los límites' : 'Lectura completada', records: data.rows,
        bytes: file.size, totalBytes: file.size });
      step(2);
    } catch (error) {
      const cancelled = error.name === 'AbortError';
      renderProgress({ phase: cancelled ? 'Lectura cancelada' : 'Error de lectura' });
      notice(cancelled ? 'info' : 'error', cancelled ? 'Selecciona el archivo de nuevo o cambia el delimitador para repetir la lectura.' : error.message);
    } finally {
      end(current);
      sourceView();
      planView();
    }
  }

  function load(next) {
    if (task) return;
    file = next || null;
    summary = null;
    $('sheet').replaceChildren();
    $('input-separator').value = '';
    $('base').value = next ? next.name.replace(/\.[^.]+$/, '') : '';
    clearResults();
    notice('error');
    notice('info');
    display('progress-box', false);
    sourceView();
    planView();
    step(1);
    if (next) inspect();
  }

  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const link = node('a');
    link.href = url;
    link.download = name;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  function partTable() {
    const pageSize = 25;
    const pages = Math.ceil(parts.length / pageSize);
    table($('parts'), ['Parte', 'Archivo', 'Registros', 'Tamaño', 'Estado', 'Acción'],
      parts.slice(partPage * pageSize, (partPage + 1) * pageSize).map(part => {
        const button = node('button', 'Descargar');
        button.setAttribute('aria-label', 'Descargar ' + part.name);
        button.onclick = () => download(part.blob, part.name);
        return [format(part.index), part.name, format(part.records), size(part.bytes), result.direct ? 'Guardado y verificado' : 'Verificado', button];
      }));
    text('page-label', format(partPage + 1) + ' / ' + format(pages));
    $('previous').disabled = !partPage;
    $('next').disabled = partPage + 1 >= pages;
    display('part-pages', pages > 1);
  }

  function renderResults(output, sink) {
    result = output;
    parts = sink.parts;
    const metrics = [
      ['Registros de origen', output.input], ['Partes', output.parts.length], ['Distribuidos', output.written],
      ['Sin distribuir', output.input - output.written], ['Errores', 0], ['Tamaño', size(output.bytes)]
    ].map(([label, value]) => {
      const metric = node('span');
      metric.append(label + ' · ', node('b', typeof value === 'number' ? format(value) : value));
      return metric;
    });
    $('integrity').replaceChildren(...metrics);
    text('integrity-detail', 'Filas leídas: ' + format(output.read) + '. Registros asignados: ' + format(output.assigned) +
      '. Registros escritos: ' + format(output.written) + '. Huella del origen: ' + output.fingerprint +
      (sink.directory ? '. Subcarpeta: ' + sink.directory + '.' : '.'));
    display('zip', !output.direct);
    partTable();
    display('results', true);
  }

  async function divide(direct) {
    if (task || !distribution?.count || (direct && !directAvailable)) return;
    clearResults();
    const current = begin(direct ? 'Selecciona una carpeta de destino' : 'Preparando división', direct);
    let sink;
    try {
      const target = direct ? await showDirectoryPicker({ mode: 'readwrite', id: 'divider-records' }) : null;
      current.selecting = false;
      controls();
      sink = DividerBridge.output(engine, current.controller.signal, target);
      step(3);
      const output = await execute({ type: 'split', file, summary, options: {
        header: $('header').checked, mode, amount: $('amount').value, delimiter: $('output-separator').value,
        name: $('base').value, direct
      } }, current, sink);
      renderProgress({ phase: 'División verificada', records: output.written, totalRecords: output.input,
        parts: output.parts.length, totalParts: output.parts.length });
      renderResults(output, sink);
    } catch (error) {
      clearResults();
      const cancelled = error.name === 'AbortError';
      if (direct && current.selecting && error.name === 'SecurityError') {
        directAvailable = false;
        directHint();
      }
      const partial = sink?.directory ? ' Revisa la subcarpeta «' + sink.directory + '». Se iniciaron ' +
        format(sink.touched) + ' archivos y el conjunto está incompleto o sin verificar.' : '';
      renderProgress({ phase: cancelled ? 'División cancelada' : 'División interrumpida' });
      notice(cancelled ? 'info' : 'error', (cancelled ? 'La operación se canceló.' : error.message) + partial);
      step(2);
    } finally { end(current); }
  }

  $('file').addEventListener('change', event => {
    const selected = event.target.files[0];
    event.target.value = '';
    if (selected) load(selected);
  });
  $('remove').onclick = $('reset').onclick = () => { load(null); $('file').focus(); };
  $('input-separator').onchange = () => inspect();
  $('sheet').onchange = () => inspect($('sheet').value);
  $('mode').onchange = () => {
    amounts[mode] = $('amount').value;
    mode = $('mode').value;
    $('amount').value = amounts[mode];
    text('amount-label', mode === 'records' ? 'Máximo de registros por archivo' : 'Número total de archivos');
    changed();
  };
  function changed() {
    clearResults();
    notice('info');
    if (summary && !summary.error) {
      notice('error');
      display('progress-box', false);
      step(2);
    }
    sourceView();
    planView();
  }
  for (const id of ['header', 'output-separator']) $(id).onchange = changed;
  for (const id of ['amount', 'base']) $(id).oninput = changed;
  $('divide').onclick = () => divide(false);
  $('direct').onclick = () => divide(true);
  $('cancel').onclick = () => {
    if (!task) return;
    task.controller.abort();
    controls();
    renderProgress({ phase: 'Cancelando operación' });
  };
  $('zip').onclick = () => {
    try {
      archive ??= engine.archive.zip(parts);
      download(archive, result.base + '.zip');
    } catch (error) { notice('error', error.message); }
  };
  $('previous').onclick = () => { partPage--; partTable(); };
  $('next').onclick = () => { partPage++; partTable(); };
  display('new-tab', inFrame);
  directHint();
  controls();
})();
