# pi-famous-anime-cache-countdown

EVA「活動限界」-style prompt-cache TTL countdown for [pi](https://github.com/badlogic/lemerniss-coding-agent) — a single-line widget that shows how long your Anthropic prompt cache entry has left to live (default TTL 5 min).

![layout](https://img.shields.io/badge/layout-one%20line-green)

```
 CACHE 限界  ⣤⣿⣿⣿⣿⣿⣿⣿⣿⣿│⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿ ●  04:52:64   NORMAL
```

## Demo

Five-phase countdown → 限界突破 (expired):

![five phases](docs/five-phases.gif)

DeepSeek 12h macro mode (`HH:MM:SS` + `長 EXTERNAL 期` + real `HIT%`):

![deepseek 12h](docs/deepseek-12h.gif)

Standby → wakes on first request (nothing is shown before that):

![standby wake](docs/standby-wake.gif)

GIFs are rendered from the real extension code (`demo-frames.mjs` + `render_gif.py`); E2E verification against a live pi TUI is in `e2e_tui.py` (report: `docs/e2e/report.md`).

## Demo

DeepSeek 12 h macro mode (undocumented, best-effort cache that empirically lives ≥ 12 h):

![deepseek-12h](docs/deepseek-12h.gif)

Full 5-minute lifecycle, compressed to ~12 s — five phases, final-second flash, then 限界突破:

![five-phases](docs/five-phases.gif)

Standby → first request lights it up:

![standby-wake](docs/standby-wake.gif)

## Features

- **One line, five states** (TTL split into fifths): `NORMAL` (green) → `注 CAUTION 意` (yellow) → `危 DANGER 険` (orange) → `緊 EMERGENCY 急` (red) → inverted-flash EMERGENCY (final fifth)
- 20-cell braille gauge (3 vertical sub-levels per cell = 60 steps), center tick
- `MM:SS:cc` countdown with a soft-pulsing `●`; the centiseconds roll naturally (83 ms render tick, non-divisible by the 10 ms digit period)
- On expiry: `CACHE EXPIRED 限界突破  00:00:00  終 OVER 了` (all red)
- **Correct trigger semantics** (mirrors pi's built-in `cache-warmer`): the countdown resets when a request is *sent* to the provider (`before_provider_request`), not when a response reports cache usage; warming replays (`cache_warming_decision`) also reset it. TTL comes from `model.promptCache[short|long]` (`PI_CACHE_RETENTION=long` supported), falling back to 300 s.
- **Polite UI citizen**: rendered via `setWidget`, never replaces your footer. Nothing is shown until the first request of the session.
- Terminal bell alarm: once when entering the final fifth, then every second for the last 10 s.
- **DeepSeek 12 h mode** (models with `provider`/`id` matching "deepseek", which don't declare `promptCache`):
  ```
   CACHE DEEPSEEK  ⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿│⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿  11:59:50   長 EXTERNAL 期   HIT 96%
  ```
  DeepSeek's prompt cache has no fixed TTL (empirically ≥ 12 h), so you get a blue 12-hour macro countdown with `HH:MM:SS`. The **HIT %** badge shows the real cache-hit rate of the last response, derived for free from `usage.prompt_cache_hit_tokens` (pi maps it to `cacheRead`). At 5 minutes left it switches seamlessly into the five-phase short logic.

## Install

```bash
pi install npm:pi-facc
# or from source:
pi install https://github.com/fishing-dev-sm/pi-famous-anime-cache-countdown
```

## Commands

| Command | Action |
|---|---|
| `/facc` | Settings menu. First menu: widget placement `aboveEditor` / `belowEditor` (persisted to `~/.pi/agent/facc.json`, applied live) |
| `/eva_cache_countdown` | Toggle the terminal-bell alarm |

## Development

- `preview.mjs` — true-color ANSI design preview (`node preview.mjs`)
- `test-render.mjs` — render samples of every phase (`node test-render.mjs`)
- `demo-frames.mjs` + `render_gif.py` — GIF pipeline: emits frames with the real render functions, rasterizes them with PIL (`node demo-frames.mjs | python3 render_gif.py docs/`)
- `tui_design_eva.md` — design notes
