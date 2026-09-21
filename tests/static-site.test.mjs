import assert from 'node:assert/strict';
import { access, readFile, stat } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve } from 'node:path';
import test from 'node:test';

const root = resolve(new URL('../', import.meta.url).pathname);
const dist = join(root, 'dist');

async function exists(path) {
  try { await access(path); return true; } catch { return false; }
}

function localReferences(contents) {
  const references = [];
  const pattern = /(?:src|href)=["']([^"']+)["']/gi;
  for (const match of contents.matchAll(pattern)) {
    const value = match[1];
    if (!value || value.startsWith('#') || value.startsWith('data:') || /^[a-z]+:/i.test(value) || value.startsWith('//')) continue;
    references.push(value.split(/[?#]/)[0]);
  }
  return references;
}

test('all four independent HTML entrypoints are present and use relative local paths', async () => {
  for (const file of ['index.html', 'character-story.html', 'data-motion.html', 'cast-lab.html']) {
    const path = join(dist, file);
    const html = await readFile(path, 'utf8');
    assert.match(html, /<meta[^>]+name=["']viewport["']/i);
    assert.doesNotMatch(html, /(?:src|href)=["']\/(?!\/)/i, `${file} contains a root-absolute path`);
    for (const reference of localReferences(html)) {
      const target = resolve(dirname(path), reference);
      assert.ok(target.startsWith(dist), `${file} escapes dist: ${reference}`);
      assert.ok(await exists(target), `${file} has a missing reference: ${reference}`);
    }
  }
});

test('module imports and CSS urls resolve inside the built subpath', async () => {
  const sourceFiles = [
    'src/shared/landing.js', 'src/shared/studio-core.js',
    'src/shared/edition-runtime.js', 'src/shared/edition-switcher.css',
    'src/character/character-story.js', 'src/character/character-story.css',
    'src/data/data-motion.js', 'src/data/data-motion.css',
    'src/cast/cast-lab.js', 'src/cast/cast-lab.css',
    'src/cast/personification-engine.js', 'src/cast/cast-timeline.js',
  ];
  for (const file of sourceFiles) {
    const path = join(dist, file);
    const contents = await readFile(path, 'utf8');
    const patterns = [/(?:from|import)\s*["'](\.[^"']+)["']/g, /url\(\s*["']?(\.[^)"']+)["']?\s*\)/g];
    for (const pattern of patterns) {
      for (const match of contents.matchAll(pattern)) {
        const reference = match[1].split(/[?#]/)[0];
        const target = resolve(dirname(path), reference);
        assert.ok(target.startsWith(dist), `${file} escapes dist: ${reference}`);
        assert.ok(await exists(target), `${file} has a missing module/asset: ${reference}`);
      }
    }
  }
});

test('paper, sound, narration, motion and 200-character manifests match their assets', async () => {
  const feed = JSON.parse(await readFile(join(dist, 'public/data/research-feed.json'), 'utf8'));
  assert.ok(feed.papers.length >= 75);

  const soundDir = join(dist, 'public/audio/page-turns');
  const sounds = JSON.parse(await readFile(join(soundDir, 'manifest.json'), 'utf8'));
  assert.equal(sounds.schemaVersion, 1);
  assert.equal(sounds.sounds.length, 5);
  for (const sound of sounds.sounds) {
    const audio = resolve(soundDir, sound.file);
    assert.ok(audio.startsWith(soundDir));
    assert.ok((await stat(audio)).size > 1_000, `${sound.id} is empty`);
  }

  const narrationDir = join(dist, 'public/audio/narration');
  const narration = JSON.parse(await readFile(join(narrationDir, 'manifest.json'), 'utf8'));
  const voicevoxScenes = narration.papers['rp-uk37f0'].voicevox.scenes;
  const voicevoxTexts = narration.papers['rp-uk37f0'].voicevox.texts;
  const voicevoxDurations = narration.papers['rp-uk37f0'].voicevox.durationMs;
  const demoPaper = feed.papers.find((paper) => paper.id === 'rp-uk37f0');
  assert.ok(demoPaper, 'the narration demo paper is missing from the feed');
  assert.equal(voicevoxScenes.length, 7);
  assert.equal(voicevoxTexts.length, voicevoxScenes.length);
  assert.equal(voicevoxDurations.length, voicevoxScenes.length);
  assert.ok(voicevoxTexts.every((text) => typeof text === 'string' && text.length >= 20));
  assert.ok(voicevoxDurations.every((duration) => Number.isSafeInteger(duration) && duration > 1_000));
  assert.match(voicevoxTexts[3], /公開要旨だけでは今後の検証条件を特定できません/u);
  assert.ok(voicevoxTexts[4].includes(demoPaper.result));
  assert.match(voicevoxTexts[5], /因果関係を要旨以上に足さない/u);
  assert.ok(voicevoxScenes.every((scene) => typeof scene === 'string'));
  assert.equal(narration.papers['rp-uk37f0'].openai, undefined);
  for (const [index, scene] of voicevoxScenes.entries()) {
    assert.equal(typeof scene, 'string');
    assert.ok((await stat(resolve(narrationDir, scene))).size > 20_000);
  }

  const motionDir = join(dist, 'public/assets/motion');
  const motion = JSON.parse(await readFile(join(motionDir, 'manifest.json'), 'utf8'));
  assert.equal(motion.schemaVersion, 1);
  assert.ok(motion.papers && typeof motion.papers === 'object' && !Array.isArray(motion.papers));
  for (const [paperId, paper] of Object.entries(motion.papers)) {
    assert.ok(feed.papers.some((entry) => entry.id === paperId), `motion paper is missing from feed: ${paperId}`);
    for (const [sceneId, asset] of Object.entries(paper.scenes)) {
      assert.equal(asset.sceneId, sceneId);
      assert.equal(asset.rights, 'user-confirmed');
      assert.equal(asset.provenanceMarkPolicy, 'preserve-platform-mark');
      assert.match(asset.sha256, /^[a-f0-9]{64}$/u);
      assert.match(asset.importedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u);
      assert.match(asset.provenance?.originalSha256, /^[a-f0-9]{64}$/u);
      assert.match(asset.provenance?.prompt?.sha256, /^[a-f0-9]{64}$/u);
      assert.ok(/^\.\/[a-z0-9_-]+\/0[1-7]-[a-z]+\.(?:mp4|webm)$/u.test(asset.file));
      const path = resolve(motionDir, asset.file);
      assert.ok(path.startsWith(motionDir));
      assert.equal((await stat(path)).size, asset.bytes);
    }
  }

  const characterDir = join(dist, 'public/assets/characters');
  const characters = JSON.parse(await readFile(join(characterDir, 'manifest.json'), 'utf8'));
  assert.deepEqual(characters.coverage, { firstId: 1, lastId: 200, charactersPerSheet: 10, sheetCount: 20 });
  assert.equal(characters.rights, 'user-supplied-and-authorized-for-this-project');
  assert.ok((await stat(resolve(characterDir, characters.provenanceFile))).size > 500);
  assert.equal(characters.sheets.length, 20);
  for (const sheet of characters.sheets) {
    assert.ok((await stat(resolve(characterDir, sheet.file))).size > 10_000);
    assert.match(sheet.sourceName, /^ChatGPT Image .+\.png$/u);
    assert.match(sheet.sourceSha256, /^[a-f0-9]{64}$/u);
  }
  for (const guide of characters.guides) assert.ok((await stat(resolve(characterDir, guide.file))).size > 5_000);
});

test('landing and character views disclose the limited daily-sync scope', async () => {
  const landing = await readFile(join(dist, 'index.html'), 'utf8');
  const landingScript = await readFile(join(dist, 'src/shared/landing.js'), 'utf8');
  const character = await readFile(join(dist, 'character-story.html'), 'utf8');
  const characterScript = await readFile(join(dist, 'src/character/character-story.js'), 'utf8');
  assert.match(landing, /id="verified-count"/u);
  assert.match(landing, /日次更新は論文フィードのみ/u);
  assert.match(landingScript, /sectionClassification === ['"]verified['"]/);
  assert.match(landingScript, /音声・動画・AIモーションは原文確認とレビュー後に追加/u);
  assert.match(character, /data-verification-disclosure/u);
  assert.match(characterScript, /function updateVerificationDisclosure\(paper\)/);
  assert.match(characterScript, /手動確認済み \$\{verified\} \/ \$\{total\} 篇/u);
});

test('both real videos are Pages-sized H.264-compatible MP4 files', async () => {
  for (const file of ['character-demo.mp4', 'data-demo.mp4']) {
    const path = join(dist, 'public/assets/video', file);
    const info = await stat(path);
    assert.equal(extname(path), '.mp4');
    assert.ok(info.size > 100_000, `${file} is unexpectedly empty`);
    assert.ok(info.size < 25 * 1024 * 1024, `${file} exceeds the Pages asset budget`);
    const header = await readFile(path).then((buffer) => buffer.subarray(0, 64).toString('latin1'));
    assert.match(header, /ftyp/);
  }
});

test('build manifest covers the deployable files with hashes', async () => {
  const manifest = JSON.parse(await readFile(join(dist, 'build-manifest.json'), 'utf8'));
  assert.equal(manifest.schemaVersion, 1);
  assert.ok(manifest.files.length >= 50);
  for (const entry of manifest.files) {
    assert.match(entry.sha256, /^[a-f0-9]{64}$/);
    assert.ok(entry.bytes >= 0);
    assert.ok(await exists(join(dist, entry.file)), `build manifest is stale: ${entry.file}`);
  }
});

test('public source contains no embedded OpenAI key-shaped values', async () => {
  const candidates = [
    'index.html', 'character-story.html', 'data-motion.html', 'cast-lab.html',
    'src/shared/studio-core.js', 'src/shared/landing.js', 'src/shared/edition-runtime.js',
    'src/character/character-story.js', 'src/data/data-motion.js',
    'src/cast/cast-lab.js', 'src/cast/personification-engine.js',
    'public/audio/narration/manifest.json',
    'public/assets/motion/manifest.json',
  ];
  for (const file of candidates) {
    const contents = await readFile(join(dist, file), 'utf8');
    assert.doesNotMatch(contents, /sk-[A-Za-z0-9_-]{20,}/, `possible secret in ${relative(dist, file)}`);
    assert.doesNotMatch(contents, /OPENAI_API_KEY\s*[:=]\s*["'][^"']+["']/, `embedded API key in ${file}`);
  }
});

test('both experiences share favorites, reviewed state, and persisted sound preferences', async () => {
  const character = await readFile(join(dist, 'src/character/character-story.js'), 'utf8');
  const data = await readFile(join(dist, 'src/data/data-motion.js'), 'utf8');

  for (const source of [character, data]) {
    assert.match(source, /persistLibrary\(\)/, 'the default shared favorites shelf must be used');
    assert.match(source, /research-phantom-studio:reviewed:v1/, 'the canonical reviewed-state key must be used');
  }

  assert.match(data, /const saved = state\.sound\.getState\(\)/, 'Ver.B must restore the saved sound state');
  const setupSound = data.slice(data.indexOf('async function setupSound()'), data.indexOf('function bindEvents()'));
  assert.doesNotMatch(setupSound, /setMode\(['"]random['"]\)/, 'Ver.B must not reset the saved sound mode on load');
  assert.doesNotMatch(setupSound, /setVolume\(Number\(el\.sound_volume\.value\)\)/, 'Ver.B must not overwrite the saved volume on load');
});

test('fixed demo videos are never presented as the selected paper video', async () => {
  const characterHtml = await readFile(join(dist, 'character-story.html'), 'utf8');
  const dataHtml = await readFile(join(dist, 'data-motion.html'), 'utf8');
  const dataScript = await readFile(join(dist, 'src/data/data-motion.js'), 'utf8');

  assert.match(characterHtml, /Paper 01|先頭論文/u);
  assert.match(dataHtml, /Paper 01|先頭論文/u);
  assert.match(dataScript, /paper\.id === ['"]rp-uk37f0['"]/);
  assert.match(dataScript, /この論文の完成動画は未生成/u);
});

test('Ver.B keeps load errors visible and its mobile rail keyboard-safe', async () => {
  const css = await readFile(join(dist, 'src/data/data-motion.css'), 'utf8');
  const script = await readFile(join(dist, 'src/data/data-motion.js'), 'utf8');
  assert.doesNotMatch(css, /data-state=["']error["'][^}]*loading-screen[^}]*visibility:\s*hidden/);
  assert.match(script, /event\.key === ['"]Escape['"] && railOpen/);
  assert.match(script, /event\.key === ['"]Tab['"] && railOpen/);
  assert.match(script, /\.workspace['"]\)\.inert = true/);
  assert.match(script, /sectionsUnverified \? ['"]結果は原文で確認['"]/u);
  assert.match(script, /sectionsUnverified \? ['"]要旨の区分は未確認['"]/u);
});

test('Ver.B preserves a shareable selected-paper deep link', async () => {
  const html = await readFile(join(dist, 'data-motion.html'), 'utf8');
  const script = await readFile(join(dist, 'src/data/data-motion.js'), 'utf8');
  assert.match(html, /data-paper-handoff/);
  assert.match(script, /new URLSearchParams\(location\.search\)\.get\(['"]paper['"]\)/);
  assert.match(script, /url\.searchParams\.set\(['"]paper['"], paper\.id\)/);
  assert.match(script, /initialIndex:requestedPaperIndex\(papers\)/);
  assert.match(script, /character-story\.html\?paper=/);
});
