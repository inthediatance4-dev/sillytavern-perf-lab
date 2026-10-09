# SillyTavern 性能与可靠性实验库

**基于 [SillyTavern](https://github.com/SillyTavern/SillyTavern) 1.18.0（AGPL-3.0）的隔离优化实验库。**
11 轮依次叠加的优化，每轮一个独立分支，各自带测试、浏览器实测证据和经过独立复核的验收报告。**从未部署**：全程未触碰生产服务器，并用跨轮文件哈希快照验证了这一点。

> 这是研究性分支实验，**不是可分发版本**。增量 ZIP/补丁面向实验库的 1.18 基线，不可直接覆盖官方 1.19+ 或任何线上安装。

## 为什么做它

写作时官方最新正式版为 **1.19.0**（提交 `7e8663cd`，2026-09-14）。我们把本实验库的最终版与它逐文件对比：

- **12 个文件只存在于本库** —— 异步聊天 IO、聊天信息缓存、流式聊天搜索、备份调度器、媒体加载滚动模块、After Hours 主题、实验脚手架。
- **10 个我们改过的文件，官方 1.19 完全没有碰过** —— 包括 `src/endpoints/vectors.js`、`public/scripts/itemized-prompts.js`、`public/scripts/welcome-screen.js`、`src/endpoints/backups.js`、`src/transformers.js`。
- **11 个文件双方都改过**（合并需逐函数审查）：`public/script.js`、`src/endpoints/chats.js`、`public/scripts/group-chats.js`、`public/scripts/extensions/expressions/index.js`、`public/scripts/autocomplete/AutoComplete.js`、`src/endpoints/characters.js`、`src/endpoints/tokenizers.js`、`src/server-main.js`、`public/scripts/extensions.js`、`package.json`、`.gitignore`。

### 官方 1.19.0 至今没有的重点改进

| 领域 | 官方 1.19.0 现状 | 本实验库 |
|---|---|---|
| 表情 VN 模式判断 | 仍是 `$('#visual-novel-wrapper').is(':visible')`（第 502 行）——读取布局；容器隐藏或无自身布局框时会误判并重置精灵/拖动位置 | 私有已应用状态、同步更新；目标布局读取 **40 → 0 次** |
| WebLLM/KoboldCPP 批量嵌入 | 批循环里 `results.push(...texts.map(...))`——**21 个输入产出 63 个向量** | 批内查找 → 严格 21 个输出、顺序不变 |
| 长富文本聊天 | 同步构建；180 条重型消息最长主线程任务约 2.3 秒 | `printMessages` 后让出一次 → 最长任务 **2307 → 1237 ms（−46.4%）**；打开耗时 +8.3% 已如实披露为取舍 |
| 消息深度统计 | 每条消息都扫描此前全部消息 | 只统计到目标为止——`is_system` 读取 **300,000 → 5,050（−98.3%）**（3000 条中显示最后 100 条） |
| 聊天文件安全 | 同步写入、永久删除 | 异步 IO、多路径锁、独占创建、退役标记、回收区、坏文件头保护 |
| 备份节流 | 按名称的无限 Map | 按历史隔离、SHA-256 前缀键、256 键上限、60 秒闲置回收、停机前排空 |
| 提示词缓存竞态 | 迟到读取可覆盖新开聊天的缓存；关闭在读聊天会保存空缓存 | 请求所有权 + 可保存状态；群聊取消失效传播 |
| 最近聊天进入 | 先打开默认聊天再打开目标（双重加载） | 直接进入目标 + 归属守卫 + 版本化信息缓存 |
| 角色编辑器打开 | 先填整份新建草稿再立即重填当前角色 | 单次填入——编辑器准备中位 **−15.4% / −46.7%**（普通/重型） |
| 启动 | 无可选运行时延迟、无编译缓存中间件、无内置模板预加载 | 延迟可选运行时、webpack-serve 缓存、模板预加载 |

另一面也如实说明：**尚未合并的官方修复** —— 图片按日期排序、世界书 Map 索引、`/addswipe` 局部更新、书签分支 integrity、搜索不可信 URL 过滤、账号重置限流。详见 [docs/COMPARISON-vs-official-1.19.0.md](docs/COMPARISON-vs-official-1.19.0.md)。

## 验证状态

- 安全测试套件：**Node 20.20.2 442/442、Node 24.15.0 442/442**（2026-10-09 实跑复验）。
- 逐轮实跑：**11 个工作树合计 632 项测试，0 失败**。
- 证据审计：**17,732 条摘要声明复算**，全部 ZIP 与工作树逐字节一致，Git bundle 全部重新校验，每轮 1,177–1,214 个文件还原比对，**12,915 个受保护文件全量重扫**，生产文件哈希跨轮完全一致，**0 问题**。
- 每轮的 RED/GREEN 日志、原始浏览器证据和交付产物保留在仓库之外（本地证据目录）；每轮的 `docs/*-verification.md` 说明方法、实测数字与遗留边界。

## 分支结构

从 `main`（SillyTavern 1.18.0 基线 + 实验脚手架）开始，每个分支基于上一轮的 head，历史即链条。

| # | 分支 | 内容 |
|---|---|---|
| 1 | `codex/sillytavern-performance` | 流式聊天搜索、有序异步存储 |
| 2 | `codex/sillytavern-lifecycle` | 聊天生命周期保护、tokenizer 初始化共享 |
| 3 | `codex/sillytavern-startup` | 可选运行时延迟、前端缓存校验 |
| 4 | `codex/sillytavern-frontend-startup` | 有序启动中预加载内置模板 |
| 5 | `codex/sillytavern-ui-flow` | After Hours 主题、自动补全/媒体资源释放 |
| 6 | `codex/sillytavern-chat-transitions` | 最近聊天直接进入、版本化信息缓存、路径锁 |
| 7 | `codex/sillytavern-reliability-render` | 坏文件头保护、按历史备份隔离、深度统计、向量批修复 |
| 8 | `codex/sillytavern-richtext-flow` | 富文本让出边界、完整加载归属守卫 |
| 9 | `codex/sillytavern-prompt-isolation` | 提示词缓存所有权、群聊取消失效传播 |
| 10 | `codex/sillytavern-character-editor-flow` | 角色编辑器单次准备 |
| 11 | `codex/sillytavern-expression-mode-flow` | 表情 VN 模式状态修复（末端） |

附标签：`r1-performance` … `r11-expression-mode`。

## 运行安全测试

本库只运行自己的安全套件（官方 Jest 含永久清理夹具，故意不使用）：

```bash
# package.json 中声明的安全套件（442 项）
node --test tests/performance-lab.test.mjs tests/enabled-backups.test.mjs tests/chat-lifecycle.test.mjs \
  tests/tokenizer-initialization.test.mjs tests/tokenizer-model-compatibility.test.mjs tests/frontend-lifecycle.test.mjs \
  tests/frontend-template-startup.test.mjs tests/startup-lazy-imports.test.mjs tests/startup-webpack.test.mjs \
  tests/startup-failure-exit.test.mjs tests/media-load-scroll.test.mjs tests/autocomplete-lifecycle.test.mjs \
  tests/chat-transitions.test.mjs tests/chat-load-ownership.test.mjs tests/character-editor-flow.test.mjs \
  tests/expression-mode-flow.test.mjs tests/itemized-prompts-ownership.test.mjs tests/recent-chat-info-cache.test.mjs \
  tests/chat-file-safety.test.mjs tests/chat-backup-isolation.test.mjs tests/message-depth.test.mjs \
  tests/vector-batch-cardinality.test.mjs
```

可选的实验启动器（`npm run perf:lab`）只监听 **127.0.0.1:8780**，使用自己的 `.lab-data/` 和 `.lab-config.yaml`。

## 边界

未部署、未做生产验证；移动端为 Chrome UA 模拟而非真机；重型聊天仍有约 1.2–1.26 秒主线程阻塞；基线为 1.18.0，投入实际使用需要在 1.19+ 上逐函数合并并重跑完整回归与浏览器验收。

## 许可

AGPL-3.0，继承自 SillyTavern。本库为独立研究衍生作品，与 SillyTavern 官方项目无隶属关系；全部修改以相同许可发布。
