import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  editionHref,
  normalizePaperId,
  resolveSupportingCast,
  supportingCastId,
  validateCharacterManifest,
} from '../src/shared/edition-runtime.js';

const root = resolve(new URL('../', import.meta.url).pathname);

test('Light, Full and Extra routes preserve only a valid selected paper id', () => {
  assert.equal(editionHref('light', 'rp-uk37f0'), './index.html?paper=rp-uk37f0');
  assert.equal(editionHref('full', 'rp-uk37f0'), './data-motion.html?paper=rp-uk37f0');
  assert.equal(editionHref('extra', 'rp-uk37f0'), './character-story.html?paper=rp-uk37f0');
  assert.equal(normalizePaperId(' RP-UK37F0 '), 'RP-UK37F0');
  assert.equal(normalizePaperId('../unsafe?x=1'), null);
  assert.equal(editionHref('full', '../unsafe?x=1'), './data-motion.html');
  assert.throws(() => editionHref('unknown'), RangeError);
});
test('all three entrypoints expose one accessible Light, Full and Extra switcher', async () => {
  const entries = [
    ['index.html', 'light'],
    ['data-motion.html', 'full'],
    ['character-story.html', 'extra'],
  ];
  for (const [file, current] of entries) {
    const html = await readFile(resolve(root, file), 'utf8');
    assert.match(html, /src\/shared\/edition-switcher\.css/u, `${file} is missing the shared switcher CSS`);
    assert.match(html, /src\/shared\/edition-runtime\.js/u, `${file} is missing the shared switcher runtime`);
    assert.match(html, new RegExp(`data-current-edition=["']${current}["']`, 'u'));
    assert.equal([...html.matchAll(/data-edition-target=["'](light|full|extra)["']/gu)].length, 3);
    assert.equal([...html.matchAll(/aria-current=["']page["']/gu)].length, 1);
    assert.match(html, /aria-label=["']表示モードを切り替える["']/u);
  }
  const index = await readFile(resolve(root, 'index.html'), 'utf8');
  assert.match(index, /data-paper-link=["']full["']/u);
  assert.match(index, /data-paper-link=["']extra["']/u);
});

test('75 papers times 7 scenes deterministically exercise every one of the 200 cast ids', () => {
  const firstPass = [];
  for (let paperIndex = 0; paperIndex < 75; paperIndex += 1) {
    for (let sceneIndex = 0; sceneIndex < 7; sceneIndex += 1) {
      firstPass.push(supportingCastId(paperIndex, sceneIndex));
    }
  }
  const secondPass = [];
  for (let paperIndex = 0; paperIndex < 75; paperIndex += 1) {
    for (let sceneIndex = 0; sceneIndex < 7; sceneIndex += 1) {
      secondPass.push(supportingCastId(paperIndex, sceneIndex));
    }
  }
  assert.deepEqual(firstPass, secondPass);
  assert.equal(firstPass.length, 525);
  assert.equal(Math.min(...firstPass), 1);
  assert.equal(Math.max(...firstPass), 200);
  assert.equal(new Set(firstPass).size, 200);
  assert.throws(() => supportingCastId(-1, 0), RangeError);
  assert.throws(() => supportingCastId(0, 7), RangeError);
});

test('the real manifest resolves each id to the correct 2 by 5 sheet crop', async () => {
  const manifest = JSON.parse(await readFile(resolve(root, 'public/assets/characters/manifest.json'), 'utf8'));
  assert.equal(validateCharacterManifest(manifest), true);

  const cast1 = resolveSupportingCast(manifest, 0, 0);
  assert.deepEqual(
    { id: cast1.id, range: cast1.sheet.range, column: cast1.column, row: cast1.row, left: cast1.imageLeft, top: cast1.imageTop },
    { id: 1, range: '001-010', column: 0, row: 0, left: '0%', top: '-35%' },
  );

  const cast10 = resolveSupportingCast(manifest, 1, 2);
  assert.deepEqual(
    { id: cast10.id, range: cast10.sheet.range, column: cast10.column, row: cast10.row },
    { id: 10, range: '001-010', column: 1, row: 4 },
  );

  const cast200 = resolveSupportingCast(manifest, 28, 3);
  assert.deepEqual(
    { id: cast200.id, range: cast200.sheet.range, column: cast200.column, row: cast200.row },
    { id: 200, range: '191-200', column: 1, row: 4 },
  );
});

test('Extra runtime loads and labels the 200-person supporting cast without calling them authors', async () => {
  const html = await readFile(resolve(root, 'character-story.html'), 'utf8');
  const script = await readFile(resolve(root, 'src/character/character-story.js'), 'utf8');
  const css = await readFile(resolve(root, 'src/character/character-story.css'), 'utf8');
  assert.match(html, /data-supporting-cast/u);
  assert.match(html, /論文著者ではなく、内容理解を助ける比喩役/u);
  assert.match(script, /loadCharacterManifest\(CHARACTER_MANIFEST_URL\)/u);
  assert.match(script, /resolveSupportingCast\(characterManifest, navigator\.getIndex\(\), sceneIndex\)/u);
  assert.match(script, /論文著者ではなく、場面理解を助ける比喩的な助演キャスト/u);
  assert.match(css, /\.supporting-cast-window img/u);
  assert.match(css, /prefers-reduced-motion: reduce/u);
});
