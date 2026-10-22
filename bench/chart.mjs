// Renders benchmark report JSON into SVG charts for the README.
//
//   node bench/chart.mjs <output-directory> <report.json>...
//
// Samples from all reports are pooled per variant and scenario. Each latency
// chart draws one row per scenario, scaled to that row's slowest variant, with
// absolute medians in ms. The C++ vs Rust chart plots the pooled multiplier and
// the range of per-round paired ratios.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const [outputDirectory, ...reportPaths] = process.argv.slice(2);
if (!outputDirectory || reportPaths.length === 0) throw new Error('Usage: chart.mjs <output-directory> <report.json>...');
const reports = await Promise.all(reportPaths.map(async path => JSON.parse(await readFile(path, 'utf8'))));

const VARIANTS = [
  { label: 'js', name: 'JS', color: '#c9a400' },
  { label: 'cpp', name: 'C++ (libcf)', color: '#00599c' },
  { label: 'rust', name: 'Rust (workers-rs)', color: '#ce422b' },
];
const TITLES = {
  hello: 'Hello', 'echo-1024': 'Echo 1 KiB', 'echo-65536': 'Echo 64 KiB', 'echo-1048576': 'Echo 1 MiB',
  'sha256-1x-1024': 'SHA-256 1 × 1 KiB', 'sha256-16x-1024': 'SHA-256 16 × 1 KiB', 'sha256-1x-65536': 'SHA-256 1 × 64 KiB',
  'image-256': 'Image 256²', 'image-1024': 'Image 1024²', 'search-small': 'Search 1k × 128', 'search-large': 'Search 8k × 128 × 8',
  'io-serial': 'Fan-out 12, serial', 'io-fanout-6': 'Fan-out 12, 6 at once', 'io-fanout-12': 'Fan-out 12, all at once',
  'io-64k-6': 'Fan-out 8 × 64 KiB, 6 at once',
};
const GROUPS = {
  bridge: { title: 'Request handling and platform calls', scenarios: ['hello', 'echo-1024', 'echo-65536', 'echo-1048576', 'sha256-1x-1024', 'sha256-16x-1024', 'sha256-1x-65536'] },
  compute: { title: 'Compute: image filter and vector search', scenarios: ['image-256', 'image-1024', 'search-small', 'search-large'] },
  io: { title: 'I/O fan-out through a service binding (10 ms per shard)', scenarios: ['io-serial', 'io-fanout-6', 'io-fanout-12', 'io-64k-6'] },
};

const median = values => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = (sorted.length - 1) / 2;
  return (sorted[Math.floor(middle)] + sorted[Math.ceil(middle)]) / 2;
};
const samples = (label, scenario) => reports.flatMap(report =>
  report.runs.filter(run => run.label === label).flatMap(run => run.measurements[scenario]?.samples ?? []));
const pairedRatios = scenario => reports.flatMap(report => {
  const rounds = [...new Set(report.runs.map(run => run.round))];
  return rounds.map(round => {
    const at = label => report.runs.find(run => run.round === round && run.label === label)?.measurements[scenario]?.milliseconds.median;
    return at('cpp') / at('rust');
  }).filter(Number.isFinite);
});
const escape = text => String(text).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const formatMs = value => value >= 100 ? value.toFixed(0) : value >= 10 ? value.toFixed(1) : value.toFixed(2);
const FONT = 'font-family="-apple-system, BlinkMacSystemFont, Segoe UI, Helvetica, Arial, sans-serif"';

function svg(width, height, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" ${FONT}>\n` +
    `<rect width="${width}" height="${height}" fill="#ffffff"/>\n${body}</svg>\n`;
}

function legend(x, y) {
  return VARIANTS.map((variant, index) => {
    const left = x + index * 150;
    return `<rect x="${left}" y="${y - 10}" width="12" height="12" rx="2" fill="${variant.color}"/>` +
      `<text x="${left + 18}" y="${y}" font-size="12" fill="#333">${escape(variant.name)}</text>`;
  }).join('\n') + '\n';
}

function latencyChart(group) {
  const scenarios = group.scenarios.filter(scenario => samples('cpp', scenario).length);
  const width = 760, labelWidth = 190, barMax = 440, barHeight = 14, rowGap = 14, top = 86;
  const rowHeight = VARIANTS.length * (barHeight + 3) + rowGap;
  const height = top + scenarios.length * rowHeight + 30;
  let body = `<text x="20" y="26" font-size="16" font-weight="600" fill="#111">${escape(group.title)}</text>\n`;
  body += `<text x="20" y="44" font-size="11" fill="#666">Median latency in ms (lower is better). Each row is scaled to its slowest variant.</text>\n`;
  body += legend(labelWidth, 70);
  scenarios.forEach((scenario, row) => {
    const y = top + row * rowHeight;
    const medians = VARIANTS.map(variant => median(samples(variant.label, scenario)));
    const slowest = Math.max(...medians);
    body += `<text x="${labelWidth - 12}" y="${y + rowHeight / 2 - 2}" font-size="13" text-anchor="end" fill="#222">${escape(TITLES[scenario] ?? scenario)}</text>\n`;
    VARIANTS.forEach((variant, index) => {
      const barY = y + index * (barHeight + 3);
      const length = Math.max(2, (medians[index] / slowest) * barMax);
      body += `<rect x="${labelWidth}" y="${barY}" width="${length.toFixed(1)}" height="${barHeight}" rx="2" fill="${variant.color}"/>` +
        `<text x="${(labelWidth + length + 6).toFixed(1)}" y="${barY + barHeight - 3}" font-size="11" fill="#333">${formatMs(medians[index])} ms</text>\n`;
    });
    if (row < scenarios.length - 1)
      body += `<line x1="20" x2="${width - 20}" y1="${y + rowHeight - rowGap / 2}" y2="${y + rowHeight - rowGap / 2}" stroke="#eee"/>\n`;
  });
  return svg(width, height, body);
}

function multiplierChart() {
  const scenarios = Object.values(GROUPS).flatMap(group => group.scenarios).filter(scenario => samples('cpp', scenario).length);
  const width = 760, labelWidth = 220, plotWidth = 480, rowHeight = 26, top = 78, low = 0.7, high = 1.3;
  const height = top + scenarios.length * rowHeight + 46;
  const x = value => labelWidth + ((Math.min(high, Math.max(low, value)) - low) / (high - low)) * plotWidth;
  let body = `<text x="20" y="26" font-size="16" font-weight="600" fill="#111">libcf (C++) vs workers-rs (Rust)</text>\n`;
  body += `<text x="20" y="44" font-size="11" fill="#666">C++ median ÷ Rust median per scenario; whiskers span the per-round paired ratios. Values beyond the axis are clamped.</text>\n`;
  body += `<text x="${x(0.85)}" y="66" font-size="12" text-anchor="middle" fill="#00599c">← libcf faster</text>`;
  body += `<text x="${x(1.15)}" y="66" font-size="12" text-anchor="middle" fill="#ce422b">workers-rs faster →</text>\n`;
  const bottom = top + scenarios.length * rowHeight;
  for (const tick of [0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.3]) {
    body += `<line x1="${x(tick)}" x2="${x(tick)}" y1="${top - 6}" y2="${bottom}" stroke="${tick === 1 ? '#444' : '#e5e5e5'}" stroke-width="${tick === 1 ? 1.5 : 1}"/>` +
      `<text x="${x(tick)}" y="${bottom + 16}" font-size="11" text-anchor="middle" fill="#555">${tick.toFixed(1)}×</text>\n`;
  }
  scenarios.forEach((scenario, row) => {
    const y = top + row * rowHeight + rowHeight / 2;
    const ratio = median(samples('cpp', scenario)) / median(samples('rust', scenario));
    const rounds = pairedRatios(scenario);
    const color = Math.abs(ratio - 1) < 0.005 ? '#666' : ratio < 1 ? '#00599c' : '#ce422b';
    body += `<text x="${labelWidth - 12}" y="${y + 4}" font-size="13" text-anchor="end" fill="#222">${escape(TITLES[scenario] ?? scenario)}</text>`;
    if (rounds.length)
      body += `<line x1="${x(Math.min(...rounds))}" x2="${x(Math.max(...rounds))}" y1="${y}" y2="${y}" stroke="${color}" stroke-opacity="0.35" stroke-width="4" stroke-linecap="round"/>`;
    body += `<circle cx="${x(ratio)}" cy="${y}" r="5" fill="${color}"/>` +
      `<text x="${labelWidth + plotWidth + 14}" y="${y + 4}" font-size="12" fill="#333">${ratio.toFixed(2)}×</text>\n`;
  });
  return svg(width, height, body);
}

await mkdir(outputDirectory, { recursive: true });
for (const [name, group] of Object.entries(GROUPS))
  await writeFile(join(outputDirectory, `benchmark-${name}.svg`), latencyChart(group));
await writeFile(join(outputDirectory, 'benchmark-cpp-vs-rust.svg'), multiplierChart());
console.log(`Wrote ${Object.keys(GROUPS).length + 1} charts to ${outputDirectory}`);
