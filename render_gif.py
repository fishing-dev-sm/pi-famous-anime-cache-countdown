#!/usr/bin/env python3
"""render_gif.py — 把 demo-frames.mjs 的 JSON Lines 帧渲染成 GIF

用法: node demo-frames.mjs | python3 render_gif.py docs/
- 按 "scene: <name>" 标记帧切分，每个场景输出 docs/<name>.gif
- 真色 ANSI (38;2 / 48;2) 解析；CJK 宽字符占 2 格；braille 用 FreeMono
"""
import json, re, sys, unicodedata
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
from fontTools.ttLib import TTFont, TTCollection

MONO = "/usr/share/fonts/TTF/JetBrainsMonoNerdFontMono-Regular.ttf"
CJK = "/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc"
BRAILLE = "/usr/share/fonts/gnu-free/FreeMono.otf"
SIZE = 16
CELL_PAD_Y = 5
BG = (13, 17, 23)          # GitHub dark #0d1117
FG_DEFAULT = (201, 209, 217)  # #c9d1d9
COLS, ROWS = 84, 8

def load_font(path, size):
    if path.endswith(".ttc"):
        coll = TTCollection(path)
        cmap = coll.fonts[0].getBestCmap()
        return ImageFont.truetype(path, size, index=0), set(cmap)
    tt = TTFont(path, fontNumber=0, lazy=True)
    return ImageFont.truetype(path, size), set(tt.getBestCmap())

mono_f, mono_c = load_font(MONO, SIZE)
braille_f, braille_c = load_font(BRAILLE, SIZE)
cjk_f, cjk_c = load_font(CJK, SIZE)

CELL_W = round(mono_f.getlength("M"))
CELL_H = SIZE + CELL_PAD_Y * 2

SGR = re.compile(r"\x1b\[([0-9;]*)m")

def parse_runs(line):
    """ANSI 行 → [(char, fg, bg)]，fg/bg 为 (r,g,b) 或 None"""
    cells, fg, bg, pos = [], FG_DEFAULT, None, 0
    for m in SGR.finditer(line):
        for ch in line[pos:m.start()]:
            cells.append([ch, fg, bg])
        codes = [int(c) for c in m.group(1).split(";") if c != ""] or [0]
        i = 0
        while i < len(codes):
            c = codes[i]
            if c == 0:
                fg, bg = FG_DEFAULT, None
            elif c == 38 and i + 4 < len(codes) and codes[i + 1] == 2:
                fg = tuple(codes[i + 2:i + 5]); i += 4
            elif c == 48 and i + 4 < len(codes) and codes[i + 1] == 2:
                bg = tuple(codes[i + 2:i + 5]); i += 4
            i += 1
        pos = m.end()
    for ch in line[pos:]:
        cells.append([ch, fg, bg])
    return cells

def font_for(ch):
    cp = ord(ch)
    if 0x2800 <= cp <= 0x28FF and cp in braille_c:
        return braille_f
    if unicodedata.east_asian_width(ch) in ("W", "F") and cp in cjk_c:
        return cjk_f
    if cp in mono_c:
        return mono_f
    if cp in cjk_c:
        return cjk_f
    return mono_f

def render_frame(lines):
    img = Image.new("RGB", (COLS * CELL_W, ROWS * CELL_H), BG)
    d = ImageDraw.Draw(img)
    for row, line in enumerate(lines[:ROWS]):
        x = 0
        y = row * CELL_H
        for ch, fg, bg in parse_runs(line):
            wide = unicodedata.east_asian_width(ch) in ("W", "F")
            w = CELL_W * (2 if wide else 1)
            if x + w > COLS * CELL_W:
                break
            if bg:
                d.rectangle([x, y, x + w, y + CELL_H], fill=bg)
            d.text((x + (w - mono_f.getlength(ch)) / 2 if not wide else x, y + CELL_PAD_Y - 2),
                   ch, font=font_for(ch), fill=fg)
            x += w
    return img

def main():
    outdir = Path(sys.argv[1] if len(sys.argv) > 1 else "docs")
    outdir.mkdir(exist_ok=True)
    scenes, name, frames = {}, None, []
    durations = {}
    for raw in sys.stdin:
        f = json.loads(raw)
        # 场景标记帧：单行 dim 文本 "scene: xxx"
        if len(f["lines"]) == 1 and "scene: " in f["lines"][0]:
            if name:
                scenes[name], durations[name] = frames, durs
            name = re.sub(r"\x1b\[[0-9;]*m", "", f["lines"][0]).split("scene: ")[1].strip()
            frames, durs = [], []
            continue
        frames.append(render_frame(f["lines"]))
        durs.append(f["dur"])
    if name:
        scenes[name], durations[name] = frames, durs
    for name, frames in scenes.items():
        p = outdir / f"{name}.gif"
        frames[0].save(p, save_all=True, append_images=frames[1:],
                       duration=durations[name], loop=0, optimize=True)
        print(f"{p}  {len(frames)} frames  {p.stat().st_size/1024:.0f} KiB")

main()
