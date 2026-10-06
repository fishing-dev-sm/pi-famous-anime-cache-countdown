// preview.mjs — EVA「活動限界」cache countdown 完整设计稿（真实 ANSI 颜色）
// 运行：node preview.mjs
// v4：四段色（绿→黄→橙→红）· braille 进度条 · 双线夹心+刻度边框 · 反白徽章

const RESET = "\x1b[0m";
const fg = (c, s) => `\x1b[38;2;${c[0]};${c[1]};${c[2]}m${s}${RESET}`;
const bgc = (c, s) => `\x1b[48;2;${c[0]};${c[1]};${c[2]}m${s}${RESET}`;
const blink = (s) => `\x1b[5m${s}\x1b[0m`;

const hexToRgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

// contrastTextColor（抄 pi-fleet color.ts，WCAG 相对亮度选黑/白字）
function contrastTextColor(bgHex) {
  const [r, g, b] = hexToRgb(bgHex);
  const ch = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  const lum = 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
  return (lum + 0.05) / 0.05 >= 1.05 / (lum + 0.05) ? "#000000" : "#ffffff";
}
// badge（抄 pi-fleet color.ts，bg 填充 + contrastTextColor 选字色）
const badge = (s, bgHex) => {
  const f = hexToRgb(contrastTextColor(bgHex));
  const b = hexToRgb(bgHex);
  return `\x1b[38;2;${f.join(";")}m\x1b[48;2;${b.join(";")}m${s}${RESET}`;
};

// 色号（抄自 pi-fleet packages/pi-agent-swarm/src/color.ts + swarm-controller.ts）
// SWARM_COLORS = 角色 8 色调色板；ROLE_BADGE_BG = LEADER/WORKER 反白奶油黄
const SWARM_COLORS = { red: "#ef4444", orange: "#f97316", yellow: "#eab308", green: "#22c55e",
                       cyan: "#06b6d4", blue: "#3b82f6", magenta: "#d946ef", purple: "#8b5cf6" };
const ROLE_BADGE_BG = "#ffc85a"; // LEADER/WORKER 反白奶油黄（swarm-controller.ts:51）

// 四段色 随时间恶化：绿→黄→橙→红（main 抄 SWARM_COLORS；hi/sub/tick 用 Tailwind 400/700/600 色阶）
// 时间划分（总 5:00）：绿 >3:45 ｜ 黄 3:45–2:30 ｜ 橙 2:30–1:15 ｜ 红 <1:15
const TOTAL = 300;
const phase = (sec) => sec > 225 ? 0 : sec > 150 ? 1 : sec > 75 ? 2 : 3; // 0绿 1黄 2橙 3红

const P = [
  { main: "#22c55e", hi: "#4ade80", sub: "#15803d", slot: "#052e0f", tick: "#16a34a", panel: "#04170a" }, // 0 绿 green
  { main: "#eab308", hi: "#facc15", sub: "#a16207", slot: "#2a2001", tick: "#ca8a04", panel: "#0f0c01" }, // 1 黄 yellow
  { main: "#f97316", hi: "#fb923c", sub: "#c2410c", slot: "#2a1201", tick: "#ea580c", panel: "#100601" }, // 2 橙 orange
  { main: "#ef4444", hi: "#f87171", sub: "#b91c1c", slot: "#2a0101", tick: "#dc2626", panel: "#0f0101" }, // 3 红 red
];
const MAIN = (e) => hexToRgb(P[e].main);
const HI = (e) => hexToRgb(P[e].hi);
const SLOT = (e) => hexToRgb(P[e].slot);
const SUB = (e) => hexToRgb(P[e].sub);
const TICK = (e) => hexToRgb(P[e].tick);
const PANEL = (e) => hexToRgb(P[e].panel);

// ---- 可见宽度（CJK 按 2 列）----
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
const padC = (s, w) => { const d = w - vw(s); const l = Math.floor(d / 2); return " ".repeat(l) + s + " ".repeat(d - l); };
const padL = (s, w) => s + " ".repeat(Math.max(0, w - vw(s)));
const padR = (s, w) => " ".repeat(Math.max(0, w - vw(s))) + s;

// ---- 大数字 5×3 全块字模 ----
const D = {
  "0": ["███", "█ █", "█ █", "█ █", "███"],
  "1": [" █ ", "██ ", " █ ", " █ ", "███"],
  "2": ["███", "  █", "███", "█  ", "███"],
  "3": ["███", "  █", "███", "  █", "███"],
  "4": ["█ █", "█ █", "███", "  █", "  █"],
  "5": ["███", "█  ", "███", "  █", "███"],
  "6": ["███", "█  ", "███", "█ █", "███"],
  "7": ["███", "  █", "  █", "  █", "  █"],
  "8": ["███", "█ █", "███", "█ █", "███"],
  "9": ["███", "█ █", "███", "  █", "███"],
  ":": ["   ", " █ ", "   ", " █ ", "   "],
};
function bigRows(str, e) {
  const rows = ["", "", "", "", ""];
  for (const ch of str) {
    const g = D[ch] ?? D["0"];
    for (let r = 0; r < 5; r++) {
      rows[r] += (ch === ":" ? blink(fg(HI(e), g[r])) : fg(MAIN(e), g[r])) + " ";
    }
  }
  return rows;
}

// ---- 进度条：braille 点阵（⣿ 满 / ⣀ 空，同一主色，靠点阵密度区分）----
function gauge(cells, sec, e, blinkEdge) {
  const filled = Math.round((sec / TOTAL) * cells);
  const half = cells / 2;
  let out = "";
  for (let i = 0; i < cells; i++) {
    const on = i >= cells - filled;
    let seg = fg(MAIN(e), on ? "⣿" : "⣀");  // ⣀/⣿ 同一主色
    if (blinkEdge && on && i >= cells - blinkEdge) seg = blink(seg);
    out += seg;
    if (i === half - 1) out += fg(TICK(e), "│");
  }
  return out;
}

function fmt(sec, centi) {
  return `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}:${String(centi).padStart(2, "0")}`;
}

// ============================================================
// 一级 · 一行简约版
// ============================================================
function lineVersion(sec, centi) {
  const e = phase(sec);
  const t = fmt(sec, centi);
  const bar = gauge(20, sec, e, sec <= 20 ? 2 : 0);
  const tBlock = badge(" " + t + " ", P[e].main);  // 时间数字反白（主色底+黑字）
  const status = e === 3 ? fg(SUB(e), "CACHE ") + badge("危 DANGER 険", "#b91c1c")
                         : fg(SUB(e), "CACHE ") + badge("NORMAL", P[e].main);
  return `${badge(" CACHE TTL 限界 ", P[e].main)} ${bar} ${tBlock} ${status}`;
}

console.log("══════════ 完整设计稿 · 一级 · 一行简约版 ══════════");
console.log(lineVersion(280, 0));  // 绿段 04:40:00
console.log(lineVersion(200, 0));  // 黄段 03:20:00
console.log(lineVersion(120, 0));  // 橙段 02:00:00
console.log(lineVersion(40, 0));   // 红段 00:40:00
console.log(lineVersion(9, 42));   // 红段 00:09:42（末段闪烁）
console.log("");

// ============================================================
// 二级 · 多行完整版（双线夹心边框 + 内嵌刻度 + 反色）
// ============================================================
const IN = 60; // 内宽

function fullPanel(sec, centi) {
  const e = phase(sec);
  const t = fmt(sec, centi);
  const pct = Math.round((sec / TOTAL) * 100);
  const bar = gauge(24, sec, e, sec <= 20 ? 2 : 0);
  const battN = Math.ceil(sec / 30);
  const batt = fg(MAIN(e), "▮".repeat(battN)) + fg(SLOT(e), "▯".repeat(10 - battN));
  const battLabel = fg(HI(e), ["100%", "75%", "50%", "LOW"][e]);

  const top = `PROMPT CACHE SYSTEM ─ 限界`;
  const bot = `PI AGENT · MODEL SYNC ── CACHE · SESSION`;
  // 内嵌刻度行（24 格条，每 6 格一个 ┬）
  let ruler = "";
  for (let i = 0; i < 24; i++) ruler += (i % 6 === 0 ? fg(SUB(e), "┬") : " ");
  const internalLine = `CACHE ▸ ${bar} ${fg(HI(e), String(pct).padStart(3) + "% REMAINING")}`;
  const externalLine = `${fg(SUB(e), "API ─ RECOMPUTE")}  ${fg(SUB(e), "BUFFER")} ${batt} ${battLabel}`;
  const status = e === 3 ? `${fg(SUB(e), "STATUS:")} ${badge(" 危 DANGER 険 ", "#b91c1c")} ${fg(HI(e), "EXPIRING")}`
                         : `${fg(SUB(e), "STATUS:")} ${badge("NORMAL", P[e].main)}`;
  const sound = e === 3 ? `${fg(HI(e), "BGM ON")}  ${fg(HI(e), "⚠警報 ON")}`
                        : `${fg(HI(e), "BGM ON")}  ${fg(HI(e), "⚠警報 ON")}  ${fg(SUB(e), "TTL 5:00")}`;

  // 内框（light，次级色）+ 外框（heavy，主色）
  const inE = fg(SUB(e), "│");
  const innerTop = fg(SUB(e), "┌─") + fg(MAIN(e), top) + fg(SUB(e), "─".repeat(Math.max(1, IN - vw(top))) + "┐");
  const innerBot = fg(SUB(e), "└─") + fg(MAIN(e), bot) + fg(SUB(e), "─".repeat(Math.max(1, IN - vw(bot))) + "┘");
  const blank = bgc(PANEL(e), inE + " ".repeat(IN) + inE);
  const center = (s) => bgc(PANEL(e), inE + padC(s, IN) + inE);
  const readout = (s) => bgc(PANEL(e), inE + "  " + padL(s, IN - 2) + inE);

  const wrap = (s) => fg(MAIN(e), "║") + s + fg(MAIN(e), "║");
  const outerTop = fg(MAIN(e), "╔" + "═".repeat(IN + 2) + "╗");
  const outerBot = fg(MAIN(e), "╚" + "═".repeat(IN + 2) + "╝");

  const L = [];
  L.push(outerTop);
  L.push(wrap(innerTop));
  L.push(wrap(blank));
  for (const r of bigRows(t, e)) L.push(wrap(center(r)));
  L.push(wrap(blank));
  L.push(wrap(readout("CACHE ▸ " + ruler)));   // 内嵌刻度
  L.push(wrap(readout(internalLine)));         // CACHE 条
  L.push(wrap(readout(externalLine)));         // API/BUFFER
  L.push(wrap(readout(status + "  " + sound))); // STATUS
  L.push(wrap(innerBot));
  L.push(outerBot);
  return L;
}

console.log("══════════ 完整设计稿 · 二级 · 多行完整版（绿段 04:40:00）══════════");
console.log(fullPanel(280, 0).join("\n"));
console.log("");
console.log("══════════ 完整设计稿 · 二级 · 多行完整版（黄段 03:20:00）══════════");
console.log(fullPanel(200, 0).join("\n"));
console.log("");
console.log("══════════ 完整设计稿 · 二级 · 多行完整版（橙段 02:00:00）══════════");
console.log(fullPanel(120, 0).join("\n"));
console.log("");
console.log("══════════ 完整设计稿 · 二级 · 多行完整版（红段 00:40:00）══════════");
console.log(fullPanel(40, 0).join("\n"));
console.log("");

console.log(fg(SUB(0), "统一色：整行随段主色（标语/NORMAL 反白也随段变色，字色用 WCAG contrastTextColor）"));
console.log(fg(SUB(0), "四段色(抄 pi-fleet) 绿#22c55e(>3:45) → 黄#eab308(3:45–2:30) → 橙#f97316(2:30–1:15) → 红#ef4444(<1:15)"));
console.log(fg(SUB(0), "进度条=braille点阵(⣿满/⣀空 同一主色)；时间数字反白；双线夹心边框(外主色║╔╗ + 内次级│┌┐)；CACHE条上方内嵌刻度┬"));
