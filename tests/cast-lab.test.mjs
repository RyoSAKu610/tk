import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { advanceSceneClock } from '../src/cast/cast-timeline.js';
import {
  BASE_OCCUPATIONS,
  FALLBACK_OCCUPATION,
  characterAssetForId,
  generatePersonification,
  occupationCount,
} from '../src/cast/personification-engine.js';

const root = new URL('../', import.meta.url);

async function read(path) {
  return readFile(new URL(path, root), 'utf8');
}

test('personification engine exposes 21 distinct base occupations', () => {
  assert.equal(occupationCount(), 21);
  assert.equal(BASE_OCCUPATIONS.length, 21);
  assert.equal(new Set(BASE_OCCUPATIONS.map((occupation) => occupation.id)).size, 21);
  for (const occupation of BASE_OCCUPATIONS) {
    assert.ok(occupation.name.length >= 3);
    assert.ok(occupation.role.length >= 10);
    assert.equal(occupation.equipment.length, 3);
    assert.ok(occupation.specialMove.length >= 4);
  }
});

test('all handoff examples generate a deterministic cast, props and seven playable scenes', () => {
  const expectations = new Map([
    ['LLM', 'interpreter'],
    ['Wi-Fiルーター', 'conductor'],
    ['ミトコンドリア', 'engineer'],
    ['クレジットカード', 'accountant'],
    ['折り畳み傘', 'artisan'],
    ['ResearchPhantomの研究論文', 'librarian'],
  ]);

  for (const [target, occupationId] of expectations) {
    const first = generatePersonification(target);
    const second = generatePersonification(target);
    assert.equal(first.occupation.id, occupationId, target);
    assert.equal(first.castId, second.castId, `${target} cast is unstable`);
    assert.ok(first.castId >= 1 && first.castId <= 200);
    assert.equal(first.scenes.length, 7);
    assert.deepEqual(first.scenes.map((scene) => scene.label), ['任務', '入力', '処理', '危機', '検証', '必殺', '完了']);
    assert.ok(first.scenes.every((scene) => scene.durationMs === 3_600));
    assert.ok(first.scenes.every((scene) => typeof scene.point === 'string' && !scene.point.includes('[object Object]')));
    assert.equal(first.equipment.length, 3);
    assert.ok(first.enemy.length > 0);
    assert.ok(first.specialMove.length > 0);
  }
});

test('unknown subjects use the honest fallback instead of inventing shape facts', () => {
  const profile = generatePersonification('量子もつれ風味のZK-β対象');
  assert.equal(profile.occupation.id, FALLBACK_OCCUPATION.id);
  assert.equal(profile.confidence, 'fallback');
  assert.match(profile.normalized.shapes[0], /形状情報は未入力/u);
  assert.match(profile.normalized.weaknesses[0], /対象名だけでは/u);
  assert.match(profile.disclaimer, /事実確認済みの説明ではありません/u);
});

test('description can select an occupation while remaining disclosed as a metaphor', () => {
  const profile = generatePersonification('オルフェウス', {
    description: '複数の端末からpacketを受け取り、network上の宛先へ通信を中継する',
  });
  assert.equal(profile.occupation.id, 'conductor');
  assert.equal(profile.confidence, 'keyword-metaphor');
  assert.ok(profile.normalized.functions[0].includes('入力された補足'));
  assert.match(profile.disclaimer, /比喩/u);
});

test('target validation rejects blank and overlong input', () => {
  assert.throws(() => generatePersonification('   '), /対象を入力/u);
  assert.throws(() => generatePersonification('あ'.repeat(121)), /120文字/u);
  assert.throws(() => generatePersonification('対象', { description: 'あ'.repeat(1_001) }), /1000文字/u);
});

test('200-character sheet resolver returns the correct sheet and crop boundaries', async () => {
  const manifest = JSON.parse(await read('public/assets/characters/manifest.json'));
  const first = characterAssetForId(manifest, 1);
  const tenth = characterAssetForId(manifest, 10);
  const last = characterAssetForId(manifest, 200);
  assert.equal(first.sheet.range, '001-010');
  assert.equal(first.imageLeft, '0%');
  assert.equal(tenth.sheet.range, '001-010');
  assert.equal(tenth.column, 1);
  assert.equal(tenth.row, 4);
  assert.equal(last.sheet.range, '191-200');
  assert.equal(last.label, '人物図鑑 No.200');
  assert.throws(() => characterAssetForId(manifest, 0), /castId/u);
  assert.throws(() => characterAssetForId(manifest, 201), /castId/u);
});

test('scene clock advances through all seven scenes and completes after 25.2 seconds', () => {
  const scenes = generatePersonification('LLM').scenes;
  const afterOne = advanceSceneClock({ sceneIndex: 0, elapsedMs: 0 }, 3_600, scenes);
  assert.deepEqual(afterOne, { sceneIndex: 1, elapsedMs: 0, changed: true, complete: false });
  const nearEnd = advanceSceneClock({ sceneIndex: 0, elapsedMs: 0 }, 25_199, scenes);
  assert.equal(nearEnd.sceneIndex, 6);
  assert.equal(nearEnd.elapsedMs, 3_599);
  assert.equal(nearEnd.complete, false);
  const end = advanceSceneClock(nearEnd, 1, scenes);
  assert.equal(end.sceneIndex, 6);
  assert.equal(end.elapsedMs, 3_600);
  assert.equal(end.complete, true);
});

test('CAST LAB submit control is wired to generation, rendering and playback', async () => {
  const html = await read('cast-lab.html');
  const runtime = await read('src/cast/cast-lab.js');
  assert.match(html, /<form[^>]+data-cast-form/u);
  assert.match(html, /type="submit"[^>]+data-generate-play/u);
  assert.match(html, /Generate and Play/u);
  assert.equal((html.match(/data-scene-index=/gu) ?? []).length, 7);
  assert.match(runtime, /elements\.form\.addEventListener\(['"]submit['"], generateAndPlay\)/u);
  const handler = runtime.slice(runtime.indexOf('async function generateAndPlay'), runtime.indexOf('function initializeEvents'));
  assert.match(handler, /generatePersonification\(/u);
  assert.match(handler, /renderProfile\(\)/u);
  assert.match(handler, /renderScene\(/u);
  assert.match(handler, /startPlayback\(\)/u);
  assert.match(runtime, /advanceSceneClock\(/u);
  assert.match(runtime, /loadCharacterManifest\(CHARACTER_MANIFEST_URL\)/u);
});
