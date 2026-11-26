/**
 * Landing page. Every number on the page is fetched from this site's /v1
 * backend, which calls the official Hyperliquid info endpoint. When a request
 * fails, the affected panel shows the error instead of any placeholder data.
 */

import { $, $$, escapeHtml, price, money, percent, integer, timeUTC, prefersReducedMotion } from './lib.js';
import { apiGet } from './api-client.js';
import { drawCandles } from './charts.js';
import { initChrome, chartTheme, showError, provenance, pxDecimals } from './common.js';
import { mountPlayground } from './playground.js';

const state = {
  coin: 'BTC',
  interval: '1h',
  mainMarkets: [],
  candles: [],
  candleMeta: null,
  lastTradeTid: null,
  reduced: prefersReducedMotion(),
};

const INTERVAL_LIMIT = { '1m': 120, '15m': 96, '1h': 96, '4h': 90, '1d': 120 };

/* --------------------------------------------------------------- status */

async function loadStatus() {
  const label = $('[data-upstream-status]');
  const footer = $('[data-footer-status]');
  try {
    const { data } = await apiGet('/v1/status');
    label.textContent = `Hyperliquid reachable · ${data.upstream_latency_ms} ms`;
    footer.textContent = `Hyperliquid info API reachable (${data.upstream_latency_ms} ms)`;
    $('[data-stat="latency"]').textContent = `${data.upstream_latency_ms} ms`;
    for (const dot of $$('[data-live-dot]')) dot.classList.remove('is-down');
  } catch (error) {
    label.textContent = `Hyperliquid unreachable (${error.code})`;
    footer.textContent = `Upstream error: ${error.message}`;
    $('[data-stat="latency"]').textContent = 'down';
    for (const dot of $$('[data-live-dot]')) dot.classList.add('is-down');
  }
}

/* --------------------------------------------------------------- ticker */

function renderTicker(rows) {
  const host = $('[data-ticker]');
  if (!host) return;
  const list = rows.slice(0, 16);
  const item = (row) => `<span class="ticker__item">
      <span class="ticker__coin">${escapeHtml(row.coin)}</span>
      <span class="ticker__px">${price(row.mark_px, pxDecimals(row.mark_px))}</span>
      <span class="ticker__chg ${row.change_24h_pct >= 0 ? 'up' : 'down'}">${percent(row.change_24h_pct)}</span>
    </span>`;
  host.innerHTML = `<div class="ticker__track${state.reduced ? ' is-static' : ''}">${list.map(item).join('')}${list.map(item).join('')}</div>`;
}

/* -------------------------------------------------------------- markets */

async function loadMarkets() {
  const dex = $('[data-markets-dex]').value;
  const sort = $('[data-markets-sort]').value;
  const errorHost = $('[data-markets-error]');
  try {
    const result = await apiGet('/v1/markets', { query: { dex, sort } });
    errorHost.innerHTML = '';
    const rows = result.data;
    if (!dex && sort === 'volume') {
      state.mainMarkets = rows;
      onMainMarkets(rows);
    }
    const body = $('[data-markets-rows]');
    body.innerHTML = rows.slice(0, 30).map((row) => `
      <tr data-clickable data-coin="${escapeHtml(row.coin)}">
        <td class="coin">${escapeHtml(row.coin)}</td>
        <td class="num mono">${price(row.mark_px, pxDecimals(row.mark_px))}</td>
        <td class="num mono ${row.change_24h_pct >= 0 ? 'up' : 'down'}">${percent(row.change_24h_pct)}</td>
        <td class="num mono ${row.funding_rate_1h >= 0 ? 'up' : 'down'}">${percent((row.funding_rate_1h ?? NaN) * 100, { decimals: 4 })}</td>
        <td class="num mono">${money(row.open_interest_usd, { compact: true })}</td>
        <td class="num mono">${money(row.volume_24h_usd, { compact: true })}</td>
        <td class="num mono hide-sm">${row.max_leverage ?? '—'}×</td>
      </tr>`).join('') || '<tr><td colspan="7" class="muted">Hyperliquid returned no markets for this dex.</td></tr>';
    for (const tr of $$('tr[data-coin]', body)) {
      tr.addEventListener('click', () => { setCoin(tr.dataset.coin); $('#top').scrollIntoView({ behavior: state.reduced ? 'auto' : 'smooth' }); });
    }
    $('[data-markets-provenance]').textContent = `${rows.length} markets · ${provenance(result.meta, result.elapsedMs)}`;
  } catch (error) {
    showError(errorHost, error, { title: 'Could not load markets', retry: loadMarkets });
  }
}

function onMainMarkets(rows) {
  renderTicker(rows);
  $('[data-stat="markets"]').textContent = integer(rows.length);
  const select = $('[data-hero-coin]');
  const top = rows.slice(0, 40).map((row) => row.coin);
  if (!top.includes(state.coin)) top.unshift(state.coin);
  if (select.options.length !== top.length || [...select.options].some((o, i) => o.value !== top[i])) {
    select.innerHTML = top.map((coin) => `<option value="${escapeHtml(coin)}">${escapeHtml(coin)}-USD</option>`).join('');
  }
  select.value = state.coin;
  renderQuote();
}

async function loadDexs() {
  try {
    const { data } = await apiGet('/v1/dexs');
    const select = $('[data-markets-dex]');
    select.innerHTML = data.map((dex) => `<option value="${escapeHtml(dex.name)}">${escapeHtml(dex.name ? `${dex.name} · ${dex.full_name}` : dex.full_name)}</option>`).join('');
  } catch (error) {
    // The selector keeps the main dex only; the error is surfaced next to the table.
    showError($('[data-markets-error]'), error, { title: 'Could not load the perp dex list' });
  }
}

async function loadSpotCount() {
  try {
    const { meta } = await apiGet('/v1/spot/markets');
    $('[data-stat="spot"]').textContent = integer(meta.count);
  } catch {
    $('[data-stat="spot"]').textContent = 'error';
  }
}

/* ----------------------------------------------------------------- hero */

function setCoin(coin) {
  state.coin = coin;
  state.lastTradeTid = null;
  const select = $('[data-hero-coin]');
  if (![...select.options].some((o) => o.value === coin)) select.prepend(new Option(`${coin}-USD`, coin));
  select.value = coin;
  $('[data-feed-coin]').textContent = coin;
  $('[data-live-feed-rows]').innerHTML = '';
  renderQuote();
  loadCandles();
  loadTrades();
}

function renderQuote() {
  const row = state.mainMarkets.find((market) => market.coin === state.coin);
  if (!row) return;
  const d = pxDecimals(row.mark_px);
  $('[data-quote-last]').textContent = price(row.mark_px, d);
  const change = $('[data-quote-change]');
  change.textContent = percent(row.change_24h_pct);
  change.className = `quote-card__change ${row.change_24h_pct >= 0 ? 'up' : 'down'}`;
  $('[data-quote-meta]').textContent = `mid ${price(row.mid_px, d)} · max ${row.max_leverage}×`;
  $('[data-quote-funding]').textContent = percent((row.funding_rate_1h ?? NaN) * 100, { decimals: 4 });
  $('[data-quote-oi]').textContent = money(row.open_interest_usd, { compact: true });
  $('[data-quote-volume]').textContent = money(row.volume_24h_usd, { compact: true });
  $('[data-quote-oracle]').textContent = price(row.oracle_px, d);
  $('[data-quote-dex]').textContent = row.dex ? `${row.dex.toUpperCase()} PERP` : 'PERP';
}

async function loadCandles() {
  const coin = state.coin;
  const interval = state.interval;
  const errorHost = $('[data-hero-error]');
  try {
    const result = await apiGet(`/v1/markets/${encodeURIComponent(coin)}/candles`, { query: { interval, limit: INTERVAL_LIMIT[interval] } });
    if (coin !== state.coin || interval !== state.interval) return;
    errorHost.innerHTML = '';
    state.candles = result.data.map((c) => ({ t: c.time_open, o: c.open, h: c.high, l: c.low, c: c.close, v: c.volume_base }));
    state.candleMeta = result.meta;
    $('[data-hero-provenance]').textContent = provenance(result.meta, result.elapsedMs);
    drawHero();
  } catch (error) {
    state.candles = [];
    const canvas = $('[data-hero-chart]');
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    $('[data-hero-provenance]').textContent = '';
    showError(errorHost, error, { title: `Candles for ${coin} unavailable`, retry: loadCandles });
  }
}

function drawHero() {
  const canvas = $('[data-hero-chart]');
  if (!state.candles.length) { canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height); return; }
  const tip = $('[data-hero-tip]');
  const wrap = canvas.parentElement;
  const width = wrap.clientWidth - 12;
  const height = wrap.clientHeight;
  const last = state.candles.at(-1)?.c;
  const d = pxDecimals(last);
  drawCandles(canvas, state.candles, {
    theme: chartTheme(), width, height, showVolume: true,
    formatter: (value) => price(value, d),
    onHover: (hover) => {
      if (hover.leave || !tip || !hover.row) { if (tip) tip.hidden = true; return; }
      const row = hover.row;
      tip.hidden = false;
      tip.innerHTML = `<b>${timeUTC(row.t)}</b><br>O ${price(row.o, d)} H ${price(row.h, d)}<br>L ${price(row.l, d)} C ${price(row.c, d)}<br>V ${integer(row.v)}`;
      const left = Math.min(Math.max(hover.x, 72), width - 72);
      tip.style.left = `${left + 6}px`;
      tip.style.top = `${Math.max(6, Math.min(hover.y - 10, height - 92))}px`;
    },
  });
}

async function loadTrades() {
  const coin = state.coin;
  const host = $('[data-live-feed-rows]');
  const errorHost = $('[data-feed-error]');
  try {
    const { data } = await apiGet(`/v1/markets/${encodeURIComponent(coin)}/trades`);
    if (coin !== state.coin) return;
    errorHost.innerHTML = '';
    const fresh = state.lastTradeTid === null ? data.slice(0, 10) : data.filter((t) => t.time > state.lastTradeTid).slice(0, 10);
    if (data.length) state.lastTradeTid = Math.max(...data.map((t) => t.time));
    const d = pxDecimals(data[0]?.price);
    for (const trade of fresh.reverse()) {
      const row = document.createElement('div');
      row.className = 'live-row';
      row.innerHTML = `<span>${new Date(trade.time).toISOString().slice(11, 19)}</span>
        <span class="side-${trade.side}">${trade.side.toUpperCase()}</span>
        <span>${price(trade.price, d)}</span>
        <span>${money(trade.notional_usd, { compact: true })}</span>`;
      host.prepend(row);
    }
    while (host.children.length > 10) host.lastElementChild.remove();
  } catch (error) {
    showError(errorHost, error, { title: 'Trade feed paused' });
  }
}

function bindHero() {
  $('[data-hero-coin]').addEventListener('change', (event) => setCoin(event.target.value));
  for (const button of $$('[data-hero-interval]')) {
    button.addEventListener('click', () => {
      state.interval = button.dataset.heroInterval;
      for (const other of $$('[data-hero-interval]')) {
        other.classList.toggle('is-on', other === button);
        other.setAttribute('aria-pressed', String(other === button));
      }
      loadCandles();
    });
  }
  let resizeTimer = null;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(drawHero, 120); });
  document.addEventListener('site:skin', drawHero);
}

/* ------------------------------------------------------------ endpoints */

function renderCatalog(catalog) {
  $('[data-stat="endpoints"]').textContent = integer(catalog.endpoints.length);
  const groups = new Map();
  for (const endpoint of catalog.endpoints) {
    if (!groups.has(endpoint.group)) groups.set(endpoint.group, []);
    groups.get(endpoint.group).push(endpoint);
  }
  $('[data-endpoint-grid]').innerHTML = [...groups.entries()].map(([group, list]) => `
    <article class="endpoint-card">
      <h3>${escapeHtml(group)}</h3>
      <ul>
        ${list.map((endpoint) => `<li>
          <code><span class="method method--inline">GET</span> ${escapeHtml(endpoint.path)}</code>
          <p>${escapeHtml(endpoint.summary)}</p>
          <small>Hyperliquid: ${endpoint.upstream.map(escapeHtml).join(', ')}</small>
        </li>`).join('')}
      </ul>
    </article>`).join('');
  $('[data-unavailable]').innerHTML = `
    <h3>Not available from the official API</h3>
    <ul>${catalog.unavailable.map((item) => `<li><b>${escapeHtml(item.topic)}</b><span>${escapeHtml(item.reason)}</span></li>`).join('')}</ul>`;
}

async function loadCatalog() {
  try {
    const { data } = await apiGet('/v1/endpoints');
    renderCatalog(data);
    mountPlayground($('#playground'), data);
  } catch (error) {
    showError($('[data-endpoint-grid]'), error, { title: 'Could not load the endpoint catalogue', retry: loadCatalog });
    $('[data-stat="endpoints"]').textContent = 'error';
  }
}

/* ------------------------------------------------------------------ FAQ */

const FAQ = [
  ['Where does the data come from?', 'Every response is built from the official Hyperliquid info endpoint (POST https://api.hyperliquid.xyz/info) at request time, with a short cache of 1–30 seconds depending on the endpoint. The meta block of each response lists the upstream request types, when the data was fetched, and whether it came from cache.'],
  ['What happens when Hyperliquid is down or slow?', 'The backend retries network errors, timeouts, HTTP 429 and 5xx with exponential backoff. If it still fails you get an RFC 9457 problem response (502, 503 or 504) naming the upstream error. Nothing on this site falls back to stored or invented values.'],
  ['Do I need an API key?', 'No. The API is read-only and public. Each client IP gets a token-bucket rate limit, reported in the ratelimit-* headers, and the backend keeps its own Hyperliquid weight budget below the documented 1200 per minute.'],
  ['Why are liquidation maps, leaderboards and long trade history missing?', 'The official info API does not provide them: it answers per market or per wallet only and keeps only recent trades and the latest 5000 candles. Those datasets would need an indexer and history store this service does not run, so they are listed as unavailable instead of estimated.'],
  ['Can I place orders?', 'No. This service only reads public data. There is no order entry, no wallet connection and no signing.'],
  ['Is there a WebSocket stream?', 'Not from this service yet. For streaming, connect to Hyperliquid’s own wss://api.hyperliquid.xyz/ws. The REST endpoints here are suitable for polling every few seconds.'],
];

function renderFaq() {
  const host = $('[data-faq]');
  host.innerHTML = FAQ.map(([question, answer], index) => `
    <div class="accordion__item${index === 0 ? ' is-open' : ''}" data-faq-item>
      <h3 style="margin:0">
        <button type="button" class="accordion__trigger" data-faq-trigger aria-expanded="${index === 0}" aria-controls="faq-${index}">
          <span><span class="mono muted" style="margin-right:12px">${String(index + 1).padStart(2, '0')}</span>${escapeHtml(question)}</span>
          <i aria-hidden="true"></i>
        </button>
      </h3>
      <div class="accordion__panel" id="faq-${index}" role="region"><div><p>${escapeHtml(answer)}</p></div></div>
    </div>`).join('');
  const items = $$('[data-faq-item]', host);
  for (const trigger of $$('[data-faq-trigger]', host)) {
    trigger.addEventListener('click', () => {
      const item = trigger.closest('[data-faq-item]');
      const open = !item.classList.contains('is-open');
      for (const other of items) {
        other.classList.remove('is-open');
        $('[data-faq-trigger]', other).setAttribute('aria-expanded', 'false');
      }
      item.classList.toggle('is-open', open);
      trigger.setAttribute('aria-expanded', String(open));
    });
  }
}

/* ----------------------------------------------------------------- boot */

function every(ms, fn) {
  setInterval(() => { if (!document.hidden) fn(); }, ms);
}

async function boot() {
  initChrome();
  renderFaq();
  bindHero();
  $('[data-markets-dex]').addEventListener('change', loadMarkets);
  $('[data-markets-sort]').addEventListener('change', loadMarkets);
  loadStatus();
  loadCatalog();
  loadDexs();
  loadSpotCount();
  // Ticker, hero quote and stats always use the main dex sorted by volume.
  try {
    const main = await apiGet('/v1/markets', { query: { sort: 'volume' } });
    state.mainMarkets = main.data;
    onMainMarkets(main.data);
  } catch (error) {
    showError($('[data-hero-error]'), error, { title: 'Could not load market data', retry: boot });
  }
  loadMarkets();
  loadCandles();
  loadTrades();
  // Intervals are sized to the backend's Hyperliquid weight budget (see docs.html#limits).
  every(15_000, async () => {
    const dex = $('[data-markets-dex]').value;
    const sort = $('[data-markets-sort]').value;
    if (dex || sort !== 'volume') {
      try {
        const main = await apiGet('/v1/markets', { query: { sort: 'volume' } });
        state.mainMarkets = main.data;
        onMainMarkets(main.data);
      } catch (error) {
        showError($('[data-hero-error]'), error, { title: 'Quote refresh failed — values shown are from the last successful fetch' });
      }
    }
    loadMarkets();
  });
  every(30_000, loadCandles);
  every(5_000, loadTrades);
  every(60_000, loadStatus);
}

boot();
