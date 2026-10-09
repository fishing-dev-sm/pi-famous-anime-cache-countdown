/**
 * famous-anime-cache-countdown —— anime-style Cache Countdown
 *
 * 一行 widget 显示 Anthropic prompt cache TTL（5 分钟）倒计时，
 * 视觉与本目录 preview.mjs 的「一行简约版」一致：
 *   [反白徽章 CACHE 限界] [20 格 braille 条(垂直3级+中央tick)] [反白 MM:SS:cc] [五段状态徽章]
 *   状态（TTL 五等分）：NORMAL → 注 CAUTION 意 → 危 DANGER 険 → 緊 EMERGENCY 急 →（末段反相闪烁）
 * 过期（cache5分钟倒计时到了）后分三阶段消解（buildExpiredLine，时间轴 = -remainMs）：
 *   1) 「⣀…│⣀… 00:00:00」自右向左逐格收拢至消失（1.2s）
 *   2) 「 终 OVER 了 」呼吸闪烁 3 次后消失（2.1s）
 *   3) 「 CACHE EXPIRED 限界突破 」徽章永久保留，直到下一次请求重置
 * 窄宽度自适应三档缩略（tui_compact_design.md v3，preview-compact.mjs 预览）：
 *   L1 ≤60格：丢中央 tick + 盲文 20→10；L2 ≤44格：盲文→4 + 状态中英取短（注 CAUT 意）；
 *   L3 ≤26格：盲文→2 + cc/限界 才丢。铁律：盲文格数永远最先砍，● 永不丢。
 *   阈值（最坏宽度，实测）：Anthropic 66/54/43/25 · DeepSeek 76/65/49/18，<最小格才 truncate 兜底（無限仅徽章不适用）
 * DeepSeek 模型（provider/id 匹配，无 promptCache 声明、实测 cache 活 ≥12h）→ 12h 宏观倒计时：
 *   [CACHE DEEPSEEK] [braille 条] [HH:MM:SS] [長 EXTERNAL 期] [HIT 99%]，剩余 ≤300s 时无缝接入上方五段短逻辑
 * 本地/自托管 API（无 promptCache 声明、非 DeepSeek、baseUrl 指向 loopback/RFC1918 私网：
 *   qwen-local、vLLM、ollama 等）→ KV cache 无 TTL，不倒计时，只显示静态蓝徽章 [CACHE 無限]
 *   （与 DeepSeek 同属长期档、共用蓝系；无 braille 条/无 ∞/无状态徽章/无 ●）
 * 其他无声明云端模型（k3 等）→ 兜底 300s 短逻辑
 *
 * 测试：pi --extension ./index.ts
 * 命令：/facc 配置菜单（菜单 1 = 位置 aboveEditor/belowEditor/footer；
 *       菜单 2 = 主题配色 theme1 语言品牌色(默认) / theme2 原版 Tailwind；
 *       footer = ctx.ui.setStatus 进入 footer 体系（pi-slim-footer 插件行/内置状态行），不接管 footer）
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { parseColor, truncateToWidth } from "@earendil-works/pi-tui";
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const FALLBACK_TTL_MS = 5 * 60 * 1000; // Anthropic short retention = 300s；也是 DeepSeek 模式最后 5 分钟接入短逻辑的窗口
const DEEPSEEK_TTL_MS = 12 * 3600 * 1000; // DeepSeek（无 promptCache 声明）：实测 cache ≥12h 存活（2026-10 TTL probe）

// 缩略档位（tui_compact_design.md v3）：收窄丢列、永不截断。
// 丢弃铁律：盲文格数永远最先砍（20→10→4→2），中央 tick 仅完整版，● 任何档禁止丢弃。
type Tier = "full" | "L1" | "L2" | "L3";
const TIER_GAUGE: Record<Tier, number> = { full: 20, L1: 10, L2: 4, L3: 2 };
// 各档最坏宽度（相位文案最长者）：从 full 到 L3 取第一个放得下的档；<L3 才 truncate 兜底
const COUNTDOWN_MIN_W: Record<Tier, number> = { full: 66, L1: 54, L2: 43, L3: 25 };
const DEEPSEEK_MIN_W: Record<Tier, number> = { full: 76, L1: 65, L2: 49, L3: 18 };
const pickTier = (width: number, minW: Record<Tier, number>): Tier =>
	width >= minW.full ? "full" : width >= minW.L1 ? "L1" : width >= minW.L2 ? "L2" : "L3";
const FACC_WIDGET_KEY = "facc";
const CONFIG_PATH = join(homedir(), ".pi", "agent", "facc.json");

type Placement = "aboveEditor" | "belowEditor" | "footer";

type FaccConfig = { placement: Placement; theme: ThemeId };

/** 读配置（不存在/损坏 → 默认 belowEditor + theme1）。可随时加新键。 */
function loadConfig(): FaccConfig {
	try {
		const j = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
		return {
			placement: j.placement === "aboveEditor" || j.placement === "footer" ? j.placement : "belowEditor",
			theme: j.theme === "theme2" ? "theme2" : "theme1", // theme1 = 默认
		};
	} catch {
		return { placement: "belowEditor", theme: "theme1" };
	}
}

type PromptCacheModel = { provider?: string; id?: string; baseUrl?: string; promptCache?: { short?: number; long?: number } };

/** 仅限 DeepSeek（provider 或 id 匹配）——其 cache 无固定 TTL、实测 ≥12h；
 *  其他无声明模型（qwen-local 等）不适用 12h 模式。 */
function isDeepseekModel(model: PromptCacheModel | undefined | null): boolean {
	const p = (model?.provider ?? "").toLowerCase();
	const id = (model?.id ?? "").toLowerCase();
	return p === "deepseek" || p.includes("deepseek") || id.startsWith("deepseek");
}

/** 本地/自托管 API：baseUrl 主机是 loopback（localhost/127.x/::1/0.0.0.0）或 RFC1918 私网
 *  （10/8、172.16/12、192.168/16）——这类 server 的 KV cache 活在进程内存里，无 TTL。
 *  仅对未声明 promptCache 的模型有意义（调用方先查 declaredTtlMs / isDeepseekModel）。 */
function isLocalModel(model: PromptCacheModel | undefined | null): boolean {
	let host: string;
	try {
		host = new URL(model?.baseUrl ?? "").hostname.toLowerCase();
	} catch {
		return false;
	}
	if (host === "localhost" || host.endsWith(".localhost") || host === "::1" || host === "[::1]" || host === "0.0.0.0") return true;
	const m = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
	if (!m) return false;
	const a = Number(m[1]);
	const b = Number(m[2]);
	return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/** 模型自己声明的 TTL（无声明 → null，如 DeepSeek）。与 pi 内置 cache-warmer 的
 *  getPromptCacheTtlMs 同逻辑：model.promptCache[retention]，retention = PI_CACHE_RETENTION=long ? "long" : "short"。 */
function declaredTtlMs(model: PromptCacheModel | undefined | null): number | null {
	const retention = process.env.PI_CACHE_RETENTION === "long" ? "long" : "short";
	const sec = model?.promptCache?.[retention];
	return typeof sec === "number" && sec > 0 ? sec * 1000 : null;
}


// ── 主题（/facc 菜单切换）：theme1 = 语言品牌色（默认），theme2 = 原版 Tailwind ──
type ThemeId = "theme1" | "theme2";
type Phase = { main: string; hi: string; sub: string; tick: string };
type Theme = {
	id: ThemeId;
	label: string;
	phases: [Phase, Phase, Phase, Phase, Phase];
	dangerBg: string;
	pulseGreen: string;
	longTermPhase: Phase; // 长期档共用蓝系：DeepSeek 12h 宏观 + 本地 ∞（无 TTL 不倒计时）
};

// HSL 派生：只给主色，hi 提亮（400 级）/ sub 压暗（700 级）/ tick 居中偏暗（600 级）。
function hexToHsl(hex: string): [number, number, number] {
	const [r, g, b] = hexToRgb(hex).map((v) => v / 255);
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const l = (max + min) / 2;
	if (max === min) return [0, 0, l * 100];
	const d = max - min;
	const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
	let h: number;
	if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
	else if (max === g) h = (b - r) / d + 2;
	else h = (r - g) / d + 4;
	return [h * 60, s * 100, l * 100];
}
function hslToHex(h: number, s: number, l: number): string {
	h = ((h % 360) + 360) % 360;
	s /= 100;
	l /= 100;
	const c = (1 - Math.abs(2 * l - 1)) * s;
	const x = c * (1 - Math.abs((h / 60) % 2 - 1));
	const m = l - c / 2;
	let r = 0;
	let g = 0;
	let b = 0;
	if (h < 60) { r = c; g = x; b = 0; }
	else if (h < 120) { r = x; g = c; b = 0; }
	else if (h < 180) { r = 0; g = c; b = x; }
	else if (h < 240) { r = 0; g = x; b = c; }
	else if (h < 300) { r = x; g = 0; b = c; }
	else { r = c; g = 0; b = x; }
	const toHex = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
	return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}
const shiftLightness = (hex: string, dl: number): string => {
	const [h, s, l] = hexToHsl(hex);
	return hslToHex(h, s, Math.max(0, Math.min(100, l + dl)));
};
const derivePhase = (main: string): Phase => ({
	main,
	hi: shiftLightness(main, 18),
	sub: shiftLightness(main, -18),
	tick: shiftLightness(main, -9),
});

// theme1（默认）：编程语言品牌色 —— 绿 Vue / 黄 custom / 橙 Rust / 红 Scala / 蓝 TypeScript
const THEME1: Theme = {
	id: "theme1",
	label: "language palette (Vue/Scala/Rust/TS)",
	phases: [
		derivePhase("#41b883"), // 0 绿 sec > 240   CACHE NORMAL
		derivePhase("#ffc85a"), // 1 黄 240≥sec>180  注 CAUTION 意
		derivePhase("#dea584"), // 2 橙 180≥sec>120  危 DANGER 険
		derivePhase("#c22d40"), // 3 红 120≥sec>60  緊 EMERGENCY 急
		derivePhase("#c22d40"), // 4 红闪 sec ≤ 60   緊 EMERGENCY 急（反相闪烁）
	],
	dangerBg: shiftLightness("#c22d40", -18),
	pulseGreen: shiftLightness("#41b883", 18), // ● 运行指示：淡绿
	longTermPhase: derivePhase("#3178c6"), // 蓝系（长期：冷静/无需盯倒计时，与绿 NORMAL 区分）
};

// theme2：原版 Tailwind 调色板（500/400/700/600 级）
const THEME2: Theme = {
	id: "theme2",
	label: "original (Tailwind)",
	phases: [
		{ main: "#22c55e", hi: "#4ade80", sub: "#15803d", tick: "#16a34a" },
		{ main: "#eab308", hi: "#facc15", sub: "#a16207", tick: "#ca8a04" },
		{ main: "#f97316", hi: "#fb923c", sub: "#c2410c", tick: "#ea580c" },
		{ main: "#ef4444", hi: "#f87171", sub: "#b91c1c", tick: "#dc2626" },
		{ main: "#ef4444", hi: "#f87171", sub: "#b91c1c", tick: "#dc2626" },
	],
	dangerBg: "#b91c1c",
	pulseGreen: "#86efac",
	longTermPhase: { main: "#3b82f6", hi: "#60a5fa", sub: "#1d4ed8", tick: "#2563eb" },
};

let ACTIVE: Theme = THEME1; // 默认 theme1；default export 里按 ~/.pi/agent/facc.json 覆盖

const phaseOf = (sec: number, totalSec: number) => {
	const b = totalSec / 5;
	return sec > 4 * b ? 0 : sec > 3 * b ? 1 : sec > 2 * b ? 2 : sec > b ? 3 : 4;
};

/** 上色函数签名：fg 十六进制，bg 可选（badge 用） */
export type StyleFn = (text: string, fgHex: string, bgHex?: string) => string;

const LEVELS = ["⣀", "⣤", "⣶", "⣿"]; // 0=空轨, 1..3=垂直填充级（底部点阵→满）

/** braille 条：每格垂直 3 级、从右往左烧尽、末段 sec<=20 最后 2 格 500ms 闪烁。
 *  中央 tick 仅完整版（v3：L1 起丢）；格数 = TIER_GAUGE[tier]，分辨率 = 格数×3 步。 */
function buildBar(cells: number, sec: number, totalSec: number, P: Phase, nowMs: number, withTick: boolean, style: StyleFn): string {
	const units = Math.round((Math.min(sec, totalSec) / totalSec) * cells * 3);
	const blinkEdge = sec <= 20 ? 2 : 0;
	const blinkOn = Math.floor(nowMs / 500) % 2 === 0;
	let bar = "";
	for (let i = 0; i < cells; i++) {
		const level = Math.max(0, Math.min(3, units - (cells - 1 - i) * 3));
		const edgeOff = blinkEdge > 0 && level > 0 && i >= cells - blinkEdge && !blinkOn;
		bar += style(edgeOff ? "⣀" : LEVELS[level], P.main);
		if (withTick && i === cells / 2 - 1) bar += style("│", P.tick);
	}
	return bar;
}

// 状态徽章文案：full/L1 = 中英全长；L2 = 中英取短（双语俱在不丢弃）；L3 = 单字
const STATUS_FULL = [" NORMAL ", " 注 CAUTION 意 ", " 危 DANGER 険 ", " 緊 EMERGENCY 急 ", " 緊 EMERGENCY 急 "];
const STATUS_L2 = [" NORM ", " 注 CAUT 意 ", " 危 DANG 険 ", " 緊 EMER 急 ", " 緊 EMER 急 "];
const STATUS_L3 = [" 常 ", " 注 ", " 危 ", " 緊 ", " 緊 "];

/** 状态徽章：绿/黄/橙反白（main 底），红 = 白字 on #b91c1c，红闪（≤60s）400ms 反相闪烁 */
function buildStatus(e: number, P: Phase, nowMs: number, tier: Tier, style: StyleFn): string {
	const text = (tier === "L2" ? STATUS_L2 : tier === "L3" ? STATUS_L3 : STATUS_FULL)[e];
	if (e <= 2) return style(text, contrastFg(P.main), P.main);
	if (e === 3) return style(text, "#ffffff", ACTIVE.dangerBg);
	return Math.floor(nowMs / 400) % 2 === 0
		? style(text, "#ffffff", ACTIVE.dangerBg)
		: style(text, ACTIVE.dangerBg, P.hi); // 灭相：暗红字/亮红底 反相
}

/** 反白时间：withCc = MM:SS:cc（cc 末位 sub 暗色弱化，LiveSplit 式）；否则 MM:SS（L3，反白保留） */
function buildTime(sec: number, centi: number, P: Phase, withCc: boolean, style: StyleFn): string {
	const mm = String(Math.floor(sec / 60)).padStart(2, "0");
	const ss = String(sec % 60).padStart(2, "0");
	if (!withCc) return style(` ${mm}:${ss} `, contrastFg(P.main), P.main);
	const cc = String(centi).padStart(2, "0");
	const digit = (s: string) => style(s, contrastFg(P.main), P.main);
	return digit(" " + mm + ":" + ss + ":" + cc[0]) + style(cc[1], P.sub, P.main) + digit(" ");
}

// ══ 限界突破消解动画（过期后三阶段，纯函数）══════════════════════════════════
// 时间轴由 age = -remainMs（过期后经过的毫秒）驱动 → 不需要任何外部状态，
// 且天然可逆：下一次请求让 remainMs 回到正数，动画自动作废、倒计时恢复。
//   阶段1 [0, COLLAPSE)          ：「⣀…│⣀… 00:00:00」自右向左逐格收拢直到消失
//   阶段2 [COLLAPSE, +3×BREATH)  ：「 终 OVER 了 」呼吸闪烁 3 次（峰值逐次变暗）后消失
//   阶段3 之后                    ：只保留「 CACHE EXPIRED 限界突破 」徽章（永久定格）
const EXPIRE_COLLAPSE_MS = 1200; // 阶段1 时长（30 格 ÷ 1200ms ≈ 40ms/格，与 83ms 渲染 tick 兼容）
const EXPIRE_BREATH_MS = 700; // 阶段2 单次呼吸周期
const EXPIRE_BREATHS = 3; // 阶段2 呼吸次数

/** RGB 线性插值（#rrggbb × #rrggbb → #rrggbb），t=0 → a，t=1 → b。呼吸淡出用。 */
function mixHex(a: string, b: string, t: number): string {
	const [r1, g1, b1] = hexToRgb(a);
	const [r2, g2, b2] = hexToRgb(b);
	const m = (x: number, y: number) => Math.round(x + (y - x) * Math.max(0, Math.min(1, t)));
	return `#${[m(r1, r2), m(g1, g2), m(b1, b2)].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** 阶段2：状态徽章呼吸。env=1 实色 → env=0 与终端底色同化（不可见）；3 次后返回 ""（消失）。 */
function buildExpireStatus(ageMs: number, tier: Tier, style: StyleFn): string {
	const text = tier === "full" ? "终 OVER 了" : tier === "L1" ? " 终 OVER 了 " : tier === "L3" ? " 终 " : " 终了 ";
	const start = EXPIRE_COLLAPSE_MS;
	const end = start + EXPIRE_BREATHS * EXPIRE_BREATH_MS;
	if (ageMs >= end) return "";
	let env = 1;
	if (ageMs >= start) {
		const p = (ageMs - start) / EXPIRE_BREATH_MS; // 0..3
		// 余弦包络（1→0→1→0→1→0→1）× 线性衰减（1→0）= 三次呼吸一峰比一峰暗，收尾正好全灭
		env = (0.5 + 0.5 * Math.cos(2 * Math.PI * p)) * (1 - p / EXPIRE_BREATHS);
	}
	const off = shiftLightness(ACTIVE.dangerBg, -20); // 近黑（带一点红相）≈ 终端底色，淡出终点
	return style(text, mixHex(off, contrastFg(ACTIVE.dangerBg), env), mixHex(off, ACTIVE.dangerBg, env));
}

/**
 * 过期态渲染（纯函数）。age = -remainMs 决定动画阶段；tier 同 buildCountdownLine。
 * 收拢以「可见格」为单位（每个 atom = 1 列），故 ANSI 串不会被切坏。
 */
export function buildExpiredLine(remainMs: number, style: StyleFn, tier: Tier = "full"): string {
	const cells = TIER_GAUGE[tier];
	const withTick = tier === "full";
	const P3 = ACTIVE.phases[3];
	const age = Math.max(0, -remainMs);

	// 阶段3：徽章永不参与消解
	const badge = style(
		tier === "full" ? " CACHE EXPIRED 限界突破 " : tier === "L3" ? " 突破 " : " CACHE 限界突破 ",
		contrastFg(P3.main),
		P3.main,
	);

	// 阶段1：空条 + 中央 tick + 时间 → 逐格自右向左收拢
	const atoms: string[] = [];
	for (let i = 0; i < cells; i++) {
		atoms.push(style("⣀", P3.main));
		if (withTick && i === cells / 2 - 1) atoms.push(style("│", P3.tick));
	}
	atoms.push(" ");
	for (const ch of tier === "L3" ? "00:00" : "00:00:00") atoms.push(style(ch, P3.main));
	const keep = Math.max(0, Math.ceil((atoms.length * (EXPIRE_COLLAPSE_MS - age)) / EXPIRE_COLLAPSE_MS));
	const seg = keep > 0 ? atoms.slice(0, keep).join("") : "";

	// 阶段2：状态徽章呼吸 3 次后消失
	const status = buildExpireStatus(age, tier, style);

	return [badge, seg, status].filter((s) => s !== "").join(" ");
}

/**
 * 构建一行倒计时（纯函数，可测试）。tier = "full" | "L1" | "L2" | "L3"（默认 full）。
 * 布局：反白徽章 + 空格 + braille条(格数随档) + ● + 反白时间 + 状态徽章
 */
export function buildCountdownLine(remainMs: number, totalMs: number, nowMs: number, style: StyleFn, tier: Tier = "full"): string {
	const cells = TIER_GAUGE[tier];
	const withTick = tier === "full"; // 中央 tick 仅完整版（L1 起丢）

	// 限界突破（过期）：三阶段消解动画（收拢 → 呼吸 → 徽章定格）；无 ●（「死了才不闪」）
	if (remainMs <= 0) return buildExpiredLine(remainMs, style, tier);

	const totalSec = totalMs / 1000;
	const sec = Math.floor(Math.max(0, remainMs) / 1000);
	const centi = Math.floor((Math.max(0, remainMs) % 1000) / 10);
	const e = phaseOf(sec, totalSec);
	const P = ACTIVE.phases[e];

	// 1. 反白徽章（底=当前段 main，字色按 WCAG 亮度选黑/白）；L3 砍 限界
	const titleBadge = style(tier === "L3" ? " CACHE " : " CACHE 限界 ", contrastFg(P.main), P.main);

	// 2. braille 条（格数随档，● 之前的核心弹性元件）
	const bar = buildBar(cells, sec, totalSec, P, nowMs, withTick, style);

	// 3. 反白时间：full/L1/L2 带 cc（渲染 tick=83ms 与 cc 末位 10ms 周期不整除 → 末位自然轮转 0-9，
	//    真实秒表效果）；L3 砍 cc 但反白保留
	const timeBadge = buildTime(sec, centi, P, tier !== "L3", style);

	// 4. ● 运行指示（铁律：任何档禁止丢弃）：淡绿 90ms 独立相位闪烁（与 83ms 渲染 tick 错开）
	const pulse = Math.floor(nowMs / 90) % 2 === 0 ? style("●", ACTIVE.pulseGreen) : " ";

	// 5. 状态徽章（文案随档取短）
	const status = buildStatus(e, P, nowMs, tier, style);

	return `${titleBadge} ${bar} ${pulse} ${timeBadge} ${status}`;
}

/**
 * DeepSeek 12h 宏观倒计时（纯函数），tier 同上。布局：
 * [CACHE DEEPSEEK] + braille条(12h 总量) + 反白 HH:MM:SS + [長 EXTERNAL 期] + [HIT 99%]
 * L1：丢 tick + 盲文 20→10；L2：盲文→4 + HIT% 丢（只是个百分比）；L3：徽章→ CACHE + 盲文→2 + HH:MM。
 * 无 ● 无 cc（秒级精度足够）；HIT% = 上次响应 usage 的真实命中率（cacheRead/(cacheRead+input)，
 * DeepSeek 免费返回）；remain ≤300s 不由本函数渲染（接入 buildCountdownLine 短逻辑）。
 */
export function buildDeepseekLine(remainMs: number, totalMs: number, hitRate: number | null, style: StyleFn, tier: Tier = "full"): string {
	const P = ACTIVE.longTermPhase;
	const totalSec = totalMs / 1000;
	const sec = Math.floor(Math.max(0, remainMs) / 1000);
	const bar = buildBar(TIER_GAUGE[tier], sec, totalSec, P, 0, tier === "full", style);

	const hh = String(Math.floor(sec / 3600)).padStart(2, "0");
	const mm = String(Math.floor((sec % 3600) / 60)).padStart(2, "0");
	const ss = String(sec % 60).padStart(2, "0");
	if (tier === "L3") {
		const badge = style(" CACHE ", contrastFg(P.main), P.main); // 蓝底 = DS 身份
		return `${badge} ${bar} ${style(` ${hh}:${mm} `, contrastFg(P.main), P.main)}`;
	}
	const titleBadge = style(" CACHE DEEPSEEK ", contrastFg(P.main), P.main);
	const timeBadge = style(` ${hh}:${mm}:${ss} `, contrastFg(P.main), P.main);
	const status = style(" 長 EXTERNAL 期 ", contrastFg(P.main), P.main);
	if (tier === "L2") return `${titleBadge} ${bar} ${timeBadge} ${status}`; // HIT% 只是个百分比，本档起丢
	const hit = style(hitRate === null ? " HIT --% " : ` HIT ${Math.round(hitRate * 100)}% `, contrastFg(P.sub), P.sub);
	return `${titleBadge} ${bar} ${timeBadge} ${status} ${hit}`;
}

/**
 * 本地/自托管 API ∞ 模式（纯函数）：本地 KV cache 无 TTL，倒计时无意义——
 * 只显示静态蓝徽章 [CACHE 無限]（与 DeepSeek 共用蓝系，同属长期档）。
 * 无 braille 条、无 ∞、无状态徽章、无 ●；宽度无关，不分档。
 */
export function buildInfiniteLine(style: StyleFn): string {
	const P = ACTIVE.longTermPhase;
	return style(" CACHE 無限 ", contrastFg(P.main), P.main);
}

function hexToRgb(hex: string): [number, number, number] {
	return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

/**
 * WCAG 对比度选反白字色（与 preview.mjs / pi-fleet color.ts 的 contrastTextColor 一致）：
 * gamma 校正相对亮度，黑/白谁对比度高用谁（#ef4444 红底 → 黑字）。
 */
function contrastFg(bgHex: string): string {
	const [r, g, b] = hexToRgb(bgHex);
	const ch = (v: number) => {
		const s = v / 255;
		return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
	};
	const lum = 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
	return (lum + 0.05) / 0.05 >= 1.05 / (lum + 0.05) ? "#000000" : "#ffffff";
}

// ══ footer 模式：进入 footer 体系（ctx.ui.setStatus），而非接管 footer ══
// pi-slim-footer（或内置 footer）把 setStatus 文本收进插件行/状态行统一排版；
// 自带 ANSI 的 status 原样透传（slim-footer hasOwnAnsi），所以这里自造真色 ANSI。
// setStatus 不给宽度 → 用 process.stdout.columns 选档（83ms tick 持续刷新，resize 即生效）。
function ansiStyle(text: string, fgHex: string, bgHex?: string): string {
	const f = hexToRgb(fgHex);
	let s = `\x1b[38;2;${f.join(";")}m`;
	if (bgHex) s += `\x1b[48;2;${hexToRgb(bgHex).join(";")}m`;
	return `${s}${text}\x1b[0m`;
}

export default function (pi: ExtensionAPI) {
	let lastCacheAt: number | null = null; // null = 尚未有任何请求（无 cache entry），待机不计时
	let lastHitRate: number | null = null; // 上次响应 usage 的真实命中率（cacheRead/(cacheRead+input)）
	let timer: ReturnType<typeof setInterval> | null = null;
	let tuiRef: TUI | null = null;
	let ctxRef: ExtensionContext | null = null;
	const cfg = loadConfig();
	let placement: Placement = cfg.placement;
	ACTIVE = cfg.theme === "theme2" ? THEME2 : THEME1; // 主题读自 config（默认 theme1）

	const saveConfig = () => {
		try {
			writeFileSync(CONFIG_PATH, JSON.stringify({ placement, theme: ACTIVE.id }, null, 2));
		} catch {
			/* 配置写不进去就算了，本次会话内生效 */
		}
	};

	// 渲染 tick：83ms 与 cc 末位 10ms 周期不整除 → 末位自然轮转、不显静止
	// （100ms 会 10:1 相位锁死）；也与 ● 的 90ms 闪烁相位错开
	const tick = () => {
		tuiRef?.requestRender();
		// footer 档位没有组件渲染回调（setStatus 是推模式）→ tick 里直接重发倒计时行
		if (placement === "footer" && ctxRef?.mode === "tui") updateFooterStatus(ctxRef);
	};

	const stopTimer = () => {
		if (timer) {
			clearInterval(timer);
			timer = null;
		}
	};

	// 挂法：aboveEditor/belowEditor = ctx.ui.setWidget（editor 上/下插槽）；
	// footer = ctx.ui.setStatus 进入 footer 体系（pi-slim-footer 插件行 / 内置 footer 状态行，
	// 不接管 footer）。待机（无任何请求）= 不显示：widget 档位不安装 widget，footer 档位清 status。
	// 位置可配（/facc 菜单，存 ~/.pi/agent/facc.json）。
	let installed = false; // widget 档位是否已安装（footer 档位无需安装，setStatus 直发）

	// 倒计时行（宽度自适应选档）；待机返回 null
	const renderCountdownLine = (width: number, style: StyleFn): string | null => {
		if (lastCacheAt === null) return null;
		const now = Date.now();
		const declared = declaredTtlMs(ctxRef?.model);
		// 本地/自托管 API（无声明、非 DeepSeek、baseUrl 为 loopback/私网）：KV cache 无 TTL，
		// 不倒计时，静态 ∞ 行；其他无声明云端模型（k3 等）仍兜底 300s 短逻辑
		if (declared === null && !isDeepseekModel(ctxRef?.model) && isLocalModel(ctxRef?.model)) {
			return truncateToWidth(buildInfiniteLine(style), width);
		}
		const ttlMs = declared ?? (isDeepseekModel(ctxRef?.model) ? DEEPSEEK_TTL_MS : FALLBACK_TTL_MS);
		const remainMs = lastCacheAt + ttlMs - now;
		// DeepSeek 模式：>300s 走 12h 宏观行；≤300s 无缝接入五段短逻辑（窗口=300s）
		const dsMacro = declared === null && ttlMs === DEEPSEEK_TTL_MS && remainMs > FALLBACK_TTL_MS;
		// 宽度自适应（tui_compact_design.md v3）：收窄丢列、永不截断——
		// 按各档最坏宽度阈值从 full 到 L3 取第一个放得下的档；<L3 最小宽度才 truncate 兜底
		const tier = pickTier(width, dsMacro ? DEEPSEEK_MIN_W : COUNTDOWN_MIN_W);
		const line = dsMacro
			? buildDeepseekLine(remainMs, ttlMs, lastHitRate, style, tier)
			: buildCountdownLine(remainMs, declared ?? FALLBACK_TTL_MS, now, style, tier);
		return truncateToWidth(line, width);
	};

	const installWidget = (ctx: ExtensionContext) => {
		ctx.ui.setWidget(FACC_WIDGET_KEY, (_tui, theme) => {
			tuiRef = _tui;
			const style: StyleFn = (text, fgHex, bgHex) =>
				theme.style(text, { fg: parseColor(fgHex), ...(bgHex ? { bg: parseColor(bgHex) } : {}) });
			return {
				render(width: number): string[] {
					const line = renderCountdownLine(width, style);
					return line === null ? [] : [line]; // 待机不渲染（widget 档位只有首次请求后才安装，理论到不了这里）
				},
				invalidate() {},
				dispose() {
					if (tuiRef === _tui) tuiRef = null;
				},
			};
		}, { placement: placement === "footer" ? "belowEditor" : placement }); // footer 档位不走这里，仅兜底类型
	};

	// footer 档位：83ms tick 驱动，经 setStatus 把倒计时行发进 footer 体系（待机清 status）
	const updateFooterStatus = (ctx: ExtensionContext) => {
		const width = process.stdout.columns || 80; // setStatus 不给宽度 → 读终端列数选档
		const line = renderCountdownLine(width, ansiStyle);
		ctx.ui.setStatus(FACC_WIDGET_KEY, line ?? undefined);
	};

	const install = (ctx: ExtensionContext) => {
		if (ctx.mode !== "tui") return;
		if (placement === "footer") {
			updateFooterStatus(ctx); // 无需安装；待机等下个 tick
			return;
		}
		if (installed) return;
		installed = true;
		installWidget(ctx);
	};

	// 卸载（幂等清两种挂法：setWidget undefined 移除 widget / setStatus undefined 清插件行）
	const uninstall = (ctx: ExtensionContext) => {
		if (installed) {
			installed = false;
			ctx.ui.setWidget(FACC_WIDGET_KEY, undefined);
		}
		ctx.ui.setStatus(FACC_WIDGET_KEY, undefined);
	};

	pi.on("session_start", (_ev, ctx) => {
		ctxRef = ctx;
		lastCacheAt = null; // 无请求不计时（逻辑与 cache-warmer "waiting for first request" 一致）
		if (ctx.mode !== "tui") return;

		// footer 档位（setStatus）：待机清掉倒计时插件行
		if (placement === "footer") ctx.ui.setStatus(FACC_WIDGET_KEY, undefined);

		// 幂等启动渲染 tick。83ms：与 cc 末位 10ms 周期不整除 → 末位自然轮转、
		// 不显静止（100ms 会 10:1 相位锁死）；也与 ● 的 90ms 闪烁相位错开
		stopTimer();
		timer = setInterval(tick, 83);
	});

	// 触发/重置逻辑学习自 pi 内置 cache-warmer（core/sdk.ts:404）：每个发往 provider 的
	// 请求都会重写 cache entry → 请求发出即重置。before_provider_request 在 HTTP 调用前
	// 触发，起点=请求发出时刻（长生成不吃掉倒计时）；warmer 保活重放经同一 streamFn 也会
	// 触发本事件，另监听 cache_warming_decision 双保险（warm 刷新成功即延长 cache）。
	const onCacheWrite = (ctx: ExtensionContext) => {
		lastCacheAt = Date.now();
		install(ctx); // widget 档位首次请求才出现；footer 档位已装（session_start），此处幂等
	};
	pi.on("before_provider_request", (_ev, ctx) => onCacheWrite(ctx));
	pi.on("cache_warming_decision", (ev, ctx) => {
		if (ev.action === "warm") onCacheWrite(ctx);
	});

	// HIT% 数据源：响应 usage 免费带回（DeepSeek prompt_cache_hit_tokens → cacheRead；
	// pi-ai openai-completions: input = prompt_tokens - cacheRead - cacheWrite）
	pi.on("message_end", (ev) => {
		const u = (ev.message as { usage?: { input?: number; cacheRead?: number } }).usage;
		if (u && typeof u.input === "number" && typeof u.cacheRead === "number" && u.input + u.cacheRead > 0) {
			lastHitRate = u.cacheRead / (u.input + u.cacheRead);
		}
	});

	pi.on("session_shutdown", () => {
		stopTimer();
		tuiRef = null;
		ctxRef = null;
	});

	pi.registerCommand("facc", {
		description: "famous-anime-cache-countdown settings menu",
		handler: async (_args, ctx: ExtensionContext) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify(`facc: no UI in this mode — edit ${CONFIG_PATH} directly`, "warning");
				return;
			}
			// 菜单 1：widget 位置 aboveEditor / belowEditor / footer
			const cur = placement;
			const choice = await ctx.ui.select("facc settings · widget placement", [
				`aboveEditor  above the editor (below the status line)${cur === "aboveEditor" ? "  ● current" : ""}`,
				`belowEditor  below the editor (above the footer)${cur === "belowEditor" ? "  ● current" : ""}`,
				`footer       in the footer status line (via setStatus, e.g. pi-slim-footer plugin line)${cur === "footer" ? "  ● current" : ""}`,
			]);
			if (!choice) return; // cancelled
			const next: Placement = choice.startsWith("aboveEditor") ? "aboveEditor" : choice.startsWith("footer") ? "footer" : "belowEditor";

			// 菜单 2：主题配色 theme1（默认，语言品牌色）/ theme2（原版 Tailwind）
			const curTheme = ACTIVE.id;
			const themeChoice = await ctx.ui.select("facc settings · theme", [
				`theme1  ${THEME1.label} (default)${curTheme === "theme1" ? "  ● current" : ""}`,
				`theme2  ${THEME2.label}${curTheme === "theme2" ? "  ● current" : ""}`,
			]);
			if (!themeChoice) return; // cancelled
			const nextTheme: ThemeId = themeChoice.startsWith("theme1") ? "theme1" : "theme2";

			const placementChanged = next !== cur;
			const themeChanged = nextTheme !== curTheme;
			if (placementChanged) placement = next;
			if (themeChanged) ACTIVE = nextTheme === "theme1" ? THEME1 : THEME2;
			if (!placementChanged && !themeChanged) {
				ctx.ui.notify("facc: settings unchanged", "info");
				return;
			}
			saveConfig();
			// tear down + reinstall = move（uninstall 幂等清两种挂法；footer ↔ widget 互移、换主题同样适用）
			uninstall(ctx);
			install(ctx);
			const msg = [placementChanged ? `placement → ${next}` : null, themeChanged ? `theme → ${nextTheme}` : null]
				.filter(Boolean)
				.join(", ");
			ctx.ui.notify(`facc: ${msg}`, "info");
		},
	});

}
