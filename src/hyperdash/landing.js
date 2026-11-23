import { createMarketEngine } from './market-engine.js';
import { createDataApi, browserStorage, PLANS, STREAM_CHANNELS, SCOPES } from './data-api.js';
import { drawCandles, drawArea, drawHBars, drawDepth, drawHeatmap, drawSparkline } from './charts.js';
import {
  $, $$, el, escapeHtml, money, price, percent, integer, signedMoney, timeUTC, clockUTC, ago,
  copyText, toast, debounce, onVisible, fillSelect, highlightJson, highlightShell, prefersReducedMotion,
} from './lib.js';

/* ==========================================================================
   Boot
   ========================================================================== */

const engine = createMarketEngine();
const api = createDataApi({ engine, storage: browserStorage(), latency: true });
const build = globalThis.__HYPERDASH_BUILD__ ?? { endpoints: [] };

/**
 * Endpoint catalog. The build step extracts the registry into build-meta.js so
 * docs and static assets can share it; when this page is opened straight from
 * source (no build), fall back to the live registry the API factory exposes.
 */
const ENDPOINTS = build.endpoints?.length
  ? build.endpoints
  : api.endpoints.map(({ method, path, group, summary, scope, base, perRow, maxLimit, feature }) => ({
    method, path, group, summary, scope, base, perRow, maxLimit, feature,
  }));

if (!api.keys().length) api.issueKey({ name: 'demo-live', expiresInDays: 365 });
const demoKey = api.keys()[0].secret;

const state = {
  coin: 'BTC',
  interval: '1h',
  candles: [],
  skin: document.documentElement.dataset.skin === 'terminal' ? 'terminal' : 'dash',
  dataset: 'historical',
  datasetFilter: 'all',
  selectedDataset: null,
  pg: { endpoint: null, tab: 'body', response: null },
  billing: 'monthly',
  stream: null,
  reduced: prefersReducedMotion(),
};

const THEME = () => {
  const styles = getComputedStyle(document.documentElement);
  const read = (name, fallback) => styles.getPropertyValue(name).trim() || fallback;
  return {
    accent: read('--accent', '#fd592b'),
    accentInk: read('--accent-ink', '#111'),
    accentAlt: read('--accent-alt', '#5aa9ff'),
    up: read('--up', '#16c784'),
    down: read('--down', '#ea3943'),
    upSoft: read('--up-soft', 'rgba(22,199,132,.2)'),
    downSoft: read('--down-soft', 'rgba(234,57,67,.2)'),
    grid: read('--line-soft', 'rgba(255,255,255,.08)'),
    muted: read('--muted', '#8b8b8b'),
    text: read('--text', '#eee'),
    surface: read('--panel', '#141414'),
    crosshair: read('--line-strong', 'rgba(255,255,255,.2)'),
    lastLine: read('--accent-line', 'rgba(253,89,43,.6)'),
    areaFrom: 'rgba(253,89,43,.30)',
    areaTo: 'rgba(253,89,43,0)',
    mono: styles.getPropertyValue('--font-mono').trim() || 'ui-monospace, monospace',
  };
};

/* ==========================================================================
   Skin
   ========================================================================== */

function applySkin(name, { persist = true } = {}) {
  state.skin = name === 'terminal' ? 'terminal' : 'dash';
  document.documentElement.dataset.skin = state.skin;
  for (const button of $$('[data-skin-target]')) {
    button.setAttribute('aria-pressed', String(button.dataset.skinTarget === state.skin));
  }
  if (persist) {
    try { localStorage.setItem('hyperdash:skin', state.skin); } catch { /* ignore */ }
  }
  document.dispatchEvent(new CustomEvent('hyperdash:skin', { detail: state.skin }));
  // Charts are canvas-based: repaint on the next frame with the new palette.
  requestAnimationFrame(() => {
    renderHero();
    renderPgChart();
    renderWorkflowDemos();
    renderSparklines();
  });
}

function bindSkins() {
  let saved = null;
  try { saved = localStorage.getItem('hyperdash:skin'); } catch { /* ignore */ }
  const query = new URLSearchParams(location.search).get('skin');
  applySkin(query === 'terminal' || query === 'dash' ? query : saved === 'terminal' ? 'terminal' : 'dash', { persist: false });
  for (const button of $$('[data-skin-target]')) {
    button.addEventListener('click', () => applySkin(button.dataset.skinTarget));
  }
}

/* ==========================================================================
   Header, clock, nav
   ========================================================================== */

function bindShell() {
  const header = $('[data-header]');
  const onScroll = () => header.classList.toggle('is-stuck', window.scrollY > 8);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  const menu = $('[data-menu-toggle]');
  menu?.addEventListener('click', () => {
    const open = header.classList.toggle('is-open');
    menu.setAttribute('aria-expanded', String(open));
  });

  const clock = $('[data-clock]');
  const updateClock = () => {
    const now = new Date();
    if (clock) clock.textContent = `${now.toISOString().slice(11, 19)} UTC`;
  };
  updateClock();
  setInterval(updateClock, 1_000);

  for (const link of $$('a[href^="#"]')) {
    link.addEventListener('click', () => {
      header.classList.remove('is-open');
      menu?.setAttribute('aria-expanded', 'false');
    });
  }

  const stat = (name, value) => { const node = $(`[data-stat="${name}"]`); if (node) node.textContent = value; };
  stat('endpoints', `${ENDPOINTS?.length ?? '380'}+`);
  stat('markets', String(engine.markets.length));
}

/* ==========================================================================
   Ticker
   ========================================================================== */

function renderTicker() {
  const host = $('[data-ticker]');
  if (!host) return;
  const rows = engine.listMarkets({ dex: 'core' }).slice(0, 14);
  const item = (row) => {
    const change = Number(row.day_change_pct);
    return `<span class="ticker__item" data-ticker-coin="${escapeHtml(row.coin)}">
      <span class="ticker__coin">${escapeHtml(row.coin)}</span>
      <span class="ticker__px" data-ticker-px>${price(row.mark_px, 2)}</span>
      <span class="ticker__chg ${change >= 0 ? 'up' : 'down'}">${percent(change)}</span>
    </span>`;
  };
  host.innerHTML = `<div class="ticker__track${state.reduced ? ' is-static' : ''}">${rows.map(item).join('')}${rows.map(item).join('')}</div>`;
  const status = $('[data-ticker-status]');
  if (status) status.textContent = `${rows.length} markets live`;
}

function refreshTicker() {
  const track = $('.ticker__track');
  if (!track) return;
  const rows = engine.listMarkets({ dex: 'core' }).slice(0, 14);
  const pxCells = $$('[data-ticker-px]', track);
  const changeCells = $$('.ticker__chg', track);
  pxCells.forEach((cell, index) => {
    const row = rows[index % rows.length];
    if (!row) return;
    const next = price(row.mark_px, 2);
    if (cell.textContent !== next) {
      cell.textContent = next;
      cell.classList.remove('ticker__flash');
      void cell.offsetWidth;
      cell.classList.add('ticker__flash');
    }
  });
  changeCells.forEach((cell, index) => {
    const row = rows[index % rows.length];
    if (!row) return;
    const change = Number(row.day_change_pct);
    cell.textContent = percent(change);
    cell.classList.toggle('up', change >= 0);
    cell.classList.toggle('down', change < 0);
  });
}

/* ==========================================================================
   Hero quote card
   ========================================================================== */

function bindHero() {
  fillSelect($('[data-hero-coin]'), [
    { group: 'Core perps', options: engine.markets.filter((m) => m.dex === 'core').map((m) => ({ value: m.coin, label: `${m.coin} · ${m.name}` })) },
    { group: 'HIP-3 · trade.xyz', options: engine.markets.filter((m) => m.dex === 'xyz').map((m) => ({ value: m.coin, label: `${m.coin.replace('xyz:', '')} · ${m.name}` })) },
  ], { value: state.coin });
  $('[data-hero-coin]').addEventListener('change', (event) => {
    state.coin = event.target.value;
    loadCandles().then(renderHero);
    startFeed();
  });
  for (const button of $$('[data-hero-interval]')) {
    button.addEventListener('click', () => {
      state.interval = button.dataset.heroInterval;
      for (const other of $$('[data-hero-interval]')) {
        other.classList.toggle('is-on', other === button);
        other.setAttribute('aria-pressed', String(other === button));
      }
      loadCandles().then(renderHero);
    });
  }
  window.addEventListener('resize', debounce(() => renderHero({ resize: true }), 140));
}

async function loadCandles() {
  const response = await api.request({
    path: `/v1/markets/${encodeURIComponent(state.coin)}/candles`,
    query: { interval: state.interval, limit: 96 },
    headers: { authorization: `Bearer ${demoKey}` },
    delay: false,
  });
  state.candles = response.status === 200 ? response.body.data : [];
  return state.candles;
}

let heroChartState = null;

function renderHero({ resize = false } = {}) {
  if (!state.candles.length) return;
  const context = engine.ctx(state.coin);
  const decimals = engine.market(state.coin).pxDecimals;
  $('[data-quote-last]').textContent = price(context.mark_px, Math.max(2, decimals));
  const change = Number(context.day_change_pct);
  const changeNode = $('[data-quote-change]');
  changeNode.textContent = `${percent(change)} · 24h`;
  changeNode.classList.toggle('up', change >= 0);
  changeNode.classList.toggle('down', change < 0);
  $('[data-quote-meta]').textContent = `${state.interval} · ${engine.market(state.coin).dex === 'xyz' ? 'HIP-3' : 'PERP'} · ${state.candles.length} bars`;
  $('[data-quote-dex]').textContent = engine.market(state.coin).dex === 'xyz' ? 'HIP-3' : 'PERP';
  $('[data-quote-funding]').textContent = `${(Number(context.funding) * 100).toFixed(4)}%`;
  $('[data-quote-oi]').textContent = money(context.open_interest_usd, { compact: true });
  $('[data-quote-volume]').textContent = money(context.day_volume_usd, { compact: true });
  $('[data-quote-oracle]').textContent = price(context.oracle_px, Math.max(2, decimals));

  const canvas = $('[data-hero-chart]');
  const tip = $('[data-hero-tip]');
  // Size the canvas explicitly so the chart can repaint on resize without losing data.
  const wrap = canvas.parentElement;
  const width = wrap.clientWidth - 12;
  const height = wrap.clientHeight;
  heroChartState = drawCandles(canvas, state.candles, {
    theme: THEME(),
    width,
    height,
    showVolume: true,
    formatter: (value) => price(value, Math.max(2, Math.min(decimals, 2))),
    onHover: (hover) => {
      if (hover.leave || !tip) { if (tip) tip.hidden = true; return; }
      const row = hover.row;
      const t = new Date(row.t).toISOString().slice(5, 16).replace('T', ' ');
      tip.hidden = false;
      tip.innerHTML = `<b>${t} UTC</b><br>O ${price(row.o, 2)} H ${price(row.h, 2)}<br>L ${price(row.l, 2)} C ${price(row.c, 2)}<br>V ${integer(row.v)}`;
      const left = Math.min(Math.max(hover.x, 72), width - 72);
      tip.style.left = `${left + 6}px`;
      tip.style.top = `${Math.max(6, Math.min(hover.y - 10, height - 92))}px`;
    },
  });
  void heroChartState;
  void resize;
}

/* ==========================================================================
   Live feed (stream demo on the landing page)
   ========================================================================== */

function startFeed() {
  if (state.stream) state.stream.send({ op: 'unsubscribe', sub: 1 });
  state.stream?.close(1000, 'restart');
  const rowsHost = $('[data-live-feed-rows]');
  const label = $('.live-feed__label');
  if (label) label.innerHTML = `<span class="pulse"></span> stream · trades · ${escapeHtml(state.coin)}`;
  if (rowsHost) rowsHost.innerHTML = '';
  const stream = api.openStream({
    key: demoKey,
    onMessage: (message) => {
      if (message.op === 'data' && message.sub === 1) {
        for (const trade of message.events) appendTradeRow(trade);
        stream.send({ op: 'ack', sub: 1, batch: message.batch });
      }
      if (message.op === 'error' && message.code === 'ack_timeout') {
        stream.send({ op: 'subscribe', channel: 'trades', coin: state.coin });
      }
    },
  });
  state.stream = stream;
  stream.send({ op: 'subscribe', channel: 'trades', coin: state.coin });
}

function appendTradeRow(trade) {
  const host = $('[data-live-feed-rows]');
  if (!host || !trade) return;
  const row = el('div', { class: 'live-row' });
  const buy = trade.side === 'B';
  row.innerHTML = `
    <span class="muted">${new Date(trade.t).toISOString().slice(11, 19)}</span>
    <span class="${buy ? 'side-buy' : 'side-sell'}">${buy ? 'BUY' : 'SELL'}</span>
    <span>${price(trade.px, 2)}</span>
    <span>${money(trade.notional, { compact: true })}</span>`;
  host.prepend(row);
  while (host.children.length > 8) host.lastElementChild.remove();
}

/* ==========================================================================
   Dataset cards + Now table
   ========================================================================== */

function renderDatasetCards() {
  const auth = { authorization: `Bearer ${demoKey}` };
  const rows = {
    fills: [
      ['BTC long · 12m ago', '+$412,900'],
      ['ETH short · closed', '+$88,140'],
      ['HYPE long · 41m ago', '−$12,004'],
      ['xyz:TSLA short · 2h', '+$204,120'],
    ],
    orders: [
      ['BTC reduce-only TP', '$108,400'],
      ['ETH limit bid', '$3,812.4'],
      ['SOL trigger stop', '$178.20'],
      ['open orders · wallet', '14'],
    ],
    positions: [
      ['BTC long 3.2× · $4.8M', '+$212,400'],
      ['ETH short 1.8× · $1.1M', '−$18,220'],
      ['HYPE long 5× · $640k', '+$41,900'],
      ['TWAP running', '2 slices'],
    ],
    liquidations: [
      ['BTC long', '$1.24M'],
      ['ETH short', '$318,900'],
      ['DOGE long', '$96,400'],
      ['last cascade', '4m ago'],
    ],
    funding: [
      ['BTC', '+0.0019% / 1h'],
      ['ETH', '−0.0008% / 1h'],
      ['HYPE', '+0.0064% / 1h'],
      ['xyz:TSLA', '+0.0011% / 1h'],
    ],
    more: [
      ['Candles', '1s → 1M'],
      ['Footprint', 'Growth+'],
      ['Cohorts', '12 min rebuild'],
      ['Leaderboards', '380+ endpoints'],
    ],
  };
  for (const [key, list] of Object.entries(rows)) {
    const host = $(`[data-dataset-rows="${key}"]`);
    if (!host) continue;
    host.innerHTML = list.map(([label, value]) => `<div><span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b></div>`).join('');
  }
  // Populate the "now" table from the live registry.
  api.request({ path: '/v1/datasets', delay: false }).then((response) => {
    const datasets = response.body?.data ?? [];
    state.datasets = datasets;
    renderDatasetTable();
    if (datasets[0]) selectDataset(datasets[0].id);
  });
  void auth;
}

function datasetKind(item) {
  if (item.freshness === 'live') return 'live';
  if (item.freshness === 'seconds' || item.freshness === '1 s') return 'seconds';
  if (item.freshness.includes('min')) return 'derived';
  return 'history';
}

function renderDatasetTable() {
  const host = $('[data-dataset-table]');
  if (!host || !state.datasets) return;
  const filter = state.datasetFilter;
  const visible = state.datasets.filter((item) => filter === 'all' || datasetKind(item) === filter);
  host.innerHTML = visible.map((item) => `
    <tr data-clickable data-dataset-id="${escapeHtml(item.id)}" class="${state.selectedDataset === item.id ? 'is-selected' : ''}" tabindex="0">
      <td><div class="pair"><b>${escapeHtml(item.title)}</b></div><div class="muted" style="font-size:11.5px">${escapeHtml(item.description)}</div></td>
      <td><span class="chip ${item.freshness === 'live' ? 'chip--up' : ''}">${escapeHtml(item.freshness)}</span></td>
      <td class="mono">${item.coverage_from ? new Date(item.coverage_from).toISOString().slice(0, 10) : 'live'}</td>
      <td class="mono">${escapeHtml(item.plans.join(' · '))}</td>
      <td class="num mono muted">${ago(item.as_of)}</td>
    </tr>`).join('') || '<tr><td colspan="5" class="muted" style="padding:24px">No datasets in this filter.</td></tr>';
  for (const row of $$('[data-dataset-id]', host)) {
    const open = () => selectDataset(row.dataset.datasetId);
    row.addEventListener('click', open);
    row.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); } });
  }
}

async function selectDataset(id) {
  state.selectedDataset = id;
  for (const row of $$('[data-dataset-id]')) row.classList.toggle('is-selected', row.dataset.datasetId === id);
  const item = state.datasets?.find((entry) => entry.id === id);
  const host = $('[data-dataset-preview]');
  if (!item || !host) return;
  const endpoint = item.endpoints[0].replace('{coin}', 'BTC').replace('{address}', '0x8f4e2c7a9b1d5e6f3a0c8b2d4e7f190a3c5b8d02');
  const response = await api.request({
    path: endpoint.split(' ')[1],
    query: { limit: 4 },
    headers: { authorization: `Bearer ${demoKey}` },
    delay: false,
  });
  const rows = Array.isArray(response.body?.data) ? response.body.data.slice(0, 4) : [];
  const columns = rows[0] ? Object.keys(rows[0]).slice(0, 5) : [];
  host.innerHTML = `
    <div class="dataset-preview__head">
      <h3>${escapeHtml(item.title)}</h3>
      <span>${response.status === 200 ? `${response.credits} credits · ${rows.length} rows` : escapeHtml(response.body?.code ?? 'error')}</span>
    </div>
    ${rows.length ? `<table class="table"><thead><tr>${columns.map((key) => `<th scope="col">${escapeHtml(key)}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((row) => `<tr>${columns.map((key) => `<td class="mono">${escapeHtml(formatCell(row[key]))}</td>`).join('')}</tr>`).join('')}</tbody></table>` : ''}
    <pre class="code-block"><code>${highlightJson({ data: rows, meta: response.body?.meta })}</code></pre>`;
}

function formatCell(value) {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') return Array.isArray(value) ? `[${value.length}]` : JSON.stringify(value).slice(0, 26);
  if (typeof value === 'number' && Math.abs(value) > 1e6) return money(value, { compact: true });
  return String(value).slice(0, 30);
}

function bindDatasets() {
  const tabs = $$('[data-dataset-tab]');
  const syncBar = () => {
    const active = tabs.find((tab) => tab.classList.contains('is-on'));
    const bar = $('.dataset-tabs__bar');
    if (active && bar) {
      bar.style.width = `${active.offsetWidth}px`;
      bar.style.transform = `translateX(${active.offsetLeft - 4}px)`;
    }
  };
  for (const tab of tabs) {
    tab.addEventListener('click', () => {
      for (const other of tabs) {
        other.classList.toggle('is-on', other === tab);
        other.setAttribute('aria-selected', String(other === tab));
      }
      state.dataset = tab.dataset.datasetTab;
      $('[data-dataset-panel="historical"]').hidden = state.dataset !== 'historical';
      $('[data-dataset-panel="now"]').hidden = state.dataset !== 'now';
      syncBar();
    });
  }
  syncBar();
  window.addEventListener('resize', debounce(syncBar, 150));
  for (const chip of $$('[data-dataset-filter]')) {
    chip.addEventListener('click', () => {
      state.datasetFilter = chip.dataset.datasetFilter;
      for (const other of $$('[data-dataset-filter]')) other.classList.toggle('is-on', other === chip);
      renderDatasetTable();
    });
  }
}

/* ==========================================================================
   Playground
   ========================================================================== */

const PARAM_SPECS = {
  default: [
    { name: 'limit', type: 'number', placeholder: '100' },
    { name: 'start_time', type: 'datetime', hint: 'unix ms' },
    { name: 'end_time', type: 'datetime', hint: 'unix ms' },
  ],
  candle: [{ name: 'interval', type: 'select', options: ['1m', '5m', '15m', '1h', '4h', '1d'], value: '1h' }, { name: 'limit', type: 'number', value: '120' }],
  markets: [{ name: 'dex', type: 'select', options: ['', 'core', 'xyz'] }, { name: 'category', type: 'select', options: ['', 'crypto', 'equity', 'index', 'commodity', 'fx', 'pre-ipo'] }],
  windows: [{ name: 'window', type: 'select', options: ['24h', '7d', '30d', '90d', 'all'], value: '7d' }, { name: 'sort', type: 'select', options: ['pnl', 'roi'] }],
  address: [{ name: 'limit', type: 'number' }],
};

function paramsFor(endpoint) {
  if (endpoint.path === '/v1/quote') {
    return [{ name: 'route', type: 'text', wide: true, value: `GET ${samplePath('/v1/markets/:coin/candles')}?interval=1h&limit=24` }];
  }
  if (endpoint.path === '/v1/accounts/batch') return [{ name: 'addresses', type: 'text', value: '0x8f4e2c7a9b1d5e6f3a0c8b2d4e7f190a3c5b8d02', wide: true }];
  if (endpoint.maxLimit > 1 && endpoint.maxLimit < 50) return [{ name: 'limit', type: 'number', value: String(Math.min(endpoint.maxLimit, 20)) }];
  if (endpoint.path.includes('/candles')) return PARAM_SPECS.candle;
  if (endpoint.path === '/v1/markets') return PARAM_SPECS.markets;
  if (endpoint.path.includes('leaderboard')) return PARAM_SPECS.windows;
  // Endpoints capped at a single row or a fixed ceiling do not take `limit`.
  if ((endpoint.maxLimit ?? 0) <= 1) return [];
  if (endpoint.path.includes(':address')) return PARAM_SPECS.address;
  if (endpoint.path.includes(':coin')) return [{ name: 'limit', type: 'number', value: '60' }];
  return PARAM_SPECS.default.slice(0, 1);
}

function samplePath(path) {
  return path
    .replace(/[{:]coin[^/]*/g, encodeURIComponent(state.coin))
    .replace(/[{:]address[^/]*/g, '0x8f4e2c7a9b1d5e6f3a0c8b2d4e7f190a3c5b8d02');
}

function renderPgList() {
  const host = $('[data-pg-groups]');
  const search = $('[data-pg-search]')?.value.trim().toLowerCase() ?? '';
  const groups = new Map();
  for (const endpoint of ENDPOINTS) {
    const label = `${endpoint.method} ${endpoint.path}`;
    if (search && !label.toLowerCase().includes(search) && !(endpoint.summary ?? '').toLowerCase().includes(search)) continue;
    if (!groups.has(endpoint.group)) groups.set(endpoint.group, []);
    groups.get(endpoint.group).push(endpoint);
  }
  if (!groups.size) {
    host.innerHTML = '<p class="pg-empty">No endpoint matches that search.</p>';
    return;
  }
  host.innerHTML = [...groups.entries()].map(([group, list]) => `
    <div class="pg-group">
      <h3>${escapeHtml(group)}</h3>
      ${list.map((endpoint) => `
        <button type="button" class="pg-item ${state.pg.endpoint?.path === endpoint.path && state.pg.endpoint?.method === endpoint.method ? 'is-on' : ''}"
          data-pg-endpoint="${escapeHtml(endpoint.method)} ${escapeHtml(endpoint.path)}">
          <b>${escapeHtml(endpoint.method)}</b><span>${escapeHtml(endpoint.path)}</span>
        </button>`).join('')}
    </div>`).join('');
  for (const button of $$('[data-pg-endpoint]', host)) {
    button.addEventListener('click', () => {
      const [method, path] = button.dataset.pgEndpoint.split(' ');
      selectEndpoint(ENDPOINTS.find((endpoint) => endpoint.method === method && endpoint.path === path));
    });
  }
}

function selectEndpoint(endpoint) {
  if (!endpoint) return;
  state.pg.endpoint = endpoint;
  $('[data-pg-method]').textContent = endpoint.method;
  $('[data-pg-path]').value = samplePath(endpoint.path);
  $('[data-pg-summary]').textContent = endpoint.summary ?? '';
  for (const item of $$('.pg-item')) {
    item.classList.toggle('is-on', item.dataset.pgEndpoint === `${endpoint.method} ${endpoint.path}`);
  }
  const params = paramsFor(endpoint);
  const host = $('[data-pg-params]');
  host.innerHTML = '';
  for (const param of params) {
    const field = el('label', { class: param.wide ? 'field field--wide' : 'field' });
    field.append(el('span', {}, param.hint ? `${param.name} · ${param.hint}` : param.name));
    if (param.type === 'select') {
      const select = el('select', { class: 'select', dataset: { pgParam: param.name } });
      fillSelect(select, param.options.map((option) => ({ value: option, label: option || 'any' })), { value: param.value ?? '' });
      select.dataset.pgParam = param.name;
      field.append(select);
    } else {
      field.append(el('input', {
        class: 'input', type: param.type === 'number' ? 'number' : 'text',
        placeholder: param.placeholder ?? '', value: param.value ?? '',
        dataset: { pgParam: param.name },
      }));
    }
    host.append(field);
  }
  host.append(el('p', { class: 'pg-param-note' }, `Scope ${endpoint.scope ?? 'public · free'} · base ${endpoint.base ?? 0} credits + ${endpoint.perRow ?? 0} per row · max limit ${endpoint.maxLimit ?? '—'}. Leave a parameter empty to omit it.`));
  if (state.pg.tab === 'chart') setPgTab('chart');
}

function pgQuery() {
  const query = {};
  for (const input of $$('[data-pg-param]')) {
    if (input.value !== '') query[input.dataset.pgParam] = input.value;
  }
  return query;
}

async function sendRequest() {
  const path = $('[data-pg-path]').value.trim();
  const accept = $('[data-pg-accept]').value;
  const status = $('[data-pg-status]');
  status.className = 'pg-output__status is-busy';
  status.textContent = 'Sending…';
  const response = await api.request({
    path,
    query: pgQuery(),
    headers: { authorization: `Bearer ${demoKey}`, accept },
    delay: true,
  });
  state.pg.response = response;
  const ok = response.status < 400;
  status.className = `pg-output__status ${ok ? 'is-ok' : 'is-error'}`;
  status.textContent = ok
    ? `${response.status} · ${response.credits} credits · ${response.durationMs} ms`
    : `${response.status} ${response.body?.code ?? 'error'} · 0 credits`;

  const body = $('[data-pg-body]');
  if (response.format === 'csv' || response.format === 'ndjson') {
    body.innerHTML = `<code>${escapeHtml(response.raw)}</code>`;
  } else {
    body.innerHTML = `<code>${highlightJson(response.body)}</code>`;
  }
  const headers = $('[data-pg-headers]');
  headers.innerHTML = `<code>${highlightShell(Object.entries(response.headers).map(([key, value]) => `${key}: ${value}`).join('\n'))}</code>`;
  const curl = $('[data-pg-curl]');
  curl.innerHTML = `<code>${highlightShell(api.curls(path, pgQuery(), { key: demoKey, accept: accept !== 'application/json' ? accept : null }))}</code>`;
  document.dispatchEvent(new CustomEvent('hyperdash:usage'));
  if (state.pg.tab === 'chart') renderPgChart();
}

function setPgTab(tab) {
  state.pg.tab = tab;
  for (const button of $$('[data-pg-tab]')) button.classList.toggle('is-on', button.dataset.pgTab === tab);
  $('[data-pg-body]').hidden = tab !== 'body';
  $('[data-pg-headers]').hidden = tab !== 'headers';
  $('[data-pg-curl]').hidden = tab !== 'curl';
  $('[data-pg-chart-view]').hidden = tab !== 'chart';
  if (tab === 'chart') renderPgChart();
}

function renderPgChart() {
  if (state.pg.tab !== 'chart' || $('[data-pg-chart-view]').hidden) return;
  const canvas = $('[data-pg-chart]');
  const wrap = canvas.parentElement;
  const rows = state.pg.response?.body?.data;
  const theme = THEME();
  const formatter = (value) => money(value, { compact: true });
  if (!Array.isArray(rows) || !rows.length) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    canvas.parentElement.insertAdjacentHTML('afterbegin', '');
    return;
  }
  const first = rows[0];
  const keys = Object.keys(first);
  const timeKey = keys.find((key) => key === 't' || key === 'date');
  if ('o' in first && 'c' in first) {
    drawCandles(canvas, rows, { theme, width: wrap.clientWidth - 20, height: wrap.clientHeight - 20, formatter: (value) => price(value, 2) });
  } else if ('bids' in first) {
    drawDepth(canvas, first, { theme, width: wrap.clientWidth - 20, height: wrap.clientHeight - 20, formatter: (value) => price(value, 2) });
  } else if (Array.isArray(first.levels)) {
    drawHBars(canvas, first.levels.map((level) => ({ label: price(level.px, 2), value: Number(level.notional_usd) })), { theme, width: wrap.clientWidth - 20, formatter });
  } else {
    const numericKey = keys.find((key) => typeof first[key] === 'number');
    if (numericKey && timeKey) {
      drawArea(canvas, rows, { theme, width: wrap.clientWidth - 20, height: wrap.clientHeight - 20, xKey: timeKey, yKey: numericKey, axisFormatter: formatter });
    } else {
      const valueKey = keys.find((key) => key.includes('usd') || key.includes('pnl') || key.includes('notional'));
      if (valueKey) {
        drawHBars(canvas, rows.slice(0, 16).map((row) => ({ label: String(row.coin ?? row.address?.slice(0, 8) ?? ''), value: Number(row[valueKey]) })), { theme, width: wrap.clientWidth - 20, formatter });
      }
    }
  }
}

function bindPlayground() {
  renderPgList();
  $('[data-pg-search]').addEventListener('input', debounce(() => renderPgList(), 120));
  $('[data-pg-send]').addEventListener('click', sendRequest);
  $('[data-pg-path]').addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') sendRequest();
  });
  document.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && document.activeElement?.closest('.pg-main')) sendRequest();
  });
  for (const button of $$('[data-pg-tab]')) {
    button.addEventListener('click', () => setPgTab(button.dataset.pgTab));
  }
  $('[data-pg-copy]').addEventListener('click', () => {
    const response = state.pg.response;
    if (!response) { toast('Send a request first', { tone: 'warn' }); return; }
    copyText(state.pg.tab === 'curl'
      ? api.curls($('[data-pg-path]').value.trim(), pgQuery(), { key: demoKey })
      : response.raw ?? JSON.stringify(response.body, null, 2), { label: 'Response copied' });
  });
  selectEndpoint(ENDPOINTS.find((endpoint) => endpoint.path === '/v1/markets/:coin/candles') ?? ENDPOINTS[0]);
  // Fire the first request once the section is visible.
  onVisible($('#playground'), () => { sendRequest(); });
}

/* ==========================================================================
   Workflow demos
   ========================================================================== */

async function renderWorkflowDemos() {
  const theme = THEME();
  const flowHost = $('[data-workflow="flow"]');
  if (flowHost) {
    const response = await api.request({
      path: `/v1/markets/${state.coin}/trade-bars`,
      query: { interval: '1h', limit: 14 },
      headers: { authorization: `Bearer ${demoKey}` },
      delay: false,
    });
    const rows = response.body?.data ?? [];
    const max = Math.max(...rows.map((row) => Number(row.buy_usd) + Number(row.sell_usd)), 1);
    flowHost.innerHTML = `
      <div class="demo-title"><span>trade bars · ${escapeHtml(state.coin)}</span><span>buy / sell</span></div>
      <div class="demo-rows">
        ${rows.slice(-9).map((row) => {
          const buy = Number(row.buy_usd);
          const sell = Number(row.sell_usd);
          const total = buy + sell;
          const buyShare = (buy / total) * 100;
          return `<div class="demo-row">
            <div class="demo-row__bar">
              <i style="width:${buyShare.toFixed(1)}%;background:${theme.up};opacity:.55"></i>
              <i style="left:${buyShare.toFixed(1)}%;right:0;background:${theme.down};opacity:.45"></i>
              <span>${new Date(row.t).toISOString().slice(11, 16)}</span>
            </div>
            <span class="up">${money(buy, { compact: true })}</span>
            <span class="down">${money(sell, { compact: true })}</span>
          </div>`;
        }).join('')}
      </div>
      <div class="demo-title" style="margin-top:10px;margin-bottom:0"><span>largest bar ${money(max, { compact: true })}</span><span>1 credit / row</span></div>`;
  }

  const positioningHost = $('[data-workflow="positioning"]');
  if (positioningHost) {
    const response = await api.request({ path: '/v1/cohorts/consensus', query: { limit: 6 }, headers: { authorization: `Bearer ${demoKey}` }, delay: false });
    const rows = response.body?.data ?? [];
    positioningHost.innerHTML = `
      <div class="demo-title"><span>top-trader consensus</span><span>${rows.length} markets</span></div>
      <div class="demo-rows">
        ${rows.map((row) => {
          const ratio = Math.round(row.long_ratio * 100);
          return `<div class="demo-row" style="grid-template-columns:52px 1fr 44px">
            <b>${escapeHtml(row.coin)}</b>
            <div class="demo-row__bar">
              <i style="width:${ratio}%;background:${row.consensus === 'short' ? theme.down : theme.up};opacity:.55"></i>
              <span>${ratio}% long</span>
            </div>
            <span class="${row.consensus === 'long' ? 'up' : row.consensus === 'short' ? 'down' : 'muted'}">${escapeHtml(row.consensus)}</span>
          </div>`;
        }).join('')}
      </div>`;
  }

  const agentsHost = $('[data-workflow="agents"]');
  if (agentsHost) {
    const tools = ENDPOINTS.slice(0, 300).filter((endpoint) => endpoint.scope).slice(0, 5);
    agentsHost.innerHTML = `
      <div class="demo-title"><span>mcp · hosted</span><span>one tool per endpoint</span></div>
      <div class="demo-mcp">
        <div class="demo-mcp__line"><b>$</b> claude mcp add --transport http hyperdash https://data.hyperdash.com/mcp</div>
        ${tools.map((endpoint, index) => `<div class="demo-mcp__tool" style="animation-delay:${index * 220}ms"><span>${escapeHtml(endpoint.path.split('/').slice(-1)[0].replace(/[{}]/g, ''))}</span><b>${escapeHtml(endpoint.scope)}</b></div>`).join('')}
        <div class="demo-mcp__line" style="color:var(--muted)">⇢ 380 tools registered · reads only</div>
      </div>`;
  }
  void drawSparkline;
}

/* ==========================================================================
   Plans, comparison, credit calculator
   ========================================================================== */

const PLAN_FEATURES = {
  starter: {
    bullets: [
      ['4M', 'credits a month', '$24.75 per 1M credits'],
      ['25', 'requests per second', '50 burst · 4 concurrent'],
      ['300', 'new wallets a day', '10 batch wallets'],
      ['7-day', 'request logs', '3 projects · 5 seats'],
      ['90 days', 'of history', ''],
      ['', 'Core data + real-time streams', ''],
    ],
    cta: 'Start with Starter',
  },
  growth: {
    bullets: [
      ['30M', 'credits a month', '$16.63 per 1M credits'],
      ['100', 'requests per second', '200 burst · 16 concurrent'],
      ['3,000', 'new wallets a day', '1,000 batch wallets'],
      ['30-day', 'request logs', '10 projects · 20 seats'],
      ['180 days', 'of history', ''],
      ['', 'Advanced data', 'Footprint · L4 book · async jobs'],
    ],
    cta: 'Choose Growth',
  },
  scale: {
    bullets: [
      ['150M', 'credits a month', '$13.33 per 1M credits'],
      ['200', 'requests per second', '400 burst · 32 concurrent'],
      ['10,000', 'new wallets a day', '10,000 batch wallets'],
      ['90-day', 'request logs', '25 projects · 50 seats'],
      ['365 days', 'of history', ''],
      ['', 'Everything in Growth', ''],
    ],
    cta: 'Choose Scale',
  },
  enterprise: {
    bullets: [
      ['Custom', 'committed monthly credits', 'Volume pricing per 1M'],
      ['200+', 'requests per second', 'Dedicated capacity'],
      ['Full', 'history', 'Deep as the chain'],
      ['Custom', 'wallets and streams', 'Custom log retention'],
      ['', 'SSO, SOC 2 report, support SLA', ''],
      ['', 'Named data engineer', ''],
    ],
    cta: 'Contact sales',
  },
};

function renderPlans() {
  const host = $('[data-plans]');
  if (!host) return;
  const order = ['starter', 'growth', 'scale', 'enterprise'];
  host.innerHTML = order.map((id) => {
    const plan = PLANS[id];
    const yearly = state.billing === 'yearly';
    const priceValue = plan.priceMonthly === null
      ? 'Custom'
      : yearly
        ? `$${integer(plan.priceYearly / 12)}`
        : `$${integer(plan.priceMonthly)}`;
    const sub = plan.priceMonthly === null
      ? 'per contract'
      : yearly
        ? `$${integer(plan.priceYearly)} billed yearly`
        : 'per month, billed monthly';
    const meta = PLAN_FEATURES[id];
    return `<article class="plan ${id === 'growth' ? 'is-popular' : ''}" data-plan="${id}">
      ${id === 'growth' ? '<span class="plan__flag">Popular</span>' : ''}
      <div class="plan__name"><h3>${escapeHtml(plan.name)}</h3><span class="chip">${id === 'enterprise' ? 'contract' : yearly ? 'save 17%' : 'monthly'}</span></div>
      <div class="plan__price"><strong>${priceValue}</strong><span>${plan.priceMonthly === null ? '' : '/ month'}</span></div>
      <p class="plan__sub">${escapeHtml(sub)}</p>
      <a class="btn ${id === 'growth' ? 'btn--primary' : 'btn--outline'}" href="./console.html#keys">${escapeHtml(meta.cta)}</a>
      ${id === 'starter' ? '' : `<p class="plan__inherit">Everything in ${escapeHtml(PLANS[order[order.indexOf(id) - 1]].name)}</p>`}
      <p class="plan__includes">Includes</p>
      <ul>
        ${meta.bullets.map(([value, label, extra]) => `<li><span><b>${escapeHtml(value)}</b> ${escapeHtml(label)}${extra ? `<small>${escapeHtml(extra)}</small>` : ''}</span></li>`).join('')}
      </ul>
      ${id === 'growth' ? '<p class="plan__inherit" style="margin-top:auto">Most teams start here.</p>' : ''}
    </article>`;
  }).join('');
  for (const button of $$('[data-billing]')) {
    button.classList.toggle('is-on', button.dataset.billing === state.billing);
  }
}

const COMPARE_ROWS = [
  ['price', 'Monthly price', ...PLAN_ORDER().map((id) => (id === 'enterprise' ? 'Custom' : `$${integer(PLANS[id].priceMonthly)}`))],
  ['price', 'Yearly price', ...PLAN_ORDER().map((id) => (id === 'enterprise' ? 'Custom' : `$${integer(PLANS[id].priceYearly)}`))],
  ['usage', 'Credits per month', ...PLAN_ORDER().map((id) => (id === 'enterprise' ? 'Committed' : integer(PLANS[id].credits)))],
  ['usage', 'History depth', ...PLAN_ORDER().map((id) => (id === 'enterprise' ? 'Full history' : `${PLANS[id].historyDays} days`))],
  ['limits', 'Requests per second', ...PLAN_ORDER().map((id) => PLANS[id].rps)],
  ['limits', 'Burst', ...PLAN_ORDER().map((id) => PLANS[id].burst)],
  ['limits', 'Concurrent requests', ...PLAN_ORDER().map((id) => PLANS[id].concurrency)],
  ['limits', 'Stream connections', ...PLAN_ORDER().map((id) => PLANS[id].streamConnections)],
  ['limits', 'Wallets on orders / account channel', ...PLAN_ORDER().map((id) => PLANS[id].orderStreamWallets)],
  ['limits', 'Wallets per batch request', ...PLAN_ORDER().map((id) => integer(PLANS[id].batchWallets))],
  ['limits', 'Rows per wallet-list query', ...PLAN_ORDER().map((id) => integer(PLANS[id].rowsPerWalletList))],
  ['limits', 'New wallets per day', ...PLAN_ORDER().map((id) => integer(PLANS[id].newWalletsPerDay))],
  ['limits', 'Request log retention', ...PLAN_ORDER().map((id) => `${PLANS[id].logDays} days`)],
  ['limits', 'Projects / seats', ...PLAN_ORDER().map((id) => `${PLANS[id].projects} / ${PLANS[id].seats}`)],
  ['features', 'Streams', ...PLAN_ORDER().map((id) => PLANS[id].features.streams)],
  ['features', 'Footprint', ...PLAN_ORDER().map((id) => PLANS[id].features.footprint)],
  ['features', 'Order-level (L4) book', ...PLAN_ORDER().map((id) => PLANS[id].features.l4)],
  ['features', 'Prediction market outcomes', ...PLAN_ORDER().map((id) => PLANS[id].features.outcomes)],
  ['features', 'Priority fee flow', ...PLAN_ORDER().map((id) => PLANS[id].features.priority)],
  ['features', 'Async jobs', ...PLAN_ORDER().map((id) => PLANS[id].features.jobs)],
];

function PLAN_ORDER() { return ['starter', 'growth', 'scale', 'enterprise']; }

function renderCompare() {
  const table = $('[data-compare-table]');
  if (!table) return;
  const groups = [['price', 'Pricing'], ['usage', 'Usage'], ['limits', 'Limits'], ['features', 'Features by plan']];
  table.innerHTML = `
    <thead><tr><th scope="col">Plan</th>${PLAN_ORDER().map((id) => `<th scope="col" class="num">${escapeHtml(PLANS[id].name)}</th>`).join('')}</tr></thead>
    <tbody>
      ${groups.map(([group, label]) => `
        <tr data-group="${group}"><td colspan="5">${label}</td></tr>
        ${COMPARE_ROWS.filter(([rowGroup]) => rowGroup === group).map(([, name, ...values]) => `
          <tr><th scope="row">${escapeHtml(name)}</th>${values.map((value) => `<td>${typeof value === 'boolean' ? `<span class="${value ? 'is-yes' : 'is-no'}">${value ? '✓' : '—'}</span>` : escapeHtml(String(value))}</td>`).join('')}</tr>`).join('')}`).join('')}
    </tbody>`;
}

function renderCreditCalculator() {
  const select = $('[data-calc-endpoint]');
  const rowsInput = $('[data-calc-rows]');
  const out = $('[data-calc-out]');
  const meta = $('[data-calc-meta]');
  if (!select || !out) return;
  const candidates = ENDPOINTS.filter((endpoint) => (endpoint.base ?? 0) > 0);
  if (!candidates.length) return;
  fillSelect(select, candidates.map((endpoint) => ({ value: `${endpoint.method} ${endpoint.path}`, label: `${endpoint.method} ${endpoint.path}` })), {
    value: 'GET /v1/markets/:coin/candles',
  });
  const compute = () => {
    const endpoint = candidates.find((entry) => `${entry.method} ${entry.path}` === select.value) ?? candidates[0];
    if (!endpoint) return;
    const rows = Math.max(0, Number(rowsInput.value) || 0);
    const multiplier = endpoint.path.includes('candles') && rows > 1_000 ? 2 : 1;
    const credits = Math.max(1, Math.ceil(multiplier * ((endpoint.base ?? 0) + rows * (endpoint.perRow ?? 0))));
    const plan = PLANS[state.currentPlan ?? 'growth'];
    const perCreditUsd = plan.creditRatePerMillion ? plan.creditRatePerMillion / 1_000_000 : 0;
    out.textContent = `${integer(credits)} ${credits === 1 ? 'credit' : 'credits'}`;
    meta.textContent = `${endpoint.method} ${endpoint.path} · multiplier ×${multiplier} · base ${endpoint.base} + ${rows.toLocaleString('en-US')} rows × ${endpoint.perRow}`
      + (perCreditUsd ? `\n≈ $${(credits * perCreditUsd).toFixed(4)} at Growth rates · ${integer(Math.floor((PLANS.growth.credits) / credits))} calls on Growth's monthly allowance` : '');
    meta.style.whiteSpace = 'pre-line';
  };
  select.addEventListener('change', compute);
  rowsInput.addEventListener('input', compute);
  compute();
}

function bindPricing() {
  for (const button of $$('[data-billing]')) {
    button.addEventListener('click', () => {
      state.billing = button.dataset.billing;
      renderPlans();
    });
  }
  renderPlans();
  renderCompare();
  renderCreditCalculator();
}

/* ==========================================================================
   FAQ
   ========================================================================== */

const FAQ = [
  ['What data is included?',
    'Trades, order books, funding and liquidations for every market on Hyperliquid. Fills, positions and PnL for every wallet. Derived analytics include trader rankings and cohort positioning. History depth is 90 days on Starter, 180 on Growth, 365 on Scale and full history on Enterprise.'],
  ['Can AI agents use it?',
    'Yes. Claude, ChatGPT, Cursor, Codex and any other MCP client can connect to the hosted Hyperdash MCP server at https://data.hyperdash.com/mcp. One tool per endpoint is registered, and results that name accounts carry links back to hyperdash.com.'],
  ['Why Hyperdash Data over other providers?',
    'Hyperdash Data covers every wallet on Hyperliquid and is served from our own nodes, not Hyperliquid’s public API. It includes derived analytics such as trader rankings and cohort positioning that are not available raw on chain.'],
  ['How are credits charged?',
    'Each successful request costs a whole number of credits based on the work behind it and the rows it returns: credits = multiplier × (base + rows × per_row) + node_read_cost × node_reads. Every response reports its charge in X-Credits-Charged. Failed and throttled requests are free.'],
  ['How do I know what a request will cost before running it?',
    'Call GET /v1/quote with the route and its parameters. It returns max_credits and the price version, runs nothing, and is free. You can also cap a single request with X-Max-Credits, and pin the price with X-Credit-Price-Version.'],
  ['What happens at the rate limit?',
    'Each workspace has a token bucket: a request rate, a burst allowance, and a cap on concurrent requests. A request uses one slot per 1,000 rows its limit allows. Over the limit returns 429 rate_limited with Retry-After, and costs nothing.'],
  ['Do streams cost the same as REST?',
    'Streams are billed per event you acknowledge: one credit per event, or five on the markets channel. Batches arrive in groups of up to 100 and the next waits until you acknowledge. A missed acknowledgement within 10 seconds ends the subscription with ack_timeout.'],
  ['Is there a free plan?',
    'No. Every API key needs an active plan, starting at $99 a month. You can evaluate the full API contract on this site without a key, because the playground runs a local replica in your browser.'],
];

function renderFaq() {
  const host = $('[data-faq]');
  if (!host) return;
  host.innerHTML = FAQ.map(([question, answer], index) => `
    <div class="accordion__item" data-faq-item>
      <h3 style="margin:0">
        <button type="button" class="accordion__trigger" data-faq-trigger aria-expanded="${index === 0}" aria-controls="faq-${index}">
          <span><span class="mono muted" style="margin-right:12px">${String(index + 1).padStart(2, '0')}</span>${escapeHtml(question)}</span>
          <i aria-hidden="true"></i>
        </button>
      </h3>
      <div class="accordion__panel" id="faq-${index}" role="region"><div><p>${escapeHtml(answer)}</p></div></div>
    </div>`).join('');
  const items = $$('[data-faq-item]', host);
  items[0]?.classList.add('is-open');
  for (const trigger of $$('[data-faq-trigger]', host)) {
    trigger.addEventListener('click', () => {
      const item = trigger.closest('[data-faq-item]');
      const isOpen = item.classList.contains('is-open');
      for (const other of items) {
        other.classList.remove('is-open');
        $('[data-faq-trigger]', other)?.setAttribute('aria-expanded', 'false');
      }
      if (!isOpen) {
        item.classList.add('is-open');
        trigger.setAttribute('aria-expanded', 'true');
      }
    });
  }
}

/* ==========================================================================
   Sparklines and small decorations
   ========================================================================== */

function renderSparklines() {
  for (const canvas of $$('[data-sparkline]')) {
    const coin = canvas.dataset.sparkline;
    const rows = engine.candles({ coin, interval: '1h', limit: 40 }).data;
    drawSparkline(canvas, rows.map((row) => Number(row.c)), {
      theme: THEME(),
      fill: Number(rows.at(-1).c) >= Number(rows[0].c) ? THEME().up : THEME().down,
    });
  }
  void drawHeatmap; void drawArea;
}

/* ==========================================================================
   Init
   ========================================================================== */

async function init() {
  bindSkins();
  bindShell();
  renderTicker();
  bindHero();
  await loadCandles();
  renderHero();
  startFeed();
  renderDatasetCards();
  bindDatasets();
  bindPlayground();
  bindPricing();
  renderFaq();
  renderWorkflowDemos();
  renderSparklines();

  document.addEventListener('hyperdash:skin', () => { renderTicker(); });

  setInterval(refreshTicker, 2_400);
  setInterval(() => { loadCandles().then(renderHero); }, 9_000);
  window.addEventListener('resize', debounce(() => {
    renderHero({ resize: true });
    renderPgChart();
  }, 180));
  void STREAM_CHANNELS; void SCOPES; void signedMoney; void timeUTC; void clockUTC;
  void drawDepth; void drawHBars; void api.state;
}

init().catch((error) => {
  console.error('Hyperdash landing failed to boot', error);
  toast('Something failed to load. Reload the page.', { tone: 'error', timeout: 6_000 });
});
