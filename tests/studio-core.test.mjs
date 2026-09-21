import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  createPageSoundController,
  createPaperNavigator,
  loadPapers,
  persistLibrary,
  validatePaperFeed,
} from '../src/shared/studio-core.js';

const root = new URL('../', import.meta.url);

function jsonResponse(value, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => structuredClone(value) };
}

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => map.has(key) ? map.get(key) : null,
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
}

test('the shipped research feed validates and loads all papers', async () => {
  const feed = JSON.parse(await readFile(new URL('../public/data/research-feed.json', import.meta.url), 'utf8'));
  const validated = validatePaperFeed(feed);
  assert.ok(validated.length >= 75);
  assert.equal(new Set(validated.map((paper) => paper.id)).size, validated.length);
  assert.ok(Object.isFrozen(validated));
  assert.ok(validated.every((paper) => paper.methods.length > 0 && paper.summary && paper.result));

  const loaded = await loadPapers({ fetchImpl: async () => jsonResponse(feed) });
  assert.deepEqual(loaded.map((paper) => paper.id), validated.map((paper) => paper.id));
});

test('paper feed validation rejects duplicate ids and incomplete explanations', () => {
  const paper = {
    id: 'paper-1', title: 'Title', authors: ['Author'], summary: 'Summary', problem: 'Problem',
    methods: ['Method'], result: 'Result', impact: 'Impact', categories: [], link: 'https://example.com/paper',
  };
  assert.throws(() => validatePaperFeed({ version: 1, papers: [paper, paper] }), /duplicated/);
  assert.throws(() => validatePaperFeed({ version: 1, papers: [{ ...paper, summary: '' }] }), /must not be empty/);
});

test('paper feed validation rejects hidden C0 control characters', () => {
  const feed = {
    version: 1,
    papers: [{
      id: 'paper-control',
      title: 'Broken \\b notation'.replace('\\b', '\u0008'),
      authors: ['Author'],
      summary: 'Summary',
      problem: 'Problem',
      methods: ['Method'],
      result: 'Result',
      impact: 'Impact',
      categories: [],
      link: 'https://example.com/paper-control',
    }],
  };
  assert.throws(() => validatePaperFeed(feed), /forbidden control character/);
});

test('paper navigator wraps at both ends and emits a stable change object', () => {
  const papers = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const changes = [];
  const navigator = createPaperNavigator(papers, { initialIndex: -1, onChange: (change) => changes.push(change) });
  assert.equal(navigator.current().id, 'c');
  assert.equal(navigator.next().id, 'a');
  assert.equal(navigator.previous().id, 'c');
  assert.equal(navigator.goToId('b').id, 'b');
  assert.deepEqual(changes.map((change) => change.reason), ['next', 'previous', 'go-to-id']);
  assert.throws(() => navigator.goToId('missing'), /unknown paper id/);
});

test('page sound controller validates five sounds, avoids immediate repeats and supports manual choice', async () => {
  const manifest = JSON.parse(await readFile(new URL('../public/audio/page-turns/manifest.json', import.meta.url), 'utf8'));
  const playedUrls = [];
  const storage = memoryStorage();
  const controller = await createPageSoundController({
    manifestUrl: './public/audio/page-turns/manifest.json',
    storage,
    fetchImpl: async () => jsonResponse(manifest),
    audioFactory: (url) => ({
      currentTime: 0,
      pause() {},
      async play() { playedUrls.push(url); },
    }),
  });
  assert.equal(controller.listSounds().length, 5);
  const first = await controller.play();
  const second = await controller.play();
  assert.notEqual(first.id, second.id);
  controller.select('paper-03');
  assert.equal((await controller.play()).id, 'paper-03');
  controller.setVolume(2);
  assert.equal(controller.getState().volume, 1);
  assert.equal(playedUrls.length, 3);
  assert.ok(playedUrls.every((url) => url.startsWith('http://localhost/public/audio/page-turns/')));

  const restored = await createPageSoundController({
    manifestUrl: './public/audio/page-turns/manifest.json',
    storage,
    fetchImpl: async () => jsonResponse(manifest),
    audioFactory: () => ({ currentTime: 0, pause() {}, async play() {} }),
  });
  assert.deepEqual(
    { mode: restored.getState().mode, selectedId: restored.getState().selectedId, volume: restored.getState().volume },
    { mode: 'manual', selectedId: 'paper-03', volume: 1 },
  );
});

test('page sound playback failure falls back without blocking navigation', async () => {
  const manifest = JSON.parse(await readFile(new URL('../public/audio/page-turns/manifest.json', import.meta.url), 'utf8'));
  let fallbackCalls = 0;
  const controller = await createPageSoundController({
    fetchImpl: async () => jsonResponse(manifest),
    audioFactory: () => ({ play: async () => { throw new Error('autoplay denied'); }, pause() {} }),
    fallbackPlayer: async () => { fallbackCalls += 1; return true; },
  });
  const result = await controller.play('paper-04');
  assert.deepEqual(result, { id: 'paper-04', fallback: true });
  assert.equal(fallbackCalls, 1);
});

test('page sound manifest rejects traversal and a wrong sound count', async () => {
  const unsafe = {
    schemaVersion: 1,
    sounds: Array.from({ length: 5 }, (_, index) => ({
      id: `sound-${index}`, label: `Sound ${index}`, file: index ? `./sound-${index}.mp3` : './../secret.mp3', gain: 1, durationMs: 500,
    })),
  };
  await assert.rejects(() => createPageSoundController({ fetchImpl: async () => jsonResponse(unsafe) }), /safe relative audio path/);
  await assert.rejects(() => createPageSoundController({ fetchImpl: async () => jsonResponse({ schemaVersion: 1, sounds: [] }) }), /exactly five/);
});

test('library persistence stores favorites and review history without duplicating items', () => {
  const storage = memoryStorage();
  const library = persistLibrary({ storage, storageKey: 'library-test' });
  library.add({ id: 'paper-a', title: 'Paper A', source: 'arXiv', published: '2026-07-30' });
  library.add({ id: 'paper-a', title: 'Paper A revised' });
  assert.equal(library.list().length, 1);
  assert.equal(library.get('paper-a').title, 'Paper A revised');
  assert.equal(library.markReviewed('paper-a').reviewCount, 1);

  const reloaded = persistLibrary({ storage, storageKey: 'library-test' });
  assert.equal(reloaded.get('paper-a').reviewCount, 1);
  assert.equal(reloaded.toggle('paper-a'), false);
  assert.equal(reloaded.has('paper-a'), false);
});
