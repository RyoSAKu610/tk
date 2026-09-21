const DEFAULT_PAPERS_URL = './public/data/research-feed.json';
const DEFAULT_SOUND_MANIFEST_URL = './public/audio/page-turns/manifest.json';
const DEFAULT_AUDIO_SETTINGS_KEY = 'research-phantom-studio:page-sound:v1';
const DEFAULT_LIBRARY_KEY = 'research-phantom-studio:library:v1';

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assert(condition, message) {
  if (!condition) throw new TypeError(message);
}

function requiredString(value, path, { max = 20_000 } = {}) {
  assert(typeof value === 'string', `${path} must be a string`);
  const normalized = value.trim();
  assert(normalized.length > 0, `${path} must not be empty`);
  assert(normalized.length <= max, `${path} is too long`);
  assert(!/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(normalized), `${path} contains a forbidden control character`);
  return normalized;
}

function optionalString(value, path, { max = 20_000 } = {}) {
  if (value === null || value === undefined || value === '') return null;
  return requiredString(value, path, { max });
}

function stringArray(value, path, { min = 0, max = 100, itemMax = 2_000 } = {}) {
  assert(Array.isArray(value), `${path} must be an array`);
  assert(value.length >= min && value.length <= max, `${path} length is invalid`);
  return Object.freeze(value.map((item, index) => requiredString(item, `${path}[${index}]`, { max: itemMax })));
}

function validateHttpUrl(value, path) {
  const normalized = requiredString(value, path, { max: 2_048 });
  let parsed;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new TypeError(`${path} must be an absolute URL`);
  }
  assert(parsed.protocol === 'https:' || parsed.protocol === 'http:', `${path} must use http or https`);
  return parsed.href;
}

function validatePaper(raw, index, seenIds) {
  const path = `feed.papers[${index}]`;
  assert(isPlainObject(raw), `${path} must be an object`);
  const id = requiredString(raw.id, `${path}.id`, { max: 96 });
  assert(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(id), `${path}.id contains unsafe characters`);
  assert(!seenIds.has(id), `${path}.id is duplicated`);
  seenIds.add(id);

  const published = optionalString(raw.published, `${path}.published`, { max: 32 });
  if (published) assert(/^\d{4}-\d{2}-\d{2}$/.test(published), `${path}.published must use YYYY-MM-DD`);

  const paper = {
    id,
    title: requiredString(raw.title, `${path}.title`, { max: 1_000 }),
    authors: stringArray(raw.authors, `${path}.authors`, { min: 1, max: 100, itemMax: 300 }),
    institution: optionalString(raw.institution, `${path}.institution`, { max: 500 }),
    countryCode: optionalString(raw.countryCode, `${path}.countryCode`, { max: 8 }),
    country: optionalString(raw.country, `${path}.country`, { max: 100 }),
    flag: optionalString(raw.flag, `${path}.flag`, { max: 16 }),
    published,
    source: optionalString(raw.source, `${path}.source`, { max: 100 }),
    link: raw.link ? validateHttpUrl(raw.link, `${path}.link`) : null,
    categories: stringArray(raw.categories ?? [], `${path}.categories`, { max: 30, itemMax: 100 }),
    summary: requiredString(raw.summary, `${path}.summary`),
    analysis: optionalString(raw.analysis, `${path}.analysis`),
    prospects: optionalString(raw.prospects, `${path}.prospects`),
    problem: requiredString(raw.problem, `${path}.problem`),
    methods: stringArray(raw.methods, `${path}.methods`, { min: 1, max: 30 }),
    result: requiredString(raw.result, `${path}.result`),
    metric: raw.metric === null || raw.metric === undefined ? null : raw.metric,
    impact: requiredString(raw.impact, `${path}.impact`),
    viz: raw.viz ?? null,
    briefingGeneratedBy: optionalString(raw.briefingGeneratedBy, `${path}.briefingGeneratedBy`, { max: 100 }),
    dataQuality: isPlainObject(raw.dataQuality) ? Object.freeze({ ...raw.dataQuality }) : null,
  };
  return Object.freeze(paper);
}

export function validatePaperFeed(raw) {
  assert(isPlainObject(raw), 'feed must be an object');
  assert(Number.isSafeInteger(raw.version) && raw.version >= 1, 'feed.version must be a positive integer');
  assert(Array.isArray(raw.papers) && raw.papers.length > 0, 'feed.papers must be a non-empty array');
  assert(raw.papers.length <= 10_000, 'feed.papers exceeds the safety limit');
  const seenIds = new Set();
  return Object.freeze(raw.papers.map((paper, index) => validatePaper(paper, index, seenIds)));
}

export async function loadPapers(options = {}) {
  const normalized = typeof options === 'string' ? { url: options } : options;
  assert(isPlainObject(normalized), 'loadPapers options must be an object or URL string');
  const url = normalized.url ?? DEFAULT_PAPERS_URL;
  const fetchImpl = normalized.fetchImpl ?? globalThis.fetch;
  assert(typeof fetchImpl === 'function', 'loadPapers requires fetch');
  const response = await fetchImpl(url, { headers: { accept: 'application/json' } });
  assert(response && response.ok, `paper feed request failed (${response?.status ?? 'unknown'})`);
  return validatePaperFeed(await response.json());
}

export function createPaperNavigator(papers, options = {}) {
  assert(Array.isArray(papers) && papers.length > 0, 'createPaperNavigator requires papers');
  assert(isPlainObject(options), 'navigator options must be an object');
  let index = Number.isSafeInteger(options.initialIndex) ? options.initialIndex : 0;
  index = ((index % papers.length) + papers.length) % papers.length;
  const listeners = new Set();
  if (typeof options.onChange === 'function') listeners.add(options.onChange);

  const emit = (reason) => {
    const snapshot = Object.freeze({ paper: papers[index], index, length: papers.length, reason });
    for (const listener of listeners) listener(snapshot);
    if (typeof globalThis.dispatchEvent === 'function' && typeof globalThis.CustomEvent === 'function') {
      globalThis.dispatchEvent(new CustomEvent('researchphantom:paper-change', { detail: snapshot }));
    }
    return papers[index];
  };

  const goTo = (nextIndex, reason = 'go-to') => {
    assert(Number.isFinite(nextIndex), 'paper index must be finite');
    index = ((Math.trunc(nextIndex) % papers.length) + papers.length) % papers.length;
    return emit(reason);
  };

  return Object.freeze({
    current: () => papers[index],
    next: () => goTo(index + 1, 'next'),
    previous: () => goTo(index - 1, 'previous'),
    goTo,
    goToId(id) {
      const nextIndex = papers.findIndex((paper) => paper.id === id);
      assert(nextIndex >= 0, `unknown paper id: ${id}`);
      return goTo(nextIndex, 'go-to-id');
    },
    getIndex: () => index,
    getLength: () => papers.length,
    subscribe(listener) {
      assert(typeof listener === 'function', 'navigator listener must be a function');
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });
}

function validatePageSoundManifest(raw) {
  assert(isPlainObject(raw), 'page sound manifest must be an object');
  assert(raw.schemaVersion === 1, 'unsupported page sound schemaVersion');
  assert(Array.isArray(raw.sounds) && raw.sounds.length === 5, 'page sound manifest must contain exactly five sounds');
  const ids = new Set();
  const files = new Set();
  return Object.freeze(raw.sounds.map((sound, index) => {
    const path = `manifest.sounds[${index}]`;
    assert(isPlainObject(sound), `${path} must be an object`);
    const id = requiredString(sound.id, `${path}.id`, { max: 64 });
    assert(/^[a-z0-9][a-z0-9-]*$/i.test(id), `${path}.id contains unsafe characters`);
    assert(!ids.has(id), `${path}.id is duplicated`);
    ids.add(id);
    const file = requiredString(sound.file, `${path}.file`, { max: 256 });
    assert(/^\.\/[a-zA-Z0-9][a-zA-Z0-9._-]*\.(mp3|ogg|wav|m4a)$/i.test(file), `${path}.file must be a safe relative audio path`);
    assert(!files.has(file), `${path}.file is duplicated`);
    files.add(file);
    const gain = Number(sound.gain);
    const durationMs = Number(sound.durationMs);
    assert(Number.isFinite(gain) && gain > 0 && gain <= 4, `${path}.gain is invalid`);
    assert(Number.isSafeInteger(durationMs) && durationMs >= 100 && durationMs <= 10_000, `${path}.durationMs is invalid`);
    return Object.freeze({ id, label: requiredString(sound.label, `${path}.label`, { max: 100 }), file, gain, durationMs });
  }));
}

function makeMemoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

function browserLocalStorage() {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

function usableStorage(candidate) {
  if (!candidate || typeof candidate.getItem !== 'function' || typeof candidate.setItem !== 'function') return makeMemoryStorage();
  return candidate;
}

function readJson(storage, key, fallback) {
  try {
    const value = storage.getItem(key);
    return value === null ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
}

function writeJson(storage, key, value) {
  try {
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function secureRandomIndex(length) {
  assert(Number.isSafeInteger(length) && length > 0, 'random choice requires candidates');
  if (globalThis.crypto?.getRandomValues) {
    const max = Math.floor(0x1_0000_0000 / length) * length;
    const value = new Uint32Array(1);
    do globalThis.crypto.getRandomValues(value); while (value[0] >= max);
    return value[0] % length;
  }
  return Math.floor(Math.random() * length);
}

function resolveAssetUrl(file, manifestUrl) {
  const base = typeof document !== 'undefined' ? document.baseURI : 'http://localhost/';
  return new URL(file, new URL(manifestUrl, base)).href;
}

async function defaultFallbackPlayer(volume) {
  const AudioContextClass = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  if (!AudioContextClass) return false;
  const context = new AudioContextClass();
  try {
    const duration = 0.22;
    const frameCount = Math.ceil(context.sampleRate * duration);
    const buffer = context.createBuffer(1, frameCount, context.sampleRate);
    const channel = buffer.getChannelData(0);
    for (let frame = 0; frame < frameCount; frame += 1) {
      const progress = frame / frameCount;
      channel[frame] = (Math.random() * 2 - 1) * Math.sin(Math.PI * progress) * (1 - progress) * 0.16;
    }
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    filter.type = 'bandpass';
    filter.frequency.value = 1_700;
    filter.Q.value = 0.55;
    gain.gain.value = Math.min(0.2, volume * 0.2);
    source.buffer = buffer;
    source.connect(filter).connect(gain).connect(context.destination);
    source.start();
    await new Promise((resolve) => { source.onended = resolve; });
    return true;
  } finally {
    await context.close().catch(() => {});
  }
}

export async function createPageSoundController(options = {}) {
  assert(isPlainObject(options), 'page sound options must be an object');
  const manifestUrl = options.manifestUrl ?? DEFAULT_SOUND_MANIFEST_URL;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const storage = usableStorage(options.storage ?? browserLocalStorage());
  const storageKey = options.storageKey ?? DEFAULT_AUDIO_SETTINGS_KEY;
  const audioFactory = options.audioFactory ?? ((url) => new Audio(url));
  const fallbackPlayer = options.fallbackPlayer ?? defaultFallbackPlayer;
  assert(typeof fetchImpl === 'function', 'page sound controller requires fetch');
  assert(typeof audioFactory === 'function', 'audioFactory must be a function');

  const response = await fetchImpl(manifestUrl, { headers: { accept: 'application/json' } });
  assert(response && response.ok, `page sound manifest request failed (${response?.status ?? 'unknown'})`);
  const sounds = validatePageSoundManifest(await response.json());
  const byId = new Map(sounds.map((sound) => [sound.id, sound]));
  const saved = readJson(storage, storageKey, {});
  let mode = saved.mode === 'manual' ? 'manual' : 'random';
  let selectedId = byId.has(saved.selectedId) ? saved.selectedId : sounds[0].id;
  let volume = Number.isFinite(saved.volume) ? Math.min(1, Math.max(0, saved.volume)) : 0.7;
  let lastPlayedId = null;
  let activeAudio = null;
  let isPlaying = false;
  const listeners = new Set();

  const snapshot = () => Object.freeze({ mode, selectedId, volume, lastPlayedId, currentId: lastPlayedId, playing: isPlaying });
  const save = () => writeJson(storage, storageKey, { mode, selectedId, volume });
  const emit = () => {
    const state = snapshot();
    for (const listener of listeners) listener(state);
    if (typeof globalThis.dispatchEvent === 'function' && typeof globalThis.CustomEvent === 'function') {
      globalThis.dispatchEvent(new CustomEvent('researchphantom:page-sound-change', { detail: state }));
    }
    return state;
  };
  const stop = () => {
    if (activeAudio) {
      try { activeAudio.pause?.(); } catch {}
      try { activeAudio.currentTime = 0; } catch {}
    }
    activeAudio = null;
    isPlaying = false;
  };
  const choose = (explicitId) => {
    if (explicitId !== undefined && explicitId !== null) {
      assert(byId.has(explicitId), `unknown page sound id: ${explicitId}`);
      return byId.get(explicitId);
    }
    if (mode === 'manual') return byId.get(selectedId);
    const candidates = sounds.length > 1 ? sounds.filter((sound) => sound.id !== lastPlayedId) : sounds;
    return candidates[secureRandomIndex(candidates.length)];
  };

  return Object.freeze({
    async play(explicitId) {
      const sound = choose(explicitId);
      stop();
      let fallback = false;
      try {
        const audio = audioFactory(resolveAssetUrl(sound.file, manifestUrl), sound);
        assert(audio && typeof audio.play === 'function', 'audioFactory returned an invalid audio object');
        activeAudio = audio;
        audio.preload = 'auto';
        audio.volume = Math.min(1, volume * sound.gain);
        await audio.play();
        isPlaying = true;
        audio.addEventListener?.('ended', () => {
          if (activeAudio !== audio) return;
          activeAudio = null;
          isPlaying = false;
          emit();
        }, { once: true });
      } catch {
        activeAudio = null;
        isPlaying = false;
        fallback = Boolean(await fallbackPlayer(volume, sound));
      }
      lastPlayedId = sound.id;
      emit();
      return Object.freeze({ id: sound.id, fallback });
    },
    stop,
    setMode(nextMode) {
      assert(nextMode === 'random' || nextMode === 'manual', 'page sound mode must be random or manual');
      mode = nextMode;
      save();
      return emit();
    },
    select(id) {
      assert(byId.has(id), `unknown page sound id: ${id}`);
      selectedId = id;
      mode = 'manual';
      save();
      return emit();
    },
    setVolume(nextVolume) {
      const numeric = Number(nextVolume);
      assert(Number.isFinite(numeric), 'page sound volume must be finite');
      volume = Math.min(1, Math.max(0, numeric));
      if (activeAudio) activeAudio.volume = Math.min(1, volume * (byId.get(lastPlayedId)?.gain ?? 1));
      save();
      return emit();
    },
    getState: snapshot,
    listSounds: () => sounds,
    subscribe(listener) {
      assert(typeof listener === 'function', 'page sound listener must be a function');
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });
}

function normalizeLibraryEntry(paper, existing = null) {
  const id = typeof paper === 'string' ? paper.trim() : paper?.id?.trim();
  assert(id && /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(id), 'library item requires a safe id');
  const now = new Date().toISOString();
  return Object.freeze({
    id,
    title: typeof paper === 'object' && paper ? String(paper.title ?? existing?.title ?? id).slice(0, 1_000) : existing?.title ?? id,
    source: typeof paper === 'object' && paper ? String(paper.source ?? existing?.source ?? '').slice(0, 100) : existing?.source ?? '',
    published: typeof paper === 'object' && paper ? String(paper.published ?? existing?.published ?? '').slice(0, 32) : existing?.published ?? '',
    addedAt: existing?.addedAt ?? now,
    lastReviewedAt: existing?.lastReviewedAt ?? null,
    reviewCount: Number.isSafeInteger(existing?.reviewCount) ? existing.reviewCount : 0,
  });
}

export function persistLibrary(options = {}) {
  const normalized = typeof options === 'string' ? { storageKey: options } : options;
  assert(isPlainObject(normalized), 'persistLibrary options must be an object or storage key');
  const storage = usableStorage(normalized.storage ?? browserLocalStorage());
  const storageKey = normalized.storageKey ?? DEFAULT_LIBRARY_KEY;
  const listeners = new Set();
  const loaded = readJson(storage, storageKey, []);
  const items = new Map();
  if (Array.isArray(loaded)) {
    for (const item of loaded) {
      try {
        const normalizedItem = normalizeLibraryEntry(item, item);
        items.set(normalizedItem.id, normalizedItem);
      } catch {}
    }
  }

  const list = () => Object.freeze([...items.values()].sort((a, b) => b.addedAt.localeCompare(a.addedAt)));
  const emit = (reason) => {
    const snapshot = Object.freeze({ reason, items: list() });
    writeJson(storage, storageKey, snapshot.items);
    for (const listener of listeners) listener(snapshot);
    if (typeof globalThis.dispatchEvent === 'function' && typeof globalThis.CustomEvent === 'function') {
      globalThis.dispatchEvent(new CustomEvent('researchphantom:library-change', { detail: snapshot }));
    }
    return snapshot.items;
  };

  const api = {
    list,
    has: (id) => items.has(id),
    get: (id) => items.get(id) ?? null,
    add(paper) {
      const item = normalizeLibraryEntry(paper, items.get(typeof paper === 'string' ? paper : paper?.id));
      items.set(item.id, item);
      emit('add');
      return item;
    },
    remove(id) {
      const removed = items.delete(id);
      if (removed) emit('remove');
      return removed;
    },
    toggle(paper) {
      const id = typeof paper === 'string' ? paper : paper?.id;
      if (items.has(id)) {
        items.delete(id);
        emit('remove');
        return false;
      }
      api.add(paper);
      return true;
    },
    markReviewed(id) {
      const existing = items.get(id);
      assert(existing, `unknown library item: ${id}`);
      const next = Object.freeze({
        ...existing,
        lastReviewedAt: new Date().toISOString(),
        reviewCount: existing.reviewCount + 1,
      });
      items.set(id, next);
      emit('review');
      return next;
    },
    clear() {
      items.clear();
      emit('clear');
    },
    subscribe(listener) {
      assert(typeof listener === 'function', 'library listener must be a function');
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return Object.freeze(api);
}

export const studioDefaults = Object.freeze({
  papersUrl: DEFAULT_PAPERS_URL,
  pageSoundManifestUrl: DEFAULT_SOUND_MANIFEST_URL,
});
