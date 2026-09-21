# Page-turn sound licenses and provenance

取得・整音日: 2026-07-30 (Asia/Tokyo)

## 採用音源

5音源は、OpenGameArt の **10 Book Page Flips** に含まれる実録音です。本のページを実際にめくった10テイクから、長さと紙鳴りの異なる5テイクを選びました。

- 作品: 10 Book Page Flips
- 作者: StarNinjas
- 作品ページ: https://opengameart.org/content/10-book-page-flips
- 公式配布ZIP: https://opengameart.org/sites/default/files/book_flips_-_starninjas.zip
- 表示ライセンス: CC0 1.0
- ライセンス本文: https://creativecommons.org/publicdomain/zero/1.0/
- クレジット: 不要。任意表記は `Book page flips by StarNinjas (CC0)`

| 公開ファイル | 元録音 | 表現 | 実測長 | 元OGG SHA-256 |
|---|---|---|---:|---|
| `paper-01.mp3` | `book_flip.4.ogg` | 薄紙・軽やか | 650 ms | `4b66e2f2222ad5365f417cdb66a14c81254f4ccac59598e2b9cf334cbca136c4` |
| `paper-02.mp3` | `book_flip.3.ogg` | 古紙・しっとり | 1091 ms | `ba66b947b6f53f557fa8db37413e66a2168c79ced10ca55a8abdfea134550817` |
| `paper-03.mp3` | `book_flip.8.ogg` | 和紙・ささやき | 604 ms | `0a39301fbbd9cf422148bebab3c1c8b5bd9eaf08dd780d98832d0ebacbefb35e` |
| `paper-04.mp3` | `book_flip.6.ogg` | 素早いフリック | 697 ms | `f8ce9310329ca2134ce95226feb6aada0b577c55d0fc0a05155d6f9da628d41b` |
| `paper-05.mp3` | `book_flip.10.ogg` | 厚紙・重厚 | 1126 ms | `f9244aafcdc55cdb094927acc12839d33b47798e91c4d208a5ac1eab457daecd` |

元OGGは `source/` に保存しています。公開MP3は、ピークの強すぎる紙鳴りを抑えるため、65 Hzハイパス、13.5 kHzローパス、短い前後フェード、音量0.62、48 kHzステレオ、160 kbps MP3へ整音した派生物です。外部の追加音源は混ぜていません。

## 調査した別候補（不使用）

- Wikimedia Commons, **Turning a page.ogg**: public domain。今回は5テイクの一貫性を優先し未使用。
- Pixabay のページめくり素材: Pixabay Content License。raw素材の再配布条件を単純化するため未使用。

## 実装上の注意

- `manifest.json` の `file` はmanifest基準の相対パスです。
- ランダム再生では直前と同じ `id` を避けます。
- 失敗時はページ移動を止めず、静かなプロシージャル音または無音へフォールバックします。
