# facc E2E report

- date: 2026-10-06 19:51:08
- pi: 1.0.4

- [PASS] A1 k3 首次请求后出现倒计时
- [PASS] A2 待机（请求前）不显示 CACHE 限界
- [PASS] A3 k3 走 300s 短逻辑（绿 NORMAL 徽章）
- [PASS] A4 k3 不显示蓝色 DEEPSEEK 宏观行 — 回归点：provider=kimi-coding,id=k3 不得判为 deepseek（#3b82f6 也被 swarm 徽章用，只查文本）
- [PASS] A5 /facc 打开配置菜单
- [PASS] A6 /facc 切换到 aboveEditor
- [PASS] A7 /facc 切回 belowEditor
- [PASS] A8 facc.json 恢复 belowEditor
- [PASS] B1 deepseek 请求后出现宏观行
- [PASS] B2 蓝色徽章配色 #3b82f6
- [PASS] B3 HH:MM:SS 宏观时间（11:5x:xx）
- [PASS] B4 長 EXTERNAL 期 徽章
- [PASS] B5 HIT% 徽章（--% 或真实命中率）
- [PASS] B6 不出现五段短逻辑徽章
- [PASS] C1 请求发出后倒计时出现（25s TTL）
- [PASS] C2 待机不显示
- [PASS] C3 五段按序切换 绿→黄→橙→红→限界突破 — {"green": 0.2, "yellow": 3.6, "orange": 8.6, "red": 13.6, "dangerBg": 13.6, "expired": 24.6}
- [PASS] C4 过期定格 CACHE EXPIRED 限界突破
- [PASS] C5 过期时间 ~25s（20~35s 区间） — expired at 24.6s
- [PASS] C6 EMERGENCY 段出现 #b91c1c 深红徽章
