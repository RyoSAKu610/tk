/**
 * Hyperdash Data API — the mock data plane.
 *
 * A complete, browser-local implementation of the documented API surface:
 * plans and limits, API keys and scopes, token-bucket rate limiting, credit
 * reservation and charging, RFC 9457 problem responses, cursor pagination,
 * CSV/NDJSON negotiation, `GET /v1/quote`, and the WebSocket-style stream
 * protocol (ready → subscribe → data → ack, 10 s ack timeout, gap messages).
 *
 * Everything runs in memory (optionally persisted through an injected
 * storage adapter) so the marketing site can demonstrate the real product
 * end to end without a backend or an API key from us.
 */

export const API_VERSION = '2026-11-17';

export const SCOPES = Object.freeze([
  'markets:read', 'accounts:read', 'liquidations:read', 'analytics:read', 'streams:read', 'usage:read',
]);

export const PLAN_ORDER = Object.freeze(['starter', 'growth', 'scale', 'enterprise']);

/** The wallet used by every docs and playground example, mirroring the quickstart. */
export const DEMO_ACCOUNT = '0x8f4e2c7a9b1d5e6f3a0c8b2d4e7f190a3c5b8d02';

/** Values transcribed from docs.hyperdash.com/data-api/plans. */
export const PLANS = Object.freeze({
  starter: Object.freeze({
    id: 'starter', name: 'Starter', priceMonthly: 99, priceYearly: 990,
    credits: 4_000_000, historyDays: 90, rps: 25, burst: 50, concurrency: 4,
    streamConnections: 5, orderStreamWallets: 10, accountStreamWallets: 10,
    batchWallets: 250, rowsPerWalletList: 100, newWalletsPerDay: 300,
    logDays: 7, projects: 3, seats: 5,
    features: Object.freeze({ streams: true, footprint: false, l4: false, outcomes: false, priority: false, jobs: false }),
    creditRatePerMillion: 24.75,
  }),
  growth: Object.freeze({
    id: 'growth', name: 'Growth', priceMonthly: 499, priceYearly: 4_990,
    credits: 30_000_000, historyDays: 180, rps: 100, burst: 200, concurrency: 16,
    streamConnections: 25, orderStreamWallets: 50, accountStreamWallets: 50,
    batchWallets: 1_000, rowsPerWalletList: 500, newWalletsPerDay: 3_000,
    logDays: 30, projects: 10, seats: 20,
    features: Object.freeze({ streams: true, footprint: true, l4: true, outcomes: true, priority: true, jobs: true }),
    creditRatePerMillion: 16.63,
  }),
  scale: Object.freeze({
    id: 'scale', name: 'Scale', priceMonthly: 1_999, priceYearly: 19_990,
    credits: 150_000_000, historyDays: 365, rps: 200, burst: 400, concurrency: 32,
    streamConnections: 50, orderStreamWallets: 200, accountStreamWallets: 200,
    batchWallets: 10_000, rowsPerWalletList: 1_000, newWalletsPerDay: 10_000,
    logDays: 90, projects: 25, seats: 50,
    features: Object.freeze({ streams: true, footprint: true, l4: true, outcomes: true, priority: true, jobs: true }),
    creditRatePerMillion: 13.33,
  }),
  enterprise: Object.freeze({
    id: 'enterprise', name: 'Enterprise', priceMonthly: null, priceYearly: null,
    credits: null, historyDays: null, rps: 200, burst: 400, concurrency: 32,
    streamConnections: 50, orderStreamWallets: 200, accountStreamWallets: 200,
    batchWallets: 10_000, rowsPerWalletList: 1_000, newWalletsPerDay: 10_000,
    logDays: 90, projects: 25, seats: 50,
    features: Object.freeze({ streams: true, footprint: true, l4: true, outcomes: true, priority: true, jobs: true }),
    creditRatePerMillion: null,
  }),
});

export const STREAM_CHANNELS = Object.freeze([
  { channel: 'trades', target: 'coin', credits: 1, description: 'Every trade of one market, with taker and maker wallets.' },
  { channel: 'liquidations', target: 'coin', credits: 1, description: 'Liquidations of one market, or every market with coin "*".' },
  { channel: 'candles', target: 'coin', credits: 1, description: 'Candle updates as trades land. interval: 1m … 1d.' },
  { channel: 'ctx', target: 'coin', credits: 1, description: 'Mark, oracle, mid, funding and open interest, at least every 10 s.' },
  { channel: 'book', target: 'coin', credits: 1, description: 'Full 20-level book snapshots, at most 2 per second.' },
  { channel: 'bbo', target: 'coin', credits: 1, description: 'Best bid and offer, at most 4 updates per second.' },
  { channel: 'liquidation-levels', target: 'coin', credits: 1, description: 'The market’s liquidation ladder, at most once per second.' },
  { channel: 'stop-levels', target: 'coin', credits: 1, description: 'The market’s resting stop-order ladder, at most once per second.' },
  { channel: 'mids', target: 'all', credits: 1, description: 'The mid price of every market, about once per second.' },
  { channel: 'markets', target: 'all', credits: 5, description: 'ctx fields of every perp market, about once per second.' },
  { channel: 'fills', target: 'address', credits: 1, description: 'Live fills for one wallet.' },
  { channel: 'orders', target: 'address', credits: 1, description: 'Every order event for one wallet.' },
  { channel: 'account', target: 'address', credits: 1, description: 'Positions and margin of one wallet, at most once per second.' },
  { channel: 'funding', target: 'address', credits: 1, description: 'Funding payments of one wallet, each hourly settlement.' },
]);

/* --------------------------------------------------------------------------
   Endpoint registry
   -------------------------------------------------------------------------- */

function endpoint({ method = 'GET', path, group, summary, scope, base = 1, perRow = 0.002, maxLimit, rowCap, feature = null, needsKey = false, handler }) {
  const segments = path.split('/').filter(Boolean);
  return Object.freeze({
    id: `${method.toLowerCase()}_${segments.join('_').replace(/[{}]/g, '')}`,
    method, path, segments, group, summary, scope, base, perRow, maxLimit, rowCap, feature, needsKey, handler,
  });
}

const coins = (engine, params) => params.coin;

function parseTime(value, name) {
  if (value === undefined || value === null || value === '') return undefined;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) throw problem('invalid_parameter', `${name} must be Unix milliseconds`);
  return Math.trunc(numeric);
}

function parseLimit(value, fallback, maximum, name = 'limit') {
  if (value === undefined || value === null || value === '') return fallback;
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 1) throw problem('invalid_parameter', `${name} must be a positive integer`);
  if (maximum && numeric > maximum) throw problem('invalid_parameter', `${name} must be at most ${maximum}`);
  return numeric;
}

const PROBLEM_TITLES = {
  invalid_parameter: 'Invalid parameter', range_too_large: 'Range too large', invalid_key: 'Invalid API key',
  expired_key: 'API key expired', revoked_key: 'API key revoked', insufficient_scope: 'Missing scope',
  plan_required: 'Plan required', history_limit: 'History limit', feature_not_in_plan: 'Feature not in plan',
  credits_exhausted: 'Credits exhausted', max_credits_exceeded: 'Max credits exceeded', not_found: 'Not found',
  price_changed: 'Price changed', rate_limited: 'Too many requests', extraction_limit: 'Extraction limit',
  upstream_busy: 'Upstream busy', unavailable: 'Unavailable', idempotency_conflict: 'Idempotency conflict',
};

function problem(code, detail, extra = {}) {
  const statuses = {
    invalid_parameter: 400, range_too_large: 400, invalid_key: 401, expired_key: 401, revoked_key: 401,
    insufficient_scope: 403, plan_required: 403, history_limit: 403, feature_not_in_plan: 403,
    credits_exhausted: 403, max_credits_exceeded: 403, not_found: 404, price_changed: 409,
    rate_limited: 429, extraction_limit: 429, jobs_limit: 429, upstream_busy: 503, unavailable: 503,
  };
  return Object.assign(new Error(detail), { code, status: statuses[code] ?? 400, title: PROBLEM_TITLES[code] ?? 'Error', ...extra });
}

function endpointList(engine) {
  const { requireMarket } = engine;
  return [
    /* ---------------------------- markets ---------------------------- */
    endpoint({
      path: '/v1/markets', group: 'Markets (live)', scope: 'markets:read', base: 6, perRow: 0.5, maxLimit: 1000,
      summary: 'Perp markets with live context: mark, oracle, mid, funding, open interest, 24 h volume.',
      handler: ({ query }) => {
        const rows = engine.listMarkets({
          dex: query.dex ? String(query.dex) : null,
          category: query.category ? String(query.category) : null,
          limit: parseLimit(query.limit, 200, 1000),
        });
        return { data: rows, meta: { count: rows.length, as_of: engine.now() } };
      },
    }),
    endpoint({
      path: '/v1/markets/catalog', group: 'Markets (live)', scope: 'markets:read', base: 4, perRow: 0.15, maxLimit: 5000,
      summary: 'Every market’s category, sector and asset class.',
      handler: () => ({
        data: engine.markets.map((config) => ({
          coin: config.coin, name: config.name, dex: config.dex, category: config.category,
          sector: config.sector, asset_class: config.category === 'crypto' ? 'crypto' : 'tradfi',
        })),
        meta: { count: engine.markets.length },
      }),
    }),
    endpoint({
      path: '/v1/markets/mids', group: 'Markets (live)', scope: 'markets:read', base: 3, perRow: 0.05, maxLimit: 20000,
      summary: 'Mid price of every market.',
      handler: () => ({ data: engine.mids(), meta: { count: engine.markets.length } }),
    }),
    endpoint({
      path: '/v1/markets/:coin/trades', group: 'Market history', scope: 'markets:read', base: 4, perRow: 0.004, maxLimit: 1000,
      summary: 'Trade tape of one market, with taker and maker wallet.',
      handler: ({ params, query }) => {
        const start = parseTime(query.start_time, 'start_time');
        const end = parseTime(query.end_time, 'end_time');
        if (start !== undefined && end !== undefined && end - start > 86_400_000) {
          throw problem('range_too_large', 'max range for trades is 1 d');
        }
        const result = engine.trades({
          coin: requireMarket(params.coin).coin,
          startTime: start, endTime: end,
          limit: parseLimit(query.limit, 100, 1000),
        });
        return { ...result, meta: { ...result.meta, as_of: engine.now() } };
      },
    }),
    endpoint({
      path: '/v1/markets/:coin/candles', group: 'Candles (OHLCV)', scope: 'markets:read', base: 12, perRow: 0.01, maxLimit: 5000,
      summary: 'OHLCV candles for one market from 1 second to 1 month.',
      handler: ({ params, query }) => {
        const coin = requireMarket(params.coin).coin;
        const start = parseTime(query.start_time, 'start_time');
        const end = parseTime(query.end_time, 'end_time');
        if (start !== undefined && end !== undefined && end - start > 7 * 86_400_000) {
          throw problem('range_too_large', 'max range for candles is 7 d');
        }
        return engine.candles({
          coin,
          interval: query.interval ? String(query.interval) : '1h',
          startTime: start, endTime: end,
          limit: parseLimit(query.limit, 200, 5000),
        });
      },
    }),
    endpoint({
      path: '/v1/markets/:coin/book', group: 'Markets (live)', scope: 'markets:read', base: 8, perRow: 0.4, maxLimit: 40,
      summary: 'Order book snapshot with 20 levels per side.',
      handler: ({ params, query }) => engine.book(requireMarket(params.coin).coin, parseLimit(query.limit, 20, 40)),
    }),
    endpoint({
      path: '/v1/markets/:coin/book/orders', group: 'Markets (live)', scope: 'analytics:read', base: 20, perRow: 0.01, maxLimit: 500,
      feature: 'l4', summary: 'Order-level (L4) book near the mid.',
      handler: ({ params, query }) => engine.bookOrders(requireMarket(params.coin).coin, parseLimit(query.limit, 100, 500)),
    }),
    endpoint({
      path: '/v1/markets/:coin/open-interest', group: 'Market history', scope: 'markets:read', base: 4, perRow: 0.01, maxLimit: 5000,
      summary: 'Open interest bars of one market.',
      handler: ({ params, query }) => engine.series({
        coin: requireMarket(params.coin).coin, metric: 'open_interest',
        interval: query.interval ? String(query.interval) : '1h',
        limit: parseLimit(query.limit, 200, 5000),
        startTime: parseTime(query.start_time, 'start_time'),
      }),
    }),
    endpoint({
      path: '/v1/markets/:coin/trade-bars', group: 'Market history', scope: 'markets:read', base: 4, perRow: 0.012, maxLimit: 5000,
      summary: 'Buy/sell volume and liquidation bars of one market.',
      handler: ({ params, query }) => engine.series({
        coin: requireMarket(params.coin).coin, metric: 'trade_bars',
        interval: query.interval ? String(query.interval) : '1h',
        limit: parseLimit(query.limit, 200, 5000),
        startTime: parseTime(query.start_time, 'start_time'),
      }),
    }),
    endpoint({
      path: '/v1/markets/:coin/funding-rates', group: 'Market history', scope: 'markets:read', base: 3, perRow: 0.008, maxLimit: 5000,
      summary: 'Realized funding rate history.',
      handler: ({ params, query }) => engine.series({
        coin: requireMarket(params.coin).coin, metric: 'funding',
        interval: query.interval ? String(query.interval) : '1h',
        limit: parseLimit(query.limit, 200, 5000),
        startTime: parseTime(query.start_time, 'start_time'),
      }),
    }),
    endpoint({
      path: '/v1/markets/:coin/cvd', group: 'Market structure', scope: 'markets:read', base: 5, perRow: 0.02, maxLimit: 2200, rowCap: 2200,
      summary: 'Cumulative volume delta of one market.',
      handler: ({ params, query }) => engine.series({
        coin: requireMarket(params.coin).coin, metric: 'cvd',
        interval: query.interval ? String(query.interval) : '1h',
        limit: parseLimit(query.limit, 200, 2200),
      }),
    }),
    endpoint({
      path: '/v1/markets/:coin/volatility', group: 'Exact market series', scope: 'markets:read', base: 4, perRow: 0.01, maxLimit: 2000,
      summary: 'Realized volatility of one market.',
      handler: ({ params, query }) => engine.series({
        coin: requireMarket(params.coin).coin, metric: 'volatility',
        interval: query.interval ? String(query.interval) : '1h',
        limit: parseLimit(query.limit, 200, 2000),
      }),
    }),
    endpoint({
      path: '/v1/markets/:coin/liquidation-levels', group: 'Market positions (live)', scope: 'markets:read', base: 30, perRow: 0.02, maxLimit: 100000,
      summary: 'Liquidation levels of one market, notional by price band.',
      handler: ({ params, query }) => {
        const coin = requireMarket(params.coin).coin;
        const context = engine.ctx(coin);
        const mark = Number(context.mark_px);
        const bands = Math.min(parseLimit(query.limit, 40, 100000), 80);
        const rows = [];
        for (let index = 0; index < bands; index += 1) {
          const side = index % 2 === 0 ? 'long' : 'short';
          const distance = 0.006 + Math.floor(index / 2) * 0.011;
          const px = mark * (side === 'long' ? 1 - distance : 1 + distance);
          const seed = Math.floor(engine.now() / 40_000);
          rows.push({
            coin, px: px.toFixed(6), side,
            distance_pct: Number((distance * 100).toFixed(2)),
            notional_usd: (1_800_000 + hash01(`${coin}:${index}:${seed}`) * 22_000_000).toFixed(2),
            accounts: Math.round(14 + hash01(`${coin}:a:${index}:${seed}`) * 320),
          });
        }
        return { data: rows, meta: { coin, as_of: engine.now(), computed_at: engine.now() } };
      },
    }),
    endpoint({
      path: '/v1/markets/:coin/positions', group: 'Market positions (live)', scope: 'markets:read', base: 12, perRow: 0.05, maxLimit: 1000,
      summary: 'Open positions of one market, largest first.',
      handler: ({ params, query }) => {
        const result = engine.largestPositions({ coin: requireMarket(params.coin).coin, limit: parseLimit(query.limit, 50, 1000) });
        return { ...result, meta: { ...result.meta, as_of: engine.now() } };
      },
    }),
    endpoint({
      path: '/v1/markets/:coin/liquidation-heatmap', group: 'Liquidation analytics', scope: 'markets:read', base: 26, perRow: 0, maxLimit: 6,
      summary: 'Liquidation-price heatmap of one market.',
      handler: ({ params, query }) => {
        const coin = requireMarket(params.coin).coin;
        const mark = Number(engine.ctx(coin).mark_px);
        const days = parseLimit(query.days, 7, 30);
        return {
          data: {
            coin, days, mark_px: mark.toFixed(6), bucket_pct: 0.5,
            bands: Array.from({ length: 24 }, (_, index) => {
              const distance = (index - 12) * 0.005;
              return {
                price: (mark * (1 + distance)).toFixed(6),
                distance_pct: Number((distance * 100).toFixed(2)),
                long_usd: (hash01(`${coin}:lh:${index}`) * 26_000_000).toFixed(2),
                short_usd: (hash01(`${coin}:ls:${index}`) * 26_000_000).toFixed(2),
              };
            }),
          },
          meta: { computed_at: engine.now() },
        };
      },
    }),
    endpoint({
      path: '/v1/spot/markets', group: 'Markets (live)', scope: 'markets:read', base: 4, perRow: 0.05, maxLimit: 5000,
      summary: 'Spot markets with live context.',
      handler: () => ({
        data: engine.markets.filter((m) => m.dex === 'core').slice(0, 16).map((config) => ({
          ...engine.marketRow(config.coin),
          name: `@${100 + (config.seed % 900)}`,
          base_token: config.coin,
          quote_token: 'USDC',
        })),
        meta: { count: 16, kind: 'spot' },
      }),
    }),
    endpoint({
      path: '/v1/dexs', group: 'Markets (live)', scope: 'markets:read', base: 2, perRow: 0.05, maxLimit: 1000,
      summary: 'HIP-3 builder dexs.',
      handler: () => ({
        data: [
          { dex: 'xyz', name: 'trade.xyz', markets: engine.markets.filter((m) => m.dex === 'xyz').length, deployer: '0x7a3f9c1e5b2d846a0c7e4f19b6d2a8305c1e7b94' },
        ],
        meta: { count: 1 },
      }),
    }),
    /* ---------------------------- accounts --------------------------- */
    endpoint({
      path: '/v1/accounts/:address', group: 'Account state (live)', scope: 'accounts:read', base: 2, perRow: 0.6, maxLimit: 1, rowCap: 1,
      summary: 'Margin summary and equity of one wallet.',
      handler: ({ params }) => {
        const wallet = engine.findWallet(params.address);
        return {
          data: {
            address: wallet.address, name: wallet.name,
            account_value: wallet.account_value, withdrawable: wallet.withdrawable,
            margin_used: wallet.margin_used, total_notional: wallet.total_notional,
            unrealized_pnl: wallet.unrealized_pnl, realized_pnl: wallet.realized_pnl,
            open_orders: wallet.open_order_count, fee_tier: wallet.fee_tier,
          },
          meta: { as_of: engine.now() },
        };
      },
    }),
    endpoint({
      path: '/v1/accounts/:address/positions', group: 'Account state (live)', scope: 'accounts:read', base: 3, perRow: 0.8, maxLimit: 500, rowCap: 500,
      summary: 'Open positions and margin of one wallet.',
      handler: ({ params }) => {
        const wallet = engine.findWallet(params.address);
        return { data: wallet.positions, meta: { address: wallet.address, as_of: engine.now(), account_value: wallet.account_value } };
      },
    }),
    endpoint({
      path: '/v1/accounts/:address/fills', group: 'Account fills', scope: 'accounts:read', base: 5, perRow: 0.004, maxLimit: 1000,
      summary: 'Every fill of one wallet.',
      handler: ({ params, query }) => {
        const start = parseTime(query.start_time, 'start_time');
        const end = parseTime(query.end_time, 'end_time');
        if (start !== undefined && end !== undefined && end - start > 7 * 86_400_000) {
          throw problem('range_too_large', 'max range for fills is 7 d');
        }
        return engine.walletFills({
          address: params.address, startTime: start, endTime: end,
          limit: parseLimit(query.limit, 100, 1000),
        });
      },
    }),
    endpoint({
      path: '/v1/accounts/:address/pnl-chart', group: 'Account value history', scope: 'accounts:read', base: 4, perRow: 0.02, maxLimit: 1000,
      summary: 'Cumulative PnL chart of one wallet.',
      handler: ({ params, query }) => engine.pnlChart(params.address, parseLimit(query.days, 30, 365)),
    }),
    endpoint({
      path: '/v1/accounts/:address/open-orders', group: 'Account state (live)', scope: 'accounts:read', base: 6, perRow: 0.2, maxLimit: 2000, rowCap: 2000,
      summary: 'Open orders of one wallet, including TP/SL triggers.',
      handler: ({ params }) => {
        const wallet = engine.findWallet(params.address);
        const rows = Array.from({ length: Math.min(wallet.open_order_count, 12) }, (_, index) => {
          const position = wallet.positions[index % wallet.positions.length];
          const config = engine.requireMarket(position.coin);
          const px = Number(position.entry_px) * (1 + (index % 2 ? 0.012 : -0.012));
          return {
            oid: 100_000_000 + (Number(wallet.address.slice(2, 10)) % 800_000_000) + index,
            coin: position.coin,
            side: index % 2 ? 'A' : 'B',
            px: px.toFixed(config.pxDecimals),
            sz: (Number(position.notional_usd) / px / 9).toFixed(config.szDecimals),
            order_type: index % 4 === 3 ? { trigger: { is_market: true, trigger_px: px.toFixed(config.pxDecimals), tpsl: 'tp' } } : { limit: { tif: 'Gtc' } },
            reduce_only: index % 3 === 0,
            timestamp: engine.now() - index * 240_000,
          };
        });
        return { data: rows, meta: { address: wallet.address, as_of: engine.now() } };
      },
    }),
    endpoint({
      path: '/v1/accounts/:address/portfolio', group: 'Account state (live)', scope: 'accounts:read', base: 5, perRow: 0.1, maxLimit: 1000,
      summary: 'Consistent perp + spot portfolio of one wallet.',
      handler: ({ params }) => {
        const wallet = engine.findWallet(params.address);
        return {
          data: {
            address: wallet.address,
            perp: { account_value: wallet.account_value, margin_used: wallet.margin_used, unrealized_pnl: wallet.unrealized_pnl, positions: wallet.positions.length },
            spot: [
              { coin: 'USDC', total: (Number(wallet.withdrawable) * 0.9).toFixed(2), hold: '0.00' },
              { coin: 'HYPE', total: (Number(wallet.account_value) * 0.001).toFixed(3), hold: '0.00' },
            ],
            total_value: (Number(wallet.account_value) + Number(wallet.withdrawable) * 0.9).toFixed(2),
          },
          meta: { as_of: engine.now() },
        };
      },
    }),
    endpoint({
      path: '/v1/accounts/:address/ledger', group: 'Account history', scope: 'accounts:read', base: 4, perRow: 0.003, maxLimit: 2000,
      summary: 'Non-funding ledger updates of one wallet.',
      handler: ({ params, query }) => {
        const wallet = engine.findWallet(params.address);
        const limit = parseLimit(query.limit, 50, 2000);
        const rows = Array.from({ length: limit }, (_, index) => ({
          t: engine.now() - index * 5.7 * 3_600_000,
          address: wallet.address,
          type: ['deposit', 'withdraw', 'internalTransfer', 'spotTransfer', 'vaultDeposit', 'accountClassTransfer'][index % 6],
          amount_usd: ((hash01(`${wallet.address}:${index}`) - 0.35) * 184_000).toFixed(2),
          tx_hash: `0x${(hash01(`${wallet.address}:tx:${index}`) * 1e16).toString(16).slice(0, 16)}`,
        }));
        return { data: rows, meta: { address: wallet.address } };
      },
    }),
    endpoint({
      path: '/v1/accounts/:address/stats', group: 'Wallet analytics', scope: 'analytics:read', base: 8, perRow: 0, maxLimit: 1, rowCap: 1,
      summary: 'Trading statistics of one wallet.',
      handler: ({ params }) => {
        const wallet = engine.findWallet(params.address);
        const seed = hash01(`${wallet.address}:stats`);
        return {
          data: {
            address: wallet.address,
            trades: Math.round(400 + seed * 14_000),
            win_rate: Number((0.38 + seed * 0.32).toFixed(4)),
            avg_win_usd: (260 + seed * 5_400).toFixed(2),
            avg_loss_usd: (-(180 + seed * 4_100)).toFixed(2),
            profit_factor: Number((0.8 + seed * 2.4).toFixed(2)),
            sharpe: Number((0.4 + seed * 3.1).toFixed(2)),
            sortino: Number((0.6 + seed * 4.2).toFixed(2)),
            max_drawdown_pct: Number((-(4 + seed * 32)).toFixed(2)),
            volume_usd: (Number(wallet.account_value) * 140).toFixed(2),
            fees_usd: (Number(wallet.account_value) * 0.31).toFixed(2),
            best_trade_usd: (Number(wallet.account_value) * 0.42).toFixed(2),
            worst_trade_usd: (-(Number(wallet.account_value) * 0.19)).toFixed(2),
          },
          meta: { windows: ['24h', '7d', '30d', '90d', 'ytd', 'all'] },
        };
      },
    }),
    endpoint({
      path: '/v1/accounts/:address/pnl-calendar', group: 'Wallet analytics', scope: 'analytics:read', base: 4, perRow: 0.06, maxLimit: 400, rowCap: 400,
      summary: 'Daily PnL calendar of one wallet.',
      handler: ({ params, query }) => {
        const wallet = engine.findWallet(params.address);
        const days = Math.min(parseLimit(query.days, 120, 400), 400);
        const rows = Array.from({ length: days }, (_, index) => {
          const t = Math.floor(engine.now() / 86_400_000) * 86_400_000 - index * 86_400_000;
          return {
            date: new Date(t).toISOString().slice(0, 10),
            pnl_usd: ((hash01(`${wallet.address}:cal:${index}`) - 0.44) * Number(wallet.account_value) * 0.045).toFixed(2),
            trades: Math.round(4 + hash01(`${wallet.address}:caln:${index}`) * 90),
            volume_usd: (Number(wallet.account_value) * hash01(`${wallet.address}:calv:${index}`) * 9).toFixed(2),
          };
        });
        return { data: rows, meta: { address: wallet.address } };
      },
    }),
    endpoint({
      path: '/v1/accounts/batch', group: 'Account state (live)', scope: 'accounts:read', base: 6, perRow: 0.8, maxLimit: 25, rowCap: 25,
      summary: 'Account summaries of up to 25 wallets.',
      handler: ({ query }) => {
        const raw = String(query.addresses ?? query.address ?? '').split(',').map((value) => value.trim()).filter(Boolean);
        if (!raw.length) throw problem('invalid_parameter', 'addresses must name at least one wallet');
        if (raw.length > 25) throw problem('invalid_parameter', 'GET /v1/accounts/batch takes at most 25 wallets; use POST');
        const rows = raw.map((address) => {
          const wallet = engine.findWallet(address);
          return {
            address: wallet.address, name: wallet.name,
            account_value: wallet.account_value, unrealized_pnl: wallet.unrealized_pnl,
            positions: wallet.positions.length,
          };
        });
        return { data: rows, meta: { count: rows.length } };
      },
    }),
    /* -------------------------- liquidations ------------------------- */
    endpoint({
      path: '/v1/liquidations', group: 'Liquidations', scope: 'liquidations:read', base: 5, perRow: 0.003, maxLimit: 2000,
      summary: 'Every liquidation with wallet, side, price, notional and realized PnL.',
      handler: ({ query }) => {
        const start = parseTime(query.start_time, 'start_time');
        const end = parseTime(query.end_time, 'end_time');
        if (start !== undefined && end !== undefined && end - start > 7 * 86_400_000) {
          throw problem('range_too_large', 'max range for liquidations is 7 d');
        }
        return engine.liquidations({
          coin: query.coin ? engine.requireMarket(String(query.coin)).coin : null,
          startTime: start, endTime: end,
          limit: parseLimit(query.limit, 100, 2000),
        });
      },
    }),
    endpoint({
      path: '/v1/liquidations/series', group: 'Exact market series', scope: 'markets:read', base: 4, perRow: 0.012, maxLimit: 6000,
      summary: 'Exact liquidations per bucket and side.',
      handler: ({ query }) => engine.liquidationsSeries({
        bucket: query.bucket ? String(query.bucket) : '1h',
        startTime: parseTime(query.start_time, 'start_time'),
        endTime: parseTime(query.end_time, 'end_time'),
        limit: parseLimit(query.limit, 168, 6000),
      }),
    }),
    endpoint({
      path: '/v1/liquidations/top', group: 'Wallet lists', scope: 'analytics:read', base: 14, perRow: 0.08, maxLimit: 100,
      summary: 'Largest liquidations.',
      handler: ({ query }) => {
        const limit = parseLimit(query.limit, 25, 100);
        return {
          data: engine.liquidations({ limit: limit * 6 }).data
            .sort((a, b) => Number(b.notional_usd) - Number(a.notional_usd))
            .slice(0, limit),
          meta: { count: limit },
        };
      },
    }),
    endpoint({
      path: '/v1/positions/largest', group: 'Wallet lists', scope: 'analytics:read', base: 14, perRow: 0.08, maxLimit: 100,
      summary: 'Largest open positions.',
      handler: ({ query }) => engine.largestPositions({ limit: parseLimit(query.limit, 25, 100), coin: query.coin ? String(query.coin) : null }),
    }),
    endpoint({
      path: '/v1/positions/near-liquidation', group: 'Wallet lists', scope: 'analytics:read', base: 14, perRow: 0.08, maxLimit: 100,
      summary: 'Positions closest to liquidation.',
      handler: ({ query }) => engine.nearLiquidation({ limit: parseLimit(query.limit, 25, 100) }),
    }),
    /* --------------------------- analytics --------------------------- */
    endpoint({
      path: '/v1/leaderboards/pnl', group: 'Analytics', scope: 'analytics:read', base: 8, perRow: 0.04, maxLimit: 500,
      summary: 'PnL leaderboard with net, realized and unrealized PnL and ROI.',
      handler: ({ query }) => engine.leaderboard({
        window: query.window ? String(query.window) : '7d',
        sort: query.sort ? String(query.sort) : 'pnl',
        limit: parseLimit(query.limit, 50, 500),
      }),
    }),
    endpoint({
      path: '/v1/cohorts/consensus', group: 'Cohorts and positioning', scope: 'analytics:read', base: 10, perRow: 0.05, maxLimit: 500, rowCap: 500,
      summary: 'Top-trader consensus per market.',
      handler: ({ query }) => engine.consensus({ limit: parseLimit(query.limit, 25, 500) }),
    }),
    endpoint({
      path: '/v1/cohorts/positioning', group: 'Cohorts and positioning', scope: 'analytics:read', base: 10, perRow: 0.006, maxLimit: 20000,
      summary: 'Hourly positioning by trader cohort.',
      handler: ({ query }) => engine.positioning({
        limit: parseLimit(query.limit, 48, 20000),
        interval: query.interval ? String(query.interval) : '1h',
        startTime: parseTime(query.start_time, 'start_time'),
      }),
    }),
    endpoint({
      path: '/v1/markets/positioning', group: 'Analytics', scope: 'analytics:read', base: 6, perRow: 0.006, maxLimit: 5000,
      summary: 'Long/short positioning history, exchange-wide.',
      handler: ({ query }) => engine.positioning({ limit: parseLimit(query.limit, 48, 5000) }),
    }),
    endpoint({
      path: '/v1/markets/open-interest/changes', group: 'Market structure', scope: 'markets:read', base: 5, perRow: 0.02, maxLimit: 2000, rowCap: 2000,
      summary: 'Open interest changes for every market.',
      handler: ({ query }) => engine.openInterestChanges({ limit: parseLimit(query.limit, 20, 2000) }),
    }),
    endpoint({
      path: '/v1/markets/funding/latest', group: 'Market structure', scope: 'markets:read', base: 4, perRow: 0.04, maxLimit: 100,
      summary: 'Funding screener.',
      handler: ({ query }) => engine.fundingLatest({ limit: parseLimit(query.limit, 20, 100) }),
    }),
    endpoint({
      path: '/v1/markets/price-changes', group: 'Market structure', scope: 'markets:read', base: 4, perRow: 0.03, maxLimit: 2000, rowCap: 2000,
      summary: 'Price changes for every market.',
      handler: () => ({
        data: engine.markets.map((config) => ({
          coin: config.coin,
          change_1h_pct: Number(engine.changePercent(config.coin, 3_600_000).toFixed(2)),
          change_24h_pct: Number(engine.changePercent(config.coin, 86_400_000).toFixed(2)),
          change_7d_pct: Number(engine.changePercent(config.coin, 7 * 86_400_000).toFixed(2)),
          change_30d_pct: Number(engine.changePercent(config.coin, 30 * 86_400_000).toFixed(2)),
        })),
        meta: { count: engine.markets.length },
      }),
    }),
    endpoint({
      path: '/v1/network/revenue', group: 'Exchange and ecosystem', scope: 'analytics:read', base: 6, perRow: 0.02, maxLimit: 2700,
      summary: 'Trading-fee revenue, volume and active traders.',
      handler: ({ query }) => engine.revenue({ days: parseLimit(query.days, 30, 365) }),
    }),
    endpoint({
      path: '/v1/network/active-traders', group: 'Exact market series', scope: 'markets:read', base: 4, perRow: 0.01, maxLimit: 2000,
      summary: 'Exact active traders over time.',
      handler: ({ query }) => {
        const limit = parseLimit(query.limit, 60, 2000);
        return {
          data: engine.revenue({ days: limit }).data.map((row) => ({ t: row.t, active_traders: row.active_traders })),
          meta: { interval: '1d' },
        };
      },
    }),
    endpoint({
      path: '/v1/traders/screener', group: 'Traders', scope: 'analytics:read', base: 12, perRow: 0.03, maxLimit: 1000,
      summary: 'Trader screener with PnL windows, win rates, Sharpe and copy scores.',
      handler: ({ query }) => {
        const limit = parseLimit(query.limit, 25, 1000);
        return {
          data: Array.from({ length: limit }, (_, index) => {
            const wallet = engine.walletSummary(index * 3 + 5);
            return {
              address: wallet.address, name: wallet.name,
              pnl_24h: (Number(wallet.net_pnl) / 30).toFixed(2),
              pnl_7d: wallet.net_pnl, pnl_30d: (Number(wallet.net_pnl) * 3.4).toFixed(2),
              win_rate: Number((0.34 + hash01(`${wallet.address}:wr`) * 0.36).toFixed(4)),
              sharpe: Number((0.2 + hash01(`${wallet.address}:sh`) * 3.4).toFixed(2)),
              max_drawdown_pct: Number((-(3 + hash01(`${wallet.address}:dd`) * 28)).toFixed(2)),
              copy_score: Math.round(20 + hash01(`${wallet.address}:cs`) * 79),
              account_value: wallet.account_value,
            };
          }),
          meta: { sort: query.sort ?? 'pnl_7d' },
        };
      },
    }),
    endpoint({
      path: '/v1/accounts/batch/stats', group: 'Wallet analytics', scope: 'analytics:read', base: 8, perRow: 0.1, maxLimit: 100,
      summary: 'Trader stats of up to 100 wallets.',
      handler: () => ({
        data: Array.from({ length: 10 }, (_, index) => {
          const wallet = engine.walletSummary(index + 40);
          return {
            address: wallet.address, name: wallet.name,
            account_value: wallet.account_value, roi: wallet.roi,
            trades: Math.round(400 + hash01(`${wallet.address}:n`) * 9_000),
            win_rate: Number((0.4 + hash01(`${wallet.address}:w`) * 0.28).toFixed(4)),
          };
        }),
        meta: { count: 10 },
      }),
    }),
    /* ------------------------- platform meta ------------------------- */
    endpoint({
      path: '/v1/datasets', group: 'Platform', scope: null, base: 0, perRow: 0, maxLimit: 1,
      summary: 'Public catalog of datasets with freshness and coverage.',
      handler: () => engine.datasets(),
    }),
    endpoint({
      path: '/v1/status', group: 'Platform', scope: null, base: 0, perRow: 0, maxLimit: 1,
      summary: 'Public status, component health and data frontiers.',
      handler: () => ({ data: engine.status() }),
    }),
    endpoint({
      path: '/v1/changelog', group: 'Platform', scope: null, base: 0, perRow: 0, maxLimit: 1,
      summary: 'Public API changelog.',
      handler: () => engine.changelog(),
    }),
    endpoint({
      path: '/v1/me', group: 'Platform', scope: null, needsKey: true, base: 0, perRow: 0, maxLimit: 1,
      summary: 'The calling key, its project, the workspace plan and remaining credits.',
      handler: ({ auth }) => ({
        data: {
          key_id: auth.key.id,
          key_prefix: auth.key.prefix,
          project: auth.project,
          workspace: auth.workspace,
          plan: auth.plan.id,
          scopes: auth.key.scopes,
          limits: {
            requests_per_second: auth.plan.rps,
            burst: auth.plan.burst,
            concurrent_requests: auth.plan.concurrency,
            stream_connections: auth.plan.streamConnections,
            history_days: auth.plan.historyDays,
          },
          credits: auth.credits,
        },
      }),
    }),
    endpoint({
      path: '/v1/quote', group: 'Platform', scope: null, base: 0, perRow: 0, maxLimit: 1,
      summary: 'Maximum cost of a request without running it. Free.',
      handler: ({ query, api }) => {
        const route = String(query.route ?? '');
        if (!route) throw problem('invalid_parameter', 'route is required, for example "GET /v1/markets/BTC/candles?limit=24"');
        const [method, target] = route.split(/\s+/);
        const url = new URL(target, 'https://data.hyperdash.com');
        const matched = api.matchRoute(method || 'GET', url.pathname);
        if (!matched) throw problem('not_found', `unknown route: ${route}`);
        const limit = parseLimit(
          url.searchParams.get('limit'),
          Math.min(matched.endpoint.maxLimit ?? 100, 100),
          matched.endpoint.maxLimit,
        );
        const rows = matched.endpoint.rowCap ?? limit;
        return {
          data: {
            route: `${matched.endpoint.method} ${url.pathname}`,
            max_credits: api.estimateCredits(matched.endpoint, rows),
            price_version: 1,
            rows_priced: rows,
          },
        };
      },
    }),
  ];
}

function hash01(text) {
  let h = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    h ^= text.charCodeAt(index);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d) >>> 0;
  h ^= h >>> 15;
  return (h >>> 0) / 4_294_967_296;
}

/* --------------------------------------------------------------------------
   API factory
   -------------------------------------------------------------------------- */

export function createMemoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); },
  };
}

export function browserStorage() {
  try {
    const testKey = '__hd_probe__';
    globalThis.localStorage.setItem(testKey, '1');
    globalThis.localStorage.removeItem(testKey);
    return globalThis.localStorage;
  } catch {
    return createMemoryStorage();
  }
}

export function createDataApi({ engine, now = () => Date.now(), storage = null, latency = true } = {}) {
  if (!engine) throw new TypeError('createDataApi requires a market engine');
  const state = {
    plan: 'starter',
    billing: 'monthly',
    keys: [],
    usage: [],
    project: 'production',
    workspace: 'acme-quant',
    used: 148_920,
    topup: 0,
    reserved: 0,
    buckets: new Map(),
    requestSeq: 0,
    storage,
    extraCredits: 0,
  };

  const storageKey = 'hyperdash:console:v1';
  if (storage) {
    try {
      const saved = JSON.parse(storage.getItem(storageKey) ?? 'null');
      if (saved && typeof saved === 'object') {
        if (PLANS[saved.plan]) state.plan = saved.plan;
        if (saved.billing === 'yearly' || saved.billing === 'monthly') state.billing = saved.billing;
        if (Array.isArray(saved.keys)) state.keys = saved.keys.slice(0, 20);
        if (Array.isArray(saved.usage)) state.usage = saved.usage.slice(0, 50);
        if (Number.isFinite(saved.used)) state.used = saved.used;
        if (Number.isFinite(saved.topup)) state.topup = saved.topup;
      }
    } catch { /* corrupt storage falls back to defaults */ }
  }

  function persist() {
    if (!state.storage) return;
    try {
      state.storage.setItem(storageKey, JSON.stringify({
        plan: state.plan, billing: state.billing, keys: state.keys, usage: state.usage.slice(0, 50),
        used: state.used, topup: state.topup,
      }));
    } catch { /* quota errors are non-fatal */ }
  }

  const endpoints = endpointList(engine);

  const routingOrder = [...endpoints].sort((a, b) =>
    a.segments.filter((part) => part.startsWith(':')).length - b.segments.filter((part) => part.startsWith(':')).length);

  function matchRoute(method, pathname) {
    const parts = pathname.split('/').filter(Boolean);
    for (const item of routingOrder) {
      if (item.method !== method.toUpperCase()) continue;
      if (item.segments.length !== parts.length) continue;
      const params = {};
      let matched = true;
      for (let index = 0; index < parts.length; index += 1) {
        const pattern = item.segments[index];
        if (pattern.startsWith(':')) params[pattern.slice(1)] = decodeURIComponent(parts[index]);
        else if (pattern !== parts[index]) { matched = false; break; }
      }
      if (matched) return { endpoint: item, params };
    }
    return null;
  }

  function plan() {
    return PLANS[state.plan];
  }

  function creditsSnapshot() {
    const current = plan();
    const included = current.credits ?? 0;
    const remaining = Math.max(0, included - state.used) + state.topup;
    return {
      included, used: state.used, reserved: state.reserved,
      topup_balance: state.topup, remaining,
      low: included > 0 ? (included - state.used) / included < 0.1 : false,
    };
  }

  function issueKey({ name = 'Default key', scopes = SCOPES.filter((scope) => scope !== 'usage:read'), expiresInDays = 90 } = {}) {
    if (!plan()) throw problem('plan_required', 'Choose a plan before creating a key');
    const random = globalThis.crypto?.getRandomValues
      ? Array.from(globalThis.crypto.getRandomValues(new Uint8Array(18)), (byte) => byte.toString(36).padStart(2, '0')).join('').slice(0, 32)
      : `${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`.slice(0, 32);
    const secret = `hdk_sk_${random}`;
    const key = {
      id: `key_${(++state.requestSeq).toString(36)}${Date.now().toString(36).slice(-4)}`,
      name,
      prefix: `hdk_sk_${random.slice(0, 4)}…${random.slice(-4)}`,
      secret,
      scopes: [...new Set([...scopes, 'usage:read'])],
      createdAt: now(),
      expiresAt: expiresInDays ? now() + expiresInDays * 86_400_000 : null,
      lastUsedAt: null,
      revokedAt: null,
      calls: 0,
      credits: 0,
    };
    state.keys.unshift(key);
    persist();
    return { ...key };
  }

  function revokeKey(id) {
    const key = state.keys.find((entry) => entry.id === id);
    if (!key) throw problem('not_found', 'Unknown key');
    key.revokedAt = now();
    persist();
    return { ...key };
  }

  function setPlan(id) {
    if (!PLANS[id]) throw problem('invalid_parameter', 'Unknown plan');
    state.plan = id;
    state.used = Math.min(state.used, PLANS[id].credits ?? state.used);
    state.buckets.clear();
    persist();
    return plan();
  }

  function setBilling(period) {
    if (period !== 'monthly' && period !== 'yearly') throw problem('invalid_parameter', 'billing must be monthly or yearly');
    state.billing = period;
    persist();
    return state.billing;
  }

  function authenticate(headers = {}) {
    const raw = headers.authorization ?? headers.Authorization ?? '';
    const token = String(raw).replace(/^Bearer\s+/i, '').trim();
    if (!token) throw problem('invalid_key', 'Missing Authorization: Bearer <key>');
    if (!/^hdk_sk_[a-z0-9]+$/.test(token)) throw problem('invalid_key', 'The key is malformed');
    const key = state.keys.find((entry) => entry.secret === token);
    if (!key) {
      const revoked = state.keys.find((entry) => entry.prefix.startsWith(token.slice(0, 11)) && entry.revokedAt);
      if (revoked) throw problem('revoked_key', 'This key was revoked. Create a new one in the console.');
      throw problem('invalid_key', 'Unknown key for this workspace');
    }
    if (key.revokedAt) throw problem('revoked_key', 'This key was revoked. Create a new one in the console.');
    if (key.expiresAt && key.expiresAt < now()) throw problem('expired_key', 'This key has expired. Create a new one in the console.');
    const current = plan();
    return {
      key,
      plan: current,
      project: state.project,
      workspace: state.workspace,
      credits: creditsSnapshot(),
    };
  }

  function validateKey(headers = {}) {
    return authenticate(headers);
  }

  function requireScope(auth, scope) {
    if (!scope) return;
    if (!auth.key.scopes.includes(scope)) {
      throw problem('insufficient_scope', `This key needs the ${scope} scope`, { required_scope: scope });
    }
  }

  function bucketFor(keyId, current) {
    let bucket = state.buckets.get(keyId);
    if (!bucket) {
      bucket = { tokens: current.burst, updatedAt: now(), inFlight: 0 };
      state.buckets.set(keyId, bucket);
    }
    const elapsed = Math.max(0, (now() - bucket.updatedAt) / 1_000);
    bucket.tokens = Math.min(current.burst, bucket.tokens + elapsed * current.rps);
    bucket.updatedAt = now();
    return bucket;
  }

  function estimateCredits(item, rows) {
    const charged = Math.max(0, rows);
    const multiplier = item.path.endsWith('/candles') ? (charged > 1_000 ? 2 : 1) : 1;
    if (item.base === 0) return 0;
    return Math.max(1, Math.ceil(multiplier * (item.base + charged * item.perRow)));
  }

  function uuid7ish() {
    const stamp = now().toString(16).padStart(12, '0');
    const random = Array.from({ length: 20 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
    return `${stamp.slice(0, 8)}-${stamp.slice(8, 12)}-7${random.slice(0, 3)}-${random.slice(3, 7)}-${random.slice(7, 19)}`;
  }

  function parseQuery(pathname, search) {
    const params = new URLSearchParams(search ?? '');
    const query = {};
    for (const [key, value] of params.entries()) query[key] = value;
    return query;
  }

  function serializeRows(rows, format) {
    if (format === 'csv') {
      if (!rows.length) return '';
      const flatten = (row, prefix = '') => Object.entries(row).flatMap(([key, value]) => {
        const name = prefix ? `${prefix}.${key}` : key;
        if (value && typeof value === 'object' && !Array.isArray(value)) return flatten(value, name);
        return [[name, Array.isArray(value) ? JSON.stringify(value) : value]];
      });
      const first = flatten(rows[0]).map(([key]) => key);
      const escape = (value) => {
        const text = value === null || value === undefined ? '' : String(value);
        return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
      };
      return [first.join(','), ...rows.map((row) => {
        const map = Object.fromEntries(flatten(row));
        return first.map((key) => escape(map[key])).join(',');
      })].join('\n');
    }
    if (format === 'ndjson') return rows.map((row) => JSON.stringify(row)).join('\n');
    return null;
  }

  /**
   * Execute a request against the documented API contract.
   * @returns {Promise<object>} response envelope with status, headers and body.
   */
  async function request({ method = 'GET', path, query = {}, headers = {}, body = null, raw = false, delay = latency } = {}) {
    const started = now();
    state.requestSeq += 1;
    const requestId = uuid7ish();
    const url = new URL(path, 'https://data.hyperdash.com');
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    });
    const matched = matchRoute(method.toUpperCase(), url.pathname);
    const respond = (payload) => (delay ? new Promise((resolve) => setTimeout(() => resolve(payload), 24 + Math.random() * 90)) : Promise.resolve(payload));
    const finish = (status, responseHeaders, responseBody, extra = {}) => {
      const envelope = {
        requestId, status, headers: responseHeaders, body: responseBody,
        durationMs: Math.max(1, Math.round(now() - started)), ...extra,
      };
      if (status < 400 && matched) {
        const exhausted = creditsSnapshot().remaining <= 0;
        if (exhausted) envelope.headers['x-credits-low'] = 'true';
      }
      return envelope;
    };
    const fail = (error) => {
      const code = error.code ?? 'invalid_parameter';
      const status = error.status ?? (code === 'not_found' ? 404 : 400);
      const payload = {
        type: `https://data.hyperdash.com/errors/${code}`,
        title: error.title ?? PROBLEM_TITLES[code] ?? 'Error',
        status,
        code,
        detail: error.message,
        ...(error.hint ? { hint: error.hint } : {}),
        request_id: requestId,
      };
      if (code === 'rate_limited' || code === 'extraction_limit') payload.retry_after_s = 1;
      const responseHeaders = {
        'content-type': 'application/problem+json',
        'x-request-id': requestId,
        'x-credits-charged': '0',
        'x-problem-code': code,
        'cache-control': 'private, no-store',
      };
      if (payload.retry_after_s) responseHeaders['retry-after'] = String(payload.retry_after_s);
      state.usage.unshift({
        at: now(), id: requestId, method: method.toUpperCase(), path: url.pathname + url.search,
        status, credits: 0, ms: 0, code,
      });
      state.usage = state.usage.slice(0, 50);
      persist();
      return respond(finish(status, responseHeaders, payload, { error: code, credits: 0 }));
    };

    try {
      if (!matched) {
        throw problem('not_found', `Unknown route: ${method.toUpperCase()} ${url.pathname}`, {
          hint: 'Spell a market exactly as GET /v1/markets lists it, for example BTC, xyz:TSLA or @107.',
        });
      }
      const publicRoute = matched.endpoint.scope === null && !matched.endpoint.needsKey;
      let auth = null;
      if (!publicRoute) {
        auth = authenticate(headers);
        requireScope(auth, matched.endpoint.scope);
        const current = auth.plan;
        if (matched.endpoint.feature && !current.features[matched.endpoint.feature]) {
          throw problem('feature_not_in_plan', `${matched.endpoint.path} needs the ${matched.endpoint.feature} feature (Growth and up)`, {
            hint: 'Upgrade to Growth to use this endpoint.',
          });
        }
        const bucket = bucketFor(auth.key.id, current);
        if (bucket.tokens < 1) {
          throw problem('rate_limited', `Too many requests for this workspace: ${current.rps} per second with a burst of ${current.burst}`, { retry_after_s: 1 });
        }
        const limit = parseLimit(
          url.searchParams.get('limit'),
          Math.min(matched.endpoint.maxLimit ?? 100, 100),
          matched.endpoint.maxLimit,
        );
        const slots = Math.ceil(limit / 1_000) || 1;
        if (bucket.inFlight + slots > current.concurrency) {
          throw problem('rate_limited', `Too many concurrent requests for this workspace: this request counts as ${slots} of your ${current.concurrency}`);
        }
        if (current.historyDays) {
          const start = url.searchParams.get('start_time');
          if (start && Number(start) < now() - current.historyDays * 86_400_000) {
            throw problem('history_limit', `Your ${current.name} plan includes the last ${current.historyDays} days of history`, {
              hint: 'Send a start_time inside your plan’s history depth, or upgrade.',
            });
          }
        }
        bucket.tokens -= 1;
        bucket.inFlight += slots;
        try {
          const maxCredits = headers['x-max-credits'] ?? headers['X-Max-Credits'];
          if (maxCredits !== undefined) {
            const max = Number(maxCredits);
            const ceiling = matched.endpoint.rowCap ?? limit;
            const worst = estimateCredits(matched.endpoint, ceiling);
            if (!Number.isFinite(max) || worst > max) {
              throw problem('max_credits_exceeded', `This request could cost ${worst} credits, above X-Max-Credits: ${max}`);
            }
          }
          const reservation = estimateCredits(matched.endpoint, matched.endpoint.rowCap ?? limit);
          if (creditsSnapshot().remaining < reservation) {
            throw problem('credits_exhausted', `Reserving ${reservation} credits needs more than the ${creditsSnapshot().remaining} remaining`, {
              hint: 'Buy credits on the Billing page in the console, or upgrade.',
            });
          }
          const context = { params: matched.params, query: parseQuery(url.pathname, url.search), api: { matchRoute, estimateCredits } };
          // Copy so the handler cannot mutate the auth snapshot.
          const result = await matched.endpoint.handler({ ...context, auth: { ...auth, credits: creditsSnapshot() } });
          const rows = Array.isArray(result.data) ? result.data.length : result.data ? 1 : 0;
          const charged = estimateCredits(matched.endpoint, rows);
          state.used += charged;
          auth.key.calls += 1;
          auth.key.credits += charged;
          auth.key.lastUsedAt = now();
          const accept = String(headers.accept ?? 'application/json').toLowerCase();
          const format = accept.includes('text/csv') ? 'csv' : accept.includes('ndjson') || accept.includes('jsonl') ? 'ndjson' : 'json';
          const serialized = Array.isArray(result.data) ? serializeRows(result.data, format) : null;
          const bodyOut = serialized !== null
            ? serialized
            : { ...result, meta: { ...(result.meta ?? {}), as_of: result.meta?.as_of ?? now() } };
          const remaining = creditsSnapshot();
          const responseHeaders = {
            'content-type': serialized !== null ? (format === 'csv' ? 'text/csv; charset=utf-8' : 'application/x-ndjson') : 'application/json; charset=utf-8',
            'x-request-id': requestId,
            'x-credits-charged': String(charged),
            'x-credit-price-version': '1',
            'ratelimit-policy': `${current.burst};w=2`,
            'cache-control': 'private, no-store',
            'x-as-of': String(now()),
            ...(remaining.low ? { 'x-credits-low': 'true' } : {}),
            ...(serialized !== null ? { 'x-has-more': 'false', 'x-next-cursor': '' } : {}),
          };
          state.usage.unshift({
            at: now(), id: requestId, method: matched.endpoint.method, path: url.pathname + url.search,
            status: 200, credits: charged, ms: Math.max(1, Math.round(now() - started)),
          });
          state.usage = state.usage.slice(0, 50);
          persist();
          return respond(finish(200, responseHeaders, bodyOut, {
            credits: charged, rows, format, used: state.used, remaining: remaining.remaining,
            raw: serialized ?? JSON.stringify(bodyOut, null, 2), endpoint: matched.endpoint,
          }));
        } finally {
          const bucketAfter = state.buckets.get(auth.key.id);
          if (bucketAfter) bucketAfter.inFlight = Math.max(0, bucketAfter.inFlight - slots);
        }
      }

      if (matched.endpoint.needsKey) {
        // Free but authenticated: /v1/me reports the calling key and its credits.
        const keyAuth = validateKey(headers);
        const bodyOut = await matched.endpoint.handler({
          params: matched.params, query: parseQuery(url.pathname, url.search),
          auth: { ...keyAuth, credits: creditsSnapshot() }, api: { matchRoute, estimateCredits },
        });
        return respond(finish(200, {
          'content-type': 'application/json; charset=utf-8', 'x-request-id': requestId, 'x-credits-charged': '0',
          'cache-control': 'private, no-store',
        }, bodyOut, { credits: 0, endpoint: matched.endpoint }));
      }

      const result = await matched.endpoint.handler({
        params: matched.params, query: parseQuery(url.pathname, url.search),
        auth: null, api: { matchRoute, estimateCredits },
      });
      return respond(finish(200, {
        'content-type': 'application/json; charset=utf-8', 'x-request-id': requestId, 'x-credits-charged': '0',
        'cache-control': 'public, max-age=30',
      }, result, { credits: 0, endpoint: matched.endpoint }));
    } catch (error) {
      if (error && typeof error.code === 'string') return fail(error);
      return fail(problem('invalid_parameter', error?.message ?? 'Unexpected error'));
    }
  }

  /** Build a runnable curl snippet for the current playground state. */
  function curlFor(path, query = {}, { key = 'hdk_sk_YOUR_KEY', accept = null } = {}) {
    const url = new URL(path, 'https://data.hyperdash.com');
    Object.entries(query).forEach(([name, value]) => {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(name, String(value));
    });
    const parts = [
      `curl "${url.toString()}" \\`,
      `  -H "Authorization: Bearer ${key}"`,
    ];
    if (accept) parts[parts.length - 1] += ' \\';
    if (accept) parts.push(`  -H "Accept: ${accept}"`);
    return parts.join('\n');
  }

  /* ------------------------- stream simulation --------------------- */

  /**
   * In-browser model of wss://data.hyperdash.com/v1/stream.
   * Emits the documented message sequence and bills one credit per acked event.
   */
  function openStream({ key, onMessage, onClose } = {}) {
    const auth = authenticate({ authorization: `Bearer ${key}` });
    requireScope(auth, 'streams:read');
    const current = auth.plan;
    let closed = false;
    let subSeq = 0;
    const subscriptions = new Map();
    let timers = [];

    const send = (message) => { if (!closed) onMessage?.({ ...message, receivedAt: now() }); };
    const stopTimers = () => { timers.forEach((timer) => clearInterval(timer)); timers = []; };

    const close = (code = 1000, reason = 'client_closed') => {
      if (closed) return;
      closed = true;
      stopTimers();
      onClose?.({ code, reason });
    };

    const credits = creditsSnapshot();
    if (credits.remaining <= 0) {
      queueMicrotask(() => { send({ op: 'error', code: 'credits_exhausted', detail: 'No credits left' }); close(1008, 'credits_exhausted'); });
      return { send: () => {}, close, subscriptions };
    }
    if (subscriptions.size >= 20) {
      queueMicrotask(() => close(1008, 'rate_limited'));
      return { send: () => {}, close, subscriptions };
    }

    const bucket = bucketFor(auth.key.id, current);
    queueMicrotask(() => {
      send({ op: 'ready', key_id: auth.key.id, environment: 'production' });
      timers.push(setInterval(() => send({ op: 'ping' }), 5_000));
    });

    function subscribe({ channel, coin, address, interval: intervalName, cursor }) {
      const meta = STREAM_CHANNELS.find((entry) => entry.channel === channel);
      if (!meta) { send({ op: 'error', code: 'invalid_parameter', detail: `Unknown channel: ${channel}` }); return; }
      const target = meta.target === 'coin' ? (coin ?? '*') : meta.target === 'address' ? address : '*';
      if (meta.target === 'address' && !/^0x[0-9a-fA-F]{40}$/.test(String(address ?? ''))) {
        send({ op: 'error', code: 'invalid_parameter', detail: 'address must be 0x followed by 40 hex characters' });
        return;
      }
      const existing = [...subscriptions.values()].find((sub) => sub.channel === channel && sub.target === target);
      if (existing) { send({ op: 'error', code: 'already_subscribed', detail: `${channel}:${target}` }); return; }
      if (subscriptions.size >= 20) { send({ op: 'error', code: 'rate_limited', detail: '20 subscriptions per connection' }); return; }
      subSeq += 1;
      const sub = {
        id: subSeq,
        channel,
        target,
        interval: intervalName ?? (channel === 'candles' ? '5m' : null),
        batch: 0,
        pending: null,
        ackTimer: null,
        paused: false,
        cursor: cursor ?? null,
        credits: 0,
        creditsSpent: 0,
        events: 0,
      };
      subscriptions.set(sub.id, sub);
      // `ready` always precedes `subscribed` on the wire, even when a client
      // subscribes from inside the same tick as connect().
      queueMicrotask(() => {
        send({ op: 'subscribed', sub: sub.id, channel, [meta.target === 'address' ? 'address' : 'coin']: target, cursor: sub.cursor });
      });
      const period = channel === 'book' ? 520 : channel === 'bbo' ? 260 : channel === 'mids' || channel === 'markets' ? 1_000 : channel === 'account' ? 1_000 : 1_300;
      timers.push(setInterval(() => {
        if (sub.paused || closed) return;
        if (sub.ackTimer) return;
        sub.batch += 1;
        const events = buildEvents(sub, meta, engine, auth, 1);
        sub.events += events.length;
        sub.credits = events.length * meta.credits;
        // The ack timer and the pending charge must exist *before* the batch is
        // delivered: a synchronous `ack` inside onMessage would otherwise race
        // with (and be overwritten by) the assignment that follows send().
        clearTimeout(sub.ackTimer);
        sub.ackTimer = setTimeout(() => {
          send({ op: 'error', code: 'ack_timeout', detail: 'batch not acknowledged within 10 s', sub: sub.id });
          stopSubscription(sub.id);
        }, 10_000);
        send({
          op: 'data', sub: sub.id, batch: sub.batch, cursor: `${sub.channel}:${target}:${Date.now().toString(36)}`,
          events, credits: sub.credits,
        });
        if (sub.batch % 12 === 11) {
          sub.paused = true;
          send({ op: 'gap', sub: sub.id, from: sub.cursor, to: null, detail: 'live source skipped a window; backfill over REST' });
          setTimeout(() => { sub.paused = false; }, 900);
        }
      }, period));
      return sub.id;
    }

    function stopSubscription(subId) {
      const sub = subscriptions.get(subId);
      if (!sub) return;
      clearTimeout(sub.ackTimer);
      subscriptions.delete(subId);
      send({ op: 'unsubscribed', sub: subId });
    }

    function ack(subId, batch) {
      const sub = subscriptions.get(subId);
      if (!sub) return;
      if (sub.batch !== batch) {
        send({ op: 'error', code: 'invalid_parameter', detail: `No batch ${batch} awaiting acknowledgement`, sub: subId });
        return;
      }
      clearTimeout(sub.ackTimer);
      sub.ackTimer = null;
      const charged = sub.credits;
      state.used += charged;
      auth.key.credits += charged;
      sub.creditsSpent += charged;
      sub.credits = 0;
      send({ op: 'acked', sub: subId, batch, credits_charged: charged });
    }

    return {
      subscriptions,
      get creditsSpent() { return [...subscriptions.values()].reduce((sum, sub) => sum + sub.creditsSpent, 0); },
      send(message) {
        if (closed) return;
        if (message?.op === 'subscribe') subscribe(message);
        else if (message?.op === 'ack') ack(message.sub, message.batch);
        else if (message?.op === 'unsubscribe') stopSubscription(message.sub);
        else if (message?.op === 'pong') send({ op: 'heartbeat', detail: 'pong accepted' });
        else send({ op: 'error', code: 'invalid_parameter', detail: `Unknown op: ${message?.op}` });
      },
      close,
      _bucket: bucket,
    };
  }

  return {
    engine,
    plans: PLANS,
    endpoints,
    scopes: SCOPES,
    request,
    matchRoute,
    estimateCredits,
    quote: (route) => request({ path: '/v1/quote', query: { route } }),
    curls: curlFor,
    openStream,
    issueKey,
    revokeKey,
    setPlan,
    setBilling,
    plan,
    usage: () => state.usage,
    keys: () => state.keys.map(({ secret, ...rest }) => ({ ...rest, secret })),
    credits: creditsSnapshot,
    state,
    reset() {
      state.used = 148_920;
      state.topup = 0;
      state.keys = [];
      state.usage = [];
      state.buckets.clear();
      state.plan = 'starter';
      state.billing = 'monthly';
      persist();
    },
  };
}

function buildEvents(sub, meta, engine, auth, count) {
  const events = [];
  const coin = sub.target === '*' ? 'BTC' : sub.target;
  for (let index = 0; index < count; index += 1) {
    const instant = engine.now();
    if (sub.channel === 'trades') {
      const [row] = engine.trades({ coin, limit: 1 }).data;
      events.push(row);
    } else if (sub.channel === 'liquidations') {
      events.push(engine.liquidationRows({ coin: sub.target === '*' ? null : coin, limit: 1 })[0]);
    } else if (sub.channel === 'ctx' || sub.channel === 'markets') {
      events.push(engine.ctx(coin));
    } else if (sub.channel === 'candles') {
      const interval = sub.interval ?? '5m';
      const rows = engine.candles({ coin, interval, limit: 1 }).data;
      events.push(rows[0]);
    } else if (sub.channel === 'book') {
      events.push(engine.book(coin).data);
    } else if (sub.channel === 'bbo') {
      const snapshot = engine.book(coin, 1).data;
      events.push({ coin, bid: snapshot.bids[0], ask: snapshot.asks[0], ts: instant });
    } else if (sub.channel === 'mids') {
      events.push({ mids: engine.mids(), ts: instant });
    } else if (sub.channel === 'liquidation-levels' || sub.channel === 'stop-levels') {
      const mark = Number(engine.ctx(coin).mark_px);
      events.push({
        coin,
        levels: Array.from({ length: 6 }, (_, level) => ({
          px: (mark * (1 + (level - 2.5) * 0.01)).toFixed(2),
          side: level < 3 ? 'long' : 'short',
          notional_usd: (2_000_000 + hash01(`${coin}:${level}:${Math.floor(instant / 1_000)}`) * 9_000_000).toFixed(2),
        })),
      });
    } else if (sub.channel === 'account') {
      const wallet = engine.findWallet(auth.key.scopes.includes('accounts:read') ? sub.target : '0x8f4e2c7a9b1d5e6f3a0c8b2d4e7f190a3c5b8d02');
      events.push({
        address: wallet.address,
        account_value: wallet.account_value,
        margin_used: wallet.margin_used,
        positions: wallet.positions,
        ts: instant,
      });
    } else if (sub.channel === 'fills' || sub.channel === 'orders' || sub.channel === 'funding') {
      const address = sub.target === '*' ? '0x8f4e2c7a9b1d5e6f3a0c8b2d4e7f190a3c5b8d02' : sub.target;
      if (sub.channel === 'fills') events.push(engine.walletFills({ address, limit: 1 }).data[0]);
      else if (sub.channel === 'orders') {
        const [fill] = engine.walletFills({ address, limit: 1 }).data;
        events.push({ ...fill, status: 'filled', order_type: 'limit', reduce_only: false });
      } else {
        const wallet = engine.findWallet(address);
        const position = wallet.positions[0];
        const config = engine.requireMarket(position.coin);
        events.push({
          address, coin: position.coin, funding_rate: engine.fundingRateAt(config, instant).toFixed(10),
          payment_usd: (-(Number(position.notional_usd) * 0.000021)).toFixed(2), ts: instant,
        });
      }
    }
  }
  return events.filter(Boolean);
}
