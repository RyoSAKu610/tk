import assert from 'node:assert/strict';
import test from 'node:test';
import { createMarketEngine } from '../src/hyperdash/market-engine.js';
import { createDataApi, createMemoryStorage, DEMO_ACCOUNT } from '../src/hyperdash/data-api.js';

function setup() {
  const api = createDataApi({ engine: createMarketEngine({ live: false }), storage: createMemoryStorage(), latency: false });
  const key = api.issueKey({ name: 'test' });
  return { api, key, headers: { authorization: `Bearer ${key.secret}` } };
}

test('static routes win over parameter routes, and quote and batch work', async () => {
  const { api, headers } = setup();
  assert.equal(api.matchRoute('GET', '/v1/accounts/batch').endpoint.path, '/v1/accounts/batch');
  assert.equal(api.matchRoute('GET', '/v1/accounts/batch/stats').endpoint.path, '/v1/accounts/batch/stats');
  const batch = await api.request({ path: '/v1/accounts/batch', query: { addresses: DEMO_ACCOUNT }, headers });
  assert.equal(batch.status, 200);
  const quote = await api.request({ path: '/v1/quote', query: { route: 'GET /v1/markets/BTC/candles?limit=3' }, headers });
  assert.equal(quote.status, 200);
  assert.equal(quote.credits, 0);
});

test('stream synchronous acknowledgements charge credits and do not time out', async () => {
  const { api, key } = setup();
  const messages = [];
  let stream;
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('stream did not deliver a batch')), 6000);
    stream = api.openStream({ key: key.secret, onMessage: (message) => {
      messages.push(message);
      if (message.op === 'data') stream.send({ op: 'ack', sub: message.sub, batch: message.batch });
      if (message.op === 'acked') { clearTimeout(timeout); resolve(); }
    } });
    stream.send({ op: 'subscribe', channel: 'trades', coin: 'BTC' });
  });
  try {
    assert.equal(messages[0].op, 'ready');
    assert.equal(messages.find((m) => m.op === 'acked').credits_charged, 1);
    assert.equal(stream.creditsSpent, 1);
  } finally { stream.close(); }
});
