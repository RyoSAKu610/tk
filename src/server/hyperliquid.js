/**
 * Client for the official Hyperliquid info endpoint (POST /info).
 *
 * - Hard timeout per attempt (AbortController).
 * - Retries with exponential backoff + jitter for network errors, timeouts,
 *   HTTP 429 and 5xx. 4xx responses are never retried.
 * - Client-side weight budget that mirrors Hyperliquid's documented IP limits
 *   (1200 weight/min; l2Book/allMids/clearinghouseState/… weigh 2, most info
 *   requests 20, plus per-item surcharges). When the budget is spent the call
 *   waits briefly, then fails with `upstream_budget` rather than risking a ban.
 * - Short TTL cache and in-flight de-duplication so bursts of identical
 *   requests cost one upstream call.
 *
 * Nothing here ever invents data: every failure surfaces as UpstreamError.
 */

const WEIGHT_2 = new Set(['l2Book', 'allMids', 'clearinghouseState', 'orderStatus', 'spotClearinghouseState', 'exchangeStatus']);
const PER_20_ITEMS = new Set([
  'recentTrades', 'historicalOrders', 'userFills', 'userFillsByTime', 'fundingHistory', 'userFunding',
  'nonUserFundingUpdates', 'twapHistory', 'userTwapSliceFills', 'userTwapSliceFillsByTime',
  'delegatorHistory', 'delegatorRewards', 'validatorStats',
]);

export function baseWeight(type) {
  if (WEIGHT_2.has(type)) return 2;
  if (type === 'userRole') return 60;
  return 20;
}

function surcharge(type, items) {
  if (PER_20_ITEMS.has(type)) return Math.floor(items / 20);
  if (type === 'candleSnapshot') return Math.floor(items / 60);
  return 0;
}

export function extraWeight(type, data) {
  return surcharge(type, Array.isArray(data) ? data.length : 0);
}

/** Largest row counts Hyperliquid returns per call, used when the caller gives no estimate. */
const MAX_ITEMS = {
  userFills: 2000, userFillsByTime: 2000, historicalOrders: 2000,
  fundingHistory: 500, userFunding: 500, nonUserFundingUpdates: 500,
  recentTrades: 20, candleSnapshot: 5000,
};

/** Weight to reserve up front: base plus the surcharge of the largest expected response. */
export function expectedWeight(type, expectedItems = null) {
  const items = expectedItems ?? MAX_ITEMS[type] ?? 0;
  return baseWeight(type) + surcharge(type, items);
}

export class UpstreamError extends Error {
  constructor(code, detail, { status = 502, upstreamStatus = null, attempts = 0, retryAfterMs = null } = {}) {
    super(detail);
    this.name = 'UpstreamError';
    this.code = code;
    this.status = status;
    this.upstreamStatus = upstreamStatus;
    this.attempts = attempts;
    this.retryAfterMs = retryAfterMs;
  }
}

class WeightBudget {
  constructor({ budget, now }) {
    this.budget = budget;
    this.now = now;
    this.entries = [];
  }

  prune() {
    const cutoff = this.now() - 60_000;
    while (this.entries.length && this.entries[0].t <= cutoff) this.entries.shift();
  }

  used() {
    this.prune();
    return this.entries.reduce((sum, entry) => sum + entry.w, 0);
  }

  /** Milliseconds until `weight` fits, or 0 when it fits now. */
  waitFor(weight) {
    this.prune();
    let used = this.used();
    if (used + weight <= this.budget) return 0;
    for (const entry of this.entries) {
      used -= entry.w;
      if (used + weight <= this.budget) return Math.max(1, entry.t + 60_000 - this.now());
    }
    return 60_000;
  }

  /** Record weight now; returns the entry so a reservation can be settled later. */
  charge(weight) {
    const entry = { t: this.now(), w: Math.max(0, weight) };
    if (entry.w > 0) this.entries.push(entry);
    return entry;
  }
}

export function createHyperliquidClient({
  config,
  logger,
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  random = Math.random,
}) {
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required');
  const budget = new WeightBudget({ budget: config.weightBudgetPerMin, now });
  const cache = new Map();
  const inflight = new Map();
  const stats = {
    requests: 0, upstreamCalls: 0, cacheHits: 0, retries: 0, failures: 0,
    lastSuccessAt: null, lastFailureAt: null, lastError: null, lastLatencyMs: null,
  };

  function cacheGet(key) {
    const entry = cache.get(key);
    if (!entry) return null;
    if (entry.expires <= now()) { cache.delete(key); return null; }
    cache.delete(key);
    cache.set(key, entry);
    return entry;
  }

  function cacheSet(key, entry) {
    if (config.cacheMaxEntries === 0) return;
    cache.set(key, entry);
    while (cache.size > config.cacheMaxEntries) cache.delete(cache.keys().next().value);
  }

  /**
   * Reserve the weight a request may cost, including the surcharge of the
   * largest response it can return. Capacity is re-checked after every wait,
   * so concurrent waiters cannot spend the same freed headroom twice.
   * Returns the budget entry; settle() corrects it to the real cost.
   */
  async function reserve(type, expectedItems) {
    const weight = expectedWeight(type, expectedItems);
    if (weight > config.weightBudgetPerMin) {
      throw new UpstreamError('upstream_budget', `A ${type} request may cost ${weight} weight, more than the whole budget (${config.weightBudgetPerMin}/min)`, { status: 503, retryAfterMs: 60_000 });
    }
    const deadline = now() + config.weightMaxWaitMs;
    for (;;) {
      const wait = budget.waitFor(weight);
      if (wait === 0) return budget.charge(weight);
      if (now() + wait > deadline) {
        throw new UpstreamError('upstream_budget',
          `Upstream weight budget (${config.weightBudgetPerMin}/min) is spent; retry in ${Math.ceil(wait / 1000)} s`,
          { status: 503, retryAfterMs: wait });
      }
      logger.warn('upstream.budget_wait', { type, wait_ms: wait });
      await sleep(wait);
    }
  }

  /** Replace a reservation with the weight the response actually cost. */
  function settle(entry, actual) {
    entry.w = Math.max(0, actual);
  }

  async function attempt(body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);
    const started = now();
    try {
      const response = await fetchImpl(config.infoUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await response.text();
      const latency = now() - started;
      if (!response.ok) {
        const failure = new UpstreamError(
          response.status === 429 ? 'upstream_rate_limited' : 'upstream_error',
          `Hyperliquid responded HTTP ${response.status}${text ? `: ${text.slice(0, 200)}` : ''}`,
          { status: response.status === 429 ? 503 : 502, upstreamStatus: response.status },
        );
        failure.retryable = response.status === 429 || response.status >= 500;
        throw failure;
      }
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        throw new UpstreamError('upstream_invalid', 'Hyperliquid returned a body that is not JSON', { upstreamStatus: response.status });
      }
      return { data, latency };
    } catch (error) {
      if (error instanceof UpstreamError) {
        if (error.retryable === undefined) error.retryable = false;
        throw error;
      }
      const timedOut = error?.name === 'AbortError';
      const wrapped = new UpstreamError(
        timedOut ? 'upstream_timeout' : 'upstream_unreachable',
        timedOut ? `Hyperliquid did not answer within ${config.timeoutMs} ms` : `Could not reach Hyperliquid: ${error?.cause?.message || error?.message || error}`,
        { status: timedOut ? 504 : 502 },
      );
      wrapped.retryable = true;
      throw wrapped;
    } finally {
      clearTimeout(timer);
    }
  }

  async function fetchFresh(body, expectedItems) {
    const type = body.type;
    let attempts = 0;
    let weight = 0;
    for (;;) {
      attempts += 1;
      const reservation = await reserve(type, expectedItems);
      stats.upstreamCalls += 1;
      try {
        const { data, latency } = await attempt(body);
        const cost = baseWeight(type) + extraWeight(type, data);
        settle(reservation, cost);
        weight += cost;
        stats.lastSuccessAt = now();
        stats.lastLatencyMs = latency;
        logger.info('upstream.ok', { type, latency_ms: latency, attempts, weight });
        return { data, fetchedAt: now(), upstreamMs: latency, attempts, weight };
      } catch (error) {
        // A refused or failed call still counts against Hyperliquid's IP limit;
        // a budget refusal never reached Hyperliquid and holds no reservation.
        settle(reservation, baseWeight(type));
        weight += baseWeight(type);
        error.attempts = attempts;
        const retryable = error.retryable && attempts <= config.maxRetries;
        logger[retryable ? 'warn' : 'error']('upstream.fail', {
          type, attempts, code: error.code, upstream_status: error.upstreamStatus, detail: error.message, will_retry: retryable,
        });
        if (!retryable) {
          stats.failures += 1;
          stats.lastFailureAt = now();
          stats.lastError = { code: error.code, detail: error.message, at: now() };
          throw error;
        }
        stats.retries += 1;
        const backoff = config.retryBaseMs * 2 ** (attempts - 1);
        await sleep(Math.round(backoff / 2 + random() * backoff));
      }
    }
  }

  /**
   * POST one info request. `ttlMs` > 0 enables caching for that request body.
   * `expectedItems` bounds the response size so its weight surcharge can be
   * reserved before sending (defaults to Hyperliquid's per-call maximum).
   * Resolves to { data, fetchedAt, cached, ageMs, upstreamMs, attempts, weight }.
   */
  async function info(body, { ttlMs = 0, expectedItems = null } = {}) {
    if (!body || typeof body.type !== 'string') throw new Error('info() needs a body with a type');
    stats.requests += 1;
    const key = JSON.stringify(body);
    if (ttlMs > 0) {
      const hit = cacheGet(key);
      if (hit) {
        stats.cacheHits += 1;
        return { ...hit.value, cached: true, ageMs: now() - hit.value.fetchedAt, attempts: 0, weight: 0 };
      }
      if (inflight.has(key)) {
        const shared = await inflight.get(key);
        return { ...shared, cached: true, ageMs: now() - shared.fetchedAt, attempts: 0, weight: 0 };
      }
    }
    const pending = fetchFresh(body, expectedItems);
    if (ttlMs > 0) inflight.set(key, pending);
    try {
      const value = await pending;
      if (ttlMs > 0) cacheSet(key, { value, expires: now() + ttlMs });
      return { ...value, cached: false, ageMs: 0 };
    } finally {
      if (ttlMs > 0) inflight.delete(key);
    }
  }

  function snapshot() {
    return {
      ...stats,
      weightUsedLastMinute: budget.used(),
      weightBudgetPerMin: config.weightBudgetPerMin,
      cacheEntries: cache.size,
    };
  }

  return Object.freeze({ info, snapshot });
}
