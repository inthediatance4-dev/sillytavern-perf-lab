# Director follow-ups: R1-R6 修复与验证

源码验证点：`29f1e7dba9608a354e6bd264a13c6408786265ce`。分支仍为 `feature/director-followups`；追加提交，不改写历史，不合入 `codex-improvements`。后续证据提交不改变已验证源码，逐文件 SHA-256 见 `validated-source-sha256.json`。

## 修复

- R1：`matchesRegenerateDelete` 显式检查上游 busy 状态。有绑定的真实 regenerate 在 `GENERATION_STARTED` 调用现有公开 `setSendButtonState(true)`，与原生 regenerate 按钮的入口一致。直接扩展调用也因此在上游删除前处于生成状态；连接失败、ping 失败及拦截器中止仍由上游既有返回路径/`unblockGeneration` 复位。之后真实手删时 busy=false，立即清除绑定。没有候选绑定、延迟恢复或新持久化状态。额外验证更早的内置拦截器 abort(true) 和 stop：不发 provider 请求、绑定保留，重试请求仍带指令。未改 `Generate`。
- R1 dryRun：不清除真实生成的删除 token，不恢复被屏蔽的导演提示。仍保留已有首消息字面宏快照行为，不改上游 `Generate`。
- R2：普通生成真正发送用户消息、收到 AI 回复并等待自身自动保存后，再读保存内容并重新加载，核对第 0 条旁白和备注的原始宏。
- R3：固定回复包含中文、多段落、加粗/斜体、带 `javascript` 标记的代码块。先跑 `optimized_streaming=false` 基准，再跑 0/10/20ms 优化路径。最终 `.mes_text.innerHTML` 完全相等，不忽略任何属性；明确检查复制按钮及其键盘可达性。
- R4：20ms 场景在第一个真实 token 时包装产品 `onProgressStreaming`，等其实际返回后、交付任何 streaming rAF 之前断言首块已显示。相同页面第二次生成再次断言，并确认使用全新 processor。
- R6：中英文 README 改为实际恢复时机：ENDED、STOPPED、缺少这两个事件时下一次非 dryRun STARTED；切换聊天丢弃旧屏蔽。未找到仍需删除的旧“仅一条消息旁白可能改写”限制。

## 本机相关测试

环境：Windows，Node v24.15.0，Python Playwright，Chrome 155.0.8059.86。`LAB_BROWSER_EXECUTABLE` 在运行环境指定，未记录本机路径。

```text
python tests/browser-director-lab.py --review-only --output .evidence/review-r1-r6/director.json
python tests/browser-streaming-adaptive.py --output .evidence/review-r1-r6/adaptive.json
node --test --test-reporter=tap tests/director-template.test.mjs tests/director-presets.test.mjs tests/director-chapters.test.mjs tests/director-instruct.test.mjs tests/director-rebind.test.mjs tests/streaming-dom.test.mjs
npx --no-install eslint public/scripts/extensions/director/index.js public/scripts/extensions/director/instruct.js tests/director-rebind.test.mjs
```

- Director 复审专用组：9 个场景检查全为 true，另有禁用扩展时基线 DOM 一致性检查。21 次模拟生成请求，0 页面错误。R5 指定的旧 F1/F2/F3 和新增 R1/R2 检查都在 `director.results.json`。
- Adaptive：4 组通过，20ms 组额外完成同页第二次生成。4 组最终 HTML SHA-256 相同：`acd025a4a5a5ee9a4beca7e75dbc9822f4c04a1c702b77d9154ff37ac4c8cdd0`。
- Node：60 pass、0 fail、0 cancelled、0 skipped；原始 TAP 见 `node.tap`。改动文件 lint 通过。
- 按用户要求，本机没有执行全量 node 测试；远端已有 CI 会在普通 push 后自动执行其原有完整矩阵，结果以实际 run 为准，不提前宣称通过。

### 执行范围和诊断记录

`--review-only` 是现有 Python 浏览器框架里的独立执行入口，调用和默认长套件相同的宏/指令检查函数；没有把所需断言替换成静态源码检查。夹具在启动时禁用两项无关第三方扩展，并记录实际列表。

早期诊断尝试中，一个长套件在混合第三方状态下的首消息重载检查失败；另一个长套件在章节 swipe 请求计数检查失败。短隔离复现未重现这些失败。早期还有一次在补充元数据容器恢复测试后主动取消的运行，以及独立入口初始化时的诊断失败。最终上述独立复审组全部通过；不把这些结果表述为默认管理器/章节/群聊长套件全部通过，也不推断第三方扩展已获兼容性验收。临时诊断数据被保留，没有永久删除。

## F4 说明项

### streaming_fps 使用真实时间

`StreamingProcessor.generate()` 用 `new Stopwatch(1000 / power_user.streaming_fps)` 限制真实 token 更新。`Stopwatch.tick()` 比较 `Date.now()` 与 `lastAction`；首块绕过节流并更新 `lastAction`。浏览器 gap 检查直接调用真实 `onProgressStreaming()`，只控制 streaming rAF 回调时间戳，故 4ms 网格不代表墙钟上每 4ms 接受一个 token，也不能用它估算 FPS 上限。

恢复单帧和 FPS 限制的 node 用例名：`format samples at or under 8ms return to one frame and still honor streaming_fps`；另有 `default streaming_fps still drops updates inside its interval when format delay is off`。

### 钩子解析和热路径

`public/scripts/streaming-perf.js` 在模块求值时创建一次 `URLSearchParams`，导出一次计算的 `streamingFormatDelayMs`。没有参数时常量为 0。产品热路径保留如下短路判断：

```javascript
if (typeof streamingFormatDelayMs !== 'undefined' && streamingFormatDelayMs && formatMs < streamingFormatDelayMs) {
    formatMs = streamingFormatDelayMs;
}
```

缺省时是 `typeof` 加零常量的短路检查；没有逐 token URL 解析、额外时钟读取、分配或 busy wait。它钳制统计样本下限，不模拟真实 CPU 阻塞。没有增加第二套产品调度器。

## F1 非阻断建议

- dryRun 提前解除屏蔽：已随 R1 处理。
- 恢复临时 bound 副本的旧分支：保留；生产屏蔽前已有 `clearTemporaryInstruct`，本轮不扩大 F1 改动。
- shields 映射上限：保留原行为，不在本轮引入逐出策略。

## 独立代码复核

只读复核曾发现候选恢复方案会在更早拦截器中止时丢失绑定；最终实现已移除该方案，改为公开 busy setter。新增实际拦截器中止/停止用例均通过。最终只读复核未发现其他可操作问题；这不代替 Opus 的合入批准。

## 新增提交

```text
0f0e1275e0d43a391ca875e1f8dda1ebca09beff fix(director): confirm regenerate deletes without leaking aborted tokens (R1)
b70f9346b9192afce9cf9bbc9a51c47e7f2d33e7 test(director): verify literal narration after ordinary generation autosave (R2)
7658ed1e2683eb307010fdd70ad6e0ba3933df80 test(streaming): compare complete final HTML with unoptimized rendering (R3)
b008e02a227b996daac890ebffefb25a8d2af898 test(streaming): assert synchronous first paint across two hooked generations (R4)
1b8ebdc016f3f11f1ed4a03d90ed03cd82496fe3 docs(director): describe exact prompt restoration and chat-switch cleanup (R6)
4440a85a4c9cd0f90c73c404f4d7a92249863e17 fix(director): restore a confirmed binding after empty metadata cleanup (R1)
c11af7441e8a3eebe645b75b63f05b4be54e90b2 test(director): retain lab artifacts and record verifiable review evidence (R5)
0d75e2e61a5ca95f6d57d7abc4196734b2c8e598 test(director): isolate acceptance fixtures from unrelated third-party extensions (R5)
f37fa8352b9acaf934e6a2778350f822b6f1c124 test(director): expose isolated review scenarios through the existing browser runner (R5)
d977b8a2566f408716356dba024f381f9f35b63f test(director): connect the isolated review fixture before generation (R5)
a625db5709e4e5fbc3b9443dd42fb4dd6b3d8b75 test(director): establish the API connection after selecting the review chat (R5)
29f1e7dba9608a354e6bd264a13c6408786265ce fix(director): preserve regenerate bindings across earlier interceptor termination (R1)
```
