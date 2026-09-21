const MAX_TARGET_LENGTH = 120;
const MAX_DESCRIPTION_LENGTH = 1_000;

const RAW_OCCUPATIONS = [
  {
    id: 'researcher', name: '調査研究員', role: '未知を小さな問いへ分解し、証拠を集める',
    personality: '好奇心が強く、分からないことを分からないまま記録できる',
    equipment: ['観測ノート', '標本ケース', '仮説ピン'], specialMove: '仮説分解プロトコル', motif: ['索引札', '観測線'],
    keywords: ['研究', '論文', 'research', 'paper', 'science', '実験', 'hypothesis'],
  },
  {
    id: 'analyst', name: 'データ分析官', role: 'ばらばらな記録から比較できる傾向を見つける',
    personality: '冷静で、派手な結論より比較条件を大切にする',
    equipment: ['比較スコープ', '指標カード', '誤差メーター'], specialMove: '差分可視化スキャン', motif: ['方眼', '折れ線'],
    keywords: ['データ', '分析', '統計', 'analytics', 'data', 'metric', '比較', '予測'],
  },
  {
    id: 'engineer', name: 'システム技師', role: '入力を動力へ変え、仕組みを安定して動かす',
    personality: '実直で、壊れる条件から先に確認する',
    equipment: ['変換レンチ', '負荷ゲージ', '予備回路'], specialMove: '安定稼働オーバードライブ', motif: ['回路', '歯車'],
    keywords: ['engine', 'system', '電力', 'エネルギー', '発電', 'システム', 'mitochond', 'ミトコンドリア', '電池', 'battery'],
  },
  {
    id: 'architect', name: '設計建築士', role: '複雑な要素を、壊れにくい構造へ組み上げる',
    personality: '全体像を見ながら、土台の小さなずれも見逃さない',
    equipment: ['構造定規', '設計図', '耐久コンパス'], specialMove: '構造再配置ビルド', motif: ['青写真', '骨組み'],
    keywords: ['architecture', '設計', '建築', '構造', 'framework', '基盤', 'platform'],
  },
  {
    id: 'detective', name: '痕跡探偵', role: '見えにくい手掛かりを追い、原因候補を絞り込む',
    personality: '粘り強く、最初の印象だけでは犯人を決めない',
    equipment: ['痕跡レンズ', '照合台帳', '推理糸'], specialMove: '反証ルート追跡', motif: ['足跡', '虫眼鏡'],
    keywords: ['検索', 'search', '検出', 'detect', '原因', '追跡', 'trace', '診断'],
  },
  {
    id: 'doctor', name: '診断医', role: '状態を観察し、負担を抑えながら回復経路を選ぶ',
    personality: '慎重で、相手の状態を聞いてから処置する',
    equipment: ['診断スコープ', '状態カルテ', '回復キット'], specialMove: '多段診断トリアージ', motif: ['脈動線', '処方箋'],
    keywords: ['医療', 'medicine', 'health', '病気', '治療', '細胞', 'cell', '遺伝子', 'gene', '脳', 'brain'],
  },
  {
    id: 'teacher', name: '理解教師', role: '難しい仕組みを、順序のある例へ言い換える',
    personality: '辛抱強く、分かったふりより質問を歓迎する',
    equipment: ['例示ボード', '段階チョーク', '理解ベル'], specialMove: '七段階レッスン', motif: ['黒板線', '付箋'],
    keywords: ['教育', '学習', 'teach', 'learn', '説明', 'tutorial', '講義', '教材'],
  },
  {
    id: 'librarian', name: '知識司書', role: '情報を分類し、必要な時に取り出せる棚へ収める',
    personality: '几帳面で、出典と未確認事項を分けて扱う',
    equipment: ['分類カード', '索引ランタン', '書架キー'], specialMove: '知識索引リコール', motif: ['背表紙', '栞'],
    keywords: ['knowledge', '知識', '文書', 'document', 'library', 'archive', 'memory', '記憶', 'database', 'データベース', 'researchphantom'],
  },
  {
    id: 'cartographer', name: '関係地図師', role: '位置とつながりを、一目で辿れる地図へ変える',
    personality: '見通しがよく、現在地と目的地を同時に考える',
    equipment: ['関係コンパス', '層別地図', '経路インク'], specialMove: '全景マッピング', motif: ['等高線', '方位記号'],
    keywords: ['map', '地図', '位置', 'location', '空間', 'spatial', '経路', 'route', 'navigation'],
  },
  {
    id: 'interpreter', name: '言語通訳官', role: '受け取った表現を読み、文脈に合う言葉へ組み替える',
    personality: '話好きだが、曖昧な依頼には確認を挟む慎重さを持つ',
    equipment: ['文脈イヤホン', '語彙デッキ', '意味プリズム'], specialMove: 'コンテキスト・リフレーム', motif: ['吹き出し', '言語トークン'],
    keywords: ['llm', '言語モデル', '生成ai', 'gpt', '翻訳', 'translate', 'language', '文章', 'チャット', '会話'],
  },
  {
    id: 'courier', name: '情報配達員', role: '荷物や信号を、宛先を確かめて次へ届ける',
    personality: '機敏で、順路と受取確認を欠かさない',
    equipment: ['宛先タグ', '中継バッグ', '到着スタンプ'], specialMove: '最短中継ダッシュ', motif: ['矢印', '封印タグ'],
    keywords: ['配送', 'delivery', '送信', 'transfer', 'message', 'メッセージ', 'packet', 'パケット', '物流'],
  },
  {
    id: 'guard', name: '境界守衛', role: '通してよいものを確かめ、危険な侵入を止める',
    personality: '責任感が強く、便利さと安全の釣り合いを考える',
    equipment: ['認証シールド', '境界ゲート', '警戒灯'], specialMove: 'ゼロトラスト封鎖', motif: ['盾', '境界線'],
    keywords: ['security', '安全', '認証', 'authentication', '暗号', 'encrypt', '防御', 'protect', 'privacy', 'クレジットカード'],
  },
  {
    id: 'firefighter', name: '緊急消防士', role: '異常を素早く見つけ、広がる前に影響を抑える',
    personality: '勇敢だが無謀ではなく、退路を確保して動く',
    equipment: ['異常センサー', '遮断ホース', '退避ビーコン'], specialMove: '連鎖障害ファイアブレイク', motif: ['警告灯', '遮断帯'],
    keywords: ['火災', 'fire', '緊急', 'emergency', '障害', 'incident', '災害', '危機'],
  },
  {
    id: 'chef', name: '情報調理師', role: '材料の性質を見極め、順番と加減で一つの成果へまとめる',
    personality: '段取り上手で、素材の違いを楽しむ',
    equipment: ['配合ボウル', '工程タイマー', '品質スプーン'], specialMove: '多素材フュージョン', motif: ['湯気', 'レシピ線'],
    keywords: ['料理', 'cook', 'food', '食品', 'レシピ', 'recipe', '混合', 'blend', '合成'],
  },
  {
    id: 'gardener', name: '環境庭師', role: '成長条件を整え、変化を急がせずに育てる',
    personality: '穏やかで、短期の見栄えより長期の循環を好む',
    equipment: ['成長じょうろ', '環境センサー', '剪定ばさみ'], specialMove: '生態バランス再生', motif: ['葉脈', '年輪'],
    keywords: ['環境', 'environment', '生態', 'ecology', '植物', 'plant', '気候', 'climate', '成長', '農業'],
  },
  {
    id: 'mechanic', name: '機構修理工', role: '不調な箇所を切り分け、動く状態へ戻す',
    personality: '手堅く、まず再現してから工具を入れる',
    equipment: ['診断レンチ', '部品トレイ', '再起動キー'], specialMove: '故障点リビルド', motif: ['ボルト', '分解図'],
    keywords: ['修理', 'repair', '保守', 'maintenance', '機械', 'machine', '故障', 'debug', 'デバッグ'],
  },
  {
    id: 'conductor', name: '通信指揮者', role: '複数の流れを衝突させず、適切な順番で中継する',
    personality: '周囲をよく聞き、全員のタイミングを揃える',
    equipment: ['帯域タクト', '中継譜面', '混雑メトロノーム'], specialMove: 'マルチチャネル・コンダクト', motif: ['電波', '五線'],
    keywords: ['wi-fi', 'wifi', 'ルーター', 'router', '通信', 'network', 'ネットワーク', 'radio', '無線', 'orchestration'],
  },
  {
    id: 'negotiator', name: '条件交渉人', role: '異なる要求の間に、双方が確認できる合意点を作る',
    personality: '柔軟で、勝ち負けより持続する条件を探す',
    equipment: ['条件カード', '合意シール', '対話テーブル'], specialMove: 'ウィンウィン再定義', motif: ['握手線', '対話円'],
    keywords: ['交渉', 'negotiate', '契約', 'contract', '合意', 'agreement', '取引', 'trade', '市場'],
  },
  {
    id: 'explorer', name: '未知探索家', role: 'まだ地図のない領域へ進み、帰還できる道標を残す',
    personality: '大胆で、発見と同じくらい撤退条件を大切にする',
    equipment: ['探索コンパス', '帰還ロープ', '発見フラッグ'], specialMove: '未踏領域ダイブ', motif: ['羅針盤', '軌跡'],
    keywords: ['探索', 'explore', '宇宙', 'space', '未知', 'unknown', '発見', 'discovery', '冒険'],
  },
  {
    id: 'artisan', name: '変形道具職人', role: '用途と形を結び、必要な時だけ働く道具へ仕立てる',
    personality: '工夫好きで、使わない時の収まりまで設計する',
    equipment: ['変形ヒンジ', '素材ハンマー', '携帯ケース'], specialMove: 'フォームチェンジ展開', motif: ['折り目', '工具跡'],
    keywords: ['折り畳み傘', '折りたたみ傘', 'umbrella', '道具', 'tool', '素材', 'material', '変形', 'fold', '製品', 'product'],
  },
  {
    id: 'accountant', name: '取引監査官', role: '価値の移動を記録し、条件と残高を照合する',
    personality: '正確で、数字の出所と承認手順に厳しい',
    equipment: ['取引台帳', '承認スタンプ', '残高そろばん'], specialMove: '二重照合オーディット', motif: ['台帳線', '認証印'],
    keywords: ['会計', 'account', '決済', 'payment', '金融', 'finance', 'クレジット', 'credit', '残高', '取引'],
  },
];

export const BASE_OCCUPATIONS = Object.freeze(RAW_OCCUPATIONS.map((occupation) => Object.freeze({
  ...occupation,
  equipment: Object.freeze([...occupation.equipment]),
  motif: Object.freeze([...occupation.motif]),
  keywords: Object.freeze([...occupation.keywords]),
})));

export const FALLBACK_OCCUPATION = Object.freeze({
  id: 'unknown-investigator',
  name: '未知対象調査官',
  role: '情報が足りない対象を観察し、確かな特徴から職業を見つける',
  personality: '決めつけず、空欄を空欄のまま持ち運べる',
  equipment: Object.freeze(['未詳ラベル', '観察ルーペ', '質問カード']),
  specialMove: 'アンノウン・スキャン',
  motif: Object.freeze(['未記入カード', '点線']),
  keywords: Object.freeze([]),
});

const SIGNATURES = Object.freeze([
  Object.freeze({
    id: 'llm', match: /(?:^|\b)llms?(?:\b|$)|大規模言語モデル|言語モデル|生成ai|chatgpt|gpt(?:-|\b)/iu,
    occupationId: 'interpreter',
    functions: ['大量の言語パターンを手掛かりに、文脈へ続く表現を組み立てる', '質問や指示を受け取り、文章・案・変換結果として返す'],
    shapes: ['多数の層がつながるネットワーク', '言葉を細かな単位で扱う入力列'],
    strengths: ['幅広い文章作業を同じ対話窓口で扱える', '例や文脈を渡すと出力の方向を調整しやすい'],
    weaknesses: ['もっともらしい誤りを生成することがある', '学習時点や入力文脈にない事実を保証できない'],
    threats: ['曖昧な指示', '敵対的な入力', '根拠確認のない自動採用'],
  }),
  Object.freeze({
    id: 'wifi-router', match: /wi[\s-]?fi(?:ルーター| router)?|無線lan|wireless router|ルーター/iu,
    occupationId: 'conductor',
    functions: ['端末から届く通信を受け取り、宛先に応じて次の経路へ中継する', '複数端末が同じ回線を使えるよう通信の流れを整える'],
    shapes: ['電波が広がる中継拠点', '複数の入口と外部回線を結ぶ箱'],
    strengths: ['複数の端末を同じネットワークへ接続できる', '通信の行き先をまとめて管理できる'],
    weaknesses: ['距離や遮蔽物、混雑で通信品質が落ちる', '設定や更新が不十分だと安全性が下がる'],
    threats: ['電波干渉', '回線混雑', '不正アクセス'],
  }),
  Object.freeze({
    id: 'mitochondria', match: /ミトコンドリア|mitochond(?:ria|rion)/iu,
    occupationId: 'engineer',
    functions: ['細胞が利用できるエネルギーの生産を支える', '細胞内の代謝状態に応じて複数の反応へ関わる'],
    shapes: ['内膜が折り畳まれた小器官', '細胞の中に配置された動力区画'],
    strengths: ['生命活動を支えるエネルギー変換を担う', '細胞の状態と結びついた多面的な役割を持つ'],
    weaknesses: ['機能低下が細胞全体の活動へ影響しうる', '働きは細胞種や環境条件で異なる'],
    threats: ['酸化ストレス', '代謝の乱れ', '膜機能の損傷'],
  }),
  Object.freeze({
    id: 'credit-card', match: /クレジット(?:カード)?|credit card/iu,
    occupationId: 'accountant',
    functions: ['加盟店での支払い要求を、発行会社の承認手順へつなぐ', '利用記録を後日の請求と精算へ結びつける'],
    shapes: ['識別情報を持つ携帯用の決済媒体', '利用者・加盟店・決済網を結ぶ取引キー'],
    strengths: ['現金を直接受け渡さず決済できる', '取引記録と承認手順を利用できる'],
    weaknesses: ['使い過ぎや支払遅延の管理が必要', '認証情報が漏れると不正利用のリスクがある'],
    threats: ['フィッシング', '盗難', '不正利用'],
  }),
  Object.freeze({
    id: 'folding-umbrella', match: /折り[畳たたみ]+み?傘|folding umbrella/iu,
    occupationId: 'artisan',
    functions: ['必要な時に展開して雨や日差しを遮る', '使わない時は小さく畳んで携帯できる'],
    shapes: ['骨組みと膜が連動する開閉構造', '伸縮する軸と折り畳み関節'],
    strengths: ['携帯性と遮蔽機能を切り替えられる', '天候の変化へその場で対応できる'],
    weaknesses: ['強風で骨組みに大きな負荷がかかる', '濡れた後は乾燥と収納の手間が要る'],
    threats: ['突風', '関節の摩耗', '置き忘れ'],
  }),
  Object.freeze({
    id: 'research-paper', match: /researchphantom|研究論文|技術論文|scientific paper|research paper/iu,
    occupationId: 'librarian',
    functions: ['研究の問い・方法・結果を、検証できる記録として伝える', '先行研究と新しい知見の関係を読者へ案内する'],
    shapes: ['題名・要旨・方法・結果・参考文献が綴じられた記録', '主張と根拠を結ぶ引用のネットワーク'],
    strengths: ['手順と根拠を後から確認できる', '知識を共有し、別の研究から参照できる'],
    weaknesses: ['専門用語と前提知識が多く、入口が分かりにくい', '要旨だけでは条件や限界を十分に確認できない'],
    threats: ['文脈を外した要約', '未確認の断定', '引用元の取り違え'],
  }),
]);

const THEMES = Object.freeze([
  Object.freeze({ ink: '#1d4263', accent: '#d68d34', glow: '#f2c46e' }),
  Object.freeze({ ink: '#4d2a52', accent: '#b95545', glow: '#e7a777' }),
  Object.freeze({ ink: '#153f42', accent: '#3e8b7c', glow: '#83cfb3' }),
  Object.freeze({ ink: '#493c25', accent: '#9b7933', glow: '#e0bf67' }),
  Object.freeze({ ink: '#2d315f', accent: '#6867ae', glow: '#a9a8e2' }),
  Object.freeze({ ink: '#50312b', accent: '#b46543', glow: '#e7a06f' }),
]);

const STAGE_BLUEPRINTS = Object.freeze([
  Object.freeze({ id: 'mission', label: '任務', kicker: 'SCENE 01 · MISSION', effect: 'briefing', glyph: '◎' }),
  Object.freeze({ id: 'input', label: '入力', kicker: 'SCENE 02 · INPUT', effect: 'receive', glyph: 'IN' }),
  Object.freeze({ id: 'process', label: '処理', kicker: 'SCENE 03 · PROCESS', effect: 'working', glyph: '⚙' }),
  Object.freeze({ id: 'crisis', label: '危機', kicker: 'SCENE 04 · CRISIS', effect: 'alert', glyph: '!' }),
  Object.freeze({ id: 'verify', label: '検証', kicker: 'SCENE 05 · VERIFY', effect: 'scan', glyph: '✓' }),
  Object.freeze({ id: 'special', label: '必殺', kicker: 'SCENE 06 · SPECIAL', effect: 'burst', glyph: '✦' }),
  Object.freeze({ id: 'complete', label: '完了', kicker: 'SCENE 07 · COMPLETE', effect: 'result', glyph: '★' }),
]);

function cleanText(value, maxLength, label) {
  const normalized = String(value ?? '').normalize('NFKC').replace(/\s+/gu, ' ').trim();
  if (!normalized && label === 'target') throw new TypeError('擬人化する対象を入力してください。');
  if (normalized.length > maxLength) throw new RangeError(`${label === 'target' ? '対象名' : '補足説明'}は${maxLength}文字以内で入力してください。`);
  return normalized;
}

function searchableText(target, description) {
  return `${target} ${description}`.normalize('NFKC').toLocaleLowerCase('ja');
}

function findOccupation(id) {
  return BASE_OCCUPATIONS.find((occupation) => occupation.id === id) ?? null;
}

function chooseOccupation(text, signature) {
  if (signature) return findOccupation(signature.occupationId) ?? FALLBACK_OCCUPATION;
  let winner = null;
  let winnerScore = 0;
  for (const occupation of BASE_OCCUPATIONS) {
    const score = occupation.keywords.reduce((total, keyword) => total + (text.includes(keyword.toLocaleLowerCase('ja')) ? Math.max(1, keyword.length / 4) : 0), 0);
    if (score > winnerScore) {
      winner = occupation;
      winnerScore = score;
    }
  }
  return winnerScore > 0 ? winner : FALLBACK_OCCUPATION;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function genericFeatures(target, description, occupation) {
  const hasDescription = Boolean(description);
  const unknown = occupation.id === FALLBACK_OCCUPATION.id;
  return {
    functions: hasDescription
      ? [`入力された補足「${description}」を、${occupation.role}という比喩へ整理する`, `${target}が受け取るもの・行うこと・返すものを順番に観察する`]
      : [`${target}の役割を、入力・処理・出力の順に観察する`, '追加説明を受け取るまで、具体的な機能は未詳のまま保つ'],
    shapes: unknown
      ? ['形状情報は未入力。外見を決めつけず「未詳」として扱う', '対象名から確実に分かる範囲だけを図解する']
      : [`${occupation.motif[0]}と${occupation.motif[1]}を組み合わせた比喩的なシルエット`, '実物の外見ではなく、役割を示す図解として表現する'],
    strengths: unknown
      ? ['未知のまま保留し、追加情報で更新できる', '入力された内容と生成した比喩を分けて表示する']
      : [`${occupation.role}という役割に置き換えると、流れを追いやすい`, '七つの場面へ分解して理解の順番を作れる'],
    weaknesses: hasDescription
      ? ['補足説明だけでは、対象の事実や性能を検証できない', '擬人化は理解用の比喩であり、実物そのものではない']
      : ['対象名だけでは、具体的な性質や限界を確認できない', '追加説明がない部分を事実として補うことはできない'],
    threats: ['情報不足', '比喩と事実の混同', '確認なしの断定'],
  };
}

function resolveFeatures(target, description, occupation, signature) {
  if (!signature) return genericFeatures(target, description, occupation);
  return {
    functions: [...signature.functions],
    shapes: [...signature.shapes],
    strengths: [...signature.strengths],
    weaknesses: [...signature.weaknesses],
    threats: [...signature.threats],
  };
}

function hashString(value) {
  let hash = 0x811c9dc5;
  for (const character of value) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function buildCharacterName(target, occupation, hash) {
  const prefixes = ['アーカイブ', 'プリズム', 'シグナル', 'クロニクル', 'ノード', 'ルーメン'];
  return `${prefixes[hash % prefixes.length]}・${occupation.name}「${target}」`;
}

function buildScenes(profile) {
  const { target, occupation, normalized, equipment, enemy, specialMove } = profile;
  const points = [
    `${occupation.name}として、${target}の役割を七つの場面で説明する。`,
    normalized.functions[0],
    normalized.functions[1] ?? normalized.functions[0],
    `${normalized.weaknesses[0]}。そこへ${enemy}が現れる。`,
    `${equipment[1]}で「${normalized.strengths[0]}」が成り立つ範囲を確かめる。`,
    `${specialMove}を起動し、入力から結果までの流れを一つにつなぐ。`,
    `${target}は「${occupation.role}」キャラクターとして整理された。比喩と事実を分けて持ち帰る。`,
  ];
  const titles = [
    `${target}に任務が届く`,
    '材料と条件を受け取る',
    `${occupation.name}の仕事を動かす`,
    `${enemy}が立ちはだかる`,
    '長所と限界を照合する',
    `${specialMove}、発動`,
    'キャラクター化、完了',
  ];
  const props = [equipment[0], equipment[0], equipment[1], enemy, equipment[1], equipment[2], '結果カード'];
  return STAGE_BLUEPRINTS.map((stage, index) => Object.freeze({
    ...stage,
    index,
    number: index + 1,
    title: titles[index],
    point: points[index],
    narration: `${stage.label}。${points[index]}`,
    prop: Object.freeze({ name: props[index], glyph: stage.glyph }),
    durationMs: 3_600,
  }));
}

function deepFreezeProfile(profile) {
  Object.freeze(profile.normalized.functions);
  Object.freeze(profile.normalized.shapes);
  Object.freeze(profile.normalized.strengths);
  Object.freeze(profile.normalized.weaknesses);
  Object.freeze(profile.normalized.threats);
  Object.freeze(profile.normalized);
  Object.freeze(profile.equipment);
  Object.freeze(profile.visualMotifs);
  Object.freeze(profile.scenes);
  return Object.freeze(profile);
}

export function generatePersonification(rawTarget, options = {}) {
  const target = cleanText(rawTarget, MAX_TARGET_LENGTH, 'target');
  const description = cleanText(options.description ?? '', MAX_DESCRIPTION_LENGTH, 'description');
  const text = searchableText(target, description);
  const signature = SIGNATURES.find((candidate) => candidate.match.test(text)) ?? null;
  const occupation = chooseOccupation(text, signature);
  const normalized = resolveFeatures(target, description, occupation, signature);
  const hash = hashString(`${target}|${description}|${occupation.id}`);
  const equipment = unique([...occupation.equipment, normalized.shapes[0]]).slice(0, 3);
  const enemy = normalized.threats[hash % normalized.threats.length];
  const specialMove = occupation.specialMove;
  const confidence = signature ? 'curated-example' : occupation.id === FALLBACK_OCCUPATION.id ? 'fallback' : 'keyword-metaphor';
  const occupationIndex = Math.max(0, BASE_OCCUPATIONS.findIndex((item) => item.id === occupation.id));
  const profile = {
    schemaVersion: 1,
    target,
    description,
    characterName: buildCharacterName(target, occupation, hash),
    occupation,
    personality: occupation.personality,
    normalized,
    equipment,
    enemy,
    specialMove,
    visualMotifs: unique([...occupation.motif, normalized.shapes[0]]).slice(0, 3),
    castId: (hash % 200) + 1,
    theme: THEMES[occupationIndex % THEMES.length],
    confidence,
    disclaimer: confidence === 'curated-example'
      ? '登録済みの一般的特徴から作った理解用の比喩です。厳密な仕様・事実は一次資料で確認してください。'
      : '入力語から作った理解用の比喩です。生成内容は事実確認済みの説明ではありません。',
  };
  profile.scenes = buildScenes(profile);
  return deepFreezeProfile(profile);
}

export function occupationCount() {
  return BASE_OCCUPATIONS.length;
}

export function characterAssetForId(manifest, castId) {
  if (!Number.isSafeInteger(castId) || castId < 1 || castId > 200) throw new RangeError('castId must be an integer from 1 to 200');
  if (!manifest?.coverage || !Array.isArray(manifest.sheets) || manifest.sheets.length !== 20) throw new TypeError('A valid character manifest is required');
  const sheetIndex = Math.floor((castId - 1) / 10);
  const cellIndex = (castId - 1) % 10;
  const column = cellIndex % 2;
  const row = Math.floor(cellIndex / 2);
  return Object.freeze({
    id: castId,
    label: `人物図鑑 No.${String(castId).padStart(3, '0')}`,
    sheet: manifest.sheets[sheetIndex],
    sheetIndex,
    cellIndex,
    column,
    row,
    imageLeft: `${column * -100}%`,
    imageTop: `${-((row + 0.35) * 100)}%`,
  });
}
