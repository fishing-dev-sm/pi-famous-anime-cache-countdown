#!/usr/bin/env node
/**
 * demo-frames.mjs — 生成 GIF 演示帧（JSON Lines 输出到 stdout）
 *
 * 每行 = 一帧：{ "dur": ms, "lines": [ansi 字符串...] }
 * 用真实扩展代码 buildEvaLine / buildDeepseekLine 渲染，配合假的 pi 界面边框
 * （标题行 / 编辑器行 / statusline 两行），供 render_gif.py 画成 GIF。
 *
 * 用法：node demo-frames.mjs > /tmp/frames.jsonl
 */
import { createRequire } from "node:module";

const PI_DIR = "/home/sim/.pi/agent/install/releases/1.0.4";
const require = createRequire(`${PI_DIR}/node_modules/@earendil-works/pi-coding-agent/package.json`);
const jiti = require("jiti")(import.meta.url, {
	alias: { "@earendil-works/pi-tui": `${PI_DIR}/node_modules/@earendil-works/pi-tui/dist/index.js` },
});
const { buildEvaLine, buildDeepseekLine } = await jiti.import(new URL("./index.ts", import.meta.url).href);

// theme.style 等价实现（真色）
const style = (text, fg, bg) => {
	let s = "\x1b[";
	if (fg) s += `38;2;${parseInt(fg.slice(1, 3), 16)};${parseInt(fg.slice(3, 5), 16)};${parseInt(fg.slice(5, 7), 16)}m`;
	if (bg) s += `\x1b[48;2;${parseInt(bg.slice(1, 3), 16)};${parseInt(bg.slice(3, 5), 16)};${parseInt(bg.slice(5, 7), 16)}m`;
	return s + text + "\x1b[0m";
};

const dim = (t) => `\x1b[38;2;88;91;112m${t}\x1b[0m`; // Alacritty bright black #585B70
const TITLE = dim(" pi · famous-anime-cache-countdown · (deepseek) deepseek-v4-pro");
const EDITOR = `\x1b[38;2;137;180;250m❯\x1b[0m `; // Alacritty bright blue #89B4FA
const FOOT1 = dim("famous-anime-cache-countdown │ main [0] │ $0.013");
const FOOT2 = dim("CPU 8% · MEM 31% · 20k tokens");

const out = (lines, dur = 100) => process.stdout.write(JSON.stringify({ dur, lines }) + "\n");
const scene = (widgetLine) => out([TITLE, "", widgetLine, "", EDITOR, "", FOOT1, FOOT2]);

const H12 = 12 * 3600 * 1000;

// ── 场景 1: DeepSeek 12h 宏观模式（5s，每秒走 1s，HIT --% → 96%）──────────
out([dim("scene: deepseek-12h")], 1); // 场景标记帧（render_gif.py 用它切分文件）
for (let i = 0; i < 50; i++) {
	const remain = H12 - 2000 - i * 1000; // 11:59:58 起，每秒 -1s
	const hit = i < 12 ? null : 0.96; // 前 1.2s 无数据 → HIT --%
	scene(buildDeepseekLine(remain, H12, hit, style));
}

// ── 场景 2: 五段短逻辑全周期 300s → 限界突破（12.5s）───────────────────────
out([dim("scene: five-phases")], 1);
let now = 0;
// A: 300s → 15s 加速扫过（60 帧）：绿 NORMAL → 黄 CAUTION → 橙 DANGER → 红 EMERGENCY
for (let i = 0; i < 60; i++) {
	const remain = 300_000 - (285_000 * i) / 59;
	scene(buildEvaLine(remain, 300_000, now, style));
	now += 100;
}
// B: 15s → 0（40 帧）：红闪 + spinner + 末 10s（alarm 区间）
for (let i = 0; i < 40; i++) {
	const remain = 15_000 - (15_000 * i) / 39;
	scene(buildEvaLine(remain, 300_000, now, style));
	now += 100;
}
// C: 限界突破（25 帧定格）
for (let i = 0; i < 25; i++) {
	scene(buildEvaLine(-1, 300_000, now, style));
	now += 400;
}

// ── 场景 3: 待机 → 发消息瞬间点亮（3s，展示"待机零渲染"行为）───────────────
out([dim("scene: standby-wake")], 1);
const sceneBlank = () => out([TITLE, "", "", "", EDITOR, "", FOOT1, FOOT2]);
for (let i = 0; i < 12; i++) sceneBlank(); // 待机：无倒计时行
for (let i = 0; i < 12; i++) scene(buildEvaLine(299_000 - i * 1000, 300_000, now + i * 100, style)); // 发消息瞬间点亮
for (let i = 0; i < 6; i++) scene(buildEvaLine(287_000 - i * 1000, 300_000, now + 1200 + i * 100, style));
