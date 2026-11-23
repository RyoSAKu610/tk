#!/usr/bin/env node
/**
 * End-to-end check against a running deployment (local `npm run dev` or the
 * Cloudflare Worker). Every endpoint is called for real, freshness is checked
 * via meta.fetched_at, BTC's mark price is cross-checked against a direct call
 * to the official Hyperliquid API, and the error paths are exercised.
 *
 *   npm run verify:live                               # http://127.0.0.1:4173
 *   npm run verify:live -- https://tk.example.workers.dev
 *   npm run verify:live -- <url> --no-direct          # skip the direct cross-check
 *
 * Exits non-zero if any check fails.
 */

const args = process.argv.slice(2);
const base = (args.find((a) => !a.startsWith('--')) ?? 'http://127.0.0.1:4173').replace(/\/$/, '');
const direct = !args.includes('--no-direct');
const HL = 'https://api.hyperliquid.xyz/info';
const MAX_AGE_MS = 60_000;

const results = [];
const samples = [];

async function get(path) {
  const started = performance.now();
  const response = await fetch(`${base}${path}`, { headers: { accept: 'application/json' } });
  const body = await response.json().catch(() => null);
  return { status: response.status, body, ms: Math.round(performance.now() - started), headers: response.headers };
}

function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(46)} ${detail}`);
}

async function check(name, path, validate, { sample = false } = {}) {
  try {
    const r = await get(path);
    if (r.status !== 200) {
      record(name, false, `HTTP ${r.status} ${r.body?.code ?? ''} ${r.body?.detail ?? ''}`);
      return null;
    }
    const fetched = Date.parse(r.body.meta?.fetched_at ?? '');
    const age = Date.now() - fetched;
    const problems = [];
    if (!Number.isFinite(fetched)) problems.push('meta.fetched_at missing');
    else if (age > MAX_AGE_MS) problems.push(`stale: fetched ${Math.round(age / 1000)} s ago`);
    if (r.body.meta?.source !== HL) problems.push(`unexpected source ${r.body.meta?.source}`);
    const message = validate(r.body.data, r.body.meta);
    if (message) problems.push(message);
    record(name, problems.length === 0, problems.join('; ') || `${r.ms} ms · ${r.body.meta.cached ? 'cache' : 'fresh'} · fetched ${r.body.meta.fetched_at}`);
    if (sample) samples.push({ path, fetched_at: r.body.meta.fetched_at, upstream_types: r.body.meta.upstream_types, data: Array.isArray(r.body.data) ? r.body.data.slice(0, 2) : r.body.data });
    return r.body;
  } catch (error) {
    record(name, false, `request failed: ${error.cause?.message ?? error.message}`);
    return null;
  }
}

async function expectProblem(name, path, status, code) {
  try {
    const r = await get(path);
    const ok = r.status === status && r.body?.code === code && r.headers.get('content-type')?.startsWith('application/problem+json');
    record(name, ok, `HTTP ${r.status} ${r.body?.code}: ${r.body?.detail}`);
  } catch (error) {
    record(name, false, `request failed: ${error.message}`);
  }
}

const positive = (n) => typeof n === 'number' && Number.isFinite(n) && n > 0;

console.log(`Verifying ${base} at ${new Date().toISOString()}\n`);

await check('status: Hyperliquid reachable', '/v1/status', (d) => (d.status === 'ok' && positive(d.upstream_time) ? null : 'status not ok'), { sample: true });
await check('markets: perp list', '/v1/markets?limit=5', (d) => (d.length === 5 && d.every((m) => positive(m.mark_px) && positive(m.volume_24h_usd)) ? null : 'bad rows'), { sample: true });
const btc = await check('markets/BTC: context', '/v1/markets/BTC', (d) => (d.coin === 'BTC' && positive(d.mark_px) && positive(d.open_interest) ? null : 'bad BTC row'), { sample: true });
await check('markets/mids', '/v1/markets/mids', (d) => (positive(d.BTC) ? null : 'no BTC mid'));
await check('candles: BTC 1h x24', '/v1/markets/BTC/candles?interval=1h&limit=24', (d) => {
  if (d.length < 20) return `only ${d.length} candles`;
  const last = d.at(-1);
  if (!(last.high >= last.low && positive(last.close))) return 'bad OHLC';
  return Date.now() - last.time_open > 2 * 3_600_000 ? 'latest candle older than 2 h' : null;
}, { sample: true });
await check('book: ETH', '/v1/markets/ETH/book', (d) => (d.bids.length && d.asks.length && d.best_bid < d.best_ask ? null : 'crossed or empty book'));
const trades = await check('trades: BTC', '/v1/markets/BTC/trades', (d) => (d.length && d.every((t) => positive(t.price) && /^0x[0-9a-f]{40}$/.test(t.buyer)) ? null : 'bad trades'), { sample: true });
await check('funding: BTC 24h', '/v1/markets/BTC/funding', (d) => (d.length >= 20 ? null : `only ${d.length} prints`));
await check('spot: markets', '/v1/spot/markets?limit=5', (d) => (d.length === 5 ? null : 'bad spot rows'));
await check('spot: HYPE/USDC book', `/v1/markets/${encodeURIComponent('HYPE/USDC')}/book`, (d) => (d.kind === 'spot' && d.bids.length ? null : 'not a spot book'));
await check('dexs', '/v1/dexs', (d) => (d[0]?.full_name === 'Hyperliquid' ? null : 'main dex missing'));

const address = trades?.data?.find((t) => t.buyer)?.buyer;
if (address) {
  console.log(`\nWallet under test (buyer of the latest BTC trade): ${address}`);
  await check('account: summary', `/v1/accounts/${address}`, (d) => (typeof d.account_value === 'number' ? null : 'no account value'), { sample: true });
  await check('account: positions', `/v1/accounts/${address}/positions`, (d) => (Array.isArray(d) ? null : 'not a list'));
  await check('account: open orders', `/v1/accounts/${address}/open-orders`, (d) => (Array.isArray(d) ? null : 'not a list'));
  await check('account: fills', `/v1/accounts/${address}/fills?limit=5`, (d) => (d.length >= 1 ? null : 'a wallet that just traded must have fills'), { sample: true });
  await check('account: funding', `/v1/accounts/${address}/funding`, (d) => (Array.isArray(d) ? null : 'not a list'));
  await check('account: ledger', `/v1/accounts/${address}/ledger`, (d) => (Array.isArray(d) ? null : 'not a list'));
  await check('account: portfolio', `/v1/accounts/${address}/portfolio?window=day`, (d) => (Array.isArray(d.history) ? null : 'no history'));
} else {
  record('account endpoints', false, 'no wallet address available from the trade tape');
}

console.log('');
await expectProblem('error: unknown market → 404', '/v1/markets/NOTACOIN/book', 404, 'not_found');
await expectProblem('error: bad address → 400', '/v1/accounts/0x123', 400, 'invalid_parameter');
await expectProblem('error: bad interval → 400', '/v1/markets/BTC/candles?interval=7m', 400, 'invalid_parameter');

if (direct && btc) {
  try {
    const response = await fetch(HL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'allMids' }) });
    const mids = await response.json();
    const directMid = Number(mids.BTC);
    const diff = Math.abs(directMid - btc.data.mark_px) / directMid;
    record('cross-check: BTC vs direct Hyperliquid allMids', diff < 0.005, `site mark ${btc.data.mark_px} vs direct mid ${directMid} (${(diff * 100).toFixed(3)} %)`);
  } catch (error) {
    record('cross-check: BTC vs direct Hyperliquid allMids', false, `direct call failed: ${error.cause?.message ?? error.message}`);
  }
}

console.log('\nSample responses (truncated):');
for (const s of samples) console.log(JSON.stringify(s));

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
