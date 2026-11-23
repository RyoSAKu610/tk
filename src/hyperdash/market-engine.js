/**
 * Hyperdash Data API — self-hosted market engine.
 *
 * Deterministic simulation of Hyperliquid market, account, liquidation and
 * analytics data. The same timestamp and the same coin always produce the
 * same price, candle, fill or leaderboard row, so charts, tests and the demo
 * console agree with each other without a network connection.
 *
 * No DOM, no network, no randomness that depends on call order.
 */

export const DAY_MS = 86_400_000;
export const HOUR_MS = 3_600_000;
export const MINUTE_MS = 60_000;

const ANCHOR_DAY = Date.UTC(2026, 10, 17) / DAY_MS;

/** Raw market configuration. Prices are decimal strings, as the API returns them. */
const MARKET_CONFIG = [
  // coin, name, dex, category, sector, basePrice, vol, trendPerDay, pxDecimals, szDecimals, maxLeverage, oiUsd
  ['BTC', 'Bitcoin', 'core', 'crypto', 'Layer 1', 108_412, 0.052, 0.0012, 1, 5, 40, 1_284_000_000],
  ['ETH', 'Ethereum', 'core', 'crypto', 'Layer 1', 3_842.4, 0.061, 0.0016, 2, 3, 25, 612_400_000],
  ['SOL', 'Solana', 'core', 'crypto', 'Layer 1', 186.42, 0.078, 0.0021, 3, 2, 20, 284_900_000],
  ['HYPE', 'Hyperliquid', 'core', 'crypto', 'Exchange', 41.27, 0.086, 0.0028, 4, 2, 10, 198_600_000],
  ['XRP', 'XRP', 'core', 'crypto', 'Payments', 2.3124, 0.072, -0.0011, 4, 1, 10, 86_400_000],
  ['DOGE', 'Dogecoin', 'core', 'crypto', 'Memecoin', 0.18426, 0.093, -0.0026, 5, 0, 10, 74_200_000],
  ['SUI', 'Sui', 'core', 'crypto', 'Layer 1', 3.4218, 0.098, 0.0034, 4, 1, 10, 61_800_000],
  ['AVAX', 'Avalanche', 'core', 'crypto', 'Layer 1', 24.916, 0.081, -0.0008, 3, 2, 10, 48_300_000],
  ['LINK', 'Chainlink', 'core', 'crypto', 'Oracle', 17.842, 0.074, 0.0009, 3, 2, 10, 44_100_000],
  ['AAVE', 'Aave', 'core', 'crypto', 'DeFi', 268.34, 0.088, 0.0019, 2, 2, 10, 32_700_000],
  ['ENA', 'Ethena', 'core', 'crypto', 'DeFi', 0.4216, 0.104, -0.0031, 5, 0, 10, 27_400_000],
  ['TAO', 'Bittensor', 'core', 'crypto', 'AI', 412.68, 0.111, 0.0042, 2, 2, 10, 22_900_000],
  ['ARB', 'Arbitrum', 'core', 'crypto', 'Layer 2', 0.6194, 0.087, -0.0017, 5, 0, 10, 18_600_000],
  ['OP', 'Optimism', 'core', 'crypto', 'Layer 2', 0.7128, 0.084, -0.0022, 5, 0, 10, 15_200_000],
  ['TIA', 'Celestia', 'core', 'crypto', 'Modular', 2.1416, 0.102, 0.0026, 4, 1, 10, 12_800_000],
  ['WIF', 'dogwifhat', 'core', 'crypto', 'Memecoin', 1.8214, 0.128, -0.0041, 4, 1, 10, 9_640_000],
  ['BNB', 'BNB', 'core', 'crypto', 'Exchange', 641.82, 0.048, 0.0007, 2, 2, 10, 8_910_000],
  ['LTC', 'Litecoin', 'core', 'crypto', 'Payments', 92.64, 0.052, -0.0004, 3, 2, 10, 7_420_000],
  ['EIGEN', 'EigenLayer', 'core', 'crypto', 'Restaking', 1.6248, 0.116, 0.0031, 4, 1, 10, 6_180_000],
  ['xyz:TSLA', 'Tesla', 'xyz', 'equity', 'US Equity', 402.16, 0.041, 0.0014, 2, 2, 20, 64_800_000],
  ['xyz:NVDA', 'NVIDIA', 'xyz', 'equity', 'US Equity', 182.44, 0.038, 0.0026, 2, 2, 20, 51_200_000],
  ['xyz:AAPL', 'Apple', 'xyz', 'equity', 'US Equity', 236.28, 0.024, 0.0006, 2, 2, 20, 33_600_000],
  ['xyz:SPX', 'S&P 500', 'xyz', 'index', 'Index', 6_584.2, 0.016, 0.0005, 1, 2, 20, 28_400_000],
  ['xyz:GOLD', 'Gold', 'xyz', 'commodity', 'Commodity', 3_412.8, 0.014, 0.0008, 1, 2, 20, 19_700_000],
  ['xyz:EUR', 'Euro / USD', 'xyz', 'fx', 'FX', 1.0872, 0.006, -0.0002, 5, 0, 20, 8_200_000],
  ['xyz:OPENAI', 'OpenAI (pre-IPO)', 'xyz', 'pre-ipo', 'Pre-IPO', 812.5, 0.052, 0.0038, 1, 1, 5, 4_600_000],
];

/** Candle intervals documented by the API reference, in milliseconds. */
export const INTERVALS = Object.freeze({
  '1s': 1_000,
  '15s': 15_000,
  '30s': 30_000,
  '1m': 60_000,
  '3m': 180_000,
  '5m': 300_000,
  '15m': 900_000,
  '30m': 1_800_000,
  '1h': 3_600_000,
  '2h': 7_200_000,
  '4h': 14_400_000,
  '8h': 28_800_000,
  '12h': 43_200_000,
  '1d': 86_400_000,
  '3d': 259_200_000,
  '1w': 604_800_000,
  '1M': 2_592_000_000,
});
export const INTERVAL_KEYS = Object.freeze(Object.keys(INTERVALS));

/** Fixed stablecoin wallet used by the demo quickstart, mirroring the docs. */
export const DEMO_ADDRESS = '0x8f4e2c7a9b1d5e6f3a0c8b2d4e7f190a3c5b8d02';

/* --------------------------------------------------------------------------
   Deterministic helpers
   -------------------------------------------------------------------------- */

export function hash32(text) {
  let h = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    h ^= text.charCodeAt(index);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Hash seed + integer index to a float in [0, 1). */
export function unit(seed, index) {
  let h = (seed ^ Math.imul(index | 0, 0x9e3779b1)) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x21f0aaad) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x735a2d97) >>> 0;
  h ^= h >>> 15;
  return (h >>> 0) / 4_294_967_296;
}

/** Smooth value noise in [-1, 1] — stable for any real x. */
export function noise(seed, x) {
  const floor = Math.floor(x);
  const fraction = x - floor;
  const smooth = fraction * fraction * (3 - 2 * fraction);
  const a = unit(seed, floor) * 2 - 1;
  const b = unit(seed, floor + 1) * 2 - 1;
  return a + (b - a) * smooth;
}

/** Seeded PRNG for row generation; never used for prices. */
export function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function hexAddress(seed, salt = 0) {
  let out = '0x';
  for (let block = 0; block < 5; block += 1) {
    let value = (seed ^ Math.imul(block + 1, 0x9e3779b1) ^ Math.imul(salt + 7, 0x85ebca6b)) >>> 0;
    value ^= value >>> 16;
    value = Math.imul(value, 0x21f0aaad) >>> 0;
    out += value.toString(16).padStart(8, '0').slice(0, 8);
  }
  return out.slice(0, 42);
}

export function fixed(value, decimals) {
  if (!Number.isFinite(value)) return '0';
  const sign = value < 0 ? '-' : '';
  return `${sign}${Math.abs(value).toFixed(decimals)}`;
}

/* --------------------------------------------------------------------------
   Engine
   -------------------------------------------------------------------------- */

function buildMarket(raw) {
  const [coin, name, dex, category, sector, basePrice, vol, trend, pxDecimals, szDecimals, maxLeverage, oiUsd] = raw;
  return Object.freeze({
    coin,
    name,
    dex,
    category,
    sector,
    basePrice,
    vol,
    trend,
    pxDecimals,
    szDecimals,
    maxLeverage,
    oiUsd,
    seed: hash32(`hyperdash:market:${coin}`),
    fundingSeed: hash32(`hyperdash:funding:${coin}`),
    volumeSeed: hash32(`hyperdash:volume:${coin}`),
  });
}

export function createMarketEngine({ now = () => Date.now(), live = true } = {}) {
  // `live: false` freezes the clock: identical inputs return identical output,
  // which is what the tests and the docs examples use.
  const frozen = now();
  const clock = live ? now : () => frozen;
  const markets = MARKET_CONFIG.map(buildMarket);
  const byCoin = new Map(markets.map((market) => [market.coin, market]));

  function market(coin) {
    return byCoin.get(coin) ?? null;
  }

  function requireMarket(coin) {
    const found = market(coin);
    if (!found) throw Object.assign(new Error(`Unknown market: ${coin}`), { code: 'not_found' });
    return found;
  }

  /** Log-price shape for a market, anchored so today's price matches its config. */
  function logOffset(config, ts) {
    const day = ts / DAY_MS;
    const f =
      0.58 * noise(config.seed, day * 1.7) +
      0.28 * noise(config.seed ^ 0x55aa55, day * 7.3) +
      0.14 * noise(config.seed ^ 0xaa55aa, day * 29.1);
    const anchor =
      0.58 * noise(config.seed, ANCHOR_DAY * 1.7) +
      0.28 * noise(config.seed ^ 0x55aa55, ANCHOR_DAY * 7.3) +
      0.14 * noise(config.seed ^ 0xaa55aa, ANCHOR_DAY * 29.1);
    return config.vol * (f - anchor) + config.trend * (day - ANCHOR_DAY) * 0.35;
  }

  /** Raw (unrounded) price at a millisecond timestamp. */
  function rawPrice(configOrCoin, ts) {
    const config = typeof configOrCoin === 'string' ? requireMarket(configOrCoin) : configOrCoin;
    return config.basePrice * Math.exp(logOffset(config, ts));
  }

  function priceAt(coin, ts) {
    const config = requireMarket(coin);
    return Number(fixed(rawPrice(config, ts), config.pxDecimals));
  }

  function changePercent(coin, windowMs) {
    const config = requireMarket(coin);
    const instant = clock();
    const start = rawPrice(config, instant - windowMs);
    return ((rawPrice(config, instant) - start) / start) * 100;
  }

  function fundingRateAt(config, ts) {
    const day = ts / DAY_MS;
    const slow = noise(config.fundingSeed, day * 3.4);
    const fast = noise(config.fundingSeed ^ 0x1234, day * 21.7);
    const drift = Math.sin(day * 0.7 + unit(config.fundingSeed, 3) * Math.PI) * 0.35;
    return (0.0000125 + (slow * 0.9 + fast * 0.35 + drift) * 0.0000175);
  }

  function openInterestAt(config, ts) {
    const day = ts / DAY_MS;
    const wave = noise(config.seed ^ 0x0f0f, day * 4.1) * 0.22 + noise(config.seed ^ 0x3333, day * 13.3) * 0.08;
    return config.oiUsd * (1 + wave);
  }

  function volumeAt(config, ts, bucketMs) {
    const day = ts / DAY_MS;
    const hour = new Date(ts).getUTCHours() + new Date(ts).getUTCMinutes() / 60;
    // Intraday seasonality: US open and the 00:00 UTC funding window are busiest.
    const session =
      0.72 +
      0.5 * Math.exp(-((hour - 15) ** 2) / 18) +
      0.34 * Math.exp(-((hour - 0.5) ** 2) / 6) +
      0.2 * Math.exp(-((hour - 8) ** 2) / 24);
    const daily = 0.8 + noise(config.volumeSeed, day * 5.2) * 0.55;
    const swing = 0.75 + noise(config.volumeSeed ^ 0x77, day * 31.7) * 0.5;
    const dailyUsd = config.oiUsd * 1.85 * Math.max(0.35, daily) * Math.max(0.4, swing);
    const share = Math.min(0.25, bucketMs / DAY_MS);
    const price = rawPrice(config, ts);
    return (dailyUsd * share * session) / price;
  }

  /* ---------------------------- markets ---------------------------- */

  function ctx(coin) {
    const config = requireMarket(coin);
    const instant = clock();
    const mark = rawPrice(config, instant);
    const oracle = rawPrice(config, instant - 4_000);
    const spreadBps = 0.6 + unit(config.seed, Math.floor(instant / 15_000)) * 1.6;
    const mid = mark * (1 + (spreadBps / 10_000) * 0.15);
    const oi = openInterestAt(config, instant);
    return {
      coin,
      mark_px: fixed(mark, config.pxDecimals),
      oracle_px: fixed(oracle, config.pxDecimals),
      mid_px: fixed(mid, config.pxDecimals),
      funding: fixed(fundingRateAt(config, instant), 10),
      predicted_funding: fixed(fundingRateAt(config, instant + HOUR_MS), 10),
      open_interest: fixed(oi / mark, config.szDecimals),
      open_interest_usd: fixed(oi, 2),
      day_volume_usd: fixed(volumeAt(config, instant, DAY_MS) * mark, 2),
      day_change_pct: Number(changePercent(coin, DAY_MS).toFixed(2)),
      max_leverage: config.maxLeverage,
      sz_decimals: config.szDecimals,
      px_decimals: config.pxDecimals,
      premium: fixed(((mark - oracle) / oracle) * 100, 4),
    };
  }

  function marketRow(coin) {
    const config = requireMarket(coin);
    const context = ctx(coin);
    return {
      coin: config.coin,
      name: config.name,
      dex: config.dex,
      category: config.category,
      sector: config.sector,
      ...context,
      is_delisted: false,
    };
  }

  function listMarkets({ dex = null, category = null, limit = 200 } = {}) {
    return markets
      .filter((config) => (!dex || config.dex === dex) && (!category || config.category === category))
      .slice(0, limit)
      .map((config) => marketRow(config.coin));
  }

  function mids() {
    return markets.map((config) => ({ coin: config.coin, mid_px: ctx(config.coin).mid_px }));
  }

  /* ---------------------------- candles ---------------------------- */

  function candles({ coin, interval = '1h', startTime, endTime, limit = 500 }) {
    const config = requireMarket(coin);
    const step = INTERVALS[interval];
    if (!step) throw Object.assign(new Error(`interval must be one of ${INTERVAL_KEYS.join(', ')}`), { code: 'invalid_parameter' });
    const instant = clock();
    const to = Math.min(endTime ?? instant, instant);
    const bucketEnd = Math.floor(to / step) * step;
    const count = Math.max(1, Math.min(limit, 5_000));
    const rows = [];
    for (let index = count - 1; index >= 0; index -= 1) {
      const bucket = bucketEnd - index * step;
      if (startTime !== undefined && bucket < startTime) continue;
      const isForming = bucket + step > instant;
      const open = rawPrice(config, bucket);
      const close = rawPrice(config, isForming ? instant : bucket + step);
      let high = Math.max(open, close);
      let low = Math.min(open, close);
      for (let sample = 1; sample < 12; sample += 1) {
        const point = rawPrice(config, bucket + Math.min(step, instant - bucket) * (sample / 12));
        high = Math.max(high, point);
        low = Math.min(low, point);
      }
      const wickSeed = unit(config.seed, Math.floor(bucket / step) + 977);
      high *= 1 + wickSeed * 0.0015;
      low *= 1 - wickSeed * 0.0011;
      const volume = volumeAt(config, bucket, step);
      rows.push({
        t: bucket,
        o: fixed(open, config.pxDecimals),
        h: fixed(high, config.pxDecimals),
        l: fixed(low, config.pxDecimals),
        c: fixed(close, config.pxDecimals),
        v: fixed(volume, config.szDecimals > 2 ? config.szDecimals : 2),
        q: fixed(volume * ((high + low) / 2), 2),
        n: Math.round(volume / (Math.max(1, config.basePrice) * 0.00002) + unit(config.seed, Math.floor(bucket / step)) * 400),
        liq_only: false,
      });
    }
    return {
      data: rows,
      meta: {
        coin,
        interval,
        start_time: rows.length ? rows[0].t : bucketEnd,
        end_time: bucketEnd,
        sample: false,
        forming: bucketEnd + step > instant,
      },
    };
  }

  /* ----------------------------- trades ---------------------------- */

  function tradeWallet(seed, index) {
    return hexAddress(seed ^ 0x51ed, index);
  }

  function trades({ coin, startTime, endTime, limit = 200 }) {
    const config = requireMarket(coin);
    const instant = clock();
    const to = Math.min(endTime ?? instant, instant);
    const count = Math.max(1, Math.min(limit, 1_000));
    const rows = [];
    for (let index = 0; index < count; index += 1) {
      const t = to - index * 1_800;
      if (startTime !== undefined && t < startTime) break;
      const px = rawPrice(config, t);
      const roll = unit(config.seed ^ 0xc0ffee, Math.floor(t / 1_800));
      const sizeUsd = Math.exp(roll * 6.4 + 5.2);
      const size = sizeUsd / px;
      rows.push({
        t,
        coin,
        side: unit(config.seed ^ 0xbeef, Math.floor(t / 1_800)) > 0.5 ? 'B' : 'A',
        px: fixed(px, config.pxDecimals),
        sz: fixed(size, config.szDecimals),
        notional: fixed(sizeUsd, 2),
        taker: tradeWallet(config.seed, Math.floor(t / 1_800)),
        maker: tradeWallet(config.seed ^ 0x9a9a, Math.floor(t / 1_800) + 17),
        crossed: roll > 0.12,
        hash: `0x${(hash32(`${coin}:${t}`) * 4_294_967_296 + hash32(`${coin}:${t}:b`)).toString(16).padStart(16, '0')}`,
      });
    }
    return { data: rows, meta: { coin, count: rows.length } };
  }

  /* ------------------------------ book ----------------------------- */

  function book(coin, depth = 20) {
    const config = requireMarket(coin);
    const instant = clock();
    const mid = rawPrice(config, instant);
    const tick = mid * (0.00004 + config.vol * 0.0004);
    const levels = Math.max(1, Math.min(depth, 20));
    const bids = [];
    const asks = [];
    for (let index = 0; index < levels; index += 1) {
      const rollSeed = Math.floor(instant / 1_000);
      const bidSize = (unit(config.seed ^ 0xb1d, index + rollSeed * 3) * 500 + 12) * (1 + index * 0.16);
      const askSize = (unit(config.seed ^ 0xa5c, index + rollSeed * 3) * 500 + 12) * (1 + index * 0.16);
      bids.push({ px: fixed(mid - tick * (index + 0.5), config.pxDecimals), sz: fixed(bidSize, config.szDecimals), n: 1 + Math.round(bidSize / 40) });
      asks.push({ px: fixed(mid + tick * (index + 0.5), config.pxDecimals), sz: fixed(askSize, config.szDecimals), n: 1 + Math.round(askSize / 40) });
    }
    const bidNotional = bids.reduce((sum, level) => sum + Number(level.px) * Number(level.sz), 0);
    const askNotional = asks.reduce((sum, level) => sum + Number(level.px) * Number(level.sz), 0);
    return {
      data: {
        coin,
        bids,
        asks,
        spread: fixed(tick, config.pxDecimals),
        mid_px: fixed(mid, config.pxDecimals),
        bid_usd: fixed(bidNotional, 2),
        ask_usd: fixed(askNotional, 2),
        imbalance: Number(((bidNotional - askNotional) / (bidNotional + askNotional)).toFixed(4)),
      },
      meta: { coin, as_of: instant, computed_at: instant },
    };
  }

  function bookOrders(coin, limit = 100) {
    const config = requireMarket(coin);
    const instant = clock();
    const mid = rawPrice(config, instant);
    const count = Math.max(1, Math.min(limit, 500));
    const rows = [];
    for (let index = 0; index < count; index += 1) {
      const side = index % 2 === 0 ? 'B' : 'A';
      const level = Math.floor(index / 2);
      const tick = mid * 0.00004 + config.vol * mid * 0.0004;
      const px = mid + (side === 'B' ? -1 : 1) * tick * (level + 1);
      const size = unit(config.seed ^ 0x0d3, index + Math.floor(instant / 20_000) * 31) ** 3 * 900 + 1;
      rows.push({
        oid: 100_000_000 + (hash32(`${coin}:${index}:${Math.floor(instant / 60_000)}`) % 900_000_000),
        coin,
        side,
        px: fixed(px, config.pxDecimals),
        sz: fixed(size, config.szDecimals),
        address: tradeWallet(config.seed ^ 0x77aa, index),
        timestamp: instant - Math.floor(unit(config.seed, index) * 4 * HOUR_MS),
        trigger: null,
      });
    }
    return { data: rows, meta: { coin, levels: 2, count: rows.length } };
  }

  /* ----------------------------- series ---------------------------- */

  function series({ coin, interval = '1h', metric = 'open_interest', limit = 300, startTime }) {
    const config = requireMarket(coin);
    const step = INTERVALS[interval] ?? HOUR_MS;
    const instant = clock();
    const bucketEnd = Math.floor(instant / step) * step;
    const rows = [];
    for (let index = Math.max(0, limit - 1); index >= 0; index -= 1) {
      const t = bucketEnd - index * step;
      if (startTime !== undefined && t < startTime) continue;
      if (metric === 'open_interest') {
        rows.push({ t, coin, open_interest_usd: fixed(openInterestAt(config, t) * rawPrice(config, t), 2) });
      } else if (metric === 'funding') {
        rows.push({ t, coin, funding_rate: fixed(fundingRateAt(config, t), 10), predicted: fixed(fundingRateAt(config, t + step), 10) });
      } else if (metric === 'trade_bars') {
        const buy = volumeAt(config, t, step) * (0.44 + unit(config.seed ^ 0x22, Math.floor(t / step)) * 0.28);
        const sell = volumeAt(config, t, step) - buy;
        const px = rawPrice(config, t);
        rows.push({
          t,
          coin,
          buy_sz: fixed(buy, config.szDecimals),
          sell_sz: fixed(sell, config.szDecimals),
          buy_usd: fixed(buy * px, 2),
          sell_usd: fixed(sell * px, 2),
          liq_long_usd: fixed(unit(config.seed ^ 0x31, Math.floor(t / step)) ** 6 * 4_600_000, 2),
          liq_short_usd: fixed(unit(config.seed ^ 0x32, Math.floor(t / step)) ** 6 * 3_900_000, 2),
        });
      } else if (metric === 'cvd') {
        const px = rawPrice(config, t);
        const delta = (unit(config.seed ^ 0x44, Math.floor(t / step)) - 0.47) * volumeAt(config, t, step);
        rows.push({ t, coin, delta_usd: fixed(delta * px, 2), cvd_usd: fixed(delta * px * (index + 1) * 0.4, 2) });
      } else if (metric === 'volatility') {
        rows.push({ t, coin, realized_vol: fixed(0.28 + config.vol * 2.6 + noise(config.seed ^ 0x88, t / step) * 0.12, 4) });
      }
    }
    return { data: rows, meta: { coin, interval, metric } };
  }

  /* -------------------------- liquidations ------------------------- */

  function liquidationRows({ coin = null, startTime, endTime, limit = 200 }) {
    const instant = clock();
    const to = Math.min(endTime ?? instant, instant);
    const count = Math.max(1, Math.min(limit, 2_000));
    const rows = [];
    const pool = coin ? [requireMarket(coin)] : markets;
    for (let index = 0; index < count * 3 && rows.length < count; index += 1) {
      const t = to - index * 7_000;
      if (startTime !== undefined && t < startTime) break;
      const config = pool[Math.floor(unit(0xabcd, Math.floor(t / 7_000)) * pool.length)];
      const roll = unit(config.seed ^ 0xf00d, Math.floor(t / 7_000));
      if (roll > 0.45) continue;
      const px = rawPrice(config, t);
      const usd = Math.exp(unit(config.seed ^ 0xfeed, Math.floor(t / 7_000)) * 5.4 + 7.6);
      const side = unit(config.seed ^ 0x0bad, Math.floor(t / 7_000) + 5) > 0.5 ? 'long' : 'short';
      rows.push({
        t,
        coin: config.coin,
        address: tradeWallet(config.seed ^ 0x1a2b, Math.floor(t / 7_000)),
        side,
        px: fixed(px, config.pxDecimals),
        sz: fixed(usd / px, config.szDecimals),
        notional_usd: fixed(usd, 2),
        closed_pnl_usd: fixed(-usd * (0.021 + unit(config.seed, Math.floor(t / 7_000)) * 0.08), 2),
        mark_px: fixed(px, config.pxDecimals),
        method: unit(config.seed ^ 0x2222, Math.floor(t / 7_000)) > 0.82 ? 'backstop' : 'market',
      });
    }
    return rows;
  }

  function liquidations(options = {}) {
    const rows = liquidationRows(options);
    rows.sort((a, b) => b.t - a.t);
    const total = rows.reduce((sum, row) => sum + Number(row.notional_usd), 0);
    return { data: rows, meta: { count: rows.length, total_notional_usd: fixed(total, 2) } };
  }

  function liquidationsSeries({ bucket = '1h', startTime, endTime, limit = 240 } = {}) {
    const step = INTERVALS[bucket] ?? HOUR_MS;
    const instant = clock();
    const bucketEnd = Math.floor((endTime ?? instant) / step) * step;
    const rows = [];
    for (let index = Math.max(0, Math.min(limit, 6_000) - 1); index >= 0; index -= 1) {
      const t = bucketEnd - index * step;
      if (startTime !== undefined && t < startTime) continue;
      const long = unit(0x1111, t / step) ** 5 * 8_400_000 + unit(0x2222, t / step) * 180_000;
      const short = unit(0x3333, t / step) ** 5 * 7_100_000 + unit(0x4444, t / step) * 150_000;
      rows.push({ t, long_usd: fixed(long, 2), short_usd: fixed(short, 2), total_usd: fixed(long + short, 2) });
    }
    return { data: rows, meta: { bucket } };
  }

  /* ---------------------------- wallets ---------------------------- */

  const PROFILE_WORDS = [
    'Momentum', 'Delta Neutral', 'Basis', 'Funding Harvest', 'Twap', 'Breakout',
    'Mean Revert', 'Grid', 'Volatility', 'Liquidity', 'Trend', 'Carry',
  ];
  const PROFILE_NOUNS = ['Desk', 'Fund', 'Capital', 'Vault', 'Alpha', 'Trading', 'Labs', 'Partners'];

  function walletSummary(index) {
    const seed = hash32(`hyperdash:wallet:${index}`);
    const rand = mulberry32(seed);
    const address = hexAddress(seed);
    const name = index % 3 === 0
      ? `${PROFILE_WORDS[Math.floor(rand() * PROFILE_WORDS.length)]} ${PROFILE_NOUNS[Math.floor(rand() * PROFILE_NOUNS.length)]}`
      : null;
    const accountValue = Math.exp(rand() * 7.4 + 8.4);
    const leverage = 1 + rand() * 5.2;
    const positions = [];
    const positionCount = 1 + Math.floor(rand() * 4);
    const shuffled = [...markets].sort((a, b) => unit(seed ^ hash32(a.coin), 1) - unit(seed ^ hash32(b.coin), 1));
    for (let slot = 0; slot < positionCount; slot += 1) {
      const config = shuffled[slot];
      if (!config) break;
      const instant = clock();
      const mark = rawPrice(config, instant);
      const entryDays = 0.4 + rand() * 12;
      const entry = rawPrice(config, instant - entryDays * DAY_MS) * (1 + (rand() - 0.5) * 0.01);
      const long = rand() > 0.42;
      const notional = accountValue * leverage * (0.18 + rand() * 0.42) / Math.max(1, positionCount * 0.6);
      const size = notional / mark;
      const signed = long ? size : -size;
      const upnl = (mark - entry) * signed;
      const maint = Math.max(0.0125, 0.5 / config.maxLeverage);
      const liq = long ? entry * (1 - 1 / (leverage * 1) + maint) : entry * (1 + 1 / leverage - maint);
      positions.push({
        coin: config.coin,
        szi: fixed(signed, config.szDecimals),
        side: long ? 'long' : 'short',
        entry_px: fixed(entry, config.pxDecimals),
        mark_px: fixed(mark, config.pxDecimals),
        notional_usd: fixed(notional, 2),
        leverage: Math.round(leverage * 10) / 10,
        liquidation_px: fixed(Math.max(liq, mark * 0.05), config.pxDecimals),
        unrealized_pnl: fixed(upnl, 2),
        roe: Number(((upnl / (notional / leverage)) * 100).toFixed(2)),
        margin_used: fixed(notional / leverage, 2),
        funding_since_open: fixed(-notional * 0.000021 * entryDays * 24, 2),
      });
    }
    const totalNtl = positions.reduce((sum, position) => sum + Number(position.notional_usd), 0);
    const upnl = positions.reduce((sum, position) => sum + Number(position.unrealized_pnl), 0);
    const realized = (rand() - 0.42) * accountValue * 1.7;
    return {
      address,
      name,
      account_value: fixed(accountValue, 2),
      withdrawable: fixed(accountValue * (0.18 + rand() * 0.4), 2),
      margin_used: fixed(totalNtl / Math.max(1, leverage), 2),
      total_notional: fixed(totalNtl, 2),
      unrealized_pnl: fixed(upnl, 2),
      realized_pnl: fixed(realized, 2),
      net_pnl: fixed(realized + upnl, 2),
      roi: Number((((realized + upnl) / Math.max(1, accountValue)) * 100).toFixed(2)),
      positions,
      cross_margin: { account_value: fixed(accountValue, 2), margin_used: fixed(totalNtl / Math.max(1, leverage), 2) },
      open_order_count: Math.floor(rand() * 14),
      fee_tier: rand() > 0.8 ? 'vip' : 'base',
      created_at: clock() - Math.floor(rand() * 480) * DAY_MS,
    };
  }

  function findWallet(address) {
    const needle = String(address ?? '').toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(needle)) {
      throw Object.assign(new Error('address must be 0x followed by 40 hex characters'), { code: 'invalid_parameter' });
    }
    // Recover a deterministic index for known engine wallets; unknown wallets
    // still resolve so the playground can query any address.
    const target = hash32(needle);
    const base = target % 4_000;
    const summary = walletSummary(base);
    if (summary.address.toLowerCase() === needle) return summary;
    return {
      ...summary,
      address: needle,
      name: null,
      derived_from: 'address-hash',
    };
  }

  function walletPositions(address) {
    return findWallet(address).positions;
  }

  function walletFills({ address, startTime, endTime, limit = 100 } = {}) {
    const wallet = findWallet(address);
    const config = requireMarket(wallet.positions[0]?.coin ?? 'BTC');
    const seed = hash32(`${wallet.address}:fills`);
    const instant = clock();
    const to = Math.min(endTime ?? instant, instant);
    const count = Math.max(1, Math.min(limit, 1_000));
    const rows = [];
    for (let index = 0; index < count; index += 1) {
      const t = to - index * 47_000;
      if (startTime !== undefined && t < startTime) break;
      const target = wallet.positions[index % Math.max(1, wallet.positions.length)];
      const coin = target?.coin ?? config.coin;
      const marketConfig = requireMarket(coin);
      const px = rawPrice(marketConfig, t);
      const usd = 1_200 + unit(seed, index) ** 2 * 240_000;
      const side = unit(seed ^ 0x99, index) > 0.5 ? 'B' : 'A';
      rows.push({
        t,
        coin,
        address: wallet.address,
        side,
        dir: side === 'B' ? 'Open Long' : 'Close Long',
        px: fixed(px, marketConfig.pxDecimals),
        sz: fixed(usd / px, marketConfig.szDecimals),
        notional_usd: fixed(usd, 2),
        fee: fixed(usd * 0.00035, 4),
        closed_pnl: fixed(side === 'A' ? (unit(seed ^ 0x77, index) - 0.4) * usd * 0.03 : 0, 2),
        oid: 100_000_000 + (hash32(`${wallet.address}:${index}`) % 900_000_000),
        tid: hash32(`${wallet.address}:t:${index}`) * 4_294_967_296 + hash32(`${wallet.address}:u:${index}`),
      });
    }
    return { data: rows, meta: { address: wallet.address, count: rows.length } };
  }

  function pnlChart(address, days = 30) {
    const wallet = findWallet(address);
    const endValue = Number(wallet.account_value);
    const seed = hash32(`${wallet.address}:pnl-chart`);
    const rows = [];
    const startValue = endValue / (1 + (unit(seed, 0) - 0.35) * 0.5);
    let value = startValue;
    for (let index = days; index >= 0; index -= 1) {
      const t = clock() - index * DAY_MS;
      const dailyPnl = (unit(seed, index) - 0.46) * endValue * 0.035;
      value = Math.max(endValue * 0.25, value + dailyPnl);
      rows.push({
        t: Math.floor(t / DAY_MS) * DAY_MS,
        account_value: fixed(value, 2),
        pnl: fixed(dailyPnl, 2),
        cumulative_pnl: fixed(value - startValue, 2),
      });
    }
    return { data: rows, meta: { address: wallet.address, days } };
  }

  /* -------------------------- analytics ---------------------------- */

  function leaderboard({ window = '7d', limit = 100, sort = 'pnl' } = {}) {
    const windowDays = window === '24h' ? 1 : window === '30d' ? 30 : window === '90d' ? 90 : window === 'all' ? 365 : 7;
    const rows = [];
    const total = Math.min(limit, 500);
    for (let index = 0; index < total * 4 && rows.length < total; index += 1) {
      const summary = walletSummary(index);
      const scale = Math.sqrt(windowDays / 7);
      const net = Number(summary.net_pnl) * scale;
      const roi = Number(summary.roi) * scale;
      if (net <= 0) continue;
      rows.push({
        rank: rows.length + 1,
        address: summary.address,
        name: summary.name,
        window,
        net_pnl: fixed(net, 2),
        realized_pnl: fixed(Number(summary.realized_pnl) * scale, 2),
        unrealized_pnl: summary.unrealized_pnl,
        roi: Number(roi.toFixed(2)),
        volume: fixed(Number(summary.account_value) * 42 * scale, 2),
        account_value: summary.account_value,
        positions: summary.positions.length,
      });
    }
    rows.sort((a, b) => (sort === 'roi' ? b.roi - a.roi : Number(b.net_pnl) - Number(a.net_pnl)));
    rows.forEach((row, index) => { row.rank = index + 1; });
    return { data: rows, meta: { window, count: rows.length, rebuilt_at: clock() - 4 * MINUTE_MS } };
  }

  function largestPositions({ limit = 50, coin = null } = {}) {
    const rows = [];
    for (let index = 0; index < 260 && rows.length < Math.min(limit, 100); index += 1) {
      const summary = walletSummary(index);
      for (const position of summary.positions) {
        if (coin && position.coin !== coin) continue;
        if (Number(position.notional_usd) < 400_000) continue;
        rows.push({
          address: summary.address,
          name: summary.name,
          coin: position.coin,
          side: position.side,
          notional_usd: position.notional_usd,
          entry_px: position.entry_px,
          mark_px: position.mark_px,
          liquidation_px: position.liquidation_px,
          leverage: position.leverage,
          unrealized_pnl: position.unrealized_pnl,
        });
      }
    }
    rows.sort((a, b) => Number(b.notional_usd) - Number(a.notional_usd));
    return { data: rows.slice(0, Math.min(limit, 100)), meta: { count: rows.length } };
  }

  function nearLiquidation({ limit = 50 } = {}) {
    const rows = [];
    for (let index = 0; index < 320 && rows.length < Math.min(limit, 100); index += 1) {
      const summary = walletSummary(index);
      for (const position of summary.positions) {
        const mark = Number(position.mark_px);
        const liq = Number(position.liquidation_px);
        if (!mark || !liq) continue;
        const distance = Math.abs((liq - mark) / mark) * 100;
        if (distance > 7 || Number(position.notional_usd) < 250_000) continue;
        rows.push({
          address: summary.address,
          name: summary.name,
          coin: position.coin,
          side: position.side,
          mark_px: position.mark_px,
          liquidation_px: position.liquidation_px,
          distance_pct: Number(distance.toFixed(2)),
          notional_usd: position.notional_usd,
          leverage: position.leverage,
        });
      }
    }
    rows.sort((a, b) => a.distance_pct - b.distance_pct);
    return { data: rows.slice(0, Math.min(limit, 100)), meta: { count: rows.length } };
  }

  function positioning({ limit = 60, interval = '1h', startTime } = {}) {
    const step = INTERVALS[interval] ?? HOUR_MS;
    const instant = clock();
    const bucketEnd = Math.floor(instant / step) * step;
    const rows = [];
    for (let index = Math.max(0, Math.min(limit, 5_000) - 1); index >= 0; index -= 1) {
      const t = bucketEnd - index * step;
      if (startTime !== undefined && t < startTime) continue;
      const seed = Math.floor(t / step);
      const longShare = 0.5 + noise(0x51a7, seed * 0.42) * 0.16;
      const totalUsd = 2_100_000_000 * (1 + noise(0x77a1, seed * 0.31) * 0.12);
      rows.push({
        t,
        long_usd: fixed(totalUsd * longShare, 2),
        short_usd: fixed(totalUsd * (1 - longShare), 2),
        long_ratio: Number(longShare.toFixed(4)),
        traders_long: Math.round(9_400 + noise(0x1234, seed * 0.7) * 1_400),
        traders_short: Math.round(7_900 + noise(0x4321, seed * 0.6) * 1_300),
      });
    }
    return { data: rows, meta: { interval } };
  }

  function consensus({ limit = 25 } = {}) {
    return {
      data: markets.slice(0, Math.min(limit, 500)).map((config, index) => {
        const seed = hash32(`${config.coin}:consensus:${Math.floor(clock() / (12 * MINUTE_MS))}`);
        const longShare = 0.36 + unit(seed, 1) * 0.52;
        return {
          coin: config.coin,
          long_count: Math.round(18 + unit(seed, 2) * 190),
          short_count: Math.round(12 + unit(seed, 3) * 170),
          net_notional_usd: fixed((longShare - 0.5) * 24_000_000, 2),
          long_ratio: Number(longShare.toFixed(4)),
          consensus: longShare > 0.62 ? 'long' : longShare < 0.42 ? 'short' : 'mixed',
          changed_1h: Math.round((unit(seed, 4) - 0.5) * 40),
          rank: index + 1,
        };
      }),
      meta: { snapshot: clock() - 13 * MINUTE_MS, cached: true },
    };
  }

  function openInterestChanges({ limit = 40 } = {}) {
    return {
      data: markets.slice(0, limit).map((config) => {
        const current = openInterestAt(config, clock()) * rawPrice(config, clock());
        const previous = openInterestAt(config, clock() - HOUR_MS) * rawPrice(config, clock() - HOUR_MS);
        return {
          coin: config.coin,
          open_interest_usd: fixed(current, 2),
          change_1h_usd: fixed(current - previous, 2),
          change_1h_pct: Number((((current - previous) / previous) * 100).toFixed(2)),
          change_24h_pct: Number(changePercent(config.coin, DAY_MS).toFixed(2)),
        };
      }),
      meta: { interval: '1h' },
    };
  }

  function fundingLatest({ limit = 25 } = {}) {
    return {
      data: markets.slice(0, limit).map((config) => {
        const rate = fundingRateAt(config, clock());
        return {
          coin: config.coin,
          funding_rate_hourly: fixed(rate, 10),
          funding_rate_annualized: Number((rate * 24 * 365 * 100).toFixed(3)),
          predicted: fixed(fundingRateAt(config, clock() + HOUR_MS), 10),
          open_interest_usd: fixed(openInterestAt(config, clock()), 2),
        };
      }),
      meta: { interval: '1h' },
    };
  }

  function revenue({ days = 30 } = {}) {
    const rows = [];
    for (let index = days - 1; index >= 0; index -= 1) {
      const t = Math.floor((clock() - index * DAY_MS) / DAY_MS) * DAY_MS;
      const seed = Math.floor(t / DAY_MS);
      const fees = 640_000 + noise(0x9f11, seed * 0.6) * 220_000 + unit(0x88, seed) * 60_000;
      rows.push({
        t,
        fees_usd: fixed(fees, 2),
        volume_usd: fixed(fees * 168, 2),
        builder_fees_usd: fixed(fees * 0.061, 2),
        hlp_pnl_usd: fixed(noise(0x4b21, seed * 0.9) * 180_000, 2),
        active_traders: Math.round(18_400 + noise(0x7c1, seed * 0.5) * 2_600),
      });
    }
    return { data: rows, meta: { interval: '1d', days } };
  }

  function datasets() {
    const instant = clock();
    const minutesAgo = (minutes) => instant - minutes * MINUTE_MS;
    return {
      data: [
        {
          id: 'market-candles',
          title: 'Candles (OHLCV)',
          description: 'OHLCV candles per market from 1 second to 1 month, built from our own nodes.',
          freshness: 'seconds',
          coverage_from: Date.UTC(2025, 2, 22),
          as_of: minutesAgo(0.4),
          endpoints: ['GET /v1/markets/{coin}/candles'],
          plans: ['Starter', 'Growth', 'Scale', 'Enterprise'],
        },
        {
          id: 'trade-tape',
          title: 'Trade tape',
          description: 'Every trade of one market with taker and maker wallet.',
          freshness: 'seconds',
          coverage_from: Date.UTC(2023, 4, 20),
          as_of: minutesAgo(0.2),
          endpoints: ['GET /v1/markets/{coin}/trades', 'GET /v1/markets/{coin}/trade-bars'],
          plans: ['Starter', 'Growth', 'Scale', 'Enterprise'],
        },
        {
          id: 'account-history',
          title: 'Account history',
          description: 'Fills, funding, ledger and completed round-trip trades for every wallet.',
          freshness: 'seconds',
          coverage_from: Date.UTC(2023, 1, 26),
          as_of: minutesAgo(3),
          endpoints: ['GET /v1/accounts/{address}/fills', 'GET /v1/accounts/{address}/funding', 'GET /v1/accounts/{address}/trades'],
          plans: ['Starter', 'Growth', 'Scale', 'Enterprise'],
        },
        {
          id: 'positions',
          title: 'Positions and margin',
          description: 'Live positions, margin summary and risk for any wallet or market.',
          freshness: 'live',
          coverage_from: null,
          as_of: minutesAgo(0.05),
          endpoints: ['GET /v1/accounts/{address}/positions', 'GET /v1/markets/{coin}/positions', 'GET /v1/positions/largest'],
          plans: ['Starter', 'Growth', 'Scale', 'Enterprise'],
        },
        {
          id: 'liquidations',
          title: 'Liquidations and levels',
          description: 'Every liquidation event plus the liquidation and stop ladders behind it.',
          freshness: 'seconds',
          coverage_from: Date.UTC(2025, 6, 28),
          as_of: minutesAgo(0.3),
          endpoints: ['GET /v1/liquidations', 'GET /v1/markets/{coin}/liquidation-levels', 'GET /v1/liquidations/cascades'],
          plans: ['Starter', 'Growth', 'Scale', 'Enterprise'],
        },
        {
          id: 'analytics',
          title: 'Derived analytics',
          description: 'Leaderboards, cohort positioning, trader statistics and network revenue.',
          freshness: '5-15 min',
          coverage_from: Date.UTC(2025, 2, 22),
          as_of: minutesAgo(4),
          endpoints: ['GET /v1/leaderboards/pnl', 'GET /v1/cohorts/consensus', 'GET /v1/network/revenue'],
          plans: ['Starter', 'Growth', 'Scale', 'Enterprise'],
        },
        {
          id: 'footprint',
          title: 'Footprint',
          description: 'Volume at price per bar, and position-action footprint per price row.',
          freshness: '1 s',
          coverage_from: Date.UTC(2023, 4, 20),
          as_of: minutesAgo(0.5),
          endpoints: ['GET /v1/markets/{coin}/footprint', 'GET /v1/markets/{coin}/footprint/actions'],
          plans: ['Growth', 'Scale', 'Enterprise'],
        },
        {
          id: 'l4-book',
          title: 'Order-level (L4) book',
          description: 'Every resting order near the mid, not just the aggregated book.',
          freshness: 'live',
          coverage_from: null,
          as_of: minutesAgo(0.1),
          endpoints: ['GET /v1/markets/{coin}/book/orders'],
          plans: ['Growth', 'Scale', 'Enterprise'],
        },
      ],
      meta: { count: 8, api_version: '2026-11-17' },
    };
  }

  function status() {
    const instant = clock();
    return {
      status: 'operational',
      environment: 'production',
      as_of: instant,
      frontier: {
        candles: instant - 3_000,
        trades: instant - 900,
        fills: instant - 2_000,
        bars: Math.floor((instant - 6 * MINUTE_MS) / HOUR_MS) * HOUR_MS,
        funding: Math.floor((instant - 6 * MINUTE_MS) / HOUR_MS) * HOUR_MS,
        positions: instant - 40_000,
      },
      components: [
        { name: 'REST API', status: 'operational' },
        { name: 'Streams', status: 'operational' },
        { name: 'MCP server', status: 'operational' },
        { name: 'History store', status: 'operational' },
      ],
      regions: [
        { region: 'ap-northeast-1', p50_ms: 21, p99_ms: 64 },
        { region: 'us-east-1', p50_ms: 18, p99_ms: 58 },
        { region: 'eu-west-1', p50_ms: 24, p99_ms: 71 },
      ],
    };
  }

  function changelog() {
    return {
      data: [
        { date: '2026-11-17', type: 'launch', title: 'Hyperdash Data API is generally available', detail: 'REST, WebSocket streams and the hosted MCP server are live for every plan.' },
        { date: '2026-11-04', type: 'added', title: 'Cohort positioning and top-trader consensus', detail: 'Two analytics endpoints now rebuild every 12 minutes.' },
        { date: '2026-10-19', type: 'added', title: 'Position books and footprint wallets', detail: 'Read a market’s position book at any time in the last 7 days.' },
        { date: '2026-09-02', type: 'changed', title: 'Cursor pagination for every list endpoint', detail: 'Cursors are signed, bound to the exact query, and valid for 24 hours.' },
      ],
      meta: { count: 4 },
    };
  }

  return {
    markets,
    market,
    requireMarket,
    now: clock,
    priceAt,
    rawPrice,
    changePercent,
    ctx,
    marketRow,
    listMarkets,
    mids,
    candles,
    trades,
    book,
    bookOrders,
    series,
    liquidations,
    liquidationRows,
    liquidationsSeries,
    walletSummary,
    findWallet,
    walletPositions,
    walletFills,
    pnlChart,
    leaderboard,
    largestPositions,
    nearLiquidation,
    positioning,
    consensus,
    openInterestChanges,
    fundingLatest,
    revenue,
    datasets,
    status,
    changelog,
    fundingRateAt,
    openInterestAt,
    volumeAt,
  };
}
