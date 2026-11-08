"""Verify synthetic exports with Python's independent CSV reader."""

import csv
import io
import json
from pathlib import Path
import subprocess
import unittest


ENGINE = Path(__file__).resolve().parents[1] / "js" / "engine.js"
HARNESS = r"""
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { run } = require(process.argv[1])();
const input = JSON.parse(readFileSync(0, 'utf8'));
const files = input.map((text, index) => new File([text], `fixture-${index}.csv`));
const args = { files, options: {}, columns: [[0], [0]], partial: false, delimiters: [',', ';'] };
(async () => {
  const match = await run('compare', args);
  const search = await run('search', { ...args, query: '00123' });
  const selections = [
    [0, match.blocks, false, match.found, match.totals[0]],
    [0, match.blocks, true, match.totals[0] - match.found, match.totals[0]],
    ...search.reports.map(({blocks, found, count}, index) => [index, blocks, false, found, count])
  ];
  const result = {};
  for (const outputDelimiter of [';', ',']) {
    result[outputDelimiter] = [];
    for (const [index, blocks, invert, expected, total] of selections) {
      const chunks = [];
      const data = {file: files[index], blocks, invert, expected, total, delimiter: args.delimiters[index], outputDelimiter};
      const measured = await run('export', { ...data, measure: true }, { write: () => assert.fail('Measurement wrote output') });
      const written = await run('export', { ...data, buffered: true, byteLimit: measured.bytes }, {
        write: chunk => chunks.push(Buffer.from(chunk))
      });
      const bytes = Buffer.concat(chunks);
      assert.equal(bytes.length, measured.bytes);
      assert.equal(bytes.length, written.bytes);
      result[outputDelimiter].push(bytes.toString('utf8'));
    }
  }
  process.stdout.write(JSON.stringify(result));
})().catch(error => { console.error(error); process.exitCode = 1; });
"""


def make_csv(rows, separator):
    stream = io.StringIO(newline="")
    csv.writer(stream, delimiter=separator).writerows(rows)
    return stream.getvalue()


class ExportRoundTrip(unittest.TestCase):
    def test_exact_partitions_and_search_keep_values_in_both_dialects(self):
        header = ["Código", "Nombre", "Nombre", ""]
        match = ["00123", 'coma, punto; y "comillas"', "línea 1\r\nlínea 2\nfin", ""]
        unmatched = ["00456", " 01/02/2026 ", "10,20", ""]
        blank = ["", "sin código", "\ttexto", ""]
        other_header = ["ID", "Nota"]
        other_match = ["00123", "=1+1"]
        inputs = [
            make_csv([header, match, unmatched, match, blank], ","),
            make_csv([other_header, other_match, ["", "vacío"]], ";"),
        ]
        run = subprocess.run(["node", "-e", HARNESS, str(ENGINE)], input=json.dumps(inputs),
                             encoding="utf-8", capture_output=True, check=True)
        result = json.loads(run.stdout)
        expected = [[header, match, match], [header, unmatched, blank],
                    [header, match, match], [other_header, other_match]]
        for separator in (";", ","):
            with self.subTest(separator=separator):
                self.assertEqual(len(result[separator]), len(expected))
                for output, rows in zip(result[separator], expected):
                    self.assertTrue(output.startswith("\ufeff"))
                    self.assertEqual(list(csv.reader(io.StringIO(output[1:], newline=""),
                                                     delimiter=separator, strict=True)), rows)


if __name__ == "__main__":
    unittest.main()
