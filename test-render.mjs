// test-render.mjs — 用 jiti 加载 index.ts 的 buildCountdownLine，与 preview.mjs 一行版对比
// 运行：node test-render.mjs
import { createRequire } from "node:module";
const require = createRequire("/home/sim/.pi/agent/install/releases/1.0.4/node_modules/");
const { createJiti } = require("jiti");
const jiti = createJiti(import.meta.url);
const { buildCountdownLine, buildDeepseekLine, buildInfiniteLine, buildExpiredLine } = await jiti.import(new URL("./index.ts", import.meta.url).href);

const RESET = "\x1b[0m";
// 与 preview.mjs 相同的真色上色（fg 始终输出；bg 可选）
const style = (text, fgHex, bgHex) => {
	const h = (x) => [parseInt(x.slice(1, 3), 16), parseInt(x.slice(3, 5), 16), parseInt(x.slice(5, 7), 16)].join(";");
	let s = `\x1b[38;2;${h(fgHex)}m`;
	if (bgHex) s += `\x1b[48;2;${h(bgHex)}m`;
	return s + text + RESET;
};

const cases = [
	{ remain: 280_000, now: 0, label: "绿 04:40:00 CACHE NORMAL" },
	{ remain: 210_000, now: 0, label: "黄 03:30:00 注 CAUTION 意" },
	{ remain: 150_000, now: 0, label: "橙 02:30:00 危 DANGER 険" },
	{ remain: 90_000, now: 0, label: "红 01:30:00 緊 EMERGENCY 急" },
	{ remain: 30_000, now: 0, label: "红闪 00:30:00（亮相 now=0）" },
	{ remain: 30_000, now: 400, label: "红闪 00:30:00（灭相 now=400）" },
	{ remain: 9_420, now: 0, label: "红闪 00:09:42（●亮+spinner）" },
	{ remain: 9_420, now: 90, label: "红闪 00:09:42（●灭 now=90）" },
	{ remain: 0, now: 3000, label: "限界突破 CACHE EXPIRED（留空条）" },
];
for (const c of cases) console.log(buildCountdownLine(c.remain, 300_000, c.now, style), " ", c.label);

// DeepSeek 12h 宏观模式（remain > 300s 时；hitRate 为 null 或上次响应真实命中率）
const dsCases = [
	{ remain: 12 * 3600 * 1000, hit: null, label: "满 12:00:00 長 EXTERNAL 期 HIT --%（尚无响应数据）" },
	{ remain: 6 * 3600 * 1000 + 37 * 60 * 1000, hit: 0.956, label: "半 06:37:00 HIT 96%" },
	{ remain: 5 * 60 * 1000 + 30_000, hit: 0.99, label: "临界 00:05:30（>300s 仍宏观行）HIT 99%" },
];
for (const c of dsCases) console.log(buildDeepseekLine(c.remain, 12 * 3600 * 1000, c.hit, style), " ", c.label);
console.log(buildCountdownLine(299_000, 300_000, 0, style), " ", "DeepSeek ≤300s → 接入短逻辑（绿 04:59:00 NORMAL）");

// 本地/自托管 API ∞ 模式（无 promptCache 声明、非 DeepSeek、baseUrl 本地）：仅静态蓝徽章
console.log(buildInfiniteLine(style), " ", "本地 ∞（仅徽章，无条/∞/状态/●）");

// 变体B：无进度条，纯文字版（贴用户草图）
{
	const P = { main: "#ef4444" };
	const b = (t, bg) => style(t, "#000000", bg);
	console.log(
		b(" CACHE EXPIRED 限界突破 ", P.main) + " " + b(" 00:00:00 ", P.main) + " " + style("终 OVER 了", "#ffffff", "#b91c1c"),
		" ", "限界突破（变体B：无条纯文字）",
	);
}

// 过期三阶段消解动画（buildExpiredLine：remainMs 传负数 = 过期后经过的毫秒）
// 时间轴：0→1200ms 阶段1 条+时间自右向左收拢；1200→3300ms 阶段2 状态徽章呼吸 3 次（700ms/次）；≥3300ms 阶段3 只剩徽章
const expCases = [
	{ age: 0, label: "阶段1 起点：条+时间+状态全在" },
	{ age: 300, label: "阶段1：右侧收掉 1/4" },
	{ age: 600, label: "阶段1：收掉一半（时间剩 00:0" },
	{ age: 900, label: "阶段1：只剩左侧条" },
	{ age: 1200, label: "阶段1 结束 / 呼吸 1 峰值（env=1.00）：条+时间归零" },
	{ age: 1550, label: "阶段2：呼吸 1 谷底（env=0，全黑）" },
	{ age: 1900, label: "阶段2：呼吸 2 峰值（env=0.67，逐次变弱）" },
	{ age: 2600, label: "阶段2：呼吸 3 峰值（env=0.33，最弱）" },
	{ age: 2950, label: "阶段2：呼吸 3 谷底" },
	{ age: 3300, label: "阶段2 结束：状态消失，只剩徽章" },
	{ age: 9000, label: "阶段3：徽章永久保留" },
];
for (const c of expCases) console.log(buildExpiredLine(-c.age, style), " ", c.label);
for (const t of ["L1", "L2", "L3"]) console.log(buildExpiredLine(-600, style, t), " ", `过期 600ms @ ${t} 档`);

// 宽度校验（CJK 按 2 列）
function charW(c) {
	const cp = c.codePointAt(0);
	return (cp >= 0x1100 && cp <= 0x115f) || cp === 0x2329 || cp === 0x232a ||
		(cp >= 0x2e80 && cp <= 0xa4cf) || (cp >= 0xac00 && cp <= 0xd7a3) ||
		(cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xfe10 && cp <= 0xfe19) ||
		(cp >= 0xfe30 && cp <= 0xfe6f) || (cp >= 0xff00 && cp <= 0xff60) ||
		(cp >= 0xffe0 && cp <= 0xffe6) || (cp >= 0x20000 && cp <= 0x2fffd) ||
		(cp >= 0x30000 && cp <= 0x3fffd) ? 2 : 1;
}
const vw = (s) => { let w = 0; for (const c of s.replace(/\x1b\[[0-9;]*m/g, "")) w += charW(c); return w; };
console.log("\nvisible width:", cases.map((c) => vw(buildCountdownLine(c.remain, 300_000, c.now, style))).join(", "));
console.log("deepseek width:", dsCases.map((c) => vw(buildDeepseekLine(c.remain, 12 * 3600 * 1000, c.hit, style))).join(", "));
console.log("expired width:", expCases.map((c) => vw(buildExpiredLine(-c.age, style))).join(", "));
const expWidths = expCases.map((c) => vw(buildExpiredLine(-c.age, style)));
const badgeW = vw(" CACHE EXPIRED 限界突破 ");
console.log(
	"expired 单调不增:", expWidths.every((w, i) => i === 0 || w <= expWidths[i - 1]),
	"| 末态宽度=徽章宽度:", expWidths[expWidths.length - 1] === badgeW,
	`(${badgeW})`,
);
