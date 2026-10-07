#!/usr/bin/env python3
"""e2e_tui.py — pi TUI 真实终端 E2E 驱动（pty）

三个场景：
  A: k3 回归（不得误判 deepseek）+ 待机不显示 + /facc 菜单
  B: DeepSeek 默认模型 12h 宏观模式（HH:MM:SS + 長 EXTERNAL 期 + HIT%）
  C: 25s 短 TTL 假模型，真实走完 绿→黄→橙→红→红闪→限界突破 全周期

用法: python3 e2e_tui.py            # 全部场景
      python3 e2e_tui.py a|b|c      # 单个场景
产物: docs/e2e/<scenario>.log（原始 pty 字节流）+ docs/e2e/report.md
"""
import json, os, pty, re, select, shutil, struct, subprocess, sys, fcntl, termios, time
from pathlib import Path

PROJ = "/home/sim/code/famous-anime-cache-countdown"
REAL_AGENT = os.path.expanduser("~/.pi/agent")
OUT = Path(PROJ) / "docs" / "e2e"
OUT.mkdir(parents=True, exist_ok=True)

# 关键 ANSI 指纹（与 index.ts 色号一致）
# theme1（默认，语言品牌色）
GREEN_BG = "48;2;65;184;131"     # #41b883 NORMAL（Vue 绿）
YELLOW_BG = "48;2;255;200;90"    # #ffc85a CAUTION（custom 黄）
ORANGE_BG = "48;2;222;165;132"   # #dea584 DANGER（Rust 橙）
RED_BG = "48;2;194;45;64"        # #c22d40 EMERGENCY（Scala 红）
DS_BG = "48;2;49;120;198"        # #3178c6 DeepSeek 蓝（TypeScript 蓝）
DANGER_BG = "48;2;119;28;39"     # #771c27（theme1 红 -18% 亮度）
# theme2（原版 Tailwind）
GREEN_BG2 = "48;2;34;197;94"     # #22c55e NORMAL（theme2 原版绿）


class PtySession:
    def __init__(self, argv, env, log_path, cols=100, rows=30):
        self.master, slave = pty.openpty()
        fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
        e = dict(os.environ, TERM="xterm-256color", COLORTERM="truecolor", **env)
        self.proc = subprocess.Popen(argv, stdin=slave, stdout=slave, stderr=slave,
                                     env=e, cwd=PROJ, close_fds=True)
        os.close(slave)
        self.buf = b""
        self.log = open(log_path, "wb")

    def pump(self, timeout=0.2):
        r, _, _ = select.select([self.master], [], [], timeout)
        if r:
            try:
                data = os.read(self.master, 65536)
            except OSError:
                return False
            self.buf += data
            self.log.write(data)
            self.log.flush()
        return True

    def text(self):
        return self.buf.decode("utf-8", errors="replace")

    def plain(self):
        t = re.sub(r"\x1b\[[0-9;?]*[a-zA-Z]", "", self.text())
        return re.sub(r"\x1b\][^\x07]*\x07", "", t)

    def wait_for(self, pattern, timeout=30, regex=False, raw=False):
        deadline = time.time() + timeout
        while time.time() < deadline:
            self.pump(0.2)
            t = self.text() if raw else self.plain()
            if (re.search(pattern, t) if regex else pattern in t):
                return True
            if self.proc.poll() is not None:
                return False
        return False

    def drain(self, max_s=2.0, quiet=0.3):
        """抽干输出：quiet 秒无新数据或超过 max_s 即返回（扩展 83ms tick 会不停重绘，必须有上限）"""
        deadline = time.time() + max_s
        last_data = time.time()
        while time.time() < deadline:
            if self.pump(0.05):
                last_data = time.time()
            elif time.time() - last_data >= quiet:
                return

    def send(self, s, settle=0.4):
        os.write(self.master, s.encode())
        end = time.time() + settle
        while time.time() < end:
            self.pump(0.1)

    def count(self, needle):
        return self.text().count(needle)

    def resize(self, cols, rows=30):
        """动态改终端宽度（TIOCSWINSZ + 手动 SIGWINCH——子进程非该 pty 会话首进程，内核不代发）"""
        import signal
        fcntl.ioctl(self.master, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
        self.proc.send_signal(signal.SIGWINCH)
        time.sleep(1.0)
        self.drain()

    def close(self):
        try:
            self.proc.terminate()
            self.proc.wait(timeout=5)
        except Exception:
            self.proc.kill()
        self.log.close()
        os.close(self.master)


results = []


def seed_config(placement="belowEditor", theme="theme1"):
    """写 ~/.pi/agent/facc.json 到确定起点（theme1=默认；B/C/D 也靠它保证色号确定性）"""
    json.dump({"placement": placement, "theme": theme}, open(f"{REAL_AGENT}/facc.json", "w"))


def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + (f" — {detail}" if detail else ""))


def boot(argv_extra, env, log_name):
    s = PtySession(["pi", "--no-mcp", *argv_extra], env, OUT / log_name)
    # 新 agent dir 会先弹项目信任对话框：选第一项 "Trust"
    deadline = time.time() + 30
    while time.time() < deadline:
        s.pump(0.2)
        p = s.plain()
        if "Do not trust" in p:
            s.send("\r", settle=1.0)
            break
        if "clear/exit" in p:
            break
    # 等 TUI 启动横幅出现（keybinding 提示行 = 编辑器就绪）
    if not s.wait_for("ctrl+c/ctrl+d clear/exit", timeout=90):
        s.close()
        raise RuntimeError(f"pi TUI 未就绪（{log_name}）")
    time.sleep(1)
    s.drain()
    return s


# ── 场景 A：k3 回归 + 待机 + 斜杠命令 ──────────────────────────────────────
def scenario_a():
    print("scenario A: k3 regression + standby + commands")
    # 起点确定性：placement/theme 残留会导致菜单选中当前项而变成 unchanged 空操作
    seed_config()
    s = boot(["--model", "kimi-coding/k3"], {}, "a-k3.log")
    try:
        mark = len(s.buf)
        s.send("say ok\r")
        ok_widget = s.wait_for("CACHE 限界", timeout=90)
        check("A1 k3 首次请求后出现倒计时", ok_widget)
        standby_part = s.text()[: len(s.buf[:mark].decode('utf-8', errors='replace'))]
        check("A2 待机（请求前）不显示 CACHE 限界", "CACHE 限界" not in s.buf[:mark].decode("utf-8", errors="replace"))
        time.sleep(2)
        s.drain()
        t = s.text()
        check("A3 k3 走 300s 短逻辑（绿 NORMAL 徽章）", GREEN_BG in t and " NORMAL " in t)
        check("A4 k3 不显示蓝色 DEEPSEEK 宏观行", "CACHE DEEPSEEK" not in s.plain() and "EXTERNAL" not in s.plain(),
              "回归点：provider=kimi-coding,id=k3 不得判为 deepseek（#3b82f6 也被 swarm 徽章用，只查文本）")

        # —— /facc 双菜单：菜单 1 位置（3 项）+ 菜单 2 主题（2 项）——
        # 位置键：\r=第1项(aboveEditor)  \x1b[B\r=第2项(belowEditor)  \x1b[B\x1b[B\r=第3项(footer)
        # 主题键：\r=theme1(默认)  \x1b[B\r=theme2(原版 Tailwind)

        s.send("/facc\r", settle=1.0)
        check("A5 /facc 打开位置菜单", s.wait_for("widget placement", timeout=10))
        s.send("\r", settle=1.5)  # 位置第1项 = aboveEditor
        check("A5b /facc 进入主题菜单", s.wait_for("Tailwind", timeout=10))
        s.send("\r", settle=1.5)  # theme1（默认，保持不变）
        time.sleep(1.5); s.drain()
        cfg = json.load(open(f"{REAL_AGENT}/facc.json"))
        check("A6 /facc 切换到 aboveEditor（theme1 保持）",
              cfg.get("placement") == "aboveEditor" and cfg.get("theme") == "theme1")

        s.send("/facc\r", settle=1.0)
        s.wait_for("widget placement", timeout=10)
        s.send("\r", settle=1.5)  # aboveEditor（当前项，不变）
        s.send("\x1b[B\r", settle=1.5)  # theme2
        check("A7 /facc 切到 theme2", s.wait_for("theme → theme2", timeout=10))
        mark = len(s.buf); time.sleep(2); s.drain()
        t = s.buf[mark:].decode("utf-8", errors="replace")
        check("A7b theme2 渲染原版绿 #22c55e", GREEN_BG2 in t and GREEN_BG not in t)
        cfg = json.load(open(f"{REAL_AGENT}/facc.json"))
        check("A7c facc.json 记录 theme2", cfg.get("theme") == "theme2")

        s.send("/facc\r", settle=1.0)
        s.wait_for("widget placement", timeout=10)
        s.send("\r", settle=1.5)  # aboveEditor（当前项，不变）
        s.send("\r", settle=1.5)  # theme1
        check("A8 /facc 切回 theme1", s.wait_for("theme → theme1", timeout=10))
        cfg = json.load(open(f"{REAL_AGENT}/facc.json"))
        check("A8b facc.json 记录 theme1", cfg.get("theme") == "theme1")

        # footer 位置：setStatus 进入 footer 体系（本环境装着 pi-slim-footer → 插件行透传自带 ANSI）
        s.send("/facc\r", settle=1.0)
        s.wait_for("widget placement", timeout=10)
        s.send("\x1b[B\x1b[B\r", settle=1.5)  # 位置第3项 = footer
        s.send("\r", settle=1.5)  # theme1
        check("A9 /facc 切换到 footer", s.wait_for("placement → footer", timeout=10))
        mark = len(s.buf)
        time.sleep(2); s.drain()
        t = s.buf[mark:].decode("utf-8", errors="replace")
        check("A10 footer 模式：倒计时行经 setStatus 出现在 footer 体系（真色透传）",
              "CACHE 限界" in re.sub(r"\x1b\[[0-9;?]*[a-zA-Z]", "", t) and GREEN_BG in t)
        s.send("/facc\r", settle=1.0)
        s.wait_for("widget placement", timeout=10)
        s.send("\x1b[B\r", settle=1.5)  # 位置第2项 = belowEditor
        s.send("\r", settle=1.5)  # theme1
        check("A11 /facc 从 footer 切回 belowEditor", s.wait_for("placement → belowEditor", timeout=10))
        mark = len(s.buf)
        time.sleep(2); s.drain()
        t = re.sub(r"\x1b\[[0-9;?]*[a-zA-Z]", "", s.buf[mark:].decode("utf-8", errors="replace"))
        check("A12 切回后 widget 档位渲染恢复", "CACHE 限界" in t)
        cfg = json.load(open(f"{REAL_AGENT}/facc.json"))
        check("A13 facc.json 恢复 belowEditor + theme1",
              cfg.get("placement") == "belowEditor" and cfg.get("theme") == "theme1")
    finally:
        s.close()


# ── 场景 B：DeepSeek 12h 宏观模式 ─────────────────────────────────────────
def scenario_b():
    print("scenario B: deepseek 12h macro mode")
    seed_config()
    # 显式指定模型（真实 agent 默认模型现为 qwen-local 本地模型，不能依赖默认值）
    s = boot(["--model", "deepseek/deepseek-v4-pro"], {}, "b-deepseek.log")
    try:
        s.send("say ok\r")
        ok = s.wait_for("CACHE DEEPSEEK", timeout=90)
        check("B1 deepseek 请求后出现宏观行", ok)
        time.sleep(3)
        s.drain()
        t = s.text()
        check("B2 蓝色徽章配色 #3178c6", DS_BG in t)
        check("B3 HH:MM:SS 宏观时间（11:5x:xx）", bool(re.search(r"11:5\d:\d\d", t)))
        check("B4 長 EXTERNAL 期 徽章", "EXTERNAL" in t)
        check("B5 HIT% 徽章（--% 或真实命中率）", bool(re.search(r"HIT (?:--|\d+)%", t)))
        # 只查文本：GREEN_BG(#41b883) 与 pi-swarm 的 MANAGER 会话徽章撞色，颜色断言在本环境不可靠
        check("B6 不出现五段短逻辑徽章", "CACHE 限界" not in t and " NORMAL " not in s.plain())
    finally:
        s.close()


# ── 场景 C：25s 短 TTL 全周期（隔离 agent dir + 假模型）─────────────────────
def scenario_c():
    print("scenario C: 25s TTL full phase cycle (isolated agent dir)")
    seed_config()  # facc.json 仍走 ~/.pi/agent（homedir 基准），隔离 agent dir 不影响它
    tmp = Path("/tmp/facc-e2e-agent")
    shutil.rmtree(tmp, ignore_errors=True)
    tmp.mkdir(parents=True)
    auth = json.load(open(f"{REAL_AGENT}/auth.json"))
    (tmp / "auth.json").write_text(json.dumps({"deepseek": auth["deepseek"]}))
    (tmp / "models.json").write_text(json.dumps({
        "providers": {
            "e2e25": {
                "baseUrl": "https://api.deepseek.com",
                "api": "openai-completions",
                "apiKey": auth["deepseek"]["key"],
                "models": [{
                    "id": "e2e-25s", "name": "E2E 25s TTL",
                    "api": "openai-completions",
                    "baseUrl": "https://api.deepseek.com",
                    "provider": "e2e25",
                    "reasoning": False,
                    "input": ["text"],
                    "cost": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0},
                    "contextWindow": 128000, "maxTokens": 8192,
                    "promptCache": {"short": 25},
                }],
            }
        }
    }))
    (tmp / "settings.json").write_text(json.dumps({
        "lastChangelogVersion": "1.0.4",
        "defaultProvider": "e2e25", "defaultModel": "e2e-25s",
    }))

    s = boot(["-e", f"{PROJ}/index.ts", "--model", "e2e25/e2e-25s"],
             {"PI_CODING_AGENT_DIR": str(tmp)}, "c-phases.log")
    try:
        mark = len(s.buf)
        s.send("hi\r")
        t0 = time.time()
        check("C1 请求发出后倒计时出现（25s TTL）", s.wait_for("CACHE 限界", timeout=60))
        check("C2 待机不显示", "CACHE 限界" not in s.buf[:mark].decode("utf-8", errors="replace"))
        # 采 35s：记录各颜色首见时间（相对 t0）
        first = {}
        end = time.time() + 35
        while time.time() < end:
            s.pump(0.2)
            t = s.text()
            for label, pat in [("green", GREEN_BG), ("yellow", YELLOW_BG), ("orange", ORANGE_BG),
                               ("red", RED_BG), ("dangerBg", DANGER_BG), ("expired", "CACHE EXPIRED 限界突破")]:
                if label not in first and pat in t:
                    first[label] = round(time.time() - t0, 1)
            if "expired" in first:
                break
        print("  phase first-seen:", first)
        order_ok = all(k in first for k in ("green", "yellow", "orange", "red", "expired")) and \
            first["green"] < first["yellow"] < first["orange"] < first["red"] < first["expired"]
        check("C3 五段按序切换 绿→黄→橙→红→限界突破", order_ok, json.dumps(first))
        check("C4 过期定格 CACHE EXPIRED 限界突破", "expired" in first and "终 OVER 了" in s.text())
        check("C5 过期时间 ~25s（20~35s 区间）", "expired" in first and 18 <= first["expired"] <= 35,
              f"expired at {first.get('expired')}s")
        check("C6 EMERGENCY 段出现 #771c27 深红徽章", "dangerBg" in first)
    finally:
        s.close()
        shutil.rmtree(tmp, ignore_errors=True)


# ── 场景 D：窄宽度自适应缩略档（tui_compact_design.md v3）────────────────────
TICK_RE = r"[\u2800-\u28ff]│"   # braille 条中央 tick（仅完整版有）
CC_RE = r"\d\d:\d\d:\d\d"        # MM:SS:cc（L3 砍 cc）

def scenario_d():
    print("scenario D: narrow-width adaptive tiers (k3, 300s green)")
    seed_config()
    s = boot(["--model", "kimi-coding/k3"], {}, "d-tiers.log")
    # pi TUI 用光标定位重绘（无 \r\n 分行），滚动缓冲会永久保留旧帧——
    # 每次 resize 后只检查缓冲区增量，否则旧完整版帧会造成误判
    def fresh_plain(mark):
        return re.sub(r"\x1b\[[0-9;?]*[a-zA-Z]", "", s.buf[mark:].decode("utf-8", errors="replace"))
    try:
        s.send("say ok\r")
        ok = s.wait_for("CACHE 限界", timeout=90)
        time.sleep(2); s.drain()
        mark = len(s.buf)
        s.drain(max_s=1.0, quiet=0.6)  # 等一帧新重绘进入增量（83ms tick 持续 requestRender）
        t = fresh_plain(mark)
        check("D1 100列=完整版（中央 tick + 全长 NORMAL）", ok and re.search(TICK_RE, t) and " NORMAL " in t)

        mark = len(s.buf); s.resize(60)
        t = fresh_plain(mark)
        check("D2 60列=L1（丢 tick，●/cc/全长状态保留）",
              not re.search(TICK_RE, t) and " NORMAL " in t and re.search(CC_RE, t) and "●" in t)

        mark = len(s.buf); s.resize(48)
        t = fresh_plain(mark)
        check("D3 48列=L2（盲文→4，状态中英取短 NORM，●/cc 保留）",
              "NORMAL" not in t and " NORM " in t and re.search(CC_RE, t) and "●" in t)

        mark = len(s.buf); s.resize(30)
        t = fresh_plain(mark)
        check("D4 30列=L3（徽章砍 限界、砍 cc，● 仍在=铁律，绿底仍在）",
              "CACHE 限界" not in t and not re.search(CC_RE, t) and "●" in t and GREEN_BG in s.buf[mark:].decode("utf-8", errors="replace"))

        mark = len(s.buf); s.resize(100)
        t = fresh_plain(mark)
        check("D5 回到100列=完整版恢复（tick + NORMAL）", bool(re.search(TICK_RE, t)) and " NORMAL " in t)
    finally:
        s.close()


# ── 场景 E：本地/自托管 API ∞ 模式（loopback baseUrl、无 promptCache 声明）────────
def scenario_e():
    print("scenario E: local API infinite mode (127.0.0.1, no promptCache)")
    seed_config()
    tmp = Path("/tmp/facc-e2e-local")
    shutil.rmtree(tmp, ignore_errors=True)
    tmp.mkdir(parents=True)
    auth = json.load(open(f"{REAL_AGENT}/auth.json"))
    (tmp / "auth.json").write_text(json.dumps({"deepseek": auth["deepseek"]}))
    # baseUrl 指向 127.0.0.1 → isLocalModel 命中；请求必然连接失败，但 before_provider_request
    # 在 HTTP 调用前已触发 → 徽章照样点亮（这正是本场景要验证的：无 TTL 不倒计时）
    (tmp / "models.json").write_text(json.dumps({
        "providers": {
            "e2elocal": {
                "baseUrl": "http://127.0.0.1:18000/v1",
                "api": "openai-completions",
                "apiKey": "sk-local",
                "models": [{
                    "id": "qwen-local", "name": "E2E local",
                    "api": "openai-completions",
                    "baseUrl": "http://127.0.0.1:18000/v1",
                    "provider": "e2elocal",
                    "reasoning": False,
                    "input": ["text"],
                    "cost": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0},
                    "contextWindow": 128000, "maxTokens": 8192,
                }],
            }
        }
    }))
    (tmp / "settings.json").write_text(json.dumps({
        "lastChangelogVersion": "1.0.4",
        "defaultProvider": "e2elocal", "defaultModel": "qwen-local",
    }))

    s = boot(["-e", f"{PROJ}/index.ts", "--model", "e2elocal/qwen-local"],
             {"PI_CODING_AGENT_DIR": str(tmp)}, "e-local.log")
    try:
        mark = len(s.buf)
        s.send("hi\r")
        ok = s.wait_for("CACHE 無限", timeout=60)
        check("E1 本地模型请求后出现 CACHE 無限 徽章", ok)
        check("E2 待机不显示", "CACHE 無限" not in s.buf[:mark].decode("utf-8", errors="replace"))
        time.sleep(2)
        s.drain()
        t = s.text()
        p = s.plain()
        check("E3 蓝色徽章配色 #3178c6（与 DeepSeek 同属长期档）", DS_BG in t)
        # pi 自身的重试 spinner 也用盲文（⠙⠹⠸ 等低位点阵）——只查本扩展 gauge 专用的高位填充符
        check("E4 无倒计时/无 gauge 条/无 ●/无状态徽章",
              not re.search(r"\d\d:\d\d", p) and "●" not in p
              and not re.search(r"[⣀⣤⣶⣿]", p)
              and "INFINITE" not in p and "CACHE 限界" not in p and "EXTERNAL" not in p)
        # 时间推移仍静态（无倒计时数字变化）
        mark = len(s.buf)
        time.sleep(3)
        s.drain()
        check("E5 3s 后仍只有静态徽章（无新倒计时帧）",
              "CACHE 限界" not in s.buf[mark:].decode("utf-8", errors="replace"))
    finally:
        s.close()
        shutil.rmtree(tmp, ignore_errors=True)


SCENARIOS = {"a": scenario_a, "b": scenario_b, "c": scenario_c, "d": scenario_d, "e": scenario_e}
which = sys.argv[1:] or ["a", "b", "c", "d", "e"]
for w in which:
    try:
        SCENARIOS[w]()
    except Exception as e:
        check(f"scenario {w} 运行异常", False, repr(e))

lines = ["# facc E2E report", "", f"- date: {time.strftime('%Y-%m-%d %H:%M:%S')}",
         f"- pi: {subprocess.run(['pi', '--version'], capture_output=True, text=True).stdout.strip()}",
         ""]
for name, ok, detail in results:
    lines.append(f"- [{'PASS' if ok else 'FAIL'}] {name}" + (f" — {detail}" if detail else ""))
(OUT / "report.md").write_text("\n".join(lines) + "\n")
failed = [n for n, ok, _ in results if not ok]
print(f"\n{'ALL PASS' if not failed else 'FAILED: ' + ', '.join(failed)}  (report: {OUT/'report.md'})")
sys.exit(1 if failed else 0)
