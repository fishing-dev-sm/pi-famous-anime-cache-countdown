// preview-expire.mjs — 限界突破（cache 5 分钟倒计时到期）三阶段消解动画预览
// 运行：node preview-expire.mjs            # 实时循环（83ms tick，与扩展渲染 tick 一致）
//       node preview-expire.mjs --frames   # 静态帧表（可 diff / 可复核的产物）
//       node preview-expire.mjs --tier L1  # 只看某一缩略档（full|L1|L2|L3）
// 渲染完全走 index.ts 的 buildCountdownLine（过期分支 = buildExpiredLine），零重复实现。
//
// 三阶段（时间轴 age = -remainMs，由 index.ts 常量定义）：
//   阶段1  0 … 1200ms        「⣀…│⣀… 00:00:00」自右向左逐格收拢直到消失
//   阶段2  1200 … 3300ms     「 终 OVER 了 」呼吸闪烁 3 次（一峰比一峰暗）后消失
//   阶段3  3300ms →          只保留「 CACHE EXPIRED 限界突破 」徽章（永久定格）
import { createRequire } from "node:module";

const PI_RELEASE = process.env.PI_RELEASE ?? "/home/sim/.pi/agent/install/releases/1.1.0";
const require = createRequire(`${PI_RELEASE}/node_modules/`);
const jiti = require("jiti")(import.meta.url);
const { buildCountdownLine } = await jiti.import(new URL("./index.ts", import.meta.url).href);

const style = (text, fgHex, bgHex) => {
	const h = (x) => [parseInt(x.slice(1, 3), 16), parseInt(x.slice(3, 5), 16), parseInt(x.slice(5, 7), 16)].join(";");
	let s = `\x1b[38;2;${h(fgHex)}m`;
	if (bgHex) s += `\x1b[48;2;${h(bgHex)}m`;
	return `${s}${text}\x1b[0m`;
};

const COLLAPSE_MS = 1200;
const BREATH_MS = 700;
const BREATHS = 3;
const TOTAL_MS = COLLAPSE_MS + BREATHS * BREATH_MS; // 3300ms 动画全长
const TAIL_MS = 1500; // 动画结束后「只剩徽章」的停留
const TICK_MS = 83; // 与扩展渲染 tick 一致
const TTL = 300_000;

const plain = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const stageOf = (age) => (age < COLLAPSE_MS ? "1 收拢" : age < TOTAL_MS ? "2 呼吸" : "3 定格");

const argv = process.argv.slice(2);
const tierFlag = argv.includes("--tier") ? argv[argv.indexOf("--tier") + 1] : "full";
const TIERS = tierFlag === "all" ? ["full", "L1", "L2", "L3"] : [tierFlag];

if (argv.includes("--frames")) {
	for (const tier of TIERS) {
		console.log(`\n══ tier=${tier} · 限界突破消解帧表（age = 过期后毫秒）══`);
		for (let age = 0; age <= TOTAL_MS + TAIL_MS; age += 100) {
			const line = buildCountdownLine(-age, TTL, 0, style, tier);
			console.log(`${String(age).padStart(4)}ms ${stageOf(age)}  ${line}`);
		}
		console.log(`  … ${TOTAL_MS + TAIL_MS}ms+ 永久定格：${buildCountdownLine(-999999, TTL, 0, style, tier)}`);
	}
	process.exit(0);
}

// 实时循环：每 TICK_MS 重画一帧（原地覆盖，模拟 widget 行为）
const frame = (age, now) => {
	const lines = TIERS.map((t) => buildCountdownLine(-age, TTL, now, style, t));
	const head = `\x1b[38;2;137;180;250m限界突破消解 · age=${String(age).padStart(4)}ms · 阶段${stageOf(age)}\x1b[0m`;
	const legend =
		"\x1b[38;2;88;91;112m" +
		`阶段1 0-${COLLAPSE_MS}ms 条+时间自右向左收拢 │ 阶段2 ${COLLAPSE_MS}-${TOTAL_MS}ms 状态徽章呼吸×3 │ 阶段3 徽章永久定格\x1b[0m`;
	return ["", head, ...lines, "", legend];
};

process.stdout.write("\x1b[2J\x1b[?25l");
let start = Date.now();
const loop = setInterval(() => {
	const now = Date.now();
	const age = (now - start) % (TOTAL_MS + TAIL_MS);
	const body = frame(age, now);
	process.stdout.write("\x1b[H" + body.join("\x1b[K\n") + "\x1b[K");
	if (now - start >= 12_000) {
		clearInterval(loop);
		process.stdout.write("\x1b[?25h\n\n\x1b[38;2;137;180;250m（12s 预览结束 · 循环 4 轮）\x1b[0m\n");
	}
}, TICK_MS);
