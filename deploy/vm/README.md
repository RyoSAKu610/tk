# Cloud VM で Ticksmith を動かす

Cloudflare Workers 版と**同じコード**(`src/server/`)を、Node の常駐プロセス `tools/serve.mjs` として動かします。静的サイト(`dist/`)と `/v1` API を1つのポートで配信します。APIキーは不要です(Hyperliquid の info API は公開)。

## 前提
- Linux VM(Ubuntu 22.04 / 24.04 など)、**Node.js 22 以上**、git
- 外向き HTTPS(443)で `api.hyperliquid.xyz` に届くこと(`setup.sh` が最初に確認します)
- 公開するなら受信 80/443 と、TLS を終端するリバースプロキシ(例: Caddy)

## 手順

```bash
git clone https://github.com/RyoSAKu610/tk.git
```
```bash
cd tk
```
```bash
bash deploy/vm/setup.sh
```
Node のバージョン確認 → Hyperliquid への到達確認 → `npm ci` → `npm test`(ユニットテスト+ビルド)まで行います。

常駐サービスにする場合(systemd):
```bash
sudo -E bash deploy/vm/setup.sh --install-service
```
- `/etc/ticksmith/ticksmith.env` を例から作成(既にあれば残す)し、`/etc/systemd/system/ticksmith.service` を入れて起動します
- 起動後、そのサービスに対して `tools/verify-live.mjs` を実行し、実データでの22項目を確認します
- ログ: `journalctl -u ticksmith -f`(1行1JSON)

公開する場合は Caddy を前に置きます(自動 HTTPS)。`Caddyfile.example` のドメインを書き換えて `/etc/caddy/Caddyfile` に置き、`sudo systemctl reload caddy`。このとき `ticksmith.env` は `HOST=127.0.0.1` / `TRUST_PROXY=1` のままにします。

サービスにしないで手で動かす場合:
```bash
HOST=127.0.0.1 PORT=4173 npm start
```
```bash
npm run verify:live -- http://127.0.0.1:4173
```

## 更新
```bash
git pull
```
```bash
sudo -E bash deploy/vm/setup.sh --install-service
```
テスト・ビルドをやり直し、サービスを再起動して、もう一度 22 項目を確認します。`/etc/ticksmith/ticksmith.env` は上書きしません。

## 設定(`/etc/ticksmith/ticksmith.env`)
項目と意味は `ticksmith.env.example` と `docs.html#operations` を参照。不正な値は起動時に検出され、API が `500 config_error`(変数名入り)を返します。

| 項目 | 既定 | 補足 |
|---|---|---|
| `HOST` / `PORT` | `127.0.0.1` / `4173` | 直接公開するときだけ `0.0.0.0` |
| `TRUST_PROXY` | `1` | 前段プロキシの `X-Forwarded-For` を信じる。**直接公開なら `0`**(偽装でレート制限を回避されないため) |
| `HL_WEIGHT_BUDGET_PER_MIN` | `900` | Hyperliquid の上限は IP あたり 1200/分。VM の送信元IPを他の用途と共有するなら下げる |
| `CLIENT_RATE_PER_SEC` / `CLIENT_BURST` | `5` / `20` | クライアントIPごとのトークンバケット |

## 知っておくこと
- **同時閲覧の目安は 1 インスタンスで 2〜3 人。** 2026-11-26 の実測では、ブラウザ1つでランディング約 390 weight/分、コンソールの市場画面約 320 weight/分を消費しました。予算 900 を超えると、その分のリクエストは `503 upstream_budget` になります(偽データは出しません)。超える規模で使うなら、`HANDOFF.md` の「次にやること」1番(Hyperliquid WebSocket の常時購読)が必要です。
- VM は常駐プロセスなので、Workers と違いキャッシュとレート制限が全リクエストで共有されます(Workers はアイソレートごと)。
- 作業環境に外向きプロキシがある場合(Claude Code のクラウド環境など)、Node の `fetch` にプロキシを使わせるには `NODE_USE_ENV_PROXY=1` が必要です。普通の VM では不要です。
- Cloudflare Workers 版(https://tk.monokuma3910.workers.dev)は、main への push で自動デプロイされ続けます。VM を本番にするなら、Cloudflare 側の Git 連携をどうするか決めてください。
