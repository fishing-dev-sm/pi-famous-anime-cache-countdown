// preview-compact.mjs — famous-anime-cache-countdown 三档缩略模式设计稿 v3（真实 ANSI 颜色）
// 运行：node preview-compact.mjs
// 对应 tui_compact_design.md：L1 ≤60 / L2 ≤44 / L3 ≤26 格
// v3 用户裁定：● 任何档禁止丢弃；中央 tick 从 L1 起丢；盲文换空间（10→4→2）；
//             L2 状态中英文只取短不丢弃（注 CAUT 意 / 緊 EMER 急）。

const RESET = "\x1b[0m";
const hexToRgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

// style：与 index.ts 的 StyleFn 同签名（text, fgHex, bgHex?），此处输出 ANSI 真色
const style = (text, fgHex, bgHex) => {
  const f = hexToRgb(fgHex);
  const fg = `\x1b[38;2;${f.join(";")}m`;
  const bg = bgHex ? `\x1b[48;2;${hexToRgb(bgHex).join(";")}m` : "";
  return `${fg}${bg}${text}${RESET}`;
};

// WCAG 对比度选反白字色（与 index.ts contrastFg / pi-fleet color.ts contrastTextColor 一致）
function contrastFg(bgHex) {
  const [r, g, b] = hexToRgb(bgHex);
  const ch = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  const lum = 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
  return (lum + 0.05) / 0.05 >= 1.05 / (lum + 0.05) ? "#000000" : "#ffffff";
}

// 五段等分（同 index.ts）：色号抄 pi-fleet（SWARM_COLORS + Tailwind 色阶）
const PHASES = [
  { main: "#22c55e", hi: "#4ade80", sub: "#15803d", tick: "#16a34a" }, // 0 绿
  { main: "#eab308", hi: "#facc15", sub: "#a16207", tick: "#ca8a04" }, // 1 黄
  { main: "#f97316", hi: "#fb923c", sub: "#c2410c", tick: "#ea580c" }, // 2 橙
  { main: "#ef4444", hi: "#f87171", sub: "#b91c1c", tick: "#dc2626" }, // 3 红
  { main: "#ef4444", hi: "#f87171", sub: "#b91c1c", tick: "#dc2626" }, // 4 红闪
];
const DANGER_BG = "#b91c1c";
const PULSE_GREEN = "#86efac"; // ● 运行指示：非常淡的绿色（v3：任何档禁止丢弃）
const DEEPSEEK_PHASE = { main: "#3b82f6", hi: "#60a5fa", sub: "#1d4ed8", tick: "#2563eb" }; // 蓝系（12h 宏观）
const FALLBACK_TTL_MS = 5 * 60 * 1000;

const phaseOf = (sec, totalSec) => {
  const b = totalSec / 5;
  return sec > 4 * b ? 0 : sec > 3 * b ? 1 : sec > 2 * b ? 2 : sec > b ? 3 : 4;
};

/** braille 条（格数可配）：每格垂直 3 级、从右烧尽、末 20s 条尾 2 格闪烁。
 *  v3：缩略档一律无中央 tick（L1 起丢），仅完整版保留。 */
function buildBar(cells, sec, totalSec, P, nowMs) {
  const LEVELS = ["⣀", "⣤", "⣶", "⣿"];
  const units = Math.round((Math.min(sec, totalSec) / totalSec) * cells * 3);
  const blinkEdge = sec <= 20 ? 2 : 0;
  const blinkOn = Math.floor(nowMs / 500) % 2 === 0;
  let bar = "";
  for (let i = 0; i < cells; i++) {
    const level = Math.max(0, Math.min(3, units - (cells - 1 - i) * 3));
    const edgeOff = blinkEdge > 0 && level > 0 && i >= cells - blinkEdge && !blinkOn;
    bar += style(edgeOff ? "⣀" : LEVELS[level], P.main);
  }
  return bar;
}

/** 状态徽章：FULL=中英全长（L1），L2=中英取短（不丢弃任一语种），L3=单字 */
function buildStatus(e, P, nowMs, tier) {
  const TEXT = {
    FULL: [" NORMAL ", " 注 CAUTION 意 ", " 危 DANGER 険 ", " 緊 EMERGENCY 急 ", " 緊 EMERGENCY 急 "],
    L2: [" NORM ", " 注 CAUT 意 ", " 危 DANG 険 ", " 緊 EMER 急 ", " 緊 EMER 急 "],
    L3: [" 常 ", " 注 ", " 危 ", " 緊 ", " 緊 "],
  }[tier];
  if (e <= 2) return style(TEXT[e], contrastFg(P.main), P.main);
  if (e === 3) return style(TEXT[e], "#ffffff", DANGER_BG);
  return Math.floor(nowMs / 400) % 2 === 0
    ? style(TEXT[e], "#ffffff", DANGER_BG)
    : style(TEXT[e], DANGER_BG, P.hi); // 灭相：暗红字/亮红底 反相
}

/** 反白时间：L1/L2 = MM:SS:cc（cc 末位 sub 暗色弱化），L3 = MM:SS（反白保留） */
function buildTime(sec, centi, P, withCc) {
  const mm = String(Math.floor(sec / 60)).padStart(2, "0");
  const ss = String(sec % 60).padStart(2, "0");
  if (!withCc) return style(` ${mm}:${ss} `, contrastFg(P.main), P.main);
  const cc = String(centi).padStart(2, "0");
  const digit = (s) => style(s, contrastFg(P.main), P.main);
  return digit(` ${mm}:${ss}:${cc[0]}`) + style(cc[1], P.sub, P.main) + digit(" ");
}

const pulseOf = (nowMs) => (Math.floor(nowMs / 90) % 2 === 0 ? style("●", PULSE_GREEN) : " ");

// ══ L1 紧凑（≤60 格）：丢中央 tick + 盲文 20→10；●/cc/中英全长状态徽章全保留 ══
function buildL1(remainMs, totalMs, nowMs) {
  if (remainMs <= 0) {
    const P = PHASES[3];
    const badge = style(" CACHE 限界突破 ", contrastFg(P.main), P.main);
    return `${badge} ${buildBar(10, 0, totalMs / 1000, P, nowMs)} ${style("00:00:00", P.main)} ${style(" 终 OVER 了 ", contrastFg(DANGER_BG), DANGER_BG)}`;
  }
  const totalSec = totalMs / 1000;
  const sec = Math.floor(Math.max(0, remainMs) / 1000);
  const centi = Math.floor((Math.max(0, remainMs) % 1000) / 10);
  const e = phaseOf(sec, totalSec);
  const P = PHASES[e];
  const badge = style(" CACHE 限界 ", contrastFg(P.main), P.main);
  return `${badge} ${buildBar(10, sec, totalSec, P, nowMs)} ${pulseOf(nowMs)} ${buildTime(sec, centi, P, true)} ${buildStatus(e, P, nowMs, "FULL")}`;
}

// ══ L2 迷你（≤44 格）：盲文换空间 10→4；状态中英取短（注 CAUT 意 / 緊 EMER 急）；● 与 cc 仍保留 ══
function buildL2(remainMs, totalMs, nowMs) {
  if (remainMs <= 0) {
    const P = PHASES[3];
    const badge = style(" CACHE 限界突破 ", contrastFg(P.main), P.main);
    return `${badge} ${buildBar(4, 0, totalMs / 1000, P, nowMs)} ${style("00:00:00", P.main)} ${style(" 终了 ", contrastFg(DANGER_BG), DANGER_BG)}`;
  }
  const totalSec = totalMs / 1000;
  const sec = Math.floor(Math.max(0, remainMs) / 1000);
  const centi = Math.floor((Math.max(0, remainMs) % 1000) / 10);
  const e = phaseOf(sec, totalSec);
  const P = PHASES[e];
  const badge = style(" CACHE 限界 ", contrastFg(P.main), P.main);
  return `${badge} ${buildBar(4, sec, totalSec, P, nowMs)} ${pulseOf(nowMs)} ${buildTime(sec, centi, P, true)} ${buildStatus(e, P, nowMs, "L2")}`;
}

// ══ L3 极简（≤26 格）：盲文砍到底 2 格；● 仍保留（铁律）；徽章砍 限界、cc 砍、状态单字；时间反白保留 ══
function buildL3(remainMs, totalMs, nowMs) {
  if (remainMs <= 0) {
    const P = PHASES[3];
    const badge = style(" 突破 ", contrastFg(P.main), P.main);
    return `${badge} ${buildBar(2, 0, totalMs / 1000, P, nowMs)} ${style("00:00", P.main)} ${style(" 终 ", contrastFg(DANGER_BG), DANGER_BG)}`;
  }
  const totalSec = totalMs / 1000;
  const sec = Math.floor(Math.max(0, remainMs) / 1000);
  const e = phaseOf(sec, totalSec);
  const P = PHASES[e];
  const badge = style(" CACHE ", contrastFg(P.main), P.main);
  return `${badge} ${buildBar(2, sec, totalSec, P, nowMs)} ${pulseOf(nowMs)} ${buildTime(sec, 0, P, false)} ${buildStatus(e, P, nowMs, "L3")}`;
}

// ══ DeepSeek 三档（同铁律：tick L1 起丢，盲文 10→4→2；DS 模式本来无 ●）══
function buildDsL1(remainMs, totalMs, hitRate) {
  const P = DEEPSEEK_PHASE;
  const sec = Math.floor(Math.max(0, remainMs) / 1000);
  const badge = style(" CACHE DEEPSEEK ", contrastFg(P.main), P.main);
  const bar = buildBar(10, sec, totalMs / 1000, P, 0);
  const hh = String(Math.floor(sec / 3600)).padStart(2, "0");
  const mm = String(Math.floor((sec % 3600) / 60)).padStart(2, "0");
  const ss = String(sec % 60).padStart(2, "0");
  const timeBadge = style(` ${hh}:${mm}:${ss} `, contrastFg(P.main), P.main);
  const status = style(" 長 EXTERNAL 期 ", contrastFg(P.main), P.main);
  const hit = style(hitRate === null ? " HIT --% " : ` HIT ${Math.round(hitRate * 100)}% `, contrastFg(P.sub), P.sub);
  return `${badge} ${bar} ${timeBadge} ${status} ${hit}`;
}
function buildDsL2(remainMs, totalMs) {
  const P = DEEPSEEK_PHASE;
  const sec = Math.floor(Math.max(0, remainMs) / 1000);
  const badge = style(" CACHE DEEPSEEK ", contrastFg(P.main), P.main); // 徽章全长仍保留
  const bar = buildBar(4, sec, totalMs / 1000, P, 0);
  const hh = String(Math.floor(sec / 3600)).padStart(2, "0");
  const mm = String(Math.floor((sec % 3600) / 60)).padStart(2, "0");
  const ss = String(sec % 60).padStart(2, "0");
  const timeBadge = style(` ${hh}:${mm}:${ss} `, contrastFg(P.main), P.main);
  const status = style(" 長 EXTERNAL 期 ", contrastFg(P.main), P.main); // HIT% 本档起丢（只是个百分比），状态全长保住
  return `${badge} ${bar} ${timeBadge} ${status}`;
}
function buildDsL3(remainMs, totalMs) {
  const P = DEEPSEEK_PHASE;
  const sec = Math.floor(Math.max(0, remainMs) / 1000);
  const badge = style(" CACHE ", contrastFg(P.main), P.main); // 蓝底 = DS 身份；HIT% 本档起丢
  const bar = buildBar(2, sec, totalMs / 1000, P, 0);
  const hh = String(Math.floor(sec / 3600)).padStart(2, "0");
  const mm = String(Math.floor((sec % 3600) / 60)).padStart(2, "0");
  return `${badge} ${bar} ${style(` ${hh}:${mm} `, contrastFg(P.main), P.main)}`;
}

const NOW = 0; // 静态相位（● 亮、末段不闪、红闪=亮相）
const ruler = (n) => style("└" + "─".repeat(n - 2) + "┘", "#4b5563");
const SAMPLES = [
  [4 * 60 * 1000 + 40 * 1000, "绿"],
  [3 * 60 * 1000 + 20 * 1000, "黄"],
  [2 * 60 * 1000 + 30 * 1000, "橙"],
  [1 * 60 * 1000 + 30 * 1000, "红"],
  [30 * 1000, "红闪"],
  [0, "过期"],
];

console.log(style("══ 缩略 L1「紧凑」≤60 格：丢中央 tick + 盲文 20→10 · ●/cc/中英全长状态全保留 ══", "#93c5fd"));
for (const [ms, name] of SAMPLES) console.log(`${buildL1(ms, FALLBACK_TTL_MS, NOW)} ${style("  " + name, "#6b7280")}`);
console.log(buildDsL1(11 * 3600 * 1000 + 59 * 60 * 1000, 12 * 3600 * 1000, 0.99) + style("  DeepSeek", "#6b7280"));
console.log(ruler(60));
console.log("");
console.log(style("══ 缩略 L2「迷你」≤44 格：盲文换空间 10→4 · 状态中英取短 · ● 与 cc 仍保留 ══", "#93c5fd"));
for (const [ms, name] of SAMPLES) console.log(`${buildL2(ms, FALLBACK_TTL_MS, NOW)} ${style("  " + name, "#6b7280")}`);
console.log(buildDsL2(11 * 3600 * 1000 + 59 * 60 * 1000, 12 * 3600 * 1000) + style("  DeepSeek", "#6b7280"));
console.log(ruler(44));
console.log("");
console.log(style("══ 缩略 L3「极简」≤26 格：盲文到底 2 格 · ● 仍保留（铁律）· 时间反白保留 ══", "#93c5fd"));
for (const [ms, name] of SAMPLES) console.log(`${buildL3(ms, FALLBACK_TTL_MS, NOW)} ${style("  " + name, "#6b7280")}`);
console.log(buildDsL3(11 * 3600 * 1000 + 59 * 60 * 1000, 12 * 3600 * 1000) + style("  DeepSeek", "#6b7280"));
console.log(ruler(26));
console.log("");
console.log(style("丢弃顺序：中央 tick(L1起) → 盲文 20→10→4→2(每档最先) → HIT%(DS L2起·只是个百分比) → 状态中英取短(L2) → cc/徽章文案(L3)；● 永不丢", "#15803d"));
console.log(style("档位阈值（最坏宽度，实测）：Anthropic 66/54/43/25 · DeepSeek 76/65/49/18；<最小格才 truncate 兜底", "#15803d"));
console.log(style("全档保留：五段配色 · 从右烧尽 · 末 20s 条尾闪烁 · 红闪反相 · WCAG 反白 · 时间反白 · ● 运行指示", "#15803d"));
