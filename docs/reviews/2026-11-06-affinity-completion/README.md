# 隐藏关系记忆：本机补完与复核

本轮以 `a72f9e7` 为原始交付、`698119e` 为合入前父基线，修复了实际复现的计分、知识边界、请求归属和持久化漏洞。产品源码基准为 `7b6379f`，浏览器测试基准为 `ffba8ed`。产品没有在最终验收过程中继续变化；报告中的产品及实际执行测试入口哈希均与这两份提交核对。

**结果：好感度专项 160/160、相关检查 427/427、完整回归 1226 通过／0 失败／20 跳过；四组浏览器均通过且页面异常为 0。** 这证明已覆盖的机械边界，不代表真实模型能完美判断关系语义。分支仍未合入或部署，供复审。

## 修复与提交

| 提交 | 最终行为 |
| --- | --- |
| `1ea4504` | 修复 native Windows 测试的 cmd 参数引号；真实 DOS 短路径用例通过，没有改成跳过。 |
| `30761bc` | 重叠引文按物理来源区间去重，迁移旧别名；规范承诺与结果固定因果边界；未知知识不注入；角色自己履约会关闭约定但不加分。 |
| `dfaa7be` | 按当前 tokenizer 裁剪侧路输入，输出额度独立且有上限；CC/TC 设置事件隔离，不消耗其他请求的长度恢复钩子；取消不留下 tokenizer 的未处理拒绝。 |
| `7b6379f` | 完整记忆参与原生预算并进入请求副本；quiet 不破坏普通生成；角色离场取消旧工作；核验提供实际引文并分组；排队保存与待存凭据保护即时聊天重载。 |
| `ffba8ed` | 真实浏览器验收、第三方共存选择、原有套件的明确隔离及 Fate 重载就绪检查。 |

[原始交付到测试基准的完整差异](https://github.com/inthediatance4-dev/sillytavern-perf-lab/compare/a72f9e7...ffba8ed)。旧的 [首版验证报告](../2026-11-06-affinity/README.md)保留为历史记录，没有把当时 15 个失败改写成通过。

## 逻辑修正

**证据与知识。** 同一消息中的一句态度，仅把引文扩大或缩小，原版可从一次 +2 变成 +6；承诺也可生成别名锚点。现按 owner、逻辑消息、swipe、fingerprint 和重叠区间统一身份，保留最早宿主 ID，重绑有效依赖，不重叠证据仍独立。因果验证固定到首次接受的完整承诺／结果范围：缩窄别名不能把原句内部内容变成后来的结果或确认；扩大别名也不会误拒真正后续证据。已完成的角色自有承诺不再永远占用未决容量，但评分仍为零。未知事实可留账本，只有角色明确知情的证据进入它的提示。

**请求与预算。** 原版在共享提示里放短 `AFFINITY_LITERAL` 占位符，再于预算结束后展开完整记忆；外部 quiet 会清掉普通请求的 frame 和 attempt。现在临时 narrator 消息只加入 interceptor 的请求副本，携带完整的宏／换行保护文本，并从 WI 扫描排除。Generate 在 `GENERATE_AFTER_DATA` 额外提供 `{type}`，使没有记忆内容的请求也能核对真实类型，既有两参数监听保持兼容。未知 frame 整段移除；quiet/impersonate 不取得记忆、不消耗普通成功计数。

后台输入用当前 API 的实际 raw 格式和 tokenizer 计数，预留输出、schema 与格式空间。用户已明确选择独立输出额度：模型上下文四分之一、最多 2048 token、最少 128，不修改正文设置。过长时裁剪的是请求视图，不删除持久证据；完全省略的旧上下文不标为 evaluated。重大核验保留实际 source/result/ack 引文与归档锚点，必要时顺序分组；单项无法容纳或核验失败时保持零分，不降级为 minor。后台最多一条模型请求在途，新正文可取消它而不等待它。

**持久化。** 浏览器真实复现过：完成后立即原生重载，clear 与 GET 之间的空聊天窗口会被后台保存成仅含 header 的请求。只禁止空保存仍不够，第五条已完成回复会在重载后退回第四条计数。现在排队任务绑定原归属和首消息身份，空窗不授权保存；最多 128 条尚未确认落盘的成功凭据仅在同聊天、scope、角色、索引、原文、swipe 和逻辑标记一致时补回。编辑／删除／换分支会撤销冲突缓存；较新的完成不被旧保存水位清掉，已加载的 evaluated 不回滚，关闭后重载再启用也只整理一次。正文事件不等待模型或后台保存 promise。

## 本机测试

使用已有 Node v24.22.1、Chrome 156.0.8078.76 和 Python Playwright。依赖锁文件与原本机依赖一致，没有重装依赖。`$labNode` 表示该 Node 可执行文件，浏览器通过 `LAB_BROWSER_EXECUTABLE` 选择。需要真实外部扩展资源时，用 `LAB_BROWSER_PROXY` 读取机器已有代理，loopback 保持直连；代理地址和本机路径没有写入提交。

| 实际命令 | 结果 | 证据 |
| --- | --- | --- |
| `& $labNode --test tests/director-affinity-state.test.mjs tests/director-affinity-lifecycle.test.mjs tests/director-affinity-provider.test.mjs tests/director-affinity-budget.test.mjs` | 160 通过；失败、取消、跳过均为 0 | [affinity-unit.txt](evidence/affinity-unit.txt) |
| `& $labNode --test --test-reporter=spec tests/director-*.test.mjs tests/reasoning-visibility.test.mjs` | 427 通过；失败、取消、跳过均为 0 | [related-unit.txt](evidence/related-unit.txt) |
| `npm run test:perf`，PATH 选择 Node 24.22.1 | 1246 总项：1226 通过、0 失败、0 取消、20 跳过 | [full-regression.txt](evidence/full-regression.txt) |
| 定向 ESLint `--max-warnings=0` 与 Python `py_compile` | exit 0 | [checks.json](evidence/checks.json) |

20 个跳过为现有条件：本机无符号链接创建权限、Linux `/proc`／POSIX 专用检查及 Windows 不提供的优雅 SIGTERM 行为，均单列于 [skipped.json](evidence/skipped.json)，没有算入通过。原版在本机完整回归的唯一失败是 cmd 引号问题；修复后真实 native Windows 文件五项均通过。开发机报告的 15 项失败没有以同一组在本机重现，不能仅凭环境推测消红。

## 真实浏览器与合成 provider

所有模型请求只访问隔离实验室的合成 OpenAI provider，未读真实密钥、未调用付费模型、未使用真实聊天。没有替换产品函数、手工发成功事件或伪造 receipt 来完成计数验收。故意失败的生成通过真实公开 API 捕获预期拒绝并断言，成功发送仍通过真实按钮；全局 pageerror 未过滤。

| 实际命令（共同前缀 `python -u tests/browser-director-lab.py --node $labNode`） | 结果 | 报告 |
| --- | --- | --- |
| `--affinity-only --output .evidence/affinity-review/browser-final.json` | 9 组、14 项、82 次合成请求；页面异常 0 | [affinity-browser.results.json](evidence/affinity-browser.results.json) |
| `--affinity-only --enable-third-party --affinity-cases cadence,persistence,overlap,reloadRace,majorAndMobile,sidecarBudget,cancellation,group --output .evidence/affinity-review/browser-third-party.json` | 明确选择 8 组、13 项、74 次请求；页面异常 0 | [affinity-third-party.results.json](evidence/affinity-third-party.results.json) |
| `--base 698119e --output .evidence/affinity-review/director-full.json` | 53 项、63 次请求；页面异常 0 | [director-browser.results.json](evidence/director-browser.results.json) |
| `--base 698119e --fate-only --enable-third-party --output .evidence/affinity-review/fate-third-party-final.json` | 57 项、35 次请求；页面异常 0 | [fate-third-party.results.json](evidence/fate-third-party.results.json) |

关键实测：

- 默认开启、10 条边界：第九条不整理，第十条仅一次；改为 5 条及 swipe/regenerate/continue、落盘、真实编辑撤回均验证。
- 并发 quiet：普通请求暂停于 CHAT_COMPLETION_PROMPT_READY，quiet 完成后再继续。事件出现次数 `[0,1]`，内部标记 `[0,0]`，普通成功计数从 5 到 6。原版为 `[0,0]`、`[0,1]`，漏计。
- 主提示上下文 2048／回复 256：完整记忆请求 1663 token，不超过 1792，历史由 22 条减至 11 条；原版为 2355 token，仍保留 22 条。
- 侧路上下文 4096、正文设置 64：后台输入 2640、输出预留 1024，正文设置与下一次正文请求仍为 64；原始用户资料 5285 字符、本次展示 1445。第三方开启时对应输入 2641，仍在 3072 的输入预算内。
- 原生 GET 暂停于 clear 之后：无空保存请求；第五条成功凭据在放行和再次重载后仍保留。单位测试另覆盖已保存 evaluated、水位较新完成、关闭／重载／再开启与冲突分支。
- 真实同名双头像群聊：六条回复的规范 avatar 为 A/B/A/B/A/B，整批完成后仅一次整理；移除 B 时原证据冻结，重新加入恢复同一 ID。
- major 实际有第二次独立请求，通过后 +5；后台中断、正文 500／停止及重试均不误计。
- 390×844 下设置控件最右侧 383.95px、无横向溢出，开关与频率可保存，未显示分数控件。[截图](evidence/affinity-mobile.png)是浏览器仿真，不是手机实机。

隔离范围：完整好感度及原导演组禁用 `third-party/JS-Slash-Runner`、`third-party/st-memory-enhancement`；第三方组实际加载两个入口，`TavernHelper` 可用。原导演/Fate 回归明确关闭新 affinity，防止新增评估自然改变旧请求计数，原精确断言保留。好感度专项保持真实默认开启。

第三方好感度共存组没有运行 `budget`（主提示 2048 小上下文）这一项；该严格项由隔离的完整九组承担。沿用既有第三方预算后注入的边界，不把共存 8 组声称为带第三方的小上下文硬限制已验证。侧路自身输入输出预算、并发、重载、取消和群聊都在第三方开启时实际运行。静态禁用态比较使用真实父基线 `698119e`，保留完整 DOM 相等；旧 `ffd5f4e` 不包含后来的 reasoning 改动，不能用于本分支归因。

## 失败保留、身份与 CI

[red/](evidence/red/)保留原始版本四项浏览器失败、计分／因果／知识边界失败、quiet／核验／归属失败、两轮凭据修复反例，以及输出限制、设置钩子、取消拒绝和 Windows 反例。没有删除保护测试或将失败改写为成功。

[diagnostics/](evidence/diagnostics/)另保留两类夹具失败：故意 500／停止经 DOM 入口产生未消费 Promise，修为真实 generate API 显式捕获并断言；Fate reload 仅等扩展按钮可见就选择尚未加载的角色，修为等待实际角色与空闲并用原生带 chatFile 的受保护选择。未对 pageerror 或正文结果作忽略。早期错误观察器的 `oldIssued=0` 不用作证据；最终重载记录采实时上下文。

[validated-source-sha256.json](validated-source-sha256.json)绑定最终产品及测试字节；[validation-binding.json](validation-binding.json)逐份核对产品、通用 runner 和该模式实际执行 helper。原始报告启动 HEAD 可早于随后追加的提交，但被执行产品字节相同。Fate 就绪夹具修复发生在其他组通过之后，它不由其他模式执行；没有为一个未执行的 helper 重跑已通过的组。归档仅作隐私替换与文本换行整理，报告中的启动 HEAD 和 hash 字段保留原值，不冒充最终提交。

源码 `7b6379f` 的实际 CI：**6/6 通过**（Ubuntu/Windows × Node 20/22/24），[run 42235693957](https://github.com/inthediatance4-dev/sillytavern-perf-lab/actions/runs/42235693957)，[逐 job 记录](evidence/ci-source.results.json)。最终文档交付提交的实际 CI 链接在交付消息另列，避免循环自引用；后续差异只允许 README/文档/证据，完整交付列表见 [delivery-files.txt](delivery-files.txt)。

没有自动合入或部署。真实模型的事实抽取质量、minor/major 语义判断及手机实机体验仍未验证；合成响应不能证明这些方面完美。
