'use strict';

const loadSheetJS = require('../vendor/sheetjs-0.20.3');
const XLSX = loadSheetJS();

const csvText = '\ufeffID;Nombre;Nombre;;\r\n' +
  '001;"A;Ñ";"dice ""hola""";"uno\r\ndos";\r\n' +
  '\r\n' +
  '002;雪😀;=1+1;;\n' +
  '002;雪😀;=1+1;;\r\n';
const headings = ['ID', 'Nombre', 'Nombre', '', ''];
const records = [
  ['001', 'A;Ñ', 'dice "hola"', 'uno\r\ndos', ''],
  ['', '', '', '', ''],
  ['002', '雪😀', '=1+1', '', ''],
  ['002', '雪😀', '=1+1', '', '']
];

function workbook() {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([]), 'Vacía');
  const sheet = XLSX.utils.aoa_to_sheet([
    ['Identificador', 'Fecha', 'Porcentaje', 'Importe', 'Hora', 'Resultado', 'Sin valor', 'Texto', '', ''],
    [27, 46023, 0.125, 1234.5, 0.5, 8, null, '000000123456789012345'],
    [],
    ['0009', null, 1234.567, null, null, null, null, 'Ñ 雪']
  ]);
  sheet.A2.z = '000000';
  sheet.B2.z = 'yyyy-mm-dd';
  sheet.C2.z = '0.0%';
  sheet.D2.z = '"€" #,##0.00';
  sheet.E2.z = 'hh:mm';
  sheet.F2.f = '2^3';
  sheet.G2 = { t: 'n', f: '1+2' };
  XLSX.utils.book_append_sheet(book, sheet, 'Datos');
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['A', 'B'], ['segunda', 'hoja']]), 'Alternativa');
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx', compression: true });
}

const expectedSheet = [
  ['Identificador', 'Fecha', 'Porcentaje', 'Importe', 'Hora', 'Resultado', 'Sin valor', 'Texto', '', ''],
  ['000027', '2026-01-01', '12.5%', '€ 1,234.50', '12:00', '8', '', '000000123456789012345', '', ''],
  ['', '', '', '', '', '', '', '', '', ''],
  ['0009', '', '1234.567', '', '', '', '', 'Ñ 雪', '', '']
];

// Test-only oracle. A regular expression consumes complete fields instead of using the
// production state machine, and never infers a separator or fixes row widths.
function parseCsv(bytes, delimiter) {
  const input = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const token = new RegExp('(?:"((?:[^"]|"")*)"|([^"\\r\\n' + delimiter + ']*))(' + delimiter + '|\\r\\n|\\n|\\r|$)', 'y');
  const rows = [];
  let row = [], index = 0, continuation = false;
  while (index < input.length || continuation) {
    token.lastIndex = index;
    const field = token.exec(input);
    if (!field) throw new Error('CSV inválido para el lector independiente en ' + index);
    row.push(field[1] !== undefined ? field[1].replace(/""/g, '"') : field[2]);
    index = token.lastIndex;
    continuation = field[3] === delimiter;
    if (!continuation) {
      rows.push(row);
      row = [];
    }
  }
  return rows;
}

// Read the central directory with a separate test implementation and check local entries.
function unzipStore(bytes) {
  const data = Buffer.from(bytes);
  const end = data.length - 22;
  if (data.readUInt32LE(end) !== 0x06054b50) throw new Error('ZIP sin directorio');
  const count = data.readUInt16LE(end + 10);
  const files = new Map();
  let cursor = data.readUInt32LE(end + 16);
  for (let i = 0; i < count; i++) {
    if (data.readUInt32LE(cursor) !== 0x02014b50 || data.readUInt16LE(cursor + 10) !== 0) throw new Error('Entrada ZIP inesperada');
    const length = data.readUInt16LE(cursor + 28);
    const local = data.readUInt32LE(cursor + 42);
    const name = data.toString('utf8', cursor + 46, cursor + 46 + length);
    if (files.has(name) || data.readUInt32LE(local) !== 0x04034b50) throw new Error('Cabecera ZIP inválida');
    const start = local + 30 + data.readUInt16LE(local + 26) + data.readUInt16LE(local + 28);
    const end = start + data.readUInt32LE(cursor + 24);
    const payload = data.subarray(start, end);
    if (require('node:zlib').crc32(payload) !== data.readUInt32LE(cursor + 16)) throw new Error('CRC ZIP incorrecto');
    files.set(name, payload);
    cursor += 46 + length + data.readUInt16LE(cursor + 30) + data.readUInt16LE(cursor + 32);
  }
  if (cursor !== end) throw new Error('El directorio ZIP no termina donde se esperaba');
  return files;
}

module.exports = { csvText, headings, records, workbook, expectedSheet, parseCsv, unzipStore };
