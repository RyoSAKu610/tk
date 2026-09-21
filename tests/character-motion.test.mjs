import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(new URL('../', import.meta.url).pathname);

test('Ver.A layers local motion over the WebP guide without taking over narration', async () => {
  const script = await readFile(resolve(root, 'src/character/character-story.js'), 'utf8');
  const css = await readFile(resolve(root, 'src/character/character-story.css'), 'utf8');

  assert.match(script, /MOTION_MANIFEST_URL = ['"]\.\/public\/assets\/motion\/manifest\.json['"]/);
  assert.match(script, /url\.origin !== globalThis\.location\.origin/);
  assert.match(script, /asset\.muted !== true/);
  assert.match(script, /asset\.rights !== ['"]user-confirmed['"]/);
  assert.match(script, /asset\.provenanceMarkPolicy !== ['"]preserve-platform-mark['"]/);
  assert.match(script, /isSha256\(asset\.sha256\)/);
  assert.match(script, /isImportedAt\(asset\.importedAt\)/);
  assert.match(script, /isSha256\(asset\.provenance\?\.originalSha256\)/);
  assert.match(script, /isSha256\(asset\.provenance\?\.prompt\?\.sha256\)/);
  assert.match(script, /sceneVideo\.muted = true/);
  assert.match(script, /sceneVideo\.loop = true/);
  assert.match(script, /sceneVideo\.playsInline = true/);
  assert.match(script, /fallbackToGuideArtwork/);
  assert.match(script, /Created with \$\{video\.dataset\.motionLabel\} · AI motion/);
  assert.match(script, /音声は別のナレーションとして再生されます/u);
  assert.match(css, /\.guide-motion-video\[hidden\] \{ display: none; \}/);
  assert.match(css, /data-motion-source=["']video["']/);
});

test('Ver.A disables unavailable OpenAI Voice and keeps subtitles as the fallback', async () => {
  const html = await readFile(resolve(root, 'character-story.html'), 'utf8');
  const script = await readFile(resolve(root, 'src/character/character-story.js'), 'utf8');
  assert.match(html, /option value="openai" disabled>OpenAI Voice（素材未登録）/u);
  assert.match(html, /data-openai-availability/u);
  assert.match(script, /function hasOpenAiNarrationAssets\(\)/);
  assert.match(script, /option\.disabled = !available/);
  assert.match(script, /elements\.voiceSelect\.value = ['"]captions['"]/);
  assert.match(script, /if \(provider === ['"]captions['"] \|\| !currentPaper\)/);
});

test('Ver.A returns the play control to idle when the completed-video play promise is rejected', async () => {
  const script = await readFile(resolve(root, 'src/character/character-story.js'), 'utf8');
  assert.match(script, /async function startPlayback\(\)/);
  assert.match(script, /await elements\.demoVideo\.play\(\)/);
  assert.match(script, /isPlaying = false;\s*updatePlaybackUi\(\);\s*setStatus\('動画を開始できませんでした/u);
});

test('Ver.A hands the selected paper to Ver.B', async () => {
  const html = await readFile(resolve(root, 'character-story.html'), 'utf8');
  const script = await readFile(resolve(root, 'src/character/character-story.js'), 'utf8');
  assert.match(html, /data-paper-handoff/);
  assert.match(script, /data-motion\.html\?paper=\$\{encodeURIComponent\(paper\.id\)\}/);
});

test('unverified abstracts never receive problem, method, or result claims in Ver.A', async () => {
  const script = await readFile(resolve(root, 'src/character/character-story.js'), 'utf8');
  assert.match(script, /sectionClassification === ['"]unverified['"]\) return buildUnverifiedScenes\(paper\)/);
  assert.match(script, /公開要旨には何が書かれている？/u);
  assert.match(script, /要旨を役割分けせず読む/u);
  assert.match(script, /手法は原文で確認/u);
  assert.match(script, /結果は原文で確認/u);
  assert.match(script, /未確認事項を分けて残す/u);
  assert.match(script, /結果文を自動確定していません/u);
});
