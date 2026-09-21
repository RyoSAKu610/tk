const chapterTemplates = [
  { key: 'question', label: 'QUESTION', title: '何を確かめたのか？' },
  { key: 'input', label: 'INPUT', title: '何を材料にしたのか？' },
  { key: 'process', label: 'PROCESS', title: 'どう比較したのか？' },
  { key: 'observation', label: 'OBSERVATION', title: '何が観測されたのか？' },
  { key: 'result', label: 'RESULT', title: '結果として何が述べられたか？' },
  { key: 'meaning', label: 'MEANING', title: '私たちに何を変えるのか？' },
];

function clean(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function hashString(input) {
  let hash = 2166136261;
  for (const char of String(input)) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function hashUnit(seed, index) {
  let value = (seed + Math.imul(index + 1, 0x9e3779b1)) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  value ^= value >>> 16;
  return (value >>> 0) / 4294967295;
}

function authorsOf(paper) {
  const authors = Array.isArray(paper.authors) ? paper.authors.filter(Boolean) : [];
  return authors.length ? authors.join(', ') : clean(paper.source, '研究チーム');
}

function scalar(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'string' && value.trim()) return value.trim();
  return null;
}

export function evidenceFromPaper(paper) {
  const metric = paper?.metric ?? null;
  const viz = paper?.viz ?? null;
  if (metric === null && viz === null) {
    return Object.freeze({
      hasStructuredMetric: false,
      resultType: '定性的',
      metricValue: '原文確認',
      sampleValue: '記載なし',
      interpretationValue: '原文確認',
      rawMetric: null,
      rawViz: null,
    });
  }

  const metricObject = metric && typeof metric === 'object' && !Array.isArray(metric) ? metric : {};
  const rawValue = scalar(metricObject.display ?? metricObject.value ?? metric);
  const unit = scalar(metricObject.unit);
  const metricValue = rawValue ? `${rawValue}${unit ? ` ${unit}` : ''}` : '構造化値あり';
  const sampleValue = scalar(metricObject.sampleSize ?? metricObject.n) ?? '原文確認';
  const interpretationValue = scalar(metricObject.direction ?? metricObject.interpretation) ?? '原文確認';
  return Object.freeze({
    hasStructuredMetric: true,
    resultType: '数値あり',
    metricValue,
    sampleValue,
    interpretationValue,
    rawMetric: metric,
    rawViz: viz,
  });
}

export function buildMotionModel(paper) {
  const seed = hashString(`${paper.id}|${paper.title}|${paper.result}`);
  const schematicPoints = Array.from({ length: 12 }, (_, index) => {
    const t = index / 11;
    return {
      t,
      primary: 34 + t * 28 + Math.sin(t * Math.PI * 1.4 + hashUnit(seed, 2) * 2) * 4,
      comparison: 37 + t * 10 + Math.sin(t * Math.PI * 1.2 + hashUnit(seed, 3)) * 3,
    };
  });
  const methods = Array.isArray(paper.methods) && paper.methods.length
    ? paper.methods.slice(0, 4)
    : ['対象データを収集', '条件を整理', '比較の観点を設定', '結果の記述を確認'];
  const summary = clean(paper.summary, 'この研究が扱う現象を、観測可能な問いへ変換します。');
  const problem = clean(paper.problem, summary);
  const result = clean(paper.result, summary);
  const impact = clean(paper.impact, '観測結果を次の研究や実践の判断材料へつなげます。');
  const evidence = evidenceFromPaper(paper);
  const sectionClassification = paper?.dataQuality?.sectionClassification ?? 'unspecified';
  const sectionsUnverified = sectionClassification === 'unverified';
  const chapters = sectionsUnverified
    ? [
        { ...chapterTemplates[0], title: '公開要旨には何が書かれている？', body: summary },
        { ...chapterTemplates[1], title: '要旨を役割分けせず読む', body: '自動同期版は、文の位置だけで課題・入力・手法・結果を決めません。' },
        { ...chapterTemplates[2], title: '手法は原文で確認', body: '公開要旨から手法を自動確定していません。原論文のMethodsを確認してください。' },
        { ...chapterTemplates[3], title: '模式図として整理', body: `線の形や位置は理解を助ける模式図で、実測値ではありません。要旨本文：${summary}` },
        { ...chapterTemplates[4], title: '結果は原文で確認', body: result },
        { ...chapterTemplates[5], title: '未確認事項を分けて残す', body: impact },
      ]
    : [
        { ...chapterTemplates[0], body: problem },
        { ...chapterTemplates[1], body: `${authorsOf(paper)}らは、「${methods[0]}」を起点として検証材料を整えました。` },
        { ...chapterTemplates[2], body: methods.map((method, index) => `${index + 1}. ${method}`).join('　') },
        { ...chapterTemplates[3], body: `要旨の観測内容を整理します。模式線は理解を助けるためのもので、実測値ではありません。${summary}` },
        { ...chapterTemplates[4], body: result },
        { ...chapterTemplates[5], body: impact },
      ];
  return Object.freeze({
    seed,
    schematic: true,
    schematicPoints: Object.freeze(schematicPoints.map(Object.freeze)),
    methods: Object.freeze([...methods]),
    chapters: Object.freeze(chapters.map(Object.freeze)),
    result,
    impact,
    evidence,
    sectionClassification,
  });
}
