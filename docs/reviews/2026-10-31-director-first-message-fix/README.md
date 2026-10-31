# Director 首条消息写盘污染修复与复审

本报告接续并取代旧 G1–G6 报告的 G2 阻塞结论。源代码与测试提交为 `9d592a6d1f7f44d1a87f12cbee57513245142de2`；之后的交付提交只增加文档和证据。各 results.json 保留真实的产品 HEAD、runner HEAD、runner SHA-256 与版本。

用户已明确批准一个最小例外：Generate 的首条消息展开判断排除 `extra.director`，并删除 Director 延后恢复逻辑。没有修改第三方扩展，没有改写提交、强推或合并。合入仍等待 Opus 最后确认。

## 修复原因与行为

旧代码先将首条 Director 消息中的字面宏展开写回内存，直到 GENERATE_AFTER_DATA 才恢复。后台 token-count dryRun 也走这段代码，因此任何中途保存都可能把临时展开写入 JSONL；稍后的保存又可能掩盖污染。旧报告的三次末态检查中确实出现了这种情况。

修复在源头避免这次写入；不再安装序列化钩子、字段访问器或保存补丁，也不需要跟踪并发生成的恢复顺序。模板自身文本仍按原规则求值，用户输入仍以字面文本保存在消息里。普通角色首条问候保留原有展开行为。手动设为章节起点的消息也按现有 messageFormatting 的 Director 规则处理，已单独覆盖。PromptManager 后续对提示词副本的宏求值与两版 README 中的说明保持一致，本次没有更改。

旧源代码的失败复现保留在 `red.results.json`。它在真实 dryRun 的 CHAT_COMPLETION_PROMPT_READY 期间调用实际 saveChat，并立即回读 JSONL，读到了展开后的文本。修复后的同一探针要求内存和即时磁盘回读都保持字面，不能靠后续保存补救。

## G1–G6 对照

| 项目 | 结果与证据 |
| --- | --- |
| G1 | [两项扩展审计](../2026-10-31-director-followups-g1-g6/extensions.md)继续有效。酒馆助手 4.9.1、记忆增强表格 2.2.14；原审计的 17 个源文件哈希逐一复核未变。 |
| G2 | 三次串行严格验收全部通过：`g2-1.results.json`、`g2-2.results.json`、`g2-3.results.json`，每轮 8 项检查。两项扩展均实际加载，禁用列表为空，三轮均实际调用 TavernHelper.setChatMessages。全部捕获的保存体成功解码并保持字面；即时 JSONL 回读、普通生成自动保存和重载均通过。 |
| G3 | 相同最终 runner 对冻结基线 `931354ffb5c9fe77bea504a4317d434f59eb98da` 与 `9d592a6` 各跑一次。两边都通过，请求数均 1 → 2，swipe 数均 1 → 2；两条 swipe 重载后均正确。[issue #1](https://github.com/inthediatance4-dev/sillytavern-perf-lab/issues/1)继续跟踪历史间歇失败，不把本次一致结果说成已查明历史原因。 |
| G4 | Node v24.22.1 上默认完整套件连续两轮全部通过：`g4-1.results.json`、`g4-2.results.json`；每轮 53/53 检查、63 次模拟生成请求、0 页面错误，无关闭告警。未使用 --review-only。 |
| F4 | `adaptive.results.json`：4 组全部通过；优化开启时 0/10/20ms 分别为 1/2/3 帧间隔，最终 HTML 与关闭优化基准完全相同，20ms 场景两次生成的首块同步显示检查均通过。 |
| G5 | 旧“只改 docs/tests”的预期已被用户批准的 G2 源码修复取代。产品改动严格限于 `public/script.js` 的一个判断与注释、`director/index.js` 删除 37 行旧恢复逻辑；其余为 tests/docs。[源码哈希](validated-source-sha256.json)与[完整文件列表](files-since-29f1e7d.txt)逐一核对。 |
| G6 | 普通 push 后核实最终交付 HEAD 的实际六个 CI job；实际 run 链接随最终交付提供，不借用之前提交的 CI。CI 成功也不能替代本地真实浏览器验收。 |

## 新增的并发行为检查

除原 F3/R2 与每次保存体检查外，浏览器直接执行真实 Generate 与保存/读取接口：

- 两个 dryRun 同时停在提示词事件中，此时保存原聊天和 structuredClone 副本。
- 放行其中一个，另一条仍暂停时再次保存。
- 通过实际 TavernHelper API 修改文本并保存，再放行剩余 dryRun；编辑不能被旧快照覆盖。
- 在 GENERATION_STARTED 中真实编辑，再继续组装提示词；编辑仍保留。
- 暂停 dryRun 后切换聊天再放行，分别读取两个聊天，确保没有跨聊天恢复或污染。
- 普通首条角色问候仍展开；手动章节标记的首条消息保持字面。
- 首条批注经过 dryRun、克隆保存与重载后仍完整保留字面宏。

完整套件使用直接写入加核心 saveChat 的编辑路径，因为该夹具禁用了两项第三方扩展；G2 三轮则必须由实际 TavernHelper API 完成，并在证据整理时再次强制核验其 editor 字段。[独立代码审阅](code-review.md)未发现产品代码阻塞。

## 精确测试命令

环境：Python Playwright、Node v24.22.1、Chrome 156.0.8078.76。`LAB_NODE` 指向已有 Node v24.22.1 可执行文件，`LAB_BROWSER_EXECUTABLE` 指向已安装浏览器。所有聊天、角色和接口均为临时合成夹具，不使用真实用户聊天或外部模型。

```powershell
# 相关 Director 单元测试：42/42；目标文件 ESLint 通过
$labNode = $env:LAB_NODE
$directorTests = rg --files tests -g 'director-*.test.mjs'
& $labNode --test $directorTests
& $labNode node_modules/eslint/bin/eslint.js public/script.js public/scripts/extensions/director/index.js

# G2：分别串行执行，三轮均启用扩展并执行直接保存探针
python tests/browser-director-lab.py --node $labNode --f3-only --enable-third-party --f3-save-probe --output .evidence/repair-stable/g2-1.json
python tests/browser-director-lab.py --node $labNode --f3-only --enable-third-party --f3-save-probe --output .evidence/repair-stable/g2-2.json
python tests/browser-director-lab.py --node $labNode --f3-only --enable-third-party --f3-save-probe --output .evidence/repair-stable/g2-3.json

# G3：baseline checkout 固定在 931354ffb5c9fe77bea504a4317d434f59eb98da
python tests/browser-director-lab.py --node $labNode --chapter-only --product-root .worktrees/g3-baseline --output .evidence/repair-stable/g3-baseline.json
python tests/browser-director-lab.py --node $labNode --chapter-only --output .evidence/repair-stable/g3-head.json

# G4：默认完整套件，无 --review-only 或独立子集参数
python tests/browser-director-lab.py --node $labNode --output .evidence/repair-stable/g4-1.json
python tests/browser-director-lab.py --node $labNode --output .evidence/repair-stable/g4-2.json

# F4：0/10/20ms，自适应间隔、最终 DOM 与首块同步显示
python tests/browser-streaming-adaptive.py --node $labNode --output .evidence/repair-stable/adaptive.json
```

G3/G4 的精确隔离清单为 `["third-party/JS-Slash-Runner", "third-party/st-memory-enhancement"]`，保存在各自报告里。G2 不隔离这两项扩展。静态禁用态 DOM 对照基线 `ffd5f4e` 与 G3 的产品基线不同。

## 证据与范围

本轮先观察到失败复现，再实现修复；早期两次绿灯探索运行用于完善并发测试，未冒充正式三连测。正式 G2/G3/G4 均使用同一份已提交 runner，后续不再改生产或测试代码。旧报告与旧失败诊断均保留，不删除或改写为成功。

浏览器报告中的定时 ping 中止与完整套件刻意触发的停止请求是实际网络事件，完整保留。没有用它们掩盖 JavaScript 页面异常或测试失败。先前由 Response.finished 引发的关闭告警已通过读取保存响应体消除，保存完成等待仍然保留。

## 旧 Node 运行时上的失败诊断

本轮在 Node v24.15.0 上先完成了 G2 三连测、G3 对照和一次完整套件；第二次完整套件中，实验室服务器以 3221226505（0xC0000409）原生退出，模拟接口子进程仍存活，浏览器生成请求报 ERR_CONNECTION_REFUSED。这次真实失败保留在 `diagnostics/node24.15-full-failure.results.json`，没有算作通过。

它与 Node 官方仓库中的 [Windows 24.15 短连接原生崩溃报告](https://github.com/nodejs/node/issues/63620)特征一致；上游报告描述无可捕获 JS 异常及无常规 WER 记录，并记录后续 24.x 的对照结果。本机未采集原生转储，因此这是相符的环境诊断，不能声称已证明同一个底层调用栈。

验收改为通过已有 `--node` 参数使用机器上已存在的 Node v24.22.1（libuv 1.52.1，模块 ABI 137），在生产代码和 runner 均保持不变的前提下重新执行整组 G2/G3/G4/F4。没有安装或替换全局 Node，没有降低断言、跳过场景或给失败加自动重试。最终 Node v24.22.1 上的 G2 三连测、G3 两边对照、G4 两连测、F4 四组均完整通过。旧运行时轮次汇总另存 `diagnostics/previous-runtime-attempts.json`，不用旧运行时上的成功轮次拼成最终两连测。
