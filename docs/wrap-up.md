# 收尾报告（wrap-up）

日期：2026-10-06（首版）· 持续更新：过期三阶段消解动画（2026-10-07）· 最终提交：见「关键提交」表

## 项目状态

pi 扩展 **pi-flcc@1.3.0**（anime-style prompt-cache TTL 倒计时 widget）：

- 实现：`index.ts`（612 行），npm 已发布 `pi-flcc@1.2.0`（1.3.0 = 新增过期三阶段消解动画，尚未 publish）
- 展示 GIF：`docs/{five-phases,deepseek-12h,standby-wake}.gif`（Xvfb + 真 Alacritty + ffmpeg 录制）
- E2E：`e2e_tui.py`（6 个场景 a–f）+ `docs/e2e/`（原始 pty 日志 + `report.md`），**46/46 PASS**

## 收尾三项任务结论

### 1. k3 误判 deepseek bug 复查 —— 已修复，无残留

`isDeepseekModel()` 现逻辑：

```ts
p === "deepseek" || p.includes("deepseek") || id.startsWith("deepseek")
```

对 `{provider: "kimi-coding", id: "k3"}` 判 `false`。真值表（6/6 过）：

| model | 期望 | 结果 |
|---|---|---|
| `kimi-coding/k3` | false | ✅ |
| `kimi/kimi-k2` | false | ✅ |
| `anthropic/claude-opus-4-1` | false | ✅ |
| `deepseek/deepseek-chat` | true | ✅ |
| `openrouter/deepseek/deepseek-v4` | true | ✅ |
| `undefined` | false | ✅ |

真实 TUI 回归（E2E 场景 A4）：k3 会话请求后显示绿 NORMAL 短逻辑行，无 `CACHE DEEPSEEK` / `EXTERNAL` 文本。
注意：`#3b82f6`（48;2;59;130;246）也被 pi-agent-swarm 状态栏徽章使用，颜色指纹不能单独作判据，须查文本。

### 2. GIF 展示图 —— 完成

管线：`demo-frames.mjs`（真实渲染函数出帧）→ `player.mjs`（真终端播放）→ `record_gifs.sh`（Xvfb :99 + Alacritty + x11grab + blackdetect 去黑边 + palettegen）。
重录：`./record_gifs.sh [scene ...]`。早期 PIL 管线（render_gif.py）因 CJK/Latin 基线错位已废弃删除。

### 3. 真实 pi TUI E2E —— 46/46 PASS（6 场景）

驱动：`e2e_tui.py`（Python pty，环境无 tmux/asciinema）。运行：`python3 -u e2e_tui.py [a|b|c|d|e|f]`（不带参数 = 全量）。

- **场景 A（真机 k3）**：待机不显示 → 首次请求出现 → 绿 NORMAL → `/facc` 菜单 aboveEditor↔belowEditor↔footer↔theme1/theme2 切换，`~/.pi/agent/facc.json` 复原 belowEditor + theme1。
- **场景 B（真机 deepseek-v4-pro 默认模型）**：`CACHE DEEPSEEK` 蓝徽章、`HH:MM:SS`（11:5x:xx）、`長 EXTERNAL 期`、`HIT%` 徽章、无短逻辑徽章。
- **场景 C（隔离 agent dir + 25s TTL 假模型 `e2e25/e2e-25s`）**：真实时间走完全周期 —— 绿 0.2s → 黄 3.7s → 橙 8.6s → 红 13.6s → 限界突破 24.6s，精确符合 25s 五等分；过期定格 `CACHE EXPIRED 限界突破` + `终 OVER 了` + `#b91c1c` 深红徽章。场景 C 用 `PI_CODING_AGENT_DIR=/tmp/facc-e2e-agent` 隔离，不污染全局配置；假模型指向 deepseek API 的无效 id（400 快速失败，`before_provider_request` 已触发，零费用）。
- **场景 D（真机 k3 + SIGWINCH 改宽）**：100→60→48→30→100 列，逐档验证 L1（丢 tick）/L2（盲文→4、状态取短 NORM）/L3（徽章砍限界、砍 cc、`●` 仍在）与恢复。
- **场景 E（本地 127.0.0.1 假服务、无 promptCache 声明）**：`CACHE 無限` 静态蓝徽章，无条/无时间/无状态/无 `●`，3s 后无新帧。
- **场景 F（隔离 agent dir + 6s TTL）—— 过期三阶段消解动画**：11 项断言。F1 盲文格数单调递减至 0；F2 每帧「条+时间」残段是上一帧的前缀（严格右→左）；F3 收拢 1.2s±0.7s 完成；F4 状态徽章底色在 119↔<45 之间振荡且峰值递减；F5 `终 OVER 了` 在 3.3s±0.7s 消失；F6/F7 4.5s 后屏幕只剩徽章且每个采样都在；F8 新请求后倒计时复活（可逆性）。

## 测试基建经验（复用价值）

- pi TUI 编辑器提示符不是 `❯`；就绪标记用启动横幅 keybinding 提示行（注意 ANSI 把 `ctrl+c/ctrl+d clear/exit` 打散，匹配前需剥离 SGR）。
- 扩展 83ms 渲染 tick 使输出流永不安静，drain 必须带 `max_s` 上限 + quiet 窗口。
- 新 agent dir 首启会弹项目信任对话框，E2E 需自动按 Enter 选 "Trust"。
- **关键：pi TUI 是「绝对光标定位 + 只重绘变化格子」的增量渲染**。只看 pty 字节流增量会丢未变化的格子（收拢中左侧已存在的数字看不到），必须用 `ScreenEmulator`（e2e_tui.py）把字节流回放成字符格子屏幕，再断言「此刻屏幕上真正显示什么」。颜色不在仿真器里（忽略 SGR），需从原始字节流 `rfind` 取最后一次出现的徽章底色。
- 动画类断言不能依赖「第一帧就是初始完整态」：`wait_for` 以 0.2s 粒度轮询，采样起点比真实过期时刻晚 ~0.25–0.3s。要断言**单调性/前缀关系**，不断言绝对起点。

## 关键提交

| commit | 内容 |
|---|---|
| `ef2131d` | 主体实现（五段短逻辑） |
| `0d475ca` | DeepSeek 12h 宏观模式 + HIT% |
| `57a07b2` | E2E 套件 + 报告 + 日志入库 |
| `1a6b4a6` | GIF 改真 Alacritty 录制 |
| `94e7099` | README 重复 Demo 段合并（双 worker 提交撞车） |
| `b49b6d0` | 窄宽度自适应三档（L1/L2/L3）+ footer 位置经 setStatus |
| `12fb2a1` | 本地/自托管 API ∞ 模式（`CACHE 無限`） |
| `7907f54` | 过期三阶段消解动画（`buildExpiredLine`：收拢 1.2s → 呼吸×3 2.1s → 徽章定格）+ `preview-expire.mjs` + E2E 场景 F + `ScreenEmulator` |
