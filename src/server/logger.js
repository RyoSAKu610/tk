/**
 * Structured JSON logging. One line per event so Cloudflare Workers Logs
 * (and any log drain) can index fields directly.
 */

const ORDER = { debug: 10, info: 20, warn: 30, error: 40 };

export function createLogger({ level = 'info', sink = console } = {}) {
  const threshold = ORDER[level] ?? ORDER.info;
  const write = (lvl, event, fields) => {
    if (ORDER[lvl] < threshold) return;
    const line = JSON.stringify({ ts: new Date().toISOString(), level: lvl, event, ...fields });
    if (lvl === 'error') sink.error(line);
    else if (lvl === 'warn') sink.warn(line);
    else sink.log(line);
  };
  return Object.freeze({
    debug: (event, fields = {}) => write('debug', event, fields),
    info: (event, fields = {}) => write('info', event, fields),
    warn: (event, fields = {}) => write('warn', event, fields),
    error: (event, fields = {}) => write('error', event, fields),
  });
}

export const silentLogger = Object.freeze({ debug() {}, info() {}, warn() {}, error() {} });
