# SillyTavern 1.19.0 同步记录（隔离分支）

日期：2026-10-09。分支 `codex/sillytavern-1.19-sync`，从末端 `3994636`（1.18 系列实验末状态）出发，把官方最新正式版 **1.19.0**（提交 `7e8663cd`，2026-09-14）同步进本库的已导入源码范围。未部署、未访问生产、未改动其他分支。

## 方法

- 官方 1.18.0 / 1.19.0 源码沿用此前已逐文件 SHA-256 核验的官方发布 ZIP；本地构建两份官方树提交对象（`refs/upstream/18`、`refs/upstream/19`，提交 `4541dc9`/`695e539`），作为三方合并的基线。
- 对本库存在的全部上游改动文件逐文件执行 `git apply --3way`（以官方 1.18 树为共同基线），冲突逐处语义合并。
- 范围：仅同步本库已导入的源码/资源（既定导入策略）；官方测试、.github、docker、.npmrc 等 37 个未导入文件仍不导入。两个官方新增**应用**模块随本次同步导入。

## 同步结果

上游 1.19 共触及 102 个文件（80 改 + 22 增），其中：

| 处理 | 数量 | 说明 |
|---|---:|---|
| 干净应用 | 62 | 含官方新增应用模块 `public/scripts/message-formatter.js` 与 `src/endpoints/backends/google-models.js` |
| 冲突后语义合并 | 5 | 见下表 |
| 按策略跳过 | 35 | 官方测试、.github、.npmrc、plugins.js 等未导入文件 |

### 五个冲突的解决方式

| 文件 | 官方 1.19 的改动 | 解决 |
|---|---|---|
| `.gitignore` | 新增忽略项 `.windsurf/` | 保留本库精简列表 + 收录该新增项 |
| `public/script.js` | messageFormatting 接入 `MessageFormatter` 钩子、JSDoc 重写、deleteMessage 级联删除工具消息 | 钩子/级联改动全部保留；保留我们的 `getMessageDepth`（深度统计优化）；JSDoc 采用官方详版 |
| `src/endpoints/characters.js` | BYAF 导入改用 `getArrayBufferSlice` 助手并删除临时上传文件 | BYAF 处采用官方版本；角色重命名流程保留本库的路径锁/独占创建/退役标记/回收区加固（不使用官方 `cpSync+unlink` 版本） |
| `src/endpoints/chats.js` | 备份键按名称哈希、同步写、`removeOldBackups`；扫描容错（文件扫描中被删除） | 保留本库异步 IO、路径锁、`.recycle` 回收、按历史隔离的备份调度；采纳官方"扫描中文件消失"容错（stat 与流两处 ENOENT 均按降级结果返回） |
| `public/scripts/autocomplete/AutoComplete.js` | 新增 `isActive` 判断与 parentElement 观察 | 保留本库的监听器/测量层释放体系；把官方 `isActive` 判断并入我们的 resize 监听器 |

其余 6 个"双方都改"的文件（`package.json`、`public/scripts/extensions/expressions/index.js`、`public/scripts/group-chats.js`、`src/endpoints/tokenizers.js`、`src/server-main.js`、`public/scripts/extensions.js`）三方合并**自动成功**：本库优化与官方改动已并存（版本号随官方升至 1.19.0）。

## 测试适配

- `tests/message-depth.test.mjs`：messageFormatting 现在会调用 `MessageFormatter.runStage`，测试脚手架补充恒等桩（钩子行为由官方套件覆盖）。
- `tests/performance-lab.test.mjs`：缺失聊天文件的契约随官方从 reject 改为 **resolve 降级结果 `{ match: false }`**（扫描不再悬挂，也不再视为错误）。

## 测试结果

| 运行时 | 结果 |
|---|---|
| Node 24.15.0 | **442/442 通过**，0 失败/取消/跳过 |
| Node 20.20.2 | **442/442 通过**，0 失败/取消/跳过 |

依赖：`node_modules` 自末端工作树复制（离线），未执行全新 `npm install`；与官方 1.19 的 lock 差异未单独复核。

## 明确边界

- 本轮只做**源码合并**：未重跑浏览器对照与原生夹具（表情 40→0、备份调度、富文本让出等功能需要在新基线上复验后才能沿用旧结论）。
- 未部署、未推送；官方 1.19 的 35 个未导入文件（官方测试/工作流等）仍不在本库。
- `export function getBackupKey`（官方 1.19 新增）被保留以贴近上游，但库内目前未使用（本库备份命名用按历史隔离的 SHA-256 前缀方案）。
- 若要把此分支用于真实使用，仍需：浏览器级验收（复用 `F:\SillyTavern-Research` 下的对照脚本）、依赖锁定复核、以及针对目标部署版本的核验与授权。
