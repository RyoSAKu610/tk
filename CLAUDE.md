# CLAUDE.md — tk リポジトリ

## このリポジトリ
- **Ticksmith**: Hyperliquid 公式 info API(`POST https://api.hyperliquid.xyz/info`)だけを情報源にする読み取り専用の REST API とサイト。`index.html` / `docs.html` / `console.html`
- 本番: https://tk.monokuma3910.workers.dev(Cloudflare Workers。main への push で Workers Builds が自動デプロイ)
- `researchphantom.html` / `data-motion.html` / `character-story.html` / `cast-lab.html` は別プロジェクト(ResearchPhantom)。データAPIの作業では触らない
- 最新の状態・残課題は `HANDOFF.md` の先頭。VM 運用は `deploy/vm/README.md`

## 構成
- `src/server/` — API本体。`hyperliquid.js`(上流クライアント: タイムアウト・再試行・重み予算・キャッシュ)、`api.js`(`/v1` ルート・正規化・エラー)、`config.js`(環境変数の検証)、`logger.js`
- `src/worker/index.js` — Cloudflare Worker の入口。`tools/serve.mjs` — Node(ローカル/VM)の入口。どちらも同じ `createApi()` を使う
- `src/hyperdash/` — フロント(`landing.js`・`docs.js`・`console.js`・`playground.js`・`api-client.js`・`common.js`、CSS とスキン Dash / Terminal)
- `tests/data-api.test.mjs` — API のユニットテスト。`tools/verify-live.mjs` — 実データでの E2E(22項目)

## コマンド
- `npm test` — ユニットテスト+ビルド(全件 pass が前提)
- `npm run dev` — http://127.0.0.1:4173 でサイト+`/v1`
- `npm run verify:live -- <URL>` — 実データ E2E。変更後は必ずローカルと本番の両方で流す
- `npx wrangler deploy --dry-run` — Worker のバンドル確認
- 外向きプロキシのある環境では Node の fetch に `NODE_USE_ENV_PROXY=1` が必要

## 守ること(ユーザーの最優先ルール)
- モック・シミュレーション・ダミーデータ・ハードコードしたサンプル値で動く風にしない。モックはユニットテストの中だけ
- 公式 API に直接つなぐ。接続失敗時に偽の値へ黙ってフォールバックしない。エラーを明示する
- 公式 API で取得・再構築できないデータは「利用不可」と明記し、作り物で埋めない(`api.js` の `UNAVAILABLE`)
- エラー処理・再試行・レート制限・ログ・設定管理を最初から入れる。キーや認証情報はコードやチャットに書かない
- 「ビルドとテストが通った」だけで完了にしない。実データで端から端まで動かし、取得時刻付きの実出力を報告に添える。確認できていない所は「未検証」と書く
- キーや接続先が必要なら作業前に確認する。本番接続できないときは、足りないもの(キー/ホスト/権限)を具体的に伝えて止まる
- 取引機能を作る場合: 実際の取引所 API(テストはテストネット)、手数料・スリッページ・最小発注単位・約定確認を扱い、実発注は `DRY_RUN=false` などの明示設定でのみ。現状、発注機能はない

## 注意点
- Hyperliquid の上限は IP あたり 1200 weight/分。上流呼び出しを増やす変更をしたら、`/v1/status` の `weightUsedLastMinute` で 1 閲覧者あたりの消費を測る(現状: ランディング約390/分、コンソール市場画面約320/分)
- デザインの2案(Dash / Terminal)は維持する
- サービス名 Ticksmith は、実在サービスの名前・料金表・ドメインを名乗らないために付けた仮名。変えるなら3つの HTML のブランド表記
