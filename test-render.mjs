// test-render.mjs — 用 jiti 加载 index.ts 的 buildEvaLine，与 preview.mjs 一行版对比
// 运行：node test-render.mjs
import { createRequire } from "node:module";
const require = createRequire("/home/sim/.pi/agent/install/releases/1.0.4/node_modules/");
const { createJiti } = require("jiti");
const jiti = createJiti(import.meta.url);
const { buildEvaLine } = await jiti.import(new URL("./index.ts", import.meta.url).href);

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
for (const c of cases) console.log(buildEvaLine(c.remain, 300_000, c.now, style), " ", c.label);

// 变体B：无进度条，纯文字版（贴用户草图）
{
	const P = { main: "#ef4444" };
	const b = (t, bg) => style(t, "#000000", bg);
	console.log(
		b(" CACHE EXPIRED 限界突破 ", P.main) + " " + b(" 00:00:00 ", P.main) + " " + style("终 OVER 了", "#ffffff", "#b91c1c"),
		" ", "限界突破（变体B：无条纯文字）",
	);
}

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
console.log("\nvisible width:", cases.map((c) => vw(buildEvaLine(c.remain, 300_000, c.now, style))).join(", "));
