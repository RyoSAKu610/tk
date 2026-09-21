import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import test from 'node:test';

const root = new URL('../', import.meta.url);

function waitForReady(child, timeoutMs = 8_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('static server did not start')), timeoutMs);
    const onData = (chunk) => {
      if (!String(chunk).includes('ResearchPhantom Studio:')) return;
      clearTimeout(timer);
      child.stdout.off('data', onData);
      resolve();
    };
    child.stdout.on('data', onData);
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`static server exited early (${code})`));
    });
  });
}

test('local server serves HTML, byte ranges and rejects mutation methods', async (context) => {
  const port = 43_000 + (process.pid % 1_000);
  const child = spawn(process.execPath, ['tools/serve.mjs'], {
    cwd: root,
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  context.after(() => child.kill('SIGTERM'));
  await waitForReady(child);
  const base = `http://127.0.0.1:${port}`;

  const index = await fetch(`${base}/`);
  assert.equal(index.status, 200);
  assert.match(index.headers.get('content-type'), /^text\/html/);
  assert.match(await index.text(), /ResearchPhantom Studio/);

  const range = await fetch(`${base}/public/assets/video/data-demo.mp4`, { headers: { range: 'bytes=0-31' } });
  assert.equal(range.status, 206);
  assert.match(range.headers.get('content-range'), /^bytes 0-31\//);
  assert.equal((await range.arrayBuffer()).byteLength, 32);

  const post = await fetch(`${base}/`, { method: 'POST' });
  assert.equal(post.status, 405);
  assert.equal(post.headers.get('allow'), 'GET, HEAD');
});
