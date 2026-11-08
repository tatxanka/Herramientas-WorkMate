(function (root) {
  'use strict';

  function createArchive() {
    const table = Uint32Array.from({ length: 256 }, (_, value) => {
      for (let i = 0; i < 8; i++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
      return value;
    });

    function crc(bytes, value = 0xffffffff) {
      for (const byte of bytes) value = (value >>> 8) ^ table[(value ^ byte) & 255];
      return value;
    }

    // Validate the ZIP envelope and bound actual expansion before giving it to SheetJS.
    // The checks follow the archive-validation approach used by CSV MATCH v1.0.1.
    async function checkWorkbook(bytes, limits, check) {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const u16 = at => view.getUint16(at, true);
      const u32 = at => view.getUint32(at, true);
      const bad = () => new Error('El XLSX está dañado o usa una estructura ZIP no admitida.');
      const size = bytes.length;
      if (size < 22 || u32(0) !== 0x04034b50) throw bad();
      let end = size - 22;
      const minimum = Math.max(0, end - 65535);
      while (end >= minimum && (u32(end) !== 0x06054b50 || end + 22 + u16(end + 20) !== size)) end--;
      if (end < minimum || u32(end + 4) !== 0) throw bad();
      const count = u16(end + 10);
      let entry = u32(end + 16);
      const directory = entry;
      if (!count || count > 4096 || count !== u16(end + 8) || entry + u32(end + 12) !== end) throw bad();
      const names = new Set();
      const entries = [];
      let expansion = 0;
      for (let i = 0; i < count; i++) {
        if (entry + 46 > end || u32(entry) !== 0x02014b50) throw bad();
        const flags = u16(entry + 8), method = u16(entry + 10), checksum = u32(entry + 16);
        const compressed = u32(entry + 20), expanded = u32(entry + 24), length = u16(entry + 28), local = u32(entry + 42);
        const next = entry + 46 + length + u16(entry + 30) + u16(entry + 32);
        if (!length || next > end || local + 30 > directory || u32(local) !== 0x04034b50 ||
            u16(entry + 34) || flags & 0x2041 || (method !== 0 && method !== 8) ||
            u16(local + 6) !== flags || u16(local + 8) !== method || u16(local + 26) !== length) throw bad();
        const start = local + 30 + length + u16(local + 28);
        let stop = start + compressed;
        if (stop > directory || (method === 0 && expanded !== compressed)) throw bad();
        const nameBytes = bytes.subarray(entry + 46, entry + 46 + length);
        if (!nameBytes.every((byte, j) => byte === bytes[local + 30 + j])) throw bad();
        const name = new TextDecoder().decode(nameBytes);
        if (names.has(name) || /(^\/|\\|(?:^|\/)\.\.(?:\/|$))/.test(name)) throw bad();
        names.add(name);
        if (flags & 8) {
          if (stop + 12 > directory) throw bad();
          if (u32(stop) === 0x08074b50) stop += 4;
          if (stop + 12 > directory || u32(stop) !== checksum ||
              u32(stop + 4) !== compressed || u32(stop + 8) !== expanded) throw bad();
          stop += 12;
        } else if (u32(local + 14) !== checksum || u32(local + 18) !== compressed || u32(local + 22) !== expanded) throw bad();
        expansion += expanded;
        if (expansion > limits.expanded) throw new RangeError('El XLSX supera el límite de expansión. Guárdalo como CSV.');
        entries.push({ name, local, start, compressed, stop, method, expanded, checksum });
        entry = next;
      }
      if (entry !== end || !names.has('[Content_Types].xml') || !names.has('xl/workbook.xml')) throw bad();

      let previous = 0, cells = 0;
      for (const item of entries.sort((a, b) => a.local - b.local)) {
        await check();
        if (item.local < previous) throw bad();
        previous = item.stop;
        if (item.method === 8 && typeof DecompressionStream !== 'function') {
          throw new Error('Este navegador no puede verificar la compresión XLSX. Usa Chrome o guarda el libro como CSV.');
        }
        let offset = item.start;
        const input = new ReadableStream({ pull(controller) {
          const end = item.start + item.compressed;
          if (offset === end) return controller.close();
          const next = Math.min(end, offset + (item.method === 8 ? 4096 : 65536));
          controller.enqueue(bytes.subarray(offset, next));
          offset = next;
        } });
        const reader = (item.method ? input.pipeThrough(new DecompressionStream('deflate-raw')) : input).getReader();
        let length = 0, checksum = 0xffffffff, tail = '', decoder;
        const xml = /\.xml$/i.test(item.name);
        function inspect(text, final) {
          const content = tail + text;
          if (/<!DOCTYPE|<!ENTITY/i.test(content)) throw bad();
          const boundary = final ? content.length : Math.max(0, content.length - 64);
          for (const match of content.matchAll(/<(?:[A-Za-z_][\w.-]{0,32}:)?c(?=[\s/>])/g)) {
            if (match.index >= boundary) break;
            if (++cells > limits.cells) throw new RangeError('El libro supera el límite de celdas. Guárdalo como CSV.');
          }
          tail = content.slice(boundary);
        }
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            length += value.length;
            if (length > item.expanded) throw bad();
            checksum = crc(value, checksum);
            if (xml && value.length) {
              decoder ??= new TextDecoder(value[0] === 0xff || value[1] === 0 ? 'utf-16le' :
                value[0] === 0xfe || value[0] === 0 ? 'utf-16be' : 'utf-8', { fatal: true });
              inspect(decoder.decode(value, { stream: true }), false);
            }
            await check();
          }
          if (decoder) inspect(decoder.decode(), true);
          if (length !== item.expanded || ((checksum ^ 0xffffffff) >>> 0) !== item.checksum) throw bad();
        } catch (error) {
          await reader.cancel().catch(() => {});
          if (error.name === 'AbortError' || error instanceof RangeError) throw error;
          throw bad();
        } finally { reader.releaseLock(); }
      }
    }

    // ZIP STORE keeps the CSV blobs as parts of the archive and adds only small metadata buffers.
    function zip(parts) {
      const encoder = new TextEncoder();
      const body = [], central = [];
      let offset = 0, directoryBytes = 0;
      function header(signature, size) {
        const bytes = new Uint8Array(size);
        const view = new DataView(bytes.buffer);
        view.setUint32(0, signature, true);
        return { bytes, u16: (at, value) => view.setUint16(at, value, true), u32: (at, value) => view.setUint32(at, value, true) };
      }
      for (const { name, blob, bytes, checksum } of parts) {
        const encoded = encoder.encode(name);
        if (!blob || blob.size !== bytes || offset + bytes + 30 + encoded.length >= 0xffffffff) {
          throw new RangeError('Estas partes superan el límite del ZIP compatible.');
        }
        const local = header(0x04034b50, 30);
        local.u16(4, 20);
        local.u16(6, 0x800);
        local.u16(12, 33);
        local.u32(14, checksum);
        local.u32(18, bytes);
        local.u32(22, bytes);
        local.u16(26, encoded.length);
        const entry = header(0x02014b50, 46);
        entry.u16(4, 20);
        entry.u16(6, 20);
        entry.u16(8, 0x800);
        entry.u16(14, 33);
        entry.u32(16, checksum);
        entry.u32(20, bytes);
        entry.u32(24, bytes);
        entry.u16(28, encoded.length);
        entry.u32(42, offset);
        body.push(local.bytes, encoded, blob);
        central.push(entry.bytes, encoded);
        offset += 30 + encoded.length + bytes;
        directoryBytes += 46 + encoded.length;
      }
      if (parts.length > 65535 || offset + directoryBytes >= 0xffffffff) throw new RangeError('El ZIP supera el límite compatible.');
      const end = header(0x06054b50, 22);
      end.u16(8, parts.length);
      end.u16(10, parts.length);
      end.u32(12, directoryBytes);
      end.u32(16, offset);
      return new Blob([...body, ...central, end.bytes], { type: 'application/zip' });
    }

    return { crc, checkWorkbook, zip };
  }

  if (typeof module === 'object' && module.exports) module.exports = createArchive;
  else root.DividerArchive = createArchive;
})(globalThis);
