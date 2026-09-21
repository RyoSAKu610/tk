import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMotionModel, evidenceFromPaper } from './motion-model.js';

const paper = {
  id: 'paper-1',
  title: 'A qualitative result',
  authors: ['Researcher'],
  source: 'Archive',
  summary: '要旨のまとめです。',
  problem: '問いです。',
  methods: ['データを集める', '比較する'],
  result: '定性的な結果です。',
  impact: '次の研究につながります。',
  metric: null,
  viz: null,
};

test('metricが無い論文にnや割合を生成しない', () => {
  const evidence = evidenceFromPaper(paper);
  const model = buildMotionModel(paper);
  assert.equal(evidence.hasStructuredMetric, false);
  assert.equal(evidence.resultType, '定性的');
  assert.equal(evidence.sampleValue, '記載なし');
  const serialized = JSON.stringify(model);
  assert.doesNotMatch(serialized, /"effect"|"confidence"|"samples"/);
  assert.doesNotMatch(serialized, /n=|\+\d+%|−\d+%/);
  assert.equal(model.schematic, true);
});

test('feedに明示されたmetricだけを表示候補にする', () => {
  const evidence = evidenceFromPaper({ ...paper, metric: { value: 12, unit: 'ms', sampleSize: 48 } });
  assert.equal(evidence.hasStructuredMetric, true);
  assert.equal(evidence.metricValue, '12 ms');
  assert.equal(evidence.sampleValue, '48');
});

test('未分類の公開要旨を手法や結果として断定しない', () => {
  const model = buildMotionModel({
    ...paper,
    summary: '背景です。方法か結果か未分類の記述です。',
    methods: ['位置だけで抽出された文です。'],
    result: '公開要旨から結果文を自動確定していません。',
    dataQuality: { sectionClassification: 'unverified' },
  });
  assert.equal(model.sectionClassification, 'unverified');
  assert.equal(model.chapters[2].title, '手法は原文で確認');
  assert.equal(model.chapters[4].title, '結果は原文で確認');
  assert.doesNotMatch(model.chapters[1].body, /Researcherらは/u);
  assert.doesNotMatch(model.chapters[2].body, /位置だけで抽出/u);
});
