(function (root) {
  'use strict';

  function createEngine(createArchive, loadSheetJS) {
    const archive = createArchive();
    const MiB = 1024 * 1024;
    const limits = Object.freeze({ csv: 1024 * MiB, xlsx: 16 * MiB, memory: 96 * MiB, direct: 2 * 1024 * MiB,
      mainCsv: 2 * MiB, mainXlsx: MiB, mainMemory: 16 * MiB, row: 2 * MiB, columns: 1024, parts: 2000 });
    const blockSize = 256 * 1024;
    const encoder = new TextEncoder();
    const format = number => number.toLocaleString('es-ES');
    const abort = () => new DOMException('Operación cancelada.', 'AbortError');
    const noop = () => {};
    const separator = value => value === ',' || value === ';';

    function job(signal, progress = noop) {
      let time = performance.now();
      return {
        check: async () => {
          if (signal?.aborted) throw abort();
          if (performance.now() - time >= 20) {
            await new Promise(resolve => setTimeout(resolve, 0));
            time = performance.now();
            if (signal?.aborted) throw abort();
          }
        },
        progress
      };
    }

    // Each iterator must be consumed before passing another block to the parser.
    function parser(delimiter) {
      let state = 'start', field = '', row = [], length = 0, number = 0, skipLF = false, separated = false;
      const error = message => new Error('Registro ' + format(number + 1) + ': ' + message);
      const append = part => {
        length += part.length;
        if (length > limits.row) throw error('supera 2 Mi de unidades de texto.');
        field += part;
      };
      const cell = () => {
        if (row.length >= limits.columns) throw error('supera ' + limits.columns + ' columnas.');
        row.push(field);
        field = '';
        state = 'start';
      };
      function record() {
        const blank = row.length === 0 && state === 'start';
        cell();
        const value = { row, blank };
        row = [];
        length = 0;
        number++;
        return value;
      }
      function* push(text, final = false) {
        for (let i = 0; i < text.length;) {
          const char = text[i];
          if (skipLF) {
            skipLF = false;
            if (char === '\n') { i++; continue; }
          }
          if (state === 'quoted') {
            const next = text.indexOf('"', i);
            if (next < 0) { append(text.slice(i)); break; }
            append(text.slice(i, next));
            state = 'after';
            i = next + 1;
          } else if (state === 'after' && char === '"') {
            append('"');
            state = 'quoted';
            i++;
          } else if (char === delimiter) {
            separated = true;
            cell();
            i++;
          } else if (char === '\r' || char === '\n') {
            skipLF = char === '\r';
            yield record();
            i++;
          } else if (char === '"' && state === 'start') {
            state = 'quoted';
            i++;
          } else {
            if (state === 'after') throw error('hay texto después de una comilla de cierre.');
            if (char === '"') throw error('hay una comilla dentro de un campo sin entrecomillar.');
            let end = i + 1;
            while (end < text.length && text[end] !== delimiter && text[end] !== '\r' &&
                   text[end] !== '\n' && text[end] !== '"') end++;
            append(text.slice(i, end));
            state = 'bare';
            i = end;
          }
        }
        if (!final) return;
        if (state === 'quoted') throw error('comillas sin cerrar al final del archivo.');
        if (row.length || state !== 'start') yield record();
      }
      return { push, get separated() { return separated; } };
    }

    function normalized(item, width, record) {
      if (item.blank) return Array(width).fill('');
      if (item.row.length !== width) {
        throw new Error('Registro ' + format(record) + ': se esperaban ' + width + ' columnas y hay ' + item.row.length + '.');
      }
      return item.row;
    }

    function previewRow(row) {
      return row.slice(0, 32).map(value => value.length > 180 ? value.slice(0, 179) + '…' : value);
    }

    async function hash(bytes) {
      return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    }

    const hex = bytes => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');

    async function readCsv(file, work, consume) {
      const decoder = new TextDecoder('utf-8', { fatal: true });
      let chain = new Uint8Array(32);
      for (let start = 0; start < file.size; start += blockSize) {
        await work.check();
        const end = Math.min(file.size, start + blockSize);
        let bytes;
        try { bytes = new Uint8Array(await file.slice(start, end).arrayBuffer()); }
        catch { throw new Error('No se pudo releer el CSV. Si cambió en disco, vuelve a seleccionarlo.'); }
        if (bytes.length !== end - start) throw new Error('El archivo cambió durante la lectura.');
        const input = new Uint8Array(chain.length + bytes.length);
        input.set(chain);
        input.set(bytes, chain.length);
        chain = await hash(input);
        let text;
        try { text = decoder.decode(bytes, { stream: true }); }
        catch { throw new Error('El CSV no es UTF-8 válido. Vuelve a guardarlo como CSV UTF-8.'); }
        await consume(text, false, end);
      }
      let tail;
      try { tail = decoder.decode(); }
      catch { throw new Error('El CSV termina con una secuencia UTF-8 incompleta.'); }
      await consume(tail, true, file.size);
      return hex(chain);
    }

    async function inspectCsv(file, requested, work) {
      const candidates = (separator(requested) ? [requested] : [';', ',']).map(delimiter =>
        ({ delimiter, scanner: parser(delimiter), rows: 0, columns: 0, preview: [], error: null }));
      const fingerprint = await readCsv(file, work, (text, final, offset) => {
        for (const candidate of candidates) {
          if (candidate.error) continue;
          try {
            for (const item of candidate.scanner.push(text, final)) {
              candidate.rows++;
              if (!item.blank) {
                candidate.columns ||= item.row.length;
                normalized(item, candidate.columns, candidate.rows);
              }
              if (candidate.preview.length < 11) candidate.preview.push(item.blank ? null : previewRow(item.row));
            }
          } catch (error) { candidate.error = error; }
        }
        if (candidates.every(candidate => candidate.error)) {
          throw new Error(candidates.map(item => item.delimiter + ' · ' + item.error.message).join(' / '));
        }
        work.progress({ phase: 'Validando CSV', bytes: offset, totalBytes: file.size,
          records: Math.max(...candidates.filter(item => !item.error).map(item => item.rows)) });
      });
      const valid = candidates.filter(candidate => !candidate.error);
      const multi = valid.filter(candidate => candidate.columns > 1);
      if (multi.length > 1 || (!multi.length && candidates.some(candidate => candidate.error && candidate.scanner.separated))) {
        throw new Error('El delimitador es ambiguo o las filas tienen distinto número de columnas. Elige coma o punto y coma y revisa el resultado.');
      }
      const { delimiter, rows, preview, columns: width } = multi[0] || valid[0];
      const columns = width || (rows ? 1 : 0);
      return { type: 'csv', delimiter, rows, columns, fingerprint,
        preview: preview.map(row => row || Array(Math.min(columns, 32)).fill('')) };
    }

    let xlsx;
    async function workbook(file, work, mainThread) {
      let bytes;
      try { bytes = new Uint8Array(await file.arrayBuffer()); }
      catch { throw new Error('No se pudo leer el XLSX. Si cambió en disco, vuelve a seleccionarlo.'); }
      if (bytes.length !== file.size) throw new Error('El libro cambió durante la lectura.');
      const fingerprint = hex(await hash(bytes));
      work.progress({ phase: 'Verificando el libro XLSX' });
      await archive.checkWorkbook(bytes, { expanded: mainThread ? 4 * MiB : 64 * MiB, cells: mainThread ? 25_000 : 500_000 }, work.check);
      await work.check();
      xlsx ??= loadSheetJS();
      let book;
      try {
        book = xlsx.read(bytes, { type: 'array', cellText: true, cellNF: true, cellDates: false,
          sheetStubs: true, cellHTML: false, cellFormula: true });
      } catch { throw new Error('No se pudo interpretar el libro XLSX. Comprueba que se abra en Excel y no esté cifrado.'); }
      await work.check();
      return { book, fingerprint };
    }

    function sheetValue(cell) {
      if (!cell || cell.v === undefined || cell.v === null || cell.t === 'z') return '';
      const raw = cell.t === 's' || cell.t === 'str' || (cell.t === 'n' && (!cell.z || cell.z === 'General'));
      const value = String(raw ? cell.v : cell.w ?? cell.v);
      if (!value.isWellFormed()) throw new Error('Una celda XLSX contiene texto Unicode que no se puede exportar fielmente a UTF-8.');
      return value;
    }

    function sheetInfo(book, name, mainThread) {
      const sheet = book.Sheets[name];
      let used = false, missing = 0, lastRow = 0, lastColumn = 0;
      for (const address in sheet || {}) {
        if (address[0] === '!') continue;
        const cell = sheet[address];
        if (cell.f !== undefined && (cell.v === undefined || cell.v === null || cell.t === 'z')) missing++;
        if (cell.f !== undefined || (cell.t !== 'z' && cell.v !== undefined && cell.v !== null)) {
          const { r, c } = xlsx.utils.decode_cell(address);
          lastRow = Math.max(lastRow, r);
          lastColumn = Math.max(lastColumn, c);
          used = true;
        }
      }
      if (!used) return { name, rows: 0, columns: 0, missing: 0, error: '' };
      const end = sheet['!ref'] ? xlsx.utils.decode_range(sheet['!ref']).e : { r: lastRow, c: lastColumn };
      const rows = Math.max(lastRow, end.r) + 1, columns = Math.max(lastColumn, end.c) + 1;
      const cap = mainThread ? 100_000 : 2_000_000;
      const error = !Number.isSafeInteger(rows * columns) || rows < 1 || columns < 1 ||
        columns > limits.columns || rows * columns > cap ?
        'La hoja supera ' + format(cap) + ' celdas de rango o ' + format(limits.columns) + ' columnas. Guárdala como CSV.' : '';
      return { name, rows, columns, missing, error };
    }

    function sheetReader(sheet, width) {
      const addresses = Array.from({ length: width }, (_, column) => xlsx.utils.encode_col(column));
      return index => addresses.map(address => sheetValue(sheet[address + (index + 1)]));
    }

    async function inspectXlsx(file, selection, work, mainThread) {
      const { book, fingerprint } = await workbook(file, work, mainThread);
      const sheets = book.SheetNames.map(name => sheetInfo(book, name, mainThread));
      const selected = sheets.find(sheet => sheet.name === selection) || sheets.find(sheet => sheet.rows) || sheets[0];
      if (!selected) throw new Error('El libro no contiene hojas.');
      const preview = selected.error ? [] : Array.from({ length: Math.min(11, selected.rows) },
        (_, index) => previewRow(sheetReader(book.Sheets[selected.name], Math.min(32, selected.columns))(index)));
      return { type: 'xlsx', sheet: selected.name, sheets, rows: selected.rows, columns: selected.columns,
        missing: selected.missing, error: selected.error, preview, fingerprint };
    }

    function validateFile(file, mainThread) {
      const isCsv = /\.csv$/i.test(file.name), isXlsx = /\.xlsx$/i.test(file.name);
      if (!isCsv && !isXlsx) throw new Error('Selecciona un archivo CSV o XLSX.');
      const max = isCsv ? (mainThread ? limits.mainCsv : limits.csv) : (mainThread ? limits.mainXlsx : limits.xlsx);
      if (file.size > max) throw new RangeError('El archivo supera el límite de ' + max / MiB +
        ' MiB' + (mainThread ? ' sin Worker. Abre DIVIDER RECORDS en otra pestaña de Chrome.' : '.'));
      return isCsv;
    }

    async function inspect(file, options = {}, io = {}) {
      const { delimiter, sheet, mainThread = false } = options;
      const isCsv = validateFile(file, mainThread);
      const work = job(io.signal, io.progress);
      await work.check();
      return isCsv ? inspectCsv(file, delimiter, work) : inspectXlsx(file, sheet, work, mainThread);
    }

    function plan(total, mode, value) {
      const raw = String(value);
      const amount = Number(raw);
      if (!/^[0-9]+$/.test(raw) || !Number.isSafeInteger(amount) || amount < 1 || amount > 1_000_000_000) {
        throw new Error('Introduce un entero entre 1 y 1.000.000.000.');
      }
      if (!Number.isSafeInteger(total) || total < 0 || !['records', 'files'].includes(mode)) throw new Error('Distribución inválida.');
      const count = mode === 'records' ? Math.ceil(total / amount) : Math.min(total, amount);
      if (count > limits.parts) throw new RangeError('La distribución genera ' + format(count) +
        ' archivos. Ajusta el reparto para obtener como máximo ' + format(limits.parts) + ' partes.');
      const quotient = count ? Math.floor(total / count) : 0, extra = count ? total % count : 0;
      const sizes = Array.from({ length: count }, (_, index) => mode === 'files' ? quotient + (index < extra ? 1 : 0) :
        Math.min(amount, total - index * amount));
      return { sizes, count, total, reduced: mode === 'files' && count < amount, remainder: mode === 'files' ? extra : total % amount };
    }

    function safeName(input) {
      let name = String(input).replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, '_').replace(/[ .]+$/, '');
      if (!name) throw new Error('Introduce un nombre base válido.');
      if (/^(?:CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])(?:\.|$)/i.test(name)) name = '_' + name;
      if (encoder.encode(name).length > 235) throw new Error('El nombre base es demasiado largo. Acórtalo.');
      return name;
    }

    const partName = (base, part, total) => base + '_' + String(part).padStart(Math.max(3, String(total).length), '0') + '.csv';

    function csvLine(row, delimiter) {
      if (row.length === 1 && row[0] === '') return '""\r\n';
      return row.map(value => value.includes(delimiter) || /["\r\n]/.test(value) ?
        '"' + value.replaceAll('"', '""') + '"' : value).join(delimiter) + '\r\n';
    }

    async function split(file, summary, options, sink, io = {}) {
      const work = job(io.signal, io.progress);
      const { header, mode, amount, delimiter, name, direct, mainThread } = options;
      const isCsv = validateFile(file, mainThread);
      if ((summary.type === 'csv') !== isCsv || !separator(delimiter) || summary.error) throw new Error('La configuración o la hoja no es válida.');
      const total = Math.max(0, summary.rows - (header ? 1 : 0));
      const distribution = plan(total, mode, amount);
      const base = safeName(name);
      if (!total) throw new Error('No hay registros que dividir.');
      const budget = direct ? limits.direct : mainThread ? limits.mainMemory : limits.memory;
      const sizes = distribution.sizes;
      let input = 0, assigned = 0, written = 0, sum = 0, part = null, heading = '';
      let buffer = '';
      const parts = [];

      async function flush() {
        if (!buffer) return;
        await work.check();
        const bytes = encoder.encode(buffer);
        buffer = '';
        if (sum + bytes.length > budget) throw new RangeError('La salida supera ' + budget / MiB +
          ' MiB. ' + (direct ? 'Divide el trabajo en un origen menor.' : 'Usa guardado en carpeta o reduce el tamaño del origen.'));
        part.checksum = archive.crc(bytes, part.checksum);
        part.bytes += bytes.length;
        sum += bytes.length;
        await sink.write(bytes);
      }

      async function start() {
        const index = parts.length + 1;
        part = { index, name: partName(base, index, sizes.length), bytes: 0, records: 0, checksum: 0xffffffff };
        await sink.begin(part.name);
        buffer = '\ufeff' + heading;
      }

      async function finish() {
        await flush();
        part.checksum = (part.checksum ^ 0xffffffff) >>> 0;
        await sink.end(part);
        written += part.records;
        parts.push(part);
        part = null;
      }

      async function consume(items, offset) {
        for (const item of items) {
          if (++input > summary.rows) throw new Error('El número de filas cambió desde la lectura inicial.');
          const values = normalized(item, summary.columns, input);
          if (header && input === 1) {
            heading = csvLine(values, delimiter);
            continue;
          }
          if (!part) await start();
          buffer += csvLine(values, delimiter);
          part.records++;
          assigned++;
          if (part.records === sizes[parts.length]) await finish();
          else if (buffer.length >= 128 * 1024) await flush();
        }
        work.progress({ phase: direct ? 'Guardando partes' : 'Dividiendo archivo', records: assigned,
          totalRecords: total, parts: parts.length, totalParts: sizes.length, bytes: offset, totalBytes: file.size });
      }

      try {
        let fingerprint;
        if (summary.type === 'csv') {
          const scanner = parser(summary.delimiter);
          fingerprint = await readCsv(file, work, (text, final, offset) => consume(scanner.push(text, final), offset));
        } else {
          const { book, fingerprint: current } = await workbook(file, work, mainThread);
          fingerprint = current;
          if (fingerprint !== summary.fingerprint) throw new Error('El libro cambió. Vuelve a seleccionarlo.');
          const read = sheetReader(book.Sheets[summary.sheet], summary.columns);
          for (let first = 0; first < summary.rows; first += 256) {
            await work.check();
            await consume((function* () {
              for (let index = first; index < Math.min(first + 256, summary.rows); index++) yield { row: read(index), blank: false };
            })());
          }
        }
        work.progress({ phase: 'Verificando integridad', records: assigned, totalRecords: total, parts: parts.length, totalParts: sizes.length });
        await work.check();
        if (fingerprint !== summary.fingerprint) throw new Error('El contenido de origen cambió. Vuelve a seleccionarlo.');
        if (input !== summary.rows || assigned !== total || written !== total || part || parts.length !== sizes.length ||
            parts.some((item, index) => item.records !== sizes[index]) || parts.reduce((count, item) => count + item.bytes, 0) !== sum) {
          throw new Error('El total de entrada no coincide con el de las partes. El resultado no es válido.');
        }
        return { parts, input: total, read: input, assigned, written, bytes: sum, base, direct: Boolean(direct), fingerprint };
      } catch (error) {
        await sink.abort();
        throw error;
      }
    }

    return { limits, parser, inspect, plan, safeName, partName, split, archive };
  }

  if (typeof module === 'object' && module.exports) {
    module.exports = createEngine(require('./archive'), require('../vendor/sheetjs-0.20.3'));
  } else root.DividerEngine = createEngine;
})(globalThis);
