# 命运牌采用后未揭晓：排查与兼容修复

基线 `7f9cbb3`。用户报告采用后正文完成，却没有看到牌面内容。未读取用户聊天或下载存档；没有以生产聊天调用模型，也没有根据事后描述断言某个分支就是当次事故原因。

## 已确认的缺陷

酒馆助手的 `stopGenerationById(id)` / `stopAllGeneration()` 会发出带字符串请求 ID 的 `GENERATION_STOPPED`。该 ID 属于助手自己的生成。SillyTavern 的原生 `stopGeneration()` 发出的同名事件不带 ID。

原 Fate 监听器未区分来源，会使进行中的原生采用失效：即使正文正常完成，卡片仍被保留，无法获得成功后的揭晓状态。官方宿主的完成凭据适配器同样会误撤销原生请求的资格。新增三个回归在修复前全部因这一原因失败。

修复只忽略上述带字符串 ID 的独立停止事件。原生停止、实际请求 AbortSignal、错误保存与归属校验继续有效。Director 更新为 1.3.1；Affinity 更新为 1.1.2，同步携带官方宿主适配器修复。未改动第三方扩展或宿主 Generate。

服务器已安装的酒馆助手启用且代码具有该事件行为；这说明存在触发条件，不能证明用户中午那次必然触发了它。

## 实际验证

- 原有揭晓、界面、历史、持久化相关测试 77/77 通过。
- 新增失败复现：独立请求停止打断采用、控制器把待完成抽牌误标取消、官方适配器撤销完成资格，修复前 0/3，修复后 3/3。
- 另补真实传输已中止时不授予完成凭据的反例。
- 最终相关回归 159/159；0 失败、0 取消、0 跳过。涵盖揭晓、界面、历史、保存、备牌、宿主事件、运行适配、官方兼容与真实源码打包。
- 桌面、390px、关闭动效、系统减少动态效果的独立 Chromium 合成页面均能绘制实际事件文字。
- 未修改的官方 1.19.0 与优化版分别安装实际 ZIP：非流式桌面、流式390px，在采用的提示组装阶段注入独立 helper 停止事件；确认原生生成与保存成功、卡片消耗、正面实际文字和可见样式、历史内容、重新加载后的揭晓。两个宿主各 5/5 检查通过（含原有两项安装检查）。
- ESLint、Python 编译、CRLF-aware diff 检查通过；独立只读复审未发现阻断项。

浏览器结果：[优化版](../../../.evidence/fate-reveal-20261109/fork-results-v2.json)、[官方](../../../.evidence/fate-reveal-20261109/official-results-v2.json)。两边的包校验和一致。报告 hostCommit 是宿主基线，实际插件来源以其中的 sourceHash 和 ZIP SHA256 标识；本次未修改宿主核心。源码工作区构建的包与提交后构建的包再次核对。

抽牌控制器测试使用替代 quiet 函数，不等于所有真实 quiet/fallback 通道都能抵抗外部停止事件。例如宿主 generateRaw 的原生取消监听仍是宿主行为；本次真实安装验收聚焦正常采用后的揭晓。未完成真实提供方、手机实机或全部第三方脚本组合验收。

## 使用边界

事件在采用成功前保持密封。默认点击翻牌，自动揭晓或关闭揭晓仍按原设置执行。继续发出新消息后，旧绑定可能离开“当前”页；已经成功采用的记录应从“本局命运”翻开。锚点发生改写时，当前绑定不再允许冒充原消息，历史仍保留已完成的事件。

本修复不会把过去未获成功凭据的卡片追认为已采用，也不会为恢复揭晓而自动生成或消耗卡片。现场未记录的 UI 状态无法事后还原，不能据此宣称全部可能原因已排除。

## 命令

```sh
node --test tests/director-fate-reveal.test.mjs tests/director-fate-ui.test.mjs tests/director-fate-log.test.mjs tests/director-fate-persistence.test.mjs tests/director-fate-piggyback.test.mjs tests/plugin-host-events.test.mjs tests/plugin-runtime.test.mjs tests/standalone-plugin-package.test.mjs tests/director-fate-stock-compat.test.mjs
node node_modules/eslint/bin/eslint.js public/scripts/extensions/director/fate.js public/scripts/plugin-runtime/host-events.js tests/director-fate-reveal.test.mjs tests/plugin-host-events.test.mjs
python -m py_compile tests/browser-standalone-plugins.py
python tests/browser-standalone-plugins.py --host-root . --fate-reveal-only --output .evidence/fate-reveal-20261109/fork-results-v2.json
python tests/browser-standalone-plugins.py --host-root .worktrees/official-plugin-host --fate-reveal-only --output .evidence/fate-reveal-20261109/official-results-v2.json
```

第一次新增浏览器用例在第二轮打开菜单时超时：Esc 已恢复菜单，测试再次切换反而把它关闭。更正夹具为按可见状态打开菜单后，两宿主通过；失败记录和夹具仍保留，没有算入通过结果。
