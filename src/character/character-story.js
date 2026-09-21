import {
  createPageSoundController,
  createPaperNavigator,
  loadPapers,
  persistLibrary,
} from '../shared/studio-core.js';
import {
  loadCharacterManifest,
  resolveSupportingCast,
} from '../shared/edition-runtime.js';

const SCENE_LABELS = ['問い', '入力', '処理', '注意', '観測', '整理', '結論'];
const UNVERIFIED_SCENE_LABELS = ['要旨', '未分類', '手法確認', '注意', '結果確認', '解釈確認', '保留'];
const SCENE_STAGES = ['question', 'input', 'process', 'caution', 'observation', 'interpretation', 'conclusion'];
const NARRATION_MANIFEST_URL = './public/audio/narration/manifest.json';
const MOTION_MANIFEST_URL = './public/assets/motion/manifest.json';
const CHARACTER_MANIFEST_URL = './public/assets/characters/manifest.json';
const DEMO_PAPER_ID = 'rp-uk37f0';
const LEGACY_FAVORITES_KEY = 'research-phantom-studio:favorites:v1';
const REVIEWED_KEY = 'research-phantom-studio:reviewed:v1';
const prefersReducedMotion = globalThis.matchMedia('(prefers-reduced-motion: reduce)');
const GUIDE_MOTION = Object.freeze({
  newton: Object.freeze({
    face: [53, 61],
    characterMask: 'ellipse(27% 47% at 55% 70%)',
    detailMask: 'circle(17% at 82% 73%)',
  }),
  ada: Object.freeze({
    face: [44, 28],
    characterMask: 'ellipse(26% 49% at 43% 55%)',
    detailMask: 'circle(19% at 79% 64%)',
  }),
  pascal: Object.freeze({
    face: [72, 61],
    characterMask: 'ellipse(25% 45% at 72% 72%)',
    detailMask: 'circle(18% at 32% 72%)',
  }),
  curie: Object.freeze({
    face: [64, 37],
    characterMask: 'ellipse(27% 48% at 64% 57%)',
    detailMask: 'circle(19% at 30% 65%)',
  }),
  galileo: Object.freeze({
    face: [34, 62],
    characterMask: 'ellipse(25% 44% at 34% 72%)',
    detailMask: 'circle(19% at 73% 70%)',
  }),
  darwin: Object.freeze({
    face: [81, 49],
    characterMask: 'ellipse(24% 46% at 80% 65%)',
    detailMask: 'circle(18% at 49% 63%)',
  }),
  socrates: Object.freeze({
    face: [54, 61],
    characterMask: 'ellipse(26% 45% at 54% 72%)',
    detailMask: 'circle(18% at 24% 73%)',
  }),
});
const SCENE_ACTIONS = Object.freeze([
  Object.freeze({ emotion: 'curious', label: '問いを立てる', glyphs: ['?', '？', '✦'] }),
  Object.freeze({ emotion: 'receiving', label: '材料を受け取る', glyphs: ['IN', '↓', '＋'] }),
  Object.freeze({ emotion: 'working', label: '手順を動かす', glyphs: ['⚙', '↻', '→'] }),
  Object.freeze({ emotion: 'alert', label: '断定を止める', glyphs: ['!', '△', '…'] }),
  Object.freeze({ emotion: 'focused', label: '結果を観測する', glyphs: ['●', '◉', '↗'] }),
  Object.freeze({ emotion: 'thinking', label: '結果と解釈を分ける', glyphs: ['≒', '⇄', '?'] }),
  Object.freeze({ emotion: 'celebrating', label: '一文を持ち帰る', glyphs: ['✓', '★', '→'] }),
]);
const UNVERIFIED_SCENE_ACTIONS = Object.freeze([
  Object.freeze({ emotion: 'curious', label: '公開要旨を読む', glyphs: ['要旨', '？', '✦'] }),
  Object.freeze({ emotion: 'receiving', label: '未分類で保つ', glyphs: ['RAW', '≠', 'IN'] }),
  Object.freeze({ emotion: 'working', label: '原文へ移動する', glyphs: ['本文', '↗', '…'] }),
  Object.freeze({ emotion: 'alert', label: '断定を止める', glyphs: ['!', '△', '保留'] }),
  Object.freeze({ emotion: 'focused', label: '結果を確認待ちにする', glyphs: ['結果', '?', '↗'] }),
  Object.freeze({ emotion: 'thinking', label: '解釈を確認待ちにする', glyphs: ['解釈', '≒', '?'] }),
  Object.freeze({ emotion: 'celebrating', label: '未確認を分けて保存', glyphs: ['保留', '✓', '→'] }),
]);
const FEATURED_GUIDES = Object.freeze({
  'rp-uk37f0': Object.freeze({
    id: 'newton',
    name: 'アイザック・ニュートン',
    role: '変化を法則へ結ぶ観測官',
    asset: './public/assets/characters/guide-newton.webp',
    prop: ['重力の観測ノート', '↓'],
  }),
});

const GUIDE_PRESETS = Object.freeze([
  {
    id: 'ada',
    name: 'エイダ・ラブレス',
    role: '計算手順のプログラマー',
    asset: './public/assets/characters/guide-ada.webp',
    match: /(^|\.)cs|ai|llm|computer|algorithm|software|robot|data/i,
    prop: ['歯車ノート', '⌘'],
  },
  {
    id: 'pascal',
    name: 'ブレーズ・パスカル',
    role: '仮説と量の検算係',
    asset: './public/assets/characters/guide-pascal.webp',
    match: /math|stat|entropy|topolog|probab|geometry|number/i,
    prop: ['計算機', '△'],
  },
  {
    id: 'curie',
    name: 'マリー・キュリー',
    role: '測定と再現性の研究員',
    asset: './public/assets/characters/guide-curie.webp',
    match: /bio|med|chem|health|cell|gene|brain|eeg|disease/i,
    prop: ['実験フラスコ', '⚗'],
  },
  {
    id: 'galileo',
    name: 'ガリレオ・ガリレイ',
    role: '観測条件のスカウト',
    asset: './public/assets/characters/guide-galileo.webp',
    match: /astro|physics|quantum|x-ray|satellite|space|sensor/i,
    prop: ['観測望遠鏡', '⌕'],
  },
  {
    id: 'darwin',
    name: 'チャールズ・ダーウィン',
    role: '変化と比較の観察者',
    asset: './public/assets/characters/guide-darwin.webp',
    match: /earth|ecology|environment|evolution|climate|animal|plant/i,
    prop: ['観察ノート', '❧'],
  },
  {
    id: 'socrates',
    name: 'ソクラテス',
    role: '前提を問い直す対話役',
    asset: './public/assets/characters/guide-socrates.webp',
    match: /.*/,
    prop: ['問いのランタン', '?'],
  },
]);

const SCENE_BLUEPRINTS = Object.freeze([
  {
    kicker: 'SCENE 01 · QUESTION',
    title: 'この論文は、何を解こうとした？',
    note: 'まず「困っていること」を一つだけ掴みます。',
    prop: ['問いのカード', '?'],
  },
  {
    kicker: 'SCENE 02 · INPUT',
    title: '実験や解析に、何を入れた？',
    note: '対象・データ・前提条件を、結果と混ぜずに見ます。',
    prop: ['入力トレイ', 'IN'],
  },
  {
    kicker: 'SCENE 03 · PROCESS',
    title: 'どんな手順で確かめた？',
    note: '方法を「何をしたか」という動詞で追います。',
    prop: ['手順の歯車', '⚙'],
  },
  {
    kicker: 'SCENE 04 · CAUTION',
    title: 'どこまでなら言える？',
    note: '要旨だけでは分からない条件や比較は、原文で確認します。',
    prop: ['注意レンズ', '△'],
  },
  {
    kicker: 'SCENE 05 · OBSERVATION',
    title: '実際に観測されたことは？',
    note: '期待や将来像ではなく、報告された結果だけに寄ります。',
    prop: ['観測ランプ', '●'],
  },
  {
    kicker: 'SCENE 06 · INTERPRETATION',
    title: '要旨では、解釈と結果をどう並べている？',
    note: '因果を断定せず、要旨に書かれた解釈と結果を並べて読みます。',
    prop: ['解釈のしおり', '≒'],
  },
  {
    kicker: 'SCENE 07 · CONCLUSION',
    title: 'この論文から持ち帰る一文',
    note: '結論と今後の期待を分けて、本棚へ残します。',
    prop: ['知識のしおり', '✓'],
  },
]);

const elements = {
  shell: document.querySelector('.app-shell'),
  appStatus: document.querySelector('[data-app-status]'),
  resultCount: document.querySelector('[data-result-count]'),
  favoriteCount: document.querySelector('[data-favorite-count]'),
  reviewedCount: document.querySelector('[data-reviewed-count]'),
  searchLabel: document.querySelector('[data-search-label]'),
  search: document.querySelector('#paper-search'),
  paperList: document.querySelector('[data-paper-list]'),
  emptyState: document.querySelector('[data-empty-state]'),
  library: document.querySelector('#paper-library'),
  libraryToggle: document.querySelector('[data-library-toggle]'),
  libraryClose: document.querySelector('[data-library-close]'),
  paperHandoff: document.querySelector('[data-paper-handoff]'),
  paperOrder: document.querySelector('[data-paper-order]'),
  paperSource: document.querySelector('[data-paper-source]'),
  paperDate: document.querySelector('[data-paper-date]'),
  paperTitle: document.querySelector('[data-paper-title]'),
  paperAuthors: document.querySelector('[data-paper-authors]'),
  verificationDisclosure: document.querySelector('[data-verification-disclosure]'),
  sourceLink: document.querySelector('[data-source-link]'),
  favoriteButton: document.querySelector('[data-favorite-button]'),
  reviewedButton: document.querySelector('[data-reviewed-button]'),
  liveStory: document.querySelector('[data-live-story]'),
  videoStory: document.querySelector('[data-video-story]'),
  demoVideo: document.querySelector('[data-demo-video]'),
  videoFallback: document.querySelector('[data-video-fallback]'),
  paperTheater: document.querySelector('[data-paper-theater]'),
  sceneCard: document.querySelector('[data-scene-card]'),
  sceneKicker: document.querySelector('[data-scene-kicker]'),
  sceneTitle: document.querySelector('[data-scene-title]'),
  scenePoint: document.querySelector('[data-scene-point]'),
  sceneNote: document.querySelector('[data-scene-note]'),
  sceneProgress: document.querySelector('[data-scene-progress]'),
  subtitleBox: document.querySelector('[data-subtitle-box]'),
  subtitle: document.querySelector('[data-subtitle]'),
  guideImage: document.querySelector('[data-guide-image]'),
  domGuide: document.querySelector('[data-dom-guide]'),
  guideName: document.querySelector('[data-guide-name]'),
  guideRole: document.querySelector('[data-guide-role]'),
  propIcon: document.querySelector('[data-prop-icon]'),
  propName: document.querySelector('[data-prop-name]'),
  supportingCast: document.querySelector('[data-supporting-cast]'),
  supportingCastImage: document.querySelector('[data-supporting-cast-image]'),
  supportingCastLabel: document.querySelector('[data-supporting-cast-label]'),
  previousScene: document.querySelector('[data-previous-scene]'),
  nextScene: document.querySelector('[data-next-scene]'),
  playButton: document.querySelector('[data-play-button]'),
  speedSelect: document.querySelector('[data-speed-select]'),
  subtitleToggle: document.querySelector('[data-subtitle-toggle]'),
  voiceSelect: document.querySelector('[data-voice-select]'),
  voiceStatus: document.querySelector('[data-voice-status]'),
  openaiAvailability: document.querySelector('[data-openai-availability]'),
  soundMode: document.querySelector('[data-sound-mode]'),
  soundSelect: document.querySelector('[data-sound-select]'),
  soundVolume: document.querySelector('[data-sound-volume]'),
  soundVolumeOutput: document.querySelector('[data-sound-volume-output]'),
  soundPreview: document.querySelector('[data-sound-preview]'),
  soundStatus: document.querySelector('[data-sound-status]'),
  previousPaper: document.querySelector('[data-previous-paper]'),
  nextPaper: document.querySelector('[data-next-paper]'),
  paperPosition: document.querySelector('[data-paper-position]'),
};

const motionElements = {
  artboard: null,
  face: null,
  mouth: null,
  speechHalo: null,
  actionLabel: null,
  glyphs: [],
  line: null,
  linePath: null,
  lineDot: null,
  video: null,
  videoSource: null,
};

const sceneButtons = [...document.querySelectorAll('[data-scene-index]')];
const viewButtons = [...document.querySelectorAll('[data-view-mode]')];

let papers = [];
let navigator = null;
let currentPaper = null;
let currentScenes = [];
let sceneIndex = 0;
let viewMode = 'live';
let isPlaying = false;
let playbackSpeed = 1;
let sceneElapsedMs = 0;
let lastAnimationTime = null;
let animationFrameId = null;
let turnTimer = null;
let pageSounds = null;
let narrationManifest = null;
let motionManifest = null;
let characterManifest = null;
let narrationAudio = null;
let narrationRequest = 0;
let narrationContext = null;
let narrationMeter = null;
let narrationMeterFrame = null;
let narrationAudioContext = null;
let isReady = false;
let libraryReturnFocus = null;
const libraryDrawerQuery = globalThis.matchMedia('(max-width: 820px)');

const favorites = persistLibrary();
const legacyFavorites = persistLibrary({ storageKey: LEGACY_FAVORITES_KEY });
const reviewed = persistLibrary({ storageKey: REVIEWED_KEY });

for (const item of legacyFavorites.list()) {
  if (!favorites.has(item.id)) favorites.add(item);
}
if (legacyFavorites.list().length > 0) legacyFavorites.clear();

function setStatus(message) {
  elements.appStatus.textContent = message;
}

function setInteractiveDisabled(disabled) {
  for (const control of elements.shell.querySelectorAll('button, input, select')) {
    control.disabled = disabled;
  }
  elements.demoVideo.controls = !disabled;
  if (disabled || !currentPaper?.link) {
    elements.sourceLink.removeAttribute('href');
    elements.sourceLink.setAttribute('aria-disabled', 'true');
  } else {
    elements.sourceLink.href = currentPaper.link;
    elements.sourceLink.removeAttribute('aria-disabled');
  }
}

function guardReady() {
  if (isReady) return true;
  setStatus('論文データの準備が完了していないため、操作を開始できません。');
  return false;
}

function updateVideoAvailability(paper) {
  const videoButton = viewButtons.find((button) => button.dataset.viewMode === 'video');
  const available = paper?.id === DEMO_PAPER_ID;
  if (videoButton) {
    videoButton.hidden = !available;
    videoButton.disabled = !isReady || !available;
  }
  if (!available && viewMode === 'video') {
    viewMode = 'live';
    elements.liveStory.hidden = false;
    elements.videoStory.hidden = true;
    elements.demoVideo.pause();
    viewButtons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.viewMode === 'live')));
  }
}

function firstSentence(value, maxLength = 178) {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!normalized) return 'この項目は要旨に明記されていません。原文で確認してください。';
  const parts = normalized.split(/(?<=[。！？!?])\s*/u).filter(Boolean);
  let answer = parts[0] ?? normalized;
  if (answer.length < 68 && parts[1]) answer += parts[1];
  if (answer.length <= maxLength) return answer;
  return `${answer.slice(0, maxLength - 1).replace(/[、,\s]+$/u, '')}…`;
}

function formatDate(value) {
  if (!value) return '日付不明';
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: 'short', day: 'numeric' }).format(date);
}

function isSha256(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
}

function isImportedAt(value) {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value)
    && Number.isFinite(Date.parse(value));
}

function hasOpenAiNarrationAssets() {
  return Object.values(narrationManifest?.papers ?? {}).some((paper) => {
    const entry = paper?.openai;
    return Array.isArray(entry?.scenes) && entry.scenes.some((scene) => typeof scene === 'string' && scene.trim());
  });
}

function syncVoiceAvailability() {
  const option = elements.voiceSelect.querySelector('option[value="openai"]');
  if (!option) return;
  const available = hasOpenAiNarrationAssets();
  option.disabled = !available;
  option.textContent = available ? 'OpenAI Voice（事前生成のみ）' : 'OpenAI Voice（素材未登録）';
  elements.openaiAvailability.textContent = available
    ? 'OpenAI Voiceの事前生成素材があります。ブラウザで鍵を入力せず、登録済み音声だけを再生します。素材がない場面は字幕で続けます。'
    : 'OpenAI Voice素材は未登録です。字幕で続けられます。公開済み音声が追加された場合のみ、鍵なしで選択できます。';
  if (!available && elements.voiceSelect.value === 'openai') elements.voiceSelect.value = 'captions';
}

function updateVerificationDisclosure(paper) {
  if (!elements.verificationDisclosure) return;
  const total = papers.length;
  const verified = papers.filter((entry) => entry?.dataQuality?.sectionClassification === 'verified').length;
  const currentIsVerified = paper?.dataQuality?.sectionClassification === 'verified';
  elements.verificationDisclosure.textContent = currentIsVerified
    ? `この解説は手動確認済みです（確認済み ${verified} / ${total} 篇）。日次更新の対象は論文フィードのみで、音声・動画・AIモーションは原文確認とレビュー後に追加します。`
    : `この論文は公開要旨を役割未分類で表示しています（手動確認済み ${verified} / ${total} 篇）。日次更新の対象は論文フィードのみで、音声・動画・AIモーションは原文確認とレビュー後に追加します。`;
}

function selectGuide(paper) {
  if (FEATURED_GUIDES[paper.id]) return FEATURED_GUIDES[paper.id];
  const specialized = GUIDE_PRESETS.slice(0, -1);
  const categoryText = (paper.categories ?? []).join(' ');
  const categoryGuide = specialized.find((preset) => preset.match.test(categoryText));
  if (categoryGuide) return categoryGuide;
  const haystack = [paper.title, paper.summary].join(' ');
  return specialized.find((preset) => preset.match.test(haystack)) ?? GUIDE_PRESETS.at(-1);
}

function buildUnverifiedScenes(paper) {
  const abstract = firstSentence(paper.summary, 186);
  const scenes = [
    {
      kicker: 'SCENE 01 · ABSTRACT',
      title: '公開要旨には何が書かれている？',
      note: 'この段階では、問題設定・手法・結果のどれかだと断定しません。',
      point: `公開要旨（役割未分類）：${abstract}`,
      subtitle: `まず公開要旨を、そのまま読みます。まだ問題設定や結果とは分類しません。${abstract}`,
      prop: ['未分類の要旨カード', '要旨'],
    },
    {
      kicker: 'SCENE 02 · UNCLASSIFIED',
      title: '要旨を役割分けせず読む',
      note: '文の位置だけを根拠に「入力」や「条件」と決めないための保留です。',
      point: '公開要旨の文を、位置だけで「問題・入力・手法・結果」に自動分類していません。',
      subtitle: 'ここでは要旨を未分類のまま保ちます。入力や条件だと言い切るには、原文の節見出しと本文の確認が必要です。',
      prop: ['未分類トレイ', 'RAW'],
    },
    {
      kicker: 'SCENE 03 · METHODS CHECK',
      title: '手法は原文で確認',
      note: 'Methods、Experiments、Materialsなど、原文の対応する節へ移動します。',
      point: '具体的な手順・対象・比較条件は、公開要旨だけから確定せず、原論文のMethodsを確認してください。',
      subtitle: '手法の実演はまだ行いません。具体的な手順や比較条件を原文で確認してから、検証済みの場面へ更新します。',
      prop: ['Methodsへの索引', '↗'],
    },
    {
      kicker: 'SCENE 04 · CLAIM BOUNDARY',
      title: 'どこまでが未確認？',
      note: '要旨から確認できる本文と、節ごとの役割分類を分けます。',
      point: '公開要旨の本文は取得済みですが、問題・手法・結果・限界への節分類は未検証です。',
      subtitle: '大切な注意点です。要旨本文があることと、その文を結果や限界だと確認できたことは別です。',
      prop: ['未確認の境界線', '△'],
    },
    {
      kicker: 'SCENE 05 · RESULTS CHECK',
      title: '結果は原文で確認',
      note: 'ResultsまたはConclusionの記述を確認するまで、観測結果として扱いません。',
      point: '公開要旨から結果文を自動確定していません。原論文のResultsまたはConclusionを確認してください。',
      subtitle: 'ここは結果の確認待ちです。数値や性能、効果を要旨の文順だけで観測結果に変換しません。',
      prop: ['Resultsへの索引', '?'],
    },
    {
      kicker: 'SCENE 06 · INTERPRETATION CHECK',
      title: '解釈も未分類のまま保つ',
      note: '著者の解釈と報告結果を分けるには、原文の議論を確認します。',
      point: '要旨の各文を著者の解釈だと自動分類していません。DiscussionやConclusionで位置づけを確認してください。',
      subtitle: '解釈も確認待ちにします。因果関係や著者の主張を要旨以上に足さないためです。',
      prop: ['Discussionへの索引', '≒'],
    },
    {
      kicker: 'SCENE 07 · OPEN QUESTIONS',
      title: '未確認事項を分けて残す',
      note: '未確認を隠さず本棚へ残せば、次のレビューで続きを確認できます。',
      point: '手法・結果・限界・解釈は原文確認待ちです。公開要旨の内容と混ぜず、未確認事項として保存します。',
      subtitle: '持ち帰るのは断定ではなく確認リストです。原文を読んだ後に、検証済みの七場面へ更新します。',
      prop: ['確認待ちのしおり', '保留'],
    },
  ];
  return scenes.map((scene, index) => ({
    ...scene,
    index,
    stage: SCENE_STAGES[index],
    action: UNVERIFIED_SCENE_ACTIONS[index],
  }));
}

function updateSceneVocabulary(paper) {
  const unverified = paper.dataQuality?.sectionClassification === 'unverified';
  const labels = unverified ? UNVERIFIED_SCENE_LABELS : SCENE_LABELS;
  sceneButtons.forEach((button, index) => {
    const number = button.querySelector('span')?.textContent ?? String(index + 1).padStart(2, '0');
    const label = labels[index];
    for (const node of button.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) node.textContent = label;
    }
    button.setAttribute('aria-label', `${number} ${label}`);
  });
  const flowLabels = unverified
    ? ['未分類', '手法確認', '注意', '結果確認', '解釈確認', '保留']
    : ['入力', '処理', '注意', '観測', '解釈', '結論'];
  document.querySelectorAll('[data-flow]').forEach((node, index) => { node.textContent = flowLabels[index]; });
}

function buildScenes(paper) {
  if (paper.dataQuality?.sectionClassification === 'unverified') return buildUnverifiedScenes(paper);
  const methods = paper.methods?.length ? paper.methods : [paper.summary];
  const input = firstSentence(methods[0] ?? paper.summary);
  const process = firstSentence(methods[1] ?? methods[0] ?? paper.summary);
  const methodDetail = firstSentence(methods[2] ?? methods.at(-1) ?? paper.summary);
  const observation = firstSentence(paper.result);
  const interpretation = firstSentence(paper.analysis ?? paper.result, 186);
  const conclusion = firstSentence(paper.result, 160);
  const caution = paper.dataQuality?.sourceBriefing === false
    ? `この解説は公開要旨から構成しています。数値、標本数、比較条件、限界は原文で確認してください。方法の手掛かりは「${firstSentence(methodDetail, 72)}」です。`
    : `方法の手掛かりは「${firstSentence(methodDetail, 112)}」です。適用範囲と比較条件は原文で確認してください。`;
  const points = [firstSentence(paper.problem), input, process, caution, observation, interpretation, conclusion];
  const subtitles = [
    `まず問いです。${points[0]}`,
    `次は入力です。${points[1]}`,
    `ここから処理を追います。${points[2]}`,
    `大切な注意点です。${points[3]}`,
    `観測された結果です。${points[4]}`,
    `要旨の解釈として並べます。${points[5]}`,
    `最後に持ち帰る一文です。${points[6]}`,
  ];
  return SCENE_BLUEPRINTS.map((blueprint, index) => ({
    ...blueprint,
    index,
    stage: SCENE_STAGES[index],
    point: points[index],
    subtitle: subtitles[index],
  }));
}

function generatedSceneDurationMs(scene) {
  const textLength = scene?.subtitle?.length ?? 80;
  return Math.max(6_200, Math.min(13_500, 4_300 + textLength * 48));
}

function currentSceneDurationMs() {
  const provider = elements.voiceSelect.value;
  const source = getNarrationEntry(provider, currentPaper?.id, sceneIndex);
  const manifestDuration = narrationManifest?.papers?.[currentPaper?.id]?.[provider]?.durationMs?.[sceneIndex];
  if (source && Number.isFinite(manifestDuration) && manifestDuration > 0) return manifestDuration + 500;
  return generatedSceneDurationMs(currentScenes[sceneIndex]);
}

function currentSubtitleText() {
  const scene = currentScenes[sceneIndex];
  const provider = elements.voiceSelect.value;
  const source = getNarrationEntry(provider, currentPaper?.id, sceneIndex);
  const manifestText = narrationManifest?.papers?.[currentPaper?.id]?.[provider]?.texts?.[sceneIndex];
  if (source && typeof manifestText === 'string' && manifestText.trim()) return manifestText.trim();
  return scene?.subtitle ?? '';
}

function motionNode(className, text = '') {
  const node = document.createElement('span');
  node.className = className;
  node.textContent = text;
  node.setAttribute('aria-hidden', 'true');
  return node;
}

function installGuideMotionRig() {
  const frame = elements.guideImage.closest('.guide-frame');
  if (!frame || frame.querySelector('.guide-artboard')) return;

  const artboard = document.createElement('div');
  artboard.className = 'guide-artboard';
  artboard.setAttribute('data-guide-artboard', '');
  artboard.hidden = elements.guideImage.hidden;
  frame.insertBefore(artboard, elements.guideImage);

  const backLayer = motionNode('guide-depth-layer guide-depth-back');
  const characterLayer = motionNode('guide-depth-layer guide-depth-character');
  const detailLayer = motionNode('guide-depth-layer guide-depth-detail');
  const sceneVideo = document.createElement('video');
  sceneVideo.className = 'guide-motion-video';
  sceneVideo.hidden = true;
  sceneVideo.muted = true;
  sceneVideo.defaultMuted = true;
  sceneVideo.loop = true;
  sceneVideo.playsInline = true;
  sceneVideo.preload = 'metadata';
  sceneVideo.disablePictureInPicture = true;
  sceneVideo.setAttribute('aria-label', 'AI motion映像。音声は別のナレーションとして再生されます。');
  sceneVideo.setAttribute('tabindex', '-1');
  const videoSource = motionNode('guide-motion-source');
  videoSource.hidden = true;
  const atmosphere = motionNode('guide-atmosphere');
  for (let index = 0; index < 7; index += 1) atmosphere.append(motionNode('guide-mote'));

  const face = motionNode('guide-face-rig');
  const leftEye = motionNode('guide-eye-glint guide-eye-glint-left');
  const rightEye = motionNode('guide-eye-glint guide-eye-glint-right');
  const mouth = motionNode('guide-mouth');
  const speechHalo = motionNode('guide-speech-halo');
  face.append(leftEye, rightEye, mouth, speechHalo);

  const actionLabel = motionNode('guide-action-label');
  const glyphField = motionNode('guide-glyph-field');
  const glyphs = [motionNode('motion-glyph'), motionNode('motion-glyph'), motionNode('motion-glyph')];
  glyphField.append(...glyphs);

  artboard.append(
    backLayer,
    elements.guideImage,
    characterLayer,
    detailLayer,
    sceneVideo,
    atmosphere,
    face,
    glyphField,
    actionLabel,
    videoSource,
  );

  const line = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  line.classList.add('guide-action-line');
  line.setAttribute('aria-hidden', 'true');
  line.setAttribute('preserveAspectRatio', 'none');
  const linePath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  linePath.classList.add('guide-action-path');
  const lineDot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  lineDot.classList.add('guide-action-dot');
  lineDot.setAttribute('r', '4');
  line.append(linePath, lineDot);
  elements.paperTheater.append(line);

  motionElements.artboard = artboard;
  motionElements.face = face;
  motionElements.mouth = mouth;
  motionElements.speechHalo = speechHalo;
  motionElements.actionLabel = actionLabel;
  motionElements.glyphs = glyphs;
  motionElements.line = line;
  motionElements.linePath = linePath;
  motionElements.lineDot = lineDot;
  motionElements.video = sceneVideo;
  motionElements.videoSource = videoSource;
}

function setSpeechLevel(level = 0) {
  const safeLevel = Math.max(0, Math.min(1, Number(level) || 0));
  elements.paperTheater.style.setProperty('--speech-level', safeLevel.toFixed(3));
  elements.paperTheater.style.setProperty('--mouth-scale', (0.38 + safeLevel * 1.85).toFixed(3));
  elements.paperTheater.style.setProperty('--speech-glow', (0.08 + safeLevel * 0.54).toFixed(3));
}

function pauseNarrationMeter() {
  if (narrationMeterFrame !== null) cancelAnimationFrame(narrationMeterFrame);
  narrationMeterFrame = null;
  elements.paperTheater.dataset.audioReactive = 'false';
  setSpeechLevel(0);
}

function stopNarrationMeter() {
  pauseNarrationMeter();
  if (narrationMeter) {
    try { narrationMeter.source.disconnect(); } catch {}
    try { narrationMeter.analyser.disconnect(); } catch {}
  }
  narrationMeter = null;
}

function attachNarrationMeter(audio) {
  stopNarrationMeter();
  if (prefersReducedMotion.matches) return;
  const AudioContextClass = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  if (!AudioContextClass) return;
  try {
    narrationAudioContext ??= new AudioContextClass();
    const source = narrationAudioContext.createMediaElementSource(audio);
    const analyser = narrationAudioContext.createAnalyser();
    analyser.fftSize = 128;
    analyser.smoothingTimeConstant = 0.72;
    const samples = new Uint8Array(analyser.fftSize);
    source.connect(analyser);
    analyser.connect(narrationAudioContext.destination);
    narrationMeter = { audio, source, analyser, samples };
  } catch {
    narrationMeter = null;
  }
}

function startNarrationMeter(audio) {
  if (!narrationMeter || narrationMeter.audio !== audio || prefersReducedMotion.matches) return;
  if (narrationMeterFrame !== null) cancelAnimationFrame(narrationMeterFrame);
  narrationAudioContext?.resume().catch(() => {});
  elements.paperTheater.dataset.audioReactive = 'true';

  const tick = () => {
    if (!narrationMeter || narrationMeter.audio !== audio || audio.paused || audio.ended) {
      pauseNarrationMeter();
      return;
    }
    narrationMeter.analyser.getByteTimeDomainData(narrationMeter.samples);
    let energy = 0;
    for (const sample of narrationMeter.samples) {
      const centered = (sample - 128) / 128;
      energy += centered * centered;
    }
    const rms = Math.sqrt(energy / narrationMeter.samples.length);
    setSpeechLevel(Math.min(1, Math.max(0.04, (rms - 0.012) * 10.5)));
    narrationMeterFrame = requestAnimationFrame(tick);
  };
  narrationMeterFrame = requestAnimationFrame(tick);
}

function resetGuideParallax() {
  for (const [name, value] of Object.entries({
    '--look-back-x': '0px', '--look-back-y': '0px',
    '--look-mid-x': '0px', '--look-mid-y': '0px',
    '--look-front-x': '0px', '--look-front-y': '0px',
    '--look-face-x': '0px', '--look-face-y': '0px',
  })) elements.paperTheater.style.setProperty(name, value);
}

function initializeGuideInteraction() {
  if (prefersReducedMotion.matches) return;
  elements.paperTheater.addEventListener('pointermove', (event) => {
    if (event.pointerType === 'touch') return;
    const bounds = elements.paperTheater.getBoundingClientRect();
    const x = Math.max(-1, Math.min(1, ((event.clientX - bounds.left) / bounds.width - 0.5) * 2));
    const y = Math.max(-1, Math.min(1, ((event.clientY - bounds.top) / bounds.height - 0.5) * 2));
    elements.paperTheater.style.setProperty('--look-back-x', `${(-x * 1.8).toFixed(2)}px`);
    elements.paperTheater.style.setProperty('--look-back-y', `${(-y * 1.1).toFixed(2)}px`);
    elements.paperTheater.style.setProperty('--look-mid-x', `${(x * 4.4).toFixed(2)}px`);
    elements.paperTheater.style.setProperty('--look-mid-y', `${(y * 2.8).toFixed(2)}px`);
    elements.paperTheater.style.setProperty('--look-front-x', `${(x * 7.2).toFixed(2)}px`);
    elements.paperTheater.style.setProperty('--look-front-y', `${(y * 4.6).toFixed(2)}px`);
    elements.paperTheater.style.setProperty('--look-face-x', `${(x * 1.7).toFixed(2)}px`);
    elements.paperTheater.style.setProperty('--look-face-y', `${(y * 1.2).toFixed(2)}px`);
  }, { passive: true });
  elements.paperTheater.addEventListener('pointerleave', resetGuideParallax, { passive: true });
}

function updateExperimentFlow(stage) {
  const flowOrder = SCENE_STAGES.slice(1);
  const current = flowOrder.indexOf(stage);
  for (const node of document.querySelectorAll('[data-flow]')) {
    const index = flowOrder.indexOf(node.dataset.flow);
    const state = current < 0 || index > current ? 'upcoming' : index === current ? 'active' : 'complete';
    node.dataset.flowState = state;
  }
}

function updateActionLine() {
  if (!motionElements.line || !motionElements.face || !currentScenes[sceneIndex]) return;
  const theaterBounds = elements.paperTheater.getBoundingClientRect();
  const sourceBounds = motionElements.face.getBoundingClientRect();
  const stage = currentScenes[sceneIndex].stage;
  const candidate = stage === 'question'
    ? elements.sceneTitle
    : document.querySelector(`[data-flow="${stage}"]`);
  const target = candidate instanceof HTMLElement && candidate.offsetParent !== null ? candidate : elements.sceneTitle;
  const targetBounds = target.getBoundingClientRect();
  const sourceX = sourceBounds.left + sourceBounds.width / 2 - theaterBounds.left;
  const sourceY = sourceBounds.top + sourceBounds.height / 2 - theaterBounds.top;
  const targetX = targetBounds.left + targetBounds.width / 2 - theaterBounds.left;
  const targetY = targetBounds.top + targetBounds.height / 2 - theaterBounds.top;
  const bend = Math.max(28, Math.abs(targetX - sourceX) * 0.36);
  motionElements.line.setAttribute('viewBox', `0 0 ${Math.max(1, theaterBounds.width)} ${Math.max(1, theaterBounds.height)}`);
  motionElements.linePath.setAttribute('d', `M ${sourceX.toFixed(1)} ${sourceY.toFixed(1)} C ${(sourceX + bend).toFixed(1)} ${sourceY.toFixed(1)}, ${(targetX - bend).toFixed(1)} ${targetY.toFixed(1)}, ${targetX.toFixed(1)} ${targetY.toFixed(1)}`);
  motionElements.lineDot.setAttribute('cx', targetX.toFixed(1));
  motionElements.lineDot.setAttribute('cy', targetY.toFixed(1));
}

function renderGuideMotion(guide, scene) {
  if (!motionElements.artboard) return;
  const motion = GUIDE_MOTION[guide.id] ?? GUIDE_MOTION.socrates;
  const artUrl = new URL(guide.asset, document.baseURI).href;
  motionElements.artboard.style.setProperty('--guide-art', `url("${artUrl}")`);
  motionElements.artboard.style.setProperty('--guide-character-mask', motion.characterMask);
  motionElements.artboard.style.setProperty('--guide-detail-mask', motion.detailMask);
  motionElements.artboard.style.setProperty('--guide-face-x', `${motion.face[0]}%`);
  motionElements.artboard.style.setProperty('--guide-face-y', `${motion.face[1]}%`);
  motionElements.artboard.dataset.guideId = guide.id;
  const action = scene.action ?? SCENE_ACTIONS[scene.index] ?? SCENE_ACTIONS[0];
  elements.paperTheater.dataset.guideEmotion = action.emotion;
  motionElements.actionLabel.textContent = action.label;
  motionElements.glyphs.forEach((glyph, index) => { glyph.textContent = action.glyphs[index] ?? ''; });
  updateExperimentFlow(scene.stage);
  updateSceneMotion(scene.stage);
  requestAnimationFrame(updateActionLine);
}

function renderGuide(guide) {
  elements.guideName.textContent = guide.name;
  elements.guideRole.textContent = guide.role;
  elements.guideImage.alt = `${guide.name}をモチーフにした案内キャラクター`;
  const previouslyFailed = elements.guideImage.dataset.failedSource === guide.asset;
  elements.guideImage.hidden = previouslyFailed;
  if (motionElements.artboard) motionElements.artboard.hidden = previouslyFailed;
  elements.domGuide.hidden = !previouslyFailed;
  if (elements.guideImage.getAttribute('src') !== guide.asset) {
    elements.guideImage.src = guide.asset;
  }
}

function renderSupportingCast({ animate = true } = {}) {
  if (!characterManifest || !currentPaper || !navigator) {
    elements.supportingCast.hidden = true;
    return;
  }
  const cast = resolveSupportingCast(characterManifest, navigator.getIndex(), sceneIndex);
  const manifestUrl = new URL(CHARACTER_MANIFEST_URL, document.baseURI);
  const imageUrl = new URL(cast.sheet.file, manifestUrl).href;
  const paddedId = String(cast.id).padStart(3, '0');

  elements.supportingCast.hidden = false;
  elements.supportingCast.dataset.castId = String(cast.id);
  elements.supportingCast.dataset.castState = 'loading';
  elements.supportingCastLabel.textContent = cast.label;
  elements.supportingCastImage.alt = `人物図鑑 No.${paddedId}の図版。論文著者ではなく、場面理解を助ける比喩的な助演キャストです。`;
  elements.supportingCastImage.style.setProperty('--supporting-cast-left', cast.imageLeft);
  elements.supportingCastImage.style.setProperty('--supporting-cast-top', cast.imageTop);

  if (elements.supportingCastImage.dataset.assetUrl !== imageUrl) {
    elements.supportingCastImage.hidden = true;
    elements.supportingCastImage.dataset.assetUrl = imageUrl;
    elements.supportingCastImage.src = imageUrl;
  } else if (elements.supportingCastImage.complete && elements.supportingCastImage.naturalWidth > 0) {
    elements.supportingCastImage.hidden = false;
    elements.supportingCast.dataset.castState = 'ready';
  }

  elements.supportingCast.classList.remove('is-changing');
  if (animate && !prefersReducedMotion.matches) {
    void elements.supportingCast.offsetWidth;
    elements.supportingCast.classList.add('is-changing');
  }
}

installGuideMotionRig();

elements.guideImage.addEventListener('load', () => {
  delete elements.guideImage.dataset.failedSource;
  elements.guideImage.hidden = false;
  if (motionElements.artboard) motionElements.artboard.hidden = false;
  elements.domGuide.hidden = true;
  requestAnimationFrame(updateActionLine);
});

elements.guideImage.addEventListener('error', () => {
  elements.guideImage.dataset.failedSource = elements.guideImage.getAttribute('src') ?? '';
  elements.guideImage.hidden = true;
  if (motionElements.artboard) motionElements.artboard.hidden = true;
  elements.domGuide.hidden = false;
  requestAnimationFrame(updateActionLine);
});

elements.supportingCastImage.addEventListener('load', () => {
  if (elements.supportingCastImage.currentSrc !== elements.supportingCastImage.dataset.assetUrl) return;
  elements.supportingCastImage.hidden = false;
  elements.supportingCast.dataset.castState = 'ready';
});

elements.supportingCastImage.addEventListener('error', () => {
  elements.supportingCastImage.hidden = true;
  elements.supportingCast.dataset.castState = 'error';
  elements.supportingCastLabel.textContent = '助演キャストの図版を読み込めませんでした';
});

function animateTurn(direction) {
  clearTimeout(turnTimer);
  const className = direction < 0 ? 'is-turning-back' : 'is-turning';
  elements.paperTheater.classList.remove('is-turning', 'is-turning-back');
  void elements.paperTheater.offsetWidth;
  elements.paperTheater.classList.add(className);
  turnTimer = setTimeout(() => elements.paperTheater.classList.remove(className), 460);
}

function renderScene({ direction = 1, animate = true } = {}) {
  const scene = currentScenes[sceneIndex];
  if (!scene || !currentPaper) return;
  const guide = selectGuide(currentPaper);
  elements.sceneKicker.textContent = scene.kicker;
  elements.sceneTitle.textContent = scene.title;
  elements.scenePoint.textContent = scene.point;
  elements.sceneNote.textContent = scene.note;
  elements.subtitle.textContent = currentSubtitleText();
  elements.propName.textContent = scene.prop[0] ?? guide.prop[0];
  elements.propIcon.textContent = scene.prop[1] ?? guide.prop[1];
  elements.paperTheater.dataset.sceneStage = scene.stage;
  elements.sceneProgress.style.width = `${Math.min(100, (sceneElapsedMs / currentSceneDurationMs()) * 100)}%`;
  sceneButtons.forEach((button, index) => {
    if (index === sceneIndex) button.setAttribute('aria-current', 'step');
    else button.removeAttribute('aria-current');
  });
  sceneButtons[sceneIndex]?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  renderGuide(guide);
  renderGuideMotion(guide, scene);
  renderSupportingCast({ animate });
  if (animate) animateTurn(direction);
  updateUrl();
}

function updateUrl() {
  if (!currentPaper || !globalThis.history?.replaceState) return;
  const url = new URL(globalThis.location.href);
  url.searchParams.set('paper', currentPaper.id);
  url.searchParams.set('scene', String(sceneIndex + 1));
  history.replaceState(null, '', url);
}

function getNarrationEntry(provider, paperId, index) {
  const providerEntry = narrationManifest?.papers?.[paperId]?.[provider];
  const source = Array.isArray(providerEntry?.scenes) ? providerEntry.scenes[index] : null;
  if (typeof source !== 'string' || !source.trim()) return null;
  try {
    const url = new URL(source, new URL(NARRATION_MANIFEST_URL, document.baseURI));
    if (url.origin !== globalThis.location.origin) return null;
    return url.href;
  } catch {
    return null;
  }
}

function stopNarration() {
  narrationRequest += 1;
  stopNarrationMeter();
  if (narrationAudio) {
    try {
      narrationAudio.pause();
      narrationAudio.currentTime = 0;
    } catch {}
  }
  narrationAudio = null;
  narrationContext = null;
}

async function playNarration() {
  stopNarration();
  const provider = elements.voiceSelect.value;
  if (provider === 'captions' || !currentPaper) {
    updateVoiceStatus();
    return;
  }
  const source = getNarrationEntry(provider, currentPaper.id, sceneIndex);
  if (!source) {
    updateVoiceStatus();
    return;
  }
  const requestId = narrationRequest;
  const audio = new Audio(source);
  narrationAudio = audio;
  narrationContext = { provider, paperId: currentPaper.id, sceneIndex };
  audio.preload = 'auto';
  audio.playbackRate = playbackSpeed;
  attachNarrationMeter(audio);
  audio.addEventListener('ended', pauseNarrationMeter, { once: true });
  try {
    await audio.play();
    if (requestId !== narrationRequest) audio.pause();
    else {
      startNarrationMeter(audio);
      updateVoiceStatus('再生中');
    }
  } catch {
    if (requestId === narrationRequest) {
      stopNarrationMeter();
      elements.voiceStatus.textContent = '音声を開始できませんでした。字幕は引き続き利用できます。';
    }
  }
}

async function resumeNarration() {
  const provider = elements.voiceSelect.value;
  const matchesCurrentScene = narrationContext
    && narrationContext.provider === provider
    && narrationContext.paperId === currentPaper?.id
    && narrationContext.sceneIndex === sceneIndex;
  if (!narrationAudio || !matchesCurrentScene) {
    await playNarration();
    return;
  }
  if (narrationAudio.ended) {
    updateVoiceStatus('音声終了');
    return;
  }
  narrationAudio.playbackRate = playbackSpeed;
  try {
    await narrationAudio.play();
    startNarrationMeter(narrationAudio);
    updateVoiceStatus('再生中');
  } catch {
    elements.voiceStatus.textContent = '音声を再開できませんでした。字幕は引き続き利用できます。';
  }
}

function updateVoiceStatus(activity = '') {
  if (!currentPaper) return;
  const provider = elements.voiceSelect.value;
  if (provider === 'captions') {
    elements.voiceStatus.textContent = '字幕のみで再生します。';
    return;
  }
  const available = Boolean(getNarrationEntry(provider, currentPaper.id, sceneIndex));
  if (provider === 'openai') {
    elements.voiceStatus.textContent = available
      ? `OpenAI Voice · AI生成音声${activity ? ` · ${activity}` : ''}`
      : 'この場面のOpenAI事前生成音声は未登録です。鍵は要求せず、字幕で続けます。';
    return;
  }
  elements.voiceStatus.textContent = available
    ? `VOICEVOX:ずんだもん${activity ? ` · ${activity}` : ''}`
    : 'この場面のずんだもん事前生成音声は未登録です。字幕で続けます。';
}

async function loadNarrationManifest() {
  try {
    const response = await fetch(NARRATION_MANIFEST_URL, { headers: { accept: 'application/json' } });
    if (!response.ok) return null;
    const raw = await response.json();
    if (raw?.schemaVersion !== 1 || !raw.papers || typeof raw.papers !== 'object') return null;
    return raw;
  } catch {
    return null;
  }
}

async function loadMotionManifest() {
  try {
    const response = await fetch(MOTION_MANIFEST_URL, { headers: { accept: 'application/json' } });
    if (!response.ok) return null;
    const raw = await response.json();
    if (raw?.schemaVersion !== 1 || !raw.papers || typeof raw.papers !== 'object' || Array.isArray(raw.papers)) return null;
    return raw;
  } catch {
    return null;
  }
}

function resolveSceneMotion(paperId, stage) {
  const asset = motionManifest?.papers?.[paperId]?.scenes?.[stage];
  if (!asset || typeof asset !== 'object') return null;
  if (asset.sceneId !== stage
      || asset.muted !== true
      || asset.rights !== 'user-confirmed'
      || asset.provenanceMarkPolicy !== 'preserve-platform-mark'
      || !isSha256(asset.sha256)
      || !isImportedAt(asset.importedAt)
      || !isSha256(asset.provenance?.originalSha256)
      || !isSha256(asset.provenance?.prompt?.sha256)) return null;
  if (!['video/mp4', 'video/webm'].includes(asset.mimeType)) return null;
  if (typeof asset.file !== 'string' || !/^\.\/[a-z0-9][a-z0-9_-]{2,63}\/0[1-7]-[a-z]+\.(?:mp4|webm)$/u.test(asset.file)) return null;
  try {
    const manifestUrl = new URL(MOTION_MANIFEST_URL, document.baseURI);
    const motionRoot = new URL('./', manifestUrl);
    const url = new URL(asset.file, manifestUrl);
    if (url.origin !== globalThis.location.origin || !url.href.startsWith(motionRoot.href)) return null;
    return { ...asset, url: url.href };
  } catch {
    return null;
  }
}

function fallbackToGuideArtwork({ clearSource = false } = {}) {
  const video = motionElements.video;
  if (!video) return;
  video.pause();
  video.hidden = true;
  motionElements.videoSource.hidden = true;
  elements.paperTheater.dataset.motionSource = 'webp';
  if (clearSource && video.getAttribute('src')) {
    video.removeAttribute('src');
    video.load();
    delete video.dataset.motionUrl;
    delete video.dataset.motionLabel;
  }
}

function updateSceneMotion(stage) {
  const video = motionElements.video;
  if (!video || !currentPaper) return;
  const asset = resolveSceneMotion(currentPaper.id, stage);
  if (!asset) {
    fallbackToGuideArtwork({ clearSource: true });
    return;
  }
  if (video.dataset.motionUrl === asset.url) {
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      video.hidden = false;
      elements.paperTheater.dataset.motionSource = 'video';
      motionElements.videoSource.hidden = false;
      if (isPlaying && viewMode === 'live') video.play().catch(() => fallbackToGuideArtwork());
    }
    return;
  }
  fallbackToGuideArtwork({ clearSource: true });
  video.dataset.motionUrl = asset.url;
  video.dataset.motionLabel = String(asset.label ?? asset.provider ?? 'Scene motion');
  video.src = asset.url;
  video.load();
}

function setSceneMotionPlaying(playing) {
  const video = motionElements.video;
  if (!video || video.hidden || elements.paperTheater.dataset.motionSource !== 'video') return;
  if (playing) video.play().catch(() => fallbackToGuideArtwork());
  else video.pause();
}

function initializeSceneMotion() {
  const video = motionElements.video;
  if (!video) return;
  video.addEventListener('loadeddata', () => {
    if (!video.dataset.motionUrl || video.currentSrc !== video.dataset.motionUrl) return;
    video.hidden = false;
    elements.paperTheater.dataset.motionSource = 'video';
    motionElements.videoSource.textContent = `Created with ${video.dataset.motionLabel} · AI motion`;
    motionElements.videoSource.hidden = false;
    video.setAttribute('aria-label', `Created with ${video.dataset.motionLabel} · AI motion。映像は無音ループで、音声は別のナレーションとして再生されます。`);
    if (isPlaying && viewMode === 'live') video.play().catch(() => fallbackToGuideArtwork());
  });
  video.addEventListener('error', () => fallbackToGuideArtwork());
}

function updateLibraryCounts() {
  elements.favoriteCount.textContent = String(favorites.list().length);
  elements.reviewedCount.textContent = String(reviewed.list().length);
}

function updatePaperButtons() {
  if (!currentPaper) return;
  const isFavorite = favorites.has(currentPaper.id);
  const isReviewed = reviewed.has(currentPaper.id);
  elements.favoriteButton.setAttribute('aria-pressed', String(isFavorite));
  elements.favoriteButton.textContent = isFavorite ? '★ お気に入り済み' : '☆ お気に入り';
  elements.reviewedButton.setAttribute('aria-pressed', String(isReviewed));
  elements.reviewedButton.textContent = isReviewed ? '● 既読' : '○ 既読にする';
}

function markCurrentReviewed() {
  if (!currentPaper || reviewed.has(currentPaper.id)) return;
  reviewed.add(currentPaper);
  reviewed.markReviewed(currentPaper.id);
}

function renderPaper(paper, index = navigator.getIndex()) {
  currentPaper = paper;
  elements.paperHandoff.href = `./data-motion.html?paper=${encodeURIComponent(paper.id)}`;
  updateVideoAvailability(paper);
  currentScenes = buildScenes(paper);
  updateSceneVocabulary(paper);
  sceneIndex = 0;
  sceneElapsedMs = 0;
  stopNarration();
  elements.paperOrder.textContent = `PAPER ${String(index + 1).padStart(2, '0')} / ${papers.length}`;
  elements.paperSource.textContent = (paper.source || 'RESEARCH').toUpperCase();
  elements.paperDate.textContent = formatDate(paper.published);
  elements.paperTitle.textContent = paper.title;
  elements.paperAuthors.textContent = paper.authors.join(' · ');
  updateVerificationDisclosure(paper);
  elements.paperPosition.textContent = `${index + 1} / ${papers.length}`;
  if (paper.link) {
    elements.sourceLink.href = paper.link;
    elements.sourceLink.removeAttribute('aria-disabled');
  } else {
    elements.sourceLink.removeAttribute('href');
    elements.sourceLink.setAttribute('aria-disabled', 'true');
  }
  renderScene({ animate: true });
  updatePaperButtons();
  updatePaperListSelection();
  updateVoiceStatus();
  setStatus(`${index + 1}件目「${paper.title}」を表示しました。`);
}

function updatePaperListSelection() {
  const selectedId = currentPaper?.id;
  for (const button of elements.paperList.querySelectorAll('.paper-option')) {
    const selected = button.dataset.paperId === selectedId;
    button.setAttribute('aria-selected', String(selected));
    const flags = button.querySelector('.paper-option-flags');
    const paperId = button.dataset.paperId;
    flags.textContent = `${favorites.has(paperId) ? '★' : '☆'} ${reviewed.has(paperId) ? '●' : '○'}`;
    if (selected) button.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

function matchesSearch(paper, query) {
  if (!query) return true;
  const haystack = [paper.title, paper.authors.join(' '), paper.institution, paper.country, ...(paper.categories ?? [])]
    .filter(Boolean)
    .join(' ')
    .toLocaleLowerCase('ja');
  return haystack.includes(query.toLocaleLowerCase('ja'));
}

function renderPaperList() {
  const query = elements.search.value.trim();
  const filtered = papers.filter((paper) => matchesSearch(paper, query));
  const fragment = document.createDocumentFragment();
  filtered.forEach((paper) => {
    const index = papers.indexOf(paper);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'paper-option';
    button.dataset.paperId = paper.id;
    button.setAttribute('role', 'option');
    button.setAttribute('aria-selected', String(paper.id === currentPaper?.id));

    const number = document.createElement('span');
    number.className = 'paper-option-index';
    number.textContent = String(index + 1).padStart(2, '0');

    const copy = document.createElement('span');
    copy.className = 'paper-option-copy';
    const title = document.createElement('span');
    title.className = 'paper-option-title';
    title.textContent = paper.title;
    const meta = document.createElement('span');
    meta.className = 'paper-option-meta';
    meta.textContent = `${paper.flag ?? ''} ${paper.authors[0]} · ${paper.categories?.[0] ?? paper.source ?? 'Research'}`.trim();
    copy.append(title, meta);

    const flags = document.createElement('span');
    flags.className = 'paper-option-flags';
    flags.setAttribute('aria-hidden', 'true');
    const isFavorite = favorites.has(paper.id);
    const isReviewed = reviewed.has(paper.id);
    const favoriteMark = document.createElement('i');
    favoriteMark.className = isFavorite ? 'flag-favorite is-on' : 'flag-favorite';
    favoriteMark.textContent = isFavorite ? '★' : '☆';
    const reviewedMark = document.createElement('i');
    reviewedMark.className = isReviewed ? 'flag-reviewed is-on' : 'flag-reviewed';
    reviewedMark.textContent = isReviewed ? '●' : '○';
    flags.append(favoriteMark, reviewedMark);
    button.append(number, copy, flags);
    button.addEventListener('click', () => {
      stopPlayback();
      navigator.goToId(paper.id);
      closeLibrary();
    });
    fragment.append(button);
  });
  elements.paperList.replaceChildren(fragment);
  elements.resultCount.textContent = String(filtered.length);
  elements.emptyState.hidden = filtered.length !== 0;
}

function setScene(nextIndex, { direction = 1, playSound = true } = {}) {
  if (!guardReady()) return;
  const clamped = Math.max(0, Math.min(currentScenes.length - 1, nextIndex));
  if (clamped === sceneIndex && sceneElapsedMs === 0) return;
  sceneIndex = clamped;
  sceneElapsedMs = 0;
  renderScene({ direction, animate: true });
  updateVoiceStatus();
  if (playSound) pageSounds?.play().catch(() => {
    elements.soundStatus.textContent = 'ページ音を再生できませんでした。場面操作は続けられます。';
  });
  if (isPlaying) playNarration();
}

function updateProgress() {
  const progress = Math.min(1, sceneElapsedMs / currentSceneDurationMs());
  elements.sceneProgress.style.width = `${progress * 100}%`;
}

function playbackTick(timestamp) {
  if (!isPlaying || viewMode !== 'live') return;
  if (lastAnimationTime === null) lastAnimationTime = timestamp;
  const delta = Math.min(80, timestamp - lastAnimationTime);
  lastAnimationTime = timestamp;
  sceneElapsedMs += delta * playbackSpeed;
  updateProgress();
  if (sceneElapsedMs >= currentSceneDurationMs()) {
    if (sceneIndex < currentScenes.length - 1) setScene(sceneIndex + 1, { direction: 1, playSound: true });
    else {
      markCurrentReviewed();
      stopPlayback();
      setStatus('7場面を見終わりました。既読として本棚に記録しました。');
      return;
    }
  }
  animationFrameId = requestAnimationFrame(playbackTick);
}

async function startPlayback() {
  if (!guardReady()) return;
  if (viewMode === 'video') {
    elements.demoVideo.playbackRate = playbackSpeed;
    isPlaying = true;
    updatePlaybackUi();
    try {
      await elements.demoVideo.play();
    } catch {
      isPlaying = false;
      updatePlaybackUi();
      setStatus('動画を開始できませんでした。再生ボタンをもう一度押してください。');
    }
    return;
  }
  if (isPlaying) return;
  isPlaying = true;
  lastAnimationTime = null;
  elements.paperTheater.dataset.playing = 'true';
  setSceneMotionPlaying(true);
  updatePlaybackUi();
  resumeNarration();
  animationFrameId = requestAnimationFrame(playbackTick);
}

function stopPlayback() {
  if (animationFrameId !== null) cancelAnimationFrame(animationFrameId);
  animationFrameId = null;
  lastAnimationTime = null;
  isPlaying = false;
  elements.paperTheater.dataset.playing = 'false';
  setSceneMotionPlaying(false);
  if (viewMode === 'video') elements.demoVideo.pause();
  if (narrationAudio) narrationAudio.pause();
  pauseNarrationMeter();
  updatePlaybackUi();
}

function updatePlaybackUi() {
  elements.playButton.setAttribute('aria-pressed', String(isPlaying));
  elements.playButton.textContent = isPlaying ? 'Ⅱ 一時停止' : '▶ 再生';
}

function setViewMode(mode) {
  if (!guardReady()) return;
  if (mode !== 'live' && mode !== 'video') return;
  if (mode === 'video' && currentPaper?.id !== DEMO_PAPER_ID) {
    setStatus('完成デモ動画は先頭論文専用です。この論文はライブ紙芝居で視聴できます。');
    return;
  }
  stopPlayback();
  viewMode = mode;
  elements.liveStory.hidden = mode !== 'live';
  elements.videoStory.hidden = mode !== 'video';
  viewButtons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.viewMode === mode)));
  setStatus(mode === 'video' ? '完成デモ動画へ切り替えました。' : 'ライブ紙芝居へ切り替えました。');
}

function openLibrary() {
  if (!guardReady()) return;
  libraryReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : elements.libraryToggle;
  elements.library.classList.add('is-open');
  elements.libraryToggle.setAttribute('aria-expanded', 'true');
  syncLibraryAccessibility();
  requestAnimationFrame(() => elements.search.focus());
}

function closeLibrary({ restoreFocus = true } = {}) {
  const wasOpen = elements.library.classList.contains('is-open');
  if (wasOpen && restoreFocus) {
    const target = libraryReturnFocus?.isConnected ? libraryReturnFocus : elements.libraryToggle;
    target.focus({ preventScroll: true });
  }
  elements.library.classList.remove('is-open');
  elements.libraryToggle.setAttribute('aria-expanded', 'false');
  syncLibraryAccessibility();
  libraryReturnFocus = null;
}

function syncLibraryAccessibility() {
  if (!libraryDrawerQuery.matches) {
    elements.library.inert = false;
    elements.library.removeAttribute('aria-hidden');
    elements.library.classList.remove('is-open');
    elements.libraryToggle.setAttribute('aria-expanded', 'false');
    libraryReturnFocus = null;
    return;
  }

  const isOpen = elements.library.classList.contains('is-open');
  if (!isOpen && elements.library.contains(document.activeElement)) {
    elements.libraryToggle.focus({ preventScroll: true });
  }
  elements.library.inert = !isOpen;
  elements.library.setAttribute('aria-hidden', String(!isOpen));
  elements.libraryToggle.setAttribute('aria-expanded', String(isOpen));
}

function trapLibraryFocus(event) {
  if (event.key !== 'Tab' || !elements.library.classList.contains('is-open')) return false;
  const focusable = [...elements.library.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href]')]
    .filter((item) => item instanceof HTMLElement && item.offsetParent !== null);
  if (focusable.length === 0) return false;
  const first = focusable[0];
  const last = focusable.at(-1);
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
    return true;
  }
  if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
    return true;
  }
  return false;
}

function changePaper(direction) {
  if (!guardReady() || !navigator) return;
  stopPlayback();
  pageSounds?.play().catch(() => {});
  if (direction > 0) navigator.next();
  else navigator.previous();
}

function initializeEvents() {
  syncLibraryAccessibility();
  initializeGuideInteraction();
  initializeSceneMotion();
  if ('ResizeObserver' in globalThis) new ResizeObserver(() => updateActionLine()).observe(elements.paperTheater);
  else globalThis.addEventListener('resize', updateActionLine, { passive: true });
  prefersReducedMotion.addEventListener('change', () => {
    resetGuideParallax();
    pauseNarrationMeter();
  });
  libraryDrawerQuery.addEventListener('change', syncLibraryAccessibility);
  elements.search.addEventListener('input', renderPaperList);
  elements.libraryToggle.addEventListener('click', () => {
    if (elements.library.classList.contains('is-open')) closeLibrary();
    else openLibrary();
  });
  elements.libraryClose.addEventListener('click', closeLibrary);
  elements.favoriteButton.addEventListener('click', () => {
    if (!guardReady() || !currentPaper) return;
    favorites.toggle(currentPaper);
  });
  elements.reviewedButton.addEventListener('click', () => {
    if (!guardReady() || !currentPaper) return;
    if (reviewed.has(currentPaper.id)) reviewed.remove(currentPaper.id);
    else markCurrentReviewed();
  });
  elements.previousPaper.addEventListener('click', () => changePaper(-1));
  elements.nextPaper.addEventListener('click', () => changePaper(1));
  elements.previousScene.addEventListener('click', () => {
    if (!guardReady()) return;
    if (viewMode === 'video') elements.demoVideo.currentTime = Math.max(0, elements.demoVideo.currentTime - 10);
    else setScene(sceneIndex - 1, { direction: -1, playSound: true });
  });
  elements.nextScene.addEventListener('click', () => {
    if (!guardReady()) return;
    if (viewMode === 'video') elements.demoVideo.currentTime = Math.min(elements.demoVideo.duration || Infinity, elements.demoVideo.currentTime + 10);
    else setScene(sceneIndex + 1, { direction: 1, playSound: true });
  });
  sceneButtons.forEach((button, index) => button.addEventListener('click', () => {
    const direction = index < sceneIndex ? -1 : 1;
    setScene(index, { direction, playSound: true });
  }));
  elements.playButton.addEventListener('click', () => {
    if (isPlaying) stopPlayback();
    else startPlayback();
  });
  elements.speedSelect.addEventListener('change', () => {
    playbackSpeed = Number(elements.speedSelect.value) || 1;
    if (narrationAudio) narrationAudio.playbackRate = playbackSpeed;
    elements.demoVideo.playbackRate = playbackSpeed;
    setStatus(`再生速度を${playbackSpeed}倍にしました。`);
  });
  elements.subtitleToggle.addEventListener('change', () => {
    elements.subtitleBox.hidden = !elements.subtitleToggle.checked;
  });
  elements.voiceSelect.addEventListener('change', () => {
    stopNarration();
    sceneElapsedMs = 0;
    elements.subtitle.textContent = currentSubtitleText();
    updateProgress();
    updateVoiceStatus();
    if (isPlaying && viewMode === 'live') playNarration();
  });
  viewButtons.forEach((button) => button.addEventListener('click', () => setViewMode(button.dataset.viewMode)));
  document.querySelector('[data-fallback-live]').addEventListener('click', () => setViewMode('live'));
  elements.demoVideo.addEventListener('play', () => {
    isPlaying = true;
    updatePlaybackUi();
  });
  elements.demoVideo.addEventListener('pause', () => {
    if (viewMode === 'video') {
      isPlaying = false;
      updatePlaybackUi();
    }
  });
  elements.demoVideo.addEventListener('ended', () => {
    isPlaying = false;
    if (isReady) markCurrentReviewed();
    updatePlaybackUi();
  });
  elements.demoVideo.addEventListener('error', () => {
    elements.demoVideo.hidden = true;
    elements.videoFallback.hidden = false;
    setStatus('デモ動画を読み込めないため、ライブ紙芝居を利用できます。');
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && elements.library.classList.contains('is-open')) {
      event.preventDefault();
      closeLibrary();
      return;
    }
    if (trapLibraryFocus(event)) return;
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement || target instanceof HTMLVideoElement) return;
    if (!isReady) return;
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      elements.previousScene.click();
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      elements.nextScene.click();
    }
    if (event.key === ' ') {
      event.preventDefault();
      elements.playButton.click();
    }
  });
  favorites.subscribe(() => {
    updateLibraryCounts();
    updatePaperButtons();
    updatePaperListSelection();
  });
  reviewed.subscribe(() => {
    updateLibraryCounts();
    updatePaperButtons();
    updatePaperListSelection();
  });
}

async function initializePageSounds() {
  try {
    const hasSavedSettings = globalThis.localStorage?.getItem('research-phantom-studio:page-sound:v1') !== null;
    pageSounds = await createPageSoundController();
    if (!hasSavedSettings) pageSounds.setVolume(0.38);
    const sounds = pageSounds.listSounds();
    const fragment = document.createDocumentFragment();
    sounds.forEach((sound) => {
      const option = document.createElement('option');
      option.value = sound.id;
      option.textContent = sound.label;
      fragment.append(option);
    });
    elements.soundSelect.replaceChildren(fragment);
    const initial = pageSounds.getState();
    elements.soundMode.value = initial.mode;
    elements.soundSelect.value = initial.selectedId;
    elements.soundSelect.disabled = initial.mode !== 'manual';
    elements.soundVolume.value = String(initial.volume);
    elements.soundVolumeOutput.textContent = `${Math.round(initial.volume * 100)}%`;
    elements.soundStatus.textContent = '5種類のASMR系ページ音を利用できます。';
    elements.soundMode.addEventListener('change', () => {
      pageSounds.setMode(elements.soundMode.value);
      elements.soundSelect.disabled = elements.soundMode.value !== 'manual';
    });
    elements.soundSelect.addEventListener('change', () => pageSounds.select(elements.soundSelect.value));
    elements.soundVolume.addEventListener('input', () => {
      const volume = Number(elements.soundVolume.value);
      pageSounds.setVolume(volume);
      elements.soundVolumeOutput.textContent = `${Math.round(volume * 100)}%`;
    });
    elements.soundPreview.addEventListener('click', async () => {
      const explicit = elements.soundMode.value === 'manual' ? elements.soundSelect.value : undefined;
      const played = await pageSounds.play(explicit);
      const label = sounds.find((sound) => sound.id === played.id)?.label ?? played.id;
      elements.soundStatus.textContent = `${label}を試聴しました${played.fallback ? '（合成フォールバック）' : ''}。`;
    });
    pageSounds.subscribe((state) => {
      elements.soundMode.value = state.mode;
      elements.soundSelect.value = state.selectedId;
      elements.soundSelect.disabled = state.mode !== 'manual';
    });
  } catch {
    elements.soundMode.disabled = true;
    elements.soundSelect.disabled = true;
    elements.soundVolume.disabled = true;
    elements.soundPreview.disabled = true;
    elements.soundStatus.textContent = 'ページ音素材を読み込めませんでした。解説の閲覧は続けられます。';
  }
}

function initialPaperIndex() {
  const id = new URL(globalThis.location.href).searchParams.get('paper');
  const index = papers.findIndex((paper) => paper.id === id);
  return index >= 0 ? index : 0;
}

function initialSceneIndex() {
  const raw = Number(new URL(globalThis.location.href).searchParams.get('scene'));
  return Number.isSafeInteger(raw) ? Math.max(0, Math.min(6, raw - 1)) : 0;
}

async function boot() {
  setInteractiveDisabled(true);
  initializeEvents();
  updateLibraryCounts();
  try {
    [papers, narrationManifest, motionManifest, characterManifest] = await Promise.all([
      loadPapers(),
      loadNarrationManifest(),
      loadMotionManifest(),
      loadCharacterManifest(CHARACTER_MANIFEST_URL).catch(() => null),
    ]);
    syncVoiceAvailability();
    elements.searchLabel.textContent = `${papers.length}論文から検索`;
    const startIndex = initialPaperIndex();
    const requestedSceneIndex = initialSceneIndex();
    navigator = createPaperNavigator(papers, {
      initialIndex: startIndex,
      onChange: ({ paper, index }) => renderPaper(paper, index),
    });
    currentPaper = navigator.current();
    currentScenes = buildScenes(currentPaper);
    sceneIndex = initialSceneIndex();
    renderPaperList();
    renderPaper(currentPaper, navigator.getIndex());
    if (requestedSceneIndex !== 0) {
      sceneIndex = requestedSceneIndex;
      renderScene({ animate: false });
    }
    isReady = true;
    setInteractiveDisabled(false);
    updateVideoAvailability(currentPaper);
    elements.shell.dataset.appState = 'ready';
    await initializePageSounds();
    setStatus(`${papers.length}本の論文と7場面のキャラクター解説${characterManifest ? '、200名の助演キャスト' : ''}を準備しました。`);
  } catch (error) {
    isReady = false;
    setInteractiveDisabled(true);
    elements.shell.dataset.appState = 'error';
    elements.paperTitle.textContent = '論文データを読み込めませんでした';
    setStatus(`読み込みエラー: ${error instanceof Error ? error.message : '不明なエラー'}`);
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.textContent = '再読み込み';
    retry.addEventListener('click', () => globalThis.location.reload());
    elements.appStatus.append(' ', retry);
  }
}

boot();
