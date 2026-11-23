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

export function extraWeight(type, data) {
  const items = Array.isArray(data) ? data.length : 0;
  if (PER_20_ITEMS.has(type)) return Math.floor(items / 20);
  if (type === 'candleSnapshot') return Math.floor(items / 60);
  return 0;
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

  charge(weight) {
    if (weight > 0) this.entries.push({ t: this.now(), w: weight });
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

  async function reserve(type) {
    const weight = baseWeight(type);
    const wait = budget.waitFor(weight);
    if (wait > 0) {
      if (wait > config.weightMaxWaitMs) {
        throw new UpstreamError('upstream_budget',
          `Upstream weight budget (${config.weightBudgetPerMin}/min) is spent; retry in ${Math.ceil(wait / 1000)} s`,
          { status: 503, retryAfterMs: wait });
      }
      logger.warn('upstream.budget_wait', { type, wait_ms: wait });
      await sleep(wait);
    }
    budget.charge(weight);
    return weight;
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

  async function fetchFresh(body) {
    const type = body.type;
    let attempts = 0;
    let weight = 0;
    for (;;) {
      attempts += 1;
      weight += await reserve(type);
      stats.upstreamCalls += 1;
      try {
        const { data, latency } = await attempt(body);
        const extra = extraWeight(type, data);
        budget.charge(extra);
        weight += extra;
        stats.lastSuccessAt = now();
        stats.lastLatencyMs = latency;
        logger.info('upstream.ok', { type, latency_ms: latency, attempts, weight });
        return { data, fetchedAt: now(), upstreamMs: latency, attempts, weight };
      } catch (error) {
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
   * Resolves to { data, fetchedAt, cached, ageMs, upstreamMs, attempts, weight }.
   */
  async function info(body, { ttlMs = 0 } = {}) {
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
    const pending = fetchFresh(body);
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
