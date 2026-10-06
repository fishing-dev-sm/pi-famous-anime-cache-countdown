/**
 * famous-anime-cache-countdown —— EVA「活動限界」Cache Countdown
 *
 * 一行 widget 显示 Anthropic prompt cache TTL（5 分钟）倒计时，
 * 视觉与本目录 preview.mjs 的「一行简约版」一致：
 *   [反白徽章 CACHE 限界] [20 格 braille 条(垂直3级+中央tick)] [反白 MM:SS:cc] [五段状态徽章]
 *   状态（TTL 五等分）：NORMAL → 注 CAUTION 意 → 危 DANGER 険 → 緊 EMERGENCY 急 →（末段反相闪烁）
 *
 * 测试：pi --extension ./index.ts
 * 命令：/facc 配置菜单（第一个菜单 = widget 位置 aboveEditor/belowEditor）
 *       /eva_cache_countdown 切换 alarm（terminal bell）开关
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { parseColor, truncateToWidth } from "@earendil-works/pi-tui";
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const FALLBACK_TTL_MS = 5 * 60 * 1000; // 模型未声明 promptCache 时兜底（Anthropic short retention = 300s）
const GAUGE_CELLS = 20;
const FACC_WIDGET_KEY = "facc";
const CONFIG_PATH = join(homedir(), ".pi", "agent", "facc.json");

type Placement = "aboveEditor" | "belowEditor";

/** 读配置（不存在/损坏 → 默认 belowEditor）。可随时加新键。 */
function loadPlacement(): Placement {
	try {
		const j = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
		return j.placement === "aboveEditor" ? "aboveEditor" : "belowEditor";
	} catch {
		return "belowEditor";
	}
}

type PromptCacheModel = { promptCache?: { short?: number; long?: number } };

/**
 * TTL 来源与 pi 内置 cache-warmer 一致（core/cache-warmer.ts getPromptCacheTtlMs）：
 * model.promptCache[retention]，retention = PI_CACHE_RETENTION=long ? "long" : "short"。
 */
function ttlMsOf(model: PromptCacheModel | undefined | null): number {
	const retention = process.env.PI_CACHE_RETENTION === "long" ? "long" : "short";
	const sec = model?.promptCache?.[retention];
	return typeof sec === "number" && sec > 0 ? sec * 1000 : FALLBACK_TTL_MS;
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

const phaseOf = (sec: number, totalSec: number) => {
	const b = totalSec / 5;
	return sec > 4 * b ? 0 : sec > 3 * b ? 1 : sec > 2 * b ? 2 : sec > b ? 3 : 4;
};

/** 上色函数签名：fg 十六进制，bg 可选（badge 用） */
export type StyleFn = (text: string, fgHex: string, bgHex?: string) => string;

/**
 * 构建一行倒计时（纯函数，可测试）。
 * 布局：反白徽章 + 空格 + 20格braille条(中央tick) + 2空格 + 反白时间 + 空格 + 状态徽章
 */
export function buildEvaLine(remainMs: number, totalMs: number, nowMs: number, style: StyleFn): string {
	// 限界突破（过期）：红色定格 —— 徽章「限界突破」+ 空条 + 00:00:00 + 「终 OVER 了」
	if (remainMs <= 0) {
		const P = PHASES[3];
		const titleBadge = style(" CACHE EXPIRED 限界突破 ", contrastFg(P.main), P.main);
		let bar = "";
		for (let i = 0; i < GAUGE_CELLS; i++) {
			bar += style("⣀", P.main);
			if (i === GAUGE_CELLS / 2 - 1) bar += style("│", P.tick);
		}
		// 时间定格：红色数字，不反白；无 ● 指示
		const time = style("00:00:00", P.main);
		const status = style("终 OVER 了", contrastFg(DANGER_BG), DANGER_BG);
		return `${titleBadge} ${bar} ${time} ${status}`;
	}

	const totalSec = totalMs / 1000;
	const sec = Math.floor(Math.max(0, remainMs) / 1000);
	const centi = Math.floor((Math.max(0, remainMs) % 1000) / 10);
	const e = phaseOf(sec, totalSec);
	const P = PHASES[e];

	// 1. 反白徽章（底=当前段 main，字色按 WCAG 亮度选黑/白）
	const titleBadge = style(" CACHE 限界 ", contrastFg(P.main), P.main);

	// 2. 20 格 braille 进度条：每格垂直 3 级填充（⣀=空轨/⣤/⣶/⣿），从右往左填，
	//    分辨率 20 格→60 步；中央分水岭 tick；末段 sec<=20 最后 2 格闪烁
	const LEVELS = ["⣀", "⣤", "⣶", "⣿"]; // 0=空轨, 1..3=垂直填充级（底部点阵→满）
	const units = Math.round((Math.min(sec, totalSec) / totalSec) * GAUGE_CELLS * 3);
	const blinkEdge = sec <= 20 ? 2 : 0;
	const blinkOn = Math.floor(nowMs / 500) % 2 === 0;
	let bar = "";
	for (let i = 0; i < GAUGE_CELLS; i++) {
		const level = Math.max(0, Math.min(3, units - (GAUGE_CELLS - 1 - i) * 3));
		const edgeOff = blinkEdge > 0 && level > 0 && i >= GAUGE_CELLS - blinkEdge && !blinkOn;
		bar += style(edgeOff ? "⣀" : LEVELS[level], P.main);
		if (i === GAUGE_CELLS / 2 - 1) bar += style("│", P.tick);
	}

	// 3. 反白时间 MM:SS:cc（冒号常显不闪烁）。渲染 tick=83ms 与 cc 末位周期 10ms 不整除，
	//    每帧采到的末位自然轮转 0-9（真实秒表效果）；末位用 sub 暗色弱化（LiveSplit 式），全段一致。
	const mm = String(Math.floor(sec / 60)).padStart(2, "0");
	const ss = String(sec % 60).padStart(2, "0");
	const cc = String(centi).padStart(2, "0");
	const fgHex = contrastFg(P.main);
	const digit = (s: string) => style(s, fgHex, P.main);
	const lastDigit = style(cc[1], P.sub, P.main);
	const timeBadge = digit(" " + mm + ":" + ss + ":" + cc[0]) + lastDigit + digit(" ");

	// 运行指示 ●：非常淡的绿色，90ms 独立相位快速闪烁（与 83ms 渲染 tick 错开，避免相位锁死）
	const pulse = Math.floor(nowMs / 90) % 2 === 0 ? style("●", PULSE_GREEN) : " ";

	// 4. 状态徽章：绿 CACHE NORMAL / 黄 注 CAUTION 意 / 橙 危 DANGER 険 /
	//    红 緊 EMERGENCY 急（白字#b91c1c底）/ 红闪（≤60s）同文案 400ms 反相闪烁
	let status: string;
	if (e <= 2) {
		const text = e === 0 ? " NORMAL " : e === 1 ? " 注 CAUTION 意 " : " 危 DANGER 険 ";
		status = style(text, contrastFg(P.main), P.main);
	} else if (e === 3) {
		status = style(" 緊 EMERGENCY 急 ", "#ffffff", DANGER_BG);
	} else {
		status =
			Math.floor(nowMs / 400) % 2 === 0
				? style(" 緊 EMERGENCY 急 ", "#ffffff", DANGER_BG)
				: style(" 緊 EMERGENCY 急 ", DANGER_BG, P.hi); // 灭相：暗红字/亮红底 反相
	}

	// 布局与 preview.mjs lineVersion 一致：各段之间单空格分隔（徽章 padding 在反白底内）
	return `${titleBadge} ${bar} ${pulse} ${timeBadge} ${status}`;
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

export default function (pi: ExtensionAPI) {
	let lastCacheAt: number | null = null; // null = 尚未有任何请求（无 cache entry），待机不计时
	let alarmEnabled = true;
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

	// alarm 状态跟踪（在渲染 tick 里检测跨秒/跨段）
	let prevSec = Math.ceil(FALLBACK_TTL_MS / 1000);

	const bell = () => {
		if (alarmEnabled) process.stdout.write("\x07");
	};

	const tick = () => {
		if (lastCacheAt === null) {
			tuiRef?.requestRender();
			return;
		}
		const ttlMs = ttlMsOf(ctxRef?.model);
		const boundarySec = Math.ceil(ttlMs / 5000); // 红闪段起点 = TTL 的 1/5（300s→60s）
		const remainMs = Math.max(0, lastCacheAt + ttlMs - Date.now());
		const sec = Math.ceil(remainMs / 1000);
		if (sec !== prevSec) {
			// 跨过 TTL/5 进入红闪段：响一次；最后 10s 每秒响一次
			if (prevSec > boundarySec && sec <= boundarySec) bell();
			else if (sec <= 10 && sec < prevSec) bell();
			prevSec = sec;
		}
		tuiRef?.requestRender();
	};

	const stopTimer = () => {
		if (timer) {
			clearInterval(timer);
			timer = null;
		}
	};

	// 挂法：ctx.ui.setWidget = editor 上/下插槽，不替换原 footer（setFooter 是清空式
	// 替换语义，会覆盖内置 footer，弃用）。待机（无任何请求）= 不安装 widget，什么都
	// 不显示；首个请求才安装。位置可配（/facc 菜单，存 ~/.pi/agent/facc.json）。
	let widgetInstalled = false;
	const installWidget = (ctx: ExtensionContext) => {
		if (widgetInstalled || ctx.mode !== "tui") return;
		widgetInstalled = true;
		ctx.ui.setWidget(FACC_WIDGET_KEY, (_tui, theme) => {
			tuiRef = _tui;
			const style: StyleFn = (text, fgHex, bgHex) =>
				theme.style(text, { fg: parseColor(fgHex), ...(bgHex ? { bg: parseColor(bgHex) } : {}) });
			return {
				render(width: number): string[] {
					if (lastCacheAt === null) return []; // 待机不渲染（widget 只有首次请求后才安装，理论到不了这里）
					const now = Date.now();
					const ttlMs = ttlMsOf(ctxRef?.model);
					const remainMs = lastCacheAt + ttlMs - now;
					return [truncateToWidth(buildEvaLine(remainMs, ttlMs, now, style), width)];
				},
				invalidate() {},
				dispose() {
					if (tuiRef === _tui) tuiRef = null;
				},
			};
		}, { placement });
	};

	pi.on("session_start", (_ev, ctx) => {
		ctxRef = ctx;
		lastCacheAt = null; // 无请求不计时（逻辑与 cache-warmer "waiting for first request" 一致）
		prevSec = Math.ceil(ttlMsOf(ctx.model) / 1000);
		if (ctx.mode !== "tui") return;

		// 幂等启动渲染/alarm tick。83ms：与 cc 末位 10ms 周期不整除 → 末位自然轮转、
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
		prevSec = Math.ceil(ttlMsOf(ctx.model) / 1000);
		installWidget(ctx); // 首次请求才出现 widget；之前完全不显示
	};
	pi.on("before_provider_request", (_ev, ctx) => onCacheWrite(ctx));
	pi.on("cache_warming_decision", (ev, ctx) => {
		if (ev.action === "warm") onCacheWrite(ctx);
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
			// First menu: widget placement aboveEditor / belowEditor
			const cur = placement;
			const choice = await ctx.ui.select("facc settings · widget placement", [
				`aboveEditor  above the editor (below the status line)${cur === "aboveEditor" ? "  ● current" : ""}`,
				`belowEditor  below the editor (above the footer)${cur === "belowEditor" ? "  ● current" : ""}`,
			]);
			if (!choice) return; // cancelled
			const next: Placement = choice.startsWith("aboveEditor") ? "aboveEditor" : "belowEditor";
			if (next === cur) {
				ctx.ui.notify(`facc: placement unchanged (${next})`, "info");
				return;
			}
			placement = next;
			saveConfig();
			if (widgetInstalled) {
				// tear down + reinstall = move (setWidget with same key replaces content but not the container)
				ctx.ui.setWidget(FACC_WIDGET_KEY, undefined);
				widgetInstalled = false;
				installWidget(ctx);
			}
			ctx.ui.notify(`facc: widget placement → ${next}`, "info");
		},
	});

	pi.registerCommand("eva_cache_countdown", {
		description: "Toggle facc alarm (terminal bell)",
		handler: async (_args, ctx: ExtensionContext) => {
			alarmEnabled = !alarmEnabled;
			ctx.ui.notify(`facc alarm: ${alarmEnabled ? "ON ⚠警報" : "OFF"}`, "info");
		},
	});
}
