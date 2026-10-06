# EVA「活動限界」缓存倒计时 — TUI 设计稿（综合定稿）

> 综合版：主线程 5×3 全块大数字字模 + K3 的调色板层次 / 彩蛋 / 反色徽章 / 子条 / 分级闪烁 / 宽度适配。
> 真色预览：`node preview.mjs`

## 常量
- 总长 `05:00:00`（对应 pi `CACHE_TTL_MS = 5*60*1000`）
- 分水岭 `02:30:00`（=150s）
- 时间格式 `MM:SS:cc`（cc = 百分秒 1/100，还原 `4:59:96` 节奏）
- 背景：面板用暖黑底（黄 `#0B0101` / 红 `#0C0000`，忠于原作暗红黑而非纯黑）

## 调色板（忠于 EVA 原作实测：scottykwok/eva-timer-analysis 逐帧直方图取样）
| 用途 | 黄段（平和） | 红段（紧急） | 原作来源 |
|---|---|---|---|
| 主色（边框/大数字/已填格/日文标签） | `#FB9430` | `#DD264A` | NGE01 Yellow / EVA1 DANGER |
| 高光（glow 亮部/百分比/STATUS 值/♪⚠） | `#ECAB4D` | `#FF5A7A` | DEA 金黄 / 玫红 glow |
| 次级标注（英文/前缀/API） | `#E37C0B` | `#69050C` | DEA saturation / EVA2 DANGER |
| NERV 绿（NORMAL/安全/数据） | `#6CA623` | `#3A6414` | NGE01 绿 / NGE09 暗绿 |
| 空槽 | `#1B0201` | `#1B0003` | NGE08 暖黑 / NGE09 暗红黑 |
| 面板底色 | `#0B0101` | `#0C0000` | NGE08 / EVA2 |
| 分水岭 tick | `#EDA316` | `#69050C` | NGE03 金黄 |
| DANGER 反色徽章 | — | 白 on `#69050C` 2Hz | EVA2 暗红底 |
| EMERGENCY 戳 | — | 白 on `#DD264A` 1Hz | EVA1 DANGER |

> 原作 TV 版（V1）为暗红黑底 + 琥珀/黄发光 + NERV 绿数据；新剧场版（V2）DANGER 为玫红 `#DD264A`、AUX 蓝、底偏蓝。本设计黄段取 V1 琥珀、红段取 V2 玫红、绿取 V1 NERV 绿，按分水岭 2:30 切换。

## 一、一级 · 一行简约版（1 行）

结构：`PI 缓存残量 あと <20格条·中央tick> <MM:SS:cc> <CACHE·状态> <♪>`

- 条从右烧尽，20 格（每格 15s），cell 9/10 之间嵌分水岭 tick `│`（黄 `#EDA316` / 红 `#69050C`）；剩余格越过 tick 即全局翻红。
- 末段（≤20s）最后 2 格 2Hz 闪烁。

```
黄段  PI 缓存残量 あと ░░░░██████│██████████ 03:58:44 CACHE·NORMAL ♪
       └sub┘ └─主色amber──┘ └slot┘└main┘└tick┘└─main─┘ └─高光#ECAB4D─┘ └─sub·NORMAL绿─┘└hi┘

红段  PI 缓存残量 あと ░░░░░░░░░░│░░░░░░████ 01:07:32 CACHE·[DANGER] ♪
       └sub┘ └─主色red────┘ └──slot──┘└tick┘└slot┘└main┘ └─高光#FF5A7A─┘ └sub·反色徽章2Hz┘└hi┘
```

- `PI` 前缀次级色、`缓存残量 あと`主色、时间高光、`CACHE·NORMAL`/`CACHE·DANGER`（DANGER 用反色徽章）、行尾 `♪`=BGM on（off 时 `·` 空槽色）。
- 宽度适配（5 档）：≥70 完整 → 56-69 去 `PI` 前缀 → 42-55 去 `CACHE·` → 30-41 条缩 6 格 → <30 仅 `MM:SS:cc`（时间永不截断）。

## 二、二级 · 多行完整版（宽 62，高 12 行）

内宽 60。大数字用 5×3 全块字模（见下）。顶部嵌 `PROMPT CACHE SYSTEM ─ 缓存残量 あと`，底部 `PI AGENT · MODEL SYNC ── CACHE · SESSION`。

```
┌─PROMPT CACHE SYSTEM ─ 缓存残量 あと─────────────────────────┐
│                                                            │
│              ███ ███     ███ ███     █ █ █ █               │
│              █ █   █  █  █   █ █  █  █ █ █ █               │
│              █ █ ███     ███ ███     ███ ███               │  ← 5×3 全块大数字
│              █ █   █  █    █ █ █  █    █   █               │     （03:58:44，amber）
│              ███ ███     ███ ███       █   █               │
│                                                            │
│  CACHE ▸ ░░░░░███████│████████████  79% REMAINING          │
│  API ─ RECOMPUTE  BUFFER ▮▮▮▮▮▮▮▮▯▯ 100%                   │
│  STATUS: NORMAL  ♪BGM ON  ⚠ALARM ON  TTL 5:00              │
└─PI AGENT · MODEL SYNC ── CACHE · SESSION────────────────────┘
```

红段（01:07:32）：全框变红，条剩 22%，`BUFFER ▮▮▮▯▯▯▯▯▯▯ LOW`，STATUS 行 → `STATUS: [DANGER] 缓存即将失效 ♪BGM ON ⚠ALARM ON`，边框 2Hz、`DANGER` 反色 2Hz、`缓存即将失效` 高光红。

- `CACHE` 条 24 格 + 中央 tick，filled = round(剩余/300×24)；百分比 = 剩余%。
- `BUFFER` 子条 10 格 = ceil(剩余/30s)，与时钟联动（缓存 TTL 恰 5 分钟）。
- 高度：边框 1 + 空行 1 + 大数字 5 + 空行 1 + CACHE 1 + API 1 + STATUS 1 + 边框 1 = 12 行。
- 宽度适配：≥62 完整 → 56-61 CACHE 条收缩(最小12格) → 48-55 删 API 子行(高11) → 36-47 弃大数字改单行 `残量 MM:SS:cc`(高8) → <36 回退简约版。

## 三、5×3 全块大数字字模（替换 K3 的 3 行半块字模）

```
0 ███  1  █   2 ███  3 ███  4 █ █  5 ███  6 ███  7 ███  8 ███  9 ███
  █ █    ██     █     █     █ █   █     █       █     █ █     █ █
  █ █     █    ███   ███   ███   ███   ███     █     ███    ███
  █ █     █    █       █     █     █   █ █     █     █ █      █
  ███    ███   ███   ███     █   ███   ███     █     ███    ███
```

冒号 `:` = 3 宽 5 行：`   / █ /   / █ /   `（第 1、3 行有点，1Hz 闪烁，高光色）。

## 四、交互 / 动效
1. 点击 footer 区域在「简约 ↔ 完整」间切换，切后 `invalidate()` + 模式持久化；普通（非全屏）模式补一个键盘热键降级。
2. `/eva_cache_countdown`：BGM on/off、alarm on/off、手动切模式。
3. 刷新 `setInterval(50ms)` + `tui.requestRender()`；百分秒 20fps 滚动，冒号 1Hz 由同一 tick 驱动。
4. 首次 ≤2:30 全 UI 翻红，alarm on 则播警告音；到 0:00 STATUS→EMERGENCY（白 on `#DD264A` 1Hz）并播 alarm。
5. 闪烁只在红段（DANGER+边框 2Hz、EMERGENCY 1Hz、末段最后 2 格 2Hz）；黄段仅冒号 1Hz。
6. 每帧 `render(width)` 内所有行 `visibleWidth/truncateToWidth`，日文按宽 2。

## 五、取舍理由
- **5×3 全块字模**：K3 的 3 行半块字模（`█▀▀█/▄▄█`）细且易对不齐；全块 `█` 像素级稳定、清晰，代价是完整版多 2 行（11→12）。
- **从右烧尽 + 中央 tick**：一眼读「剩多少」与「距 2:30 悬崖多远」，越界全局翻红，戏剧性更强。
- **琥珀/玫红 + NERV 绿**：黄段取 TV 版 V1 琥珀发光 `#FB9430`，红段取新剧场版 DANGER 玫红 `#DD264A`；NERV 绿 `#6CA623` 专表 NORMAL/安全（EVA 通奏低色「绿=平穏」）。所有色值来自 `eva-timer-analysis` 逐帧直方图实测，非凭空拍板。
- **BUFFER 子条与时钟联动**：缓存 TTL 5 分钟与倒计时互文，▮ 数 = ceil(剩余/30s)。
- **红段才闪烁**：符合 EVA 情绪曲线，避免日常视觉疲劳。
