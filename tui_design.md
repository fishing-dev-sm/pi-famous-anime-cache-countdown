# famous-anime-cache-countdown — TUI 设计稿（最终版）

> 缩略模式（窄宽度自适应三档）见 `tui_compact_design.md`（v3 定稿，真彩预览 `node preview-compact.mjs`）。
> 位置可选 aboveEditor/belowEditor/footer（footer = setStatus 进入 footer 体系，不接管）。

> 一行 widget 致敬一部经典动画的倒计时画面：Anthropic prompt cache TTL（5 分钟）倒计时，
> 视觉与 `index.ts` 的 `buildCountdownLine` / `buildDeepseekLine` 一致。真色预览：`node preview.mjs`。

## 常量
- 总长 `05:00:00`（对应 pi `CACHE_TTL_MS = 5*60*1000`，Anthropic 短保留）
- 五段等分：每段 60s（总 TTL 均分 5 段）
- 时间格式 `MM:SS:cc`（cc = 百分秒 1/100，还原 `4:59:96` 节奏）；DeepSeek 模式用 `HH:MM:SS`
- 布局：[反白徽章 CACHE 限界] [20 格 braille 条] [● 运行指示] [反白时间] [状态徽章]

## 调色板（抄 pi-fleet `packages/pi-agent-swarm/src/color.ts` SWARM_COLORS + Tailwind 色阶）

> 本表 = **theme2（原版 Tailwind）**。默认 **theme1** 换成编程语言品牌色：绿 `#41b883`(Vue) / 黄 `#ffc85a` / 橙 `#dea584`(Rust) / 红 `#c22d40`(Scala) / 蓝 `#3178c6`(TypeScript)，hi/sub/tick 由主色 HSL ±18/±9% 亮度派生。
| 段 | main（底/主色） | hi（高光） | sub（次级/末位） | tick（分水岭） | 阈值 |
|---|---|---|---|---|---|
| 0 绿 | `#22c55e` | `#4ade80` | `#15803d` | `#16a34a` | sec > 240 |
| 1 黄 | `#eab308` | `#facc15` | `#a16207` | `#ca8a04` | 240 ≥ sec > 180 |
| 2 橙 | `#f97316` | `#fb923c` | `#c2410c` | `#ea580c` | 180 ≥ sec > 120 |
| 3 红 | `#ef4444` | `#f87171` | `#b91c1c` | `#dc2626` | 120 ≥ sec > 60 |
| 4 红闪 | `#ef4444` | `#f87171` | `#b91c1c` | `#dc2626` | sec ≤ 60 |

特殊色：`DANGER_BG = #b91c1c`（紅/红闪状态徽章底）、`PULSE_GREEN = #86efac`（● 运行指示，非常淡的绿）、
DeepSeek 蓝系 `{ main:#3b82f6, hi:#60a5fa, sub:#1d4ed8, tick:#2563eb }`（冷静/长期，与绿 NORMAL 区分）。

反白字色：`contrastFg(bgHex)` = WCAG 相对亮度（gamma 校正）选黑/白，`(lum+0.05)/0.05 >= 1.05/(lum+0.05) ? #000 : #fff`（`#ef4444` 红底 → 黑字）。同 pi-fleet `contrastTextColor`。

## 一行版布局（buildCountdownLine）
```
 CACHE 限界  ⣀⣶⣿⣿⣿⣿⣿⣿⣿⣿│⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿ ●  04:40:00   NORMAL
 └反白徽章┘ └──20格 braille 条·中央tick──┘ └●┘ └反白时间┘ └状态徽章┘
```

- **反白徽章** ` CACHE 限界 `：底=当前段 main，字色 contrastFg。
- **20 格 braille 条**：每格垂直 3 级填充 `⣀→⣤→⣶→⣿`（底部点阵→满），从右往左烧尽；
  20 格 → 60 步分辨率。中央分水岭 `│`（tick 色）。末段 `sec<=20` 最后 2 格 500ms 闪烁。
- **● 运行指示**：`#86efac` 淡绿，90ms 独立相位闪烁（与 83ms 渲染 tick 错开，避免相位锁死）。
- **反白时间** `MM:SS:cc`：底=main、字色 contrastFg；末位 cc[1] 用 sub 暗色弱化（LiveSplit 式）；冒号常显不闪烁。
  渲染 tick=83ms 与 cc 末位 10ms 周期不整除 → 末位自然轮转 0-9（真实秒表效果；100ms 会 10:1 相位锁死）。
- **状态徽章**（五段）：
  | 段 | 文案 | 样式 |
  |---|---|---|
  | 0 绿 | ` NORMAL ` | 反白（main 底） |
  | 1 黄 | ` 注 CAUTION 意 ` | 反白（main 底） |
  | 2 橙 | ` 危 DANGER 険 ` | 反白（main 底） |
  | 3 红 | ` 緊 EMERGENCY 急 ` | 白字 on `#b91c1c` |
  | 4 红闪 | ` 緊 EMERGENCY 急 ` | 400ms 反相闪烁（白字/`#b91c1c`底 ↔ 暗红字/亮红底） |

## 过期状态（remainMs ≤ 0）——三阶段消解动画（buildExpiredLine）
时间轴由 `age = -remainMs`（过期后毫秒）驱动：纯函数、无外部状态，因此天然可逆——
下一次请求让 remainMs 回到正数，动画自动作废、倒计时复活。
常量：`EXPIRE_COLLAPSE_MS=1200`、`EXPIRE_BREATH_MS=700`、`EXPIRE_BREATHS=3`（总时长 3.3s）。

| 阶段 | 时间 | 行为 |
|---|---|---|
| 1 收拢 | 0 → 1.2s | 「⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀│⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀ 00:00:00」自右向左逐格消失（条+空格+时间 = 30 个可见格，40ms/格，与 83ms 渲染 tick 兼容） |
| 2 呼吸 | 1.2 → 3.3s | 「 终 OVER 了 」底色在 `#b91c1c` ↔ 近黑 `shiftLightness(dangerBg,-20)` 之间振荡 3 次，包络 `(0.5+0.5·cos 2πp)·(1-p/3)` → 一峰比一峰暗，收尾正好全灭 |
| 3 定格 | 3.3s → | 只剩「 CACHE EXPIRED 限界突破 」徽章，永久保留（无条/无时间/无状态/无 ●） |

实现要点：收拢以「可见格」为单位（每个 atom = 1 列，ANSI 串不会被切坏）；
`keep = ceil(atoms × (COLLAPSE - age) / COLLAPSE)`，取 `atoms.slice(0, keep)` → 严格前缀，保证右→左。
逐帧预览：`node preview-expire.mjs --frames`（100ms/帧）；真机验证：`e2e_tui.py f`（场景 F，用 ScreenEmulator 回放 pty 字节流断言屏幕内容）。

## DeepSeek 12h 宏观模式（buildDeepseekLine）
DeepSeek 无 `promptCache` 声明、实测 cache ≥12h 存活（2026-10 TTL probe，V4.1 Flash 12h 仍 100% 命中），
无法用 5 分钟 TTL，改用 12h 宏观倒计时：
```
 CACHE DEEPSEEK  ⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿│⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿  11:59:00   長 EXTERNAL 期   HIT 99%
```
- 蓝系配色、`HH:MM:SS`（秒级精度，无 cc）、无 ●。
- `HIT XX%` = 上次响应 usage 真实命中率 `cacheRead/(cacheRead+input)`（DeepSeek 免费返回 prompt_cache_hit_tokens）。
- 剩余 ≤300s 时无缝接入上方五段短逻辑（300s = 短逻辑窗口）。
- 分流：仅 `isDeepseekModel`（provider/id 含 deepseek）；本地 API 走下方 ∞ 模式，其他无声明云端模型（k3 等）兜底 300s 短逻辑。

## 本地/自托管 ∞ 模式（buildInfiniteLine）
本地 server（vLLM / SGLang / ollama / qwen-local 等）的 KV cache 活在 server 进程内存里，没有 TTL——
倒计时只会误导（给「无限」画 5 分钟倒计时）。故只显示一个静态蓝徽章，无倒计时：
```
 CACHE 無限
```
- 与 DeepSeek 共用蓝系（`longTermPhase`，同属「长期、不用盯」档）；无 braille 条、无 ∞ 符号、无状态徽章、无 ●、无闪烁。
- 判定 `isLocalModel`：无 `promptCache` 声明 + 非 DeepSeek + `baseUrl` 主机是 loopback
  （localhost / 127.x / ::1 / 0.0.0.0）或 RFC1918 私网（10/8、172.16/12、192.168/16）。
  不用「无声明」一刀切：k3 等无声明云端模型仍走 300s 兜底短逻辑。
- 首次请求后才出现（待机不显示），宽度无关不分档。
- E2E：场景 E（127.0.0.1 假本地模型）验证徽章出现 / 待机不显示 / 蓝色 / 无倒计时元件 / 时间推移仍静态。

## 触发 / 重置逻辑（学习自 pi 内置 cache-warmer，core/sdk.ts:404）
- **待机不显示**：`lastCacheAt = null` 时 widget 不渲染（session_start 清零，首个请求才安装 widget）。
- **请求发出即重置**：`before_provider_request`（HTTP 调用前）→ `lastCacheAt = Date.now()`；
  warmer 保活重放经同一 streamFn 也触发，另监听 `cache_warming_decision`（action==="warm"）双保险。
- 渲染 tick `setInterval(83ms)` + `tui.requestRender()`；session_shutdown 幂等清理。
- 有效 TTL：`declaredTtlMs(model)`（model.promptCache[retention]，retention=PI_CACHE_RETENTION==="long"?"long":"short"）
  ?? `isDeepseekModel` ? 12h : 300s。

## 挂载与配置
- `ctx.ui.setWidget(FACC_WIDGET_KEY, factory, { placement })`（editor 上/下插槽，**不替换** footer；
  setFooter 是清空式替换语义，会覆盖内置 footer，弃用）。
- placement 默认 `belowEditor`，存 `~/.pi/agent/facc.json`。
- 命令 **`/facc`**：配置菜单（菜单 1 = widget 位置 aboveEditor/belowEditor/footer；菜单 2 = 主题 theme1 语言品牌色(默认)/theme2 原版 Tailwind；改后 tear down + reinstall 移动/换色）。

## 取舍理由
- **一行（widget 而非多行/多行完整版）**：早期设计有「一级·一行简约版 + 二级·多行完整版」两级，
  用户定稿「一级·一行简约版 通过，仅支持一行，多行完整版取消」——只保留一行，删掉 5×3 大数字字模与多行边框。
- **braille 垂直 3 级 `⣀⣤⣶⣿`**：比 ░█ 更密、比 5×3 大数字省行高，20 格 × 3 级 = 60 步分辨率，仍从右烧尽 + 中央 tick。
- **从右烧尽 + 中央 tick**：一眼读「剩多少」与「距分水岭多远」；五段越界逐步变红，戏剧性强。
- **五段等分（TTL/5）而非四段**：绿/黄/橙/红/红闪五档，末段（≤60s）反相闪烁 = 倒计时最后的压迫感；色号全部抄 pi-fleet 而非凭空拍板。
- **红段才反相闪烁**：符合紧迫情绪曲线，避免日常视觉疲劳（仅末段 60s 反相 + 末 20s 条尾闪烁）。
- **音乐（BGM）/alarm 已删**：早期有 BGM/alarm 与一个占位命令，用户定稿「音乐暂时取消」后
  于 commit ffd9834 整体删除（alarmEnabled/prevSec/bell/命令注册），仅保留 `/facc`。
