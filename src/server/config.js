/**
 * Runtime configuration for the data API backend.
 *
 * Every value comes from the environment (Cloudflare Worker `vars`/secrets or
 * `process.env` under Node). Invalid values fail loudly at startup instead of
 * silently falling back, so a misconfigured deployment never serves data from
 * somewhere unexpected.
 */

export const DEFAULTS = Object.freeze({
  HL_INFO_URL: 'https://api.hyperliquid.xyz/info',
  HL_TIMEOUT_MS: 8_000,
  HL_MAX_RETRIES: 2,
  HL_RETRY_BASE_MS: 250,
  // Hyperliquid allows 1200 weight per minute per IP. Keep headroom for
  // other traffic leaving the same egress IP.
  HL_WEIGHT_BUDGET_PER_MIN: 900,
  HL_WEIGHT_MAX_WAIT_MS: 3_000,
  CLIENT_RATE_PER_SEC: 5,
  CLIENT_BURST: 20,
  CACHE_MAX_ENTRIES: 500,
  CORS_ALLOW_ORIGIN: '*',
  LOG_LEVEL: 'info',
});

const LOG_LEVELS = ['debug', 'info', 'warn', 'error'];

function intValue(env, name, { min, max }) {
  const raw = env?.[name];
  if (raw === undefined || raw === null || raw === '') return DEFAULTS[name];
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`Config ${name} must be an integer between ${min} and ${max} (got ${JSON.stringify(raw)})`);
  }
  return value;
}

function numberValue(env, name, { min, max }) {
  const raw = env?.[name];
  if (raw === undefined || raw === null || raw === '') return DEFAULTS[name];
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`Config ${name} must be a number between ${min} and ${max} (got ${JSON.stringify(raw)})`);
  }
  return value;
}

export function loadConfig(env = {}) {
  const infoUrl = env.HL_INFO_URL || DEFAULTS.HL_INFO_URL;
  let parsed;
  try {
    parsed = new URL(infoUrl);
  } catch {
    throw new Error(`Config HL_INFO_URL is not a valid URL: ${infoUrl}`);
  }
  if (parsed.protocol !== 'https:') throw new Error('Config HL_INFO_URL must use https');

  const logLevel = env.LOG_LEVEL || DEFAULTS.LOG_LEVEL;
  if (!LOG_LEVELS.includes(logLevel)) throw new Error(`Config LOG_LEVEL must be one of ${LOG_LEVELS.join(', ')}`);

  return Object.freeze({
    infoUrl: parsed.toString(),
    timeoutMs: intValue(env, 'HL_TIMEOUT_MS', { min: 500, max: 60_000 }),
    maxRetries: intValue(env, 'HL_MAX_RETRIES', { min: 0, max: 5 }),
    retryBaseMs: intValue(env, 'HL_RETRY_BASE_MS', { min: 10, max: 10_000 }),
    weightBudgetPerMin: intValue(env, 'HL_WEIGHT_BUDGET_PER_MIN', { min: 20, max: 1_200 }),
    weightMaxWaitMs: intValue(env, 'HL_WEIGHT_MAX_WAIT_MS', { min: 0, max: 30_000 }),
    clientRatePerSec: numberValue(env, 'CLIENT_RATE_PER_SEC', { min: 0.1, max: 1_000 }),
    clientBurst: intValue(env, 'CLIENT_BURST', { min: 1, max: 10_000 }),
    cacheMaxEntries: intValue(env, 'CACHE_MAX_ENTRIES', { min: 0, max: 100_000 }),
    corsAllowOrigin: env.CORS_ALLOW_ORIGIN || DEFAULTS.CORS_ALLOW_ORIGIN,
    logLevel,
  });
}
