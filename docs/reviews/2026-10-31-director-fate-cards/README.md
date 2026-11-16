# 盲抽命运牌验收

实现提交：`973e8ebbd7f744585798ec866cb642db013de5ef`。起点为已完成持久化修复的 `01eff6a`，新分支为 `feature/director-fate-cards`。设计与实现计划见 [spec](../../superpowers/specs/2026-10-31-director-fate-cards.md) 和 [plan](../../superpowers/plans/2026-10-31-director-fate-cards.md)。

## 实际行为

从 🎬 菜单进入「🎴 命运牌」，选择强度并手动抽牌。每次额外调用当前模型一次，结合剧情生成隐藏事件；面板只显示预设的含蓄牌名和强度。「让意外发生」立即生成剧情；输入框有草稿时保留草稿并阻止采用。失败或停止保留原牌供重试，只有匹配实际请求的成功回复才消耗牌。换牌失败保留上一张，弃牌只处理尚未采用的牌。

固定事件在同一剧情点的 swipe/regenerate 中沿用，后续普通生成和 continue 不重复注入。群聊整批重新生成仅向第一位发言成员注入一次；手动删除后普通生成不恢复旧事件。已抽牌、上一张牌的沿用记录、普通导演指令分别保存。事件中的宏式文字在请求中保持字面量。

牌保存在聊天元数据中，盲抽只约束面板展示，不是加密。导出及模型请求可能包含事件。API 结构或内容不合格时只展示通用错误，不回显模型原文。

## 改动与复查

- `fate.js`：独立状态、公开投影、严格响应验证、异步归属、成功请求身份以及精确重放。
- `fate-ui.js` 和 Director 菜单/样式：原生弹窗、强度、盲览、采用/弃牌/重试、状态及草稿保护。
- `group-chats.js` / `events.js`：原生群聊重新生成的开始/结束通知；结束通知等待异步整批完成，保存失败可在删除消息前取消。
- `saveChatConditional`：可选的 `shouldSave` 条件在等待保存锁后、同步捕获保存载荷前再次核对归属。原调用方式及 null 参数继续可用。相对起点的 `Generate` 没有改动，第三方扩展没有改动。
- 两版 README、现有浏览器框架的 `--fate-only` 模式、独立用例文件和 26 个新增单元用例；新增单元用例已纳入现有 `test:perf`，由六格 CI 运行。

独立只读复查重点核对了实际 `data` 对象的 WeakMap 身份、组装后 token 替换、原生重放的延迟完成与新抽牌并存、群聊 scope/cancellation，以及保存归属。前轮发现的过早结束群聊 scope、失败后锁定、直接 regenerate 删除识别、停止后的群聊重试和排队保存边界均已修复。本轮未发现新的可复现阻断；独立复查者没有运行测试，以下运行结果由执行方提供。

## 验证命令与证据

本地使用 Node **v24.22.1**、Chrome **156.0.8078.76**、Python Playwright。以下命令中的 `node` 指该运行时；浏览器通过 `LAB_BROWSER_EXECUTABLE` 选择已安装的 Chrome。所有模型调用均使用仓库已有合成 OpenAI 夹具，没有调用付费模型。没有在本地运行全仓测试。

| 命令 | 结果 | 证据 |
| --- | --- | --- |
| `node --test tests/director-*.test.mjs` | 68 通过，0 失败/取消/跳过 | [director-unit.txt](director-unit.txt) |
| `node node_modules/eslint/bin/eslint.js public/script.js public/scripts/events.js public/scripts/group-chats.js public/scripts/extensions/director/*.js tests/director-fate*.test.mjs` | exit 0 | [lint.txt](lint.txt) |
| `python tests/browser-director-lab.py --node node --fate-only --enable-third-party --output .evidence/fate/final-fate-third-party.json` | 9 项检查通过；23 次合成请求；0 页面异常 | [完整结果](fate-third-party.results.json) |
| `python tests/browser-director-lab.py --node node --output .evidence/fate/final-director-full.json` | 默认完整 Director 套件，53 项通过；63 次合成请求；0 页面异常 | [完整结果](director-full.results.json) |

默认完整套件保留原有夹具隔离：禁用 `third-party/JS-Slash-Runner`、`third-party/st-memory-enhancement`。本次命运牌专项则把两者打开。章节 swipe 请求数为 4→5，生成新 swipe 后保存、磁盘重载及清除章节均通过；首条旁白/备注字面量、并发保存、API 编辑、切换聊天及普通问候回归也通过。两次提交后浏览器运行均对应上面的实现提交。

第三方扩展开启场景：`disabledThirdPartyExtensions=[]`，JS-Slash-Runner 与 st-memory-enhancement 的入口均实际加载，`TavernHelper` 可用。浏览器覆盖盲抽隐藏原文、普通导演指令共存、390px 面板、草稿保护、重载、采用、同点 swipe/regenerate、普通生成不重触发、无普通绑定的直接 regenerate、错误/停止保留、弃牌解除、真实双角色群聊、整批重生成、手动删除，以及抽牌中切换聊天。群聊检查断言实际两个角色都发言，事件出现次数为 `[1,0]`。

两个失败用例分别在采用和原生 swipe 时，由合成上游实际返回 **HTTP 500**；酒馆原生非流式代理将其包装为 HTTP 200 的 error envelope。测试同时断言响应含 error 与上游 timing 的 status=500，再检查持牌保留、重试和操作解锁。停止用例等待正文中出现真实流式 token 后才停止。

UI 截图：[桌面](desktop.png)、[390px](mobile.png)。390px 断言只覆盖命运牌面板；背景里普通导演指令 chip 的既有溢出仍可见，不代表宿主整个页面完成移动端验收。

## 调试结果与证据身份

最终验收前保留了失败再修复的记录：[群聊异步 scope](red-group-scope.txt)、[排队保存归属](red-owner-save.txt)、[生命周期边界](red-fate-hardening.txt)。这些是修复前的失败，不计为当前通过用例。浏览器探索过程中也修正了夹具自身的问题：重复选择器、模态框后的不可交互草稿、ENDED 先于 COMPLETED 的等待条件、空 held 读取、故障配置键及代理错误状态的断言。没有通过删除功能断言或忽略错误取得通过。

[隔离环境的预提交诊断](fate-isolated-diagnostic.results.json) 同样通过 9 项/23 请求/0 页面异常，但其 HEAD 是当时的文档提交，代码尚未提交，因此单独标记为诊断，不替代提交后的验收。

[validated-source-sha256.json](validated-source-sha256.json) 记录实现提交及产品/测试文件哈希。最终浏览器结果记录 Director、核心保存函数所在文件、事件/群聊文件、用例文件、runner 和合成上游的哈希。后续验收文档提交仅追加本目录，验证这些哈希与最终工作区一致。合并继续等待 Opus 确认。
