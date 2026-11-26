// Unit tests for the /v1 backend. The upstream `fetch` is replaced with a stub
// here (and only here) so retry, cache, budget and error paths can be exercised
// deterministically. Live behaviour is checked by tools/verify-live.mjs.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createApi } from '../src/server/api.js';
import { loadConfig } from '../src/server/config.js';
import { baseWeight, createHyperliquidClient, expectedWeight, extraWeight } from '../src/server/hyperliquid.js';
import { silentLogger } from '../src/server/logger.js';
import worker from '../src/worker/index.js';

const META = { universe: [{ name: 'BTC', szDecimals: 5, maxLeverage: 40 }, { name: 'kPEPE', szDecimals: 0, maxLeverage: 10 }, { name: 'OLD', szDecimals: 0, maxLeverage: 3, isDelisted: true }] };
const CTXS = [
  { funding: '0.0000125', openInterest: '100.5', prevDayPx: '60000.0', dayNtlVlm: '1000000.0', premium: '-0.0001', oraclePx: '61010.0', markPx: '61000.0', midPx: '61000.5', impactPxs: ['60999.0', '61001.0'], dayBaseVlm: '16.4' },
  { funding: '-0.00002', openInterest: '5000000', prevDayPx: '0.004', dayNtlVlm: '50000.0', premium: '0.0', oraclePx: '0.0041', markPx: '0.0041', midPx: '0.0041', impactPxs: null, dayBaseVlm: '1' },
  { funding: '0', openInterest: '0', prevDayPx: '1', dayNtlVlm: '0', premium: null, oraclePx: '1', markPx: '1', midPx: null, impactPxs: null, dayBaseVlm: '0' },
];
const SPOT_META = {
  tokens: [{ name: 'USDC', index: 0 }, { name: 'PURR', index: 1 }, { name: 'HYPE', index: 150 }],
  universe: [{ tokens: [1, 0], name: 'PURR/USDC', index: 0, isCanonical: true }, { tokens: [150, 0], name: '@107', index: 107, isCanonical: false }],
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** Upstream stub: `routes[type]` returns a body, a Response, or throws. Records every call. */
function stubUpstream(routes) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    const route = routes[body.type];
    if (!route) return json(null, 500);
    const result = await route(body, calls.filter((c) => c.type === body.type).length);
    return result instanceof Response ? result : json(result);
  };
  return { fetchImpl, calls };
}

function makeApi(routes, env = {}, clock = { t: 1_800_000_000_000 }) {
  const upstream = stubUpstream(routes);
  const api = createApi({
    env: { HL_RETRY_BASE_MS: '10', ...env },
    fetchImpl: upstream.fetchImpl,
    now: () => clock.t,
    sleep: async (ms) => { clock.t += ms; },
    logger: silentLogger,
  });
  const get = async (path, headers = {}) => {
    const response = await api.handle(new Request(`http://local${path}`, { headers }));
    return { response, status: response.status, body: response.status === 204 ? null : await response.json() };
  };
  return { api, get, calls: upstream.calls, clock };
}

const marketRoutes = {
  perpDexs: () => [null, { name: 'xyz', fullName: 'XYZ' }],
  meta: () => META,
  spotMeta: () => SPOT_META,
  metaAndAssetCtxs: () => [META, CTXS],
};

test('config rejects invalid values instead of silently defaulting', () => {
  assert.throws(() => loadConfig({ HL_TIMEOUT_MS: 'abc' }), /HL_TIMEOUT_MS/);
  assert.throws(() => loadConfig({ HL_INFO_URL: 'http://api.hyperliquid.xyz/info' }), /https/);
  assert.throws(() => loadConfig({ HL_WEIGHT_BUDGET_PER_MIN: '5000' }), /HL_WEIGHT_BUDGET_PER_MIN/);
  assert.equal(loadConfig({}).infoUrl, 'https://api.hyperliquid.xyz/info');
});

test('an invalid deployment config answers 500 config_error naming the variable', async () => {
  const { get, calls } = makeApi(marketRoutes, { HL_MAX_RETRIES: '99' });
  const { status, body } = await get('/v1/markets');
  assert.equal(status, 500);
  assert.equal(body.code, 'config_error');
  assert.match(body.detail, /HL_MAX_RETRIES/);
  assert.equal(calls.length, 0);
});

test('weights follow the documented Hyperliquid limits', () => {
  assert.equal(baseWeight('l2Book'), 2);
  assert.equal(baseWeight('clearinghouseState'), 2);
  assert.equal(baseWeight('metaAndAssetCtxs'), 20);
  assert.equal(baseWeight('userRole'), 60);
  assert.equal(extraWeight('recentTrades', new Array(45)), 2);
  assert.equal(extraWeight('candleSnapshot', new Array(200)), 3);
  assert.equal(extraWeight('l2Book', new Array(200)), 0);
});

test('markets are normalised to numbers, sorted, and carry provenance', async () => {
  const { get } = makeApi(marketRoutes);
  const { status, body, response } = await get('/v1/markets');
  assert.equal(status, 200);
  assert.deepEqual(body.data.map((m) => m.coin), ['BTC', 'kPEPE']);
  const btc = body.data[0];
  assert.equal(btc.mark_px, 61000);
  assert.equal(btc.funding_rate_1h, 0.0000125);
  assert.equal(btc.open_interest_usd, 100.5 * 61000);
  assert.ok(Math.abs(btc.change_24h_pct - (1000 / 60000) * 100) < 1e-9);
  assert.equal(body.meta.source, 'https://api.hyperliquid.xyz/info');
  assert.deepEqual(body.meta.upstream_types, ['metaAndAssetCtxs']);
  assert.equal(body.meta.cached, false);
  assert.match(body.meta.fetched_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(response.headers.get('x-cache'), 'MISS');
  const withDelisted = await get('/v1/markets?include_delisted=true&sort=coin');
  assert.equal(withDelisted.body.data.length, 3);
});

test('identical requests within the TTL are served from cache', async () => {
  const { get, calls } = makeApi(marketRoutes);
  await get('/v1/markets');
  const second = await get('/v1/markets');
  assert.equal(calls.filter((c) => c.type === 'metaAndAssetCtxs').length, 1);
  assert.equal(second.body.meta.cached, true);
  assert.equal(second.response.headers.get('x-cache'), 'HIT');
});

test('coin names resolve against upstream metadata; unknown coins are 404 without calling the data endpoint', async () => {
  const { get, calls } = makeApi({ ...marketRoutes, l2Book: (body) => ({ coin: body.coin, time: 1, levels: [[{ px: '1', sz: '2', n: 1 }], [{ px: '1.1', sz: '3', n: 2 }]] }) });
  const missing = await get('/v1/markets/NOPE/book');
  assert.equal(missing.status, 404);
  assert.equal(missing.body.code, 'not_found');
  assert.equal(calls.filter((c) => c.type === 'l2Book').length, 0);

  const lower = await get('/v1/markets/kpepe/book');
  assert.equal(lower.status, 200);
  assert.equal(lower.body.data.coin, 'kPEPE');
  assert.equal(lower.body.data.best_ask, 1.1);
  assert.ok(Math.abs(lower.body.data.spread - 0.1) < 1e-9);

  const spot = await get(`/v1/markets/${encodeURIComponent('HYPE/USDC')}/book`);
  assert.equal(spot.body.data.coin, '@107');
  assert.equal(spot.body.data.kind, 'spot');
});

test('parameters are validated before any upstream call', async () => {
  const { get, calls } = makeApi(marketRoutes);
  const cases = [
    '/v1/markets/BTC/candles?interval=7m',
    '/v1/markets/BTC/candles?limit=0',
    '/v1/markets/BTC/candles?start_time=10&end_time=5',
    '/v1/markets/BTC/book?n_sig_figs=9',
    '/v1/accounts/0x123',
    '/v1/accounts/0x0000000000000000000000000000000000000001/portfolio?window=decade',
    '/v1/markets?sort=random',
  ];
  for (const path of cases) {
    const { status, body } = await get(path);
    assert.equal(status, 400, path);
    assert.equal(body.code, 'invalid_parameter', path);
    assert.equal(body.type, '/docs.html#error-invalid_parameter');
  }
  assert.ok(calls.every((c) => c.type === 'meta'), 'only coin metadata may be fetched while validating');
});

test('5xx upstream responses are retried, then succeed', async () => {
  const { get, calls, api } = makeApi({ exchangeStatus: (_, n) => (n < 3 ? json(null, 502) : { time: 123, specialStatuses: null }) });
  const { status, body } = await get('/v1/status');
  assert.equal(status, 200);
  assert.equal(body.data.upstream_time, 123);
  assert.equal(calls.length, 3);
  assert.equal(api.client.snapshot().retries, 2);
});

test('persistent upstream failure becomes a 502 problem, never data', async () => {
  const { get, calls } = makeApi({ exchangeStatus: () => json(null, 500) }, { HL_MAX_RETRIES: '2' });
  const { status, body, response } = await get('/v1/status');
  assert.equal(status, 502);
  assert.equal(response.headers.get('content-type'), 'application/problem+json; charset=utf-8');
  assert.equal(body.code, 'upstream_error');
  assert.equal(body.upstream_status, 500);
  assert.equal(body.attempts, 3);
  assert.equal(body.data, undefined);
  assert.equal(calls.length, 3);
});

test('4xx upstream responses are not retried', async () => {
  const { get, calls } = makeApi({ clearinghouseState: () => new Response('Failed to deserialize', { status: 422 }), spotClearinghouseState: () => ({ balances: [] }) });
  const { status, body } = await get('/v1/accounts/0x0000000000000000000000000000000000000001');
  assert.equal(status, 502);
  assert.equal(body.upstream_status, 422);
  assert.equal(calls.filter((c) => c.type === 'clearinghouseState').length, 1);
});

test('network failures and timeouts map to 502 / 504', async () => {
  const unreachable = makeApi({ exchangeStatus: () => { throw new TypeError('fetch failed'); } }, { HL_MAX_RETRIES: '1' });
  const a = await unreachable.get('/v1/status');
  assert.equal(a.status, 502);
  assert.equal(a.body.code, 'upstream_unreachable');

  const slow = createApi({
    env: { HL_TIMEOUT_MS: '500', HL_MAX_RETRIES: '0' },
    logger: silentLogger,
    fetchImpl: (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))),
  });
  const response = await slow.handle(new Request('http://local/v1/status'));
  assert.equal(response.status, 504);
  assert.equal((await response.json()).code, 'upstream_timeout');
});

test('non-JSON upstream bodies are rejected', async () => {
  const { get } = makeApi({ exchangeStatus: () => new Response('<html>maintenance</html>', { status: 200 }) });
  const { status, body } = await get('/v1/status');
  assert.equal(status, 502);
  assert.equal(body.code, 'upstream_invalid');
});

test('the upstream weight budget refuses work instead of exceeding Hyperliquid limits', async () => {
  const { get } = makeApi({ exchangeStatus: () => ({ time: 1 }) }, { HL_WEIGHT_BUDGET_PER_MIN: '20', HL_WEIGHT_MAX_WAIT_MS: '0', CLIENT_BURST: '100' });
  for (let i = 0; i < 10; i += 1) assert.equal((await get('/v1/status')).status, 200);
  const refused = await get('/v1/status');
  assert.equal(refused.status, 503);
  assert.equal(refused.body.code, 'upstream_budget');
  assert.ok(Number(refused.response.headers.get('retry-after')) > 0);
});

test('clients over their token bucket get 429 with retry-after', async () => {
  const { get } = makeApi(marketRoutes, { CLIENT_BURST: '2', CLIENT_RATE_PER_SEC: '1' });
  const headers = { 'cf-connecting-ip': '203.0.113.9' };
  assert.equal((await get('/v1/endpoints', headers)).status, 200);
  assert.equal((await get('/v1/endpoints', headers)).status, 200);
  const limited = await get('/v1/endpoints', headers);
  assert.equal(limited.status, 429);
  assert.equal(limited.body.code, 'rate_limited');
  assert.equal(limited.response.headers.get('retry-after'), '1');
  assert.equal((await get('/v1/endpoints', { 'cf-connecting-ip': '203.0.113.10' })).status, 200);
});

test('account endpoints normalise positions and fills', async () => {
  const user = '0xABCDEF0000000000000000000000000000000001';
  const { get, calls } = makeApi({
    clearinghouseState: () => ({
      marginSummary: { accountValue: '1000', totalNtlPos: '500', totalRawUsd: '1500', totalMarginUsed: '100' },
      crossMaintenanceMarginUsed: '10', withdrawable: '900', time: 5,
      assetPositions: [{ type: 'oneWay', position: { coin: 'BTC', szi: '-0.5', entryPx: '60000', positionValue: '30500', unrealizedPnl: '-500', returnOnEquity: '-0.1', liquidationPx: null, marginUsed: '100', leverage: { type: 'cross', value: 5 }, maxLeverage: 40, cumFunding: { allTime: '1', sinceOpen: '0.5' } } }],
    }),
    spotClearinghouseState: () => ({ balances: [{ coin: 'USDC', token: 0, total: '12.5', hold: '0', entryNtl: '0' }] }),
    userFills: () => [
      { coin: 'BTC', px: '61000', sz: '0.1', side: 'A', time: 2, dir: 'Open Short', closedPnl: '0', fee: '1.2', feeToken: 'USDC', crossed: true, hash: '0x1', oid: 1, tid: 1, startPosition: '0' },
      { coin: 'ETH', px: '1700', sz: '1', side: 'B', time: 3, dir: 'Close Short', closedPnl: '5', fee: '0.5', feeToken: 'USDC', crossed: false, hash: '0x2', oid: 2, tid: 2, startPosition: '-1', liquidation: { method: 'market' } },
    ],
  });
  const summary = await get(`/v1/accounts/${user}`);
  assert.equal(summary.body.data.address, user.toLowerCase());
  assert.equal(summary.body.data.account_value, 1000);
  assert.equal(summary.body.data.spot_balances[0].total, 12.5);
  assert.equal(calls[0].user, user.toLowerCase());

  const positions = await get(`/v1/accounts/${user}/positions`);
  const p = positions.body.data[0];
  assert.equal(p.side, 'short');
  assert.equal(p.size, 0.5);
  assert.equal(p.mark_px, 61000);
  assert.equal(p.liquidation_px, null);

  const fills = await get(`/v1/accounts/${user}/fills?limit=1`);
  assert.equal(fills.body.data.length, 1);
  assert.equal(fills.body.data[0].coin, 'ETH');
  assert.deepEqual(fills.body.data[0].liquidation, { method: 'market' });
  assert.equal(fills.body.meta.upstream_rows, 2);
});

test('unknown routes 404, non-GET 405, and non-/v1 paths fall through to assets', async () => {
  const { api, get } = makeApi(marketRoutes);
  assert.equal((await get('/v1/nope')).status, 404);
  const post = await api.handle(new Request('http://local/v1/markets', { method: 'POST' }));
  assert.equal(post.status, 405);
  assert.equal(await api.handle(new Request('http://local/index.html')), null);
  const catalog = await get('/v1/endpoints');
  assert.ok(catalog.body.data.unavailable.length >= 5);
  assert.ok(catalog.body.data.endpoints.every((e) => e.upstream.length > 0));
});

test('the Worker serves /v1 itself and delegates everything else to static assets', async () => {
  const seen = [];
  const env = { ASSETS: { fetch: async (request) => { seen.push(new URL(request.url).pathname); return new Response('asset'); } } };
  const asset = await worker.fetch(new Request('https://example.workers.dev/docs.html'), env);
  assert.equal(await asset.text(), 'asset');
  const catalog = await worker.fetch(new Request('https://example.workers.dev/v1/endpoints'), env);
  assert.equal(catalog.status, 200);
  assert.deepEqual(seen, ['/docs.html']);
});

test('front-end pages contain no simulation, replica or third-party brand copy', async () => {
  for (const file of ['index.html', 'docs.html', 'console.html', 'src/hyperdash/landing.js', 'src/hyperdash/docs.js', 'src/hyperdash/console.js', 'src/hyperdash/playground.js']) {
    const text = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(text, /local replica|local simulation|in-browser implementation|demo key|createMarketEngine|data\.hyperdash\.com|market-engine|data-api\.js/i, file);
  }
});

/* ------------------------------------------------------------------ fixes after review */

function bareClient(env, { sleep, clock }) {
  const config = { ...loadConfig({ HL_RETRY_BASE_MS: '10', ...env }) };
  const calls = [];
  const client = createHyperliquidClient({
    config, logger: silentLogger, now: () => clock.t, sleep,
    fetchImpl: async (url, init) => { const body = JSON.parse(init.body); calls.push(body); return json(body.type === 'candleSnapshot' ? [] : { ok: true }); },
  });
  return { client, calls };
}

test('budget waiters re-check capacity after waking instead of spending the same headroom twice', async () => {
  const clock = { t: 1_000_000 };
  const sleepers = [];
  const sleep = (ms) => new Promise((resolve) => sleepers.push({ ms, resolve }));
  const { client, calls } = bareClient({ HL_WEIGHT_BUDGET_PER_MIN: '20', HL_WEIGHT_MAX_WAIT_MS: '30000' }, { sleep, clock });
  await client.info({ type: 'meta', dex: 'a' });                    // spends the whole 20
  clock.t += 40_000;                                                  // it frees up in 20 s
  const c = client.info({ type: 'meta', dex: 'c' }).then(() => 'ok', (e) => e.code);
  const d = client.info({ type: 'meta', dex: 'd' }).then(() => 'ok', (e) => e.code);
  await new Promise((r) => setImmediate(r));
  assert.equal(sleepers.length, 2, 'both requests wait for the same expiring weight');
  clock.t += 20_001;                                                  // the first 20 expires
  for (const s of sleepers.splice(0)) s.resolve();
  const results = await Promise.all([c, d]);
  assert.deepEqual(results.sort(), ['ok', 'upstream_budget']);
  assert.ok(client.snapshot().weightUsedLastMinute <= 20, 'budget never exceeded');
  assert.equal(calls.length, 2);
});

test('a large response reserves its row surcharge before the request is sent', async () => {
  const clock = { t: 1_000_000 };
  const { client, calls } = bareClient({ HL_WEIGHT_BUDGET_PER_MIN: '120', HL_WEIGHT_MAX_WAIT_MS: '0' }, { sleep: async () => {}, clock });
  assert.equal(expectedWeight('candleSnapshot', 5000), 103);
  assert.equal(expectedWeight('userFills'), 120);
  await client.info({ type: 'meta', dex: 'a' });                     // 20 used, 100 left
  await assert.rejects(client.info({ type: 'candleSnapshot', req: { coin: 'BTC' } }, { expectedItems: 5000 }), (e) => e.code === 'upstream_budget');
  assert.equal(calls.length, 1, 'the oversized request was never sent');
  await client.info({ type: 'candleSnapshot', req: { coin: 'ETH' } }, { expectedItems: 100 });
  assert.equal(client.snapshot().weightUsedLastMinute, 40, 'reservation settled to the real cost of an empty response');
});

test('default time windows are aligned so repeated "latest" requests share one upstream call', async () => {
  const clock = { t: 1_800_000_123_456 };
  const { get, calls } = makeApi({ ...marketRoutes, candleSnapshot: () => [], fundingHistory: () => [] }, {}, clock);
  await get('/v1/markets/BTC/candles?interval=1h&limit=24');
  clock.t += 4_000;
  const second = await get('/v1/markets/BTC/candles?interval=1h&limit=24');
  assert.equal(calls.filter((c) => c.type === 'candleSnapshot').length, 1);
  assert.equal(second.body.meta.cached, true);
  assert.equal(second.body.meta.end_time % 3_600_000, 0);
  await get('/v1/markets/BTC/funding');
  clock.t += 20_000;
  await get('/v1/markets/BTC/funding');
  const funding = calls.filter((c) => c.type === 'fundingHistory');
  assert.equal(funding.length, 1);
  assert.equal(funding[0].endTime, undefined, 'open-ended window asks for everything up to now');
  assert.equal(funding[0].startTime % 3_600_000, 0);
});

test('unknown dexs are 404 and never sent upstream; malformed coin encoding is 400', async () => {
  const { get, calls } = makeApi(marketRoutes);
  const unknown = await get('/v1/markets?dex=nosuchdex');
  assert.equal(unknown.status, 404);
  assert.equal(unknown.body.code, 'not_found');
  const unknownCoin = await get('/v1/markets/nosuchdex:FOO/book');
  assert.equal(unknownCoin.status, 404);
  assert.ok(!calls.some((c) => c.dex === 'nosuchdex'));
  const ok = await get('/v1/markets?dex=xyz');
  assert.equal(ok.status, 200);
  const bad = await get('/v1/markets/%E0%A4%A/book');
  assert.equal(bad.status, 400);
  assert.equal(bad.body.code, 'invalid_parameter');
  assert.equal(bad.response.headers.get('x-content-type-options'), 'nosniff');
});
