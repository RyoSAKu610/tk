import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const manifestPath = resolve(root, 'public/audio/narration/manifest.json');
const defaultInstructions = [
  '自然で温かい日本語のナレーション。',
  '短い文の区切りで自然に息を入れ、専門語は明瞭に、落ち着いた会話の速さで話す。',
  '子ども向けに単純化しすぎず、親しみのある案内役として演じる。',
].join('');

function parseArgs(argv) {
  const options = { paper: 'rp-uk37f0', voice: 'coral', model: 'gpt-4o-mini-tts', dryRun: false, force: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--force') options.force = true;
    else if (arg === '--paper' || arg === '--voice' || arg === '--model') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`);
      options[arg.slice(2)] = value;
      index += 1;
    } else throw new Error(`Unknown option: ${arg}`);
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/.test(options.paper)) throw new Error('paper id is unsafe');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(options.voice)) throw new Error('voice is unsafe');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,95}$/.test(options.model)) throw new Error('model is unsafe');
  return options;
}

async function exists(path) {
  try { await access(path); return true; } catch { return false; }
}

function estimateDurationMs(text) {
  return Math.max(7_000, Math.min(35_000, 3_500 + [...text].length * 135));
}

async function createSpeech({ apiKey, model, voice, input }) {
  const response = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ model, voice, input, instructions: defaultInstructions }),
  });
  if (!response.ok) {
    const detail = (await response.text()).replace(/\s+/g, ' ').slice(0, 300);
    throw new Error(`OpenAI speech request failed (${response.status}): ${detail}`);
  }
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.startsWith('audio/')) throw new Error(`OpenAI returned an unexpected content type: ${contentType || 'missing'}`);
  const audio = Buffer.from(await response.arrayBuffer());
  if (audio.byteLength < 1_000) throw new Error('OpenAI returned an unexpectedly small audio file');
  return audio;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const paper = manifest?.papers?.[options.paper];
  const texts = paper?.voicevox?.texts;
  if (!Array.isArray(texts) || texts.length !== 7 || texts.some((text) => typeof text !== 'string' || !text.trim())) {
    throw new Error(`Seven reviewed narration texts are required for ${options.paper}`);
  }
  const scenes = texts.map((_, index) => `./${options.paper}/openai/${String(index + 1).padStart(2, '0')}-scene.mp3`);
  const plan = {
    paper: options.paper,
    provider: 'openai',
    model: options.model,
    voice: options.voice,
    scenes: scenes.length,
    writesSecretsToRepository: false,
  };
  if (options.dryRun) {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not configured in this local terminal');
  const outputDir = resolve(dirname(manifestPath), options.paper, 'openai');
  await mkdir(outputDir, { recursive: true });

  for (let index = 0; index < texts.length; index += 1) {
    const target = resolve(outputDir, `${String(index + 1).padStart(2, '0')}-scene.mp3`);
    if (!options.force && await exists(target)) throw new Error(`${target} already exists; use --force to replace the complete set`);
    const audio = await createSpeech({ apiKey, model: options.model, voice: options.voice, input: texts[index] });
    const temporary = `${target}.tmp`;
    await writeFile(temporary, audio, { mode: 0o644 });
    await rename(temporary, target);
    process.stdout.write(`Generated scene ${index + 1}/${texts.length}\n`);
  }

  paper.openai = {
    label: `OpenAI Voice · ${options.voice}（AI生成音声）`,
    model: options.model,
    voice: options.voice,
    texts,
    durationMs: texts.map(estimateDurationMs),
    scenes,
  };
  const temporaryManifest = `${manifestPath}.tmp`;
  await writeFile(temporaryManifest, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 });
  await rename(temporaryManifest, manifestPath);
  process.stdout.write(`Updated ${manifestPath}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
