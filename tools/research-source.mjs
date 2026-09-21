const MAX_LITERAL_DEPTH = 80;
const MAX_LITERAL_NODES = 250_000;
const MAX_LITERAL_STRING_LENGTH = 2_000_000;
const unsafeObjectKeys = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Parse the data-only subset used by ResearchPhantom's SEED_DATA declaration.
 *
 * This deliberately is not a JavaScript evaluator. It accepts object/array
 * literals, quoted strings, finite numbers, booleans and null; functions,
 * accessors, computed keys, template strings and arbitrary expressions fail
 * closed. Backslash-letter sequences are kept literally so LaTeX such as
 * `\bar` and `\vee` cannot turn into C0 control characters.
 */
export function parseStaticObjectLiteral(source) {
  if (typeof source !== 'string' || source.length === 0 || source.length > 10_000_000) {
    throw new Error('SEED_DATA literal size is invalid');
  }

  let index = 0;
  let nodes = 0;

  const fail = (message) => {
    const excerpt = source.slice(Math.max(0, index - 18), Math.min(source.length, index + 24)).replace(/\s+/g, ' ');
    throw new Error(`${message} at offset ${index}${excerpt ? ` near ${JSON.stringify(excerpt)}` : ''}`);
  };

  const countNode = (depth) => {
    nodes += 1;
    if (nodes > MAX_LITERAL_NODES) fail('SEED_DATA contains too many values');
    if (depth > MAX_LITERAL_DEPTH) fail('SEED_DATA nesting is too deep');
  };

  const skipSpaceAndComments = () => {
    while (index < source.length) {
      if (/\s/u.test(source[index])) {
        index += 1;
        continue;
      }
      if (source.startsWith('//', index)) {
        const end = source.indexOf('\n', index + 2);
        index = end < 0 ? source.length : end + 1;
        continue;
      }
      if (source.startsWith('/*', index)) {
        const end = source.indexOf('*/', index + 2);
        if (end < 0) fail('Unterminated SEED_DATA comment');
        index = end + 2;
        continue;
      }
      break;
    }
  };

  const parseString = () => {
    const quote = source[index];
    if (quote !== '"' && quote !== "'") fail('Expected a quoted string');
    index += 1;
    let value = '';
    while (index < source.length) {
      const char = source[index];
      index += 1;
      if (char === quote) return value;
      if (char === '\n' || char === '\r') fail('Unescaped newline in SEED_DATA string');
      if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(char)) fail('Control character is not allowed in SEED_DATA string');
      if (char !== '\\') {
        value += char;
      } else {
        if (index >= source.length) fail('Unterminated SEED_DATA escape');
        const escape = source[index];
        index += 1;
        if (escape === quote || escape === '\\' || escape === '/') {
          value += escape;
        } else if (escape === 'u' || escape === 'x') {
          const digits = escape === 'u' ? 4 : 2;
          const encoded = source.slice(index, index + digits);
          if (new RegExp(`^[0-9a-fA-F]{${digits}}$`).test(encoded)) {
            const codePoint = Number.parseInt(encoded, 16);
            if (codePoint <= 0x1f || codePoint === 0x7f) fail('Control character escape is not allowed');
            value += String.fromCodePoint(codePoint);
            index += digits;
          } else {
            // `\underbrace` and `\xi` are valid LaTeX commands, not broken
            // JavaScript Unicode/hex escapes. Keep them verbatim.
            value += `\\${escape}`;
          }
        } else if (!/[0-9]/.test(escape) && !/[\u0000-\u001F\u007F]/u.test(escape)) {
          // Scientific titles arrive as JavaScript source and frequently use
          // a single slash for LaTeX (for example \bar, \vee and \,).
          // Preserve the notation rather than applying JavaScript escape
          // semantics or silently discarding an unknown escape slash.
          value += `\\${escape}`;
        } else {
          fail(`Unsupported SEED_DATA escape \\${escape}`);
        }
      }
      if (value.length > MAX_LITERAL_STRING_LENGTH) fail('SEED_DATA string is too long');
    }
    fail('Unterminated SEED_DATA string');
  };

  const parseIdentifier = () => {
    const match = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(source.slice(index));
    if (!match) fail('Expected an identifier');
    index += match[0].length;
    return match[0];
  };

  const parseNumber = () => {
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(source.slice(index));
    if (!match) fail('Invalid number literal');
    index += match[0].length;
    const value = Number(match[0]);
    if (!Number.isFinite(value)) fail('Non-finite numbers are not allowed');
    return value;
  };

  const parseValue = (depth = 0) => {
    skipSpaceAndComments();
    countNode(depth);
    const char = source[index];
    if (char === '{') return parseObject(depth + 1);
    if (char === '[') return parseArray(depth + 1);
    if (char === '"' || char === "'") return parseString();
    if (char === '-' || /\d/.test(char ?? '')) return parseNumber();
    if (source.startsWith('true', index) && !/[A-Za-z0-9_$]/.test(source[index + 4] ?? '')) {
      index += 4;
      return true;
    }
    if (source.startsWith('false', index) && !/[A-Za-z0-9_$]/.test(source[index + 5] ?? '')) {
      index += 5;
      return false;
    }
    if (source.startsWith('null', index) && !/[A-Za-z0-9_$]/.test(source[index + 4] ?? '')) {
      index += 4;
      return null;
    }
    fail('Executable or unsupported syntax in SEED_DATA');
  };

  const parseObject = (depth) => {
    index += 1;
    const object = Object.create(null);
    const seen = new Set();
    skipSpaceAndComments();
    if (source[index] === '}') {
      index += 1;
      return object;
    }
    while (index < source.length) {
      skipSpaceAndComments();
      const key = source[index] === '"' || source[index] === "'" ? parseString() : parseIdentifier();
      if (unsafeObjectKeys.has(key)) fail(`Unsafe SEED_DATA key ${key}`);
      if (seen.has(key)) fail(`Duplicate SEED_DATA key ${key}`);
      seen.add(key);
      skipSpaceAndComments();
      if (source[index] !== ':') fail('Expected : after SEED_DATA object key');
      index += 1;
      object[key] = parseValue(depth);
      skipSpaceAndComments();
      if (source[index] === '}') {
        index += 1;
        return object;
      }
      if (source[index] !== ',') fail('Expected , or } in SEED_DATA object');
      index += 1;
      skipSpaceAndComments();
      if (source[index] === '}') {
        index += 1;
        return object;
      }
    }
    fail('Unterminated SEED_DATA object');
  };

  const parseArray = (depth) => {
    index += 1;
    const array = [];
    skipSpaceAndComments();
    if (source[index] === ']') {
      index += 1;
      return array;
    }
    while (index < source.length) {
      array.push(parseValue(depth));
      skipSpaceAndComments();
      if (source[index] === ']') {
        index += 1;
        return array;
      }
      if (source[index] !== ',') fail('Expected , or ] in SEED_DATA array');
      index += 1;
      skipSpaceAndComments();
      if (source[index] === ']') {
        index += 1;
        return array;
      }
    }
    fail('Unterminated SEED_DATA array');
  };

  const result = parseValue(0);
  skipSpaceAndComments();
  if (index !== source.length) fail('Trailing syntax after SEED_DATA literal');
  if (!result || typeof result !== 'object' || Array.isArray(result)) fail('SEED_DATA root must be an object');
  return result;
}

function stableId(paper) {
  if (paper.id) return String(paper.id);
  // Keep compatibility with ids produced by the former JavaScript evaluator.
  // Content stays lossless, while only the hash input mirrors legacy string
  // escape semantics so existing bookmarks/localStorage do not break.
  const legacyEscapes = { b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v', 0: '\0' };
  const legacyTitle = String(paper.title || '').replace(/\\(.)/gs, (_match, escape) => legacyEscapes[escape] ?? escape);
  const source = `${paper.link || paper.doi || ''}|${legacyTitle}`;
  let hash = 2_166_136_261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return `rp-${(hash >>> 0).toString(36)}`;
}

function sentences(value) {
  return String(value ?? '').match(/[^。！？]+[。！？]?/g)?.map((sentence) => sentence.trim()).filter(Boolean) ?? [];
}

function displayText(value) {
  return String(value ?? '').replace(/[\u200B-\u200D\u2060\uFEFF]/gu, '').replace(/\s+/gu, ' ').trim();
}

const VERIFIED_BRIEFINGS = Object.freeze({
  // Manually checked against the source abstract on 2026-08-02.  Keep this
  // small and explicit: the daily job must never promote sentence position or
  // upstream generated commentary into a verified Methods/Results claim.
  'rp-uk37f0': Object.freeze({
    problem: '永続エントロピーは永続図のコンパクトな概要を提供しますが、データに固有の幾何学的情報は破棄されます。',
    methods: Object.freeze([
      'この制限により、計算効率は高いが幾何学的に粗いスカラー要約と、表現力はあるが高次元で計算量が多い方向性トポロジー変換との間にギャップが生じます。',
      'この研究では、方向性トポロジ変換のエントロピーベースの圧縮として解釈できる新しい方向性トポロジ記述子である Persistent Entropy Transform (PET) を導入します。',
      'PETの基本的な理論的特性を確立します。',
    ]),
    result: '特に、平行移動不変性、正の一様スケーリングの下でのスケール不変性、および直交等変性を証明します。',
    analysis: '報告結果、要旨の解釈、今後の検証を区別して並べます。因果関係を要旨以上に追加しません。',
    prospects: '公開要旨だけでは今後の検証条件を特定できません。原論文のLimitationsまたはFuture Workを確認してください。',
    verifiedAt: '2026-08-02',
  }),
});

function unclassifiedMethods(summary) {
  return [
    '公開要旨の文を、位置だけで「手法」と自動分類していません。',
    `要旨本文（役割未分類）：${summary}`,
    '具体的な手順・条件は、原論文のMethodsを確認してください。',
  ];
}

function unclassifiedAnalysis(summary) {
  return `要旨本文（課題・手法・結果の役割は未分類）：${summary}`;
}

function unclassifiedResult() {
  return '公開要旨から結果文を自動確定していません。原論文のResultsまたはConclusionを確認してください。';
}

function unknownProspects() {
  return '公開要旨だけでは今後の検証条件を特定できません。原論文のLimitationsまたはFuture Workを確認してください。';
}

export function parseResearchPhantom(html) {
  if (typeof html !== 'string' || html.length < 1_000 || html.length > 20_000_000) throw new Error('Remote index.html size is invalid');
  const startToken = 'const SEED_DATA = ';
  const endToken = '\n\n// ---- スキーマ互換レイヤー';
  const start = html.indexOf(startToken);
  const end = html.indexOf(endToken, start);
  if (start < 0 || end < 0) throw new Error('Could not locate SEED_DATA in remote ResearchPhantom/index.html');
  const objectSource = html.slice(start + startToken.length, end).trim().replace(/;$/, '');
  if (objectSource.length > 10_000_000) throw new Error('Remote SEED_DATA exceeds the safety limit');
  const seed = parseStaticObjectLiteral(objectSource);
  const papers = [];
  for (const [countryCode, country] of Object.entries(seed.countries || {})) {
    for (const institution of Object.values(country.institutions || {})) {
      for (const paper of institution.papers || []) {
        const id = stableId(paper);
        const summary = displayText(paper.summary_jp || paper.summary || '研究概要は原論文で確認してください。');
        const verified = VERIFIED_BRIEFINGS[id] ?? null;
        const analysis = verified?.analysis ?? unclassifiedAnalysis(summary);
        const prospects = verified?.prospects ?? unknownProspects();
        const link = String(paper.doi || paper.link || `https://scholar.google.com/scholar?q=${encodeURIComponent(paper.title || '')}`).replace(/^http:/, 'https:');
        papers.push({
          id,
          title: paper.title,
          authors: (paper.authors || []).map((author) => typeof author === 'string' ? author : author.name).filter(Boolean),
          // The upstream archive groups papers under display shelves whose
          // country/institution labels are not verified author affiliations.
          // Do not publish those labels as bibliographic facts.
          institution: null,
          countryCode: null,
          country: null,
          flag: null,
          published: paper.published_date || paper.published || '',
          source: paper.conference || paper.paper_type || paper.source || 'arXiv',
          link,
          categories: paper.keywords || paper.categories || [],
          summary,
          analysis,
          prospects,
          problem: verified?.problem ?? `公開要旨（役割未分類）：${summary}`,
          methods: verified?.methods ? [...verified.methods] : unclassifiedMethods(summary),
          result: verified?.result ?? unclassifiedResult(),
          metric: null,
          impact: prospects,
          viz: null,
          briefingGeneratedBy: verified ? 'manual-abstract-review' : 'summary-unclassified',
          dataQuality: {
            complete: Boolean(verified),
            mode: verified ? 'manual-abstract-review' : 'summary-unclassified',
            sourceSummary: Boolean(paper.summary_jp || paper.summary),
            sourceBriefing: false,
            sectionClassification: verified ? 'verified' : 'unverified',
            verifiedAt: verified?.verifiedAt ?? null,
            affiliationVerified: false,
          },
        });
      }
    }
  }
  return { papers, sourceDate: String(seed.dated || 'unknown') };
}

export async function fetchRemoteResearch(options = {}) {
  const base = String(options.baseUrl ?? process.env.RESEARCH_SOURCE_BASE ?? 'https://howly23v.github.io/ResearchPhantom').replace(/\/$/, '');
  const timeoutMs = Math.max(1_000, Number(options.timeoutMs ?? process.env.RESEARCH_SYNC_TIMEOUT_MS ?? 20_000));
  const headers = { accept: 'text/html,application/json', 'user-agent': 'ResearchPhantom-Studio-Sync/1.0', 'cache-control': 'no-cache' };
  const signal = AbortSignal.timeout(timeoutMs);
  const htmlResponse = await fetch(`${base}/index.html`, { headers, signal });
  if (!htmlResponse.ok) throw new Error(`Remote index request failed: HTTP ${htmlResponse.status}`);
  const length = Number(htmlResponse.headers.get('content-length') ?? 0);
  if (length && length > 20_000_000) throw new Error('Remote index exceeds the 20 MB limit');
  const html = await htmlResponse.text();
  return parseResearchPhantom(html);
}
