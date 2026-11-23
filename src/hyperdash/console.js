import { createMarketEngine } from './market-engine.js';
import { createDataApi, browserStorage, PLANS, SCOPES, STREAM_CHANNELS, PLAN_ORDER, DEMO_ACCOUNT } from './data-api.js';
import { drawBars, drawCandles, drawArea, drawHBars } from './charts.js';
import {
  $, $$, el, escapeHtml, money, price, percent, integer, ago, timeUTC, clockUTC,
  copyText, toast, debounce, highlightJson, highlightShell, fillSelect, onVisible, prefersReducedMotion,
} from './lib.js';

const engine = createMarketEngine();
const api = createDataApi({ engine, storage: browserStorage(), latency: true });
const build = globalThis.__HYPERDASH_BUILD__ ?? {};
const ENDPOINTS = build.endpoints?.length
  ? build.endpoints
  : api.endpoints.map(({ method, path, group, summary, scope, base, perRow, maxLimit, feature }) => ({
    method, path, group, summary, scope, base, perRow, maxLimit, feature,
  }));

const state = {
  view: 'keys',
  activeKeyId: null,
  logFilter: 'all',
  pg: { endpoint: null, tab: 'body', response: null },
  stream: null,
  streamSub: null,
  labScenario: 'ok',
  streamAutoAck: true,
};

if (!api.keys().length) {
  api.issueKey({ name: 'demo-docs', expiresInDays: 365, scopes: SCOPES.filter((scope) => scope !== 'usage:read') });
}

/* ------------------------------------------------------------------ theme */

function applySkin(name) {
  document.documentElement.dataset.skin = name === 'terminal' ? 'terminal' : 'dash';
  for (const button of $$('[data-skin-target]')) button.setAttribute('aria-pressed', String(button.dataset.skinTarget === document.documentElement.dataset.skin));
  try { localStorage.setItem('hyperdash:skin', document.documentElement.dataset.skin); } catch { /* ignore */ }
  requestAnimationFrame(() => { renderBurnChart(); renderPg2Chart(); });
}

function bindSkin() {
  let saved = null;
  try { saved = localStorage.getItem('hyperdash:skin'); } catch { /* ignore */ }
  const query = new URLSearchParams(location.search).get('skin');
  applySkin(query === 'terminal' || query === 'dash' ? query : saved === 'terminal' ? 'terminal' : 'dash');
  for (const button of $$('[data-skin-target]')) button.addEventListener('click', () => applySkin(button.dataset.skinTarget));
}

function theme() {
  const styles = getComputedStyle(document.documentElement);
  const read = (name, fallback) => styles.getPropertyValue(name).trim() || fallback;
  return {
    accent: read('--accent', '#fd592b'), accentInk: read('--accent-ink', '#111'),
    accentAlt: read('--accent-alt', '#5aa9ff'), up: read('--up', '#16c784'), down: read('--down', '#ea3943'),
    upSoft: read('--up-soft', 'rgba(22,199,132,.2)'), downSoft: read('--down-soft', 'rgba(234,57,67,.2)'),
    grid: read('--line-soft', 'rgba(255,255,255,.08)'), muted: read('--muted', '#8b8b8b'), text: read('--text', '#eee'),
    surface: read('--panel', '#141414'), crosshair: read('--line-strong', 'rgba(255,255,255,.2)'),
    lastLine: read('--accent-line', 'rgba(253,89,43,.6)'), areaFrom: 'rgba(253,89,43,.28)', areaTo: 'rgba(253,89,43,0)',
    mono: read('--font-mono', 'monospace'),
  };
}

/* ------------------------------------------------------------------- nav */

function bindNav() {
  const show = (view) => {
    state.view = view;
    for (const section of $$('[data-view]')) section.hidden = section.dataset.view !== view;
    for (const link of $$('[data-view-link]')) link.classList.toggle('is-on', link.dataset.viewLink === view);
    if (location.hash.slice(1) !== view) history.replaceState(null, '', `#${view}`);
    if (view === 'usage') { renderUsage(); }
    if (view === 'playground') { renderPg2Chart(); }
  };
  for (const link of $$('[data-view-link]')) {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      show(link.dataset.viewLink);
      window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    });
  }
  const initial = location.hash.slice(1);
  const valid = ['keys', 'usage', 'playground', 'streams-lab', 'lab', 'plan'];
  show(valid.includes(initial) ? initial : 'keys');
  window.addEventListener('hashchange', () => {
    const hash = location.hash.slice(1);
    if (valid.includes(hash) && hash !== state.view) show(hash);
  });
}

/* ----------------------------------------------------------------- keys */

function activeKey() {
  const keys = api.keys();
  if (!keys.length) return null;
  return keys.find((key) => key.id === state.activeKeyId && !key.revokedAt) ?? keys.find((key) => !key.revokedAt) ?? keys[0];
}

function keyAuth(key) {
  return { authorization: `Bearer ${key.secret}` };
}

function renderKeys() {
  const keys = api.keys();
  const active = keys.filter((key) => !key.revokedAt);
  $('[data-key-count]').textContent = String(active.length);
  $('[data-key-calls]').textContent = integer(keys.reduce((sum, key) => sum + key.calls, 0));
  $('[data-key-credits]').textContent = integer(keys.reduce((sum, key) => sum + key.credits, 0));
  const plan = api.plan();
  $('[data-key-rate]').textContent = `${plan.rps} rps`;
  $('[data-key-burst]').textContent = `burst ${plan.burst} · ${plan.concurrency} concurrent`;

  const body = $('[data-key-rows]');
  body.innerHTML = keys.length ? keys.map((key) => {
    const revoked = Boolean(key.revokedAt);
    const expired = key.expiresAt && key.expiresAt < Date.now();
    const status = revoked ? '<span class="chip chip--down">revoked</span>' : expired ? '<span class="chip chip--warn">expired</span>' : '<span class="chip chip--up">active</span>';
    return `<tr data-key-row="${key.id}" class="${state.activeKeyId === key.id ? 'is-selected' : ''}">
      <td><b>${escapeHtml(key.name)}</b><div class="muted mono" style="font-size:10.5px">${escapeHtml(key.id)}</div></td>
      <td><code class="mono">${escapeHtml(key.prefix)}</code></td>
      <td><div class="scope-pills">${key.scopes.map((scope) => `<span class="chip">${escapeHtml(scope)}</span>`).join('')}</div></td>
      <td class="mono muted">${ago(key.createdAt)}</td>
      <td class="mono muted">${key.lastUsedAt ? ago(key.lastUsedAt) : '—'}</td>
      <td class="num mono">${integer(key.calls)}</td>
      <td class="num mono">${integer(key.credits)}</td>
      <td class="cell-actions">
        ${status}
        <button class="btn btn--ghost btn--sm" type="button" data-key-select="${key.id}">Inspect</button>
        ${revoked ? '' : `<button class="btn btn--danger btn--sm" type="button" data-key-revoke="${key.id}">Revoke</button>`}
      </td>
    </tr>`;
  }).join('') : '<tr><td colspan="8" class="muted" style="padding:22px">No keys yet. Create one to start.</td></tr>';

  for (const button of $$('[data-key-select]')) {
    button.addEventListener('click', () => showKey(button.dataset.keySelect));
  }
  for (const button of $$('[data-key-revoke]')) {
    button.addEventListener('click', () => {
      api.revokeKey(button.dataset.keyRevoke);
      toast('Key revoked', { tone: 'warn' });
      renderKeys();
      renderSide();
      hideKeyDetail();
    });
  }
  fillSelect($('[data-pg-key]'), active.map((key) => ({ value: key.id, label: key.name })), { value: activeKey()?.id ?? '' });
  fillSelect($('[data-stream-key]'), active.map((key) => ({ value: key.id, label: key.name })), { value: activeKey()?.id ?? '' });
  renderSide();
}

function renderScopes() {
  const host = $('[data-scope-grid]');
  host.innerHTML = SCOPES.map((scope) => `<div class="scope-card">
    <code>${escapeHtml(scope)}</code>
    <p>${escapeHtml({
      'markets:read': 'Markets, candles, books, funding, open interest and market series.',
      'accounts:read': 'Wallets, positions, fills, orders, ledger and account value.',
      'liquidations:read': 'Liquidation events, cascades and summaries.',
      'analytics:read': 'Leaderboards, cohorts, positioning, wallet analytics and snapshots.',
      'streams:read': 'Opening a WebSocket stream and subscribing.',
      'usage:read': 'The credit balance on GET /v1/me.',
    }[scope] ?? '')}</p>
  </div>`).join('');
}

function showKey(id) {
  const key = api.keys().find((entry) => entry.id === id);
  if (!key) return;
  state.activeKeyId = id;
  for (const row of $$('[data-key-row]')) row.classList.toggle('is-selected', row.dataset.keyRow === id);
  $('[data-key-detail]').hidden = false;
  $('[data-key-detail-name]').textContent = key.name;
  $('[data-key-detail-body]').innerHTML = `
    <div class="key-detail__secret">
      <span class="field-label">Secret (demo only — the real console shows this once)</span>
      <div class="secret-row"><code data-secret>${escapeHtml(key.secret)}</code><button class="btn btn--outline btn--sm" type="button" data-copy-secret>Copy</button></div>
    </div>
    <dl class="key-detail__meta">
      <div><dt>Key ID</dt><dd class="mono">${escapeHtml(key.id)}</dd></div>
      <div><dt>Prefix</dt><dd class="mono">${escapeHtml(key.prefix)}</dd></div>
      <div><dt>Created</dt><dd class="mono">${timeUTC(key.createdAt)}</dd></div>
      <div><dt>Expires</dt><dd class="mono">${key.expiresAt ? timeUTC(key.expiresAt) : 'never'}</dd></div>
      <div><dt>Calls</dt><dd class="mono">${integer(key.calls)}</dd></div>
      <div><dt>Credits</dt><dd class="mono">${integer(key.credits)}</dd></div>
    </dl>
    <div class="key-detail__test">
      <button class="btn btn--primary btn--sm" type="button" data-key-test>Call GET /v1/me</button>
      <pre class="code-block" data-key-test-out hidden><code></code></pre>
    </div>`;
  $('[data-key-detail]').scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'nearest' });
  $('[data-copy-secret]').addEventListener('click', () => copyText(key.secret, { label: 'Secret copied' }));
  $('[data-key-test]').addEventListener('click', async () => {
    const out = $('[data-key-test-out]');
    out.hidden = false;
    const response = await api.request({ path: '/v1/me', headers: keyAuth(key) });
    out.innerHTML = `<code>${highlightJson({ status: response.status, credits: response.credits, body: response.body })}</code>`;
  });
}

function hideKeyDetail() { $('[data-key-detail]').hidden = true; }

function bindKeyDialog() {
  const dialog = $('[data-key-dialog]');
  const checks = $('[data-scope-checks]');
  checks.innerHTML = SCOPES.map((scope) => `<label class="check"><input type="checkbox" value="${scope}" ${scope === 'usage:read' ? '' : 'checked'}><span>${escapeHtml(scope)}</span></label>`).join('');
  $('[data-key-new]').addEventListener('click', () => dialog.showModal());
  for (const button of $$('[data-key-dialog-close]')) button.addEventListener('click', () => dialog.close());
  $('[data-key-form]').addEventListener('submit', (event) => {
    event.preventDefault();
    const form = new FormData(event.target);
    const scopes = $$('[data-scope-checks] input:checked').map((input) => input.value);
    if (!scopes.length) { toast('Pick at least one scope', { tone: 'warn' }); return; }
    const days = Number(form.get('expiry'));
    const key = api.issueKey({ name: String(form.get('name') || 'Untitled key'), scopes, expiresInDays: days || 0 });
    dialog.close();
    renderKeys();
    showKey(key.id);
    toast('Key created — copy the secret now');
  });
}

/* ----------------------------------------------------------------- usage */

function renderSide() {
  const credits = api.credits();
  const plan = api.plan();
  $('[data-side-credits]').textContent = plan.credits ? `${integer(credits.remaining)} / ${integer(plan.credits)}` : `${integer(credits.remaining)}`;
  $('[data-side-plan]').textContent = `${plan.name} · ${(() => { const used = plan.credits ? (credits.used / plan.credits) * 100 : 0; return `${used.toFixed(1)}% used`; })()}`;
  const usedShare = plan.credits ? Math.min(100, (credits.used / plan.credits) * 100) : 0;
  const bar = $('[data-side-meter]');
  bar.style.width = `${usedShare}%`;
  bar.classList.toggle('is-low', credits.low);
}

function renderUsage() {
  const credits = api.credits();
  const plan = api.plan();
  $('[data-usage-remaining]').textContent = integer(credits.remaining);
  $('[data-usage-meta]').textContent = plan.credits
    ? `${integer(credits.included)} included · ${integer(credits.used)} used · ${integer(credits.topup_balance)} purchased`
    : 'Enterprise committed credits';
  const pct = plan.credits ? Math.min(100, (credits.used / plan.credits) * 100) : 0;
  $('[data-usage-meter]').style.width = `${pct}%`;
  $('[data-usage-meter]').classList.toggle('is-low', credits.low);
  $('[data-usage-ring]').style.setProperty('--pct', `${pct.toFixed(1)}%`);
  $('[data-usage-ring]').classList.toggle('is-low', credits.low);
  $('[data-log-retention]').textContent = `${plan.logDays}-day retention`;
  const perMillion = plan.creditRatePerMillion;
  $('[data-usage-breakdown]').innerHTML = [
    ['Plan allowance', plan.credits ? integer(plan.credits) : 'committed'],
    ['Used', integer(credits.used)],
    ['Remaining', integer(credits.remaining)],
    ['Purchased balance', integer(credits.topup_balance)],
    ['Implied spend', perMillion ? `$${((credits.used / 1_000_000) * perMillion).toFixed(2)}` : 'contract'],
    ['Reset', '1 December 2026'],
  ].map(([label, value]) => `<div><dt>${label}</dt><dd>${escapeHtml(String(value))}</dd></div>`).join('');
  renderBills(plan);
  renderLog();
  renderBurnChart();
  renderSide();
}

function renderBills(plan) {
  const price = plan.priceMonthly;
  const rows = [
    ['INV-2026-11', 'Nov 2026', plan.name, 'Monthly', price === null ? 'Custom' : `$${integer(price)}`, 'open'],
    ['INV-2026-10', 'Oct 2026', 'Starter', 'Monthly', '$99', 'paid'],
    ['INV-2026-09', 'Sep 2026', 'Starter', 'Monthly', '$99', 'paid'],
    ['INV-2026-08', 'Aug 2026', 'Starter', 'Monthly', '$99', 'paid'],
  ];
  $('[data-invoice-rows]').innerHTML = rows.map(([id, period, name, billing, amount, status]) => `<tr>
    <td class="mono">${id}</td><td class="mono muted">${period}</td><td>${escapeHtml(name)}</td>
    <td class="mono muted">${billing}</td><td class="num mono">${amount}</td>
    <td><span class="chip ${status === 'paid' ? 'chip--up' : 'chip--warn'}">${status}</span></td>
  </tr>`).join('');
}

function filteredLog() {
  const log = api.usage();
  if (state.logFilter === 'ok') return log.filter((entry) => entry.status < 400);
  if (state.logFilter === 'err') return log.filter((entry) => entry.status >= 400);
  if (state.logFilter === 'free') return log.filter((entry) => !entry.credits);
  return log;
}

function renderLog() {
  const rows = filteredLog().slice(0, 40);
  const body = $('[data-log-rows]');
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="7" class="muted" style="padding:22px">No requests yet. Open the playground or send a request from the landing page.</td></tr>';
    return;
  }
  body.innerHTML = rows.map((entry) => `<tr>
    <td class="mono muted">${new Date(entry.at).toISOString().slice(11, 19)}</td>
    <td class="mono">${escapeHtml(entry.method)}</td>
    <td class="mono route">${escapeHtml(entry.path)}</td>
    <td><span class="chip ${entry.status < 400 ? 'chip--up' : 'chip--down'}">${entry.status}</span>${entry.code ? ` <span class="muted mono" style="font-size:10px">${escapeHtml(entry.code)}</span>` : ''}</td>
    <td class="num mono">${entry.credits || 'free'}</td>
    <td class="num mono muted">${entry.ms ? `${entry.ms} ms` : '—'}</td>
    <td class="mono muted" style="font-size:10.5px">${escapeHtml(entry.id)}</td>
  </tr>`).join('');
}

function renderBurnChart() {
  const canvas = $('[data-burn-chart]');
  if (!canvas) return;
  const log = api.usage().slice(0, 40).reverse();
  const values = log.map((entry) => entry.credits || 0);
  const host = canvas.parentElement;
  drawBars(canvas, values.length ? values : [0, 0, 0, 0, 0, 0], {
    theme: theme(),
    width: host.clientWidth - 24,
    height: Math.max(96, host.clientHeight - 8),
    formatter: (value) => `${value}`,
  });
  const total = values.reduce((sum, value) => sum + value, 0);
  const average = values.length ? total / values.length : 0;
  $('[data-burn-foot]').textContent = values.length
    ? `${integer(total)} credits over ${values.length} requests · ${average.toFixed(1)} average · peak ${Math.max(...values)}`
    : 'No requests recorded yet.';
}

async function simulateBurst() {
  const key = activeKey();
  if (!key) return;
  const routes = [
    ['/v1/markets', {}],
    ['/v1/markets/BTC/candles', { interval: '1h', limit: 240 }],
    ['/v1/markets/BTC/trades', { limit: 300 }],
    ['/v1/markets/BTC/book', {}],
    ['/v1/cohorts/consensus', {}],
    ['/v1/leaderboards/pnl', { limit: 100 }],
    ['/v1/liquidations', { limit: 400 }],
    [`/v1/accounts/${DEMO_ACCOUNT}/positions`, {}],
    ['/v1/network/revenue', { days: 30 }],
    ['/v1/markets/BTC/book/orders', { limit: 200 }],
  ];
  const outcomes = { ok: 0, throttled: 0, refused: 0, credits: 0 };
  const requests = Array.from({ length: 40 }, (_, index) => {
    const [path, query] = routes[index % routes.length];
    return api.request({ path, query, headers: keyAuth(key), delay: false });
  });
  for (const response of await Promise.all(requests)) {
    if (response.status === 200) { outcomes.ok += 1; outcomes.credits += response.credits; }
    else if (response.status === 429) outcomes.throttled += 1;
    else outcomes.refused += 1;
  }
  toast(`${outcomes.ok} ok · ${outcomes.throttled} throttled · ${outcomes.refused} refused · ${integer(outcomes.credits)} credits`, {
    tone: outcomes.throttled ? 'warn' : 'ok', timeout: 4_500,
  });
  renderKeys();
  renderUsage();
}

function buyCredits() {
  const plan = api.plan();
  if (!plan.creditRatePerMillion) { toast('Enterprise credits are set by contract', { tone: 'warn' }); return; }
  const discount = 0.1;
  const credits = Math.round((100 * (plan.credits / plan.priceMonthly)) * (1 + discount));
  api.state.topup += credits;
  toast(`Bought ${integer(credits)} credits (incl. 10% volume discount)`);
  renderUsage();
}

/* ------------------------------------------------------------- playground */

const PARAMS = {
  candles: [{ name: 'interval', type: 'select', options: ['1m', '5m', '15m', '1h', '4h', '1d'], value: '1h' }, { name: 'limit', type: 'number', value: '120' }, { name: 'start_time', type: 'text', placeholder: 'unix ms' }],
  markets: [{ name: 'dex', type: 'select', options: ['', 'core', 'xyz'] }, { name: 'category', type: 'select', options: ['', 'crypto', 'equity', 'index', 'commodity', 'fx', 'pre-ipo'] }, { name: 'limit', type: 'number' }],
  leaderboard: [{ name: 'window', type: 'select', options: ['24h', '7d', '30d', '90d', 'all'], value: '7d' }, { name: 'sort', type: 'select', options: ['pnl', 'roi'] }, { name: 'limit', type: 'number', value: '50' }],
  address: [{ name: 'limit', type: 'number', value: '20' }, { name: 'start_time', type: 'text', placeholder: 'unix ms' }],
  plain: [{ name: 'limit', type: 'number', value: '50' }],
};

function paramsFor(endpoint) {
  if (endpoint.path === '/v1/quote') return [{ name: 'route', type: 'text', value: `GET ${samplePath('/v1/markets/:coin/candles')}?interval=1h&limit=24` }];
  if (endpoint.path === '/v1/accounts/batch') return [{ name: 'addresses', type: 'text', value: '0x8f4e2c7a9b1d5e6f3a0c8b2d4e7f190a3c5b8d02', wide: true }];
  if (endpoint.maxLimit > 1 && endpoint.maxLimit < 50) return [{ name: 'limit', type: 'number', value: String(Math.min(endpoint.maxLimit, 20)) }];
  if (endpoint.path.includes('/candles')) return PARAMS.candles;
  if (endpoint.path === '/v1/markets') return PARAMS.markets;
  if (endpoint.path.includes('leaderboard')) return PARAMS.leaderboard;
  if ((endpoint.maxLimit ?? 0) <= 1) return [];
  if (endpoint.path.includes(':address')) return PARAMS.address;
  return PARAMS.plain;
}

function samplePath(path) {
  return path
    .replace(/[{:]coin[^/]*/g, 'BTC')
    .replace(/[{:]address[^/]*/g, DEMO_ACCOUNT)
    .replace(/[{:]token[^/]*/g, 'HYPE')
    .replace(/[{:]dex[^/]*/g, 'xyz')
    .replace(/[{:]outcome[^/]*/g, '%23232960')
    .replace(/[{:]validator[^/]*/g, '0x7f3c2d91a4e6b8170d5c9f2a6b4e8d13c0a7f951')
    .replace(/[{:]vault[^/]*/g, '0x2b1f4c7d9e3a5806c1d7f2b4a9e6c3d8015f7a2b')
    .replace(/[{:]builder[^/]*/g, 'xyz')
    .replace(/[{:]group[^/]*/g, 'top')
    .replace(/[{:]cohort[^/]*/g, 'whale')
    .replace(/[{:]trader_class[^/]*/g, 'swing')
    .replace(/[{:]oid[^/]*/g, '100000001')
    .replace(/[{:]asset[^/]*/g, 'BTC');
}

function renderPg2List() {
  const host = $('[data-pg2-groups]');
  const search = ($('[data-pg2-search]')?.value ?? '').trim().toLowerCase();
  const groups = new Map();
  for (const endpoint of ENDPOINTS) {
    const label = `${endpoint.method} ${endpoint.path} ${endpoint.summary}`.toLowerCase();
    if (search && !label.includes(search)) continue;
    if (!groups.has(endpoint.group)) groups.set(endpoint.group, []);
    groups.get(endpoint.group).push(endpoint);
  }
  host.innerHTML = [...groups.entries()].map(([group, list]) => `
    <div class="pg-group"><h3>${escapeHtml(group)}</h3>
      ${list.map((endpoint) => `<button type="button" class="pg-item ${state.pg.endpoint?.path === endpoint.path ? 'is-on' : ''}" data-pg2-endpoint="${escapeHtml(`${endpoint.method} ${endpoint.path}`)}"><b>${endpoint.method}</b><span>${escapeHtml(endpoint.path)}</span></button>`).join('')}
    </div>`).join('') || '<p class="pg-empty">No endpoint matches.</p>';
  for (const button of $$('[data-pg2-endpoint]', host)) {
    button.addEventListener('click', () => {
      const [method, path] = button.dataset.pg2Endpoint.split(' ');
      selectPg2Endpoint(ENDPOINTS.find((endpoint) => endpoint.method === method && endpoint.path === path));
    });
  }
}

function selectPg2Endpoint(endpoint) {
  if (!endpoint) return;
  state.pg.endpoint = endpoint;
  $('[data-pg2-method]').textContent = endpoint.method;
  $('[data-pg2-path]').value = samplePath(endpoint.path);
  $('[data-pg2-summary]').textContent = `${endpoint.summary ?? ''} — scope ${endpoint.scope ?? 'public'}, ${endpoint.base ?? 0} base credits.`;
  for (const item of $$('.pg-item')) item.classList.toggle('is-on', item.dataset.pg2Endpoint === `${endpoint.method} ${endpoint.path}`);
  const host = $('[data-pg2-params]');
  host.innerHTML = '';
  for (const param of paramsFor(endpoint)) {
    const field = el('label', { class: 'field' });
    field.append(el('span', {}, param.name));
    if (param.type === 'select') {
      const select = el('select', { class: 'select' });
      fillSelect(select, param.options.map((option) => ({ value: option, label: option || 'any' })), { value: param.value ?? '' });
      select.dataset.pg2Param = param.name;
      field.append(select);
    } else {
      field.append(el('input', { class: 'input', type: param.type, placeholder: param.placeholder ?? '', value: param.value ?? '', dataset: { pg2Param: param.name } }));
    }
    host.append(field);
  }
}

function pg2Query() {
  const query = {};
  for (const input of $$('[data-pg2-param]')) if (input.value !== '') query[input.dataset.pg2Param] = input.value;
  return query;
}

function currentKey() {
  const keys = api.keys().filter((key) => !key.revokedAt);
  return keys.find((key) => key.id === $('[data-pg-key]').value) ?? keys[0];
}

async function sendPg2() {
  const status = $('[data-pg2-status]');
  const key = currentKey();
  const path = $('[data-pg2-path]').value.trim();
  const accept = $('[data-pg-accept]').value;
  status.className = 'pg-output__status is-busy';
  status.textContent = 'Sending…';
  const response = await api.request({
    path,
    query: pg2Query(),
    headers: { ...keyAuth(key), accept },
    delay: true,
  });
  state.pg.response = response;
  const ok = response.status < 400;
  status.className = `pg-output__status ${ok ? 'is-ok' : 'is-error'}`;
  status.textContent = ok
    ? `${response.status} ${response.status === 200 ? 'OK' : ''} · ${response.credits} credits · ${response.durationMs} ms`
    : `${response.status} ${response.body?.code ?? 'error'} · 0 credits`;
  $('[data-pg2-body]').innerHTML = `<code>${response.format && response.format !== 'json' ? escapeHtml(response.raw) : highlightJson(response.body)}</code>`;
  $('[data-pg2-headers]').innerHTML = `<code>${highlightShell(Object.entries(response.headers).map(([name, value]) => `${name}: ${value}`).join('\n'))}</code>`;
  $('[data-pg2-curl]').innerHTML = `<code>${highlightShell(api.curls(path, pg2Query(), { key: key?.secret ?? 'hdk_sk_YOUR_KEY', accept: accept !== 'application/json' ? accept : null }))}</code>`;
  renderPipeline(response);
  if (state.pg.tab === 'chart') renderPg2Chart();
  renderKeys();
  renderSide();
  if (state.view === 'usage') renderUsage();
}

function renderPipeline(response) {
  const host = $('[data-pg2-timing]');
  if (!host) return;
  const endpoint = response.endpoint ?? state.pg.endpoint;
  const length = Math.max(1, response.durationMs);
  const stages = [
    ['authenticate', 0.06],
    ['scope + plan', 0.05],
    ['rate limit', 0.04],
    ['history check', 0.05],
    ['reserve credits', 0.08],
    ['handler', 0.58],
    ['serialise', 0.14],
  ];
  host.innerHTML = `<div class="pipeline__bar">${stages.map(([label, share]) => `<i style="flex:${share}" title="${label}">${share > 0.12 ? escapeHtml(label) : ''}</i>`).join('')}</div>
    <div class="pipeline__meta">
      <span>total ${length} ms</span>
      <span>rows ${response.rows ?? 0}</span>
      <span>credits ${response.credits ?? 0}</span>
      <span>format ${escapeHtml(response.format ?? 'json')}</span>
    </div>
    <ol class="pipeline__list">${stages.map(([label, share]) => `<li><span>${escapeHtml(label)}</span><span class="mono">${(share * length).toFixed(1)} ms</span></li>`).join('')}</ol>`;
}

function renderPg2Chart() {
  const view = $('[data-pg2-chart-view]');
  if (!view || view.hidden) return;
  const canvas = $('[data-pg2-chart]');
  const wrap = canvas.parentElement;
  const rows = state.pg.response?.body?.data;
  if (!Array.isArray(rows) || !rows.length) return;
  const first = rows[0];
  const keys = Object.keys(first);
  if ('o' in first && 'c' in first) {
    drawCandles(canvas, rows, { theme: theme(), width: wrap.clientWidth - 20, height: wrap.clientHeight - 20, formatter: (value) => price(value, 2) });
  } else if (Array.isArray(first.levels)) {
    drawHBars(canvas, first.levels.map((level) => ({ label: price(level.px, 2), value: Number(level.notional_usd) })), { theme: theme(), width: wrap.clientWidth - 20, formatter: (value) => money(value, { compact: true }) });
  } else if (keys.includes('t')) {
    const valueKey = keys.find((key) => typeof first[key] === 'number');
    if (valueKey) drawArea(canvas, rows, { theme: theme(), width: wrap.clientWidth - 20, height: wrap.clientHeight - 20, yKey: valueKey, axisFormatter: (value) => money(value, { compact: true }) });
  } else {
    const valueKey = keys.find((key) => key.includes('usd') || key.includes('pnl') || key.includes('notional'));
    if (valueKey) drawHBars(canvas, rows.slice(0, 16).map((row) => ({ label: String(row.coin ?? row.address?.slice(0, 8) ?? ''), value: Number(row[valueKey]) })), { theme: theme(), width: wrap.clientWidth - 20, formatter: (value) => money(value, { compact: true }) });
  }
}

function bindPg2() {
  renderPg2List();
  $('[data-pg2-search]').addEventListener('input', debounce(renderPg2List, 120));
  $('[data-pg2-send]').addEventListener('click', sendPg2);
  $('[data-pg2-path]').addEventListener('keydown', (event) => { if (event.key === 'Enter') sendPg2(); });
  for (const button of $$('[data-pg2-tab]')) {
    button.addEventListener('click', () => {
      state.pg.tab = button.dataset.pg2Tab;
      for (const other of $$('[data-pg2-tab]')) other.classList.toggle('is-on', other === button);
      $('[data-pg2-body]').hidden = state.pg.tab !== 'body';
      $('[data-pg2-headers]').hidden = state.pg.tab !== 'headers';
      $('[data-pg2-curl]').hidden = state.pg.tab !== 'curl';
      $('[data-pg2-timing]').hidden = state.pg.tab !== 'timing';
      $('[data-pg2-chart-view]').hidden = state.pg.tab !== 'chart';
      if (state.pg.tab === 'chart') renderPg2Chart();
    });
  }
  $('[data-pg2-copy]').addEventListener('click', () => {
    const response = state.pg.response;
    if (!response) return toast('Send a request first', { tone: 'warn' });
    copyText(response.raw ?? JSON.stringify(response.body, null, 2), { label: 'Response copied' });
  });
  selectPg2Endpoint(ENDPOINTS.find((endpoint) => endpoint.path === '/v1/markets/:coin/candles') ?? ENDPOINTS[0]);
}

/* ------------------------------------------------------------ stream lab */

const STREAM_CHANNEL_OPTIONS = STREAM_CHANNELS.map((channel) => ({ value: channel.channel, label: `${channel.channel} · ${channel.credits} credit${channel.credits > 1 ? 's' : ''}/event` }));

function appendStreamLog(message, direction = 'in') {
  const host = $('[data-stream-log]');
  const row = el('div', { class: `stream-entry stream-entry--${direction}` });
  const opClass = message.op === 'error' ? 'is-error' : message.op === 'data' || message.op === 'acked' ? 'is-ok' : '';
  const preview = message.op === 'data'
    ? JSON.stringify(message.events?.[0] ?? {}).slice(0, 200)
    : message.op === 'ready' || message.op === 'ping'
      ? ''
      : JSON.stringify(message);
  row.innerHTML = `<span class="stream-entry__time mono">${new Date().toISOString().slice(11, 19)}</span>
    <span class="stream-entry__dir">${direction === 'in' ? '←' : '→'}</span>
    <span class="stream-entry__op ${opClass}">${escapeHtml(message.op ?? 'message')}</span>
    <span class="stream-entry__body mono">${escapeHtml(preview)}</span>`;
  host.prepend(row);
  while (host.children.length > 120) host.lastElementChild.remove();
}

function updateStreamStats(stats) {
  $('[data-stream-batches]').textContent = integer(stats.batches);
  $('[data-stream-acked]').textContent = integer(stats.acked);
  $('[data-stream-events]').textContent = integer(stats.events);
  $('[data-stream-credits]').textContent = integer(stats.credits);
}

function bindStreams() {
  const channelSelect = $('[data-stream-channel]');
  fillSelect(channelSelect, STREAM_CHANNEL_OPTIONS, { value: 'trades' });
  const intervalField = $('[data-stream-interval-field]');
  const target = $('[data-stream-target]');
  const syncChannel = () => {
    const meta = STREAM_CHANNELS.find((channel) => channel.channel === channelSelect.value);
    intervalField.hidden = channelSelect.value !== 'candles';
    if (meta?.target === 'address') target.value = DEMO_ACCOUNT;
    else if (meta?.target === 'all') target.value = '*';
    else if (target.value === DEMO_ACCOUNT || target.value === '*') target.value = 'BTC';
  };
  channelSelect.addEventListener('change', syncChannel);
  syncChannel();

  const stats = { batches: 0, acked: 0, events: 0, credits: 0 };
  const update = () => updateStreamStats(stats);
  update();

  $('[data-stream-connect]').addEventListener('click', () => {
    const key = api.keys().find((entry) => entry.id === $('[data-stream-key]').value) ?? activeKey();
    if (!key) return toast('Create a key first', { tone: 'warn' });
    if (state.stream) state.stream.close(1000, 'reconnect');
    const stream = api.openStream({
      key: key.secret,
      onMessage: (message) => {
        appendStreamLog(message, 'in');
        if (message.op === 'ready') {
          $('[data-stream-state]').textContent = 'connected';
          $('[data-stream-subscribe]').disabled = false;
          $('[data-stream-disconnect]').disabled = false;
          $('[data-stream-connect]').disabled = true;
          $('[data-stream-state]').className = 'chip chip--up';
        }
        if (message.op === 'subscribed') {
          state.streamSub = message.sub;
          $('[data-stream-unsubscribe]').disabled = false;
          toast(`Subscribed to ${message.channel}`);
        }
        if (message.op === 'data') {
          stats.batches += 1;
          stats.events += message.events.length;
          update();
          if (state.streamAutoAck) {
            stream.send({ op: 'ack', sub: message.sub, batch: message.batch });
          } else {
            $('[data-stream-ack]').dataset.batch = String(message.batch);
          }
        }
        if (message.op === 'acked') {
          stats.acked += 1;
          stats.credits += message.credits_charged ?? 0;
          update();
          renderSide();
        }
        if (message.op === 'error') {
          toast(`${message.code}: ${message.detail}`, { tone: 'error', timeout: 5_000 });
          if (message.code === 'ack_timeout') {
            state.streamSub = null;
            $('[data-stream-unsubscribe]').disabled = true;
          }
        }
        if (message.op === 'unsubscribed') {
          state.streamSub = null;
          $('[data-stream-unsubscribe]').disabled = true;
        }
      },
      onClose: ({ code, reason }) => {
        appendStreamLog({ op: 'closed', code, reason }, 'in');
        $('[data-stream-state]').textContent = `closed ${code}`;
        $('[data-stream-state]').className = 'chip chip--down';
        $('[data-stream-connect]').disabled = false;
        $('[data-stream-disconnect]').disabled = true;
        $('[data-stream-subscribe]').disabled = true;
        $('[data-stream-unsubscribe]').disabled = true;
      },
    });
    state.stream = stream;
  });

  $('[data-stream-disconnect]').addEventListener('click', () => state.stream?.close(1000, 'client_closed'));
  $('[data-stream-subscribe]').addEventListener('click', () => {
    if (!state.stream) return toast('Connect first', { tone: 'warn' });
    const message = { op: 'subscribe', channel: channelSelect.value };
    const meta = STREAM_CHANNELS.find((channel) => channel.channel === channelSelect.value);
    const value = target.value.trim();
    if (meta?.target === 'address') message.address = value;
    else message.coin = value || '*';
    if (channelSelect.value === 'candles') message.interval = $('[data-stream-interval]').value;
    state.stream.send(message);
    appendStreamLog(message, 'out');
  });
  $('[data-stream-unsubscribe]').addEventListener('click', () => {
    if (!state.stream || state.streamSub === null) return;
    const message = { op: 'unsubscribe', sub: state.streamSub };
    state.stream.send(message);
    appendStreamLog(message, 'out');
  });
  $('[data-stream-ack]').addEventListener('click', (event) => {
    if (!state.stream || state.streamSub === null) return;
    const batch = Number(event.currentTarget.dataset.batch ?? 0);
    const message = { op: 'ack', sub: state.streamSub, batch };
    state.stream.send(message);
    appendStreamLog(message, 'out');
  });
  $('[data-stream-clear]').addEventListener('click', () => { $('[data-stream-log]').innerHTML = ''; });
  $('[data-stream-auto]').addEventListener('change', (event) => {
    state.streamAutoAck = event.target.checked;
    toast(state.streamAutoAck ? 'Auto-acknowledge on' : 'Auto-acknowledge off — batches expire after 10 s', { tone: state.streamAutoAck ? 'ok' : 'warn' });
  });
}

/* ------------------------------------------------------------ concepts lab */

const SCENARIOS = [
  {
    id: 'ok',
    title: 'Happy path',
    detail: 'Markets read · 1,000 rows · Starter key',
    request: () => ({ path: '/v1/markets/BTC/trades', query: { limit: 1000 }, headers: keyAuth(activeKey()) }),
  },
  {
    id: 'nokey',
    title: 'Missing key',
    detail: 'Same request with no Authorization header',
    request: () => ({ path: '/v1/markets/BTC/trades', query: { limit: 10 }, headers: {} }),
  },
  {
    id: 'scope',
    title: 'Scope not granted',
    detail: 'A stream-only key calling an accounts endpoint',
    request: () => {
      const key = api.issueKey({ name: 'stream-only', scopes: ['streams:read'] });
      return { path: `/v1/accounts/${DEMO_ACCOUNT}/positions`, headers: keyAuth(key), temp: key.id };
    },
  },
  {
    id: 'feature',
    title: 'Feature not in plan',
    detail: 'L4 book on Starter (Growth and up)',
    request: () => ({ path: '/v1/markets/BTC/book/orders', query: { limit: 100 }, headers: keyAuth(activeKey()) }),
  },
  {
    id: 'history',
    title: 'History limit',
    detail: 'Fills from 200 days ago on Starter (90 days)',
    request: () => ({
      path: `/v1/accounts/${DEMO_ACCOUNT}/fills`,
      query: { start_time: Date.now() - 200 * 86_400_000 },
      headers: keyAuth(activeKey()),
    }),
  },
  {
    id: 'throttled',
    title: 'Rate limited',
    detail: 'Exhaust the token bucket, then retry for a real 429',
    request: () => ({ path: '/v1/markets/mids', headers: keyAuth(activeKey()) }),
    burst: true,
  },
  {
    id: 'maxcredits',
    title: 'X-Max-Credits exceeded',
    detail: 'Refuse before running when the ceiling is too low',
    request: () => ({
      path: '/v1/markets/BTC/trades',
      query: { limit: 1000 },
      headers: { ...keyAuth(activeKey()), 'x-max-credits': '5' },
    }),
  },
  {
    id: 'range',
    title: 'Range too large',
    detail: 'Ask for 30 days of trades (max 1 day)',
    request: () => ({
      path: '/v1/markets/BTC/trades',
      query: { start_time: Date.now() - 30 * 86_400_000, limit: 100 },
      headers: keyAuth(activeKey()),
    }),
  },
  {
    id: 'unknown',
    title: 'Unknown market',
    detail: 'A coin spelled differently from GET /v1/markets',
    request: () => ({ path: '/v1/markets/Bitcoin/candles', query: { limit: 10 }, headers: keyAuth(activeKey()) }),
  },
  {
    id: 'quote',
    title: 'Free quote',
    detail: 'Price before running — zero credits, no handler',
    request: () => ({ path: '/v1/quote', query: { route: 'GET /v1/markets/BTC/trades?limit=1000' }, headers: keyAuth(activeKey()) }),
  },
];

function renderLab() {
  const host = $('[data-lab-scenarios]');
  host.innerHTML = SCENARIOS.map((scenario) => `<button type="button" class="scenario ${state.labScenario === scenario.id ? 'is-on' : ''}" data-scenario="${scenario.id}">
    <b>${escapeHtml(scenario.title)}</b><span>${escapeHtml(scenario.detail)}</span>
  </button>`).join('');
  for (const button of $$('[data-scenario]', host)) {
    button.addEventListener('click', () => {
      state.labScenario = button.dataset.scenario;
      for (const other of $$('[data-scenario]', host)) other.classList.toggle('is-on', other === button);
      renderGates([], 'idle');
      $('[data-lab-output]').innerHTML = '<code>Run the scenario to see the response.</code>';
    });
  }
  renderGates([], 'idle');
}

function renderGates(gates, verdict) {
  const host = $('[data-lab-gates]');
  host.innerHTML = (gates.length ? gates : ['authenticate', 'scope + plan', 'rate limit', 'history check', 'reserve credits', 'handler', 'charge'].map((title) => ({ title, status: 'pending' })))
    .map((gate, index) => `<li class="gate gate--${gate.status}">
      <span class="gate__index mono">${String(index + 1).padStart(2, '0')}</span>
      <div class="gate__body"><b>${escapeHtml(gate.title)}</b>${gate.detail ? `<span>${escapeHtml(gate.detail)}</span>` : ''}</div>
      <span class="gate__status">${gate.status === 'pass' ? 'pass' : gate.status === 'fail' ? 'stopped' : gate.status === 'skip' ? 'skipped' : '—'}</span>
    </li>`).join('');
  const chip = $('[data-lab-verdict]');
  chip.textContent = verdict === 'idle' ? 'idle' : verdict;
  chip.className = `chip ${verdict === 'idle' ? '' : verdict === '200' ? 'chip--up' : 'chip--down'}`;
}

async function runLabScenario() {
  const scenario = SCENARIOS.find((entry) => entry.id === state.labScenario);
  if (!scenario) return;
  const plan = api.plan();
  const limit = Number($('[data-lab-limit]').value) || 1000;
  const maxCredits = $('[data-lab-max-credits]').value;
  const gates = [];
  const request = scenario.request();
  const headers = { ...request.headers };
  if (maxCredits) headers['x-max-credits'] = maxCredits;

  const credential = Object.entries(headers).length ? 'key provided' : 'no Authorization header';
  gates.push({ title: 'authenticate', status: headers.authorization ? 'pass' : 'fail', detail: headers.authorization ? 'Bearer key resolved to a project' : 'missing → 401 invalid_key' });

  if (headers.authorization && scenario.id !== 'quote') {
    const endpoint = api.matchRoute('GET', request.path)?.endpoint;
    const need = endpoint?.scope;
    gates.push({ title: 'scope + plan', status: 'pass', detail: need ? `requires ${need} · ${plan.name} features checked` : 'public route' });
  } else if (scenario.id === 'quote') {
    gates.push({ title: 'scope + plan', status: 'skip', detail: 'free route, no scope' });
  } else {
    gates.push({ title: 'scope + plan', status: 'skip', detail: 'not reached' });
  }

  gates.push({
    title: 'rate limit',
    status: headers.authorization ? 'pass' : 'skip',
    detail: `${plan.rps} rps · burst ${plan.burst} · this request asks ${Math.ceil(limit / 1000)} slot(s) of ${plan.concurrency}`,
  });
  gates.push({ title: 'history check', status: request.query?.start_time ? 'pass' : 'skip', detail: request.query?.start_time ? `start_time vs ${plan.historyDays} day depth` : 'no start_time' });
  gates.push({ title: 'reserve credits', status: 'pass', detail: maxCredits ? `X-Max-Credits ${maxCredits} compared with the ceiling` : 'reserve at ceiling, release the rest' });
  gates.push({ title: 'handler', status: 'pass', detail: scenario.burst ? 'runs until the bucket empties' : 'read-only, deterministic' });
  gates.push({ title: 'charge', status: 'pending', detail: 'only rows returned are billed' });
  renderGates(gates.map((gate) => ({ ...gate, status: gate.status === 'pending' ? 'pass' : gate.status })), 'running');

  const submit = async (custom) => api.request({ ...request, ...custom, headers: custom?.headers ?? headers });
  let response;
  if (scenario.burst) {
    response = await submit({ delay: false });
    let attempts = 0;
    while (response.status !== 429 && attempts < plan.burst + 4) {
      response = await submit({ delay: false });
      attempts += 1;
    }
    api.state.buckets.clear();
  } else if (scenario.id === 'feature' && plan.features.l4) {
    api.setPlan('starter');
    renderPlan();
    response = await submit({ delay: false });
    api.setPlan(plan.id);
    renderPlan();
  } else {
    response = await submit({ delay: false });
  }

  const failed = response.status >= 400;
  const finalGates = gates.map((gate) => {
    if (gate.status === 'skip') return gate;
    return gate;
  });
  if (failed) {
    const code = response.body?.code;
    const failingIndex = code === 'invalid_key' ? 0
      : code === 'insufficient_scope' || code === 'feature_not_in_plan' || code === 'plan_required' ? 1
        : code === 'rate_limited' ? 2
          : code === 'history_limit' ? 3
            : 4;
    finalGates.forEach((gate, index) => {
      if (index > failingIndex) { gate.status = 'skip'; gate.detail = 'not reached'; }
      else if (index === failingIndex) { gate.status = 'fail'; gate.detail = `${response.status} ${code} · free`; }
      else if (gate.status !== 'skip') gate.status = 'pass';
    });
    finalGates[6] = { title: 'charge', status: 'skip', detail: 'nothing charged' };
  } else {
    finalGates[6] = { title: 'charge', status: 'pass', detail: `${response.credits} credits for ${response.rows} rows` };
  }
  if (request.temp) {
    const temp = api.keys().find((key) => key.id === request.temp);
    if (temp) api.revokeKey(temp.id);
  }
  renderGates(finalGates, String(response.status));
  $('[data-lab-output]').innerHTML = `<code>${highlightJson({
    request: { method: 'GET', path: request.path, query: request.query ?? {}, headers: { ...headers, authorization: headers.authorization ? 'Bearer hdk_sk_…' : undefined } },
    status: response.status,
    credits: response.credits,
    body: response.body,
  })}</code>`;
  $('[data-lab-note]').textContent = `${credential} · plan ${plan.name} · ${response.durationMs} ms locally.`;
  renderKeys();
  renderSide();
}

/* ------------------------------------------------------------------ plan */

function renderPlan() {
  const plan = api.plan();
  $('[data-plan-switch]').innerHTML = PLAN_ORDER.map((id) => {
    const entry = PLANS[id];
    const active = id === plan.id;
    return `<button type="button" class="plan-card ${active ? 'is-on' : ''}" data-plan-pick="${id}">
      <span class="plan-card__name">${escapeHtml(entry.name)}${active ? '<span class="chip chip--up">current</span>' : ''}</span>
      <b>${entry.priceMonthly === null ? 'Custom' : `$${integer(entry.priceMonthly)}`}</b>
      <span>${entry.credits === null ? 'committed credits' : `${integer(entry.credits)} credits`}</span>
      <span>${entry.historyDays === null ? 'full history' : `${entry.historyDays} days history`} · ${entry.rps} rps</span>
    </button>`;
  }).join('');
  for (const button of $$('[data-plan-pick]')) {
    button.addEventListener('click', () => {
      api.setPlan(button.dataset.planPick);
      toast(`Plan switched to ${api.plan().name}`);
      renderPlan();
      renderKeys();
      renderSide();
      if (state.view === 'usage') renderUsage();
    });
  }
  $('[data-plan-chip]').textContent = plan.id;
  $('[data-plan-limits]').innerHTML = [
    ['Credits per month', plan.credits === null ? 'committed' : integer(plan.credits)],
    ['History depth', plan.historyDays === null ? 'full history' : `${plan.historyDays} days`],
    ['Requests per second', plan.rps],
    ['Burst', plan.burst],
    ['Concurrent requests', plan.concurrency],
    ['Stream connections', plan.streamConnections],
    ['Wallets per batch', integer(plan.batchWallets)],
    ['Rows per wallet list', integer(plan.rowsPerWalletList)],
    ['New wallets per day', integer(plan.newWalletsPerDay)],
    ['Log retention', `${plan.logDays} days`],
    ['Credit rate', plan.creditRatePerMillion ? `$${plan.creditRatePerMillion} / 1M` : 'contract'],
  ].map(([label, value]) => `<tr><th scope="row">${label}</th><td class="mono">${escapeHtml(String(value))}</td></tr>`).join('');
  const featureRows = [
    ['Streams', plan.features.streams, '/v1/stream'],
    ['Footprint', plan.features.footprint, '/v1/markets/{coin}/footprint'],
    ['Order-level (L4) book', plan.features.l4, '/v1/markets/{coin}/book/orders'],
    ['Prediction market outcomes', plan.features.outcomes, '/v1/accounts/{address}/outcomes'],
    ['Priority fee flow', plan.features.priority, '/v1/markets/{coin}/priority-fills'],
    ['Async jobs', plan.features.jobs, '/v1/jobs'],
  ];
  $('[data-plan-features]').innerHTML = featureRows.map(([label, included, endpoint]) => `<tr>
    <th scope="row">${escapeHtml(label)}</th>
    <td>${included ? '<span class="chip chip--up">included</span>' : '<span class="chip chip--down">upgrade</span>'}</td>
    <td><code>${escapeHtml(endpoint)}</code></td>
  </tr>`).join('');
}

/* ------------------------------------------------------------------ boot */

function boot() {
  bindSkin();
  bindNav();
  renderScopes();
  renderKeys();
  bindKeyDialog();
  bindPg2();
  bindStreams();
  renderLab();
  renderPlan();
  renderSide();
  renderUsage();

  $('[data-workspace]').textContent = api.state.workspace;
  $('[data-project]').textContent = api.state.project;

  for (const filter of $$('[data-log-filter]')) {
    filter.addEventListener('click', () => {
      state.logFilter = filter.dataset.logFilter;
      for (const other of $$('[data-log-filter]')) other.classList.toggle('is-on', other === filter);
      renderLog();
    });
  }
  $('[data-simulate-burst]').addEventListener('click', simulateBurst);
  $('[data-buy-credits]').addEventListener('click', buyCredits);
  $('[data-lab-run]').addEventListener('click', runLabScenario);
  $('[data-lab-copy]').addEventListener('click', () => copyText($('[data-lab-output]').textContent, { label: 'Response copied' }));
  $('[data-key-detail-close]').addEventListener('click', hideKeyDetail);
  $('[data-reset]').addEventListener('click', () => {
    api.reset();
    api.issueKey({ name: 'demo-docs', expiresInDays: 365 });
    toast('Demo workspace reset', { tone: 'warn' });
    renderKeys();
    renderUsage();
    renderPlan();
    $('[data-stream-log]').innerHTML = '';
  });

  setInterval(() => { renderSide(); }, 5_000);
  onVisible($('[data-burn-chart]'), () => renderBurnChart());
  window.addEventListener('resize', debounce(() => { renderBurnChart(); renderPg2Chart(); }, 160));
  void clockUTC; void percent; void timeUTC;
  globalThis.__hyperdashConsole = api;
}

boot();
