# ResearchPhantom Studio

ResearchPhantomの論文フィードを、**装丁された一冊の本**として読む純静的サイトです。3つの版はどのページからも切り替えられ、選択中の論文を引き継ぎます。

- **Light / `index.html`** — 軽量な表紙・目次・本棚。日々の論文を探す入口
- **Full / `data-motion.html`** — キャラクターに依存せず、課題、入力、手法、観測、結果、意味をデータ図形とタイポグラフィで追う
- **Extra / `character-story.html`** — 7場面の紙芝居、自然な口パク・視線・小物・感情モーション、事前生成音声と同期字幕でゆっくり理解する
- **Shared Studio** — 75件の論文、5種類の実録ページ音、200名の支援キャスト、お気に入り・既読・振り返り用の本棚を全版で共有する
- **CAST LAB / `cast-lab.html`** — 任意の技術・製品・生物・概念を職業キャラクターへ変換し、任務→入力→処理→危機→検証→必殺→完了の7シーンをブラウザ内で直接再生する

外部CDNや実行時npm依存はありません。すべての公開URLを相対パスにしているため、`https://USER.github.io/REPOSITORY/` のようなGitHub Pagesサブパスで動作します。

公開版:

- Light: https://ryosaku610.github.io/ResearchPhantom-Studio/
- Full: https://ryosaku610.github.io/ResearchPhantom-Studio/data-motion.html
- Extra: https://ryosaku610.github.io/ResearchPhantom-Studio/character-story.html
- CAST LAB: https://ryosaku610.github.io/ResearchPhantom-Studio/cast-lab.html
- Repository: https://github.com/RyoSAKu610/ResearchPhantom-Studio

## 装丁 (bookbinding)

3つの入口はいずれも [`src/shared/bookbinding.css`](./src/shared/bookbinding.css) を**ページ固有CSSより先に**読み込みます。ここに紙・墨・箔・クロスのトークンと、本の部品だけを置いています。

| 層 | 内容 |
| --- | --- |
| 紙 | `--bb-paper` / `-lit` / `-dim` / `-edge` / `-shade`。繊維は `--bb-grain`（SVGノイズ）を `background-blend-mode` で**本文の下へ**合成する。覆いの `::before` は使わない |
| 墨 | `--bb-ink` / `-soft` / `-faint` / `-ghost` と3段の罫 `--bb-rule*` |
| 箔 | `--bb-gold` 系。`.bb-foil` が `background-clip: text` で箔押しを作り、非対応環境は `@supports` で単色へ落ちる |
| クロス | 臙脂 `--bb-cloth`、藍 `--bb-indigo`、織り目 `--bb-weave` |
| 押し型 | `--bb-stamp-bg` / `-bg-hover` / `-fg`。**塗りつぶしのボタンは必ずこの対で組む**（クロス色は暗所でさらに沈むため、地に直接 `--bb-cloth` を使うと文字が読めなくなる） |
| 部品 | `.bb-headband` 花布・`.bb-ribbon` 栞紐・`.bb-edges` 小口・`.bb-obi` 帯・`.bb-seal` 蔵書印・`.bb-fillet` 罫押し |
| 組版 | `.bb-running-head` 柱・`.bb-folio` ノンブル・`.bb-leader` 目次リーダー・`.bb-dropcap` 頭文字・`.bb-ornament` 飾り罫・`.bb-colophon` 奥付・`.bb-plate` 図版 |

書体は和文明朝（Hiragino Mincho ProN → Yu Mincho → Noto Serif JP）と欧文オールドスタイル（Iowan Old Style → Palatino → Georgia）のみで、Webフォントは読み込みません。

既定は「紙」。`prefers-color-scheme: dark` では同じ本を灯下で開いた**革装**へ切り替わり、紙・墨・箔・クロス・図版インクがまとめて反転します。`@media print` では箔と部品を落として本文だけを刷ります。

各版の見立て:

- 入口 `index.html` — 函から出した表紙。背・花布・栞紐・帯・扉・目次・奥付
- Extra — 見開き。左丁が目次と索引、右丁が版面（柱・図版・脚注の字幕・ノンブル）
- Full — 図版の巻。藍クロスの背に、方眼へ刷った銅版図（主線=藍・比較線=朱・結果=緑青）と組表を綴じる

## 起動

Node.js 20以上を使用します。

```bash
npm ci
npm test
npm run dev
```

ブラウザで `http://127.0.0.1:4173/` を開きます。

個別入口:

- `http://127.0.0.1:4173/character-story.html`
- `http://127.0.0.1:4173/data-motion.html`
- `http://127.0.0.1:4173/cast-lab.html`

Arena等で外部プレビューを行う場合のみ、`HOST=0.0.0.0 npm run dev`でbind先を変更できます。既定は安全な`127.0.0.1`です。

`npm run build` は公開に必要なHTML、`src/`、`public/`を新しい `dist/` へ完全コピーし、全ファイルのSHA-256を `dist/build-manifest.json` に記録します。`tools/serve.mjs` はループバックだけにbindし、MP4のRange requestにも対応します。

## 共有API

[`src/shared/studio-core.js`](./src/shared/studio-core.js) はA/B両方から直接importされます。

```js
const papers = await loadPapers();
const navigator = createPaperNavigator(papers, { onChange });
const pageSounds = await createPageSoundController();
const favorites = persistLibrary({ storageKey: 'my-library' });
```

- `loadPapers(options?)` — feed全体を厳格検証し、凍結した`Paper[]`を返す
- `createPaperNavigator(papers, options?)` — 前後移動、循環、index/id指定、購読
- `createPageSoundController(options?)` — ランダム（直前回避）、任意選択、音量保存、再生失敗時の静かな合成fallback
- `persistLibrary(options?)` — お気に入り、既読回数、最終振り返り日時をlocalStorageへ保存。利用不能時はメモリへ安全fallback

論文feedは `id/title/authors/summary/problem/methods/result/impact` を必須とし、重複ID、危険なURL、空の解説を拒否します。ページ音manifestは5音ちょうど、重複なし、安全な相対音声パスだけを受理します。

## CAST LAB

[`src/cast/personification-engine.js`](./src/cast/personification-engine.js) はDOMやネットワークに依存しない擬人化エンジンです。対象名と任意の補足説明を受け取り、次の順で決定的に同じ結果を返します。

1. 機能・形状・長所・弱点・天敵を共通形式へ正規化
2. 21基礎職業または未知対象用の「未知対象調査官」を選択
3. 性格、3装備、敵、必殺技、視覚モチーフを編成
4. 人物図鑑001〜200から支援キャストを選択
5. 任務・入力・処理・危機・検証・必殺・完了の7シーンを生成

[`src/cast/cast-lab.js`](./src/cast/cast-lab.js) が `Generate and Play` のsubmitイベントを受け、プロフィールと人物図鑑cropを描画してから即座に再生を開始します。各シーンは標準3.6秒で、前後移動、一時停止、0.75〜2倍速に対応します。処理はすべてブラウザ内で行い、入力内容を外部APIへ送信しません。

登録済みの検証例はLLM、Wi-Fiルーター、ミトコンドリア、クレジットカード、折り畳み傘、ResearchPhantomの研究論文です。それ以外は入力語と補足から比喩を生成し、事実確認済みの説明ではないことを画面に明示します。

## 収録メディア

### ページ音

`public/audio/page-turns/` はOpenGameArt **10 Book Page Flips**（StarNinjas、CC0）の実録音から5テイクを収録しています。詳しい元ファイル名、SHA-256、整音内容は [`public/audio/page-turns/LICENSES.md`](./public/audio/page-turns/LICENSES.md) にあります。

### キャラクター

`public/assets/characters/manifest.json` が001〜200の200名キャラクター資料を20枚の軽量WebPシートとして列挙します。Extraは論文×場面から決定的に001〜200を割り当て、CSSの2×5セルcropで全員を支援キャストとして使います。7名の主案内役には、音声レベル連動の口パク、ポインタ連動の視線、背景・キャラ・小物の多層モーションを付けています。これらは論文著者ではなく、理解を助ける比喩的な案内役です。

### Scene Motion（Grok Imagine等の画像→動画）

外部の画像→動画サービスで書き出した短いMP4/WebMは、ブラウザや認証情報と自動連携せず、ローカルの検疫コマンドを通して場面単位で登録します。Grok Imagineに限らず同じ契約で扱えます。

#### provider非依存キュー

```bash
# 75論文×7場面の状態表を .motion-jobs/ へ作る
npm run motion:queue

# 無料/契約中のWebサービスへ手動で渡すジョブと、検疫後のimport引数を表示する
npm run motion:provider -- --run --provider manual-web --job rp-uk37f0:question

# ローカルComfyUIの接続確認（localhostのみ、既定はdry-run）
npm run motion:provider -- --run --provider local-comfyui \
  --job rp-uk37f0:question --workflow templates/comfyui-workflow.template.json
```

525ジョブはフィードの事実確度と切り離されています。既定では、手動で節分類を確認した先頭論文の1場面だけが`ready`、残り6場面が`held`、未検証の74論文×7場面は`blocked`です。無料枚数は各社の都合で変わるため、システムは永続的な無料生成を保証しません。DeepSeekとKimiは現行の公開APIに動画生成モデルがないため、将来連携時も台本・絵コンテ補助に限定します。

従って、動画生成が0本の日でもExtraはWebP＋CSSモーション、Fullはデータモーション、PVはRemotionで動きます。現在のApple M1 / 8GB環境でWan・HunyuanVideo・現行LTX系の大型モデルを日次運用するのは現実的でないため、ComfyUIはプロトコル接続口だけを用意し、重い重みは同梱していません。

```bash
# まずprobeだけ。ファイルは変更しない
npm run motion:import -- \
  --input "/absolute/path/to/scene.mp4" \
  --paper rp-uk37f0 \
  --scene observation \
  --rights-confirmed \
  --dry-run

# 確認後に540×960・H.264・無音へ変換して登録
npm run motion:import -- \
  --input "/absolute/path/to/scene.mp4" \
  --paper rp-uk37f0 \
  --scene observation \
  --provider grok-imagine \
  --label "Grok Imagine" \
  --prompt-file templates/grok-imagine-scene-prompt.md \
  --rights-confirmed
```

`tools/import-grok-video.mjs` は入力を引数配列のまま`ffprobe`/`ffmpeg`へ渡し、シェル展開しません。拡張子、動画stream数、0.4〜60秒、16〜4096px、入力250MiB、出力24MiB、codecを検査し、音声を除去します。既定はPages向けH.264 MP4へ変換し、`--mode copy`では互換codecだけを再muxします。同じ論文・場面は意図しない上書きを拒否し、差し替え時だけ`--replace`を明示します。公開権利の`--rights-confirmed`とレビュー済み`--prompt-file`の両方がなければ登録できません。AI来歴マークの削除や切り取りを許容せず、元素材とプロンプトのSHA-256もmanifestで照合します。

成果物は `public/assets/motion/<paper-id>/<01-07>-<scene>.mp4`、索引は `public/assets/motion/manifest.json` です。絶対パス、アカウント情報、プロンプト本文はmanifestへ保存せず、元ファイル名とSHA-256、プロンプトファイル名とSHA-256だけを来歴として記録します。プロンプト雛形は [`templates/grok-imagine-scene-prompt.md`](./templates/grok-imagine-scene-prompt.md)、manifest例は [`templates/motion-manifest.template.json`](./templates/motion-manifest.template.json) です。

先頭デモ論文 `rp-uk37f0` には、Grok Imagineへそのまま渡せる英語プロンプトを [`templates/prompts/rp-uk37f0/index.json`](./templates/prompts/rp-uk37f0/index.json) と7つの場面別Markdownに用意しています。各場面はfeedの手動確認済みフィールドへ固定され、Newton参照画像、6秒ループ、1つの演技、1つのカメラ動作、無音・口パク分離、文字生成と手・顔・小物崩れの抑制を明示します。

甲版の統合ポイントは `src/character/character-story.js` の `renderScene()` です。`public/assets/motion/manifest.json`をナレーションmanifestと並行取得し、`papers[currentPaper.id].scenes[scene.stage]` がある場合だけ、次の規則で案内画像の上へ動画を置きます。

- URLは `new URL(asset.file, motionManifestUrl)` で解決し、現在のorigin以外を拒否する
- `<video muted playsinline loop preload="metadata">` として扱い、ナレーション音声は既存の音声manifestから再生する
- 場面変更・論文変更・一時停止では必ず動画も停止し、登録がない場面は既存のWebP＋CSSアニメーションへ戻す
- `durationMs` は動画の尺ではなく既存ナレーションの場面尺を優先し、研究内容の進行を映像生成物に支配させない

このmanifest契約により、画像アニメーションの生成元を後から差し替えても甲版の論文・字幕・音声データは変更不要です。

### 動画

- `public/assets/video/character-demo.mp4` — 甲版、Paper 01専用、47.67秒・7場面、540×960、H.264/AAC、約2.1MB。VOICEVOX:ずんだもん事前生成音声と字幕、一次資料範囲の比喩的な案内役（論文著者本人ではない）。
- `public/assets/video/data-demo.mp4` — 乙版、Paper 01専用、28.40秒、540×960、H.264、約1.2MB。字幕・図解主体、ナレーションなし。模式図は実測値ではない。

### ナレーションとOpenAIの境界

Ver.Aの先頭論文では、全7場面に実測尺の事前生成音声を割り当てています。クレジットは `VOICEVOX:ずんだもん` です。観測・解釈場面も、公開要旨の報告結果と「要旨以上の因果を足さない」境界へ合わせて再生成済みです。

GitHub Pagesは純静的な公開先です。OpenAI APIキーをブラウザ、リポジトリ、GitHub Pagesへ置いてはいけません。このリポジトリのOpenAI Voice切替は、ローカルまたは信頼できるサーバーで**事前生成した音声**を `public/audio/narration/manifest.json` の提供したい場面へ登録した場合だけ有効になります。未登録の場面は字幕へ戻り、鍵入力を要求しません。

## 毎日の論文更新

手動のローカル同期:

```bash
npm run sync:content
```

公開元からの同期:

```bash
npm run sync:remote
```

remoteモードは `https://howly23v.github.io/ResearchPhantom/index.html` だけを取得し、元サイトの`SEED_DATA`を自己完結でfeedへ変換します。ページ上での「最新」はフィード取得を指し、音声・PV・AIモーションを日次で自動生成する意味ではありません。現在は75件中1件だけが手動検証済みで、74件は公開要旨を節に自動分類していない未検証表示です。公開要旨からの抽出だけを説明本文へ採用し、未検証の所属、生成指標、推測した将来展望は取り込みません。HTTP失敗、schema不正、75件未満、既存件数の90%未満、既存IDの80%未満になったデータは上書きしません。

`.github/workflows/sync-research.yml` は上流の09:30頃の更新後、毎日10:15 JSTにこの処理と全テストを行い、正当な差分だけをcommitします。Actions tokenによるcommitへ別workflowが自動連鎖しない制約を避けるため、同じsync workflow内で検証済み`dist/`をPagesへdeployします。

## GitHub Pages公開

1. このディレクトリを新しいGitHubリポジトリへpushする
2. Repository Settings → Pages → Sourceを **GitHub Actions** にする
3. `main`へのpush、または **Deploy static studio to GitHub Pages** を手動実行する

ワークフローは `npm ci` → `npm test` → `dist/` upload → Pages deployの順です。APIキーやサーバーは不要です。

## 構成

```text
index.html                    Studio入口（表紙・扉・目次・奥付）
character-story.html          甲版 独立入口
data-motion.html              乙版 独立入口
cast-lab.html                 任意対象の擬人化実験室
src/shared/bookbinding.css    装丁トークンとオーナメント（全入口が最初に読む）
src/shared/                   検証・音・ナビ・本棚の共有基盤
src/character/                甲版専有
src/data/                     乙版専有
src/cast/                     擬人化エンジン・7シーン再生・CAST LAB専有CSS
public/data/                  日次更新feed
public/audio/                 CC0ページ音・事前生成ナレーション
public/assets/characters/     200名キャラクター資料とデモ案内役7名
public/assets/motion/         検疫済みの場面動画とprovider非依存manifest
public/assets/video/          Pages向け軽量実動画
templates/                    画像→動画プロンプトとmanifestの雛形
tools/                        build/server/sync/scene-motion queue/import
tests/                        静的パス・manifest・データ・秘密情報テスト
```
