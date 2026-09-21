const EDITION_DEFINITIONS = Object.freeze({
  light: Object.freeze({ route: './index.html', label: 'Light', description: '書架と概要' }),
  full: Object.freeze({ route: './data-motion.html', label: 'Full', description: 'データ解析' }),
  extra: Object.freeze({ route: './character-story.html', label: 'Extra', description: 'キャラクター実演' }),
});

const PAPER_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{1,79}$/iu;
const CHARACTER_MANIFEST_PATTERN = /^\.\/sheets\/[0-9]{3}-[0-9]{3}\.webp$/u;
const URL_CHANGE_EVENT = 'researchphantom:urlchange';
const HISTORY_PATCH = Symbol.for('researchphantom.editionHistoryPatch');

export function normalizePaperId(value) {
  const normalized = String(value ?? '').trim();
  return PAPER_ID_PATTERN.test(normalized) ? normalized : null;
}

export function editionHref(edition, paperId = null) {
  const definition = EDITION_DEFINITIONS[edition];
  if (!definition) throw new RangeError(`Unknown edition: ${edition}`);
  const normalizedPaperId = normalizePaperId(paperId);
  return normalizedPaperId
    ? `${definition.route}?paper=${encodeURIComponent(normalizedPaperId)}`
    : definition.route;
}

export function supportingCastId(paperIndex, sceneIndex) {
  if (!Number.isSafeInteger(paperIndex) || paperIndex < 0) throw new RangeError('paperIndex must be a non-negative integer');
  if (!Number.isSafeInteger(sceneIndex) || sceneIndex < 0 || sceneIndex > 6) throw new RangeError('sceneIndex must be an integer from 0 to 6');
  return ((paperIndex * 7 + sceneIndex) % 200) + 1;
}

export function validateCharacterManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return false;
  const coverage = manifest.coverage;
  if (
    coverage?.firstId !== 1
    || coverage?.lastId !== 200
    || coverage?.charactersPerSheet !== 10
    || coverage?.sheetCount !== 20
    || !Array.isArray(manifest.sheets)
    || manifest.sheets.length !== 20
  ) return false;
  return manifest.sheets.every((sheet, index) => {
    const first = index * 10 + 1;
    const last = first + 9;
    return sheet?.range === `${String(first).padStart(3, '0')}-${String(last).padStart(3, '0')}`
      && typeof sheet.file === 'string'
      && CHARACTER_MANIFEST_PATTERN.test(sheet.file);
  });
}

export async function loadCharacterManifest(url = './public/assets/characters/manifest.json') {
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`Character manifest request failed: ${response.status}`);
  const manifest = await response.json();
  if (!validateCharacterManifest(manifest)) throw new Error('Character manifest is invalid');
  return manifest;
}

export function resolveSupportingCast(manifest, paperIndex, sceneIndex) {
  if (!validateCharacterManifest(manifest)) throw new TypeError('A valid 200-character manifest is required');
  const id = supportingCastId(paperIndex, sceneIndex);
  const sheetIndex = Math.floor((id - 1) / manifest.coverage.charactersPerSheet);
  const cellIndex = (id - 1) % manifest.coverage.charactersPerSheet;
  const column = cellIndex % 2;
  const row = Math.floor(cellIndex / 2);
  return Object.freeze({
    id,
    label: `人物図鑑 No.${String(id).padStart(3, '0')}`,
    sheet: manifest.sheets[sheetIndex],
    sheetIndex,
    cellIndex,
    column,
    row,
    // 元図版は上部に約6.5%の柱がある。残りを2列×5段として切り出す。
    imageLeft: `${column * -100}%`,
    imageTop: `${-((row + 0.35) * 100)}%`,
  });
}

export function syncEditionLinks(root = document, locationHref = globalThis.location?.href) {
  if (!root?.querySelectorAll || !locationHref) return;
  const url = new URL(locationHref);
  const paperId = normalizePaperId(url.searchParams.get('paper'));
  const switcher = root.querySelector('[data-edition-switcher]');
  const currentEdition = switcher?.dataset.currentEdition;

  for (const link of root.querySelectorAll('[data-edition-target]')) {
    const target = link.dataset.editionTarget;
    const definition = EDITION_DEFINITIONS[target];
    if (!definition) continue;
    link.href = editionHref(target, paperId);
    link.setAttribute('aria-label', `${definition.label}：${definition.description}を開く${paperId ? '（選択中の論文を引き継ぎ）' : ''}`);
    if (target === currentEdition) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }

  for (const link of root.querySelectorAll('[data-paper-link]')) {
    const target = link.dataset.paperLink;
    if (EDITION_DEFINITIONS[target]) link.href = editionHref(target, paperId);
  }
}

function installHistoryObserver() {
  if (!globalThis.history || globalThis.history[HISTORY_PATCH]) return;
  for (const methodName of ['pushState', 'replaceState']) {
    const original = globalThis.history[methodName];
    globalThis.history[methodName] = function patchedHistoryMethod(...args) {
      const result = original.apply(this, args);
      globalThis.dispatchEvent(new Event(URL_CHANGE_EVENT));
      return result;
    };
  }
  Object.defineProperty(globalThis.history, HISTORY_PATCH, { value: true });
}

export function initializeEditionSwitcher(root = document) {
  if (!root?.querySelector?.('[data-edition-switcher]')) return;
  root.documentElement?.classList.add('has-edition-switcher');
  installHistoryObserver();
  const sync = () => syncEditionLinks(root);
  globalThis.addEventListener?.('popstate', sync);
  globalThis.addEventListener?.(URL_CHANGE_EVENT, sync);
  sync();
}

if (typeof document !== 'undefined') initializeEditionSwitcher(document);
