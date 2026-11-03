# 命运牌 FC1–FC4 复审材料

**FC1–FC3、S1–S6 及三组本地验证已完成；命运牌保持未合入，等待复审。** 产品源码为 `e88cf00`，完整产品与测试交付基准为 `4785259`。本报告及其证据提交只补文档；所有正式浏览器报告记录的源文件和测试入口哈希均与 `4785259` 完全相同。源码及测试基准的实际远端 CI 已为 6/6 通过，见文末 run 和逐 job 记录。

## 基线与合入顺序

用户已确认 director-followups 的 G1–G6 通过，并批准先合入。`01eff6a` 通过 `--no-ff` 合入 `codex-improvements`，合并提交为 `19d06f3`，其树与 `01eff6a` 一致，已普通推送。此前的“持久化修复”是在 Generate 中跳过已经标记 `extra.director` 的首条消息，删除延后恢复快照的逻辑，使生成期间的真实保存不会把展开结果写回首条 Director 消息。

- [followups 最终报告及 G1–G6 证据](https://github.com/inthediatance4-dev/sillytavern-perf-lab/blob/01eff6a/docs/reviews/2026-10-31-director-first-message-fix/README.md)
- [followups 交付提交的实际 CI：6/6](https://github.com/inthediatance4-dev/sillytavern-perf-lab/actions/runs/41194155826)
- [合并提交 `19d06f3` 的实际 CI：6/6](https://github.com/inthediatance4-dev/sillytavern-perf-lab/actions/runs/41217529543)

命运牌分支通过追加合并提交 `9dd3f66` 同步这条新基线，没有改写已有提交。**命运牌仍未合入 `codex-improvements`；等待本次复审批准后才允许合入。** 本轮追加提交与最终交付身份如下。

| 提交 | 内容 |
| --- | --- |
| `643c3f9` | FC3：群聊 STARTED 后归属变化的提前返回释放发送状态 |
| `d74100f` | FC1：组装阶段计入完整事件、400 码点上限及字面文本保护 |
| `153413d` | S5/S6：两版 README 说明牌名提示类别、采用会消耗待生效普通指令 |
| `95dae09` | FC2：每次请求独立的临时提示消息及世界书扫描过滤 |
| `e88cf00` | S1–S4：JSON 提取、附件保护、减少重复保存与并发元数据回滚 |
| `4785259` | FC1–FC3 浏览器回归、同步状态轮询及可选外部资源代理 |

审查入口：[原实现到当前修复的已提交差异](https://github.com/inthediatance4-dev/sillytavern-perf-lab/compare/7a21eeb...4785259)。最终交付只追加本目录的证据和文档；没有改写任何已有提交。

## FC1：完整事件进入上下文预算

`prepare()` 在组装阶段加入完整英文说明和事件正文，并附加请求身份边框；不再用很短的占位符预留预算。宏分隔符、旧式尖括号宏及 CR/LF 用单字符私有标记保护，`GENERATE_AFTER_DATA` 再把整段已识别的边框替换为原始字面文本。保护 CR/LF 是为了避免文本补全组装先压缩换行、预算结束后恢复时增长。未知或失效边框会被整段移除，不向模型发送内部标记或其中的事件正文。

新事件最多 400 个 Unicode 码点，quiet 提示写明此限制，回复预留改为 1024 token；结构不完整或超限仍按抽牌失败处理，保留原牌。早期实验版本超过上限的卡片需要重新抽取，两版 README 已说明。单元测试检查 400/401 边界、组装值长度、输出预留、换行以及 `{{char}}`、`{{random}}`、`<uSeR>` 的字面保留。

新增浏览器 FC1 用相同的饱和历史与 `gpt-4o` tokenizer，固定上下文 2048、回复 256，对比无牌与采用约 400 码点事件的实际请求。断言完整请求不超过 1792 token、事件恰好出现一次、宏保持字面，且历史多裁掉的 token 足以覆盖事件扣除基线余量后的增量。结果同时保留上下文、回复长度、模型、完整消息 token、历史消息 token 与保留/移除的历史 ID，避免只凭字符数推断预算正确。

实测：无牌请求为 1733 token、保留 26 条历史；采用后为 1711 token、保留 20 条历史，多移除 390 token 历史，事件正文增量为 350 token，基线余量 59 token。修复前同一新用例测得 2101 token，超过 1792；事件仍未促使历史额外裁剪。

计数口径：完整 `messages` 批量发送给仓库 `/api/tokenizers/openai/count`，回复 padding 计一次；浏览器 `countTokensOpenAIAsync(messages, true)` 会逐条调用、每条计 padding，因而会多出 `3 × (消息数−1)`。报告同时保留两种计数，1792 的断言使用完整请求批量计数。

## FC2：并发 quiet 的请求归属

采用请求使用 interceptor 收到的 `coreChat` 临时副本，追加 `is_system`、`type: narrator` 的专用消息，`extra.directorFatePrompt` 标明其用途。它参与该请求原生预算，但不写持久聊天，也不写共享 Fate extension prompt。因此另一条 quiet 或 impersonate 生成不会继承事件，也不可能删除普通请求自己的临时消息。

用户明确批准了 Generate 中这处最小额外改动：世界书扫描前使用 `coreChat.filter(message => !message.extra?.directorFatePrompt).map(...)`，保持命运牌不参与世界书扫描的原语义。第三方扩展代码没有修改。quiet/impersonate 的 STARTED 不再清除普通请求的记录；完成仍须同时匹配实际 `data` 对象、类型、聊天、元数据、目标位置和前置指纹，才能消耗牌。

新增浏览器 FC2 在 `CHAT_COMPLETION_PROMPT_READY` 暂停真实采用请求：interceptor 已执行，`GENERATE_AFTER_DATA` 尚未触发。连续完成两次真实 quiet 请求后才放行普通请求。通过标准是三次请求中事件出现次数为 `[0,0,1]`，quiet 均先完成、普通回复成功后 held 被消耗，所有模型请求都不含 `directorfate`。实测事件出现次数为 `[0,0,1]`，内部标记次数为 `[0,0,0]`，普通成功后 held 清空。修复前事件出现次数为 `[0,0,0]`，最后请求泄出一个短占位符，held 未消耗。

这不声称全局 STOPPED 事件已经具备每条并发请求的独立停止身份。

## FC3：归属变化后可以继续发送

`regenerateGroup` 在 GROUP_REGENERATION_STARTED 的异步监听结束后，如果群组、聊天或元数据已变，提前返回前调用 `setSendButtonState(false)`。单元用例使用实际函数和可变绑定，分别覆盖三种归属变化；断言不删除消息、不启动群组生成、发出 FINISHED，并可再次生成。

新增浏览器用真实双角色群聊确认参与者身份，初次采用事件出现次数须为 `[1,0]`。随后在 STARTED 监听中分别执行真实聊天切换、元数据替换，检查提前退出无模型请求、发送状态已释放，再通过发送按钮提交唯一用户消息，等待唯一合成回复和真实 COMPLETED 事件。后一次正常发送必须由实际目标角色完成，不能用历史里相同回复或一次空闲采样代替成功证明。两种场景均通过：归属中断后零模型请求且 `is_send_press === false`；切换后的单人发送完成 1 次新请求，元数据替换后的群聊发送完成 2 次新请求，角色身份正确。修复前两种归属中断后 `is_send_press` 均保持 true。

## S1–S7

| 项 | 处理与验证 |
| --- | --- |
| S1 | 提取首个完整 JSON 对象，处理字符串里的括号、转义引号和反斜杠；仍严格校验唯一 `event` 字段。首个对象无效时不转选后续对象，错误不回显模型原文。 |
| S2 | 面板和控制器共用 `hasDraft`，同时检查 `hasPendingFileAttachment()`。浏览器补测待发送附件：点击采用后附件与持牌保留、聊天和模型请求均不增加。实测通过，附件未发送、未清空，持牌保留。 |
| S3 | 成功重放后绑定的全部字段均相同则跳过 Fate 的重复保存；群聊 `generationId` 等字段变化仍保存。 |
| S4 | 保存失败只回滚当前操作拥有的 `fate` 字段，保留期间并发写入的 `boundInstruct`。 |
| S5 | 两版 README 明确“牌名会提示大致类别”。 |
| S6 | 两版 README 明确采用命运牌会在同次请求中带上并按原规则消耗待生效普通导演指令，单独抽牌不会消耗它。 |
| S7 | 390px 普通导演指令 chip 溢出独立登记 [issue #2](https://github.com/inthediatance4-dev/sillytavern-perf-lab/issues/2)，未把命运牌面板通过写成整页移动端通过。 |

## 验证与证据

只运行相关 Director 测试和定向 lint。本地浏览器使用已有 Node v24.22.1、Chrome 和 Python Playwright；所有模型请求均为仓库合成 OpenAI 夹具，不调用付费模型。命令中的 `$labNode` 指已有的该版本 Node 可执行文件，通过 `LAB_BROWSER_EXECUTABLE` 选择浏览器。

| 命令 | 当前结果 | 归档证据 |
| --- | --- | --- |
| `& $labNode --test tests/director-*.test.mjs` | 104/104 通过；失败、取消、跳过均为 0 | [director-unit.txt](evidence/director-unit.txt) |
| `& $labNode node_modules/eslint/bin/eslint.js public/script.js public/scripts/group-chats.js public/scripts/events.js public/scripts/extensions/director/*.js tests/director-*.test.mjs` | exit 0 | [director-lint.txt](evidence/director-lint.txt) |
| `python -u tests/browser-director-lab.py --node $labNode --output .evidence/fate-review/director-full.json` | 53 项通过 / 63 次请求 / 页面异常 0 | [director-full.results.json](evidence/director-full.results.json) |
| `python -u tests/browser-director-lab.py --node $labNode --fate-only --enable-third-party --output .evidence/fate-review/fate-third-party-proxy.json` | 10 项通过 / 23 次请求 / 页面异常 0 | [fate-third-party.results.json](evidence/fate-third-party.results.json) |
| `python -u tests/browser-director-lab.py --node $labNode --fate-review-only --output .evidence/fate-review/browser-review.json` | 5 项通过 / 13 次请求 / 页面异常 0 | [fate-review.results.json](evidence/fate-review.results.json) |

默认完整导演套件及 FC1/FC2/FC3 专项的隔离清单为 `["third-party/JS-Slash-Runner", "third-party/st-memory-enhancement"]`；命运牌专项 `--enable-third-party` 的清单实际为 `[]`，两个扩展入口均收到成功响应，`TavernHelper` 实际可用。定时 ping 中止和刻意触发的停止请求保留在报告中，没有忽略 JavaScript 页面异常。

小上下文探索中，第三方记忆扩展开启时，无命运牌的基线请求已因原生预算之后的额外注入超过 1792。这一诊断没有用来放宽 FC1 断言，也没有修改或禁用该扩展来冒充“扩展开启通过”。FC1 的原生预算对照使用隔离夹具；第三方共存通过单独启用扩展的命运牌专项检查，两种范围明确分开。

## 失败记录、网络诊断与最终身份

修复前单元失败和同一份新浏览器用例在原实现 `7a21eeb` 上的失败均归档至 [evidence/red/](evidence/red/)。修复前浏览器报告的 runner 取自本轮修正后的夹具，三项均失败；没有把一次旧用例通过冒充回归有效性。

浏览器夹具曾使用 `wait_for_function(async ...)`。独立复现表明，返回 false 的异步谓词会在 9ms 内被 Promise 的真值提前通过；同步 false 谓词则在 300ms 正常超时。已改为先 await 导入模块，再同步轮询实时命名空间，保留原有发送完成、空闲和角色断言。[最小复现](evidence/diagnostics/async-wait-minimal.json)及[旧等待导致的失败报告](evidence/diagnostics/async-wait-failure.results.json)保留。诊断 Date 对象也改成 ISO 字符串，避免写报告时丢失原始失败。

第三方专项第一次完成全部 10 项功能检查，但外部 Vue、更新清单下载发生 CONNECTION_RESET，两个 `Failed to fetch` 页面异常使整组判失败。[该次失败](evidence/diagnostics/external-network-failure.results.json)没有计作通过。最终专项通过可选 `LAB_BROWSER_PROXY` 显式使用机器已配置的代理，loopback 仍直连；Vue 和两个扩展入口真实下载成功，外部请求失败为 0，页面异常为 0。没有提供假 Vue、拦截更新响应、忽略异常或改第三方源码。代理配置本身不写入仓库。默认完整套件及新专项没有设置代理，该可选参数的默认路径未变。

[validated-source-sha256.json](validated-source-sha256.json)列出 274 个已提交文件的 SHA-256，包括全部被跟踪的第三方扩展文件。每项已同时核对磁盘字节与 `git show 4785259:<path>`；三组通过报告中的产品、runner、新用例哈希均逐项匹配。`git diff 7a21eeb..4785259 -- public/scripts/extensions/third-party` 为空。完整套件和新专项运行后，测试公共启动助手只新增了可选代理分支；最后的第三方专项实际执行该分支，没有重复运行已通过的完整套件。

相对 `4785259` 的后续改动仅为 `docs/`，完整列表见 [delivery-files.txt](delivery-files.txt)。

交付范围中的文本已检查主机名、本机绝对路径和尾部空白；隐私检查与 `git diff --check` 均通过。没有删除文件，也没有强推。

源码/测试提交 `4785259` 的实际 CI：**6/6 通过**（Ubuntu/Windows × Node 20/22/24），[逐 job 记录](evidence/ci-source.results.json)，run 为 [41652833120](https://github.com/inthediatance4-dev/sillytavern-perf-lab/actions/runs/41652833120)。最终纯文档交付 HEAD 的实际 CI 链接在交付消息中单独给出，以免把源码基准和文档提交身份混淆。全仓矩阵只由要求的远端 CI 执行，本地没有跑全量。
