(function (root) {
  'use strict';

  // This factory also runs verbatim in a Blob worker, including under file://.
  function createEngine(loadSheetJS) {
    const MiB = 1024 * 1024;
    const BLOCK = 256 * 1024;
    const BLOB_LIMIT = 32 * MiB;
    const EXACT_LIMIT = 192 * MiB;
    const TRIE_LIMIT = 2 ** 21;
    const ROW_LIMIT = 8 * MiB;
    const COLUMN_LIMIT = 1024;
    const BIT_BLOCK = 64 * 1024;
    const BIT_LIMIT = 16 * MiB;
    const PREVIEW_ROWS = 10;
    const PREVIEW_LENGTH = 220;
    const XLSX_FILE_LIMIT = 16 * MiB;
    const XLSX_ARCHIVE_LIMIT = 64 * MiB;
    const XLSX_CELL_LIMIT = 2_000_000;

    class Parser {
      constructor(onRow, delimiter = ',') {
        this.onRow = onRow;
        this.delimiter = delimiter;
        this.row = [];
        this.parts = [];
        this.segments = [];
        this.state = 'start';
        this.skipLF = false;
        this.length = 0;
        this.record = 1;
        this.special = delimiter === ';' ? /[";\r\n]/g : /[",\r\n]/g;
      }

      fail(reason) {
        throw new Error(`Registro ${this.record}: ${reason}`);
      }

      append(value) {
        this.length += value.length;
        if (this.length > ROW_LIMIT) this.fail('supera el límite de 8 Mi de unidades UTF-16 por registro.');
        if (value) this.parts.push(value);
        if (this.parts.length === 256) {
          this.segments.push(this.parts.join(''));
          this.parts = [];
        }
      }

      field() {
        if (this.row.length === COLUMN_LIMIT) this.fail('supera el límite de 1024 columnas.');
        const tail = this.parts.length > 1 ? this.parts.join('') : this.parts[0] ?? '';
        if (this.segments.length) {
          this.segments.push(tail);
          this.row.push(this.segments.join(''));
          this.segments = [];
        } else this.row.push(tail);
        this.parts = [];
        this.state = 'start';
      }

      endRow() {
        this.field();
        const keepReading = this.onRow(this.row, this.record) !== false;
        this.row = [];
        this.length = 0;
        this.record++;
        return keepReading;
      }

      push(text) {
        let i = 0;
        while (i < text.length) {
          const char = text[i];
          if (this.skipLF) {
            this.skipLF = false;
            if (char === '\n') { i++; continue; }
          }
          if (this.state === 'quoted') {
            const quote = text.indexOf('"', i);
            if (quote === -1) { this.append(text.slice(i)); break; }
            this.append(text.slice(i, quote));
            this.state = 'afterQuote';
            i = quote + 1;
          } else if (this.state === 'afterQuote' && char === '"') {
            this.append('"');
            this.state = 'quoted';
            i++;
          } else if (char === this.delimiter || char === '\r' || char === '\n') {
            i++;
            if (char === this.delimiter) this.field();
            else {
              this.skipLF = char === '\r';
              if (!this.endRow()) return false;
            }
          } else if (this.state === 'afterQuote') {
            const separator = this.delimiter === ';' ? 'un punto y coma' : 'una coma';
            this.fail(`se esperaba ${separator} o un salto de línea tras cerrar las comillas.`);
          } else if (char === '"') {
            if (this.state !== 'start') this.fail('hay comillas en un campo sin entrecomillar.');
            this.state = 'quoted';
            i++;
          } else {
            this.special.lastIndex = i;
            const end = this.special.exec(text)?.index ?? text.length;
            this.append(text.slice(i, end));
            this.state = 'unquoted';
            i = end;
          }
        }
        return true;
      }

      finish() {
        if (this.state === 'quoted') this.fail('hay un campo entrecomillado sin cerrar.');
        if (this.state !== 'start' || this.row.length) this.endRow();
      }
    }

    function decodeUTF8(decoder, bytes, stream) {
      try { return decoder.decode(bytes, { stream }); }
      catch { throw new Error('El archivo contiene bytes que no son UTF-8 válidos.'); }
    }

    async function detectDelimiter(file, job) {
      const candidates = [',', ';'].map(delimiter => {
        const sample = { delimiter, width: 0, rows: 0, valid: true, done: false };
        sample.parser = new Parser((row, record) => {
          if (record === 1) sample.width = row.length;
          sample.valid = row.length === sample.width;
          if (sample.valid) sample.rows++;
          sample.done = !sample.valid || sample.rows === 6;
          return !sample.done;
        }, delimiter);
        return sample;
      });
      const decoder = new TextDecoder('utf-8', { fatal: true });
      for (let offset = 0; offset < file.size && candidates.some(sample => !sample.done); offset += BLOCK) {
        job.check();
        const end = Math.min(file.size, offset + BLOCK);
        const bytes = await file.slice(offset, end).arrayBuffer();
        job.check();
        const text = decodeUTF8(decoder, bytes, end < file.size);
        for (const sample of candidates) {
          if (sample.done) continue;
          try {
            const more = sample.parser.push(text);
            if (more && end === file.size) sample.parser.finish();
          } catch {
            sample.valid = false;
            sample.done = true;
          }
        }
        await job.checkpoint();
      }
      const [comma, semicolon] = candidates;
      if (semicolon.width < 2) return ',';
      if (comma.width < 2 || (semicolon.valid && !comma.valid) ||
        (!semicolon.valid && !comma.valid && semicolon.rows > comma.rows)) return ';';
      return ',';
    }

    async function scan(file, callbacks, job, delimiter) {
      let header;
      let count = 0;
      try {
        delimiter ??= await detectDelimiter(file, job);
        const decoder = new TextDecoder('utf-8', { fatal: true });
        const parser = new Parser((row, record) => {
          if (!header) {
            header = row;
            callbacks.header?.(row);
          } else {
            if (row.length !== header.length) {
              throw new Error(`Registro ${record}: contiene ${row.length} columnas y la cabecera define ${header.length}.`);
            }
            return callbacks.row?.(row, count++);
          }
        }, delimiter);
        for (let offset = 0; offset < file.size; offset += BLOCK) {
          job.check();
          const end = Math.min(file.size, offset + BLOCK);
          const bytes = await file.slice(offset, end).arrayBuffer();
          job.check();
          if (!parser.push(decodeUTF8(decoder, bytes, true))) return { count, complete: false, delimiter };
          if (end < file.size) await callbacks.block?.(end, count);
          await job.checkpoint();
        }
        parser.push(decodeUTF8(decoder, undefined, false));
        parser.finish();
        if (!header) throw new Error('El archivo está vacío o carece de cabecera.');
        await callbacks.block?.(file.size, count);
        return { count, complete: true, delimiter };
      } catch (error) {
        if (error.name === 'AbortError' || !file.name) throw error;
        throw new Error(`${file.name}: ${error.message}`);
      }
    }

    function normalizer({ caseFold, trim, accents }) {
      return (value) => {
        if (trim) value = value.trim();
        if (caseFold) value = value.toLowerCase();
        if (accents) value = value.normalize('NFD').replace(/\p{M}/gu, '');
        return value;
      };
    }

    function previewRow(row) {
      return row.map(value => value.length > PREVIEW_LENGTH ? `${value.slice(0, PREVIEW_LENGTH)}…` : value);
    }

    async function inspect(file, job, knownDelimiter) {
      const rows = [];
      let headings;
      const { count, complete, delimiter } = await scan(file, {
        header(row) {
          const duplicates = new Set(row).size !== row.length;
          headings = { columns: previewRow(row), duplicates, unnamed: row.includes('') };
        },
        row(row) {
          rows.push(previewRow(row));
          return rows.length < PREVIEW_ROWS;
        },
        block(bytes, count) { job.progress('Leyendo vista previa', bytes, file.size, count, 0); }
      }, job, knownDelimiter);
      return { ...headings, rows, delimiter, count: complete ? count : null };
    }

    class Bitmap {
      constructor(blocks = []) { this.blocks = blocks; }

      set(index) {
        const byte = Math.floor(index / 8);
        const block = Math.floor(byte / BIT_BLOCK);
        this.blocks[block] ??= new Uint8Array(BIT_BLOCK);
        this.blocks[block][byte % BIT_BLOCK] |= 1 << (index % 8);
      }

      has(index) {
        const byte = Math.floor(index / 8);
        const block = this.blocks[Math.floor(byte / BIT_BLOCK)];
        return Boolean(block?.[byte % BIT_BLOCK] & (1 << (index % 8)));
      }

      static guard(index) {
        if (index >= BIT_LIMIT * 8) throw new Error('El número de registros excede el presupuesto de clasificación. Divide el archivo.');
      }
    }

    class ExactIndex {
      values = new Map();
      estimated = 0;
      remaining = 0;

      add(value) {
        if (this.values.has(value)) return;
        this.estimated += 112 + value.length * 2;
        if (this.estimated > EXACT_LIMIT) {
          throw new Error('Los valores únicos superan el presupuesto del índice exacto. Divide CSV 1 en archivos más pequeños.');
        }
        // A copied key avoids pinning a decoded block through a sliced string.
        this.values.set(structuredClone(value), false);
        this.remaining++;
      }

      mark(value) {
        if (this.values.get(value) !== false) return;
        this.values.set(value, true);
        this.remaining--;
      }

      matched(value) { return this.values.get(value) === true; }
    }

    class PartialIndex {
      constructor() {
        this.size = 1; // State zero is the root and the sentinel for missing links.
        this.remaining = 0;
        this.root = new Uint32Array(65536);
        this.grow(1024);
      }

      grow(capacity) {
        for (const [name, ArrayType] of [
          ['parent', Uint32Array], ['child', Uint32Array], ['sibling', Uint32Array],
          ['failure', Uint32Array], ['skip', Uint32Array], ['unit', Uint16Array], ['terminal', Uint8Array]
        ]) {
          const expanded = new ArrayType(capacity);
          if (this[name]) expanded.set(this[name]);
          this[name] = expanded;
        }
        this.edges = new Uint32Array(capacity * 2);
        for (let node = 1; node < this.size; node++) {
          const parent = this.parent[node];
          if (parent) this.edges[this.slot(parent, this.unit[node])] = node;
        }
      }

      slot(parent, unit) {
        const mask = this.edges.length - 1;
        let hash = Math.imul(parent, 0x9e3779b1) ^ Math.imul(unit, 0x85ebca77);
        hash ^= hash >>> 16;
        let index = hash & mask;
        let node = this.edges[index];
        while (node && (this.parent[node] !== parent || this.unit[node] !== unit)) {
          index = (index + 1) & mask;
          node = this.edges[index];
        }
        return index;
      }

      next(parent, unit) {
        return parent ? this.edges[this.slot(parent, unit)] : this.root[unit];
      }

      add(value) {
        let state = 0;
        for (let i = 0; i < value.length; i++) {
          const unit = value.charCodeAt(i);
          let node = this.next(state, unit);
          if (!node) {
            if (this.size === TRIE_LIMIT) {
              throw new Error('Los patrones superan el presupuesto del índice parcial. Divide CSV 1 o utiliza coincidencia exacta.');
            }
            if (this.size === this.parent.length) this.grow(this.size * 2);
            node = this.size++;
            this.parent[node] = state;
            this.unit[node] = unit;
            this.sibling[node] = this.child[state];
            this.child[state] = node;
            if (state) this.edges[this.slot(state, unit)] = node;
            else this.root[unit] = node;
          }
          state = node;
        }
        if (!this.terminal[state]) {
          this.terminal[state] = 1;
          this.remaining++;
        }
      }

      async build(job, bytes, total, records) {
        const queue = new Uint32Array(this.size - 1);
        let end = 0;
        for (let node = this.child[0]; node; node = this.sibling[node]) queue[end++] = node;
        for (let i = 0; i < end; i++) {
          const node = queue[i];
          const fallback = this.failure[node];
          this.skip[node] = this.terminal[node] ? node : this.skip[fallback];
          for (let child = this.child[node]; child; child = this.sibling[child]) {
            this.failure[child] = this.step(fallback, this.unit[child]);
            queue[end++] = child;
          }
          if ((i & 8191) === 0) {
            job.progress('Construyendo enlaces del índice parcial', bytes, total, records, 0);
            await job.checkpoint();
          }
        }
        this.child = this.sibling = null;
      }

      step(state, unit) {
        let next = this.next(state, unit);
        while (state && !next) {
          state = this.failure[state];
          next = this.next(state, unit);
        }
        return next;
      }

      pending(state) {
        let node = state;
        while (this.skip[node] !== node) node = this.skip[node];
        while (this.skip[state] !== state && this.skip[state] !== node) {
          const parent = this.skip[state];
          this.skip[state] = node;
          state = parent;
        }
        return node;
      }

      mark(text) {
        let state = 0;
        for (let i = 0; i < text.length && this.remaining; i++) {
          state = this.step(state, text.charCodeAt(i));
          for (let node = this.pending(state); node; node = this.skip[node]) {
            this.terminal[node] = 2;
            this.remaining--;
            this.skip[node] = this.pending(this.failure[node]);
          }
        }
      }

      matched(value) {
        let state = 0;
        for (let i = 0; i < value.length; i++) {
          state = this.next(state, value.charCodeAt(i));
          if (!state) return false;
        }
        return this.terminal[state] === 2;
      }
    }

    function validateColumns(columns, headings) {
      if (!columns.length || columns.some(index => !Number.isInteger(index) || index < 0 || index >= headings.length)) {
        throw new Error('La selección de columnas no es válida para este archivo.');
      }
    }

    async function compare({ files: [source, target], columns: [[column], targets], partial, options, delimiters = [] }, job) {
      const normalize = normalizer(options);
      const totalBytes = source.size * 2 + target.size;
      const index = partial ? new PartialIndex() : new ExactIndex();
      const sourceInfo = await scan(source, {
        header: row => validateColumns([column], row),
        row(row, position) {
          Bitmap.guard(position);
          const value = normalize(row[column]);
          if (value) index.add(value);
        },
        block(bytes, count) { job.progress('Indexando valores de CSV 1', bytes, totalBytes, count, 0); }
      }, job, delimiters[0]);
      if (partial) await index.build(job, source.size, totalBytes, sourceInfo.count);
      const patterns = index.remaining;
      const targetInfo = await scan(target, {
        header: row => validateColumns(targets, row),
        row(row) {
          for (const targetColumn of targets) {
            if (!index.remaining) break;
            const value = normalize(row[targetColumn]);
            if (value) index.mark(value);
          }
        },
        block(bytes, count) {
          job.progress('Buscando en CSV 2', source.size + bytes, totalBytes, count, patterns - index.remaining, 'Valores únicos hallados');
        }
      }, job, delimiters[1]);
      const bitmap = new Bitmap();
      let found = 0;
      const { count } = await scan(source, {
        row(row, position) {
          const value = normalize(row[column]);
          if (value && index.matched(value)) {
            bitmap.set(position);
            found++;
          }
        },
        block(bytes, count) { job.progress('Clasificando filas de CSV 1', source.size + target.size + bytes, totalBytes, count, found); }
      }, job, sourceInfo.delimiter);
      if (count !== sourceInfo.count) throw new Error('CSV 1 cambió durante la comparación. Vuelve a cargarlo.');
      return { mode: 'compare', totals: [count, targetInfo.count], found, blocks: bitmap.blocks };
    }

    async function search({ files, columns, query, partial, options, delimiters = [] }, job) {
      const normalize = normalizer(options);
      const needle = normalize(query);
      if (!query.trim() || !needle) throw new Error('Introduce un texto de búsqueda que no quede vacío al normalizarlo.');
      const totalBytes = files.reduce((total, file) => total + (file?.size ?? 0), 0);
      const reports = [null, null];
      let bytesBefore = 0;
      let recordsBefore = 0;
      let foundBefore = 0;
      for (const [index, file] of files.entries()) {
        if (!file) continue;
        const bitmap = new Bitmap();
        const rows = [];
        let found = 0;
        const { count } = await scan(file, {
          header: row => validateColumns(columns[index], row),
          row(row, position) {
            Bitmap.guard(position);
            for (const column of columns[index]) {
              const value = normalize(row[column]);
              if (partial ? value.includes(needle) : value === needle) {
                bitmap.set(position);
                if (rows.length < PREVIEW_ROWS) rows.push(previewRow(row));
                found++;
                break;
              }
            }
          },
          block(bytes, count) {
            job.progress(`Buscando en CSV ${index + 1}`, bytesBefore + bytes, totalBytes, recordsBefore + count, foundBefore + found);
          }
        }, job, delimiters[index]);
        reports[index] = { count, found, rows, blocks: bitmap.blocks };
        bytesBefore += file.size;
        recordsBefore += count;
        foundBefore += found;
      }
      return { mode: 'search', reports };
    }

    function csvLine(row) {
      return row.map(value => /[",;\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value).join(',') + '\r\n';
    }

    function validateXlsxArchive(bytes) {
      const view = new DataView(bytes);
      const size = view.byteLength;
      const invalid = () => new Error('El archivo no contiene un XLSX válido.');
      if (size < 22 || view.getUint32(0, true) !== 0x04034b50) throw invalid();
      // The end record may be followed by a ZIP comment of up to 65535 bytes.
      let end = size - 22;
      const min = Math.max(0, end - 65535);
      while (end >= min && (view.getUint32(end, true) !== 0x06054b50 ||
        end + 22 + view.getUint16(end + 20, true) !== size)) end--;
      if (end < min || view.getUint32(end + 4, true) !== 0) throw invalid();
      const count = view.getUint16(end + 10, true);
      const directorySize = view.getUint32(end + 12, true);
      let entry = view.getUint32(end + 16, true);
      if (!count || count !== view.getUint16(end + 8, true) || entry + directorySize !== end) throw invalid();
      let expandedSize = 0;
      for (let index = 0; index < count; index++) {
        if (entry + 46 > end || view.getUint32(entry, true) !== 0x02014b50) throw invalid();
        expandedSize += view.getUint32(entry + 24, true);
        if (expandedSize > XLSX_ARCHIVE_LIMIT) throw new Error('El XLSX supera el límite interno de 64 MiB. Guárdalo como CSV para cargarlo.');
        entry += 46 + view.getUint16(entry + 28, true) + view.getUint16(entry + 30, true) + view.getUint16(entry + 32, true);
      }
      if (entry !== end) throw invalid();
    }

    async function importXlsx(file, job) {
      try {
        if (!loadSheetJS) throw new Error('El lector XLSX no está disponible.');
        if (file.size > XLSX_FILE_LIMIT) throw new Error('El XLSX supera 16 MiB. Guárdalo como CSV para cargarlo.');
        job.progress('Abriendo el libro XLSX', 0, 0, 0, 0);
        const bytes = await file.arrayBuffer();
        job.check();
        validateXlsxArchive(bytes);
        const xlsx = loadSheetJS();
        let workbook;
        try {
          workbook = xlsx.read(bytes, { dense: true, sheets: 0, nodim: true, cellHTML: false, cellNF: true });
        } catch {
          throw new Error('No se pudo leer el XLSX. Comprueba que el archivo esté completo y sin contraseña.');
        }
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets?.[sheetName];
        if (workbook.bookType !== 'xlsx' || !sheet?.['!ref'] || !sheet['!data'] || sheet['!type']) {
          throw new Error('La primera hoja del XLSX no contiene una tabla de datos.');
        }
        const { s: start, e: end } = xlsx.utils.decode_range(sheet['!ref']);
        const width = end.c - start.c + 1;
        const height = end.r - start.r + 1;
        if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
          throw new Error('La primera hoja del XLSX tiene un rango de celdas inválido.');
        }
        if (width > COLUMN_LIMIT || width * height > XLSX_CELL_LIMIT) {
          throw new Error('La primera hoja supera 1024 columnas o 2 millones de celdas. Guárdala como CSV para cargarla.');
        }
        const encoder = new TextEncoder();
        const parts = [];
        let batch = '';
        let size = 0;
        function flush() {
          const bytes = encoder.encode(batch);
          size += bytes.length;
          if (size > BLOB_LIMIT) throw new Error('La primera hoja supera 32 MiB como CSV. Guárdala como CSV para cargarla.');
          parts.push(bytes);
          batch = '';
        }
        for (let r = start.r; r <= end.r; r++) {
          const cells = sheet['!data'][r];
          const row = Array.from({ length: width }, (_, index) => {
            const cell = cells?.[start.c + index];
            if (!cell || cell.t === 'z') return '';
            if (cell.t === 's' || cell.t === 'str') return String(cell.v ?? '');
            const displayed = xlsx.utils.format_cell(cell);
            // General and scientific display can round distinct identifiers to the same text.
            if (cell.t === 'n' && (cell.z === 'General' || /^[+-]?\d+(?:[.,]\d+)?e[+-]\d+$/i.test(displayed))) {
              return String(cell.v);
            }
            return displayed;
          });
          if (row.reduce((length, value) => length + value.length, 0) > ROW_LIMIT) {
            throw new Error(`Fila ${r + 1}: supera el límite de longitud admitido.`);
          }
          batch += csvLine(row);
          if (batch.length >= BLOCK) flush();
          if ((r - start.r) % 256 === 0) {
            job.progress('Leyendo la primera hoja', r - start.r, height, r - start.r, 0);
            await job.checkpoint();
          }
        }
        if (batch) flush();
        // A BOM keeps an actual U+FEFF at the start of the first cell intact.
        const converted = new File(['\ufeff', ...parts], file.name, { type: 'text/csv' });
        const metadata = await inspect(converted, job, ',');
        return { ...metadata, file: converted, count: height - 1, sheetName };
      } catch (error) {
        if (error.name === 'AbortError' || error.message.startsWith(`${file.name}:`)) throw error;
        throw new Error(`${file.name}: ${error.message}`);
      }
    }

    async function exportCsv({ file, blocks, invert, expected, total, buffered, delimiter }, job) {
      const bitmap = new Bitmap(blocks);
      const encoder = new TextEncoder();
      let lines = ['\ufeff'];
      let bytesWritten = 0;
      let exported = 0;
      const { count } = await scan(file, {
        header(row) { lines.push(csvLine(row)); },
        row(row, index) {
          if (bitmap.has(index) !== invert) {
            lines.push(csvLine(row));
            exported++;
          }
        },
        async block(bytes, count) {
          if (lines.length) {
            const data = encoder.encode(lines.join(''));
            lines = [];
            bytesWritten += data.byteLength;
            if (buffered && bytesWritten > BLOB_LIMIT) {
              throw new Error('La salida supera el límite de descarga de 32 MiB. Usa un navegador con guardado directo y abre CSV MATCH como página principal.');
            }
            await job.write(data);
            job.check();
          }
          job.progress('Generando el archivo CSV', bytes, file.size, count, exported, 'Registros exportados');
        }
      }, job, delimiter);
      if (count !== total || exported !== expected) throw new Error('El archivo de origen cambió. Repite la operación antes de exportar.');
      return { count: exported, bytes: bytesWritten };
    }

    async function run(type, data, io = {}) {
      const started = performance.now();
      let lastUpdate = -Infinity;
      let lastYield = started;
      const job = {
        check() { io.signal?.throwIfAborted(); },
        async checkpoint() {
          if (performance.now() - lastYield >= 12) {
            await new Promise(resolve => setTimeout(resolve, 0));
            lastYield = performance.now();
          }
          job.check();
        },
        progress(phase, bytes, total, processed, found, foundLabel = 'Coincidencias') {
          const now = performance.now();
          if (now - lastUpdate < 100 && bytes !== total && phase === job.lastPhase) return;
          lastUpdate = now;
          job.lastPhase = phase;
          io.progress?.({ phase, bytes, total, processed, found, foundLabel, time: now - started });
        },
        write: io.write
      };
      job.check();
      const handlers = { inspect, importXlsx, compare, search, export: exportCsv };
      const result = await handlers[type](data, job);
      job.check();
      return { ...result, time: performance.now() - started };
    }

    function transferList(result) {
      const blocks = result.blocks ?? result.reports?.flatMap(report => report?.blocks ?? []) ?? [];
      return blocks.filter(Boolean).map(block => block.buffer);
    }

    function listen() {
      let acknowledge;
      self.onmessage = async ({ data: message }) => {
        if (message.kind === 'ack') {
          const resolve = acknowledge;
          acknowledge = null;
          resolve();
          return;
        }
        try {
          const result = await run(message.type, message.data, {
            progress: progress => self.postMessage({ kind: 'progress', progress }),
            write: data => new Promise(resolve => {
              acknowledge = resolve;
              self.postMessage({ kind: 'chunk', data }, [data.buffer]);
            })
          });
          self.postMessage({ kind: 'done', result }, transferList(result));
        } catch (error) {
          self.postMessage({ kind: 'error', message: error.message });
        }
      };
      self.postMessage({ kind: 'ready' });
    }

    return { run, listen, BLOB_LIMIT, Parser, PartialIndex, normalizer };
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = createEngine;
  else root.CSVMatchEngine = createEngine;
})(globalThis);
