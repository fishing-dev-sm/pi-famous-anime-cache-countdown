/**
 * famous-anime-cache-countdown —— anime-style Cache Countdown
 *
 * 一行 widget 显示 Anthropic prompt cache TTL（5 分钟）倒计时，
 * 视觉与本目录 preview.mjs 的「一行简约版」一致：
 *   [反白徽章 CACHE 限界] [20 格 braille 条(垂直3级+中央tick)] [反白 MM:SS:cc] [五段状态徽章]
 *   状态（TTL 五等分）：NORMAL → 注 CAUTION 意 → 危 DANGER 険 → 緊 EMERGENCY 急 →（末段反相闪烁）
 * 窄宽度自适应三档缩略（tui_compact_design.md v3，preview-compact.mjs 预览）：
 *   L1 ≤60格：丢中央 tick + 盲文 20→10；L2 ≤44格：盲文→4 + 状态中英取短（注 CAUT 意）；
 *   L3 ≤26格：盲文→2 + cc/限界 才丢。铁律：盲文格数永远最先砍，● 永不丢。
 *   阈值（最坏宽度，实测）：Anthropic 66/54/43/25 · DeepSeek 76/65/49/18，<最小格才 truncate 兜底
 * DeepSeek 模型（provider/id 匹配，无 promptCache 声明、实测 cache 活 ≥12h）→ 12h 宏观倒计时：
 *   [CACHE DEEPSEEK] [braille 条] [HH:MM:SS] [長 EXTERNAL 期] [HIT 99%]，剩余 ≤300s 时无缝接入上方五段短逻辑
 * 其他无声明模型（qwen-local 等）→ 兜底 300s 短逻辑
 *
 * 测试：pi --extension ./index.ts
 * 命令：/facc 配置菜单（第一个菜单 = 位置 aboveEditor/belowEditor/footer；
 *       footer = ctx.ui.setStatus 进入 footer 体系（pi-slim-footer 插件行/内置状态行），不接管 footer）
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { parseColor, truncateToWidth } from "@earendil-works/pi-tui";
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const FALLBACK_TTL_MS = 5 * 60 * 1000; // Anthropic short retention = 300s；也是 DeepSeek 模式最后 5 分钟接入短逻辑的窗口
const DEEPSEEK_TTL_MS = 12 * 3600 * 1000; // 无 promptCache 声明的模型（DeepSeek）：实测 cache ≥12h 存活（2026-10 TTL probe）

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

/** 读配置（不存在/损坏 → 默认 belowEditor）。可随时加新键。 */
function loadPlacement(): Placement {
	try {
		const j = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
		return j.placement === "aboveEditor" || j.placement === "footer" ? j.placement : "belowEditor";
	} catch {
		return "belowEditor";
	}
}

type PromptCacheModel = { provider?: string; id?: string; promptCache?: { short?: number; long?: number } };

/** 仅限 DeepSeek（provider 或 id 匹配）——其 cache 无固定 TTL、实测 ≥12h；
 *  其他无声明模型（qwen-local 等）不适用 12h 模式。 */
function isDeepseekModel(model: PromptCacheModel | undefined | null): boolean {
	const p = (model?.provider ?? "").toLowerCase();
	const id = (model?.id ?? "").toLowerCase();
	return p === "deepseek" || p.includes("deepseek") || id.startsWith("deepseek");
}

/** 模型自己声明的 TTL（无声明 → null，如 DeepSeek）。与 pi 内置 cache-warmer 的
 *  getPromptCacheTtlMs 同逻辑：model.promptCache[retention]，retention = PI_CACHE_RETENTION=long ? "long" : "short"。 */
function declaredTtlMs(model: PromptCacheModel | undefined | null): number | null {
	const retention = process.env.PI_CACHE_RETENTION === "long" ? "long" : "short";
	const sec = model?.promptCache?.[retention];
	return typeof sec === "number" && sec > 0 ? sec * 1000 : null;
}

/** 有效 TTL：有声明用声明；DeepSeek 按实测 12h；其他无声明模型兜底 300s。 */
function ttlMsOf(model: PromptCacheModel | undefined | null): number {
	return declaredTtlMs(model) ?? (isDeepseekModel(model) ? DEEPSEEK_TTL_MS : FALLBACK_TTL_MS);
}

// 五段等分：总 TTL 均分 5 段（300s → 每 60s 一段），色号沿用 preview.mjs 调色板
const PHASES = [
	{ main: "#22c55e", hi: "#4ade80", sub: "#15803d", tick: "#16a34a" }, // 0 绿 sec > 240   CACHE NORMAL
	{ main: "#eab308", hi: "#facc15", sub: "#a16207", tick: "#ca8a04" }, // 1 黄 240≥sec>180  注 CAUTION 意
	{ main: "#f97316", hi: "#fb923c", sub: "#c2410c", tick: "#ea580c" }, // 2 橙 180≥sec>120  危 DANGER 険
	{ main: "#ef4444", hi: "#f87171", sub: "#b91c1c", tick: "#dc2626" }, // 3 红 120≥sec>60  緊 EMERGENCY 急
	{ main: "#ef4444", hi: "#f87171", sub: "#b91c1c", tick: "#dc2626" }, // 4 红闪 sec ≤ 60   緊 EMERGENCY 急（反相闪烁）
];
const DANGER_BG = "#b91c1c";
const PULSE_GREEN = "#86efac"; // ● 运行指示：非常淡的绿色
// DeepSeek 12h 宏观模式配色：蓝系（冷静/长期，与绿 NORMAL 区分）
const DEEPSEEK_PHASE = { main: "#3b82f6", hi: "#60a5fa", sub: "#1d4ed8", tick: "#2563eb" };

const phaseOf = (sec: number, totalSec: number) => {
	const b = totalSec / 5;
	return sec > 4 * b ? 0 : sec > 3 * b ? 1 : sec > 2 * b ? 2 : sec > b ? 3 : 4;
};

/** 上色函数签名：fg 十六进制，bg 可选（badge 用） */
export type StyleFn = (text: string, fgHex: string, bgHex?: string) => string;

type Phase = (typeof PHASES)[number];
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
	if (e === 3) return style(text, "#ffffff", DANGER_BG);
	return Math.floor(nowMs / 400) % 2 === 0
		? style(text, "#ffffff", DANGER_BG)
		: style(text, DANGER_BG, P.hi); // 灭相：暗红字/亮红底 反相
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

/**
 * 构建一行倒计时（纯函数，可测试）。tier = "full" | "L1" | "L2" | "L3"（默认 full）。
 * 布局：反白徽章 + 空格 + braille条(格数随档) + ● + 反白时间 + 状态徽章
 */
export function buildCountdownLine(remainMs: number, totalMs: number, nowMs: number, style: StyleFn, tier: Tier = "full"): string {
	const cells = TIER_GAUGE[tier];
	const withTick = tier === "full"; // 中央 tick 仅完整版（L1 起丢）
	const P3 = PHASES[3];

	// 限界突破（过期）：红色定格 —— 空条 + 红色时间不反白 + 无 ●（「死了才不闪」）
	if (remainMs <= 0) {
		const bar = buildBar(cells, 0, totalMs / 1000, P3, nowMs, withTick, style);
		if (tier === "full") {
			const titleBadge = style(" CACHE EXPIRED 限界突破 ", contrastFg(P3.main), P3.main);
			return `${titleBadge} ${bar} ${style("00:00:00", P3.main)} ${style("终 OVER 了", contrastFg(DANGER_BG), DANGER_BG)}`;
		}
		if (tier === "L3") {
			return `${style(" 突破 ", contrastFg(P3.main), P3.main)} ${bar} ${style("00:00", P3.main)} ${style(" 终 ", contrastFg(DANGER_BG), DANGER_BG)}`;
		}
		const badge = style(" CACHE 限界突破 ", contrastFg(P3.main), P3.main);
		const status = tier === "L1" ? " 终 OVER 了 " : " 终了 ";
		return `${badge} ${bar} ${style("00:00:00", P3.main)} ${style(status, contrastFg(DANGER_BG), DANGER_BG)}`;
	}

	const totalSec = totalMs / 1000;
	const sec = Math.floor(Math.max(0, remainMs) / 1000);
	const centi = Math.floor((Math.max(0, remainMs) % 1000) / 10);
	const e = phaseOf(sec, totalSec);
	const P = PHASES[e];

	// 1. 反白徽章（底=当前段 main，字色按 WCAG 亮度选黑/白）；L3 砍 限界
	const titleBadge = style(tier === "L3" ? " CACHE " : " CACHE 限界 ", contrastFg(P.main), P.main);

	// 2. braille 条（格数随档，● 之前的核心弹性元件）
	const bar = buildBar(cells, sec, totalSec, P, nowMs, withTick, style);

	// 3. 反白时间：full/L1/L2 带 cc（渲染 tick=83ms 与 cc 末位 10ms 周期不整除 → 末位自然轮转 0-9，
	//    真实秒表效果）；L3 砍 cc 但反白保留
	const timeBadge = buildTime(sec, centi, P, tier !== "L3", style);

	// 4. ● 运行指示（铁律：任何档禁止丢弃）：淡绿 90ms 独立相位闪烁（与 83ms 渲染 tick 错开）
	const pulse = Math.floor(nowMs / 90) % 2 === 0 ? style("●", PULSE_GREEN) : " ";

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
	const P = DEEPSEEK_PHASE;
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
	let placement: Placement = loadPlacement();

	const saveConfig = () => {
		try {
			writeFileSync(CONFIG_PATH, JSON.stringify({ placement }, null, 2));
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
		const deepseek = declared === null && isDeepseekModel(ctxRef?.model);
		const ttlMs = declared ?? (deepseek ? DEEPSEEK_TTL_MS : FALLBACK_TTL_MS);
		const remainMs = lastCacheAt + ttlMs - now;
		// DeepSeek 模式：>300s 走 12h 宏观行；≤300s 无缝接入五段短逻辑（窗口=300s）
		const dsMacro = deepseek && remainMs > FALLBACK_TTL_MS;
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
			// First menu: widget placement aboveEditor / belowEditor / footer
			const cur = placement;
			const choice = await ctx.ui.select("facc settings · widget placement", [
				`aboveEditor  above the editor (below the status line)${cur === "aboveEditor" ? "  ● current" : ""}`,
				`belowEditor  below the editor (above the footer)${cur === "belowEditor" ? "  ● current" : ""}`,
				`footer       in the footer status line (via setStatus, e.g. pi-slim-footer plugin line)${cur === "footer" ? "  ● current" : ""}`,
			]);
			if (!choice) return; // cancelled
			const next: Placement = choice.startsWith("aboveEditor") ? "aboveEditor" : choice.startsWith("footer") ? "footer" : "belowEditor";
			if (next === cur) {
				ctx.ui.notify(`facc: placement unchanged (${next})`, "info");
				return;
			}
			placement = next;
			saveConfig();
			// tear down + reinstall = move（uninstall 幂等清两种挂法；footer ↔ widget 互移同样适用）
			uninstall(ctx);
			install(ctx);
			ctx.ui.notify(`facc: widget placement → ${next}`, "info");
		},
	});

}
