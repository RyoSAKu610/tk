/**
 * Browser client for this site's own `/v1` backend, which proxies the
 * official Hyperliquid info API. There is no offline or simulated mode:
 * every failure is raised as ApiError and must be shown to the user.
 */

const DEFAULT_TIMEOUT_MS = 15_000;

export class ApiError extends Error {
  constructor({ status, code, detail, requestId = null, path, body = null, elapsedMs = null }) {
    super(detail);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.requestId = requestId;
    this.path = path;
    this.body = body;
    this.elapsedMs = elapsedMs;
  }
}

/** API base: `<meta name="api-base" content="https://…">` or same origin. */
export function apiBase() {
  const meta = document.querySelector('meta[name="api-base"]')?.content?.trim();
  return (meta || location.origin).replace(/\/$/, '');
}

const listeners = new Set();
/** Subscribe to every request outcome (used by the console's request log). */
export function onRequest(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(entry) {
  for (const listener of listeners) {
    try { listener(entry); } catch (error) { console.error('request listener failed', error); }
  }
}

/**
 * GET a /v1 path. Resolves { data, meta, status, headers, elapsedMs, raw }.
 * Rejects with ApiError on network failure, timeout, or any non-2xx status.
 */
export async function apiGet(path, { query = null, timeoutMs = DEFAULT_TIMEOUT_MS, signal = null } = {}) {
  const url = new URL(path, `${apiBase()}/`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    }
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException('timeout', 'TimeoutError')), timeoutMs);
  signal?.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
  const started = performance.now();
  const display = `${url.pathname}${url.search}`;
  let response;
  try {
    response = await fetch(url, { headers: { accept: 'application/json' }, signal: controller.signal });
  } catch (cause) {
    clearTimeout(timer);
    const elapsedMs = Math.round(performance.now() - started);
    const timedOut = controller.signal.reason?.name === 'TimeoutError';
    const error = new ApiError({
      status: 0,
      code: timedOut ? 'client_timeout' : 'network_error',
      detail: timedOut ? `No answer from ${url.host} within ${timeoutMs / 1000} s` : `Could not reach ${url.host}: ${cause?.message ?? cause}`,
      path: display,
      elapsedMs,
    });
    emit({ path: display, status: 0, ok: false, elapsedMs, code: error.code, detail: error.message, at: Date.now() });
    throw error;
  }
  clearTimeout(timer);
  const raw = await response.text();
  const elapsedMs = Math.round(performance.now() - started);
  let body = null;
  try { body = raw ? JSON.parse(raw) : null; } catch { body = null; }
  const headers = Object.fromEntries(response.headers);
  const requestId = headers['x-request-id'] ?? body?.request_id ?? body?.meta?.request_id ?? null;
  if (!response.ok || !body) {
    const error = new ApiError({
      status: response.status,
      code: body?.code ?? (body ? 'error' : 'invalid_response'),
      detail: body?.detail ?? (body ? `HTTP ${response.status}` : `HTTP ${response.status}: response was not JSON`),
      requestId,
      path: display,
      body,
      elapsedMs,
    });
    emit({ path: display, status: response.status, ok: false, elapsedMs, code: error.code, detail: error.message, requestId, at: Date.now(), headers, raw });
    throw error;
  }
  emit({ path: display, status: response.status, ok: true, elapsedMs, requestId, cached: body.meta?.cached ?? null, fetchedAt: body.meta?.fetched_at ?? null, at: Date.now(), headers, raw });
  return { data: body.data, meta: body.meta ?? {}, status: response.status, headers, elapsedMs, raw };
}

/** Raw request for the playground: never throws on HTTP status, only on network failure. */
export async function apiRaw(pathWithQuery, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const url = new URL(pathWithQuery, `${apiBase()}/`);
  try {
    const result = await apiGet(`${url.pathname}${url.search}`, { timeoutMs });
    return { ok: true, status: result.status, headers: result.headers, raw: result.raw, elapsedMs: result.elapsedMs, url: url.toString() };
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    return { ok: false, status: error.status, error, raw: error.body ? JSON.stringify(error.body, null, 2) : error.message, elapsedMs: error.elapsedMs, url: url.toString(), headers: {} };
  }
}

/** Human-readable one-liner for an ApiError, suitable for an inline banner. */
export function describeError(error) {
  if (!(error instanceof ApiError)) return String(error?.message ?? error);
  const id = error.requestId ? ` · request ${error.requestId.slice(0, 8)}` : '';
  const status = error.status ? `HTTP ${error.status} ${error.code}` : error.code;
  return `${status}: ${error.message}${id}`;
}
