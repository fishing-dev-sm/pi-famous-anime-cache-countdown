// preview.mjs — famous-anime-cache-countdown 一行版设计稿（真实 ANSI 颜色）
// 运行：node preview.mjs
// 与 index.ts 的 buildCountdownLine / buildDeepseekLine 渲染逻辑逐字节一致（仅 style 换成 ANSI 输出）。
// 布局：[反白徽章 CACHE 限界] [20格 braille 条(垂直3级+中央tick)] [●] [反白 MM:SS:cc] [五段状态徽章]
// 状态（TTL 五等分）：NORMAL → 注 CAUTION 意 → 危 DANGER 険 → 緊 EMERGENCY 急 →（末段反相闪烁）

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

// 五段等分（同 index.ts）：总 TTL 均分 5 段；色号抄 pi-fleet（SWARM_COLORS + Tailwind 色阶）
const PHASES = [
  { main: "#22c55e", hi: "#4ade80", sub: "#15803d", tick: "#16a34a" }, // 0 绿 sec > 240   NORMAL
  { main: "#eab308", hi: "#facc15", sub: "#a16207", tick: "#ca8a04" }, // 1 黄 240≥sec>180  注 CAUTION 意
  { main: "#f97316", hi: "#fb923c", sub: "#c2410c", tick: "#ea580c" }, // 2 橙 180≥sec>120  危 DANGER 険
  { main: "#ef4444", hi: "#f87171", sub: "#b91c1c", tick: "#dc2626" }, // 3 红 120≥sec>60  緊 EMERGENCY 急
  { main: "#ef4444", hi: "#f87171", sub: "#b91c1c", tick: "#dc2626" }, // 4 红闪 sec ≤ 60   緊 EMERGENCY 急（反相闪烁）
];
const DANGER_BG = "#b91c1c";
const PULSE_GREEN = "#86efac"; // ● 运行指示：非常淡的绿色
const DEEPSEEK_PHASE = { main: "#3b82f6", hi: "#60a5fa", sub: "#1d4ed8", tick: "#2563eb" }; // 蓝系（12h 宏观）

const GAUGE_CELLS = 20;
const FALLBACK_TTL_MS = 5 * 60 * 1000;

const phaseOf = (sec, totalSec) => {
  const b = totalSec / 5;
  return sec > 4 * b ? 0 : sec > 3 * b ? 1 : sec > 2 * b ? 2 : sec > b ? 3 : 4;
};

/** 与 index.ts buildCountdownLine 一致（nowMs 控制 ●/末段/红闪的闪烁相位） */
function buildCountdownLine(remainMs, totalMs, nowMs) {
  if (remainMs <= 0) {
    const P = PHASES[3];
    const titleBadge = style(" CACHE EXPIRED 限界突破 ", contrastFg(P.main), P.main);
    let bar = "";
    for (let i = 0; i < GAUGE_CELLS; i++) {
      bar += style("⣀", P.main);
      if (i === GAUGE_CELLS / 2 - 1) bar += style("│", P.tick);
    }
    const time = style("00:00:00", P.main);
    const status = style("终 OVER 了", contrastFg(DANGER_BG), DANGER_BG);
    return `${titleBadge} ${bar} ${time} ${status}`;
  }

  const totalSec = totalMs / 1000;
  const sec = Math.floor(Math.max(0, remainMs) / 1000);
  const centi = Math.floor((Math.max(0, remainMs) % 1000) / 10);
  const e = phaseOf(sec, totalSec);
  const P = PHASES[e];

  const titleBadge = style(" CACHE 限界 ", contrastFg(P.main), P.main);

  const LEVELS = ["⣀", "⣤", "⣶", "⣿"];
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

  const mm = String(Math.floor(sec / 60)).padStart(2, "0");
  const ss = String(sec % 60).padStart(2, "0");
  const cc = String(centi).padStart(2, "0");
  const fgHex = contrastFg(P.main);
  const digit = (s) => style(s, fgHex, P.main);
  const lastDigit = style(cc[1], P.sub, P.main);
  const timeBadge = digit(" " + mm + ":" + ss + ":" + cc[0]) + lastDigit + digit(" ");

  const pulse = Math.floor(nowMs / 90) % 2 === 0 ? style("●", PULSE_GREEN) : " ";

  let status;
  if (e <= 2) {
    const text = e === 0 ? " NORMAL " : e === 1 ? " 注 CAUTION 意 " : " 危 DANGER 険 ";
    status = style(text, contrastFg(P.main), P.main);
  } else if (e === 3) {
    status = style(" 緊 EMERGENCY 急 ", "#ffffff", DANGER_BG);
  } else {
    status =
      Math.floor(nowMs / 400) % 2 === 0
        ? style(" 緊 EMERGENCY 急 ", "#ffffff", DANGER_BG)
        : style(" 緊 EMERGENCY 急 ", DANGER_BG, P.hi);
  }

  return `${titleBadge} ${bar} ${pulse} ${timeBadge} ${status}`;
}

/** 与 index.ts buildDeepseekLine 一致（DeepSeek 12h 宏观模式） */
function buildDeepseekLine(remainMs, totalMs, hitRate) {
  const P = DEEPSEEK_PHASE;
  const titleBadge = style(" CACHE DEEPSEEK ", contrastFg(P.main), P.main);

  const totalSec = totalMs / 1000;
  const sec = Math.floor(Math.max(0, remainMs) / 1000);
  const LEVELS = ["⣀", "⣤", "⣶", "⣿"];
  const units = Math.round((Math.min(sec, totalSec) / totalSec) * GAUGE_CELLS * 3);
  let bar = "";
  for (let i = 0; i < GAUGE_CELLS; i++) {
    const level = Math.max(0, Math.min(3, units - (GAUGE_CELLS - 1 - i) * 3));
    bar += style(LEVELS[level], P.main);
    if (i === GAUGE_CELLS / 2 - 1) bar += style("│", P.tick);
  }

  const hh = String(Math.floor(sec / 3600)).padStart(2, "0");
  const mm = String(Math.floor((sec % 3600) / 60)).padStart(2, "0");
  const ss = String(sec % 60).padStart(2, "0");
  const timeBadge = style(` ${hh}:${mm}:${ss} `, contrastFg(P.main), P.main);
  const status = style(" 長 EXTERNAL 期 ", contrastFg(P.main), P.main);
  const hit = style(hitRate === null ? " HIT --% " : ` HIT ${Math.round(hitRate * 100)}% `, contrastFg(P.sub), P.sub);
  return `${titleBadge} ${bar} ${timeBadge} ${status} ${hit}`;
}

const NOW = 0; // 预览静态相位（● 亮、末段不闪、红闪=亮相）
console.log("══ famous-anime-cache-countdown · 一行版 · 五状态（node preview.mjs）══");
console.log(buildCountdownLine(4 * 60 * 1000 + 40 * 1000, FALLBACK_TTL_MS, NOW)); // 绿 04:40:00  NORMAL
console.log(buildCountdownLine(3 * 60 * 1000 + 20 * 1000, FALLBACK_TTL_MS, NOW)); // 黄 03:20:00  注 CAUTION 意
console.log(buildCountdownLine(2 * 60 * 1000 + 30 * 1000, FALLBACK_TTL_MS, NOW)); // 橙 02:30:00  危 DANGER 険
console.log(buildCountdownLine(1 * 60 * 1000 + 30 * 1000, FALLBACK_TTL_MS, NOW)); // 红 01:30:00  緊 EMERGENCY 急
console.log(buildCountdownLine(30 * 1000, FALLBACK_TTL_MS, NOW));                  // 红闪 00:30:00 緊 EMERGENCY 急（NOW=0 亮相）
console.log(buildCountdownLine(0, FALLBACK_TTL_MS, NOW));                          // 过期 限界突破
console.log("");
console.log("══ DeepSeek 12h 宏观模式 ══");
console.log(buildDeepseekLine(11 * 3600 * 1000 + 59 * 60 * 1000, 12 * 3600 * 1000, 0.99)); // 11:59:00 HIT 99%
console.log("");
console.log(style("五段等分(抄 pi-fleet)：绿#22c55e(>4/5) → 黄#eab308(>3/5) → 橙#f97316(>2/5) → 红#ef4444(>1/5) → 红闪(≤1/5)", "#15803d"));
console.log(style("进度条=braille 20格·每格垂直3级(⣀⣤⣶⣿)·中央tick·从右烧尽；时间反白·末位sub暗色；●淡绿#86efac 90ms闪烁", "#15803d"));
console.log(style("过期=CACHE EXPIRED 限界突破 00:00:00 終 OVER 了(红定格)；无 BGM/alarm（已删，见 commit ffd9834）", "#15803d"));
