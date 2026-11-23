/**
 * Cloudflare Worker entry. `/v1/*` is answered by the data API (which calls
 * the official Hyperliquid info endpoint); everything else is a static asset.
 * The API instance is created once per isolate so its cache, weight budget and
 * client rate limiter persist between requests on that isolate.
 */

import { createApi } from '../server/api.js';

let api = null;

export default {
  async fetch(request, env) {
    if (!api) api = createApi({ env, fetchImpl: (...args) => fetch(...args) });
    const response = await api.handle(request);
    if (response) return response;
    return env.ASSETS.fetch(request);
  },
};
