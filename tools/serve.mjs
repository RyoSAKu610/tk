import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApi } from '../src/server/api.js';

const root = resolve(fileURLToPath(new URL('../dist/', import.meta.url)));
const port = Number.parseInt(process.env.PORT ?? '4173', 10);
const host = process.env.HOST ?? '127.0.0.1';
const startPage = process.env.START_PAGE ?? 'index.html';
if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) throw new Error('PORT must be between 1 and 65535');
if (!['127.0.0.1', '0.0.0.0'].includes(host)) throw new Error('HOST must be 127.0.0.1 or 0.0.0.0');
if (!['index.html', 'researchphantom.html', 'cast-lab.html', 'character-story.html', 'data-motion.html'].includes(startPage)) throw new Error('START_PAGE must be a public HTML entrypoint');

const mimeTypes = new Map([
  ['.css', 'text/css; charset=utf-8'], ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'], ['.json', 'application/json; charset=utf-8'],
  ['.mp3', 'audio/mpeg'], ['.ogg', 'audio/ogg'], ['.mp4', 'video/mp4'],
  ['.png', 'image/png'], ['.svg', 'image/svg+xml'], ['.webp', 'image/webp'],
]);

function safePathname(rawUrl) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(rawUrl, 'http://localhost').pathname);
  } catch {
    return null;
  }
  if (pathname.includes('\0')) return null;
  const relative = normalize(pathname).replace(/^[/\\]+/, '');
  const path = resolve(join(root, relative || startPage));
  if (path !== root && !path.startsWith(`${root}${sep}`)) return null;
  return path;
}

function parseRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header ?? '');
  if (!match) return null;
  let start;
  let end;
  if (match[1] === '') {
    const suffix = Number.parseInt(match[2], 10);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number.parseInt(match[1], 10);
    end = match[2] === '' ? size - 1 : Number.parseInt(match[2], 10);
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= size) return null;
  return { start, end: Math.min(end, size - 1) };
}

// Same data API as the Cloudflare Worker, configured from process.env.
const api = createApi({ env: process.env });

async function handleApi(request, response) {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (typeof value === 'string') headers.set(name, value);
  }
  if (!headers.has('x-forwarded-for')) headers.set('x-forwarded-for', request.socket.remoteAddress ?? 'local');
  const result = await api.handle(new Request(url, { method: request.method, headers }));
  if (!result) return false;
  response.writeHead(result.status, Object.fromEntries(result.headers));
  response.end(Buffer.from(await result.arrayBuffer()));
  return true;
}

const server = createServer(async (request, response) => {
  if ((request.url ?? '').startsWith('/v1')) {
    try {
      if (await handleApi(request, response)) return;
    } catch (error) {
      console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'error', event: 'serve.api_exception', detail: String(error?.stack || error) }));
      response.writeHead(500, { 'content-type': 'application/problem+json' }).end(JSON.stringify({ status: 500, code: 'internal_error', detail: 'Unexpected server error' }));
      return;
    }
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { allow: 'GET, HEAD' }).end();
    return;
  }
  let path = safePathname(request.url ?? '/');
  if (!path) {
    response.writeHead(400).end('Bad request');
    return;
  }
  try {
    let info = await stat(path);
    if (info.isDirectory()) {
      path = join(path, 'index.html');
      info = await stat(path);
    }
    if (!info.isFile()) throw new Error('not a file');
    const type = mimeTypes.get(extname(path).toLowerCase()) ?? 'application/octet-stream';
    const headers = {
      'content-type': type,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'accept-ranges': 'bytes',
    };
    const range = parseRange(request.headers.range, info.size);
    if (request.headers.range && !range) {
      response.writeHead(416, { ...headers, 'content-range': `bytes */${info.size}` }).end();
      return;
    }
    if (range) {
      headers['content-range'] = `bytes ${range.start}-${range.end}/${info.size}`;
      headers['content-length'] = String(range.end - range.start + 1);
      response.writeHead(206, headers);
      if (request.method === 'HEAD') response.end();
      else createReadStream(path, range).pipe(response);
      return;
    }
    headers['content-length'] = String(info.size);
    response.writeHead(200, headers);
    if (request.method === 'HEAD') response.end();
    else createReadStream(path).pipe(response);
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }).end('Not found');
  }
});

server.listen(port, host, () => {
  console.log(`Static site + data API (upstream ${api.config.infoUrl}): http://${host}:${port}`);
});
