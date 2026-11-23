import { createMarketEngine } from './market-engine.js';
import { createDataApi, browserStorage, PLANS, SCOPES, STREAM_CHANNELS, DEMO_ACCOUNT } from './data-api.js';
import { $, $$, el, escapeHtml, money, price, integer, ago, copyText, toast, debounce, clockUTC, highlightJson, highlightShell, fillSelect } from './lib.js';

const engine = createMarketEngine();
const api = createDataApi({ engine, storage: browserStorage(), latency: true });
const build = globalThis.__HYPERDASH_BUILD__ ?? {};
const ENDPOINTS = build.endpoints?.length
  ? build.endpoints
  : api.endpoints.map(({ method, path, group, summary, scope, base, perRow, maxLimit, feature }) => ({
    method, path, group, summary, scope, base, perRow, maxLimit, feature,
  }));

if (!api.keys().length) api.issueKey({ name: 'docs-demo', expiresInDays: 365 });
const demoKey = api.keys()[0].secret;
const auth = { authorization: `Bearer ${demoKey}` };

/* ------------------------------------------------------------------ theme */

function applySkin(name) {
  document.documentElement.dataset.skin = name === 'terminal' ? 'terminal' : 'dash';
  for (const button of $$('[data-skin-target]')) button.setAttribute('aria-pressed', String(button.dataset.skinTarget === document.documentElement.dataset.skin));
  try { localStorage.setItem('hyperdash:skin', document.documentElement.dataset.skin); } catch { /* ignore */ }
}

function bindSkin() {
  let saved = null;
  try { saved = localStorage.getItem('hyperdash:skin'); } catch { /* ignore */ }
  const query = new URLSearchParams(location.search).get('skin');
  applySkin(query === 'terminal' || query === 'dash' ? query : saved === 'terminal' ? 'terminal' : 'dash');
  for (const button of $$('[data-skin-target]')) button.addEventListener('click', () => applySkin(button.dataset.skinTarget));
}

/* --------------------------------------------------------------- snippets */

const SNIPPETS = {
  quickstart: {
    curl: `export HYPERDASH_API_KEY="hdk_sk_..."

curl "https://data.hyperdash.com/v1/markets/BTC/candles?interval=1h&limit=24" \\
  -H "Authorization: Bearer $HYPERDASH_API_KEY"`,
    node: `const key = process.env.HYPERDASH_API_KEY;

const response = await fetch(
  "https://data.hyperdash.com/v1/markets/BTC/candles?interval=1h&limit=24",
  { headers: { Authorization: \`Bearer \${key}\` } },
);
if (!response.ok) throw new Error((await response.json()).code);

const { data, meta } = await response.json();
console.log(data.at(-1).c, meta.forming);
console.log(response.headers.get("X-Credits-Charged"));`,
    python: `import os, requests

key = os.environ["HYPERDASH_API_KEY"]
r = requests.get(
    "https://data.hyperdash.com/v1/markets/BTC/candles",
    params={"interval": "1h", "limit": 24},
    headers={"Authorization": f"Bearer {key}"},
    timeout=10,
)
r.raise_for_status()
page = r.json()
print(page["data"][-1]["c"], r.headers["X-Credits-Charged"])`,
  },
  streams: {
    node: `import WebSocket from "ws";

const ws = new WebSocket("wss://data.hyperdash.com/v1/stream", {
  headers: { Authorization: \`Bearer \${process.env.HYPERDASH_API_KEY}\` },
});

let cursor = null;
ws.on("message", async (raw) => {
  const msg = JSON.parse(raw);
  switch (msg.op) {
    case "ready":
      ws.send(JSON.stringify({ op: "subscribe", channel: "liquidations", coin: "ETH", cursor }));
      break;
    case "data":
      await handle(msg.events);                       // process first...
      cursor = msg.cursor;
      ws.send(JSON.stringify({ op: "ack", sub: msg.sub, batch: msg.batch }));  // ...then ack
      break;
    case "gap":  backfillOverRest(msg.from, msg.to); break;
    case "ping": ws.send(JSON.stringify({ op: "pong" })); break;
    case "error": console.error(msg.code, msg.detail); break;
  }
});`,
    python: `import asyncio, json, os, websockets

async def main():
    key = os.environ["HYPERDASH_API_KEY"]
    async with websockets.connect(
        "wss://data.hyperdash.com/v1/stream",
        additional_headers={"Authorization": f"Bearer {key}"},
    ) as ws:
        async for raw in ws:
            msg = json.loads(raw)
            if msg["op"] == "ready":
                await ws.send(json.dumps({"op": "subscribe", "channel": "trades", "coin": "BTC"}))
            elif msg["op"] == "data":
                for event in msg["events"]:
                    print(event["px"], event["sz"])
                await ws.send(json.dumps({"op": "ack", "sub": msg["sub"], "batch": msg["batch"]}))
            elif msg["op"] == "ping":
                await ws.send(json.dumps({"op": "pong"}))

asyncio.run(main())`,
    curl: `websocat -H="Authorization: Bearer $HYPERDASH_API_KEY" \\
  wss://data.hyperdash.com/v1/stream

> {"op":"subscribe","channel":"trades","coin":"BTC"}
< {"op":"ready","key_id":"key_8f21","environment":"production"}
< {"op":"subscribed","sub":1,"channel":"trades","coin":"BTC","cursor":null}`,
  },
  agents: {
    claude: `claude mcp add --transport http hyperdash https://data.hyperdash.com/mcp \\
  --header "Authorization: Bearer $HYPERDASH_API_KEY"

# Then, in a session:
# "What are the largest BTC positions within 5% of liquidation right now?"`,
    json: `{
  "mcpServers": {
    "hyperdash": {
      "type": "http",
      "url": "https://data.hyperdash.com/mcp",
      "headers": { "Authorization": "Bearer hdk_sk_..." }
    }
  }
}`,
    node: `import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const transport = new StreamableHTTPClientTransport(
  new URL("https://data.hyperdash.com/mcp"),
  { requestInit: { headers: { Authorization: \`Bearer \${process.env.HYPERDASH_API_KEY}\` } } },
);
const client = new Client({ name: "my-desk", version: "1.0.0" });
await client.connect(transport);

const { tools } = await client.listTools();          // one per endpoint
const result = await client.callTool({
  name: "get_markets_coin_positions",
  arguments: { coin: "BTC", limit: 20 },
});`,
  },
};

function bindCodeTabs() {
  for (const group of $$('[data-code-tabs]')) {
    const section = group.closest('.doc-section')?.id;
    const snippets = section === 'streams' ? SNIPPETS.streams : section === 'ai-agents' ? SNIPPETS.agents : SNIPPETS.quickstart;
    const block = $('[data-code-block]', group);
    const buttons = $$('[data-lang]', group);
    const render = (lang) => {
      block.innerHTML = `<code>${highlightShell(snippets[lang] ?? '')}</code>`;
      for (const button of buttons) {
        button.classList.toggle('is-on', button.dataset.lang === lang);
        button.setAttribute('aria-selected', String(button.dataset.lang === lang));
      }
    };
    for (const button of buttons) button.addEventListener('click', () => render(button.dataset.lang));
    render(buttons[0]?.dataset.lang ?? Object.keys(snippets)[0]);
    $('[data-copy-code]', group)?.addEventListener('click', () => copyText(block.textContent, { label: 'Snippet copied' }));
  }
}

/* ------------------------------------------------------------- live demos */

async function loadJsonInto(selector, path, query = {}) {
  const node = $(selector);
  if (!node) return;
  const response = await api.request({ path, query, headers: auth, delay: false });
  node.innerHTML = `<code>${highlightJson(response.body)}</code>`;
}

async function loadHeadersInto(selector, path, query = {}) {
  const node = $(selector);
  if (!node) return;
  const response = await api.request({ path, query, headers: auth, delay: false });
  const lines = [
    `HTTP/1.1 ${response.status} ${response.status === 200 ? 'OK' : 'Error'}`,
    ...Object.entries(response.headers).map(([key, value]) => `${key}: ${value}`),
  ].join('\n');
  node.innerHTML = `<code>${highlightShell(lines)}</code>`;
}

/* -------------------------------------------------------------- reference */

const SCOPE_GRANTS = {
  'markets:read': 'Markets, candles, books, funding, open interest, market series, market positions.',
  'accounts:read': 'Wallets, positions, fills, orders, ledger, balances, account value and PnL.',
  'liquidations:read': 'Liquidation events, cascades and liquidation summaries.',
  'analytics:read': 'Leaderboards, cohorts, positioning, wallet analytics, wallet lists and snapshots.',
  'streams:read': 'Opening a WebSocket stream and subscribing to channels.',
  'usage:read': 'The credit balance on GET /v1/me.',
};

function bindScopes() {
  const host = $('[data-doc-scopes]');
  if (!host) return;
  host.innerHTML = SCOPES.map((scope) => `<tr><td><code>${escapeHtml(scope)}</code></td><td>${escapeHtml(SCOPE_GRANTS[scope] ?? '')}</td></tr>`).join('');
  const live = $('[data-doc-live]');
  if (live) live.textContent = `${ENDPOINTS.length} endpoints ready`;
  const endpoints = $('[data-doc-endpoints]');
  if (endpoints) endpoints.textContent = `${ENDPOINTS.length} endpoints`;
  const markets = $('[data-doc-markets]');
  if (markets) markets.textContent = `${engine.markets.length} markets`;
}

function renderReference() {
  const list = $('[data-ref-list]');
  const count = $('[data-ref-count]');
  let query = '';
  let scope = 'all';
  const render = () => {
    const groups = new Map();
    for (const endpoint of ENDPOINTS) {
      const haystack = `${endpoint.method} ${endpoint.path} ${endpoint.group} ${endpoint.summary}`.toLowerCase();
      if (query && !haystack.includes(query)) continue;
      if (scope !== 'all' && endpoint.scope !== scope) continue;
      if (!groups.has(endpoint.group)) groups.set(endpoint.group, []);
      groups.get(endpoint.group).push(endpoint);
    }
    let total = 0;
    list.innerHTML = [...groups.entries()].map(([group, endpoints]) => {
      total += endpoints.length;
      return `<div class="ref-group">
        <h3>${escapeHtml(group)}<span>${endpoints.length}</span></h3>
        ${endpoints.map((endpoint) => `
          <details class="ref-item">
            <summary>
              <span class="method method--inline">${escapeHtml(endpoint.method)}</span>
              <code>${escapeHtml(endpoint.path)}</code>
              <span class="ref-item__scope">${escapeHtml(endpoint.scope ?? 'public')}</span>
              <span class="ref-item__price">${endpoint.base ? `${endpoint.base}+${endpoint.perRow}/row` : 'free'}</span>
            </summary>
            <div class="ref-item__body">
              <p>${escapeHtml(endpoint.summary ?? '')}</p>
              <dl>
                <div><dt>Scope</dt><dd><code>${escapeHtml(endpoint.scope ?? '—')}</code></dd></div>
                <div><dt>Base cost</dt><dd>${endpoint.base ?? 0} credits</dd></div>
                <div><dt>Per row</dt><dd>${endpoint.perRow ?? 0}</dd></div>
                <div><dt>Max limit</dt><dd>${endpoint.maxLimit ?? '—'}</dd></div>
                ${endpoint.feature ? `<div><dt>Plan feature</dt><dd>${escapeHtml(endpoint.feature)}</dd></div>` : ''}
              </dl>
              <div class="ref-item__actions">
                <button class="btn btn--outline btn--sm" type="button" data-try="${escapeHtml(`${endpoint.method} ${endpoint.path}`)}" data-try-sample>Send sample</button>
              </div>
              <pre class="code-block ref-item__out" hidden><code></code></pre>
            </div>
          </details>`).join('')}
      </div>`;
    }).join('');
    count.textContent = `${total} endpoints`;
    for (const button of $$('[data-try-sample]', list)) {
      button.addEventListener('click', () => runSample(button));
    }
  };
  const searchReference = debounce((value) => { query = value.trim().toLowerCase(); render(); }, 120);
  $('[data-ref-search]')?.addEventListener('input', (event) => searchReference(event.currentTarget.value));
  for (const button of $$('[data-ref-scope]')) {
    button.addEventListener('click', () => {
      scope = button.dataset.refScope;
      for (const other of $$('[data-ref-scope]')) other.classList.toggle('is-on', other === button);
      render();
    });
  }
  render();
}

function sampleRequestPath(route) {
  return route
    .replace(/^\w+\s/, '')
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
    .replace(/[{:]asset[^/]*/g, 'BTC')
    .replace(/[{:]kind[^/]*/g, 'all');
}

async function runSample(button) {
  const out = button.closest('.ref-item__body')?.querySelector('.ref-item__out');
  if (!out) return;
  out.hidden = false;
  out.innerHTML = '<code>Sending…</code>';
  const path = sampleRequestPath(button.dataset.try);
  const matched = api.matchRoute('GET', path);
  const limit = Math.min(3, matched?.endpoint.maxLimit ?? 3);
  const query = path.includes('candles') ? { interval: '1h', limit: 3 } : limit > 1 ? { limit } : {};
  if (path === '/v1/quote') query.route = 'GET /v1/markets/BTC/candles?limit=3';
  if (path === '/v1/accounts/batch') query.addresses = DEMO_ACCOUNT;
  const response = await api.request({ path, query, headers: auth });
  const body = response.status === 200
    ? { status: response.status, credits: response.credits, body: response.body }
    : { status: response.status, credits: 0, body: response.body };
  out.innerHTML = `<code>${highlightJson(body)}</code>`;
}

function renderCreditTable() {
  const body = $('[data-credit-table] tbody');
  if (!body) return;
  body.innerHTML = ENDPOINTS.filter((endpoint) => (endpoint.base ?? 0) > 0).map((endpoint) => {
    const rows = endpoint.maxLimit ?? 100;
    const cost = Math.max(1, Math.ceil((endpoint.base ?? 0) + rows * (endpoint.perRow ?? 0)));
    return `<tr>
      <td><div class="pair"><b class="mono">${escapeHtml(endpoint.method)}</b><code>${escapeHtml(endpoint.path)}</code></div></td>
      <td class="num mono">${endpoint.base ?? 0}</td>
      <td class="num mono">${endpoint.perRow ?? 0}</td>
      <td class="num mono">${integer(endpoint.maxLimit ?? 0)}</td>
      <td class="num mono">${integer(cost)}</td>
    </tr>`;
  }).join('');
}

function renderPlanTable() {
  const table = $('[data-plan-table]');
  if (!table) return;
  const ids = ['starter', 'growth', 'scale', 'enterprise'];
  const rows = [
    ['Monthly price', (plan) => (plan.priceMonthly === null ? 'Custom' : `$${integer(plan.priceMonthly)}`)],
    ['Yearly price', (plan) => (plan.priceYearly === null ? 'Custom' : `$${integer(plan.priceYearly)}`)],
    ['Credits per month', (plan) => (plan.credits === null ? 'Committed' : integer(plan.credits))],
    ['History depth', (plan) => (plan.historyDays === null ? 'Full history' : `${plan.historyDays} days`)],
    ['Requests per second', (plan) => plan.rps],
    ['Burst', (plan) => plan.burst],
    ['Concurrent requests', (plan) => plan.concurrency],
    ['Stream connections', (plan) => plan.streamConnections],
    ['Wallets per batch request', (plan) => integer(plan.batchWallets)],
    ['Rows per wallet-list query', (plan) => integer(plan.rowsPerWalletList)],
    ['New wallets per day', (plan) => integer(plan.newWalletsPerDay)],
    ['Request log retention', (plan) => `${plan.logDays} days`],
    ['Team seats', (plan) => plan.seats],
    ['Projects', (plan) => plan.projects],
  ];
  table.querySelector('thead').innerHTML = `<tr><th scope="col">Limit</th>${ids.map((id) => `<th scope="col" class="num">${PLANS[id].name}</th>`).join('')}</tr>`;
  table.querySelector('tbody').innerHTML = rows.map(([label, read]) => `<tr><th scope="row">${escapeHtml(label)}</th>${ids.map((id) => `<td>${escapeHtml(String(read(PLANS[id])))}</td>`).join('')}</tr>`).join('');

  const features = $('[data-feature-table]');
  const featureRows = [
    ['Streams', 'streams'], ['Footprint', 'footprint'], ['Order-level (L4) book', 'l4'],
    ['Prediction market outcome statistics', 'outcomes'], ['Priority fee flow', 'priority'], ['Async jobs', 'jobs'],
  ];
  features.querySelector('thead').innerHTML = `<tr><th scope="col">Feature</th>${ids.map((id) => `<th scope="col" class="num">${PLANS[id].name}</th>`).join('')}</tr>`;
  features.querySelector('tbody').innerHTML = featureRows.map(([label, key]) => `<tr><th scope="row">${escapeHtml(label)}</th>${ids.map((id) => `<td>${PLANS[id].features[key] ? '<span class="up">✓</span>' : '<span class="muted">—</span>'}</td>`).join('')}</tr>`).join('');
}

function renderChannels() {
  const body = $('[data-channel-table]');
  if (!body) return;
  body.innerHTML = STREAM_CHANNELS.map((channel) => `<tr>
    <td><code>${escapeHtml(channel.channel)}</code></td>
    <td>${escapeHtml(channel.target)}</td>
    <td class="num mono">${channel.credits}</td>
    <td>${escapeHtml(channel.description)}</td>
  </tr>`).join('');
}

/* -------------------------------------------------------------- pager demo */

const pager = { page: 0, rows: 0, credits: 0, lastSeen: null };

async function pagerNext() {
  const out = $('[data-pager-output]');
  pager.page += 1;
  const params = { limit: 50 };
  if (pager.lastSeen !== null) params.end_time = pager.lastSeen - 1;
  const response = await api.request({ path: '/v1/liquidations', query: params, headers: auth });
  const rows = response.body?.data ?? [];
  pager.rows += rows.length;
  pager.credits += response.credits ?? 0;
  pager.lastSeen = rows.at(-1)?.t ?? null;
  const hasMore = pager.lastSeen !== null && Date.now() - pager.lastSeen < 7 * 86_400_000;
  $('[data-pager-pages]').textContent = String(pager.page);
  $('[data-pager-rows]').textContent = String(pager.rows);
  $('[data-pager-credits]').textContent = String(pager.credits);
  $('[data-pager-has-more]').textContent = String(hasMore);
  out.innerHTML = `<code>${highlightJson({
    page: pager.page,
    request: { path: '/v1/liquidations', params },
    status: response.status,
    credits_charged: response.credits,
    rows: rows.length,
    newest: rows[0] ? { t: rows[0].t, coin: rows[0].coin, notional_usd: rows[0].notional_usd } : null,
    oldest: rows.at(-1) ? { t: rows.at(-1).t, coin: rows.at(-1).coin } : null,
    next_end_time: pager.lastSeen ? pager.lastSeen - 1 : null,
    has_more: hasMore,
  })}</code>`;
}

/* ------------------------------------------------------------ misc demos */

function bindTryBars() {
  for (const button of $$('[data-try]')) {
    button.addEventListener('click', async () => {
      const output = button.closest('.doc-section')?.querySelector('[data-try-output]');
      if (!output) return;
      output.hidden = false;
      const [method, target] = button.dataset.try.split(' ');
      const url = new URL(target, 'https://data.hyperdash.com');
      const response = await api.request({ method, path: url.pathname, query: Object.fromEntries(url.searchParams), headers: auth });
      output.innerHTML = `<code>${highlightJson({ status: response.status, credits: response.credits, body: response.body })}</code>`;
    });
  }
}

function bindFormats() {
  let format = 'application/json';
  for (const button of $$('[data-format]')) {
    button.addEventListener('click', () => {
      format = button.dataset.format;
      for (const other of $$('[data-format]')) other.classList.toggle('is-on', other === button);
    });
  }
  $('[data-format-run]')?.addEventListener('click', async () => {
    const output = $('[data-format-output]');
    output.hidden = false;
    const response = await api.request({
      path: '/v1/markets/BTC/trades',
      query: { limit: 3 },
      headers: { ...auth, accept: format },
      delay: false,
    });
    output.innerHTML = `<code>${highlightShell(`${response.headers['content-type']}\n\n${response.raw}`)}</code>`;
  });
}

function bindQuote() {
  const input = $('[data-quote-input]');
  $('[data-quote-run]')?.addEventListener('click', async () => {
    const output = $('[data-quote-output]');
    output.hidden = false;
    const response = await api.request({ path: '/v1/quote', query: { route: input.value.trim() } });
    output.innerHTML = `<code>${highlightJson({ status: response.status, credits: response.credits, body: response.body })}</code>`;
  });
}

const ERRORS = [
  [400, 'invalid_parameter', 'A parameter is malformed or out of range, a dex filter names an unknown dex, or the cursor has expired or doesn’t match the query.'],
  [400, 'range_too_large', 'The time range exceeds the endpoint’s maximum, or the response would exceed 2 MiB. Narrow the range or lower limit.'],
  [401, 'invalid_key', 'The key is missing or malformed.'],
  [401, 'expired_key', 'The key has expired. Create a new key.'],
  [401, 'revoked_key', 'The key was revoked.'],
  [403, 'insufficient_scope', 'The key lacks the scope this endpoint needs.'],
  [403, 'plan_required', 'The workspace has no active plan, so its keys stop working.'],
  [403, 'history_limit', 'Your plan doesn’t include that much history. detail states your plan’s history depth.'],
  [403, 'feature_not_in_plan', 'Your plan doesn’t include this endpoint or feature.'],
  [403, 'credits_exhausted', 'No credits left, or a connection or project budget is used up.'],
  [403, 'max_credits_exceeded', 'The request’s maximum cost exceeds X-Max-Credits.'],
  [404, 'not_found', 'Unknown market, dex, token, vault or other named item, or unknown route.'],
  [409, 'price_changed', 'The endpoint’s price changed since the X-Credit-Price-Version you sent. Quote again.'],
  [429, 'rate_limited', 'Too many requests, too many concurrent-request slots in use, or a busy server. Wait for Retry-After.'],
  [429, 'extraction_limit', 'An extraction limit is reached. detail and the limits array say which limit.'],
  [503, 'upstream_busy', 'A data source is protecting itself. Retry after Retry-After.'],
  [503, 'unavailable', 'We can’t serve the request safely right now. Retry after Retry-After.'],
];

function renderErrors() {
  const body = $('[data-error-table]');
  if (body) {
    body.innerHTML = ERRORS.map(([status, code, meaning]) => `<tr><td class="num mono">${status}</td><td><code>${code}</code></td><td>${escapeHtml(meaning)}</td></tr>`).join('');
  }
  const samples = [
    ['missing key', { path: '/v1/markets' }, 'invalid_key'],
    ['bad interval', { path: '/v1/markets/BTC/candles', query: { interval: '7m' } }, 'invalid_parameter'],
    ['unknown market', { path: '/v1/markets/NOPE/candles' }, 'not_found'],
    ['too much history', { path: '/v1/accounts/' + DEMO_ACCOUNT + '/fills', query: { start_time: Date.now() - 200 * 86_400_000 } }, 'history_limit'],
    ['not in plan', { path: '/v1/markets/BTC/book/orders' }, 'feature_not_in_plan'],
  ];
  const host = $('[data-auth-errors]');
  if (host) {
    host.innerHTML = samples.map(([label, request]) => `<button class="btn btn--outline btn--sm" type="button" data-error-try="${escapeHtml(label)}">${escapeHtml(label)}</button>`).join('');
    for (const button of $$('[data-error-try]', host)) {
      button.addEventListener('click', async () => {
        const sample = samples.find(([label]) => label === button.dataset.errorTry);
        toast(`Sending: ${sample[0]}`, { tone: 'warn' });
        const response = await api.request({ ...sample[1], headers: sample[0] === 'missing key' ? {} : auth });
        const output = $('[data-error-output]');
        if (output) {
          output.hidden = false;
          output.innerHTML = `<code>${highlightJson({ status: response.status, credits: response.credits, headers: { 'x-problem-code': response.headers['x-problem-code'] }, body: response.body })}</code>`;
        }
      });
    }
  }
  const buttons = $('[data-error-buttons]');
  if (buttons) {
    buttons.innerHTML = samples.map(([label]) => `<button class="btn btn--outline btn--sm" type="button" data-error-global="${escapeHtml(label)}">${escapeHtml(label)}</button>`).join('');
    for (const button of $$('[data-error-global]', buttons)) {
      button.addEventListener('click', async () => {
        const sample = samples.find(([label]) => label === button.dataset.errorGlobal);
        const response = await api.request({ ...sample[1], headers: sample[0] === 'missing key' ? {} : auth });
        const output = $('[data-error-output]');
        output.hidden = false;
        output.innerHTML = `<code>${highlightJson({ status: response.status, credits: response.credits, body: response.body })}</code>`;
      });
    }
  }
}

async function renderLiveSamples() {
  await loadJsonInto('[data-live-example="candles"]', '/v1/markets/BTC/candles', { interval: '1h', limit: 2 });
  await loadHeadersInto('[data-live-example="headers"]', '/v1/markets/BTC/candles', { interval: '1h', limit: 24 });
  const sample = $('[data-error-sample]');
  if (sample) {
    const response = await api.request({ path: '/v1/markets/BTC/candles', query: { interval: '7m' }, headers: auth, delay: false });
    sample.innerHTML = `<code>${highlightJson(response.body)}</code>`;
  }
  const throttled = $('[data-429-sample]');
  if (throttled) {
    // Drive the bucket to empty so the real 429 is produced by the limiter.
    const burst = api.plan().burst;
    let last = null;
    for (let index = 0; index <= burst + 1; index += 1) {
      last = await api.request({ path: '/v1/status', delay: false });
      last = await api.request({ path: '/v1/markets/mids', headers: auth, delay: false });
      if (last.status === 429) break;
    }
    api.state.buckets.clear();
    throttled.innerHTML = `<code>${highlightJson({ status: last?.status, headers: { 'retry-after': last?.headers['retry-after'] }, body: last?.body })}</code>`;
  }
}

function renderMcpTools() {
  const host = $('[data-mcp-tools]');
  if (!host) return;
  const picks = ENDPOINTS.filter((endpoint) => endpoint.scope).slice(0, 12);
  host.innerHTML = picks.map((endpoint) => {
    const name = endpoint.path.replace(/^\/v1\//, '').replace(/[{}/]/g, '_').replace(/_+/g, '_').replace(/_$/, '');
    return `<div class="tool-card"><code>${escapeHtml(name)}</code><span>${escapeHtml(endpoint.summary ?? '')}</span><b>${escapeHtml(endpoint.scope)}</b></div>`;
  }).join('') + `<p class="tool-grid__foot">…and ${ENDPOINTS.length - picks.length} more, plus <code>time_window</code> and <code>give_feedback</code>.</p>`;
}

async function renderStatus() {
  const grid = $('[data-status-grid]');
  const frontier = $('[data-status-frontier]');
  const changelog = $('[data-changelog]');
  const response = await api.request({ path: '/v1/status', delay: false });
  const status = response.body?.data;
  if (grid && status) {
    grid.innerHTML = status.components.map((component) => `<div class="status-card"><span>${escapeHtml(component.name)}</span><b class="up">● ${escapeHtml(component.status)}</b></div>`).join('')
      + status.regions.map((region) => `<div class="status-card"><span>${escapeHtml(region.region)}</span><b class="mono">p50 ${region.p50_ms} ms · p99 ${region.p99_ms} ms</b></div>`).join('');
  }
  if (frontier && status) {
    frontier.innerHTML = `<table class="table table--kv"><tbody>${Object.entries(status.frontier).map(([key, value]) => `<tr><th scope="row">${escapeHtml(key)}</th><td class="mono">${escapeHtml(String(value))} <span class="muted">· ${ago(Number(value))}</span></td></tr>`).join('')}</tbody></table>`;
  }
  const log = await api.request({ path: '/v1/changelog', delay: false });
  if (changelog) {
    changelog.innerHTML = (log.body?.data ?? []).map((entry) => `<li>
      <time class="mono muted">${escapeHtml(entry.date)}</time>
      <div><b>${escapeHtml(entry.title)}</b><span class="chip">${escapeHtml(entry.type)}</span><p>${escapeHtml(entry.detail)}</p></div>
    </li>`).join('');
  }
}

/* -------------------------------------------------------------------- toc */

function renderToc() {
  const sections = $$('.doc-section');
  const nav = $('[data-toc]');
  if (!nav) return;
  nav.innerHTML = sections.map((section) => `<a href="#${section.id}" data-toc-link="${section.id}">${escapeHtml($('h1', section)?.textContent ?? section.id)}</a>`).join('');
  const links = $$('[data-toc-link]');
  const setActive = (id) => {
    for (const link of links) link.classList.toggle('is-on', link.dataset.tocLink === id);
  };
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) if (entry.isIntersecting) setActive(entry.target.id);
  }, { rootMargin: '-20% 0px -70% 0px' });
  for (const section of sections) observer.observe(section);
  setActive(sections[0]?.id);
}

function bindDocNav() {
  const links = $$('.doc-nav a');
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      for (const link of links) link.classList.toggle('is-on', link.getAttribute('href') === `#${entry.target.id}`);
    }
  }, { rootMargin: '-15% 0px -75% 0px' });
  for (const section of $$('.doc-section')) observer.observe(section);

  const search = $('[data-doc-search]');
  const filter = () => {
    const query = search.value.trim().toLowerCase();
    for (const group of $$('.doc-nav__group')) {
      let visible = 0;
      for (const link of $$('a', group)) {
        const section = $(link.getAttribute('href'));
        const haystack = `${link.textContent} ${section?.textContent ?? ''}`.toLowerCase();
        const match = !query || haystack.includes(query);
        link.hidden = !match;
        if (match) visible += 1;
      }
      group.hidden = visible === 0;
    }
  };
  search?.addEventListener('input', debounce(filter, 120));
  document.addEventListener('keydown', (event) => {
    if (event.key === '/' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
      event.preventDefault();
      search?.focus();
    }
    if (event.key === 'Escape' && document.activeElement === search) search.blur();
  });
}

function startClock() {
  const node = $('[data-clock]');
  const tick = () => { if (node) node.textContent = clockUTC(); };
  tick();
  setInterval(tick, 1_000);
}

function init() {
  bindSkin();
  bindDocNav();
  bindCodeTabs();
  bindScopes();
  renderReference();
  renderCreditTable();
  renderPlanTable();
  renderChannels();
  renderErrors();
  renderMcpTools();
  bindTryBars();
  bindFormats();
  bindQuote();
  $('[data-pager-next]')?.addEventListener('click', pagerNext);
  renderLiveSamples();
  renderStatus();
  renderToc();
  startClock();
  void el; void price; void money; void fillSelect; void copyText;
}

init();
