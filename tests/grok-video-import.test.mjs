import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import {
  normalizePaperId,
  normalizeSceneId,
  parseCliArgs,
  probeVideo,
  resolveSafeManifestFile,
  sceneFileStem,
  validateMotionManifest,
} from '../tools/import-grok-video.mjs';

const root = resolve(new URL('../', import.meta.url).pathname);

test('Grok importer normalizes the seven canonical scene ids and safe aliases', () => {
  assert.equal(normalizeSceneId('1'), 'question');
  assert.equal(normalizeSceneId('03-action'), 'process');
  assert.equal(normalizeSceneId('04-limitation'), 'caution');
  assert.equal(normalizeSceneId('result'), 'observation');
  assert.equal(normalizeSceneId('analysis'), 'interpretation');
  assert.equal(sceneFileStem('7'), '07-conclusion');
  assert.throws(() => normalizeSceneId('../result'), /unknown scene id/u);
});

test('Grok importer requires explicit publication-rights confirmation', () => {
  assert.throws(
    () => parseCliArgs(['--input', 'scene.mp4', '--paper', 'rp-uk37f0', '--scene', '5']),
    /rights-confirmed/u,
  );
  const options = parseCliArgs([
    '--input', 'scene.mp4',
    '--paper', 'rp-uk37f0',
    '--scene', '5',
    '--rights-confirmed',
    '--dry-run',
  ]);
  assert.equal(options.provider, 'grok-imagine');
  assert.equal(options.mode, 'transcode');
  assert.equal(options.rightsConfirmed, true);
  assert.equal(options.dryRun, true);
  assert.throws(() => normalizePaperId('../../escape'), /paper id/u);
});

test('motion manifest rejects traversal, scene mismatches, and unconfirmed rights', () => {
  const valid = {
    schemaVersion: 1,
    updatedAt: '2026-08-02T00:00:00.000Z',
    papers: {
      'rp-uk37f0': {
        scenes: {
          observation: {
            sceneId: 'observation',
            sceneIndex: 5,
            file: './rp-uk37f0/05-observation.mp4',
            mimeType: 'video/mp4',
            provider: 'grok-imagine',
            label: 'Grok Imagine',
            durationMs: 6000,
            width: 540,
            height: 960,
            frameRate: 30,
            codec: 'h264',
            muted: true,
            bytes: 900000,
            sha256: 'a'.repeat(64),
            importedAt: '2026-08-02T00:00:00.000Z',
            rights: 'user-confirmed',
            provenanceMarkPolicy: 'preserve-platform-mark',
            provenance: {
              originalFileName: 'grok-export.mp4',
              originalSha256: 'b'.repeat(64),
              prompt: {
                fileName: '01-question.md',
                sha256: 'c'.repeat(64),
              },
            },
          },
        },
      },
    },
  };
  assert.deepEqual(validateMotionManifest(structuredClone(valid)), valid);

  const traversal = structuredClone(valid);
  traversal.papers['rp-uk37f0'].scenes.observation.file = './../escape.mp4';
  assert.throws(() => validateMotionManifest(traversal), /unsafe or mismatched/u);

  const mismatch = structuredClone(valid);
  mismatch.papers['rp-uk37f0'].scenes.observation.sceneIndex = 4;
  assert.throws(() => validateMotionManifest(mismatch), /inconsistent scene metadata/u);

  const unconfirmed = structuredClone(valid);
  unconfirmed.papers['rp-uk37f0'].scenes.observation.rights = 'unknown';
  assert.throws(() => validateMotionManifest(unconfirmed), /user-confirmed rights/u);

  const missingProvenanceMarkPolicy = structuredClone(valid);
  delete missingProvenanceMarkPolicy.papers['rp-uk37f0'].scenes.observation.provenanceMarkPolicy;
  assert.throws(() => validateMotionManifest(missingProvenanceMarkPolicy), /preserve the platform provenance mark/u);

  const missingOriginalHash = structuredClone(valid);
  delete missingOriginalHash.papers['rp-uk37f0'].scenes.observation.provenance.originalSha256;
  assert.throws(() => validateMotionManifest(missingOriginalHash), /original SHA-256 provenance/u);

  const missingPromptHash = structuredClone(valid);
  delete missingPromptHash.papers['rp-uk37f0'].scenes.observation.provenance.prompt.sha256;
  assert.throws(() => validateMotionManifest(missingPromptHash), /prompt provenance/u);

  const invalidImportedAt = structuredClone(valid);
  invalidImportedAt.papers['rp-uk37f0'].scenes.observation.importedAt = 'yesterday';
  assert.throws(() => validateMotionManifest(invalidImportedAt), /importedAt provenance/u);

  const audible = structuredClone(valid);
  audible.papers['rp-uk37f0'].scenes.observation.muted = false;
  assert.throws(() => validateMotionManifest(audible), /must be muted/u);

  const mimeMismatch = structuredClone(valid);
  mimeMismatch.papers['rp-uk37f0'].scenes.observation.mimeType = 'video/webm';
  assert.throws(() => validateMotionManifest(mimeMismatch), /extension and mimeType disagree/u);
});

test('manifest asset paths stay below the public motion directory', () => {
  const directory = resolve(root, 'public/assets/motion');
  assert.equal(
    resolveSafeManifestFile(directory, './rp-uk37f0/05-observation.mp4'),
    resolve(directory, 'rp-uk37f0/05-observation.mp4'),
  );
  assert.throws(() => resolveSafeManifestFile(directory, './../private.mp4'), /unsafe motion asset path/u);
  assert.throws(() => resolveSafeManifestFile(directory, 'https://example.com/a.mp4'), /unsafe motion asset path/u);
});

test('ffprobe recognizes the checked-in Ver.B browser video contract', async (context) => {
  const path = resolve(root, 'public/assets/video/data-demo.mp4');
  try {
    await access(process.env.FFPROBE_PATH || '/opt/homebrew/bin/ffprobe');
  } catch {
    try {
      await probeVideo(path, { maxDurationSeconds: 30 });
    } catch (error) {
      if (/ffprobe failed.*(?:ENOENT|not found)/isu.test(error.message)) {
        context.skip('ffprobe is unavailable on this runner');
        return;
      }
      throw error;
    }
  }
  const video = await probeVideo(path, { maxDurationSeconds: 30 });
  assert.equal(video.codec, 'h264');
  assert.equal(video.width, 540);
  assert.equal(video.height, 960);
  assert.equal(video.frameRate, 30);
  assert.equal(video.audioStreamCount, 0);
  assert.ok(video.durationSeconds > 28 && video.durationSeconds < 29);
});

test('checked-in motion manifest starts valid and contains no external URLs', async () => {
  const manifest = JSON.parse(await readFile(resolve(root, 'public/assets/motion/manifest.json'), 'utf8'));
  validateMotionManifest(manifest);
  assert.doesNotMatch(JSON.stringify(manifest), /https?:\/\//u);
});
