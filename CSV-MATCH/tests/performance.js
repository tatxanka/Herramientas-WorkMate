const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createInterface } = require('node:readline');
const createEngine = require('../js/engine.js');

const browserMode = process.argv[2] !== '--engine';
const options = { caseFold: false, trim: false, accents: false };
const scenarios = [10000, 100000, 500000, 1000000, 2000000].map(rows => ({ name: 'corta', rows, cardinality: Math.min(rows, 200000), long: false }));
scenarios.push({ name: 'larga', rows: 10000, cardinality: 2000, long: true });
scenarios.push({ name: 'alta cardinalidad', rows: 1000000, cardinality: 1000000, long: false });
const elapsed = since => Math.round(performance.now() - since);

function generate(directory, scenario) {
  const files = [path.join(directory, 'origen.csv'), path.join(directory, 'destino.csv')];
  const fds = files.map(file => fs.openSync(file, 'w'));
  let left = 'id,valor,nota\n';
  let right = 'id,referencia,detalle\n';
  try {
    for (let i = 0; i < scenario.rows; i++) {
      const id = String(i).padStart(7, '0');
      const suffix = String(i % scenario.cardinality).padStart(7, '0');
      const pattern = 'K' + (scenario.long ? 'L'.repeat(600) : '') + suffix;
      const exact = i % 4 === 0;
      const partial = i % 4 === 1;
      left += `${id},${pattern},x\n`;
      right += `${id},${exact ? pattern : 'x'},${partial ? `inicio ${pattern} fin` : 'x'}\n`;
      if ((i & 4095) === 4095) {
        fs.writeFileSync(fds[0], left); fs.writeFileSync(fds[1], right);
        left = right = '';
      }
    }
    fs.writeFileSync(fds[0], left); fs.writeFileSync(fds[1], right);
  } finally { fds.forEach(fd => fs.closeSync(fd)); }
  return files;
}

async function verify(file, kind, expected, scenario) {
  let previous = -1;
  let rows = 0;
  let isHeader = true;
  const target = kind === 'search2';
  const lines = createInterface({ input: fs.createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const row of lines) {
    if (isHeader) {
      assert.equal(row, target ? '\ufeffid,referencia,detalle' : '\ufeffid,valor,nota');
      isHeader = false;
      continue;
    }
    const id = Number(row.slice(0, 7));
    assert.ok(id > previous && id < scenario.rows);
    const exact = id % 4 === 0;
    const partial = id % 4 < 2;
    const pattern = 'K' + (scenario.long ? 'L'.repeat(600) : '') + String(id % scenario.cardinality).padStart(7, '0');
    assert.equal(row, `${String(id).padStart(7, '0')},${pattern},x`);
    if (kind.startsWith('search')) assert.equal(id % scenario.cardinality, 0);
    else if (kind === 'exact') assert.ok(exact);
    else if (kind === 'exactExcluded') assert.ok(!exact);
    else if (kind === 'partial') assert.ok(partial);
    else assert.ok(!partial);
    previous = id;
    rows++;
  }
  assert.equal(isHeader, false);
  assert.equal(rows, expected);
}

async function benchmarkBrowser(browser, files, scenario) {
  const context = await browser.newContext({ offline: true });
  await context.addInitScript(() => { window.showSaveFilePicker = undefined; });
  const page = await context.newPage();
  const ui = page.locator('csv-match');
  const output = {};
  let workerCount = 0;
  page.on('worker', () => workerCount++);
  try {
    await page.goto(pathToFileURL(path.resolve(__dirname, '../index.html')).href);
    let start = performance.now();
    for (const [index, file] of files.entries()) {
      await page.locator('.file-input').nth(index).setInputFiles(file);
      await page.locator('.file-settings').nth(index).waitFor({ state: 'visible' });
      assert.equal(await page.locator('.file-settings').nth(index).locator('tbody tr').count(), 10);
    }
    output.previews = elapsed(start);
    await page.locator('select').selectOption('1');
    await page.locator('.multiselect summary').click();
    for (const [caption, checked] of [['1. id', false], ['2. referencia', true], ['3. detalle', true]]) {
      await page.getByRole('checkbox', { name: caption, exact: true }).setChecked(checked);
    }
    await page.locator('.multiselect summary').press('Escape');
    const searchCount = Math.ceil(scenario.rows / scenario.cardinality);
    for (const [kind, count, count2] of [['exact', scenario.rows / 4, scenario.rows * 3 / 4], ['partial', scenario.rows / 2, scenario.rows / 2], ['search', searchCount, searchCount]]) {
      if (kind === 'partial') await page.getByLabel('Coincidencia parcial').check();
      if (kind === 'search') {
        await page.getByRole('tab', { name: 'Buscar texto' }).click();
        await page.getByLabel('Texto que deseas buscar').fill('K' + (scenario.long ? 'L'.repeat(600) : '') + '0000000');
        await page.getByLabel('Ambos', { exact: true }).check();
      }
      await page.locator('.run').click();
      const result = page.locator('.results');
      const notice = page.getByRole('alert');
      await result.or(notice).waitFor({ state: 'visible', timeout: 120000 });
      if (await notice.isVisible()) throw new Error(await notice.innerText());
      output[kind] = Math.round(await ui.evaluate(app => app.result.time));
      const exports = kind === 'search' ? ['search1', 'search2'] : [kind, `${kind}Excluded`];
      for (const [index, expected] of [count, count2].entries()) {
        start = performance.now();
        const [download] = await Promise.all([page.waitForEvent('download', { timeout: 120000 }), page.locator('.download').nth(index).click()]);
        const file = await download.path();
        output[exports[index] + 'Export'] = elapsed(start);
        await verify(file, exports[index], expected, scenario);
        await download.delete();
      }
    }
    assert.ok(workerCount >= 11, `Workers observados: ${workerCount}`);
    return output;
  } finally { await context.close(); }
}

async function benchmarkEngine(files, scenario) {
  const { run } = createEngine();
  const baseline = process.memoryUsage.rss();
  let peak = baseline;
  const progress = () => { peak = Math.max(peak, process.memoryUsage.rss()); };
  const inputs = await Promise.all(files.map(file => fs.openAsBlob(file)));
  const output = {};
  for (const [type, partial] of [['compare', false], ['compare', true], ['search', true]]) {
    const key = type === 'search' ? type : partial ? 'partial' : 'exact';
    const report = await run(type, {
      files: inputs, columns: [[1], [1, 2]], options, partial,
      query: 'K' + (scenario.long ? 'L'.repeat(600) : '') + '0000000'
    }, { progress });
    if (type === 'search') assert.deepEqual(report.reports.map(item => item.found), Array(2).fill(Math.ceil(scenario.rows / scenario.cardinality)));
    else assert.equal(report.found, scenario.rows / (partial ? 2 : 4));
    output[key] = Math.round(report.time);
  }
  return { ...output, baselineRSSMiB: Math.round(baseline / 1048576), sampledPeakRSSMiB: Math.round(peak / 1048576) };
}

async function main() {
  const temp = await fsp.mkdtemp(path.join(os.tmpdir(), 'csv-match-perf-'));
  let browser;
  try {
    if (browserMode) {
      const { chromium } = require(process.env.CSV_MATCH_PW || 'playwright-core');
      browser = await chromium.launch({ channel: 'chrome' });
    }
    console.log(JSON.stringify({ runtime: browser?.version() ?? process.version, os: os.version(), cpu: os.cpus()[0].model, unit: 'ms' }));
    for (const scenario of scenarios) {
      if (!browser && global.gc) global.gc();
      const files = generate(temp, scenario);
      const sizes = files.map(file => fs.statSync(file).size);
      const result = await (browser ? benchmarkBrowser(browser, files, scenario) : benchmarkEngine(files, scenario));
      console.log(JSON.stringify({ ...scenario, sizes, ...result }));
    }
  } finally {
    await browser?.close();
    // Remove only the two files written into this newly created temporary directory.
    for (const file of ['origen.csv', 'destino.csv']) await fsp.unlink(path.join(temp, file)).catch(error => { if (error.code !== 'ENOENT') throw error; });
    await fsp.rmdir(temp);
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
