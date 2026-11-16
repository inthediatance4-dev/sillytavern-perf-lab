# 好感度交叉审查修复

基准：`feature/hidden-affinity @ ac7e427`。验证源码：`dafc05e0d0c40d213d687232115528d14fdb59c1`。
日期：2026-11-07。只追加提交与普通推送；没有合并或部署，没有改动上游 `Generate` 或第三方扩展。

## 审查项与最终行为

| 项 | 修正 |
| --- | --- |
| GLM 1：outcome 确认与 attitude 重复评分 | 同一 owner 的 `outcome.acknowledgement` 与 `attitude.source` 使用同一原文资源。相同／重叠确认只贡献一次，不能单独满足弱倾向的双证据门槛。 |
| GLM 2：重述承诺重复奖励 | outcome 共用同一结果也属于同组，即使后来确认原话不同。所有合法承诺仍能关闭；结果、确认及 attitude 别名通过连通资源组去重，不能从另一条别名绕过。 |
| GLM 3：取到最旧四十项 | 按实际来源／结果的消息位置、区间及宿主 ID 排序，保留必要承诺与最近四十项非承诺记忆，携带此前使用的确认引文。 |
| GLM 4：一条坏记录丢整批 | 顶层 JSON、大小与条数限制仍严格；单条不合法只跳过该条，不猜测／修补字段。页面内固定类别计数可脱敏查询，不写入聊天、不输出正文或模型响应，取消不算失败。 |
| GLM 5：普通文本被剥离 | 仅匹配完整、严格定界的 frame。未知完整 frame 仍清除；普通 marker 字面及不完整的普通文本保留。 |
| GLM 6：system 角色位置 | 保留原 narrator/system 消息位置；文档明确文案“资料不是指令”不能改变实际消息优先级，不宣称已实现权限隔离。 |
| 先前独立审查：中性记录补分缩短去重范围 | 补分保留首次接受的规范来源范围；应用、重载迁移一致，不允许尾段再评分。 |
| 先前独立审查：回车／继续生成保存间隙 | 每条实际请求保留自己的完成归属；已完成首条回复等待保存时，后续 Enter 或 Continue 不使它失效。当前回复／swipe、scope、owner、原文前缀、启停代次与加载代次仍核对。 |
| 先前独立审查：动态预算 | 分批后及每批发送前复查预算；tokenizer 异步等待前后核对模型／提供方／tokenizer／上下文配置身份。配置改变的旧任务不得核验或落账，过大的候选保持未核验。 |

评分归属依最早保留宿主 ID 确定；未核验重大证据不能经别名降为轻微奖励。去重不永久改写原始评分资格，依赖撤回后可以重建投影。不重叠、非同一兑现的独立证据仍可分别计分，离场存储与返回恢复语义保留。

继续生成另覆盖原生的短暂同步窗口：`onProgressStreaming` 写入正文后会等待推理处理，之后才同步 swipe。首条成功完成若正好发生在此窗口，控制器最多保留 128 条已确认来源；只在正文／swipe 和全部归属再次匹配后补记一次。原生 Stop 先 ENDED、再 STOP、最后同步与 MESSAGE_RECEIVED 的次序也有回归。停止或失败的首条生成、普通历史、编辑、换分支、角色／标记变化及关闭功能不会获得新凭据。

## 验证

Node `v24.22.1`。好感度专项 **253/253**，失败 0、取消 0、跳过 0：状态 95、生命周期 120、预算 18、提供方隔离 20。定向 ESLint 与 `git diff --check` 通过。

```text
node --test tests/director-affinity-state.test.mjs tests/director-affinity-lifecycle.test.mjs tests/director-affinity-budget.test.mjs tests/director-affinity-provider.test.mjs
npx eslint public/scripts/extensions/director/affinity-state.js public/scripts/extensions/director/affinity.js public/scripts/extensions/director/affinity-prompt-budget.js public/scripts/extensions/director/index.js tests/director-affinity-state.test.mjs tests/director-affinity-lifecycle.test.mjs tests/director-affinity-budget.test.mjs
```

[专项日志](evidence/affinity-unit-final.log)、[lint 日志](evidence/eslint-final.log)。新增核心行为先以 red 回归重现再修复，原始 red 与最终 green 日志保留在 `evidence/`；冻结基准的浏览器反例另见下文。

浏览器使用真实 Chrome、原生 UI／生成／保存，以及合成 provider；未替换产品生成函数。完整 profile **17 项通过、88 次生成请求**，第三方共存 profile **16 项通过、80 次生成请求**，两者 page errors 均为 0。88／80 是合成 provider 记录的请求总数，包含各 2 条取消／停止用例的生成请求 `ERR_ABORTED`，不代表成功次数；另有 84／77 条 `/api/ping` 中断，详见 JSON。最终源码哈希和请求明细分别保存在：

- [完整好感度验收](evidence/affinity-accepted-browser.json)：全部十一项选择器，含回车与鼠标对照、真实 Continue 与磁盘重读。
- [第三方扩展共存](evidence/affinity-accepted-third-party.json)：启用 JS-Slash-Runner、st-memory-enhancement，运行十项兼容选择器。沿用已明确的边界，仅不运行主请求的 tiny-context `budget` 项；完整隔离 profile 保留该项，旁路 `sidecarBudget` 在两个 profile 都运行。
- [源码验证绑定](validation-binding.json)及[SHA-256 清单](validated-source-sha256.json)：逐文件核对最终源码、实际执行的 helper、runner 与合成 provider。

```text
python -u tests/browser-director-lab.py --affinity-only --node <node-v24.22.1> --output .evidence/affinity-cross-review/affinity-accepted-browser.json
python -u tests/browser-director-lab.py --affinity-only --enable-third-party --affinity-cases cadence,persistence,overlap,reloadRace,majorAndMobile,sidecarBudget,cancellation,saveGap,saveGapContinue,group --node <node-v24.22.1> --output .evidence/affinity-cross-review/affinity-accepted-third-party.json
```

冻结基准 `ac7e427` 的浏览器反例也保留：

- [回车反例](evidence/browser-red.json)：两条成功完整回复，`issued=1`、凭据 `[0,1]`；鼠标互斥对照通过。
- [继续生成反例](evidence/browser-continue-red.json)：normal 与 continue 均收到完整文本并成功完成，`issued=0`、唯一凭据 0；修复后的同一逻辑消息必须为 1，完整拼接文本持久化不变。

独立审查执行了原样提取的原生 progress、Stop、收尾方法，合成 I/O／DOM 复现两种推理等待竞态。发现的额外共享结果与时序问题均补了回归，最后复核未发现进一步已证实阻断。该结论不等于证明没有未知缺陷。

## 范围与交付

本轮本地只运行相关专项和上述浏览器 profile，没有重跑全仓测试，也不把之前全仓结果当作当前通过。推送触发的 CI 由仓库既有六项 Node／操作系统矩阵自动运行，实际交付 run 在最终交付消息中核对。

浏览器结果中的请求中断另行保留在 `failedRequests`；`generationRequests` 为请求总数，不是成功次数，page errors 与具体记录以 JSON 为准。所有聊天与模型输出均为合成夹具；没有调用真实模型、读取真实聊天或密钥，没有手机实机结果。系统角色注入的设计风险仍保留。

修复提交：

- `e38a76c`：独立评分证据分组、规范范围与逐条解析。
- `5237679`：动态预算、发送前复核与在途模型身份保护。
- `dafc05e`：原生流式／继续生成／停止凭据、最近记忆、文本保护、脱敏诊断与浏览器回归。

本报告和证据由后续独立文档提交交付。提交材料不包含真实主机名、本机绝对路径或密钥。
