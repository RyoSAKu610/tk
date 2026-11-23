/**
 * Documentation page. The endpoint reference, limits and unavailable list are
 * rendered from the live `GET /v1/endpoints` catalogue, and every "Send
 * request" button performs a real request through the backend.
 */

import { $, $$, escapeHtml, highlightJson, highlightShell, copyText, integer } from './lib.js';
import { apiGet, apiRaw, apiBase } from './api-client.js';
import { initChrome, showError } from './common.js';
import { sampleAddress } from './playground.js';

function quickstart(lang) {
  const base = apiBase();
  const url = `${base}/v1/markets/BTC/candles?interval=1h&limit=24`;
  if (lang === 'node') {
    return `const res = await fetch("${url}");
const body = await res.json();
if (!res.ok) throw new Error(\`\${body.code}: \${body.detail}\`);
console.log(body.meta.fetched_at, body.data.at(-1));`;
  }
  if (lang === 'python') {
    return `import requests

res = requests.get("${base}/v1/markets/BTC/candles",
                   params={"interval": "1h", "limit": 24}, timeout=15)
body = res.json()
if not res.ok:
    raise RuntimeError(f"{body['code']}: {body['detail']}")
print(body["meta"]["fetched_at"], body["data"][-1])`;
  }
  return `curl -s '${url}'`;
}

function bindQuickstart() {
  const block = $('[data-code-block]');
  let lang = 'curl';
  const render = () => { block.innerHTML = `<code>${highlightShell(quickstart(lang))}</code>`; };
  for (const tab of $$('[data-lang]')) {
    tab.addEventListener('click', () => {
      lang = tab.dataset.lang;
      for (const other of $$('[data-lang]')) {
        other.classList.toggle('is-on', other === tab);
        other.setAttribute('aria-selected', String(other === tab));
      }
      render();
    });
  }
  $('[data-copy-code]').addEventListener('click', () => copyText(quickstart(lang)));
  render();
}

async function runTry(button, output) {
  output.hidden = false;
  output.innerHTML = '<code>Sending…</code>';
  button.disabled = true;
  try {
    const result = await apiRaw(button.dataset.try);
    let parsed = null;
    try { parsed = JSON.parse(result.raw); } catch { parsed = null; }
    const head = `GET ${button.dataset.try}  →  ${result.status || result.error?.code} · ${result.elapsedMs} ms`;
    output.innerHTML = `<code>${escapeHtml(head)}\n\n${parsed ? highlightJson(truncate(parsed)) : escapeHtml(result.raw)}</code>`;
  } finally {
    button.disabled = false;
  }
}

/** Keep long arrays readable in the docs; the full body is one click away in the playground. */
function truncate(body) {
  if (!Array.isArray(body?.data) || body.data.length <= 5) return body;
  return { ...body, data: [...body.data.slice(0, 5), `… ${body.data.length - 5} more rows`] };
}

function bindTryButtons(scope = document) {
  for (const button of $$('[data-try]', scope)) {
    if (button.dataset.bound) continue;
    button.dataset.bound = '1';
    const output = button.closest('.try-bar')?.nextElementSibling ?? button.parentElement.querySelector('[data-try-output]');
    button.addEventListener('click', () => runTry(button, output));
  }
}

async function examplePath(endpoint) {
  let path = endpoint.path.replace('{coin}', 'BTC');
  if (path.includes('{address}')) path = path.replace('{address}', await sampleAddress());
  return path;
}

function renderReference(catalog, filter = '') {
  const host = $('[data-ref-list]');
  const groups = new Map();
  let shown = 0;
  for (const endpoint of catalog.endpoints) {
    const hay = `${endpoint.path} ${endpoint.summary} ${endpoint.upstream.join(' ')}`.toLowerCase();
    if (filter && !hay.includes(filter)) continue;
    if (!groups.has(endpoint.group)) groups.set(endpoint.group, []);
    groups.get(endpoint.group).push(endpoint);
    shown += 1;
  }
  $('[data-ref-count]').textContent = `${shown} of ${catalog.endpoints.length} endpoints`;
  host.innerHTML = [...groups.entries()].map(([group, list]) => `
    <div class="ref-group">
      <h3>${escapeHtml(group)} <span>${list.length}</span></h3>
      ${list.map((endpoint) => `
        <details class="ref-item" data-ref-path="${escapeHtml(endpoint.path)}">
          <summary><span class="method method--inline">GET</span><code>${escapeHtml(endpoint.path)}</code><span class="ref-item__scope">${escapeHtml(endpoint.upstream.join(' + '))}</span></summary>
          <div class="ref-item__body">
            <p>${escapeHtml(endpoint.summary)}</p>
            ${endpoint.params.length ? `<div class="table-wrap"><table class="table ref-params">
              <thead><tr><th>Parameter</th><th>In</th><th>Description</th></tr></thead>
              <tbody>${endpoint.params.map((p) => `<tr><td class="mono">${escapeHtml(p.name)}${p.required ? ' *' : ''}</td><td class="mono">${escapeHtml(p.in)}</td><td>${escapeHtml(p.description ?? (p.example ? `e.g. ${p.example}` : ''))}</td></tr>`).join('')}</tbody>
            </table></div>` : '<p class="muted">No parameters.</p>'}
            <div class="ref-try">
              <button class="btn btn--primary btn--sm" type="button" data-ref-send>Send example request</button>
              <pre class="code-block ref-item__out" hidden><code></code></pre>
            </div>
          </div>
        </details>`).join('')}
    </div>`).join('') || '<p class="muted">No endpoint matches that filter.</p>';

  for (const item of $$('[data-ref-path]', host)) {
    const endpoint = catalog.endpoints.find((e) => e.path === item.dataset.refPath);
    const button = $('[data-ref-send]', item);
    const output = $('pre', item);
    button.addEventListener('click', async () => {
      output.hidden = false;
      output.innerHTML = '<code>Sending…</code>';
      let path;
      try {
        path = await examplePath(endpoint);
      } catch (error) {
        output.innerHTML = `<code>${escapeHtml(`Could not load a sample wallet from the trade tape: ${error.message}`)}</code>`;
        return;
      }
      button.dataset.try = path;
      await runTry(button, output);
    });
  }
}

function renderLimits(limits) {
  $('[data-limits]').innerHTML = `
    <tr><th scope="row">Per client</th><td>${escapeHtml(String(limits.client_rate_per_sec))} requests/s, burst ${escapeHtml(String(limits.client_burst))}. Exceeding it returns <code>429 rate_limited</code> with <code>retry-after</code>.</td></tr>
    <tr><th scope="row">Upstream budget</th><td>${escapeHtml(String(limits.upstream_weight_budget_per_min))} weight/min (Hyperliquid’s limit is 1200 per IP). When spent, requests wait briefly, then fail with <code>503 upstream_budget</code>.</td></tr>
    <tr><th scope="row">Upstream timeout</th><td>${escapeHtml(String(limits.upstream_timeout_ms))} ms per attempt, ${escapeHtml(String(limits.upstream_max_retries))} retries with exponential backoff and jitter.</td></tr>`;
}

async function loadCatalog() {
  try {
    const { data } = await apiGet('/v1/endpoints');
    $('[data-doc-endpoints]').textContent = `${data.endpoints.length} endpoints`;
    $('[data-doc-version]').textContent = `api ${data.version}`;
    $('[data-upstream]').textContent = data.source;
    renderReference(data);
    renderLimits(data.limits);
    $('[data-unavailable]').innerHTML = `<ul>${data.unavailable.map((item) => `<li><b>${escapeHtml(item.topic)}</b><span>${escapeHtml(item.reason)}</span></li>`).join('')}</ul>`;
    $('[data-doc-search]').addEventListener('input', (event) => renderReference(data, event.target.value.trim().toLowerCase()));
  } catch (error) {
    showError($('[data-ref-list]'), error, { title: 'Could not load the endpoint catalogue', retry: loadCatalog });
    showError($('[data-limits]').parentElement, error, { title: 'Could not load limits' });
  }
}

async function loadLive() {
  const live = $('[data-doc-live]');
  try {
    const { data } = await apiGet('/v1/status');
    live.textContent = `Hyperliquid reachable · ${data.upstream_latency_ms} ms`;
    $('[data-live-dot]')?.classList.remove('is-down');
  } catch (error) {
    live.textContent = `upstream error: ${error.code}`;
    $('[data-live-dot]')?.classList.add('is-down');
  }
  try {
    const { meta } = await apiGet('/v1/markets', { query: { limit: 1000 } });
    $('[data-doc-markets]').textContent = `${integer(meta.count)} perp markets`;
  } catch {
    $('[data-doc-markets]').textContent = 'markets: error';
  }
}

function renderToc() {
  const sections = $$('.doc-section');
  const nav = $('[data-toc]');
  nav.innerHTML = sections.map((section) => `<a href="#${section.id}" data-toc-link="${section.id}">${escapeHtml($('h1', section)?.textContent ?? section.id)}</a>`).join('');
  const links = [...$$('[data-toc-link]'), ...$$('.doc-nav a')];
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      for (const link of links) link.classList.toggle('is-on', link.getAttribute('href') === `#${entry.target.id}`);
    }
  }, { rootMargin: '-20% 0px -70% 0px' });
  for (const section of sections) observer.observe(section);
}

function boot() {
  initChrome();
  $('[data-base-url]').textContent = apiBase();
  bindQuickstart();
  bindTryButtons();
  renderToc();
  document.addEventListener('keydown', (event) => {
    if (event.key === '/' && document.activeElement?.tagName !== 'INPUT') {
      event.preventDefault();
      $('[data-doc-search]').focus();
      $('#reference').scrollIntoView();
    }
  });
  loadCatalog();
  loadLive();
}

boot();
