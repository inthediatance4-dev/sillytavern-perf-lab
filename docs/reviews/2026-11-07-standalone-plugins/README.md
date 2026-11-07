# 独立插件提取复审与修复

基准为 `feature/hidden-affinity` 的 `71f8a93`（含 `b1066c5`、`0697f00`）。原提取仅把好感度移到另一个内置扩展目录；第三方安装时宿主导入、模板目录和事件能力仍存在依赖。本轮追加独立安装兼容层与打包器，不修改官方宿主源码、不合并、不部署。

## 已修复

1. 旧 `director.affinity` 的关闭状态与五条频率迁移；显式的新设置优先。修复设置抽屉默认展开、图标与显示状态相反的问题。
2. 界面统一为「命运之牌」，保留 `/director`、预设和元数据命名空间。
3. 安装目录由实际入口 URL 推导；两个 ZIP 各含完整运行文件，只导入宿主公开模块。模板和停用判断使用完整的第三方 ID。
4. 独立包使用不同的拦截器名称，并对同一请求去重。真实改进版验收先复现了停用的内置 manifest 仍调用同名全局拦截器，导致同一事件注入两次；修复后是一次。
5. 官方宿主缺少的成功完成凭据，要求实际请求、非停止的成功模型响应、真实回复候选与成功的归属匹配保存共同成立。UI 解锁不等于完成；不以任意 `MESSAGE_RECEIVED` 冒充成功。覆盖流式错误、工具中间结果、gzip 保存、保存期间继续生成，以及停止后续请求不撤销前次待保存凭据。
6. 两个插件协调保存队列；官方保存显式绑定聊天与元数据，重查调用方守卫与原生保存锁，群聊归属不依赖不断变化的当前发言角色。完成监听器的元数据保存不阻塞原生保存 HTTP 返回，避免等待原生锁造成死锁。
7. 好感度评估直接使用请求本地的纯传输，保留字面证据、独立输出上限及自己的取消信号，不调用官方会展开宏及修改全局长度状态的 quiet/raw 构建路径。命运牌抽牌继续使用原生 quiet 获取故事上下文。
8. 官方世界书扫描期间，私密临时消息只暴露不含正文的占位；按当前 tokenizer 预留完整正文预算，组装后恢复。并发 quiet 不读取或清掉主请求的事件。
9. 经用户确认，官方宿主采用空系统起始标记保护第 0 条 Director 旁白，避免再次展开写回正文。旧存档的绑定与证据物理位置同时迁移，普通角色问候不变。

## 实际验证

本地仅运行相关检查，没有运行全仓测试。Node 24.22.1、Python Playwright、桌面 Chromium；模型提供方为本地合成 fixture，未使用真实模型或凭据。

| 检查 | 结果 |
|---|---|
| 相关单元、状态、生命周期、预算、牌与绑定回归 | 476 通过，0 失败、0 取消、0 跳过 |
| 官方原版 1.19.0，`06bde939fb1e9c4c8d8641d810f0a916b5bce127` | 实际安装 ZIP，14/14，通过 33 次提供方请求；官方 tracked 源码 diff 为空 |
| 当前改进版 1.19.0，基准 `71f8a93` 加本轮插件变更 | 相同 ZIP，14/14，通过 33 次提供方请求 |
| 改动文件 ESLint、Python 编译、Git 空白检查（识别 CRLF） | 通过 |

浏览器覆盖：两个插件分别单独启用与共同启用、旧关闭设置迁移、抽屉默认折叠、五条真实回复触发整理、整理结果真正进入下一请求、流式成功、continue/regenerate/swipe 的逻辑计数、HTTP 失败不计数、首条旁白生成后重新加载、采用期间并发 quiet、原生群聊成员各自的记忆、群聊牌只注入一次、群聊 regenerate，以及饱和小上下文预算。

每个宿主有一次**故意注入的 HTTP 500**，确认为失败且不授予凭据；它不被列为通过的生成。两个宿主均无意外页面异常。夹具保留控制台资源加载错误供审阅；这不是实体设备或全站视觉验收。

400 码点的牌、上下文 2048、回复预留 256，实际输入上限为 1792：

| 宿主 | 无牌输入 tokens | 有牌输入 tokens | 保留的历史消息 |
|---|---:|---:|---|
| 官方 | 1697 | 1649 | 28 → 21 |
| 改进版 | 1756 | 1708 | 29 → 22 |

并发检查在真实 `CHAT_COMPLETION_PROMPT_READY` 暂停普通请求，先完成原生 quiet，再释放普通请求。两个宿主的事件出现次数均为 `[0, 1]`，请求里没有内部占位；只有普通请求的已保存回复消耗牌。

机器可读结果：[官方](../../../.evidence/standalone-plugins/official-results.json)、[改进版](../../../.evidence/standalone-plugins/fork-results.json)。两份报告记录相同包 SHA256、sourceHash 与测试脚本 SHA256。

## 复现命令

```sh
npm run test:standalone
node --experimental-vm-modules --test tests/affinity-entry.test.mjs tests/plugin-runtime.test.mjs tests/plugin-host-events.test.mjs tests/plugin-literal-start.test.mjs tests/plugin-prompt-shield.test.mjs tests/plugin-requests.test.mjs tests/plugin-settings.test.mjs tests/standalone-plugin-package.test.mjs tests/director-affinity-state.test.mjs tests/director-affinity-lifecycle.test.mjs tests/director-affinity-provider.test.mjs tests/director-affinity-budget.test.mjs tests/director-fate.test.mjs tests/director-fate-followups.test.mjs tests/director-fate-group-scope.test.mjs tests/director-fate-persistence.test.mjs tests/director-instruct.test.mjs tests/director-rebind.test.mjs tests/director-template.test.mjs
node node_modules/eslint/bin/eslint.js public/scripts/plugin-runtime public/scripts/extensions/affinity/index.js public/scripts/extensions/director/index.js public/scripts/extensions/director/manager.js scripts/build-standalone-plugins.mjs tests/plugin-*.test.mjs tests/affinity-entry.test.mjs tests/standalone-plugin-package.test.mjs
python -m py_compile tests/browser-standalone-plugins.py
python tests/browser-standalone-plugins.py --host-root <official-checkout> --output .evidence/standalone-plugins/official-results.json
python tests/browser-standalone-plugins.py --host-root . --output .evidence/standalone-plugins/fork-results.json
npm run build:standalone
git -c core.whitespace=cr-at-eol diff --check
```

`--node` 和 `LAB_BROWSER_EXECUTABLE` 可指定本地执行器，输出会移除机器目录和主机标识。夹具与构建输出放在新的忽略目录，测试不删除文件。

## 安装包与边界

- `st-director-fate-cards-1.2.0.zip`：SHA256 `a2a16f701e369746e929e20c00655778e6703986de0919cca2e336b7923063c9`。
- `st-affinity-memory-1.1.0.zip`：SHA256 `b7bd2cc57f14d0dcf7ef4af0038cb6f90b36db41b77225ddb3e9bd7b9c961ab8`。

安装说明见[独立插件指南](../../standalone-plugins.md)。ZIP 含许可证、包内与来源文件的校验清单；没有聊天、密钥、依赖或备份。此仓库 URL 不能直接作为两个扩展的一键 Git 安装地址；本轮没有创建额外仓库或发布 Release。

兼容验证限定以上实际宿主与场景，不声称所有历史／未来版本或所有商业提供方均通过。真实模型质量与手机实机尚未验证。其他扩展直接调用上游 ESM `regenerateGroup()` 的不可观察路径，不能承诺重生成沿用；普通 UI 与 `/regenerate` 已实际验证。

CI 工作流增加 `npm run test:standalone`，在原有 Node 20/22/24 × Ubuntu/Windows 矩阵中执行。本地 476 项与浏览器结果独立于 CI，不用历史运行代替最终提交的状态。
