import { createHash } from 'node:crypto';
import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createApi, API_VERSION } from '../src/server/api.js';
import { silentLogger } from '../src/server/logger.js';

const dist = new URL('../dist/', import.meta.url);

/** Public entrypoints. The three data-API pages need the /v1 backend (Worker or tools/serve.mjs). */
const ENTRIES = [
  ['index.html', 'landing', 'Ticksmith — Hyperliquid data API landing page (dash + terminal skins)'],
  ['docs.html', 'docs', 'Documentation: quickstart, responses, errors, limits, endpoint reference'],
  ['console.html', 'console', 'Console: upstream status, market and wallet inspectors, request log, playground'],
  ['researchphantom.html', 'researchphantom', 'ResearchPhantom Studio — Light edition'],
  ['data-motion.html', 'datamotion', 'ResearchPhantom Studio — Full edition'],
  ['character-story.html', 'characterstory', 'ResearchPhantom Studio — Extra edition'],
  ['cast-lab.html', 'castlab', 'ResearchPhantom Studio — CAST LAB'],
];

const exists = async (path) => access(path).then(() => true, () => false);

/* ------------------------------------------------------------------ build */

// The catalogue is static route metadata; building it makes no network calls.
const api = createApi({ env: {}, fetchImpl: () => { throw new Error('build must not fetch'); }, logger: silentLogger });
const { endpoints, unavailable } = api.catalog;
if (endpoints.length < 10) throw new Error(`endpoint catalogue looks empty (${endpoints.length})`);

const payload = {
  schemaVersion: 2,
  generatedAt: new Date().toISOString(),
  apiVersion: API_VERSION,
  upstream: api.config.infoUrl,
  endpoints: endpoints.map(({ path, group, upstream }) => ({ method: 'GET', path, group, upstream })),
  unavailable: unavailable.map(({ topic }) => topic),
};

const script = `window.__SITE_BUILD__ = ${JSON.stringify(payload)};\n`;

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

console.log(`Build metadata: ${endpoints.length} API endpoints, ${manifest.length} files`);
