/**
 * Request playground shared by the landing page and the console. Every send
 * is a real GET to this site's /v1 backend; the body, headers and timing shown
 * are exactly what came back.
 */

import { $, $$, el, escapeHtml, highlightJson, highlightShell, copyText, toast, price, money } from './lib.js';
import { apiGet, apiRaw, apiBase } from './api-client.js';
import { drawCandles, drawArea, drawDepth } from './charts.js';
import { chartTheme } from './common.js';

let sampleAddressPromise = null;

/** A wallet that traded BTC moments ago, taken from the live trade tape. */
export function sampleAddress() {
  if (!sampleAddressPromise) {
    sampleAddressPromise = apiGet('/v1/markets/BTC/trades')
      .then(({ data }) => data.find((trade) => trade.buyer)?.buyer ?? null)
      .catch((error) => { sampleAddressPromise = null; throw error; });
  }
  return sampleAddressPromise;
}

function examplePath(endpoint, address) {
  return endpoint.path
    .replace('{coin}', 'BTC')
    .replace('{address}', address ?? '0x…');
}

export function mountPlayground(root, catalog, { initialPath = null } = {}) {
  const state = { endpoint: null, tab: 'body', response: null, address: null };
  const q = (selector) => $(selector, root);
  const endpoints = catalog.endpoints.filter((endpoint) => endpoint.path !== '/v1/endpoints');

  function renderList() {
    const host = q('[data-pg-groups]');
    const search = q('[data-pg-search]')?.value.trim().toLowerCase() ?? '';
    const groups = new Map();
    for (const endpoint of endpoints) {
      if (search && !endpoint.path.toLowerCase().includes(search) && !endpoint.summary.toLowerCase().includes(search)) continue;
      if (!groups.has(endpoint.group)) groups.set(endpoint.group, []);
      groups.get(endpoint.group).push(endpoint);
    }
    if (!groups.size) { host.innerHTML = '<p class="pg-empty">No endpoint matches that search.</p>'; return; }
    host.innerHTML = [...groups.entries()].map(([group, list]) => `
      <div class="pg-group">
        <h3>${escapeHtml(group)}</h3>
        ${list.map((endpoint) => `
          <button type="button" class="pg-item ${state.endpoint?.path === endpoint.path ? 'is-on' : ''}" data-pg-endpoint="${escapeHtml(endpoint.path)}">
            <b>GET</b><span>${escapeHtml(endpoint.path)}</span>
          </button>`).join('')}
      </div>`).join('');
    for (const button of $$('[data-pg-endpoint]', host)) {
      button.addEventListener('click', () => select(endpoints.find((endpoint) => endpoint.path === button.dataset.pgEndpoint)));
    }
  }

  function currentUrl() {
    return new URL(q('[data-pg-path]').value.trim() || '/', `${apiBase()}/`);
  }

  function syncPathFromParams() {
    const url = currentUrl();
    url.search = '';
    for (const input of $$('[data-pg-param]', root)) {
      if (input.value !== '') url.searchParams.set(input.dataset.pgParam, input.value);
    }
    q('[data-pg-path]').value = `${url.pathname}${url.search}`;
    renderCurl();
  }

  async function select(endpoint, { path = null } = {}) {
    if (!endpoint) return;
    state.endpoint = endpoint;
    q('[data-pg-summary]').textContent = `${endpoint.summary} Upstream: ${endpoint.upstream.join(', ')}.`;
    for (const item of $$('.pg-item', root)) item.classList.toggle('is-on', item.dataset.pgEndpoint === endpoint.path);
    const host = q('[data-pg-params]');
    host.innerHTML = '';
    const queryParams = endpoint.params.filter((param) => param.in === 'query');
    const initial = path ? new URL(path, `${apiBase()}/`).searchParams : null;
    for (const param of queryParams) {
      const field = el('label', { class: 'field' });
      field.append(el('span', {}, param.name));
      field.append(el('input', {
        class: 'input', type: 'text', placeholder: param.description ?? '', title: param.description ?? '',
        value: initial?.get(param.name) ?? '', dataset: { pgParam: param.name },
      }));
      host.append(field);
    }
    for (const input of $$('[data-pg-param]', root)) input.addEventListener('input', syncPathFromParams);
    if (queryParams.length) host.append(el('p', { class: 'pg-param-note' }, 'Leave a parameter empty to omit it. Hover a field for its allowed values.'));

    if (path) {
      q('[data-pg-path]').value = path;
    } else if (endpoint.path.includes('{address}')) {
      q('[data-pg-path]').value = examplePath(endpoint, null);
      try {
        state.address = state.address ?? await sampleAddress();
        if (state.endpoint === endpoint) q('[data-pg-path]').value = examplePath(endpoint, state.address);
        q('[data-pg-summary]').textContent += ' The address is a wallet from the latest BTC trade.';
      } catch {
        q('[data-pg-summary]').textContent += ' Could not load a sample wallet; paste any 0x address.';
      }
    } else {
      q('[data-pg-path]').value = examplePath(endpoint, null);
    }
    renderCurl();
  }

  function renderCurl() {
    const url = currentUrl();
    q('[data-pg-curl]').innerHTML = `<code>${highlightShell(`curl -s '${url.toString()}'`)}</code>`;
  }

  async function send() {
    const url = currentUrl();
    const status = q('[data-pg-status]');
    status.className = 'pg-output__status is-busy';
    status.textContent = 'Sending…';
    const button = q('[data-pg-send]');
    button.disabled = true;
    try {
      const result = await apiRaw(`${url.pathname}${url.search}`);
      state.response = result;
      let parsed = null;
      try { parsed = JSON.parse(result.raw); } catch { parsed = null; }
      state.response.parsed = parsed;
      if (result.ok) {
        const meta = parsed?.meta ?? {};
        status.className = 'pg-output__status is-ok';
        status.textContent = `${result.status} · ${result.elapsedMs} ms · ${meta.cached ? 'cache hit' : 'fresh from Hyperliquid'} · fetched ${meta.fetched_at ?? '—'}`;
      } else {
        status.className = 'pg-output__status is-error';
        status.textContent = result.status
          ? `${result.status} ${result.error.code} · ${result.elapsedMs} ms`
          : `${result.error.code} · ${result.error.message}`;
      }
      q('[data-pg-body]').innerHTML = `<code>${parsed ? highlightJson(parsed) : escapeHtml(result.raw)}</code>`;
      q('[data-pg-headers]').innerHTML = `<code>${highlightShell(Object.entries(result.headers ?? {}).map(([key, value]) => `${key}: ${value}`).join('\n') || '(no response headers)')}</code>`;
      renderCurl();
      if (state.tab === 'chart') renderChart();
    } finally {
      button.disabled = false;
    }
  }

  function setTab(tab) {
    state.tab = tab;
    for (const button of $$('[data-pg-tab]', root)) button.classList.toggle('is-on', button.dataset.pgTab === tab);
    q('[data-pg-body]').hidden = tab !== 'body';
    q('[data-pg-headers]').hidden = tab !== 'headers';
    q('[data-pg-curl]').hidden = tab !== 'curl';
    q('[data-pg-chart-view]').hidden = tab !== 'chart';
    if (tab === 'chart') renderChart();
  }

  function chartMessage(canvas, message) {
    const ctx = canvas.getContext('2d');
    const wrap = canvas.parentElement;
    canvas.width = wrap.clientWidth;
    canvas.height = 80;
    ctx.fillStyle = chartTheme().muted;
    ctx.font = '12px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText(message, 12, 40);
  }

  function renderChart() {
    const canvas = q('[data-pg-chart]');
    const wrap = canvas.parentElement;
    const theme = chartTheme();
    const data = state.response?.parsed?.data;
    const width = Math.max(240, wrap.clientWidth - 20);
    const height = 280;
    if (!state.response?.ok || data === undefined) { chartMessage(canvas, 'Send a successful request to chart it.'); return; }
    if (Array.isArray(data) && data[0]?.time_open !== undefined) {
      drawCandles(canvas, data.map((c) => ({ t: c.time_open, o: c.open, h: c.high, l: c.low, c: c.close, v: c.volume_base })), { theme, width, height, formatter: (v) => price(v, 2) });
      return;
    }
    if (data?.bids && data?.asks) { drawDepth(canvas, data, { theme, width, height, formatter: (v) => price(v, 2) }); return; }
    const series = Array.isArray(data) ? data : Array.isArray(data?.history) ? data.history : null;
    if (series?.length && series[0].time !== undefined) {
      const key = ['account_value', 'funding_rate_1h', 'price', 'usdc', 'closed_pnl', 'notional_usd']
        .find((name) => typeof series[0][name] === 'number');
      if (key) {
        const rows = [...series].sort((a, b) => a.time - b.time);
        drawArea(canvas, rows, { theme, width, height, xKey: 'time', yKey: key, formatter: (t) => new Date(t).toISOString().slice(0, 16).replace('T', ' '), axisFormatter: (v) => (Math.abs(v) < 1 ? v.toPrecision(3) : money(v, { compact: true })) });
        return;
      }
    }
    chartMessage(canvas, 'This response has no chartable time series. Switch to Body.');
  }

  q('[data-pg-search]')?.addEventListener('input', renderList);
  q('[data-pg-send]').addEventListener('click', send);
  q('[data-pg-path]').addEventListener('keydown', (event) => { if (event.key === 'Enter') send(); });
  q('[data-pg-path]').addEventListener('input', renderCurl);
  root.addEventListener('keydown', (event) => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') send(); });
  for (const button of $$('[data-pg-tab]', root)) button.addEventListener('click', () => setTab(button.dataset.pgTab));
  q('[data-pg-copy]')?.addEventListener('click', () => {
    const text = state.tab === 'curl' ? `curl -s '${currentUrl().toString()}'` : state.response?.raw ?? '';
    if (!text) { toast('Nothing to copy yet', { tone: 'warn' }); return; }
    copyText(text);
  });
  document.addEventListener('site:skin', () => { if (state.tab === 'chart') renderChart(); });

  renderList();
  const startPath = initialPath ?? q('[data-pg-path]').value;
  const startRoute = new URL(startPath, `${apiBase()}/`).pathname;
  const match = endpoints.find((endpoint) => new RegExp(`^${endpoint.path.replace(/\{[a-z]+\}/g, '[^/]+')}$`).test(startRoute));
  select(match ?? endpoints[0], { path: match ? startPath : null });

  return { send, select: (path) => select(endpoints.find((endpoint) => endpoint.path === path)), setTab };
}
