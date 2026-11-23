/**
 * Console: upstream status, market inspector, wallet inspector, playground and
 * a request log. Every panel is filled from real /v1 responses; failures are
 * shown in place and never replaced with sample data.
 */

import { $, $$, escapeHtml, price, money, signedMoney, percent, integer, timeUTC } from './lib.js';
import { apiGet, onRequest, apiBase } from './api-client.js';
import { drawBars, drawCandles, drawDepth, drawArea } from './charts.js';
import { initChrome, chartTheme, showError, provenance, pxDecimals } from './common.js';
import { mountPlayground, sampleAddress } from './playground.js';

const VIEWS = ['status', 'market', 'wallet', 'playground', 'log'];
const state = {
  view: 'status',
  latencies: [],
  market: { coin: 'BTC', interval: '15m', candles: [], book: null, funding: [] },
  wallet: { address: null, history: [] },
  log: [],
  playgroundMounted: false,
};

const shortAddr = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '—');
const every = (ms, fn) => setInterval(() => { if (!document.hidden) fn(); }, ms);

/* ---------------------------------------------------------------- views */

function showView(name) {
  const view = VIEWS.includes(name) ? name : 'status';
  state.view = view;
  for (const section of $$('[data-view]')) section.hidden = section.dataset.view !== view;
  for (const link of $$('[data-view-link]')) link.classList.toggle('is-on', link.dataset.viewLink === view);
  if (view === 'market') loadMarket();
  if (view === 'wallet' && state.wallet.address) loadWallet();
  if (view === 'playground') mountPg();
  if (view === 'log') renderLog();
}

/* --------------------------------------------------------------- status */

async function checkStatus() {
  const errorHost = $('[data-status-error]');
  try {
    const { data, elapsedMs } = await apiGet('/v1/status');
    errorHost.innerHTML = '';
    const c = data.client;
    state.latencies.push(data.upstream_latency_ms);
    if (state.latencies.length > 60) state.latencies.shift();
    $('[data-st-state]').textContent = 'reachable';
    $('[data-st-state]').className = 'up';
    $('[data-st-time]').textContent = `upstream clock ${timeUTC(data.upstream_time, { seconds: true })}`;
    $('[data-st-latency]').textContent = `${data.upstream_latency_ms} ms`;
    $('[data-st-rtt]').textContent = `${elapsedMs} ms browser round trip`;
    $('[data-st-weight]').textContent = integer(c.weightUsedLastMinute);
    $('[data-st-budget]').textContent = `of ${integer(c.weightBudgetPerMin)} budget`;
    $('[data-st-cache]').textContent = integer(c.cacheHits);
    $('[data-st-calls]').textContent = `${integer(c.upstreamCalls)} upstream calls · ${integer(c.cacheEntries)} cached`;
    $('[data-st-count]').textContent = `${state.latencies.length} checks`;
    $('[data-st-foot]').textContent = `retries ${c.retries} · failures ${c.failures}${c.lastError ? ` · last error ${c.lastError.code} at ${timeUTC(c.lastError.at, { seconds: true })}: ${c.lastError.detail}` : ' · no upstream errors on this instance'}`;
    $('[data-side-status]').textContent = `${data.upstream_latency_ms} ms`;
    $('[data-side-meter]').style.width = `${Math.min(100, (c.weightUsedLastMinute / c.weightBudgetPerMin) * 100).toFixed(1)}%`;
    $('[data-side-note]').textContent = `${integer(c.weightUsedLastMinute)} / ${integer(c.weightBudgetPerMin)} weight in the last minute`;
    for (const dot of $$('[data-live-dot]')) dot.classList.remove('is-down');
    drawStatusChart();
  } catch (error) {
    $('[data-st-state]').textContent = 'unreachable';
    $('[data-st-state]').className = 'down';
    $('[data-side-status]').textContent = 'down';
    $('[data-side-meter]').style.width = '0%';
    $('[data-side-note]').textContent = 'no answer from the backend status check';
    for (const dot of $$('[data-live-dot]')) dot.classList.add('is-down');
    showError(errorHost, error, { title: 'Status check failed', retry: checkStatus });
  }
}

function drawStatusChart() {
  const canvas = $('[data-st-chart]');
  if (!state.latencies.length || $('#status').hidden) return;
  drawBars(canvas, state.latencies, { theme: chartTheme(), width: canvas.parentElement.clientWidth - 20, height: 130, formatter: (v) => `${Math.round(v)} ms` });
}

/* ------------------------------------------------------- market inspector */

async function loadMarket() {
  const { coin, interval } = state.market;
  const enc = encodeURIComponent(coin);
  const errorHost = $('[data-mk-error]');
  $('[data-mk-title]').textContent = `${coin} · ${interval} candles`;
  const [ctx, candles, book, trades, funding] = await Promise.allSettled([
    apiGet(`/v1/markets/${enc}`),
    apiGet(`/v1/markets/${enc}/candles`, { query: { interval, limit: 160 } }),
    apiGet(`/v1/markets/${enc}/book`),
    apiGet(`/v1/markets/${enc}/trades`),
    apiGet(`/v1/markets/${enc}/funding`),
  ]);
  if (coin !== state.market.coin || interval !== state.market.interval) return;
  const failures = [ctx, candles, book, trades, funding].filter((r) => r.status === 'rejected')
    // Spot markets have no perp context or funding; that 400 is expected and explained inline.
    .filter((r) => !(r.reason?.code === 'invalid_parameter' && /spot|perp/.test(r.reason.message)));
  errorHost.innerHTML = '';
  if (failures.length) showError(errorHost, failures[0].reason, { title: `${failures.length} of 5 requests for ${coin} failed`, retry: loadMarket });

  if (ctx.status === 'fulfilled') {
    const m = ctx.value.data;
    const d = pxDecimals(m.mark_px);
    $('[data-mk-mark]').textContent = price(m.mark_px, d);
    $('[data-mk-change]').innerHTML = `<span class="${m.change_24h_pct >= 0 ? 'up' : 'down'}">${percent(m.change_24h_pct)}</span> 24h · oracle ${price(m.oracle_px, d)}`;
    $('[data-mk-funding]').textContent = percent(m.funding_rate_1h * 100, { decimals: 4 });
    $('[data-mk-premium]').textContent = `premium ${percent(m.premium * 100, { decimals: 4 })}`;
    $('[data-mk-oi]').textContent = money(m.open_interest_usd, { compact: true });
    $('[data-mk-oi-base]').textContent = `${integer(m.open_interest)} ${coin} · vol ${money(m.volume_24h_usd, { compact: true })}`;
  } else {
    for (const key of ['mark', 'funding', 'oi']) $(`[data-mk-${key}]`).textContent = '—';
    $('[data-mk-change]').textContent = ctx.reason?.message ?? '';
    $('[data-mk-premium]').textContent = '';
    $('[data-mk-oi-base]').textContent = '';
  }

  if (candles.status === 'fulfilled') {
    state.market.candles = candles.value.data.map((c) => ({ t: c.time_open, o: c.open, h: c.high, l: c.low, c: c.close, v: c.volume_base }));
    $('[data-mk-candle-meta]').textContent = provenance(candles.value.meta, candles.value.elapsedMs);
  } else {
    state.market.candles = [];
    $('[data-mk-candle-meta]').textContent = candles.reason.message;
  }

  if (book.status === 'fulfilled') {
    const b = book.value.data;
    state.market.book = b;
    const d = pxDecimals(b.mid);
    $('[data-mk-spread]').textContent = b.spread_bps === null ? '—' : `${b.spread_bps.toFixed(2)} bps`;
    $('[data-mk-bbo]').textContent = `${price(b.best_bid, d)} / ${price(b.best_ask, d)}`;
    $('[data-mk-book-meta]').textContent = `${b.bids.length}×${b.asks.length} levels · ${timeUTC(b.time, { seconds: true })}`;
  } else {
    state.market.book = null;
    $('[data-mk-spread]').textContent = '—';
    $('[data-mk-bbo]').textContent = '';
    $('[data-mk-book-meta]').textContent = book.reason.message;
  }

  if (funding.status === 'fulfilled') {
    state.market.funding = funding.value.data.map((f) => ({ ...f, pct: f.funding_rate_1h * 100 }));
    $('[data-mk-funding-meta]').textContent = `${funding.value.data.length} hourly prints`;
  } else {
    state.market.funding = [];
    $('[data-mk-funding-meta]').textContent = funding.reason.message;
  }

  const tbody = $('[data-mk-trades]');
  if (trades.status === 'fulfilled') {
    const rows = trades.value.data;
    const d = pxDecimals(rows[0]?.price);
    $('[data-mk-trades-meta]').textContent = provenance(trades.value.meta, trades.value.elapsedMs);
    tbody.innerHTML = rows.map((t) => `<tr>
      <td class="mono">${new Date(t.time).toISOString().slice(11, 23)}</td>
      <td class="${t.side === 'buy' ? 'up' : 'down'}">${t.side}</td>
      <td class="num mono">${price(t.price, d)}</td>
      <td class="num mono">${t.size}</td>
      <td class="num mono">${money(t.notional_usd)}</td>
      <td class="addr"><a href="#wallet" data-addr="${escapeHtml(t.buyer ?? '')}">${shortAddr(t.buyer)}</a></td>
      <td class="addr"><a href="#wallet" data-addr="${escapeHtml(t.seller ?? '')}">${shortAddr(t.seller)}</a></td>
    </tr>`).join('') || '<tr><td colspan="7" class="muted">Hyperliquid returned no recent trades.</td></tr>';
    for (const link of $$('[data-addr]', tbody)) link.addEventListener('click', () => { setWallet(link.dataset.addr); });
  } else {
    $('[data-mk-trades-meta]').textContent = 'error';
    tbody.innerHTML = `<tr><td colspan="7" class="down">${escapeHtml(trades.reason.message)}</td></tr>`;
  }
  drawMarket();
}

function drawMarket() {
  if ($('#market').hidden) return;
  const theme = chartTheme();
  const candles = $('[data-mk-candles]');
  const d = pxDecimals(state.market.candles.at(-1)?.c);
  drawCandles(candles, state.market.candles, { theme, width: candles.parentElement.clientWidth - 30, height: 290, formatter: (v) => price(v, d) });
  const depth = $('[data-mk-depth]');
  if (state.market.book) drawDepth(depth, state.market.book, { theme, width: depth.parentElement.clientWidth - 30, height: 190, formatter: (v) => price(v, pxDecimals(state.market.book.mid)) });
  else depth.getContext('2d').clearRect(0, 0, depth.width, depth.height);
  const fund = $('[data-mk-fundchart]');
  if (state.market.funding.length) {
    drawArea(fund, state.market.funding, { theme, width: fund.parentElement.clientWidth - 30, height: 190, xKey: 'time', yKey: 'pct', baseline: 0, formatter: (t) => timeUTC(t), axisFormatter: (v) => `${v.toFixed(4)}%` });
  } else {
    fund.getContext('2d').clearRect(0, 0, fund.width, fund.height);
  }
}

async function loadCoinList() {
  try {
    const { data } = await apiGet('/v1/markets', { query: { sort: 'volume' } });
    $('[data-coin-list]').innerHTML = data.map((m) => `<option value="${escapeHtml(m.coin)}">`).join('');
  } catch {
    // Free-text entry still works; the backend validates the name.
  }
}

/* ------------------------------------------------------- wallet inspector */

function setWallet(address) {
  state.wallet.address = address.toLowerCase();
  $('[data-wallet-form] input').value = state.wallet.address;
  if (location.hash !== '#wallet') location.hash = '#wallet';
  else loadWallet();
}

async function loadWallet() {
  const address = state.wallet.address;
  if (!address) return;
  const base = `/v1/accounts/${address}`;
  const errorHost = $('[data-wl-error]');
  const [summary, positions, orders, fills] = await Promise.allSettled([
    apiGet(base), apiGet(`${base}/positions`), apiGet(`${base}/open-orders`), apiGet(`${base}/fills`, { query: { limit: 50 } }),
  ]);
  if (address !== state.wallet.address) return;
  const failures = [summary, positions, orders, fills].filter((r) => r.status === 'rejected');
  errorHost.innerHTML = '';
  if (failures.length) showError(errorHost, failures[0].reason, { title: `${failures.length} of 4 wallet requests failed`, retry: loadWallet });

  if (summary.status === 'fulfilled') {
    const s = summary.value.data;
    $('[data-wl-value]').textContent = money(s.account_value);
    $('[data-wl-withdrawable]').textContent = `withdrawable ${money(s.withdrawable)}`;
    $('[data-wl-notional]').textContent = money(s.total_notional, { compact: true });
    $('[data-wl-positions]').textContent = `${s.positions} open positions`;
    $('[data-wl-margin]').textContent = money(s.margin_used);
    $('[data-wl-maint]').textContent = `maintenance ${money(s.maintenance_margin)}`;
    const nonzero = s.spot_balances.filter((b) => b.total !== 0);
    $('[data-wl-spot]').textContent = integer(nonzero.length);
    $('[data-wl-spot-note]').textContent = nonzero.slice(0, 3).map((b) => `${b.coin} ${b.total.toLocaleString('en-US', { maximumFractionDigits: 4 })}`).join(' · ') || 'none';
  } else {
    for (const key of ['value', 'notional', 'margin', 'spot']) $(`[data-wl-${key}]`).textContent = '—';
  }

  const pos = $('[data-wl-positions-rows]');
  if (positions.status === 'fulfilled') {
    $('[data-wl-pos-meta]').textContent = provenance(positions.value.meta, positions.value.elapsedMs);
    pos.innerHTML = positions.value.data.map((p) => {
      const d = pxDecimals(p.entry_px);
      return `<tr>
        <td class="coin">${escapeHtml(p.coin)}</td><td class="${p.side === 'long' ? 'up' : 'down'}">${p.side}</td>
        <td class="num mono">${p.size}</td><td class="num mono">${price(p.entry_px, d)}</td><td class="num mono">${price(p.mark_px, d)}</td>
        <td class="num mono">${money(p.position_value_usd)}</td>
        <td class="num mono ${p.unrealized_pnl >= 0 ? 'up' : 'down'}">${signedMoney(p.unrealized_pnl)}</td>
        <td class="num mono">${p.liquidation_px === null ? '—' : price(p.liquidation_px, d)}</td>
        <td class="num mono">${p.leverage ?? '—'}× ${escapeHtml(p.leverage_type ?? '')}</td>
      </tr>`;
    }).join('') || '<tr><td colspan="9" class="muted">No open perp positions on the main dex.</td></tr>';
  } else {
    $('[data-wl-pos-meta]').textContent = 'error';
    pos.innerHTML = `<tr><td colspan="9" class="down">${escapeHtml(positions.reason.message)}</td></tr>`;
  }

  const ord = $('[data-wl-orders]');
  if (orders.status === 'fulfilled') {
    $('[data-wl-orders-meta]').textContent = `${orders.value.data.length} resting`;
    ord.innerHTML = orders.value.data.slice(0, 200).map((o) => `<tr>
      <td class="coin">${escapeHtml(o.coin)}</td><td class="${o.side === 'buy' ? 'up' : 'down'}">${o.side}</td>
      <td>${escapeHtml(o.order_type)}${o.reduce_only ? ' · RO' : ''}</td>
      <td class="num mono">${price(o.is_trigger ? o.trigger_px : o.limit_px, pxDecimals(o.limit_px))}</td><td class="num mono">${o.size}</td>
    </tr>`).join('') || '<tr><td colspan="5" class="muted">No open orders.</td></tr>';
  } else {
    $('[data-wl-orders-meta]').textContent = 'error';
    ord.innerHTML = `<tr><td colspan="5" class="down">${escapeHtml(orders.reason.message)}</td></tr>`;
  }

  const fl = $('[data-wl-fills]');
  if (fills.status === 'fulfilled') {
    $('[data-wl-fills-meta]').textContent = `latest ${fills.value.data.length}`;
    fl.innerHTML = fills.value.data.map((f) => `<tr>
      <td class="mono">${new Date(f.time).toISOString().slice(5, 19).replace('T', ' ')}</td>
      <td class="coin">${escapeHtml(f.coin)}</td><td>${escapeHtml(f.direction)}${f.liquidation ? ' · LIQ' : ''}</td>
      <td class="num mono">${price(f.price, pxDecimals(f.price))}</td><td class="num mono">${f.size}</td>
      <td class="num mono ${f.closed_pnl >= 0 ? 'up' : 'down'}">${f.closed_pnl ? signedMoney(f.closed_pnl) : '—'}</td>
      <td class="num mono">${f.fee}</td>
    </tr>`).join('') || '<tr><td colspan="7" class="muted">No fills.</td></tr>';
  } else {
    $('[data-wl-fills-meta]').textContent = 'error';
    fl.innerHTML = `<tr><td colspan="7" class="down">${escapeHtml(fills.reason.message)}</td></tr>`;
  }
  loadPortfolio();
}

async function loadPortfolio() {
  const address = state.wallet.address;
  const window = $('[data-wl-window]').value;
  try {
    const result = await apiGet(`/v1/accounts/${address}/portfolio`, { query: { window } });
    if (address !== state.wallet.address) return;
    state.wallet.history = result.data.history;
    $('[data-wl-portfolio-meta]').textContent = `${result.data.history.length} points · volume ${money(result.data.volume, { compact: true })}`;
  } catch (error) {
    state.wallet.history = [];
    $('[data-wl-portfolio-meta]').textContent = `error: ${error.message}`;
  }
  drawWallet();
}

function drawWallet() {
  const canvas = $('[data-wl-chart]');
  if ($('#wallet').hidden) return;
  if (!state.wallet.history.length) { canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height); return; }
  drawArea(canvas, state.wallet.history, { theme: chartTheme(), width: canvas.parentElement.clientWidth - 30, height: 190, xKey: 'time', yKey: 'account_value', formatter: (t) => timeUTC(t), axisFormatter: (v) => money(v, { compact: true }) });
}

/* ------------------------------------------------------------ request log */

function renderLog() {
  const rows = state.log;
  $('[data-log-total]').textContent = integer(rows.length);
  $('[data-log-errors]').textContent = integer(rows.filter((r) => !r.ok).length);
  const ok = rows.filter((r) => r.ok);
  const sorted = ok.map((r) => r.elapsedMs).sort((a, b) => a - b);
  $('[data-log-median]').textContent = sorted.length ? `${sorted[Math.floor(sorted.length / 2)]} ms` : '—';
  $('[data-log-hits]').textContent = ok.length ? `${Math.round((ok.filter((r) => r.cached).length / ok.length) * 100)}%` : '—';
  if ($('#log').hidden) return;
  $('[data-log-rows]').innerHTML = rows.slice(-300).reverse().map((r) => `<tr>
    <td class="mono">${new Date(r.at).toISOString().slice(11, 23)}</td>
    <td class="route mono" title="${escapeHtml(r.path)}">${escapeHtml(r.path)}</td>
    <td class="num mono ${r.ok ? 'up' : 'down'}">${r.status || 'ERR'}</td>
    <td class="num mono">${r.elapsedMs ?? '—'}</td>
    <td class="mono">${r.ok ? (r.cached ? 'HIT' : 'MISS') : '—'}</td>
    <td class="mono">${r.fetchedAt ? r.fetchedAt.slice(11, 23) : '—'}</td>
    <td class="mono ${r.ok ? '' : 'down'}">${escapeHtml(r.ok ? (r.requestId ?? '') : `${r.code}: ${r.detail}`)}</td>
  </tr>`).join('') || '<tr><td colspan="7" class="muted">No requests yet.</td></tr>';
}

/* ------------------------------------------------------------- playground */

async function mountPg() {
  if (state.playgroundMounted) return;
  state.playgroundMounted = true;
  try {
    const { data } = await apiGet('/v1/endpoints');
    mountPlayground($('#playground'), data, { initialPath: '/v1/markets?limit=10' });
    $('[data-side-version]').textContent = `api ${data.version}`;
  } catch (error) {
    state.playgroundMounted = false;
    showError($('[data-pg-groups]'), error, { title: 'Could not load endpoints', retry: mountPg });
  }
}

/* ------------------------------------------------------------------ boot */

function boot() {
  initChrome();
  $('[data-base-host]').textContent = new URL(apiBase()).host;
  onRequest((entry) => {
    state.log.push(entry);
    if (state.log.length > 1000) state.log.shift();
    renderLog();
  });
  $('[data-log-clear]').addEventListener('click', () => { state.log = []; renderLog(); });
  $('[data-status-check]').addEventListener('click', checkStatus);

  $('[data-market-form]').addEventListener('submit', (event) => {
    event.preventDefault();
    const form = new FormData(event.target);
    state.market.coin = String(form.get('coin')).trim() || 'BTC';
    state.market.interval = String(form.get('interval'));
    loadMarket();
  });
  $('[data-wallet-form]').addEventListener('submit', (event) => {
    event.preventDefault();
    const value = String(new FormData(event.target).get('address')).trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(value)) {
      showError($('[data-wl-error]'), new Error('Enter a 0x-prefixed 40-hex-character address.'), { title: 'Invalid address' });
      return;
    }
    setWallet(value);
  });
  $('[data-wallet-sample]').addEventListener('click', async () => {
    try { setWallet(await sampleAddress()); } catch (error) { showError($('[data-wl-error]'), error, { title: 'Could not read the trade tape' }); }
  });
  $('[data-wl-window]').addEventListener('change', loadPortfolio);

  window.addEventListener('hashchange', () => showView(location.hash.slice(1)));
  let resizeTimer = null;
  const redraw = () => { drawStatusChart(); drawMarket(); drawWallet(); };
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(redraw, 120); });
  document.addEventListener('site:skin', redraw);

  apiGet('/v1/endpoints').then(({ data }) => { $('[data-side-version]').textContent = `api ${data.version}`; }).catch(() => { $('[data-side-version]').textContent = 'api unreachable'; });
  showView(location.hash.slice(1) || 'status');
  checkStatus();
  loadCoinList();
  every(15_000, checkStatus);
  every(5_000, () => { if (state.view === 'market') loadMarket(); });
  every(10_000, () => { if (state.view === 'wallet' && state.wallet.address) loadWallet(); });
}

boot();
