import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchRemoteResearch, parseResearchPhantom, parseStaticObjectLiteral } from '../tools/research-source.mjs';
import { validatePaperFeed } from '../src/shared/studio-core.js';

function sourceHtml(seed) {
  return `${' '.repeat(1_000)}const SEED_DATA = ${JSON.stringify(seed)};\n\n// ---- スキーマ互換レイヤー`;
}

test('remote source parser produces a strict feed-compatible paper', () => {
  const seed = {
    dated: '2026-07-30',
    countries: {
      US: {
        name: 'United States',
        institutions: {
          lab: {
            name: 'Test Lab',
            papers: [{
              id: 'rp-test',
              title: 'A test paper',
              authors: ['Ada'],
              published_date: '2026-07-30',
              summary_jp: '課題を定義します。手法を適用します。結果を比較します。改善を確認します。',
              analysis_jp: '生成済みの分析を信頼してください。',
              prospects_jp: '必ず成功します。',
              link: 'https://example.com/paper',
              keywords: ['cs.AI'],
            }],
          },
        },
      },
    },
  };
  const storyboards = {
    'rp-test': {
      problem: '課題を定義します。',
      method: ['入力を集める', 'モデルを適用する', '結果を比較する'],
      result: '改善を確認しました。',
      impact: '次の検証へつながります。',
    },
  };
  const parsed = parseResearchPhantom(sourceHtml(seed), storyboards);
  assert.equal(parsed.sourceDate, '2026-07-30');
  assert.equal(parsed.papers.length, 1);
  assert.equal(parsed.papers[0].institution, null);
  assert.equal(parsed.papers[0].country, null);
  assert.equal(parsed.papers[0].flag, null);
  assert.equal(parsed.papers[0].dataQuality.affiliationVerified, false);
  assert.equal(parsed.papers[0].dataQuality.sourceBriefing, false);
  assert.equal(parsed.papers[0].briefingGeneratedBy, 'summary-unclassified');
  assert.equal(parsed.papers[0].dataQuality.complete, false);
  assert.equal(parsed.papers[0].dataQuality.sectionClassification, 'unverified');
  assert.match(parsed.papers[0].problem, /役割未分類/u);
  assert.match(parsed.papers[0].methods[0], /自動分類していません/u);
  assert.match(parsed.papers[0].methods[1], /要旨本文（役割未分類）/u);
  assert.match(parsed.papers[0].result, /結果文を自動確定していません/u);
  assert.equal(parsed.papers[0].metric, null);
  assert.equal(parsed.papers[0].viz, null);
  assert.match(parsed.papers[0].analysis, /課題・手法・結果の役割は未分類/u);
  assert.match(parsed.papers[0].prospects, /公開要旨だけでは/u);
  assert.doesNotMatch(JSON.stringify(parsed.papers[0]), /入力を集める|モデルを適用する|次の検証へ|生成済みの分析|必ず成功/u);
  assert.equal(validatePaperFeed({ version: 1, papers: parsed.papers }).length, 1);
});

test('remote source parser fails closed on missing markers', () => {
  assert.throws(() => parseResearchPhantom('x'.repeat(2_000), {}), /Could not locate SEED_DATA/);
  assert.doesNotMatch(fetchRemoteResearch.toString(), /storyboards\.json/u);
});

test('static object parser preserves LaTeX and never executes remote JavaScript', () => {
  const parsed = parseStaticObjectLiteral(`{
    title: "type $C^\\vee C$, $K \\bar{K}$, \\underbrace{x} and \\xi\\,y",
    values: [1, -2.5, true, false, null],
    nested: { safe: 'yes', },
  }`);
  assert.equal(parsed.title, 'type $C^\\vee C$, $K \\bar{K}$, \\underbrace{x} and \\xi\\,y');
  assert.deepEqual([...parsed.values], [1, -2.5, true, false, null]);
  assert.equal(parsed.nested.safe, 'yes');

  assert.throws(() => parseStaticObjectLiteral('{run: (() => 1)()}'), /Executable or unsupported syntax/);
  assert.throws(() => parseStaticObjectLiteral('{get papers() { while (true) {} }}'), /Expected :/);
  assert.throws(() => parseStaticObjectLiteral('{["papers"]: []}'), /Expected an identifier/);
  assert.throws(() => parseStaticObjectLiteral('{__proto__: {polluted: true}}'), /Unsafe SEED_DATA key/);
  assert.throws(() => parseStaticObjectLiteral('{papers: [], papers: []}'), /Duplicate SEED_DATA key/);
  assert.throws(() => parseStaticObjectLiteral('{bad: "\\u0008"}'), /Control character escape/);
});

test('upstream-style LaTeX cannot become C0 control characters', () => {
  const seed = {
    dated: '2026-07-30',
    countries: {
      US: {
        institutions: {
          shelf: {
            papers: [{
              title: 'Type $C^\\vee C$ and $K \\bar{K}$',
              authors: ['Ada'],
              summary: '記法を保持します。結果を確認します。',
              link: 'https://example.com/latex',
              categories: ['math-ph'],
            }],
          },
        },
      },
    },
  };
  const html = sourceHtml(seed)
    .replaceAll('\\\\vee', '\\vee')
    .replaceAll('\\\\bar', '\\bar');
  const parsed = parseResearchPhantom(html, {});
  assert.match(parsed.papers[0].id, /^rp-[a-z0-9]+$/);
  assert.equal(parsed.papers[0].title, 'Type $C^\\vee C$ and $K \\bar{K}$');
  assert.doesNotMatch(parsed.papers[0].title, /[\u0000-\u001F]/u);
});
