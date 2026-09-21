import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import {
  createMotionQueue,
  parseCliArgs,
  paperIsVerified,
  validateLoopbackEndpoint,
  validateProviderRegistry,
} from '../tools/motion-provider.mjs';

const root = resolve(new URL('../', import.meta.url).pathname);

test('provider registry is explicit about no recurring free guarantee and caps paid API at $0', async () => {
  const registry = validateProviderRegistry(JSON.parse(await readFile(resolve(root, 'templates/motion-providers.template.json'), 'utf8')));
  assert.equal(registry.policy.freeTierGuarantee, false);
  assert.equal(registry.providers.find((provider) => provider.id === 'api-costed').defaultCostCapUsd, 0);
  assert.equal(registry.providers.find((provider) => provider.id === 'api-costed').environmentKeyName, 'MOTION_API_KEY');
  assert.throws(() => validateProviderRegistry({ ...registry, policy: { ...registry.policy, freeTierGuarantee: true } }), /not guaranteed/u);
});

test('queue represents every paper and scene while blocking unverified papers by default', async () => {
  const registry = JSON.parse(await readFile(resolve(root, 'templates/motion-providers.template.json'), 'utf8'));
  const feed = JSON.parse(await readFile(resolve(root, 'public/data/research-feed.json'), 'utf8'));
  const queue = createMotionQueue(feed, registry, { now: () => new Date('2026-08-02T00:00:00.000Z') });
  assert.equal(queue.jobs.length, feed.papers.length * 7);
  assert.equal(queue.summary.candidateJobs, 525);
  assert.equal(queue.summary.readyJobs, 1);
  assert.equal(queue.summary.heldJobs, 6);
  assert.equal(queue.summary.blockedJobs, 518);
  const reviewed = feed.papers.filter(paperIsVerified);
  assert.equal(reviewed.length, 1);
  assert.equal(queue.jobs.find((job) => job.id === 'rp-uk37f0:question').status, 'ready');
  const unverified = queue.jobs.find((job) => job.paperId === 'rp-elj5gc');
  assert.equal(unverified.status, 'blocked');
  assert.match(unverified.reason, /refused/u);
  assert.deepEqual(queue.jobs[0].handoff.requiredArguments.slice(0, 8), [
    '--input', '<REVIEWED_LOCAL_VIDEO_PATH>', '--paper', 'rp-uk37f0', '--scene', 'question', '--provider', 'manual-web',
  ]);
  assert.deepEqual(queue.jobs[0].handoff.requiredArguments.slice(-3), [
    '--rights-confirmed', '--prompt-file', 'templates/prompts/rp-uk37f0/01-question.md',
  ]);
  assert.deepEqual(unverified.handoff.requiredArguments.slice(-2), [
    '--prompt-file', '<REVIEWED_PROMPT_FILE>',
  ]);
});

test('local adapter endpoints can never point away from loopback', () => {
  assert.equal(validateLoopbackEndpoint('http://127.0.0.1:8188').hostname, '127.0.0.1');
  assert.equal(validateLoopbackEndpoint('http://localhost:8188/').hostname, 'localhost');
  assert.throws(() => validateLoopbackEndpoint('https://api.example.com'), /loopback/u);
  assert.throws(() => validateLoopbackEndpoint('http://user:pass@127.0.0.1:8188'), /without credentials/u);
});

test('paid API is dry-run by default and requires two independent charge confirmations', () => {
  assert.equal(parseCliArgs(['--run', '--provider', 'api-costed', '--job', 'rp-uk37f0:question']).apiCostCapUsd, 0);
  const parsed = parseCliArgs([
    '--run', '--provider', 'api-costed', '--job', 'rp-uk37f0:question', '--execute-api',
    '--confirm-api-charge', '--confirm-api-cap', '--api-cost-cap-usd', '1.25',
  ]);
  assert.equal(parsed.confirmApiCharge, true);
  assert.equal(parsed.confirmApiCap, true);
  assert.equal(parsed.apiCostCapUsd, 1.25);
});
