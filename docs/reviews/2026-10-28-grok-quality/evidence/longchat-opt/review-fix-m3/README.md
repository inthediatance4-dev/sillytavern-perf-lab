# M3：最终端到端 A/B

本目录只用于 merge-blocker 3。最终表格由本次单一测量会话生成，不拼接 P1/P2/P3/P4 的历史数字。

## 构造和复现

产品基线为 `37a48181fc55f7d2c45bae05f1a68c26a4c76d5d` 的 `public/`。先把当前 HEAD 的 `package.json`、`package-lock.json`、`server.js`、`webpack.config.js`、`src/`、`default/`、`scripts/`、`tests/` 用 `git archive HEAD … | tar -x -C <tmp>/lcab-37a48181fc55-m3-…` 展开，再把 `git archive 37a4818 public/` 解到同一目录。因此旧产品树中不存在 HEAD 新增 public 文件的残留，后台、默认配置和依赖版本相同。`node_modules` 链接到当前仓库依赖，测量不写入依赖。补齐 `PUBLIC_DIRECTORIES` 的空目录后归档树去掉写权限；运行数据只写每次新建的独立临时根。

head 为当前工作目录。测量启动时 HEAD 为 `b2122a4d81deb7877d9a870e159db0b44f0257bc`，包含 m1 `8c0c939`、m4 `6586620`、m2 `0054c8b`；额外的 owner 修复在两侧后台都存在。本步没有改产品代码。

两侧都由当前 `tests/browser-longchat-perf.py` 调用；注入当前 `longchat-browser-probe.mjs` 和 `longchat-normalization.mjs`。服务器入口、启动辅助和统计模块也来自同一 HEAD。`session/comparison.json` 记录提交号、工具 SHA-256、顺序、退出码和原始文件位置。

```sh
<tmp>/pw-venv/bin/python tests/longchat-final-ab.py \
  --node <tmp>/node-v24.22.1-linux-x64/bin/node \
  --output docs/reviews/2026-10-28-grok-quality/evidence/longchat-opt/review-fix-m3/session
```

固定 10 轮；每轮依次执行 100-immediate 的 A/B、100-history10 的 A/B、0-immediate 的 A/B，顺序始终 ABAB…，共 60 次。每次一台新服务器、一个独立数据根、一个新浏览器，顺序运行。immediate 不加载历史，history10 从同一 2000 条原始数据重新打开后连续加载 10 批，每批 100 条，再发送；不会继承 immediate 的发送。三个 cohort 都先打开聊天；主表的 open 只使用 immediate cohort，避免重复计数。history10 中第 1–3 批各单独报告。固定预定次数，无额外预热样本、无自动重试、无选择性丢弃失败。错误、超时、缺失文件或退出失败都令矩阵验收失败，并禁止生成成功配对统计。

## 计时口径

应用启动、onboarding 和工具安装不计入任何窗口；先等待 sticky APP_READY、主界面可见、无 dialog/splash。`getCharacters()` 和角色索引查询也在 open 计时前完成。

| 指标 | 起点 | 终点 | 500 ms 静默等待 |
|---|---|---|---|
| open | 浏览器 `performance.now()`，紧邻 `selectCharacterById()` 前 | 选择 promise 完成，确认 CHAT_CHANGED、数组长度和最后一条 DOM，再等 `labIdle()` 完成后取时钟 | **包含** |
| older1/2/3 | 设置 scrollTop=0、预静默和锚点采样之后，紧邻 `showMoreMessages()` 前的 `performance.now()` | 该 promise 完成后的第一个 `performance.now()`，包括最终插入、滚动修正和 MORE_MESSAGES_LOADED 监听器 | **不包含**；每批前后都静默 |
| send（两种截断和 after10） | Python `time.monotonic()`，紧邻 Playwright fill 输入框前 | Enter 后匹配 `/api/chats/save` POST，读取完整 response body 后取时钟 | **不包含** |

`labIdle()` 先等两次 requestAnimationFrame，再要求至少 500 ms 无新长任务；每 50 ms 检查，新长任务使静默期延后。因此不是把固定 500 从 open 减掉。immediate 的 quiet 来自 open 末尾；0 个 older 批次不引入额外静默。history10 每批都在计时外静默，最后一批后也一样。open 后、older 阶段后和发送后均保留当前工具的 CDP 强制 GC/内存与 DOM 快照；这些在相应计时窗外。发送之前没有另加静默；发送时包含填入 `/send Synthetic measurement message **hello**`、真实 Enter/命令处理、渲染、保存序列化和本机 HTTP 保存响应，不生成模型回复。响应成功、保存 payload 长度/内容与新消息 DOM 的断言在计时外。

older 采用当前 `--sliced-older` 工具，两侧都禁用 CSS overflow-anchor、从顶部加载，不执行滚动 sweep。最长任务为与该批计时窗口重叠的 PerformanceObserver longtask 的完整 duration（不裁剪边界），静默等待在窗外负责交付观察记录。它不等于端到端批次耗时，低于 50 ms 的任务不进入 longtask。

统计直接调用 `scripts/benchmark-statistics.mjs`：算术中位数（偶数 n 取中间两项均值）、nearest-rank p95、2000 次配对索引重采样，seed=`opus-round1.5`。每次重采样计算 `median(head)-median(base)`，取 2.5%/97.5% 分位。仅 CI 排除 0 标为显著；没有计算比值 CI，也不把百分比变化单独用作显著性判断。n=10 时 p95 是最大观测值，尾部估计有限。

## P3 为什么不应单独改变 open

`c612e02^..c612e02` 的产品 diff 只改 `showMoreMessages()` 的离线准备/插入和相关变更屏障；初始打开的 `printMessages()` → `redisplayChat()` 没有调用 `prepareOlderMessageFragment()`。新页面首次 open 时 `olderMessagesInsertion` 为 null，`clearChat()` / `redisplayChat()` 新增的等待条件不触发。P3 不会在此路径进行分片或减少初始渲染工作；M2 的取消检查也只在 older 准备发生时执行。

所以旧 P3 A/B 的 1202→839 ms 不能归因为 P3 分片加快 open。相同 `dfab84b` 在 P2/P3 时段的 821/1202 差异提示环境/时序漂移，但现存证据不足以确认具体原因。旧 older 表格还有含/不含静默的口径差异，也不能跨步比较。本次 A/B 是 37a4818 与所有已保留改动的总效果，即使 open 显著也不能拆分归因给 P3。

## 本次结果（已完成）

- acceptance: **met**
- base public: `37a48181fc55`
- head: `b2122a4d81de`（测量启动时；其后仅有 harness redact 修复 01cdd47，不影响产品 A/B）
- 计划对数: 10；UTC 2026-10-29T02:15:58Z → 2026-10-29T02:51:08Z（用户时区 Asia/Shanghai = UTC+8：10:15:58 → 10:51:08）

| 指标 | base 中位/p95 ms | head 中位/p95 ms | Δ中位 | 95% CI | 显著（CI 不含 0） |
|---|---:|---:|---:|---|---|
| 2000/100 open | 925.4 / 1184.8 | 1034.9 / 1148.5 | 109.6 | [-111.0, 207.3] | 未证明 |
| 2000/100 send | 663.6 / 895.7 | 660.6 / 762.8 | -3.0 | [-142.3, 232.2] | 未证明 |
| 2000/100 send after10 | 2198.8 / 2650.5 | 881.6 / 2281.8 | -1317.2 | [-1597.2, -519.4] | 是 |
| 2000/100 older1 | 449.0 / 496.4 | 263.2 / 414.4 | -185.9 | [-260.8, -46.5] | 是 |
| 2000/100 older1 longest task | 449.5 / 497.0 | 115.0 / 198.0 | -334.5 | [-375.0, -230.0] | 是 |
| 2000/100 older2 | 318.5 / 553.3 | 226.8 / 350.4 | -91.7 | [-302.9, 36.4] | 未证明 |
| 2000/100 older2 longest task | 319.0 / 554.0 | 92.5 / 172.0 | -226.5 | [-395.0, -147.0] | 是 |
| 2000/100 older3 | 517.6 / 588.9 | 216.3 / 407.5 | -301.3 | [-381.0, -197.0] | 是 |
| 2000/100 older3 longest task | 519.5 / 591.0 | 100.0 / 216.0 | -419.5 | [-467.5, -321.0] | 是 |
| 2000/0 open | 5833.7 / 6411.9 | 5720.8 / 6979.2 | -112.9 | [-716.8, 905.4] | 未证明 |
| 2000/0 send | 3583.9 / 3974.6 | 1767.5 / 3277.6 | -1816.3 | [-2319.9, -594.2] | 是 |

**显著改善（可写入总览）：**
- 2000/100 加载更早消息：older1 449→263；older3 518→216；各批最长任务大幅下降（449→115、319→92.5、520→100）。
- 2000/100 加载 10 批后再发送：2199→882 ms。
- 2000/0 发送：3584→1768 ms。

**未证明：** 2000/100 打开、2000/100 立即发送、2000/100 older2 批总耗时、2000/0 打开。

原始数据与 comparison.json 在 [session/](session/)。`tests/longchat-final-ab.py` 可复现。
