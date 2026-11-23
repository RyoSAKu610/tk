import { createHash } from 'node:crypto';
import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const dist = new URL('../dist/', import.meta.url);

/** Public entrypoints that run without an application server. */
const ENTRIES = [
  ['index.html', 'landing', 'Hyperdash Data API — landing page (dash + terminal skins)'],
  ['docs.html', 'docs', 'Documentation: quickstart, conventions, credits, plans, streams, errors'],
  ['console.html', 'console', 'Console: API keys, usage, bills, concepts lab, playground, stream lab'],
  ['researchphantom.html', 'researchphantom', 'ResearchPhantom Studio — Light edition'],
  ['data-motion.html', 'datamotion', 'ResearchPhantom Studio — Full edition'],
  ['character-story.html', 'characterstory', 'ResearchPhantom Studio — Extra edition'],
  ['cast-lab.html', 'castlab', 'ResearchPhantom Studio — CAST LAB'],
];

const exists = async (path) => access(path).then(() => true, () => false);

/* ---------------------------------------------------------------- content */

function parseDatasets(source) {
  const block = source.slice(source.indexOf('const MARKET_CONFIG = ['), source.indexOf('/** Candle intervals'));
  const rows = [];
  for (const match of block.matchAll(/^\s*\[(.+)\],$/gm)) {
    const parts = [...match[1].matchAll(/'([^']*)'|(-?[\d_.]+)/g)].map((item) => (item[1] !== undefined ? item[1] : Number(item[2].replace(/_/g, ''))));
    rows.push(parts);
  }
  const scopes = [...source.matchAll(/'([a-z]+:read)'/g)].map((m) => m[1]);
  const intervals = [...source.matchAll(/^\s*'([0-9]+[smhdwM]|1M)': ([\d_]+),$/gm)].map((m) => [m[1], Number(m[2].replace(/_/g, ''))]);
  return { rows, scopes: [...new Set(scopes)], intervals };
}

function parseEndpoints(source) {
  const endpoints = [];
  for (const match of source.matchAll(/endpoint\(\{\s*([\s\S]*?)\n {4}\}\),/g)) {
    const block = match[1];
    const read = (key) => new RegExp(`${key}: '([^']+)'`).exec(block)?.[1] ?? null;
    const numeric = (key) => {
      const found = new RegExp(`${key}: ([\\d_]+)`).exec(block);
      return found ? Number(found[1].replace(/_/g, '')) : null;
    };
    if (!read('path')) continue;
    endpoints.push({
      method: read('method') ?? 'GET',
      path: read('path'),
      group: read('group'),
      scope: /scope: null/.test(block) ? null : read('scope'),
      base: numeric('base'),
      perRow: numeric('perRow'),
      maxLimit: numeric('maxLimit'),
      feature: read('feature'),
      summary: read('summary'),
    });
  }
  const plans = [...source.matchAll(/(\w+): Object\.freeze\(\{\s*id: '(\w+)', name: '([^']+)', priceMonthly: ([\d_]+|null),/g)]
    .map((m) => ({ id: m[2], name: m[3] }));
  return { endpoints, plans };
}

/* ------------------------------------------------------------------ build */

const root = new URL('../', import.meta.url);
const engineSource = await readFile(new URL('src/hyperdash/market-engine.js', root), 'utf8');
const apiSource = await readFile(new URL('src/hyperdash/data-api.js', root), 'utf8');

const datasets = parseDatasets(engineSource);
const { endpoints, plans } = parseEndpoints(apiSource);

if (datasets.rows.length < 20) throw new Error('dataset extraction failed');
if (endpoints.length < 40) throw new Error(`endpoint extraction failed (${endpoints.length})`);
if (plans.length !== 4) throw new Error('plan extraction failed');

const payload = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  apiVersion: '2026-11-17',
  baseUrl: 'https://data.hyperdash.com',
  streamUrl: 'wss://data.hyperdash.com/v1/stream',
  markets: datasets.rows.length,
  intervals: datasets.intervals,
  scopes: datasets.scopes,
  plans,
  endpoints,
  files: {},
};

const script = `window.__HYPERDASH_BUILD__ = ${JSON.stringify({ ...payload, endpoints, markets: payload.markets })};\n`;

/* ------------------------------------------------------------- integrity */

async function collect(directory) {
  const out = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === 'build-manifest.json') continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) out.push(...await collect(path));
    else if (entry.isFile()) out.push(path);
  }
  return out;
}

const expected = ENTRIES.map(([name]) => name);
for (const name of expected) {
  if (!await exists(new URL(`../${name}`, import.meta.url))) throw new Error(`missing entrypoint: ${name}`);
}

await mkdir(dist, { recursive: true });
await writeFile(new URL('build-meta.js', dist), script, 'utf8');

const files = (await collect(dist.pathname)).filter((path) => !path.endsWith('build-meta.js') && !path.endsWith('.nojekyll'));
files.push(new URL('build-meta.js', dist).pathname);
files.sort();
const manifest = [];
for (const file of files) {
  const contents = await readFile(file);
  manifest.push({
    file: file.replace(dist.pathname, '').replace(/\\/g, '/'),
    bytes: contents.byteLength,
    sha256: createHash('sha256').update(contents).digest('hex'),
  });
}
await writeFile(new URL('build-manifest.json', dist), `${JSON.stringify({ schemaVersion: 1, apiVersion: payload.apiVersion, files: manifest }, null, 2)}\n`, 'utf8');

console.log(`Hyperdash build metadata: ${endpoints.length} endpoints, ${payload.markets} markets, ${manifest.length} files`);
