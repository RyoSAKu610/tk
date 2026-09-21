import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const root = new URL('../', import.meta.url);
const script = new URL('../tools/generate-openai-voice.mjs', import.meta.url);

test('OpenAI voice generator validates a seven-scene plan without a secret', async () => {
  const env = { ...process.env };
  delete env.OPENAI_API_KEY;
  const { stdout } = await execFileAsync(process.execPath, [script.pathname, '--dry-run'], { cwd: root.pathname, env });
  const plan = JSON.parse(stdout);
  assert.deepEqual(
    { paper: plan.paper, provider: plan.provider, scenes: plan.scenes, writesSecretsToRepository: plan.writesSecretsToRepository },
    { paper: 'rp-uk37f0', provider: 'openai', scenes: 7, writesSecretsToRepository: false },
  );
});

test('OpenAI voice generator fails closed when the local key is absent', async () => {
  const env = { ...process.env };
  delete env.OPENAI_API_KEY;
  await assert.rejects(
    execFileAsync(process.execPath, [script.pathname], { cwd: root.pathname, env }),
    (error) => error.code === 1 && /OPENAI_API_KEY is not configured/.test(error.stderr),
  );
});
