#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { createReadStream } from 'node:fs';
import {
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const moduleRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const SCENE_IDS = Object.freeze([
  'question',
  'input',
  'process',
  'caution',
  'observation',
  'interpretation',
  'conclusion',
]);

const SCENE_ALIASES = Object.freeze({
  action: 'process',
  method: 'process',
  limitation: 'caution',
  limits: 'caution',
  result: 'observation',
  analysis: 'interpretation',
  takeaway: 'conclusion',
});
const INPUT_EXTENSIONS = new Set(['.mp4', '.webm']);
const COPY_CODECS = Object.freeze({
  '.mp4': new Set(['h264']),
  '.webm': new Set(['vp8', 'vp9', 'av1']),
});
const DEFAULT_MAX_INPUT_BYTES = 250 * 1024 * 1024;
const DEFAULT_MAX_OUTPUT_BYTES = 24 * 1024 * 1024;
const DEFAULT_MAX_DURATION_SECONDS = 60;
const MIN_DURATION_SECONDS = 0.4;
const MAX_DIMENSION = 4096;

function usage() {
  return `ResearchPhantom scene-motion importer

Usage:
  npm run motion:import -- \\
    --input ~/Downloads/grok-scene.mp4 \\
    --paper rp-uk37f0 \\
    --scene observation \\
    --rights-confirmed \\
    --prompt-file templates/grok-imagine-scene-prompt.md

Required:
  --input PATH          Local .mp4 or .webm exported from an image-to-video tool
  --paper ID            Existing paper id in public/data/research-feed.json
  --scene ID|1..7       question, input, process, caution, observation,
                        interpretation, or conclusion
  --rights-confirmed    Confirm that this project may publish the supplied asset

Optional:
  --provider ID         Provenance id (default: grok-imagine)
  --label TEXT          Human-readable generator label (default: Grok Imagine)
  --prompt-file PATH    Record the prompt file name and SHA-256, never its local path
  --mode transcode|copy Transcode to H.264 MP4 (default) or remux without re-encoding
  --max-duration SEC    Reject longer input (default: 60, hard maximum: 120)
  --replace             Replace the same paper + scene after all checks pass
  --dry-run             Probe and validate without writing public files
  --help                Show this message

The command never opens Grok, uses account cookies, or stores credentials.`;
}

function readOption(argv, index, option) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${option} requires a value`);
  return value;
}

export function parseCliArgs(argv) {
  const options = {
    provider: 'grok-imagine',
    label: 'Grok Imagine',
    mode: 'transcode',
    maxDurationSeconds: DEFAULT_MAX_DURATION_SECONDS,
    replace: false,
    rightsConfirmed: false,
    dryRun: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (option === '--help' || option === '-h') options.help = true;
    else if (option === '--replace') options.replace = true;
    else if (option === '--rights-confirmed') options.rightsConfirmed = true;
    else if (option === '--dry-run') options.dryRun = true;
    else if (['--input', '--paper', '--scene', '--provider', '--label', '--prompt-file', '--mode', '--max-duration'].includes(option)) {
      const value = readOption(argv, index, option);
      index += 1;
      if (option === '--input') options.input = value;
      else if (option === '--paper') options.paperId = value;
      else if (option === '--scene') options.sceneId = value;
      else if (option === '--provider') options.provider = value;
      else if (option === '--label') options.label = value;
      else if (option === '--prompt-file') options.promptFile = value;
      else if (option === '--mode') options.mode = value;
      else options.maxDurationSeconds = Number(value);
    } else {
      throw new Error(`Unknown option: ${option}`);
    }
  }

  if (options.help) return options;
  if (!options.input) throw new Error('--input is required');
  if (!options.paperId) throw new Error('--paper is required');
  if (!options.sceneId) throw new Error('--scene is required');
  if (!options.rightsConfirmed) {
    throw new Error('--rights-confirmed is required; do not publish an asset whose rights are unclear');
  }
  if (!['copy', 'transcode'].includes(options.mode)) throw new Error('--mode must be copy or transcode');
  if (!Number.isFinite(options.maxDurationSeconds)
      || options.maxDurationSeconds < MIN_DURATION_SECONDS
      || options.maxDurationSeconds > 120) {
    throw new Error('--max-duration must be between 0.4 and 120 seconds');
  }
  if (!options.dryRun && !options.promptFile) {
    throw new Error('--prompt-file is required when publishing a motion asset');
  }
  return options;
}

export function normalizePaperId(value) {
  const id = String(value ?? '').trim();
  if (!/^[a-z0-9][a-z0-9_-]{2,63}$/u.test(id)) {
    throw new Error('paper id must use 3-64 lowercase letters, numbers, dashes, or underscores');
  }
  return id;
}

export function normalizeProvider(value) {
  const id = String(value ?? '').trim();
  if (!/^[a-z0-9][a-z0-9_-]{1,31}$/u.test(id)) {
    throw new Error('provider id must use 2-32 lowercase letters, numbers, dashes, or underscores');
  }
  return id;
}

export function normalizeSceneId(value) {
  const raw = String(value ?? '').trim().toLowerCase();
  if (/^[1-7]$/u.test(raw)) return SCENE_IDS[Number(raw) - 1];
  const withoutPrefix = raw.replace(/^0?[1-7][-_]/u, '');
  const normalized = SCENE_ALIASES[withoutPrefix] ?? withoutPrefix;
  if (!SCENE_IDS.includes(normalized)) {
    throw new Error(`unknown scene id: ${value}; expected 1-7 or ${SCENE_IDS.join(', ')}`);
  }
  return normalized;
}

export function sceneFileStem(sceneId) {
  const normalized = normalizeSceneId(sceneId);
  return `${String(SCENE_IDS.indexOf(normalized) + 1).padStart(2, '0')}-${normalized}`;
}

function assertPlainLabel(value) {
  const label = String(value ?? '').trim();
  if (!label || label.length > 80 || /[\u0000-\u001f\u007f]/u.test(label)) {
    throw new Error('label must be 1-80 characters without control characters');
  }
  return label;
}

function isWithin(parent, child) {
  const relativePath = relative(parent, child);
  return relativePath === '' || (!relativePath.startsWith(`..${sep}`) && relativePath !== '..' && !isAbsolute(relativePath));
}

function parseRate(value) {
  if (typeof value !== 'string' || !value) return null;
  const [numerator, denominator = '1'] = value.split('/').map(Number);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return null;
  return Number((numerator / denominator).toFixed(3));
}

async function sha256(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

async function runBinary(binary, args) {
  try {
    return await execFileAsync(binary, args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  } catch (error) {
    const detail = String(error.stderr || error.message || error).trim();
    throw new Error(`${basename(binary)} failed: ${detail.slice(0, 1_200)}`);
  }
}

export async function probeVideo(path, {
  ffprobePath = process.env.FFPROBE_PATH || 'ffprobe',
  maxBytes = DEFAULT_MAX_INPUT_BYTES,
  maxDurationSeconds = DEFAULT_MAX_DURATION_SECONDS,
} = {}) {
  const info = await stat(path);
  if (!info.isFile()) throw new Error('input must be a regular file');
  if (info.size <= 0) throw new Error('input video is empty');
  if (info.size > maxBytes) throw new Error(`input video exceeds ${Math.floor(maxBytes / 1024 / 1024)} MiB`);

  const { stdout } = await runBinary(ffprobePath, [
    '-v', 'error',
    '-show_entries', 'format=duration,size,format_name:stream=index,codec_type,codec_name,width,height,pix_fmt,avg_frame_rate',
    '-of', 'json',
    path,
  ]);
  let payload;
  try {
    payload = JSON.parse(stdout);
  } catch {
    throw new Error('ffprobe returned invalid JSON');
  }
  const videos = Array.isArray(payload.streams)
    ? payload.streams.filter((stream) => stream.codec_type === 'video')
    : [];
  const audioStreamCount = Array.isArray(payload.streams)
    ? payload.streams.filter((stream) => stream.codec_type === 'audio').length
    : 0;
  if (videos.length !== 1) throw new Error(`expected exactly one video stream, found ${videos.length}`);
  const video = videos[0];
  const duration = Number(payload.format?.duration);
  if (!Number.isFinite(duration) || duration < MIN_DURATION_SECONDS) {
    throw new Error(`video duration must be at least ${MIN_DURATION_SECONDS} seconds`);
  }
  if (duration > maxDurationSeconds) {
    throw new Error(`video duration ${duration.toFixed(2)}s exceeds the ${maxDurationSeconds}s limit`);
  }
  if (!Number.isSafeInteger(video.width) || !Number.isSafeInteger(video.height)
      || video.width < 16 || video.height < 16
      || video.width > MAX_DIMENSION || video.height > MAX_DIMENSION) {
    throw new Error(`video dimensions must be between 16 and ${MAX_DIMENSION}px`);
  }
  return Object.freeze({
    bytes: info.size,
    durationSeconds: duration,
    width: video.width,
    height: video.height,
    codec: String(video.codec_name || ''),
    pixelFormat: String(video.pix_fmt || ''),
    frameRate: parseRate(video.avg_frame_rate),
    audioStreamCount,
    formatName: String(payload.format?.format_name || ''),
  });
}

export function resolveSafeManifestFile(manifestDir, file) {
  if (typeof file !== 'string' || !/^\.\/[a-z0-9][a-z0-9_-]{2,63}\/0[1-7]-[a-z]+\.(?:mp4|webm)$/u.test(file)) {
    throw new Error(`unsafe motion asset path: ${file}`);
  }
  const target = resolve(manifestDir, file);
  if (!isWithin(manifestDir, target)) throw new Error(`motion asset escapes manifest directory: ${file}`);
  return target;
}

export function validateMotionManifest(raw) {
  if (!raw || raw.schemaVersion !== 1 || !raw.papers || typeof raw.papers !== 'object' || Array.isArray(raw.papers)) {
    throw new Error('motion manifest must have schemaVersion 1 and a papers object');
  }
  for (const [paperId, paper] of Object.entries(raw.papers)) {
    normalizePaperId(paperId);
    if (!paper || !paper.scenes || typeof paper.scenes !== 'object' || Array.isArray(paper.scenes)) {
      throw new Error(`motion manifest paper ${paperId} must have a scenes object`);
    }
    for (const [sceneId, asset] of Object.entries(paper.scenes)) {
      const normalizedScene = normalizeSceneId(sceneId);
      if (normalizedScene !== sceneId) throw new Error(`scene key must use canonical id: ${sceneId}`);
      if (!asset || typeof asset !== 'object' || Array.isArray(asset)) throw new Error(`${paperId}/${sceneId} asset is invalid`);
      if (asset.sceneId !== sceneId || asset.sceneIndex !== SCENE_IDS.indexOf(sceneId) + 1) {
        throw new Error(`${paperId}/${sceneId} has inconsistent scene metadata`);
      }
      normalizeProvider(asset.provider);
      assertPlainLabel(asset.label);
      if (!['video/mp4', 'video/webm'].includes(asset.mimeType)) throw new Error(`${paperId}/${sceneId} has unsupported mimeType`);
      if (typeof asset.file !== 'string'
          || !new RegExp(`^\\./${paperId}/${sceneFileStem(sceneId)}\\.(?:mp4|webm)$`, 'u').test(asset.file)) {
        throw new Error(`${paperId}/${sceneId} has an unsafe or mismatched file path`);
      }
      if ((asset.file.endsWith('.mp4') && asset.mimeType !== 'video/mp4')
          || (asset.file.endsWith('.webm') && asset.mimeType !== 'video/webm')) {
        throw new Error(`${paperId}/${sceneId} file extension and mimeType disagree`);
      }
      if (!Number.isSafeInteger(asset.durationMs) || asset.durationMs < MIN_DURATION_SECONDS * 1000) {
        throw new Error(`${paperId}/${sceneId} has invalid durationMs`);
      }
      if (!Number.isSafeInteger(asset.width) || !Number.isSafeInteger(asset.height)
          || asset.width < 16 || asset.height < 16
          || asset.width > MAX_DIMENSION || asset.height > MAX_DIMENSION) {
        throw new Error(`${paperId}/${sceneId} has invalid dimensions`);
      }
      if (!Number.isFinite(asset.frameRate) || asset.frameRate <= 0 || asset.frameRate > 120) {
        throw new Error(`${paperId}/${sceneId} has invalid frameRate`);
      }
      if ((asset.mimeType === 'video/mp4' && asset.codec !== 'h264')
          || (asset.mimeType === 'video/webm' && !COPY_CODECS['.webm'].has(asset.codec))) {
        throw new Error(`${paperId}/${sceneId} has an incompatible codec`);
      }
      if (asset.muted !== true) throw new Error(`${paperId}/${sceneId} must be muted`);
      if (!Number.isSafeInteger(asset.bytes) || asset.bytes <= 0 || asset.bytes > DEFAULT_MAX_OUTPUT_BYTES) {
        throw new Error(`${paperId}/${sceneId} has invalid byte size`);
      }
      if (!/^[a-f0-9]{64}$/u.test(asset.sha256)) throw new Error(`${paperId}/${sceneId} has invalid SHA-256`);
      if (asset.rights !== 'user-confirmed') throw new Error(`${paperId}/${sceneId} must record user-confirmed rights`);
      if (asset.provenanceMarkPolicy !== 'preserve-platform-mark') {
        throw new Error(`${paperId}/${sceneId} must preserve the platform provenance mark`);
      }
      if (typeof asset.importedAt !== 'string'
          || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(asset.importedAt)
          || Number.isNaN(Date.parse(asset.importedAt))) {
        throw new Error(`${paperId}/${sceneId} has invalid importedAt provenance`);
      }
      if (!asset.provenance || typeof asset.provenance !== 'object' || Array.isArray(asset.provenance)) {
        throw new Error(`${paperId}/${sceneId} must record provenance`);
      }
      if (typeof asset.provenance.originalFileName !== 'string'
          || !asset.provenance.originalFileName
          || asset.provenance.originalFileName.length > 255
          || /[\\/\u0000-\u001f\u007f]/u.test(asset.provenance.originalFileName)) {
        throw new Error(`${paperId}/${sceneId} has invalid originalFileName provenance`);
      }
      if (!/^[a-f0-9]{64}$/u.test(asset.provenance.originalSha256)) {
        throw new Error(`${paperId}/${sceneId} has invalid original SHA-256 provenance`);
      }
      if (!asset.provenance.prompt || typeof asset.provenance.prompt !== 'object' || Array.isArray(asset.provenance.prompt)
          || typeof asset.provenance.prompt.fileName !== 'string'
          || !asset.provenance.prompt.fileName
          || asset.provenance.prompt.fileName.length > 255
          || /[\\/\u0000-\u001f\u007f]/u.test(asset.provenance.prompt.fileName)
          || !/^[a-f0-9]{64}$/u.test(asset.provenance.prompt.sha256)) {
        throw new Error(`${paperId}/${sceneId} has invalid prompt provenance`);
      }
    }
  }
  return raw;
}

async function loadFeedPaperIds(root) {
  const path = join(root, 'public/data/research-feed.json');
  const feed = JSON.parse(await readFile(path, 'utf8'));
  if (!Array.isArray(feed.papers)) throw new Error('research feed does not contain papers[]');
  return new Set(feed.papers.map((paper) => paper.id));
}

async function loadManifest(path) {
  try {
    return validateMotionManifest(JSON.parse(await readFile(path, 'utf8')));
  } catch (error) {
    if (error?.code === 'ENOENT') return { schemaVersion: 1, updatedAt: null, papers: {} };
    throw error;
  }
}

function transcodeArgs(input, output) {
  return [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-i', input,
    '-map', '0:v:0', '-an',
    '-vf', 'scale=540:960:force_original_aspect_ratio=decrease:out_range=tv,pad=540:960:(ow-iw)/2:(oh-ih)/2:color=#171913,setsar=1,fps=30,format=yuv420p',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '25', '-color_range', 'tv',
    '-movflags', '+faststart',
    output,
  ];
}

function copyArgs(input, output, extension) {
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-i', input, '-map', '0:v:0', '-an', '-c:v', 'copy'];
  if (extension === '.mp4') args.push('-movflags', '+faststart');
  args.push(output);
  return args;
}

export async function importMotionAsset(options, {
  root = moduleRoot,
  ffprobePath = process.env.FFPROBE_PATH || 'ffprobe',
  ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg',
  now = () => new Date(),
} = {}) {
  const paperId = normalizePaperId(options.paperId);
  const sceneId = normalizeSceneId(options.sceneId);
  const provider = normalizeProvider(options.provider);
  const label = assertPlainLabel(options.label);
  if (!options.rightsConfirmed) throw new Error('rights confirmation is required');
  if (!['copy', 'transcode'].includes(options.mode)) throw new Error('mode must be copy or transcode');

  const input = await realpath(resolve(options.input));
  const inputExtension = extname(input).toLowerCase();
  if (!INPUT_EXTENSIONS.has(inputExtension)) throw new Error('input must be an .mp4 or .webm file');
  const feedIds = await loadFeedPaperIds(root);
  if (!feedIds.has(paperId)) throw new Error(`paper id is not present in the research feed: ${paperId}`);
  const inputProbe = await probeVideo(input, { ffprobePath, maxDurationSeconds: options.maxDurationSeconds });
  if (options.mode === 'copy' && !COPY_CODECS[inputExtension].has(inputProbe.codec)) {
    throw new Error(`copy mode cannot publish ${inputProbe.codec || 'unknown'} in ${inputExtension}; use --mode transcode`);
  }

  const motionDir = join(root, 'public/assets/motion');
  const manifestPath = join(motionDir, 'manifest.json');
  const outputExtension = options.mode === 'copy' ? inputExtension : '.mp4';
  const relativeFile = `./${paperId}/${sceneFileStem(sceneId)}${outputExtension}`;
  const output = resolveSafeManifestFile(motionDir, relativeFile);
  const manifest = await loadManifest(manifestPath);
  const previousAsset = manifest.papers[paperId]?.scenes?.[sceneId] ?? null;
  if (previousAsset && !options.replace) {
    throw new Error(`${paperId}/${sceneId} already exists; pass --replace after reviewing the replacement`);
  }
  let outputAlreadyExists = false;
  try {
    outputAlreadyExists = (await stat(output)).isFile();
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  if (outputAlreadyExists && !options.replace) {
    throw new Error(`${relative(root, output)} already exists; pass --replace after reviewing the replacement`);
  }

  let prompt = null;
  if (options.promptFile) {
    const promptPath = await realpath(resolve(options.promptFile));
    const promptInfo = await stat(promptPath);
    if (!promptInfo.isFile() || promptInfo.size > 256 * 1024) throw new Error('prompt file must be a regular file no larger than 256 KiB');
    if (!['.md', '.txt'].includes(extname(promptPath).toLowerCase())) throw new Error('prompt file must be .md or .txt');
    prompt = { fileName: basename(promptPath), sha256: await sha256(promptPath) };
  }

  if (options.dryRun) {
    return Object.freeze({ dryRun: true, paperId, sceneId, target: relativeFile, input: inputProbe });
  }

  await mkdir(dirname(output), { recursive: true });
  const temporary = `${output}.tmp-${process.pid}-${Date.now()}${outputExtension}`;
  try {
    const args = options.mode === 'copy'
      ? copyArgs(input, temporary, outputExtension)
      : transcodeArgs(input, temporary);
    await runBinary(ffmpegPath, args);
    const outputProbe = await probeVideo(temporary, {
      ffprobePath,
      maxBytes: DEFAULT_MAX_OUTPUT_BYTES,
      maxDurationSeconds: options.maxDurationSeconds + 0.25,
    });
    if (outputExtension === '.mp4' && outputProbe.codec !== 'h264') throw new Error('published MP4 must use H.264');
    if (outputExtension === '.webm' && !COPY_CODECS['.webm'].has(outputProbe.codec)) throw new Error('published WebM uses an unsupported codec');
    if (options.mode === 'transcode'
        && (outputProbe.width !== 540 || outputProbe.height !== 960 || outputProbe.pixelFormat !== 'yuv420p')) {
      throw new Error('transcoded output must be 540x960 yuv420p');
    }
    const importedAt = now().toISOString();
    const asset = {
      sceneId,
      sceneIndex: SCENE_IDS.indexOf(sceneId) + 1,
      file: relativeFile,
      mimeType: outputExtension === '.mp4' ? 'video/mp4' : 'video/webm',
      provider,
      label,
      durationMs: Math.round(outputProbe.durationSeconds * 1000),
      width: outputProbe.width,
      height: outputProbe.height,
      frameRate: outputProbe.frameRate,
      codec: outputProbe.codec,
      muted: true,
      bytes: outputProbe.bytes,
      sha256: await sha256(temporary),
      importedAt,
      rights: 'user-confirmed',
      provenanceMarkPolicy: 'preserve-platform-mark',
      provenance: {
        originalFileName: basename(input),
        originalSha256: await sha256(input),
        prompt,
      },
    };

    manifest.updatedAt = importedAt;
    manifest.papers[paperId] ??= { scenes: {} };
    manifest.papers[paperId].scenes[sceneId] = asset;
    validateMotionManifest(manifest);
    const manifestTemporary = `${manifestPath}.tmp-${process.pid}`;
    const outputBackup = `${output}.backup-${process.pid}`;
    await writeFile(manifestTemporary, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    try {
      if (outputAlreadyExists) await rename(output, outputBackup);
      await rename(temporary, output);
      await rename(manifestTemporary, manifestPath);
      if (previousAsset?.file && previousAsset.file !== relativeFile) {
        await rm(resolveSafeManifestFile(motionDir, previousAsset.file), { force: true });
      }
      await rm(outputBackup, { force: true });
    } catch (error) {
      await rm(manifestTemporary, { force: true });
      await rm(output, { force: true });
      if (outputAlreadyExists) await rename(outputBackup, output).catch(() => {});
      throw error;
    }
    return Object.freeze({ dryRun: false, paperId, sceneId, target: relativeFile, input: inputProbe, output: asset });
  } finally {
    await rm(temporary, { force: true });
  }
}

async function main() {
  try {
    const options = parseCliArgs(process.argv.slice(2));
    if (options.help) {
      console.log(usage());
      return;
    }
    const result = await importMotionAsset(options);
    if (result.dryRun) {
      console.log(`Dry run passed: ${result.paperId}/${result.sceneId} -> ${result.target}`);
      console.log(`Input: ${result.input.width}x${result.input.height}, ${result.input.durationSeconds.toFixed(2)}s, ${result.input.codec}`);
      return;
    }
    console.log(`Imported: ${result.paperId}/${result.sceneId} -> public/assets/motion/${result.target.slice(2)}`);
    console.log(`Output: ${result.output.width}x${result.output.height}, ${(result.output.durationMs / 1000).toFixed(2)}s, ${result.output.codec}, ${(result.output.bytes / 1024 / 1024).toFixed(2)} MiB`);
  } catch (error) {
    console.error(`Motion import failed: ${error.message}`);
    process.exitCode = 1;
  }
}

const isEntrypoint = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isEntrypoint) await main();
