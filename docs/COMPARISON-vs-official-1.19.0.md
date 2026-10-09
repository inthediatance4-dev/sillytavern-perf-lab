# 对比：本实验库 vs 官方最新版 1.19.0

对比日期：2026-10-09。本库最终提交 `3994636`（分支 `codex/sillytavern-expression-mode-flow`）；官方最新正式版 **1.19.0**，提交 `7e8663cd9c184a550b37238218bdd32c6efc68e9`，发布于 2026-09-14，源码经匿名 GitHub API 下载、逐文件 SHA-256 核验（原始 ZIP 与核验记录保留在本地证据目录）。

对比方式：对本库 11 轮改动过的全部 33 个源码/脚手架文件，逐一与官方 1.18.0、1.19.0 的对应文件做字节级比较，并对双方都改过的文件补充改动量统计。**本库基线 = 官方 1.18.0**（抽样 `src/util.js` 等未改动文件与 1.18.0 完全一致）。

## 一、总体矩阵

| 分类 | 数量 | 说明 |
|---|---:|---|
| 仅存在于本库 | 12 | 官方 1.19 没有这些文件（并行模块、主题、脚手架） |
| 我们改了、官方 1.19 未碰 | 10 | 我们的改动在最新版中**完全不存在** |
| 双方都改过 | 11 | 同名文件各自演进，需要逐函数合并审查 |

仅存在于本库（12）：`src/chat-io.js`、`src/chat-search.js`、`src/chat-info-cache.js`、`src/chat-backup-scheduler.js`、`public/scripts/media-load-scroll.js`、`public/css/after-hours.css`、`default/content/themes/After Hours.json`、`scripts/start-performance-lab.mjs`、`scripts/benchmark-performance.mjs`、`start-lab.cmd`、`ISOLATION.md`、`独立酒馆使用说明.md`。

我们改了、官方 1.19 未碰（10）：`src/endpoints/vectors.js`、`src/endpoints/backups.js`、`src/endpoints/groups.js`、`src/middleware/webpack-serve.js`、`src/transformers.js`、`public/scripts/itemized-prompts.js`、`public/scripts/templates.js`、`public/scripts/welcome-screen.js`、`default/content/index.json`、`webpack.config.js`。

双方都改过（11）：`public/script.js`（官方 +79/−17）、`src/endpoints/chats.js`（+112/−37）、`public/scripts/extensions/expressions/index.js`（+181/−36）、`public/scripts/group-chats.js`（+3/−2）、`public/scripts/autocomplete/AutoComplete.js`（+14/−4）、`src/endpoints/characters.js`（+6/−4）、`src/endpoints/tokenizers.js`（+11/−11）、`src/server-main.js`（+1/−0）、`public/scripts/extensions.js`（+9/−0）、`package.json`（+1/−1）、`.gitignore`（+1/−0）。

## 二、逐项对照（重点）

| # | 领域 | 官方 1.19.0 | 本实验库 | 证据 |
|---|---|---|---|---|
| 1 | 聊天搜索 | 累积全文匹配缓冲、重复扫描 | 流式 `matcher.accept`，不累积全文 | `src/chat-search.js`（本库独有） |
| 2 | 聊天异步 IO | 同步写入、永久 unlink | 异步 IO + 路径锁 + 独占创建 + 退役标记 + `.recycle` 回收 | `src/chat-io.js`、`chats.js` 改动 |
| 3 | 备份额度节流 | 按名称分割的无限 Map（旧研究记录 503 名称即 503 条目） | 按历史隔离的 SHA-256 前缀键、256 键上限、60 秒闲置回收、停机前排空 active/最新 | `src/chat-backup-scheduler.js`、`src/endpoints/backups.js` |
| 4 | 坏文件头保护 | 1.19 新增（官方修复，值得纳入） | 第 7 轮以我们自己的实现纳入，同时保留路径锁、回收与冲突下载 | `src/endpoints/chats.js` |
| 5 | 损坏尾行预览 | 1.19 新增降级列表条目 | 已有 Promise/stream 错误处理；显示补漏列为合并项 | 对比研究记录 |
| 6 | 消息深度统计 | 每条消息扫描此前全部历史 | 只统计目标之前的非系统消息；`is_system` 读取 **300,000 → 5,050（−98.3%）** | 第 7 轮文档 |
| 7 | 向量批数量 | 1.18 与 1.19 同为 `texts.map`，21 输入产出 **63** 向量 | 改为批内 `batch.map`，严格一一对应 | `src/endpoints/vectors.js`（官方两版均未碰） |
| 8 | 富文本长阻塞 | 同步构建，约 2.3 秒单次任务 | `printMessages` 后让出一次：**2307 → 1237 ms（−46.4%）**，打开 +8.3% 取舍已声明、预先设门验收 | 第 8 轮文档 |
| 9 | 加载归属 | `getChat` 响应后直接写全局 chat/metadata | 序号 + 身份校验贯穿响应应用、菜单、终结事件、延迟聚焦；取消返回 false 并传播 | 第 8 轮 `chat-load-ownership` |
| 10 | 提示词缓存竞态 | 迟到读取覆盖新缓存；关闭在读聊天保存空缓存 | 请求所有权 + 可保存状态；群聊取消失效传播到欢迎页 | 第 9 轮（官方未碰 `itemized-prompts.js`） |
| 11 | 表情 VN 判断 | 仍为 `.is(':visible')` 布局读取（1.19 第 502 行） | 私有已应用状态；布局读取 **40 → 0**，消除隐藏/无布局框误重置 | 第 11 轮 |
| 12 | 角色编辑器 | 无变化 | 单次准备：**−15.4% / −46.7%** 中位（普通/重型） | 第 10 轮 |
| 13 | 启动链 | 无运行时延迟与编译缓存 | 可选运行时延迟、webpack 编译缓存中间件、内置模板预加载 | 第 3/4 轮 |
| 14 | 最近聊天进入 | 先默认聊天再目标（双重读取） | 直接进入目标 + 归属守卫 + 版本化信息缓存（容量/TTL/并发上限） | 第 6 轮 |
| 15 | 生命周期/tokenizer | 1.19 有部分并发修复 | 初始化完成后再发布实例、冷加载合并 Promise、群组/目录守卫 | 第 2 轮 |
| 16 | UI/媒体 | 无 After Hours 主题 | 主题 + 自动补全监听释放 + 媒体滚动模块（上翻阅读保护） | 第 5 轮 |

## 三、尚未合并的官方修复（建议后续按 1.19 逐函数移植）

| 项 | 来源 | 现状 |
|---|---|---|
| 图片按日期排序（stat 4,162 → 300 次） | 1.19 `src/util.js` | 未移植（本库未改 `util.js`） |
| 世界书排序 Map 索引 | 1.19 `public/scripts/world-info.js` | 未移植 |
| `/addswipe` 局部更新（不做整聊天 reload） | 1.19 `public/scripts/slash-commands.js` | 未移植 |
| 书签分支 integrity | 1.19 `public/scripts/bookmarks.js` | 未移植 |
| BYAF 精确 Buffer 切片 / 缺失 manifest 过滤 | 1.19 `src/endpoints/characters.js` 等 | 未移植 |
| 搜索不可信 URL 网络过滤、账号 reset 限流、CORS 解压编码 | 1.19 `src/endpoints/search.js` 等 | 未移植（安全面，合并需连带 private-request-filter/server-main/search） |
| 1.19 的功能性变化（模型/供应商列表、Google 分页、tool-call 处理、世界书/角色链接等） | 1.19 全量 diff | 未合并；本库保持 1.18 行为 |

## 四、已实测数字一览（本库）

- 表达式布局读取：**40 → 0**（15 个原生夹具场景）
- 向量批输出：21 输入 **63 → 21**（本地分支，WebLLM/KoboldCPP）
- 富文本 180 条重型：最长任务 **2307 → 1237 ms（−46.4%）**，打开 +8.3%（预先声明门：任务 ≥25% 改善、打开 ≤+20%）
- 深度统计（3000 条显示最后 100 条）：`is_system` 读取 **300,000 → 5,050（−98.3%）**
- 编辑器准备：普通 **61.7 → 52.2 ms（−15.4%）**、重型 **44.1 → 23.5 ms（−46.7%）**，六对全部改善
- 备份调度压力：300 键 / 6,600 次调度 / 600 次写入，最终快照保留、同键重叠为零
- 累计安全测试：20 → 94 → 122 → 135 → 169 → 236 → 327 → 356 → 397 → 423 → **442**（Node 20/24 双版本，全部通过）
- 2026-10-09 实跑复验：末端 **442/442 ×2**、逐轮 **632 项 0 失败**、证据审计 **17,732 条摘要 0 问题**、**12,915 个受保护文件全量重扫未变**、生产 20 个文件哈希跨轮一致

## 五、诚实的边界

1. 仍有约 **1.2–1.26 秒**长富文本主线程阻塞；本轮只把它减半、未消除。
2. 数值均来自本机无 GPU headless Chrome 与合成数据的小样本中位数，**不是**用户服务器或真机结论。
3. 本库基于 **1.18.0**，与 1.19 的 11 个同名改动文件必须逐函数合并，**不要**用增量 ZIP 直接覆盖 1.19 或线上目录。
4. 官方 1.19 的部分修复（上表）尚未纳入；合并它们需要连带回归。
5. 未验证：真实模型生成、真实账号、生产 Linux、真实手机、长期高并发。

## 六、复核指引

- 逐轮验收报告：各分支 `docs/*-verification.md`
- 本库独有/未碰/双方改动清单：`docs/VERIFICATION.md` 的矩阵复现命令
- 官方源码来源与固定提交：1.19.0 = `7e8663cd9c184a550b37238218bdd32c6efc68e9`（发布页可复核）
