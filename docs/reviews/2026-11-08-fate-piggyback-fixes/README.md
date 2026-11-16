# 4177d6b 复审后修复

基线：`4177d6be7d95c68431e28bb3e6785553835d765f`。本轮追加提交，不改写历史，不合并或部署。

| 提交 | 修复 |
|---|---|
| `3691f81` | 打包清单补齐 `fate-piggyback.js`；真实生产来源构建 smoke、包内依赖与校验清单、两次构建可复现性 |
| `1aa6743` | 旧存档缺少 strength 的预生成 offer 向界面统一报告 medium，与真实零调用选牌行为一致 |
| `2e5b709` | 普通回复的返回字符串与 messageChunk 使用最终正文；流式收尾捕获原消息引用，切聊天后不从新聊天同一索引取值或触发续写 |
| `9071038` | 官方完成凭据在受控清理后冻结；附加候选与思维在实际 HTTP 写入前清理；旧压缩快照、聊天归属与世界书隔离 |

## 保存与归属

官方 1.19.0 没有改进版的 `MESSAGE_SWIPES_APPENDED`。插件因此在自己的保存适配层处理原生快照，不假定该事件存在，也不通过删除成功校验来兼容。

消息最终化先完成插件受控清理，再记录确切的对象、索引、文本与 swipe；后续保存仍要求原聊天、模型成功、候选文本和 swipe 匹配。错误文本、错误聊天、错误候选和停止生成不产生成功凭据。

保存原生快照前，按已捕获请求清理附加候选及其思维副本，再传给 HTTP。若原请求采用 gzip，保持有效的压缩传输。已排队的多个原快照都执行清理；保留弱关联仅用于清理，重复完成不会重新发牌。完成回调不阻塞原生 HTTP 返回，因此元数据保存等待原生锁不会形成循环等待。

原生保存还可能先序列化、异步压缩，再调用 fetch；聊天切换会清空实时请求，因此另保留最多 128 条紧凑来源戳及无状态清理函数。来源戳仅含聊天/头像、消息索引与生成时间等标识，不保留正文、请求体或聊天图。它可以清理到达较晚的旧快照，但不修改新聊天，不授予成功凭据。错误归属或来源戳不匹配时不授权清理。

备牌临时指令也接入现有不扫描世界书的规则；官方宿主按当前 tokenizer 使用不含任务正文的占位预留预算，组装后还原。

## 本轮实际验证

Node 24.22.1，Python Playwright、桌面 Chromium；仅使用本地合成提供方。官方源码为未改动的 1.19.0 `06bde939fb1e9c4c8d8641d810f0a916b5bce127`。改进版以本轮代码测试；报告中的 hostCommit 是当时基线，最终对应包内 sourceHash 和脚本 SHA256 均再次核对。

| 检查 | 结果 |
|---|---|
| 相关单元/状态/生命周期/打包/返回值回归 | 329 通过，0 失败、0 取消、0 跳过 |
| 官方原版实际安装 ZIP | 18/18；37 次合成提供方请求 |
| 当前改进版实际安装同一 ZIP | 18/18；37 次合成提供方请求 |
| 改动 JS 的 ESLint、Python 编译 | 通过 |
| 独立复核 | 初次发现的跨聊天引用、世界书和晚到旧快照问题均已补测并修复；二次复核未发现上述路径的其他可操作缺陷 |

新增四条浏览器场景：私密块位于主正文、n>1 附加候选、reasoning_content、流式正文。每轮仅一次提供方请求，offer 创建成功，最终正文/候选/思维与 JSONL 消息行均无私密块。关系记忆、群聊、swipe/regenerate、400 码点牌的小上下文预算等原有 14 项一并通过。

原生返回值与 messageChunk 的浏览器检查针对改进版；官方宿主保持源码不变，官方安装检查针对界面、完成凭据、备牌与 JSONL 清理。没有用这些结果声称第三方扩展直接调用官方原生 Generate 的返回 API 已被改写。

两个宿主各有一次故意注入的 HTTP 500，均确认为失败且不计数；它们不是成功生成。没有意外页面异常。真实模型质量、全部商业提供方、实体手机和流式中间画面的视觉隐蔽性未在本轮验收。未在本地运行全仓测试。

机器可读结果：[官方](../../../.evidence/4177d6b-fixes/official-results.json)、[改进版](../../../.evidence/4177d6b-fixes/fork-results.json)。

## 命令

```sh
node --experimental-vm-modules --test tests/director-fate-stock-compat.test.mjs tests/reply-cleanup-return.test.mjs tests/director-fate-piggyback.test.mjs tests/director-fate-ui.test.mjs tests/fake-openai-endpoint.test.mjs tests/longchat-spread.test.mjs tests/standalone-plugin-package.test.mjs tests/plugin-host-events.test.mjs tests/plugin-runtime.test.mjs tests/plugin-prompt-shield.test.mjs tests/affinity-entry.test.mjs tests/director-affinity-lifecycle.test.mjs tests/director-fate-group-scope.test.mjs tests/director-fate-persistence.test.mjs
node node_modules/eslint/bin/eslint.js public/script.js public/scripts/plugin-runtime public/scripts/extensions/director/fate.js public/scripts/extensions/director/index.js scripts/build-standalone-plugins.mjs tests/reply-cleanup-return.test.mjs tests/director-fate-stock-compat.test.mjs tests/standalone-plugin-package.test.mjs tests/director-fate-ui.test.mjs tests/director-fate-piggyback.test.mjs tests/plugin-prompt-shield.test.mjs
python -m py_compile tests/browser-standalone-plugins.py
python tests/browser-standalone-plugins.py --host-root <official-checkout> --output .evidence/4177d6b-fixes/official-results.json
python tests/browser-standalone-plugins.py --host-root . --output .evidence/4177d6b-fixes/fork-results.json
node scripts/build-standalone-plugins.mjs
git -c core.whitespace=cr-at-eol diff --check
```

两个新回归文件已接入现有 test:perf/test:standalone 命令，无需修改 CI 工作流。测试、夹具与构建保留旧输出，不删除文件。

## 校验后的安装包

- 命运之牌 1.3.0：`st-director-fate-cards-1.3.0.zip`，SHA256 `2f8acbf7e9547f54c86a62dfabafbb604c62d144af63c17d56bf62588b501823`。
- 好感度记忆 1.1.1：`st-affinity-memory-1.1.1.zip`，SHA256 `f05651a5a2daa143df487e227531f48245b64bba43b324e9ef5c803fb9cbfc44`。本包同步包含保存适配修复。

每个包包含 LICENSE、来源和包内文件 SHA256 清单；无需安装另一个插件。安装说明见[独立插件指南](../../standalone-plugins.md)。
