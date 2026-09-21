import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { SCENE_IDS } from '../tools/import-grok-video.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const promptDir = resolve(root, 'templates/prompts/rp-uk37f0');

function sourceValue(paper, sourceField) {
  const match = /^(\w+)(?:\[(\d+)\])?$/u.exec(sourceField);
  assert.ok(match, `invalid sourceField syntax: ${sourceField}`);
  const value = paper[match[1]];
  return match[2] === undefined ? value : value?.[Number(match[2])];
}

test('rp-uk37f0 has one indexed Grok-ready prompt for every canonical scene', async () => {
  const feed = JSON.parse(await readFile(resolve(root, 'public/data/research-feed.json'), 'utf8'));
  const paper = feed.papers.find((entry) => entry.id === 'rp-uk37f0');
  assert.ok(paper, 'demo paper is missing from the feed');

  const index = JSON.parse(await readFile(resolve(promptDir, 'index.json'), 'utf8'));
  assert.equal(index.schemaVersion, 1);
  assert.equal(index.paperId, paper.id);
  assert.equal(index.paperTitle, paper.title);
  assert.equal(index.guide.id, 'newton');
  assert.equal(index.guide.referenceAsset, 'public/assets/characters/guide-newton.webp');
  assert.deepEqual(index.target, {
    aspectRatio: '9:16',
    preferredDurationSeconds: 6,
    minimumDurationSeconds: 4,
    maximumDurationSeconds: 8,
    audio: false,
    loop: true,
  });
  assert.deepEqual(index.prompts.map((entry) => entry.sceneId), SCENE_IDS);
  assert.deepEqual(index.prompts.map((entry) => entry.sceneIndex), [1, 2, 3, 4, 5, 6, 7]);

  for (const entry of index.prompts) {
    assert.equal(entry.sourceBasisJa, sourceValue(paper, entry.sourceField), `${entry.sceneId} source basis drifted from feed`);
    assert.match(entry.file, /^0[1-7]-[a-z]+\.md$/u);
    const prompt = await readFile(resolve(promptDir, entry.file), 'utf8');
    assert.match(prompt, new RegExp(`Scene ID: ${entry.sceneId}\\b`, 'u'));
    assert.match(prompt, /Paper ID: rp-uk37f0/u);
    assert.match(prompt, /public\/assets\/characters\/guide-newton\.webp/u);
    assert.match(prompt, /6-second seamless 9:16 image-to-video loop/u);
    assert.match(prompt, /between 4 and 8 seconds/u);
    assert.match(prompt, /Newton is an educational narrator, not an author/u);
    assert.match(prompt, /PERFORMANCE — ONE ACTION ONLY:/u);
    assert.equal(prompt.match(/PERFORMANCE — ONE ACTION ONLY:/gu)?.length, 1);
    assert.match(prompt, /CAMERA — ONE MOVE ONLY:/u);
    assert.equal(prompt.match(/CAMERA — ONE MOVE ONLY:/gu)?.length, 1);
    assert.match(prompt, /keep the mouth closed and stable/iu);
    assert.match(prompt, /no speech, lip sync, dialogue, sound, or music/iu);
    assert.match(prompt, /DO NOT GENERATE:/u);
    assert.match(prompt, /letters/u);
    assert.match(prompt, /extra fingers/u);
    assert.match(prompt, /warped hands/u);
    assert.match(prompt, /face morphing/u);
    assert.match(prompt, /(?:new|extra) scientific claims|scientific claims beyond|extra findings/u);
    assert.doesNotMatch(prompt, /ドラえもん|Doraemon|Hayao Miyazaki|Studio Ghibli/iu);
    assert.doesNotMatch(prompt, /[\u3040-\u30ff\u3400-\u9fff]/u, `${entry.file} must remain directly usable as an English prompt`);
  }
});
