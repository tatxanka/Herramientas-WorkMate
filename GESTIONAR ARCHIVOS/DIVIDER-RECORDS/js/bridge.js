(function (root) {
  'use strict';

  function workerHost(engine) {
    let pending;
    const sink = {};
    for (const operation of ['begin', 'write', 'end']) {
      sink[operation] = value => new Promise((resolve, reject) => {
        pending = { resolve, reject };
        self.postMessage({ type: 'sink', operation, value }, operation === 'write' ? [value.buffer] : []);
      });
    }
    sink.abort = async () => {};
    self.onmessage = async ({ data }) => {
      if (data.type === 'ack') {
        if (data.error) pending?.reject(new Error(data.error));
        else pending?.resolve();
        pending = null;
        return;
      }
      const io = { progress: value => self.postMessage({ type: 'progress', value }) };
      try {
        const value = data.type === 'inspect' ? await engine.inspect(data.file, data.options, io) :
          await engine.split(data.file, data.summary, data.options, sink, io);
        self.postMessage({ type: 'result', value });
      } catch (error) { self.postMessage({ type: 'error', value: error.message }); }
    };
    self.postMessage({ type: 'ready' });
  }

  const cancelled = () => new DOMException('Operación cancelada.', 'AbortError');

  async function startWorker() {
    let worker, url, timer;
    try {
      const code = '(' + workerHost + ')((' + root.DividerEngine + ')((' + root.DividerArchive + '),(' + root.CSVMatchXlsxLibrary + ')));';
      url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
      worker = new Worker(url);
      await new Promise((resolve, reject) => {
        timer = setTimeout(reject, 3000);
        worker.onerror = event => { event.preventDefault(); reject(); };
        worker.onmessage = ({ data }) => { if (data.type === 'ready') resolve(); };
      });
      return worker;
    } catch {
      worker?.terminate();
      return null;
    } finally {
      clearTimeout(timer);
      if (url) URL.revokeObjectURL(url);
    }
  }

  async function run(engine, request, { signal, progress, sink, fallback }) {
    const worker = await startWorker();
    if (signal.aborted) {
      worker?.terminate();
      throw cancelled();
    }
    if (!worker) {
      fallback();
      const options = { ...request.options, mainThread: true };
      return request.type === 'inspect' ? engine.inspect(request.file, options, { signal, progress }) :
        engine.split(request.file, request.summary, options, sink, { signal, progress });
    }
    let writing = Promise.resolve();
    let cancel;
    try {
      return await new Promise((resolve, reject) => {
        cancel = () => { worker.terminate(); reject(cancelled()); };
        signal.addEventListener('abort', cancel, { once: true });
        worker.onerror = event => { event.preventDefault(); reject(new Error('El Worker se interrumpió durante la operación.')); };
        worker.onmessageerror = () => reject(new Error('No se pudo transferir un bloque de datos.'));
        worker.onmessage = ({ data }) => {
          if (data.type === 'progress') progress(data.value);
          if (data.type === 'result') resolve(data.value);
          if (data.type === 'error') reject(new Error(data.value));
          if (data.type === 'sink') {
            writing = writing.then(async () => {
              if (signal.aborted) return;
              try {
                await sink[data.operation](data.value);
                if (!signal.aborted) worker.postMessage({ type: 'ack' });
              } catch (error) {
                if (!signal.aborted) worker.postMessage({ type: 'ack', error: error.message });
              }
            });
            writing.catch(reject);
          }
        };
        worker.postMessage(request);
      });
    } catch (error) {
      await writing.catch(() => {});
      await sink?.abort();
      throw error;
    } finally {
      signal.removeEventListener('abort', cancel);
      worker.terminate();
    }
  }

  function output(engine, signal, target) {
    const parts = [];
    let chunks, directory, writer, handle, name, touched = 0;
    const check = () => { if (signal.aborted) throw cancelled(); };
    return {
      parts,
      get directory() { return directory?.name; },
      get touched() { return touched; },
      async begin(filename) {
        check();
        name = filename;
        if (!target) { chunks = []; return; }
        if (!directory) {
          const label = 'DIVIDER-RECORDS-' + crypto.randomUUID();
          try {
            await target.getDirectoryHandle(label);
            throw new Error('La carpeta de salida ya existe. Inténtalo de nuevo.');
          } catch (error) { if (error.name !== 'NotFoundError') throw error; }
          directory = await target.getDirectoryHandle(label, { create: true });
        }
        try {
          await directory.getFileHandle(name);
          throw new Error('El archivo «' + name + '» ya existe. Se ha evitado sobrescribirlo.');
        } catch (error) { if (error.name !== 'NotFoundError') throw error; }
        check();
        handle = await directory.getFileHandle(name, { create: true });
        touched++;
        writer = await handle.createWritable({ mode: 'exclusive' });
      },
      async write(bytes) {
        check();
        if (target) await writer.write(bytes);
        else chunks.push(bytes);
      },
      async end(meta) {
        check();
        let blob;
        if (target) {
          await writer.close();
          writer = null;
          blob = await handle.getFile();
          const reader = blob.stream().getReader();
          let crc = 0xffffffff;
          try {
            for (;;) {
              check();
              const { value, done } = await reader.read();
              if (done) break;
              crc = engine.archive.crc(value, crc);
            }
          } finally {
            await reader.cancel().catch(() => {});
            reader.releaseLock();
          }
          if (((crc ^ 0xffffffff) >>> 0) !== meta.checksum) throw new Error('La relectura de «' + name + '» no coincide.');
          handle = null;
        } else {
          blob = new Blob(chunks, { type: 'text/csv;charset=utf-8' });
          chunks = null;
        }
        if (blob.size !== meta.bytes) throw new Error('El tamaño de «' + name + '» no coincide con lo escrito.');
        parts.push({ ...meta, blob });
      },
      async abort() {
        if (writer) await writer.abort().catch(() => {});
        writer = handle = chunks = null;
        parts.length = 0;
      }
    };
  }

  root.DividerBridge = { run, output };
})(globalThis);
