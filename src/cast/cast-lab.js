import { loadCharacterManifest } from '../shared/edition-runtime.js';
import { createPageSoundController } from '../shared/studio-core.js';
import { advanceSceneClock } from './cast-timeline.js';
import { characterAssetForId, generatePersonification, occupationCount } from './personification-engine.js';

const CHARACTER_MANIFEST_URL = './public/assets/characters/manifest.json';
const EXAMPLES = Object.freeze({
  llm: Object.freeze({ target: 'LLM', description: '質問や指示を受け取り、文章や案を返す言語モデル' }),
  router: Object.freeze({ target: 'Wi-Fiルーター', description: '複数の端末から通信を受け取り、ネットワークへ中継する装置' }),
  mitochondria: Object.freeze({ target: 'ミトコンドリア', description: '細胞内でエネルギー生産を支える小器官' }),
  card: Object.freeze({ target: 'クレジットカード', description: '支払い要求を承認と後日の精算へつなぐ決済手段' }),
  umbrella: Object.freeze({ target: '折り畳み傘', description: '必要な時に開いて雨を遮り、使わない時は小さく収納できる道具' }),
  paper: Object.freeze({ target: 'ResearchPhantomの研究論文', description: '研究の問い、方法、結果、意味を読者へ伝える記録' }),
});

const elements = {
  shell: document.querySelector('[data-cast-lab]'),
  form: document.querySelector('[data-cast-form]'),
  target: document.querySelector('#cast-target'),
  description: document.querySelector('#cast-description'),
  generate: document.querySelector('[data-generate-play]'),
  status: document.querySelector('[data-lab-status]'),
  occupationCount: document.querySelector('[data-occupation-count]'),
  sceneRail: document.querySelector('[data-scene-rail]'),
  sceneButtons: [...document.querySelectorAll('[data-scene-index]')],
  theater: document.querySelector('[data-cast-theater]'),
  stageKicker: document.querySelector('[data-scene-kicker]'),
  stageTitle: document.querySelector('[data-scene-title]'),
  stagePoint: document.querySelector('[data-scene-point]'),
  narration: document.querySelector('[data-scene-narration]'),
  propGlyph: document.querySelector('[data-prop-glyph]'),
  propName: document.querySelector('[data-prop-name]'),
  enemy: document.querySelector('[data-stage-enemy]'),
  enemyName: document.querySelector('[data-stage-enemy-name]'),
  result: document.querySelector('[data-stage-result]'),
  special: document.querySelector('[data-stage-special]'),
  specialName: document.querySelector('[data-stage-special-name]'),
  progress: document.querySelector('[data-scene-progress]'),
  scenePosition: document.querySelector('[data-scene-position]'),
  characterWindow: document.querySelector('[data-character-window]'),
  characterImage: document.querySelector('[data-character-image]'),
  characterFallback: document.querySelector('[data-character-fallback]'),
  characterNumber: document.querySelector('[data-character-number]'),
  characterName: document.querySelector('[data-character-name]'),
  occupation: document.querySelector('[data-occupation]'),
  role: document.querySelector('[data-role]'),
  personality: document.querySelector('[data-personality]'),
  equipment: document.querySelector('[data-equipment]'),
  dossierEnemy: document.querySelector('[data-enemy]'),
  dossierSpecial: document.querySelector('[data-special-move]'),
  motifs: document.querySelector('[data-motifs]'),
  functions: document.querySelector('[data-functions]'),
  shapes: document.querySelector('[data-shapes]'),
  strengths: document.querySelector('[data-strengths]'),
  weaknesses: document.querySelector('[data-weaknesses]'),
  threats: document.querySelector('[data-threats]'),
  disclaimer: document.querySelector('[data-disclaimer]'),
  previous: document.querySelector('[data-previous-scene]'),
  play: document.querySelector('[data-play-button]'),
  next: document.querySelector('[data-next-scene]'),
  speed: document.querySelector('[data-speed-select]'),
};

let characterManifest = null;
let pageSounds = null;
let profile = null;
let sceneIndex = 0;
let elapsedMs = 0;
let playbackSpeed = 1;
let isPlaying = false;
let isReady = false;
let animationFrame = null;
let lastFrameTime = null;
let turnTimer = null;

function setStatus(message) {
  elements.status.textContent = message;
}

function replaceList(element, values) {
  const fragment = document.createDocumentFragment();
  for (const value of values) {
    const item = document.createElement('li');
    item.textContent = value;
    fragment.append(item);
  }
  element.replaceChildren(fragment);
}

function setTheme(theme) {
  elements.shell.style.setProperty('--lab-ink', theme.ink);
  elements.shell.style.setProperty('--lab-accent', theme.accent);
  elements.shell.style.setProperty('--lab-glow', theme.glow);
}

function renderCharacter() {
  const cast = characterAssetForId(characterManifest, profile.castId);
  const manifestUrl = new URL(CHARACTER_MANIFEST_URL, document.baseURI);
  const imageUrl = new URL(cast.sheet.file, manifestUrl).href;
  elements.characterNumber.textContent = cast.label;
  elements.characterImage.alt = `${cast.label}のキャラクターと関連小物。${profile.target}の説明に使う比喩的な配役です。`;
  elements.characterImage.style.setProperty('--cast-sheet-left', cast.imageLeft);
  elements.characterImage.style.setProperty('--cast-sheet-top', cast.imageTop);
  elements.characterWindow.dataset.imageState = 'loading';
  elements.characterFallback.hidden = true;
  if (elements.characterImage.dataset.assetUrl !== imageUrl) {
    elements.characterImage.hidden = true;
    elements.characterImage.dataset.assetUrl = imageUrl;
    elements.characterImage.src = imageUrl;
  } else if (elements.characterImage.complete && elements.characterImage.naturalWidth > 0) {
    elements.characterImage.hidden = false;
    elements.characterWindow.dataset.imageState = 'ready';
  }
}

function renderProfile() {
  setTheme(profile.theme);
  elements.characterName.textContent = profile.characterName;
  elements.occupation.textContent = profile.occupation.name;
  elements.role.textContent = profile.occupation.role;
  elements.personality.textContent = profile.personality;
  elements.dossierEnemy.textContent = profile.enemy;
  elements.dossierSpecial.textContent = profile.specialMove;
  elements.disclaimer.textContent = profile.disclaimer;
  replaceList(elements.equipment, profile.equipment);
  replaceList(elements.motifs, profile.visualMotifs);
  replaceList(elements.functions, profile.normalized.functions);
  replaceList(elements.shapes, profile.normalized.shapes);
  replaceList(elements.strengths, profile.normalized.strengths);
  replaceList(elements.weaknesses, profile.normalized.weaknesses);
  replaceList(elements.threats, profile.normalized.threats);
  renderCharacter();
}

function replayTurnAnimation() {
  clearTimeout(turnTimer);
  elements.theater.classList.remove('is-turning');
  void elements.theater.offsetWidth;
  elements.theater.classList.add('is-turning');
  turnTimer = setTimeout(() => elements.theater.classList.remove('is-turning'), 520);
}

function renderProgress() {
  if (!profile) return;
  const scene = profile.scenes[sceneIndex];
  const ratio = Math.max(0, Math.min(1, elapsedMs / scene.durationMs));
  elements.progress.style.width = `${ratio * 100}%`;
  elements.scenePosition.textContent = `${sceneIndex + 1} / ${profile.scenes.length}`;
}

function renderScene({ animate = true } = {}) {
  if (!profile) return;
  const scene = profile.scenes[sceneIndex];
  elements.theater.dataset.scene = scene.id;
  elements.theater.dataset.effect = scene.effect;
  elements.stageKicker.textContent = scene.kicker;
  elements.stageTitle.textContent = scene.title;
  elements.stagePoint.textContent = scene.point;
  elements.narration.textContent = scene.narration;
  elements.propGlyph.textContent = scene.prop.glyph;
  elements.propName.textContent = scene.prop.name;
  elements.enemyName.textContent = profile.enemy;
  elements.specialName.textContent = profile.specialMove;
  elements.enemy.hidden = scene.id !== 'crisis';
  elements.special.hidden = scene.id !== 'special';
  elements.result.hidden = scene.id !== 'complete';
  elements.sceneButtons.forEach((button, index) => {
    if (index === sceneIndex) button.setAttribute('aria-current', 'step');
    else button.removeAttribute('aria-current');
  });
  elements.sceneButtons[sceneIndex]?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: animate ? 'smooth' : 'auto' });
  renderProgress();
  if (animate) replayTurnAnimation();
}

function updatePlaybackButton() {
  elements.play.setAttribute('aria-pressed', String(isPlaying));
  elements.play.textContent = isPlaying ? 'Ⅱ 一時停止' : '▶ 再生';
  elements.theater.dataset.playing = String(isPlaying);
}

function stopPlayback({ announce = false } = {}) {
  if (animationFrame !== null) cancelAnimationFrame(animationFrame);
  animationFrame = null;
  lastFrameTime = null;
  isPlaying = false;
  updatePlaybackButton();
  if (announce && profile) setStatus(`${profile.target}の再生を一時停止しました。`);
}

function finishPlayback() {
  stopPlayback();
  setStatus(`${profile.target}の擬人化と7シーンの再生が完了しました。`);
}

function playbackTick(timestamp) {
  if (!isPlaying || !profile) return;
  if (lastFrameTime === null) lastFrameTime = timestamp;
  const deltaMs = Math.min(100, Math.max(0, timestamp - lastFrameTime)) * playbackSpeed;
  lastFrameTime = timestamp;
  const next = advanceSceneClock({ sceneIndex, elapsedMs }, deltaMs, profile.scenes);
  const sceneChanged = next.sceneIndex !== sceneIndex;
  sceneIndex = next.sceneIndex;
  elapsedMs = next.elapsedMs;
  if (sceneChanged) {
    renderScene({ animate: true });
    pageSounds?.play().catch(() => {});
  } else {
    renderProgress();
  }
  if (next.complete) {
    finishPlayback();
    return;
  }
  animationFrame = requestAnimationFrame(playbackTick);
}

function startPlayback() {
  if (!isReady || !profile || isPlaying) return;
  const lastScene = profile.scenes.length - 1;
  if (sceneIndex === lastScene && elapsedMs >= profile.scenes[lastScene].durationMs) {
    sceneIndex = 0;
    elapsedMs = 0;
    renderScene({ animate: true });
  }
  isPlaying = true;
  lastFrameTime = null;
  updatePlaybackButton();
  setStatus(`${profile.target}を${profile.occupation.name}へ変換し、7シーンを再生しています。`);
  animationFrame = requestAnimationFrame(playbackTick);
}

function setScene(nextIndex) {
  if (!isReady || !profile) return;
  const wasPlaying = isPlaying;
  stopPlayback();
  sceneIndex = Math.max(0, Math.min(profile.scenes.length - 1, nextIndex));
  elapsedMs = 0;
  renderScene({ animate: true });
  pageSounds?.play().catch(() => {});
  setStatus(`${profile.target} · ${profile.scenes[sceneIndex].label}シーンを表示しました。`);
  if (wasPlaying) startPlayback();
}

async function generateAndPlay(event) {
  event.preventDefault();
  if (!isReady) return;
  elements.target.setCustomValidity('');
  stopPlayback();
  elements.generate.disabled = true;
  elements.form.setAttribute('aria-busy', 'true');
  setStatus('特徴を正規化し、職業・装備・天敵・必殺技を編成しています…');

  await new Promise((resolve) => requestAnimationFrame(resolve));
  try {
    profile = generatePersonification(elements.target.value, { description: elements.description.value });
    sceneIndex = 0;
    elapsedMs = 0;
    renderProfile();
    renderScene({ animate: true });
    startPlayback();
  } catch (error) {
    const message = error instanceof Error ? error.message : '擬人化を生成できませんでした。';
    elements.target.setCustomValidity(message);
    elements.target.reportValidity();
    setStatus(message);
  } finally {
    elements.form.removeAttribute('aria-busy');
    elements.generate.disabled = false;
  }
}

function initializeEvents() {
  elements.form.addEventListener('submit', generateAndPlay);
  elements.play.addEventListener('click', () => {
    if (isPlaying) stopPlayback({ announce: true });
    else startPlayback();
  });
  elements.previous.addEventListener('click', () => setScene(sceneIndex - 1));
  elements.next.addEventListener('click', () => setScene(sceneIndex + 1));
  elements.sceneButtons.forEach((button, index) => button.addEventListener('click', () => setScene(index)));
  elements.speed.addEventListener('change', () => {
    playbackSpeed = Number(elements.speed.value) || 1;
    setStatus(`再生速度を${playbackSpeed}倍にしました。`);
  });
  elements.target.addEventListener('input', () => elements.target.setCustomValidity(''));
  document.querySelectorAll('[data-example]').forEach((button) => button.addEventListener('click', () => {
    const example = EXAMPLES[button.dataset.example];
    if (!example) return;
    elements.target.value = example.target;
    elements.description.value = example.description;
    elements.target.setCustomValidity('');
    setStatus(`${example.target}を入力しました。「生成して再生」を押すと7シーンが始まります。`);
    elements.generate.focus();
  }));
  elements.characterImage.addEventListener('load', () => {
    if (elements.characterImage.currentSrc !== elements.characterImage.dataset.assetUrl) return;
    elements.characterImage.hidden = false;
    elements.characterFallback.hidden = true;
    elements.characterWindow.dataset.imageState = 'ready';
  });
  elements.characterImage.addEventListener('error', () => {
    elements.characterImage.hidden = true;
    elements.characterFallback.hidden = false;
    elements.characterWindow.dataset.imageState = 'error';
  });
  document.addEventListener('keydown', (event) => {
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return;
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      setScene(sceneIndex - 1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      setScene(sceneIndex + 1);
    } else if (event.key === ' ') {
      event.preventDefault();
      elements.play.click();
    }
  });
}

async function boot() {
  elements.occupationCount.textContent = String(occupationCount());
  initializeEvents();
  elements.generate.disabled = true;
  setStatus('200名の人物図鑑を読み込んでいます…');
  try {
    [characterManifest, pageSounds] = await Promise.all([
      loadCharacterManifest(CHARACTER_MANIFEST_URL),
      createPageSoundController().catch(() => null),
    ]);
    profile = generatePersonification('LLM', { description: EXAMPLES.llm.description });
    renderProfile();
    renderScene({ animate: false });
    isReady = true;
    elements.shell.dataset.appState = 'ready';
    elements.generate.disabled = false;
    setStatus('準備完了。対象を入力して「生成して再生」を押してください。');
  } catch (error) {
    elements.shell.dataset.appState = 'error';
    elements.generate.disabled = true;
    setStatus(`初期化できませんでした: ${error instanceof Error ? error.message : '不明なエラー'}`);
  }
}

boot();
