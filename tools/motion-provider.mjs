#!/usr/bin/env node

/**
 * Provider-neutral motion queue and safe adapters.
 *
 * This intentionally never calls a hosted video API and never downloads a
 * model.  It produces review-first handoff JSON for the existing
 * `motion:import` quarantined importer.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { SCENE_IDS, normalizePaperId, normalizeProvider, normalizeSceneId } from './import-grok-video.mjs';

const moduleRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_REGISTRY = 'templates/motion-providers.template.json';
const DEFAULT_QUEUE = '.motion-jobs/motion-queue.json';
const DEFAULT_WORKFLOW = 'templates/comfyui-workflow.template.json';
// A 75 × 7 queue deliberately carries one review/import handoff per scene.
// Allow room for that audited metadata while keeping arbitrary JSON bounded.
const MAX_CONFIG_BYTES = 4 * 1024 * 1024;

function assertObject(value, message) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(message);
  return value;
}

function assertPlainText(value, name, { min = 1, max = 240 } = {}) {
  const text = String(value ?? '').trim();
  if (text.length < min || text.length > max || /[\u0000-\u001f\u007f]/u.test(text)) {
    throw new Error(`${name} must be ${min}-${max} printable characters`);
  }
  return text;
}

function safeRelativePath(value, name) {
  const text = String(value ?? '').trim();
  if (!text || isAbsolute(text) || text.split(/[\\/]+/u).includes('..')) {
    throw new Error(`${name} must be a project-relative path`);
  }
  return text;
}

export function validateProviderRegistry(raw) {
  assertObject(raw, 'provider registry must be an object');
  if (raw.schemaVersion !== 1) throw new Error('provider registry must use schemaVersion 1');
  assertObject(raw.policy, 'provider registry must have policy');
  if (raw.policy.freeTierGuarantee !== false) {
    throw new Error('provider registry must state that recurring free access is not guaranteed');
  }
  assertPlainText(raw.policy.message, 'provider policy message');
  if (!Array.isArray(raw.providers) || raw.providers.length < 3) throw new Error('provider registry must define providers');
  const seen = new Set();
  for (const provider of raw.providers) {
    assertObject(provider, 'provider entry must be an object');
    const id = normalizeProvider(provider.id);
    if (seen.has(id)) throw new Error(`duplicate provider id: ${id}`);
    seen.add(id);
    assertPlainText(provider.label, `${id}.label`);
    if (!['manual-web', 'local-comfyui', 'api-costed'].includes(provider.kind)) {
      throw new Error(`${id}.kind is unsupported`);
    }
    if (provider.recurringFreeGuaranteed !== false) {
      throw new Error(`${id} must not claim recurring free access`);
    }
    assertPlainText(provider.notes, `${id}.notes`);
    if (provider.kind === 'manual-web' && provider.execution !== 'manual') throw new Error(`${id} must use manual execution`);
    if (provider.kind === 'local-comfyui') {
      if (provider.execution !== 'local' || provider.workflowRequired !== true) throw new Error(`${id} must require a local workflow`);
      validateLoopbackEndpoint(provider.defaultEndpoint);
    }
    if (provider.kind === 'api-costed') {
      if (provider.execution !== 'api' || provider.requiresDoubleConfirmation !== true) throw new Error(`${id} must require two billing confirmations`);
      if (!/^[A-Z][A-Z0-9_]{2,79}$/u.test(String(provider.environmentKeyName || ''))) throw new Error(`${id} needs an environment variable name`);
      if (provider.defaultCostCapUsd !== 0) throw new Error(`${id} default cost cap must be $0`);
    }
  }
  for (const id of ['manual-web', 'local-comfyui', 'api-costed']) {
    if (!seen.has(id)) throw new Error(`provider registry is missing ${id}`);
  }
  return raw;
}

export function validateLoopbackEndpoint(value) {
  let endpoint;
  try { endpoint = new URL(String(value)); } catch { throw new Error('ComfyUI endpoint must be a valid loopback URL'); }
  if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new Error('ComfyUI endpoint must be a plain http(s) loopback URL without credentials');
  }
  const host = endpoint.hostname.toLowerCase();
  if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(host)) {
    throw new Error('ComfyUI endpoint must be loopback-only (localhost, 127.0.0.1, or ::1)');
  }
  endpoint.pathname = endpoint.pathname.replace(/\/+$/u, '') || '/';
  return endpoint;
}

export function findProvider(registry, providerId) {
  const id = normalizeProvider(providerId);
  const provider = registry.providers.find((entry) => entry.id === id);
  if (!provider) throw new Error(`provider is not registered: ${id}`);
  return provider;
}

export function paperIsVerified(paper) {
  return paper?.dataQuality?.sectionClassification === 'verified'
    && paper?.dataQuality?.complete === true
    && paper?.briefingGeneratedBy === 'manual-abstract-review';
}

function importerHandoff({ paper, sceneId, provider, promptFile = null }) {
  const reviewedPromptFile = promptFile || '<REVIEWED_PROMPT_FILE>';
  return {
    schemaVersion: 1,
    type: 'motion-import-handoff',
    importer: 'npm run motion:import --',
    requiredArguments: [
      '--input', '<REVIEWED_LOCAL_VIDEO_PATH>',
      '--paper', paper.id,
      '--scene', sceneId,
      '--provider', provider.id,
      '--label', provider.label,
      '--rights-confirmed',
      '--prompt-file', reviewedPromptFile,
    ],
    safeguards: [
      'Review the local video before import.',
      'Confirm publication rights with --rights-confirmed.',
      'Preserve any platform provenance mark; do not crop or remove it.',
      'The importer removes audio and validates browser-safe video output.',
    ],
  };
}

function expectedPromptFile(paperId, sceneId) {
  if (paperId !== 'rp-uk37f0') return null;
  const index = String(SCENE_IDS.indexOf(sceneId) + 1).padStart(2, '0');
  return `templates/prompts/${paperId}/${index}-${sceneId}.md`;
}

export function createMotionQueue(feed, registry, {
  providerId = 'manual-web',
  maxScenesPerVerifiedPaper = 1,
  now = () => new Date(),
} = {}) {
  assertObject(feed, 'research feed must be an object');
  if (!Array.isArray(feed.papers) || feed.papers.length === 0) throw new Error('research feed must have papers[]');
  const provider = findProvider(validateProviderRegistry(registry), providerId);
  if (!Number.isSafeInteger(maxScenesPerVerifiedPaper) || maxScenesPerVerifiedPaper < 1 || maxScenesPerVerifiedPaper > SCENE_IDS.length) {
    throw new Error(`maxScenesPerVerifiedPaper must be between 1 and ${SCENE_IDS.length}`);
  }
  const jobs = [];
  for (const paper of feed.papers) {
    const paperId = normalizePaperId(paper.id);
    const verified = paperIsVerified(paper);
    for (const [index, sceneId] of SCENE_IDS.entries()) {
      const eligible = verified && index < maxScenesPerVerifiedPaper;
      const status = !verified ? 'blocked' : eligible ? 'ready' : 'held';
      const reason = !verified
        ? 'Generation refused: this paper has no manual, verified section classification.'
        : eligible
          ? 'Eligible after manual briefing review; generation still requires human asset review before import.'
          : `Held by the ${maxScenesPerVerifiedPaper}-scene default limit for verified papers.`;
      jobs.push({
        id: `${paperId}:${sceneId}`,
        paperId,
        paperTitle: assertPlainText(paper.title || paperId, 'paper title', { max: 500 }),
        sceneId,
        sceneIndex: index + 1,
        provider: { id: provider.id, kind: provider.kind, label: provider.label },
        status,
        reason,
        verified,
        handoff: importerHandoff({ paper: { id: paperId }, sceneId, provider, promptFile: expectedPromptFile(paperId, sceneId) }),
      });
    }
  }
  const count = (status) => jobs.filter((job) => job.status === status).length;
  return {
    schemaVersion: 1,
    generatedAt: now().toISOString(),
    provider: { id: provider.id, kind: provider.kind, label: provider.label },
    policy: {
      verifiedPapersOnly: true,
      defaultMaxScenesPerVerifiedPaper: maxScenesPerVerifiedPaper,
      unverifiedPaperGeneration: 'refused',
      freeTierGuarantee: false,
      freeTierNotice: registry.policy.message,
    },
    summary: {
      candidateJobs: jobs.length,
      readyJobs: count('ready'),
      heldJobs: count('held'),
      blockedJobs: count('blocked'),
    },
    jobs,
  };
}

async function readJson(path, label) {
  const contents = await readFile(path, 'utf8');
  if (Buffer.byteLength(contents) > MAX_CONFIG_BYTES) throw new Error(`${label} exceeds ${MAX_CONFIG_BYTES / 1024} KiB`);
  try { return JSON.parse(contents); } catch { throw new Error(`${label} must be valid JSON`); }
}

export async function loadRegistry(path = DEFAULT_REGISTRY, { root = moduleRoot } = {}) {
  return validateProviderRegistry(await readJson(resolve(root, safeRelativePath(path, 'registry path')), 'provider registry'));
}

export async function loadQueue(path = DEFAULT_QUEUE, { root = moduleRoot } = {}) {
  const queue = await readJson(resolve(root, safeRelativePath(path, 'queue path')), 'motion queue');
  if (queue?.schemaVersion !== 1 || !Array.isArray(queue.jobs)) throw new Error('motion queue must use schemaVersion 1 and contain jobs[]');
  return queue;
}

export function selectReadyJob(queue, jobId) {
  const job = queue.jobs.find((entry) => entry.id === jobId);
  if (!job) throw new Error(`job was not found: ${jobId}`);
  if (job.status !== 'ready') throw new Error(`job is not eligible: ${jobId} (${job.status})`);
  return job;
}

export async function writeMotionQueue({
  root = moduleRoot,
  registryPath = DEFAULT_REGISTRY,
  outputPath = DEFAULT_QUEUE,
  providerId = 'manual-web',
  maxScenesPerVerifiedPaper = 1,
  now,
} = {}) {
  const registry = await loadRegistry(registryPath, { root });
  const feed = await readJson(resolve(root, 'public/data/research-feed.json'), 'research feed');
  const queue = createMotionQueue(feed, registry, { providerId, maxScenesPerVerifiedPaper, now });
  const output = resolve(root, safeRelativePath(outputPath, 'output path'));
  if (!output.startsWith(`${resolve(root)}${process.platform === 'win32' ? '\\' : '/'}${'.motion-jobs'}`) && relative(resolve(root), output) !== '.motion-jobs/motion-queue.json') {
    throw new Error('output path must stay inside .motion-jobs/');
  }
  await writeFile(output, `${JSON.stringify(queue, null, 2)}\n`, { encoding: 'utf8', flag: 'w' });
  return { queue, output };
}

async function ensureOutputDirectory(path) {
  const { mkdir } = await import('node:fs/promises');
  await mkdir(dirname(path), { recursive: true });
}

async function checkComfyReachability(endpoint, { fetchFn = globalThis.fetch } = {}) {
  const healthUrl = new URL('system_stats', endpoint.pathname.endsWith('/') ? endpoint : new URL(`${endpoint.href}/`));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2_500);
  try {
    const response = await fetchFn(healthUrl, { method: 'GET', signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return healthUrl.href;
  } catch (error) {
    const detail = error?.name === 'AbortError' ? 'timed out after 2.5s' : String(error?.message || error);
    throw new Error(`ComfyUI is unreachable at ${endpoint.href}. Start ComfyUI on this loopback endpoint, then retry. (${detail})`);
  } finally {
    clearTimeout(timer);
  }
}

async function loadWorkflow(path, { root = moduleRoot, forExecution = false } = {}) {
  const workflowPath = resolve(root, safeRelativePath(path, 'workflow path'));
  const workflow = await readJson(workflowPath, 'ComfyUI workflow');
  assertObject(workflow, 'ComfyUI workflow must be an object');
  const graph = assertObject(workflow.comfyWorkflow, 'ComfyUI workflow must contain comfyWorkflow');
  if (forExecution && graph.__USER_MUST_REPLACE_WITH_A_COMFYUI_API_WORKFLOW__ === true) {
    throw new Error('Replace the placeholder comfyWorkflow with your own ComfyUI API workflow before local execution');
  }
  return { workflowPath, graph };
}

export async function runProviderJob({
  root = moduleRoot,
  registryPath = DEFAULT_REGISTRY,
  queuePath = DEFAULT_QUEUE,
  providerId,
  jobId,
  workflowPath = DEFAULT_WORKFLOW,
  endpoint,
  executeLocal = false,
  confirmLocalExecution = false,
  apiCostCapUsd = 0,
  executeApi = false,
  confirmApiCharge = false,
  confirmApiCap = false,
  fetchFn = globalThis.fetch,
} = {}) {
  const registry = await loadRegistry(registryPath, { root });
  const provider = findProvider(registry, providerId);
  const job = selectReadyJob(await loadQueue(queuePath, { root }), jobId);
  if (job.provider.id !== provider.id) throw new Error(`job ${jobId} was queued for ${job.provider.id}, not ${provider.id}`);

  if (provider.kind === 'manual-web') {
    return { mode: 'manual-handoff', provider: provider.id, jobId: job.id, handoff: job.handoff, freeTierNotice: registry.policy.message };
  }

  if (provider.kind === 'api-costed') {
    if (!Number.isFinite(apiCostCapUsd) || apiCostCapUsd < 0) throw new Error('api cost cap must be a non-negative number');
    const plan = {
      mode: 'api-dry-run',
      provider: provider.id,
      jobId: job.id,
      environmentKeyName: provider.environmentKeyName,
      configuredCostCapUsd: apiCostCapUsd,
      defaultCostCapUsd: provider.defaultCostCapUsd,
      remoteCallMade: false,
      handoff: job.handoff,
      freeTierNotice: registry.policy.message,
    };
    if (!executeApi) return plan;
    if (!confirmApiCharge || !confirmApiCap || apiCostCapUsd <= 0) {
      throw new Error('API execution requires --confirm-api-charge, --confirm-api-cap, and an explicit positive --api-cost-cap-usd');
    }
    throw new Error('Hosted API execution is intentionally disabled in this repository; no remote API call was made. Use the dry-run handoff or a reviewed provider integration.');
  }

  const effectiveEndpoint = validateLoopbackEndpoint(endpoint || provider.defaultEndpoint);
  const workflow = await loadWorkflow(workflowPath, { root, forExecution: executeLocal });
  const healthUrl = await checkComfyReachability(effectiveEndpoint, { fetchFn });
  const plan = {
    mode: executeLocal ? 'local-execution' : 'local-dry-run',
    provider: provider.id,
    jobId: job.id,
    endpoint: effectiveEndpoint.href,
    healthUrl,
    workflowFile: relative(root, workflow.workflowPath).split('\\').join('/'),
    remoteCallMade: false,
    handoff: job.handoff,
    freeTierNotice: registry.policy.message,
  };
  if (!executeLocal) return plan;
  if (!confirmLocalExecution) throw new Error('Local execution requires --confirm-local-execution; dry-run made no generation request');
  const response = await fetchFn(new URL('prompt', effectiveEndpoint.pathname.endsWith('/') ? effectiveEndpoint : new URL(`${effectiveEndpoint.href}/`)), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ prompt: workflow.graph, client_id: randomUUID() }),
  });
  if (!response.ok) throw new Error(`ComfyUI generation request failed with HTTP ${response.status}`);
  const payload = await response.json();
  return { ...plan, remoteCallMade: true, promptId: String(payload.prompt_id || ''), handoff: job.handoff };
}

export function parseCliArgs(argv) {
  const options = { command: 'queue', registryPath: DEFAULT_REGISTRY, outputPath: DEFAULT_QUEUE, providerId: 'manual-web', maxScenesPerVerifiedPaper: 1, workflowPath: DEFAULT_WORKFLOW, apiCostCapUsd: 0 };
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (option === '--help' || option === '-h') options.help = true;
    else if (option === '--run') options.command = 'run';
    else if (option === '--execute-local') options.executeLocal = true;
    else if (option === '--confirm-local-execution') options.confirmLocalExecution = true;
    else if (option === '--execute-api') options.executeApi = true;
    else if (option === '--confirm-api-charge') options.confirmApiCharge = true;
    else if (option === '--confirm-api-cap') options.confirmApiCap = true;
    else if (['--registry', '--out', '--provider', '--max-scenes', '--queue', '--job', '--workflow', '--endpoint', '--api-cost-cap-usd'].includes(option)) {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${option} requires a value`);
      index += 1;
      if (option === '--registry') options.registryPath = value;
      else if (option === '--out') options.outputPath = value;
      else if (option === '--provider') options.providerId = value;
      else if (option === '--max-scenes') options.maxScenesPerVerifiedPaper = Number(value);
      else if (option === '--queue') options.queuePath = value;
      else if (option === '--job') options.jobId = value;
      else if (option === '--workflow') options.workflowPath = value;
      else if (option === '--endpoint') options.endpoint = value;
      else options.apiCostCapUsd = Number(value);
    } else throw new Error(`Unknown option: ${option}`);
  }
  if (options.command === 'run' && !options.jobId) throw new Error('--run requires --job');
  return options;
}

function usage() {
  return `ResearchPhantom provider-neutral motion queue

Generate the complete 75-paper × 7-scene queue (default: one scene only for manually verified papers):
  npm run motion:queue

Create a manual-web import handoff:
  npm run motion:provider -- --run --provider manual-web --job rp-uk37f0:question

Check local ComfyUI only (default is dry-run; loopback endpoint and user workflow required):
  npm run motion:provider -- --run --provider local-comfyui --job rp-uk37f0:question --workflow path/to/my-comfy-workflow.json

Inspect a cost-capped API plan (no key value or remote call is used):
  npm run motion:provider -- --run --provider api-costed --job rp-uk37f0:question --api-cost-cap-usd 0

Free service limits and terms change. This repository never promises recurring free video generation.`;
}

async function main() {
  try {
    const options = parseCliArgs(process.argv.slice(2));
    if (options.help) return console.log(usage());
    if (options.command === 'queue') {
      const output = resolve(moduleRoot, safeRelativePath(options.outputPath, 'output path'));
      await ensureOutputDirectory(output);
      const result = await writeMotionQueue(options);
      console.log(JSON.stringify({ output: relative(moduleRoot, result.output), summary: result.queue.summary, policy: result.queue.policy }, null, 2));
      return;
    }
    const result = await runProviderJob(options);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(`Motion provider failed: ${error.message}`);
    process.exitCode = 1;
  }
}

const isEntrypoint = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isEntrypoint) await main();
