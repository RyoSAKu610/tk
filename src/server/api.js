/**
 * Public REST surface (`/v1/*`) backed exclusively by the official Hyperliquid
 * info endpoint. Each route documents which upstream request types it uses.
 * Data that the official API cannot provide is listed in UNAVAILABLE and is
 * never approximated.
 */

import { createHyperliquidClient, UpstreamError } from './hyperliquid.js';
import { createLogger } from './logger.js';
import { loadConfig } from './config.js';

export const API_VERSION = '2026-11-23';

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const DAY = 86_400_000;

export const CANDLE_INTERVALS = Object.freeze({
  '1m': 60_000, '3m': 180_000, '5m': 300_000, '15m': 900_000, '30m': 1_800_000,
  '1h': 3_600_000, '2h': 7_200_000, '4h': 14_400_000, '8h': 28_800_000, '12h': 43_200_000,
  '1d': DAY, '3d': 3 * DAY, '1w': 7 * DAY, '1M': 30 * DAY,
});

const PORTFOLIO_WINDOWS = ['day', 'week', 'month', 'allTime', 'perpDay', 'perpWeek', 'perpMonth', 'perpAllTime'];

/* ----------------------------------------------------------------------------
   Errors
   ---------------------------------------------------------------------------- */

const PROBLEMS = {
  invalid_parameter: [400, 'Invalid parameter'],
  not_found: [404, 'Not found'],
  method_not_allowed: [405, 'Method not allowed'],
  rate_limited: [429, 'Too many requests'],
  upstream_error: [502, 'Upstream error'],
  upstream_unreachable: [502, 'Upstream unreachable'],
  upstream_invalid: [502, 'Upstream returned invalid data'],
  upstream_timeout: [504, 'Upstream timeout'],
  upstream_rate_limited: [503, 'Upstream rate limited'],
  upstream_budget: [503, 'Upstream budget exhausted'],
  unavailable: [501, 'Not available from the official API'],
  config_error: [500, 'Server misconfigured'],
  internal_error: [500, 'Internal error'],
};

export class ApiProblem extends Error {
  constructor(code, detail, extra = {}) {
    super(detail);
    this.code = code;
    this.status = PROBLEMS[code]?.[0] ?? 400;
    this.title = PROBLEMS[code]?.[1] ?? 'Error';
    this.extra = extra;
  }
}

const invalid = (detail) => new ApiProblem('invalid_parameter', detail);

/* ----------------------------------------------------------------------------
   Parameter parsing
   ---------------------------------------------------------------------------- */

function num(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseTime(query, name) {
  const raw = query.get(name);
  if (raw === null || raw === '') return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) throw invalid(`${name} must be Unix time in milliseconds`);
  return value;
}

function parseLimit(query, fallback, maximum) {
  const raw = query.get('limit');
  if (raw === null || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > maximum) throw invalid(`limit must be an integer from 1 to ${maximum}`);
  return value;
}

function parseAddress(raw) {
  if (!ADDRESS_RE.test(raw)) throw invalid('address must be a 0x-prefixed 40-hex-character wallet address');
  return raw.toLowerCase();
}

function parseDex(query) {
  const raw = query.get('dex');
  if (raw === null || raw === '') return '';
  if (!/^[a-z0-9]{1,16}$/i.test(raw)) throw invalid('dex must be a perp dex name from /v1/dexs');
  return raw;
}

function timeRange(query, { defaultSpan, maxSpan = null, now }) {
  const end = parseTime(query, 'end_time') ?? now;
  const start = parseTime(query, 'start_time') ?? Math.max(0, end - defaultSpan);
  if (start > end) throw invalid('start_time must be before end_time');
  if (maxSpan && end - start > maxSpan) throw invalid(`range must be at most ${Math.round(maxSpan / DAY)} d`);
  return { start, end };
}

/* ----------------------------------------------------------------------------
   Normalisers — map upstream strings to numbers and stable snake_case fields
   ---------------------------------------------------------------------------- */

function perpRow(asset, ctx, dex) {
  const mark = num(ctx?.markPx);
  const prev = num(ctx?.prevDayPx);
  const oi = num(ctx?.openInterest);
  return {
    coin: asset.name,
    dex,
    mark_px: mark,
    oracle_px: num(ctx?.oraclePx),
    mid_px: num(ctx?.midPx),
    prev_day_px: prev,
    change_24h_pct: mark !== null && prev ? ((mark - prev) / prev) * 100 : null,
    funding_rate_1h: num(ctx?.funding),
    premium: num(ctx?.premium),
    open_interest: oi,
    open_interest_usd: oi !== null && mark !== null ? oi * mark : null,
    volume_24h_usd: num(ctx?.dayNtlVlm),
    volume_24h_base: num(ctx?.dayBaseVlm),
    impact_bid_px: num(ctx?.impactPxs?.[0]),
    impact_ask_px: num(ctx?.impactPxs?.[1]),
    max_leverage: asset.maxLeverage ?? null,
    sz_decimals: asset.szDecimals ?? null,
    only_isolated: Boolean(asset.onlyIsolated),
    delisted: Boolean(asset.isDelisted),
  };
}

function spotPairs(spotMeta) {
  const tokens = new Map(spotMeta.tokens.map((token) => [token.index, token]));
  return spotMeta.universe.map((pair) => {
    const base = tokens.get(pair.tokens[0]);
    const quote = tokens.get(pair.tokens[1]);
    return { coin: pair.name, pair: `${base?.name ?? '?'}/${quote?.name ?? '?'}`, base: base?.name ?? null, quote: quote?.name ?? null, index: pair.index, canonical: Boolean(pair.isCanonical) };
  });
}

function candleRow(c) {
  return {
    time_open: c.t, time_close: c.T,
    open: num(c.o), high: num(c.h), low: num(c.l), close: num(c.c),
    volume_base: num(c.v), trades: c.n ?? null,
  };
}

function tradeRow(t) {
  const px = num(t.px);
  const sz = num(t.sz);
  return {
    time: t.time, coin: t.coin, side: t.side === 'B' ? 'buy' : 'sell',
    price: px, size: sz, notional_usd: px !== null && sz !== null ? px * sz : null,
    buyer: t.users?.[0] ?? null, seller: t.users?.[1] ?? null, hash: t.hash, tid: t.tid,
  };
}

function fillRow(f) {
  const px = num(f.px);
  const sz = num(f.sz);
  return {
    time: f.time, coin: f.coin, side: f.side === 'B' ? 'buy' : 'sell', direction: f.dir,
    price: px, size: sz, notional_usd: px !== null && sz !== null ? px * sz : null,
    start_position: num(f.startPosition), closed_pnl: num(f.closedPnl),
    fee: num(f.fee), fee_token: f.feeToken ?? null, crossed: Boolean(f.crossed),
    liquidation: f.liquidation ?? null, hash: f.hash, oid: f.oid, tid: f.tid, twap_id: f.twapId ?? null,
  };
}

function positionRow(entry) {
  const p = entry.position;
  const szi = num(p.szi);
  const value = num(p.positionValue);
  return {
    coin: p.coin,
    side: szi > 0 ? 'long' : 'short',
    size: szi === null ? null : Math.abs(szi),
    szi,
    entry_px: num(p.entryPx),
    mark_px: szi ? Math.abs(value / szi) : null,
    position_value_usd: value,
    unrealized_pnl: num(p.unrealizedPnl),
    return_on_equity: num(p.returnOnEquity),
    liquidation_px: num(p.liquidationPx),
    margin_used: num(p.marginUsed),
    leverage_type: p.leverage?.type ?? null,
    leverage: p.leverage?.value ?? null,
    max_leverage: p.maxLeverage ?? null,
    funding_all_time: num(p.cumFunding?.allTime),
    funding_since_open: num(p.cumFunding?.sinceOpen),
    position_type: entry.type,
  };
}

function orderRow(o) {
  return {
    time: o.timestamp, coin: o.coin, side: o.side === 'B' ? 'buy' : 'sell',
    limit_px: num(o.limitPx), size: num(o.sz), original_size: num(o.origSz),
    order_type: o.orderType, tif: o.tif ?? null, reduce_only: Boolean(o.reduceOnly),
    is_trigger: Boolean(o.isTrigger), trigger_px: num(o.triggerPx), trigger_condition: o.triggerCondition,
    is_position_tpsl: Boolean(o.isPositionTpsl), oid: o.oid, cloid: o.cloid ?? null,
  };
}

/* ----------------------------------------------------------------------------
   Catalogue
   ---------------------------------------------------------------------------- */

export const UNAVAILABLE = Object.freeze([
  { topic: 'Exchange-wide liquidation feed and liquidation history', reason: 'The info endpoint exposes liquidations only inside one wallet’s own fills (`liquidation` field on /v1/accounts/{address}/fills). There is no market-wide liquidation query.' },
  { topic: 'Liquidation levels, liquidation heatmaps, stop-order ladders', reason: 'Requires every open position and trigger order on the exchange. The public API only answers per wallet.' },
  { topic: 'Positions by market, largest positions, near-liquidation lists', reason: 'No endpoint enumerates wallets. Building this needs an indexer over every address, which this service does not run.' },
  { topic: 'PnL leaderboards, cohorts, trader screener, wallet stats', reason: 'Not provided by the official info API. Any figures would have to be invented or scraped from third parties.' },
  { topic: 'Full trade history beyond the latest trades', reason: '`recentTrades` returns only the most recent trades of a market. Older tape lives in Hyperliquid’s S3 archive, which is not wired up here.' },
  { topic: 'Open-interest history, CVD, volatility series', reason: 'The API returns only current open interest; history would have to be recorded continuously by a collector that does not exist yet.' },
  { topic: 'Candles older than the latest 5000 per interval', reason: '`candleSnapshot` only serves the most recent 5000 candles of each interval.' },
  { topic: 'WebSocket streams, CSV/NDJSON output, API keys and billing', reason: 'Not implemented in this backend. Use Hyperliquid’s own WebSocket (wss://api.hyperliquid.xyz/ws) for streaming.' },
]);

function routes({ hl, now }) {
  /* -------- coin index (cached 5 min) -------- */
  async function perpMeta(dex) {
    const r = await hl.info(dex ? { type: 'meta', dex } : { type: 'meta' }, { ttlMs: 300_000 });
    return r.data;
  }
  async function spotMeta() {
    const r = await hl.info({ type: 'spotMeta' }, { ttlMs: 300_000 });
    return r.data;
  }

  async function resolveCoin(raw) {
    const input = decodeURIComponent(raw).trim();
    if (!input || input.length > 40) throw invalid('coin is required');
    const lower = input.toLowerCase();
    const colon = input.indexOf(':');
    if (colon > 0) {
      const dex = input.slice(0, colon);
      if (!/^[a-z0-9]{1,16}$/i.test(dex)) throw new ApiProblem('not_found', `Unknown market ${input}`);
      let meta;
      try {
        meta = await perpMeta(dex.toLowerCase());
      } catch (error) {
        if (error instanceof UpstreamError && error.upstreamStatus && error.upstreamStatus < 500) throw new ApiProblem('not_found', `Unknown perp dex ${dex}`);
        throw error;
      }
      const hit = meta.universe.find((a) => a.name.toLowerCase() === lower);
      if (!hit) throw new ApiProblem('not_found', `Unknown market ${input} on dex ${dex}`);
      return { coin: hit.name, kind: 'perp', dex: dex.toLowerCase(), asset: hit };
    }
    const meta = await perpMeta('');
    const perp = meta.universe.find((a) => a.name === input) ?? meta.universe.find((a) => a.name.toLowerCase() === lower);
    if (perp) return { coin: perp.name, kind: 'perp', dex: '', asset: perp };
    const pairs = spotPairs(await spotMeta());
    const spot = pairs.find((p) => p.coin.toLowerCase() === lower) ?? pairs.find((p) => p.pair.toLowerCase() === lower && p.canonical)
      ?? pairs.find((p) => p.pair.toLowerCase() === lower);
    if (spot) return { coin: spot.coin, kind: 'spot', dex: '', pair: spot.pair };
    throw new ApiProblem('not_found', `Unknown market ${input}. List markets with /v1/markets or /v1/spot/markets.`);
  }

  /* -------- route table -------- */
  return [
    {
      path: '/v1/status', group: 'Service', summary: 'Live health check: calls Hyperliquid `exchangeStatus` uncached and reports latency, weight budget and cache stats.',
      upstream: ['exchangeStatus'], params: [],
      async handler() {
        const r = await hl.info({ type: 'exchangeStatus' });
        return { data: { status: 'ok', upstream_time: r.data.time, special_statuses: r.data.specialStatuses ?? null, upstream_latency_ms: r.upstreamMs, client: hl.snapshot() }, sources: [r] };
      },
    },
    {
      path: '/v1/markets', group: 'Markets', summary: 'Every perp market with mark, oracle, mid, 1 h funding, open interest and 24 h volume.',
      upstream: ['metaAndAssetCtxs'],
      params: [
        { name: 'dex', in: 'query', description: 'HIP-3 perp dex name from /v1/dexs. Empty = the main Hyperliquid perp dex.' },
        { name: 'sort', in: 'query', description: 'volume (default), open_interest, change, funding, coin' },
        { name: 'include_delisted', in: 'query', description: 'true to keep delisted markets' },
        { name: 'limit', in: 'query', description: '1–1000, default 1000' },
      ],
      async handler({ query }) {
        const dex = parseDex(query);
        const sort = query.get('sort') || 'volume';
        const sorters = {
          volume: (a, b) => (b.volume_24h_usd ?? -1) - (a.volume_24h_usd ?? -1),
          open_interest: (a, b) => (b.open_interest_usd ?? -1) - (a.open_interest_usd ?? -1),
          change: (a, b) => (b.change_24h_pct ?? -Infinity) - (a.change_24h_pct ?? -Infinity),
          funding: (a, b) => (b.funding_rate_1h ?? -Infinity) - (a.funding_rate_1h ?? -Infinity),
          coin: (a, b) => a.coin.localeCompare(b.coin),
        };
        if (!sorters[sort]) throw invalid(`sort must be one of ${Object.keys(sorters).join(', ')}`);
        const limit = parseLimit(query, 1000, 1000);
        const r = await hl.info(dex ? { type: 'metaAndAssetCtxs', dex } : { type: 'metaAndAssetCtxs' }, { ttlMs: 3_000 });
        const [meta, ctxs] = r.data;
        let rows = meta.universe.map((asset, i) => perpRow(asset, ctxs[i], dex));
        if (query.get('include_delisted') !== 'true') rows = rows.filter((row) => !row.delisted);
        rows.sort(sorters[sort]);
        return { data: rows.slice(0, limit), sources: [r] };
      },
    },
    {
      path: '/v1/markets/mids', group: 'Markets', summary: 'Mid price of every perp and spot market.',
      upstream: ['allMids'], params: [{ name: 'dex', in: 'query', description: 'HIP-3 perp dex name. Empty = main dex (includes spot @N mids).' }],
      async handler({ query }) {
        const dex = parseDex(query);
        const r = await hl.info(dex ? { type: 'allMids', dex } : { type: 'allMids' }, { ttlMs: 1_000 });
        const data = Object.fromEntries(Object.entries(r.data).map(([coin, px]) => [coin, num(px)]));
        return { data, sources: [r], count: Object.keys(data).length };
      },
    },
    {
      path: '/v1/markets/:coin', group: 'Markets', summary: 'One perp market’s live context. Accepts BTC, kPEPE or HIP-3 names like xyz:XYZ100.',
      upstream: ['meta', 'metaAndAssetCtxs'], params: [{ name: 'coin', in: 'path', required: true, example: 'BTC' }],
      async handler({ params }) {
        const market = await resolveCoin(params.coin);
        if (market.kind !== 'perp') throw invalid(`${market.coin} is a spot market; use /v1/spot/markets`);
        const r = await hl.info(market.dex ? { type: 'metaAndAssetCtxs', dex: market.dex } : { type: 'metaAndAssetCtxs' }, { ttlMs: 3_000 });
        const index = r.data[0].universe.findIndex((a) => a.name === market.coin);
        if (index < 0) throw new ApiProblem('not_found', `Market ${market.coin} is not listed any more`);
        return { data: perpRow(r.data[0].universe[index], r.data[1][index], market.dex), sources: [r] };
      },
    },
    {
      path: '/v1/markets/:coin/book', group: 'Markets', summary: 'L2 order book snapshot (up to 20 levels per side) with spread.',
      upstream: ['l2Book'],
      params: [
        { name: 'coin', in: 'path', required: true, example: 'BTC' },
        { name: 'n_sig_figs', in: 'query', description: '2–5 to aggregate price levels; empty = full precision' },
      ],
      async handler({ params, query }) {
        const market = await resolveCoin(params.coin);
        const body = { type: 'l2Book', coin: market.coin };
        const sig = query.get('n_sig_figs');
        if (sig) {
          const value = Number(sig);
          if (![2, 3, 4, 5].includes(value)) throw invalid('n_sig_figs must be 2, 3, 4 or 5');
          body.nSigFigs = value;
        }
        const r = await hl.info(body, { ttlMs: 1_000 });
        if (!r.data) throw new ApiProblem('not_found', `No order book for ${market.coin}`);
        const side = (levels) => levels.map((l) => ({ px: num(l.px), sz: num(l.sz), orders: l.n }));
        const bids = side(r.data.levels[0] ?? []);
        const asks = side(r.data.levels[1] ?? []);
        const bestBid = bids[0]?.px ?? null;
        const bestAsk = asks[0]?.px ?? null;
        const mid = bestBid !== null && bestAsk !== null ? (bestBid + bestAsk) / 2 : null;
        return {
          data: {
            coin: market.coin, kind: market.kind, time: r.data.time, bids, asks,
            best_bid: bestBid, best_ask: bestAsk, mid,
            spread: mid !== null ? bestAsk - bestBid : null,
            spread_bps: mid ? ((bestAsk - bestBid) / mid) * 10_000 : null,
          },
          sources: [r],
        };
      },
    },
    {
      path: '/v1/markets/:coin/trades', group: 'Markets', summary: 'Most recent trades of one market with buyer and seller wallets. Only the latest trades are available upstream.',
      upstream: ['recentTrades'], params: [{ name: 'coin', in: 'path', required: true, example: 'BTC' }],
      async handler({ params }) {
        const market = await resolveCoin(params.coin);
        const r = await hl.info({ type: 'recentTrades', coin: market.coin }, { ttlMs: 1_000 });
        const rows = r.data.map(tradeRow).sort((a, b) => b.time - a.time);
        return { data: rows, sources: [r] };
      },
    },
    {
      path: '/v1/markets/:coin/candles', group: 'Markets', summary: 'OHLCV candles. Upstream keeps the latest 5000 candles per interval.',
      upstream: ['candleSnapshot'],
      params: [
        { name: 'coin', in: 'path', required: true, example: 'BTC' },
        { name: 'interval', in: 'query', description: Object.keys(CANDLE_INTERVALS).join(', '), example: '1h' },
        { name: 'start_time', in: 'query', description: 'Unix ms. Default: end_time − limit × interval' },
        { name: 'end_time', in: 'query', description: 'Unix ms. Default: now' },
        { name: 'limit', in: 'query', description: '1–5000, default 200 (latest candles are kept)' },
      ],
      async handler({ params, query }) {
        const market = await resolveCoin(params.coin);
        const interval = query.get('interval') || '1h';
        const step = CANDLE_INTERVALS[interval];
        if (!step) throw invalid(`interval must be one of ${Object.keys(CANDLE_INTERVALS).join(', ')}`);
        const limit = parseLimit(query, 200, 5000);
        const { start, end } = timeRange(query, { defaultSpan: step * limit, now: now() });
        const r = await hl.info({ type: 'candleSnapshot', req: { coin: market.coin, interval, startTime: start, endTime: end } }, { ttlMs: 5_000 });
        const rows = r.data.map(candleRow).sort((a, b) => a.time_open - b.time_open).slice(-limit);
        return { data: rows, sources: [r], extra: { coin: market.coin, interval, start_time: start, end_time: end } };
      },
    },
    {
      path: '/v1/markets/:coin/funding', group: 'Markets', summary: 'Hourly funding-rate history of one perp market (max 500 rows per call upstream).',
      upstream: ['fundingHistory'],
      params: [
        { name: 'coin', in: 'path', required: true, example: 'BTC' },
        { name: 'start_time', in: 'query', description: 'Unix ms. Default: 24 h ago' },
        { name: 'end_time', in: 'query', description: 'Unix ms. Default: now' },
      ],
      async handler({ params, query }) {
        const market = await resolveCoin(params.coin);
        if (market.kind !== 'perp') throw invalid('funding exists only for perp markets');
        const { start, end } = timeRange(query, { defaultSpan: DAY, now: now() });
        const r = await hl.info({ type: 'fundingHistory', coin: market.coin, startTime: start, endTime: end }, { ttlMs: 30_000 });
        const rows = r.data.map((f) => ({ time: f.time, coin: f.coin, funding_rate_1h: num(f.fundingRate), premium: num(f.premium) }));
        return { data: rows, sources: [r], extra: { start_time: start, end_time: end } };
      },
    },
    {
      path: '/v1/spot/markets', group: 'Markets', summary: 'Spot pairs with mark, mid, 24 h change, volume and supply.',
      upstream: ['spotMetaAndAssetCtxs'], params: [{ name: 'limit', in: 'query', description: '1–5000, default 5000' }],
      async handler({ query }) {
        const limit = parseLimit(query, 5000, 5000);
        const r = await hl.info({ type: 'spotMetaAndAssetCtxs' }, { ttlMs: 5_000 });
        const [meta, ctxs] = r.data;
        const pairs = spotPairs(meta);
        const byCoin = new Map(ctxs.map((ctx) => [ctx.coin, ctx]));
        const rows = pairs.map((pair) => {
          const ctx = byCoin.get(pair.coin) ?? {};
          const mark = num(ctx.markPx);
          const prev = num(ctx.prevDayPx);
          return {
            ...pair, mark_px: mark, mid_px: num(ctx.midPx), prev_day_px: prev,
            change_24h_pct: mark !== null && prev ? ((mark - prev) / prev) * 100 : null,
            volume_24h_quote: num(ctx.dayNtlVlm), volume_24h_base: num(ctx.dayBaseVlm),
            circulating_supply: num(ctx.circulatingSupply), total_supply: num(ctx.totalSupply),
          };
        }).sort((a, b) => (b.volume_24h_quote ?? -1) - (a.volume_24h_quote ?? -1));
        return { data: rows.slice(0, limit), sources: [r] };
      },
    },
    {
      path: '/v1/dexs', group: 'Markets', summary: 'Perp dexs (the main dex plus HIP-3 builder-deployed dexs).',
      upstream: ['perpDexs'], params: [],
      async handler() {
        const r = await hl.info({ type: 'perpDexs' }, { ttlMs: 60_000 });
        const rows = r.data.map((d) => (d === null
          ? { name: '', full_name: 'Hyperliquid', deployer: null, fee_recipient: null }
          : { name: d.name, full_name: d.fullName, deployer: d.deployer ?? null, fee_recipient: d.feeRecipient ?? null }));
        return { data: rows, sources: [r] };
      },
    },
    {
      path: '/v1/accounts/:address', group: 'Accounts', summary: 'Margin summary, withdrawable balance, positions count and spot balances of one wallet.',
      upstream: ['clearinghouseState', 'spotClearinghouseState'],
      params: [
        { name: 'address', in: 'path', required: true, example: '0x…' },
        { name: 'dex', in: 'query', description: 'HIP-3 perp dex for the perp side. Empty = main dex.' },
      ],
      async handler({ params, query }) {
        const user = parseAddress(params.address);
        const dex = parseDex(query);
        const [perp, spot] = await Promise.all([
          hl.info(dex ? { type: 'clearinghouseState', user, dex } : { type: 'clearinghouseState', user }, { ttlMs: 2_000 }),
          hl.info({ type: 'spotClearinghouseState', user }, { ttlMs: 2_000 }),
        ]);
        const m = perp.data.marginSummary;
        return {
          data: {
            address: user, dex, time: perp.data.time,
            account_value: num(m.accountValue), total_notional: num(m.totalNtlPos), total_raw_usd: num(m.totalRawUsd),
            margin_used: num(m.totalMarginUsed), maintenance_margin: num(perp.data.crossMaintenanceMarginUsed),
            withdrawable: num(perp.data.withdrawable), positions: perp.data.assetPositions.length,
            spot_balances: spot.data.balances.map((b) => ({ coin: b.coin, token: b.token, total: num(b.total), hold: num(b.hold), entry_notional: num(b.entryNtl) })),
          },
          sources: [perp, spot],
        };
      },
    },
    {
      path: '/v1/accounts/:address/positions', group: 'Accounts', summary: 'Open perp positions with entry, mark, PnL, leverage and liquidation price.',
      upstream: ['clearinghouseState'],
      params: [{ name: 'address', in: 'path', required: true, example: '0x…' }, { name: 'dex', in: 'query', description: 'HIP-3 perp dex. Empty = main dex.' }],
      async handler({ params, query }) {
        const user = parseAddress(params.address);
        const dex = parseDex(query);
        const r = await hl.info(dex ? { type: 'clearinghouseState', user, dex } : { type: 'clearinghouseState', user }, { ttlMs: 2_000 });
        const rows = r.data.assetPositions.map(positionRow).sort((a, b) => Math.abs(b.position_value_usd ?? 0) - Math.abs(a.position_value_usd ?? 0));
        return { data: rows, sources: [r] };
      },
    },
    {
      path: '/v1/accounts/:address/open-orders', group: 'Accounts', summary: 'Resting orders including trigger (TP/SL) orders.',
      upstream: ['frontendOpenOrders'],
      params: [{ name: 'address', in: 'path', required: true, example: '0x…' }, { name: 'dex', in: 'query', description: 'HIP-3 perp dex. Empty = main dex.' }],
      async handler({ params, query }) {
        const user = parseAddress(params.address);
        const dex = parseDex(query);
        const r = await hl.info(dex ? { type: 'frontendOpenOrders', user, dex } : { type: 'frontendOpenOrders', user }, { ttlMs: 2_000 });
        return { data: r.data.map(orderRow).sort((a, b) => b.time - a.time), sources: [r] };
      },
    },
    {
      path: '/v1/accounts/:address/fills', group: 'Accounts', summary: 'Fills, newest first. Without start_time: the latest 2000. With start_time: up to 2000 from that time (10 000 most recent are reachable upstream).',
      upstream: ['userFills', 'userFillsByTime'],
      params: [
        { name: 'address', in: 'path', required: true, example: '0x…' },
        { name: 'start_time', in: 'query', description: 'Unix ms (switches to userFillsByTime)' },
        { name: 'end_time', in: 'query', description: 'Unix ms' },
        { name: 'limit', in: 'query', description: '1–2000, default 100' },
      ],
      async handler({ params, query }) {
        const user = parseAddress(params.address);
        const limit = parseLimit(query, 100, 2000);
        const start = parseTime(query, 'start_time');
        const end = parseTime(query, 'end_time');
        let body;
        if (start !== undefined) {
          body = { type: 'userFillsByTime', user, startTime: start, aggregateByTime: false };
          if (end !== undefined) body.endTime = end;
        } else {
          if (end !== undefined) throw invalid('end_time requires start_time');
          body = { type: 'userFills', user };
        }
        const r = await hl.info(body, { ttlMs: 3_000 });
        const rows = r.data.map(fillRow).sort((a, b) => b.time - a.time);
        return { data: rows.slice(0, limit), sources: [r], extra: { upstream_rows: rows.length } };
      },
    },
    {
      path: '/v1/accounts/:address/funding', group: 'Accounts', summary: 'Funding payments received or paid by the wallet (max 500 rows per call upstream).',
      upstream: ['userFunding'],
      params: [
        { name: 'address', in: 'path', required: true, example: '0x…' },
        { name: 'start_time', in: 'query', description: 'Unix ms. Default: 7 d ago' },
        { name: 'end_time', in: 'query', description: 'Unix ms. Default: now' },
      ],
      async handler({ params, query }) {
        const user = parseAddress(params.address);
        const { start, end } = timeRange(query, { defaultSpan: 7 * DAY, now: now() });
        const r = await hl.info({ type: 'userFunding', user, startTime: start, endTime: end }, { ttlMs: 30_000 });
        const rows = r.data.filter((u) => u.delta?.type === 'funding').map((u) => ({
          time: u.time, coin: u.delta.coin, usdc: num(u.delta.usdc), szi: num(u.delta.szi), funding_rate_1h: num(u.delta.fundingRate),
        })).sort((a, b) => b.time - a.time);
        return { data: rows, sources: [r], extra: { start_time: start, end_time: end } };
      },
    },
    {
      path: '/v1/accounts/:address/ledger', group: 'Accounts', summary: 'Deposits, withdrawals, transfers and other non-funding ledger events. `delta` is passed through as returned upstream.',
      upstream: ['userNonFundingLedgerUpdates'],
      params: [
        { name: 'address', in: 'path', required: true, example: '0x…' },
        { name: 'start_time', in: 'query', description: 'Unix ms. Default: 30 d ago' },
        { name: 'end_time', in: 'query', description: 'Unix ms. Default: now' },
      ],
      async handler({ params, query }) {
        const user = parseAddress(params.address);
        const { start, end } = timeRange(query, { defaultSpan: 30 * DAY, now: now() });
        const r = await hl.info({ type: 'userNonFundingLedgerUpdates', user, startTime: start, endTime: end }, { ttlMs: 30_000 });
        const rows = r.data.map((u) => ({ time: u.time, hash: u.hash, type: u.delta?.type ?? null, usdc_value: num(u.delta?.usdcValue ?? u.delta?.usdc), delta: u.delta }))
          .sort((a, b) => b.time - a.time);
        return { data: rows, sources: [r], extra: { start_time: start, end_time: end } };
      },
    },
    {
      path: '/v1/accounts/:address/portfolio', group: 'Accounts', summary: 'Account-value and PnL history as charted on Hyperliquid, plus traded volume for the window.',
      upstream: ['portfolio'],
      params: [
        { name: 'address', in: 'path', required: true, example: '0x…' },
        { name: 'window', in: 'query', description: PORTFOLIO_WINDOWS.join(', '), example: 'month' },
      ],
      async handler({ params, query }) {
        const user = parseAddress(params.address);
        const window = query.get('window') || 'month';
        if (!PORTFOLIO_WINDOWS.includes(window)) throw invalid(`window must be one of ${PORTFOLIO_WINDOWS.join(', ')}`);
        const r = await hl.info({ type: 'portfolio', user }, { ttlMs: 30_000 });
        const entry = r.data.find(([name]) => name === window);
        if (!entry) throw new ApiProblem('not_found', `Window ${window} is not present upstream`);
        const series = entry[1];
        const values = new Map((series.pnlHistory ?? []).map(([t, v]) => [t, num(v)]));
        const rows = (series.accountValueHistory ?? []).map(([t, v]) => ({ time: t, account_value: num(v), pnl: values.get(t) ?? null }));
        return { data: { address: user, window, volume: num(series.vlm), history: rows }, sources: [r], count: rows.length };
      },
    },
  ];
}

/* ----------------------------------------------------------------------------
   Request handling
   ---------------------------------------------------------------------------- */

function compile(route) {
  const names = [];
  const pattern = route.path.replace(/:[a-z]+/g, (m) => { names.push(m.slice(1)); return '([^/]+)'; });
  return { ...route, regex: new RegExp(`^${pattern}/?$`), names };
}

function createClientLimiter({ ratePerSec, burst, now }) {
  const buckets = new Map();
  return function take(key) {
    const t = now();
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { tokens: burst, at: t };
      buckets.set(key, bucket);
      if (buckets.size > 10_000) {
        for (const [k, b] of buckets) if (t - b.at > 60_000) buckets.delete(k);
      }
    }
    bucket.tokens = Math.min(burst, bucket.tokens + ((t - bucket.at) / 1000) * ratePerSec);
    bucket.at = t;
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return { ok: true, remaining: Math.floor(bucket.tokens), resetSec: Math.ceil((burst - bucket.tokens) / ratePerSec) };
    }
    return { ok: false, remaining: 0, retryAfterSec: Math.max(1, Math.ceil((1 - bucket.tokens) / ratePerSec)) };
  };
}

function requestId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Create the API handler. `env` holds configuration (see config.js).
 * Returns { handle(request) → Promise<Response | null>, catalog }.
 * `handle` returns null for paths outside /v1 so the host can serve assets.
 */
export function createApi({ env = {}, fetchImpl = globalThis.fetch, now = () => Date.now(), logger = null, sleep } = {}) {
  let config;
  let configError = null;
  try {
    config = loadConfig(env);
  } catch (error) {
    configError = error;
    config = loadConfig({});
  }
  const log = logger ?? createLogger({ level: config.logLevel });
  if (configError) log.error('config.invalid', { detail: configError.message });
  const hl = createHyperliquidClient({ config, logger: log, fetchImpl, now, ...(sleep ? { sleep } : {}) });
  const table = routes({ hl, now }).map(compile);
  const limiter = createClientLimiter({ ratePerSec: config.clientRatePerSec, burst: config.clientBurst, now });

  const catalog = {
    version: API_VERSION,
    source: config.infoUrl,
    endpoints: table.map(({ path, group, summary, upstream, params }) => ({ method: 'GET', path: path.replace(/:([a-z]+)/g, '{$1}'), group, summary, upstream, params })),
    unavailable: UNAVAILABLE,
    limits: {
      client_rate_per_sec: config.clientRatePerSec,
      client_burst: config.clientBurst,
      upstream_weight_budget_per_min: config.weightBudgetPerMin,
      upstream_timeout_ms: config.timeoutMs,
      upstream_max_retries: config.maxRetries,
    },
  };

  function baseHeaders(id) {
    return {
      'access-control-allow-origin': config.corsAllowOrigin,
      'access-control-expose-headers': 'x-request-id, x-cache, x-upstream-fetched-at, ratelimit-limit, ratelimit-remaining, ratelimit-reset, retry-after',
      'cache-control': 'no-store',
      'x-request-id': id,
      'x-api-version': API_VERSION,
    };
  }

  function problemResponse(error, id, path, extraHeaders = {}) {
    const isProblem = error instanceof ApiProblem;
    const isUpstream = error instanceof UpstreamError;
    const code = isProblem || isUpstream ? error.code : 'internal_error';
    const status = isProblem || isUpstream ? error.status : 500;
    const body = {
      type: `/docs.html#error-${code}`,
      title: PROBLEMS[code]?.[1] ?? 'Error',
      status,
      code,
      detail: isProblem || isUpstream ? error.message : 'Unexpected server error',
      instance: path,
      request_id: id,
      ...(isUpstream ? { upstream: config.infoUrl, upstream_status: error.upstreamStatus, attempts: error.attempts } : {}),
      ...(isProblem ? error.extra : {}),
    };
    const headers = { ...baseHeaders(id), 'content-type': 'application/problem+json; charset=utf-8', ...extraHeaders };
    if (isUpstream && error.retryAfterMs) headers['retry-after'] = String(Math.ceil(error.retryAfterMs / 1000));
    return new Response(JSON.stringify(body, null, 2), { status, headers });
  }

  async function handle(request) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/v1')) return null;
    const id = requestId();
    const started = now();

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: { ...baseHeaders(id), 'access-control-allow-methods': 'GET, OPTIONS', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '86400' },
      });
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return problemResponse(new ApiProblem('method_not_allowed', 'Only GET is supported'), id, url.pathname, { allow: 'GET, OPTIONS' });
    }
    if (configError) return problemResponse(new ApiProblem('config_error', configError.message), id, url.pathname);

    const clientKey = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'local';
    const quota = limiter(clientKey);
    const rateHeaders = { 'ratelimit-limit': String(config.clientBurst), 'ratelimit-remaining': String(quota.remaining) };
    if (!quota.ok) {
      log.warn('client.rate_limited', { path: url.pathname, request_id: id });
      return problemResponse(new ApiProblem('rate_limited', `Rate limit is ${config.clientRatePerSec} requests/s with a burst of ${config.clientBurst}`),
        id, url.pathname, { ...rateHeaders, 'retry-after': String(quota.retryAfterSec) });
    }
    rateHeaders['ratelimit-reset'] = String(quota.resetSec);

    let response;
    try {
      if (url.pathname === '/v1' || url.pathname === '/v1/' || url.pathname === '/v1/endpoints') {
        response = new Response(JSON.stringify({ data: catalog, meta: { request_id: id } }, null, 2), {
          status: 200, headers: { ...baseHeaders(id), ...rateHeaders, 'content-type': 'application/json; charset=utf-8' },
        });
      } else {
        let match = null;
        let route = null;
        for (const candidate of table) {
          match = candidate.regex.exec(url.pathname);
          if (match) { route = candidate; break; }
        }
        if (!route) throw new ApiProblem('not_found', `No endpoint ${url.pathname}. See /v1/endpoints.`);
        const params = Object.fromEntries(route.names.map((name, i) => [name, match[i + 1]]));
        const result = await route.handler({ params, query: url.searchParams });
        const sources = result.sources ?? [];
        const oldest = sources.reduce((min, s) => Math.min(min, s.fetchedAt), Infinity);
        const meta = {
          request_id: id,
          source: config.infoUrl,
          upstream_types: route.upstream,
          fetched_at: Number.isFinite(oldest) ? new Date(oldest).toISOString() : null,
          cached: sources.length > 0 && sources.every((s) => s.cached),
          age_ms: sources.length ? Math.max(...sources.map((s) => s.ageMs)) : 0,
          upstream_ms: sources.length ? Math.max(...sources.map((s) => s.upstreamMs ?? 0)) : 0,
          count: result.count ?? (Array.isArray(result.data) ? result.data.length : 1),
          ...(result.extra ?? {}),
        };
        response = new Response(JSON.stringify({ data: result.data, meta }), {
          status: 200,
          headers: {
            ...baseHeaders(id), ...rateHeaders,
            'content-type': 'application/json; charset=utf-8',
            'x-cache': meta.cached ? 'HIT' : 'MISS',
            ...(meta.fetched_at ? { 'x-upstream-fetched-at': meta.fetched_at } : {}),
          },
        });
      }
    } catch (error) {
      if (!(error instanceof ApiProblem) && !(error instanceof UpstreamError)) {
        log.error('request.exception', { path: url.pathname, request_id: id, detail: String(error?.stack || error) });
      }
      response = problemResponse(error, id, url.pathname, rateHeaders);
    }
    log.info('request', { method: request.method, path: url.pathname, query: url.search, status: response.status, ms: now() - started, request_id: id });
    if (request.method === 'HEAD') return new Response(null, { status: response.status, headers: response.headers });
    return response;
  }

  return Object.freeze({ handle, catalog, client: hl, config });
}
