# ResearchPhantom Studio — handoff

更新日: 2026-09-17 (Asia/Tokyo)

## 2026-09-17 CAST LAB復旧

最優先課題だったCAST LABを独立入口`cast-lab.html`として復旧しました。

- `src/cast/personification-engine.js` — 21基礎職業、未知対象フォールバック、機能・形状・長所・弱点・天敵の正規化、職業・性格・3装備・敵・必殺技・視覚モチーフ・7シーンを決定的に生成
- `src/cast/cast-lab.js` — `Generate and Play`のsubmitから生成、200名図鑑の配役、小物決定、7シーン描画、再生開始までを接続
- `src/cast/cast-timeline.js` — 各3.6秒の7シーン進行、一時停止、前後移動、0.75〜2倍速
- `src/cast/cast-lab.css` — 呼吸、発話パルス、装備、敵、検証スキャン、必殺技、結果、カメラ感、粒子をブラウザ内アニメーションで表現
- LLM、Wi-Fiルーター、ミトコンドリア、クレジットカード、折り畳み傘、ResearchPhantomの研究論文を登録済み検証例として実装
- `tests/cast-lab.test.mjs` — 21職、未知対象、200名crop、7シーン25.2秒、submit→生成→描画→再生の配線を検証

2026-09-17の検証結果はNodeテスト57件pass、1件skip（runnerにffprobeがないため）。Happy DOMによる実DOM操作では、Wi-Fiルーターを入力してsubmit後に職業が「通信指揮者」へ変わり、`data-playing=true`、3.6秒後に任務→入力へ進み、一時停止できることを確認しました。

## 現在の状態

新UIは `/Users/monokuma/Documents/ResearchPhantom-Studio` に独立したGitリポジトリとして実装し、`RyoSAKu610/ResearchPhantom-Studio`として公開済みです。元のResearchPhantomを上流feedとして読み、相対URLだけでGitHub Pagesのサブパスから起動できます。

## 3つの版

| 版 | 入口 | 目的 |
| --- | --- | --- |
| Light | `index.html` | 表紙、目次、75論文、本棚、ページ音を低負荷で使う |
| Full | `data-motion.html` | キャラクターを極力使わず、課題→入力→手法→観測→結果→意味を文字と図形で動かす |
| Extra | `character-story.html` | 7場面の紙芝居、音声同期字幕、キャラクター・小物・口パク・視線・感情モーションで実演する |

全ページのLight / Full / Extra切替は、選択中の`paper` queryだけを安全に引き継ぎます。お気に入り、既読回数、最終振り返り日時は同じlocalStorage本棚を共有します。

## 完了した主な機能

- `src/shared/bookbinding.css` — 紙・墨・箔・クロス、花布、栞紐、小口、帯、蔵書印、柱、ノンブル、目次、奥付の装丁デザインシステム。ライト/ダーク/印刷を含む
- `src/shared/studio-core.js` — 厳格なfeed/manifest検証、循環navigator、ページ音、永続本棚
- `src/shared/edition-runtime.js` — 3版切替、paper引き継ぎ、75論文×7場面から001〜200を決定的に割り当てる支援キャスト
- `public/audio/page-turns/` — StarNinjasのCC0実録ページ音5テイク、元OGG、ライセンス、SHA-256
- `public/audio/narration/` — 先頭論文`rp-uk37f0`の7場面にVOICEVOX:ずんだもんの事前生成音声。字幕と同じ原稿へ同期
- `public/assets/characters/` — ユーザー提供の20シート、001〜200の全範囲、7名の主案内役crop
- `public/assets/video/` — Remotionで別々に作ったCharacter Story版とData Motion版の縦型PV
- `public/assets/motion/manifest.json` — `paper id → scene id → asset` の疎な索引。素材がない場面はWebP＋CSSへ安全に戻る
- `tools/import-grok-video.mjs` — 外部I2V生成物を権利、動画stream、尺、解像度、容量、codec、元SHA、prompt SHA、AI来歴保持まで検疫し、540×960 H.264・無音へ変換
- `tools/motion-provider.mjs` — manual-web / local-comfyui / api-costedを同じ525ジョブ契約へ載せるprovider非依存キュー
- `.github/workflows/sync-research.yml` — 毎日10:15 JSTに上流feedだけを同期し、fail-closed検証後の差分だけcommit/deploy

## 事実性と「毎日更新」の境界

- feedは75件。2026-08-02時点で、手動で課題・手法・結果を節分類したものは1件、残り74件は`summary-unclassified`です。
- 未検証74件は、要旨の文を位置だけで手法・結果へ自動分類しません。画面にも未検証と表示します。
- 日次同期が自動更新するのは論文feedです。音声、PV、AIモーション、手動レビューは自動生成済みとは表示しません。
- Extraの人物は論文著者ではなく、理解を助ける比喩的な案内役です。UIにもその区別を表示します。
- OpenAI Voice素材は現在0件です。静的PagesでAPIキーを要求せず、選択肢をdisabledにして字幕へ戻します。ローカルまたは信頼できるサーバーで事前生成した音声をmanifestへ登録した場合だけ有効化されます。

## 無料動画生成の運用方針

DeepSeekとMoonshot Kimiの公開APIには、現時点で動画生成モデルがありません。利用する場合は台本・絵コンテ・プロンプト補助に限定します。Grok、Kling、Hailuo、Vidu、PixVerseなどのWeb無料枠は、枚数・規約・透かし・商用可否が変わるため、運用上の保証値は**0本/日**です。

従ってサイト本体は無料動画がなくても動きます。

1. Lightは静的な読書体験
2. FullはCSS/Canvas風のデータモーション
3. ExtraはWebPを背景・人物・小物へ分けた多層CSSモーション
4. 公開PVはRemotionによる確定レンダー
5. 外部I2Vは、手動レビューを通過した場面だけを上書きする任意の強化素材

現在のApple M1 / 8GBでは、Wan 14B、HunyuanVideo、現行LTX-Video級を毎日ローカル生成するのは実用的ではありません。ComfyUI adapterは将来のGPU機または軽量workflow用のlocalhost接続口であり、モデルや重みは同梱せず、既定でdry-runです。

providerキューを作るコマンド:

```bash
cd /Users/monokuma/Documents/ResearchPhantom-Studio
npm run motion:queue
npm run motion:provider -- --run --provider manual-web --job rp-uk37f0:question
```

既定の525ジョブは、`ready=1 / held=6 / blocked=518`です。未検証論文の生成を拒否し、課金APIは上限0ドル、実呼出しなし、正の上限と二重確認がなければ進みません。

## 外部I2V素材の取り込み

必ず手元へ保存して目視レビューしてから実行します。ログインcookie、API token、署名付きURLをリポジトリへ持ち込みません。

```bash
npm run motion:import -- \
  --input "/absolute/path/to/reviewed-scene.mp4" \
  --paper rp-uk37f0 \
  --scene question \
  --provider grok-imagine \
  --label "Grok Imagine" \
  --prompt-file templates/prompts/rp-uk37f0/01-question.md \
  --rights-confirmed \
  --dry-run

# probe結果と映像を確認後、--dry-runだけ外して登録する。
# 既存場面を意図して差し替える場合だけ--replaceも付ける。
```

公開時はAI来歴表示を保持します。プラットフォームの透かしや来歴マークを消す・隠す・cropする運用は禁止です。

## 重要な保守境界

1. GitHub PagesへAPIキーを置かない。音声も動画も事前生成物だけを相対URLで配信する。
2. 元feedが75件未満、既存件数の90%未満、既存IDの80%未満、schema不正、HTTP失敗の場合は上書きしない。
3. `src/character/` と `src/data/` は独立させ、共有仕様は`src/shared/`で後方互換にする。
4. 場面変更、論文変更、一時停止ではmotion動画も停止し、読込失敗時は既存WebPへ戻す。動画の音は捨て、字幕・VOICEVOX/OpenAI Voice manifestを同期の正とする。
5. 塗りつぶしボタンは`--bb-stamp-bg` / `--bb-stamp-fg`の対で使う。紙の繊維を本文上の疑似要素で覆わない。
6. 200名は支援キャストであり著者と呼ばない。manifestのprovenanceと原画像SHAを維持する。

## 検証

```bash
cd /Users/monokuma/Documents/ResearchPhantom-Studio
npm ci
npm test
npm run dev
```

2026-08-02のローカル最終結果:

- build: 71ファイル、13.7 MiB
- Node tests: 50/50 pass
- `npm audit --omit=dev`: 0 vulnerabilities
- 公開候補の秘密鍵パターン: 0ファイル
- 25 MiB超の公開候補: 0ファイル
- provider queue: 525件、`ready=1 / held=6 / blocked=518`
- Chromium 1280px: Light / Full / Extraの切替、paper queryの引継ぎ、横はみ出し0
- Full: 再生後900msでtimelineが0→26へ進み、停止後は`aria-pressed=false`
- Extra: `data-playing=true`、感情`curious`、`guide-character-curious`、口パク表示、助演No.001→002の更新を確認
- Extra完成PV: 540×960 H.264/AAC、103.125秒、実再生時に`currentTime > 0`
- ページ音: 手動選択で5種類、操作可能
- OpenAI Voice: 素材0件のためoptionの`disabled=true`
- Chromium 390×844: Extra/Fullの論文drawerは閉じている間`inert`、開閉後にfocusがボタンへ戻り、横はみ出し0
- 一連のPC/モバイル操作でconsole errors 0 / warnings 0

- GitHub Pages workflow: クラウド上で同じ50テストを通過しdeploy success
- 公開版Chromium: Light / Extra / Fullをサブパス間で移動し、画像、feed、助演、再生タイムラインを検証。console errors 0 / warnings 0
- 日次sync workflow: 2026-08-02に手動起動しsuccess。上流に差分がなかったためcommit/deployは意図どおりskip

## 公開先

- Repository: https://github.com/RyoSAKu610/ResearchPhantom-Studio
- Light: https://ryosaku610.github.io/ResearchPhantom-Studio/
- Full: https://ryosaku610.github.io/ResearchPhantom-Studio/data-motion.html
- Extra: https://ryosaku610.github.io/ResearchPhantom-Studio/character-story.html
