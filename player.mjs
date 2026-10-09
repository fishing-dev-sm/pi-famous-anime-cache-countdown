#!/usr/bin/env node
/**
 * player.mjs <scene> — 在真终端里播放 demo-frames.mjs 生成的某个场景
 * 用法：node player.mjs deepseek-12h|five-phases|standby-wake|expire-dissolve
 * 每帧清屏重绘，播完停 800ms 退出（供 alacritty -e 使用，退出即关窗）。
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const scene = process.argv[2];
if (!scene) { console.error("usage: node player.mjs <scene>"); process.exit(1); }

const { stdout } = await promisify(execFile)("node", [new URL("./demo-frames.mjs", import.meta.url).pathname], { maxBuffer: 64 * 1024 * 1024 });
const frames = [];
let cur = null;
for (const line of stdout.split("\n")) {
	if (!line) continue;
	const f = JSON.parse(line);
	if (f.lines.length === 1 && f.lines[0].includes("scene: ")) {
		cur = f.lines[0].replace(/\x1b\[[0-9;]*m/g, "").split("scene: ")[1].trim();
		continue;
	}
	if (cur === scene) frames.push(f);
}
if (!frames.length) { console.error(`scene not found: ${scene}`); process.exit(1); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
process.stdout.write("\x1b[?25l\x1b[2J\x1b[H"); // 隐藏光标 + 清屏
await sleep(600);
for (const f of frames) {
	// 每行末尾 \x1b[K 擦到行尾：动画后期行变短时不留上一帧残影（过期消解会缩行）
	process.stdout.write("\x1b[H" + f.lines.map((l) => l + "\x1b[K").join("\r\n") + "\x1b[J");
	await sleep(f.dur);
}
await sleep(800);
process.stdout.write("\x1b[?25h");
process.exit(0);
