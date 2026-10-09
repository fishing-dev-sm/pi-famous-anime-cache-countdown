# pi-flcc

<p align="center">
  <a href="README.md">English</a> |
  <a href="README.zh-CN.md">简体中文</a> |
  <a href="README.ja.md"><strong>日本語</strong></a>
</p>

アニメ風のプロンプトキャッシュ TTL カウントダウン。[pi](https://github.com/earendil-works/pi) 向けの 1 行ウィジェットで、Anthropic のプロンプトキャッシュエントリがあとどれくらい生きているかを表示します（デフォルト TTL 5 分）。

![layout](https://img.shields.io/badge/layout-one%20line-green)

```
 CACHE 限界  ⣤⣿⣿⣿⣿⣿⣿⣿⣿⣿│⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿ ●  04:52:64   NORMAL
```

## デモ

DeepSeek 12 時間マクロモード（TTL 未宣言、実測でキャッシュが 12 時間以上生存する best-effort キャッシュ）：

![deepseek-12h](docs/deepseek-12h.gif)

5 分間のライフサイクル全体を約 15 秒に圧縮 —— 5 フェーズ、最終秒の点滅、そして期限切れの 3 段階消解：

![five-phases](docs/five-phases.gif)

キャッシュが死んだ瞬間のクローズアップ：ゲージ＋時計が右→左に収縮し、` 终 OVER 了 ` が 3 回呼吸点滅して消え、` CACHE EXPIRED 限界突破 ` は永久に残る：

![expire-dissolve](docs/expire-dissolve.gif)

スタンバイ → 最初のリクエストで点灯：

![standby-wake](docs/standby-wake.gif)

GIF は実拡張コードから生成されます（`demo-frames.mjs` でフレーム出力、`player.mjs` で実 Alacritty 上に再生、`record_gifs.sh` で録画）。実 pi TUI に対する E2E 検証（pty 駆動）は `e2e_tui.py` —— レポート：`docs/e2e/report.md`。

## 機能

- **1 行・5 状態**（TTL を 5 等分）：`NORMAL`（緑）→ `注 CAUTION 意`（黄）→ `危 DANGER 険`（橙）→ `緊 EMERGENCY 急`（赤）→ 反転点滅 EMERGENCY（最後の 5 分の 1）
- 20 セルの点字ゲージ（セルごとに 3 段階の垂直サブレベル = 60 ステップ）、中央ティック
- `MM:SS:cc` カウントダウン + ソフトに脈打つ `●`。百分秒は自然に回転（83ms レンダーティック、10ms の桁周期と非整除）
- 期限切れ後は 3 段階で消解（フレーム単位プレビュー: `node preview-expire.mjs --frames`）:
  1. `⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀│⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀ 00:00:00` が右→左に 1 枠ずつ収縮して完全に消える（1.2 秒）
  2. ` 终 OVER 了 ` が 3 回呼吸点滅（周期 700ms、ピークは毎回暗くなる）後に消える（2.1 秒）
  3. ` CACHE EXPIRED 限界突破 ` バッジは永久に保持——次のリクエストでカウントダウンが復活するまで
- **正しいトリガー意味論**（pi 内蔵 `cache-warmer` に一致）：カウントダウンはリクエストがプロバイダへ*送信された*時（`before_provider_request`）にリセットされ、レスポンスがキャッシュ使用を報告した時ではありません。ウォーミング再生（`cache_warming_decision`）もリセットします。TTL は `model.promptCache[short|long]` から取得（`PI_CACHE_RETENTION=long` 対応）、フォールバック 300 秒。
- **行儀の良い UI**：`setWidget` でレンダリングし、フッターを乗っ取りません。`footer` 位置も選択可能——`setStatus` 経由でフッター体系（例：pi-slim-footer のプラグイン行）に入り、フッター自体は置き換えません。セッション最初のリクエストまで何も表示しません。
- **狭い端末に自适应する 3 段階の縮略モード**（縮小時は列を落とし、決して切断しない。盲文セルを常に真っ先に削り、`●` は永不丢）：L1 ≤66 セル（中央ティック除去 + 盲文 20→10）、L2 ≤50 セル（盲文→4 + 状態バッジ短縮 ` 注 CAUT 意 `）、L3 ≤26 セル（盲文→2 + cc 除去）。閾値は `tui_compact_design.md`、トゥルーカラー preview は `node preview-compact.mjs`。
- **DeepSeek 12 時間モード**（`provider`/`id` が "deepseek" に一致し、`promptCache` を宣言しないモデル）：
  ```
   CACHE DEEPSEEK  ⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿│⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿  11:59:50   長 EXTERNAL 期   HIT 96%
  ```
  DeepSeek のプロンプトキャッシュには固定 TTL がありません（実測 ≥ 12 時間）。そのため青い 12 時間マクロカウントダウンを `HH:MM:SS` で表示します。**HIT %** バッジは前回レスポンスの実キャッシュヒット率を示し、`usage.prompt_cache_hit_tokens` から無料で取得します（pi は `cacheRead` にマップ）。残り 5 分で 5 フェーズの短ロジックへシームレスに切り替わります。
- **ローカル/セルフホスト ∞ モード**（`promptCache` を宣言せず、DeepSeek でもなく、`baseUrl` が loopback/プライベートアドレスのモデル——vLLM、SGLang、ollama、qwen-local など）：
  ```
   CACHE 無限
  ```
  ローカル server の KV キャッシュは server プロセスのメモリに生きており TTL がないため、カウントダウンは誤解を招くだけです。代わりに静的な青いバッジだけを表示：ゲージなし、時計なし、`●` なし、点滅なし。DeepSeek と同じ青系（どちらも「長期・見守り不要」のファミリー）。

## インストール

```bash
pi install npm:pi-flcc
# またはソースから：
pi install https://github.com/fishing-dev-sm/pi-famous-anime-cache-countdown
```

## コマンド

| コマンド | 動作 |
|---|---|
| `/facc` | 設定メニュー。メニュー1：ウィジェット位置 `aboveEditor` / `belowEditor` / `footer`；メニュー2：テーマ `theme1`（言語ブランド色、デフォルト）/ `theme2`（オリジナル Tailwind）（`~/.pi/agent/facc.json` に永続化、ライブ反映） |

## 開発

- `preview.mjs` —— トゥルーカラー ANSI デザインプレビュー（`node preview.mjs`）
- `preview-compact.mjs` —— 3 段階縮略モードのトゥルーカラー preview（`node preview-compact.mjs`）
- `test-render.mjs` —— 各フェーズのレンダリングサンプル（`node test-render.mjs`）
- `demo-frames.mjs` + `player.mjs` + `record_gifs.sh` —— GIF パイプライン：実レンダリング関数でフレーム出力、Xvfb 仮想ディスプレイ上の実 Alacritty で再生、ffmpeg で録画（`./record_gifs.sh [scene ...]`）
- `tui_design.md` —— デザインノート；`tui_compact_design.md` —— 縮略モード設計稿
