# 当前入口（2026-10-25）

当前分支为 **`codex-improvements`**；`codex/sillytavern-1.19-sync` 是历史集成基线，
后文各候选分支、端口和验收数字是带日期的历史记录。以本节和
[README.md](README.md) / [README.zh-CN.md](README.zh-CN.md) 为当前运行说明。

在已安装依赖的仓库根目录，使用 Node.js 20 或更高版本：

```sh
npm run test:perf
npm run lint
npm run perf:lab
```

启动器固定使用 `127.0.0.1:8780`、当前检出的 `.lab-data/` 与 `.lab-config.yaml`。
即使配置已存在，每次启动也会重新强制隔离设置：本地 IPv4、关闭 SSL、自动打开浏览器、
扩展自动更新与服务器插件。移除继承的 `SILLYTAVERN_*` 环境覆盖，拒绝经过符号链接的数据或配置路径，
端口占用即报错。

浏览器验收脚本 `tests/browser-performance-lab.py` 与 `tests/browser-lifecycle-lab.py`
默认访问该隔离启动器，而不是旧的 8771 端口。`LAB_URL` 或 `LAB_ORIGIN`、
`LAB_BROWSER_EXECUTABLE`、`LAB_EVIDENCE_DIR` 可覆盖地址、浏览器和证据目录；
未设置浏览器路径时使用 Playwright 自带 Chromium，证据默认在仓库 `.evidence/browser/`。
页面没有单独的实验室标记，脚本只在标题为 SillyTavern 且地址属于配置源时才写入人工数据。
需要已安装的 Python Playwright 与 Chromium。本文件不记录新的浏览器或真实生成验收结论。

Current verification：[round-1.5 CI run 40656640441](https://github.com/inthediatance4-dev/sillytavern-perf-lab/actions/runs/40656640441)，
提交 `7a0b029`，Node 20/24 × Ubuntu/Windows 全绿。Ubuntu：591 tests / 590 pass / 1 skip；
Windows：591 tests / 578 pass / 13 skip，均有明确跳过原因。
Windows CreationTime 回收尚未实际走通，仅验证保守拒绝；Windows 无真实服务器 SIGTERM e2e。
部署仍待浏览器验收、Windows 实机验收和崩溃对账。
`npm run lint` 使用根 ESLint 配置：全项目语法检查，实验模块、脚本和测试启用部分规则。
下文“没有完整 ESLint 配置”和 442/442 等陈述仅描述当时状态。

## 恢复与运行限制

进程内共享/独占路径锁使用队列，只协调本进程。普通文件操作共享父目录、独占文件；目录操作独占目录，后来的共享请求不能抢先。路径预留不创建跨进程锁文件。嵌套调用不能等待已独占的键或把共享升级为独占；备份等待来源预留及其外层预留完成，不等待无关锁。并发服务器共用同一数据根不受支持，应对每个服务器启用 `exclusiveDataRoot`，由数据根所有权锁阻止第二个协作进程启动。关闭排空只协调本进程。
实验室启动器设置 `exclusiveDataRoot`，并传入 `--exclusiveDataRoot true`。服务器创建 `<dataRoot>/.st-lab-owner.lock`，写入 pid、主机名、启动时间、随机 token，以及能读到的启动标识和进程启动时间。Linux 使用 `/proc/sys/kernel/random/boot_id` 和 `/proc/<pid>/stat` 的 starttime（配合 `/proc/stat` 的 `btime`）。Windows 的近似启动时间不作为回收仍存活 PID 的依据。仅缓存本进程的启动时间，外部 PID 每次重新探测。Windows 写入由 `os.uptime()` 近似得到的 `win-boot:` 时间（相差 120 秒内视为同一次启动）。双方都有 `processStartMs` 时以它为准：相同则仍视为存活，即使 `bootId` 不同；不同则视为复用，即使启动戳相同。只有双方都没有进程启动时间时才比较精确的 Linux 启动标识；只有一侧有则保持存活。两次本地采样相隔超过 2 秒且落在 120 秒窗口之外时，之后的记录省略不稳定的 `bootId`，仍保留 pid、token 和 `processStartMs`。进程启动时间只在 PowerShell 能在 200ms 内返回时写入，否则省略；此时同一次启动内的 pid 复用无法区分，缺少身份字段且 pid 仍存活的锁会保留。`process.kill(pid, 0)` 报存活（含 `EPERM`）且身份一致时，第二个进程拒绝启动。身份不一致视为 pid 复用。已退出的同一主机所有者，或被复用的 pid，由恰好一个进程回收：它用 `O_EXCL` 创建同目录的 `.st-lab-owner.lock.reclaim`，把过期锁文件原子改名到唯一路径，核对内容后才删除，再用 `O_EXCL` 创建新锁。回收标记按年龄过期，崩溃的回收者不会永久挡住下次启动。其他主机的锁、符号链接和无法读取的文件都留在原地，需要人工删除。正常退出、`process.exit` 和未捕获异常只会删除内容仍与本次写入一致的锁。`SIGKILL` 等信号不运行退出处理，文件可能留下，同一主机上的下次获取会回收它。不需要编译器或 Node 头文件。如果意外的文件系统错误让所有权无法判断，启动会记录警告并继续；这不是存活所有者冲突。未打开该标志的进程仍可共用同一个数据根。外部写入、插件后台任务和外部文件系统替换不在此保证内。
关闭会先停止接纳请求，再等待已接纳的响应和持久化处理器。
请求、chat I/O 和备份共用 `SILLYTAVERN_DRAIN_TIMEOUT_MS`（默认 30 秒）的关键阶段期限；失败或超时立即报告 pending paths，退出码保持非零。随后统计、插件、缓存仍按顺序各获独立的 1000ms 尽力执行预算（`NONCRITICAL_STAGE_BUDGET_MS`），使用 AbortSignal 和 waitForShutdown。非关键阶段失败或超时也记录阶段名并返回非零，以便发现未完成的清理。总异步等待上限为关键期限 + 3 × 1 秒（另加运行时退出开销）；不强杀卡住的操作，不取消底层文件操作或提前释放锁。同步阻塞无法由 AbortSignal 抢占。Node 24 的原生退出耗时继续作为观察项。
隔离启动器会去掉继承的 `SILLYTAVERN_*` 变量，因此实验室进程使用该默认值。同步路由若返回 Promise，与 async 路由一样被跟踪，停止后返回 503。

删除、重命名和备份清理将文件保留在相应根目录的 `.recycle/`；
`.chat-lifecycle/` 保存路径退休标记。普通保存和读取仍会因 `retired_path` 冲突，刷新不会把旧文件放回原处。
刻意新建，以及改名的目标路径，在调用方已持有路径锁时：若可见路径已经不存在，则先挪开该路径自己的退休标记；发布成功后才把标记移入 `.recycle/`。失败且可见路径仍不存在时，标记会放回原处。可见路径仍在时保持原来的 `target_exists` / 可写语义。父目录标记不会被这次复用清掉，符号链接和越界检查不变。
恢复前停止该数据根目录的所有写入，先保留整份数据副本；从 `.recycle/` 找到对应文件或目录，
检查原路径及目标是否冲突，再恢复文件。还必须检查 `.chat-lifecycle/*.json` 的 `relative_path`，
将阻止该文件或父目录的匹配退休标记移到单独的恢复存档；仅复制字节不能解除退休。
目录重命名还可能有继承的子历史标记，需逐项核对。没有自动恢复 API，不要批量清空标记。
`backups.common.numberOfBackups` 只限制可见备份个数，不是磁盘上限。过期备份进入备份目录的 `.recycle/`。
`backups.chat.maxRecycleBytes` 默认 `-1`（不自动删除）。设为非负字节数后，只清理该 `.recycle/` 里最旧的回收件，直到不超过预算；主聊天文件和仍可见的备份不会被删除。
聊天信息缓存基于文件元数据，是新鲜度启发式，不保证识别外部保留全部身份元数据的原地修改。

## CHANGES

近期加入角色编辑生命周期锁、关闭时请求与处理器排空、群聊历史路径校验，以及每次启动强制隔离配置。
本次补充角色发布失败的错误响应和锁释放验证、浏览器结构化克隆的安全 JSON 回退，以及历史源码缺失跳过。
角色合并（含批量）仍经 `withCharacterEdit`。普通文件操作对父目录取共享锁、对文件取独占锁，因此同一目录中的不同群聊可以并行。目录退役、重命名、删除和备份清理对目录取独占锁，并挡住其后到来的共享请求。改名仍在一次 `withPathLocks` 中占用相关卡片和聊天目录锁。
可选的数据根所有权锁只阻止第二个打开了 `exclusiveDataRoot` 的进程共用该目录，不替代上面的进程内路径锁。
刻意新建和改名目标可以复用已经不存在的退休名称；标记在发布成功后才回收，失败且路径仍不存在时会放回。普通保存不能借此复活仍处于退休状态的路径。

---

以下为历史实验记录；其中交付、提交和验收步骤不代表本次操作。

# 独立酒馆文件保护与长历史实验

2026-10-08 在 `.worktrees/reliability-render`、`codex/sillytavern-reliability-render` 选择性采纳已审查的官方修复，基于上一轮交付 `cbb6208a72a01483992196e65651c733ba762adf`。继承 After Hours 主题、启动、媒体滚动、自动补全及聊天直达改进。用户已授权决策和隔离实现；部署继续需要明确授权。

## 数据和服务边界

`npm run perf:lab` 固定使用 `127.0.0.1:8780`、本 worktree 的 `.lab-data/` 和 `.lab-config.yaml`。启动器拒绝外部或经过链接的数据路径，移除继承的 `SILLYTAVERN_*` 覆盖，关闭扩展自动更新、服务器插件及自动打开浏览器。端口被占用就报错，不停止其他程序。

本轮不访问生产服务器，不读取真实聊天正文、密钥或用户模型，没有部署、重启、合并或推送。`node_modules` junction 只读复用旧实验依赖，不安装或升级。Node 20 的便携验证运行时保存在 F 盘证据目录，已比对官方下载校验值。所有角色、180/600/3000 条消息及后端文件夹具均为人工内容。

浏览器采用新的 Chrome 临时上下文，阻断外部浏览器请求，不使用用户浏览器资料，不调用生成模型。原始成功及失败日志均保留。CPU 降速模拟和无 GPU 的 headless 环境没有真实手机帧率验收效力。

## 本轮改进

1. 非空异常文件头拒绝普通完整性保存；BOM 后比较真实 integrity。截断尾行的历史保留降级预览。force 或不提供 slug 的请求仍保留原有行为。
2. 按用户与具体历史路径隔离备份节流和配额。最多保留 256 个节流状态，访问时回收闲置状态；淘汰前排空 active/latest 数据。忙碌溢出键只在写入期间保留状态，也参与正常关闭 flush。此上限不是所有并发 IO 或总内存的硬上限。
3. 备份浏览器删除持有目录和文件锁，将字节移入备份目录的 `.recycle`。原有备份不迁移，仍能浏览和下载；配置的全局配额仍可将旧备份回收。
4. 长历史格式化的正则深度计算减少重复扫描；保持正则、Markdown、事件及 DOM 契约。向量批处理限定当前批，修正两个本地后端输出数量。

UI 配置和第三方扩展未修改。交付基于隔离分支，不可将增量 ZIP 当作官方 1.19 或直接覆盖生产；完整源码和历史由独立 Git bundle 提供。

## 验证和交付

完整结果、测试数量和范围见 `docs/2026-10-08-reliability-render-verification.md`；原始日志、浏览器结果、人工数据、原始 `.bak` 和交付文件在 `F:\SillyTavern-Research\2026-10-08-reliability-render`。没有实际执行的验证不列为通过。

保护主仓库及六个旧 worktree 共 8,139 份跟踪文件，核对 HEAD、Git 状态和 SHA-256；八份原始源码 `.bak` 已校验。人工聊天消息正文、姓名、发送时间、顺序、数量和 integrity 需保留；表格扩展会修改 `chat_metadata`、`hash_sheets`，不以完整 JSON 不变作为契约。测试夹具、备份与诊断证据保留，删除或移走内容必须送回收站。

暂存和交付只包含白名单源码、测试及说明，排除配置、运行数据、学习模型、依赖、浏览器缓存和结果。完成暂存清单、敏感值初筛、`git diff --cached --check` 后本地提交。增量 ZIP、差异与完整 Git bundle 需实际恢复并核对字节。

## 保留的问题

未进行真实账号/最新生产扩展组合、真实生成、生产 Linux UI、手机设备或长期运行验收。移动模拟数值波动较大且部分退聊天结果更慢，没有作为速度收益结论。长消息仍有主线程长任务，群聊入口及现有 getChat 在途响应应用竞态未改。离线第三方更新失败、声音 404 和缩略图 WASM 路径限制保留。没有完整 ESLint 配置，未宣称全仓库 lint 通过。

此前启动优化见 `docs/2026-10-07-frontend-startup-verification.md`，生命周期与备份边界见 `docs/2026-10-05-lifecycle-verification.md`。本轮没有改变这些问题的部署和跨进程限制。

## Richtext Flow isolated candidate (2026-10-08)

The `codex/sillytavern-richtext-flow` candidate retains atomic message construction and adds one browser task boundary after `printMessages` only when the displayed character messages contain at least 250,000 text characters. It counts only the truncated visible range, stops at the threshold, and leaves general `redisplayChat` unchanged. This is a responsiveness candidate; total load latency and longest blocking time require separate browser measurement.

Each character load owns a serial plus character/avatar, group, filename and metadata identity. `clearChat` invalidates before its first await; same-file loads supersede older serials. Guards stop stale response application, rendering continuation, menu selection, terminal events, delayed focus, retries and outer character persistence. Awaited extension events may legitimately replace metadata; after those events, serial and selection remain authoritative before the metadata reference is refreshed. Successful public `getChat` calls retain their void return, while superseded calls return false for callers to propagate.

Synthetic Node source-function tests cover these boundaries and existing transitions. Browser acceptance, artifact recovery and protected-workspace hash verification are performed separately by the root agent. No production access or deployment is authorized. Evidence and `.bak` files remain in `F:\SillyTavern-Research\2026-10-08-richtext-flow`, outside Git.

## Prompt cache isolation candidate (2026-10-08)

The `codex/sillytavern-prompt-isolation` worktree reserves prompt ownership synchronously when character or group loading starts. Delayed storage results and errors cannot replace a newer cache or emit a stale loaded event. Character loading reserves before the fresh greeting save; group loading checks its selection, filename and reservation before starting the prompt read. Canceled prompt reads return false and stop the callers before rendering continuation. Successful legacy calls keep their void return and existing event payloads.

An unread or failed prompt cache is unavailable for persistence, including when closing a pending load. A successful read of a missing record creates a ready empty cache; a successful retry restores persistence. Ready caches retain bookmark save-as behavior, and a save already started keeps its original rows and filename across newer loads. Closing invalidates pending reads before awaiting persistence, and only clears the cache and chat model if the clear still owns them afterward. Loaded-event listener failure retains successfully read data.

Clearing an addressed chat leaves the empty cache unavailable until a successful load. This preserves its stored inspection prompts when native new-chat workflows intentionally clear twice before changing the old chat filename. A no-id load or a clear with no current chat explicitly creates a ready neutral empty cache; repeated clears do not turn an addressed, unread or failed cache into a saveable empty record.

After a storage read failure, newly generated inspection entries may remain unpersisted until a successful reload. This deliberately preserves the existing stored record; generated pushes do not silently change unavailable state to ready. Already-running extension listeners cannot be aborted, and unrelated generation or explicit storage-deletion races remain outside this change. Rendering scheduling and richtext formatting are unchanged; this fix makes no CPU or performance improvement claim.

The safe `test:perf` suite includes actual prompt-module state tests with synthetic deferred storage and events plus character/group/clear integration. Root acceptance separately runs browser IndexedDB contracts, full Node 20/24 suites, protected-workspace hashes and artifact restoration. This candidate uses only synthetic localhost `127.0.0.1:8778` data. Original `.bak` files, RED/GREEN logs and browser evidence are retained outside Git in `F:\SillyTavern-Research\2026-10-08-prompt-isolation`; no production access, deployment, service restart or dependency installation is authorized.


### Native recent-group cancellation follow-up (2026-10-09)

The bounded follow-up propagates `getGroupChat` cancellation through `openGroupById` before the welcome recent-group action can activate, save settings or open history and clear HOME again. An internal group-open serial also stops old entries waiting in `clearChat` after a reset/newer group entry; target object, file and metadata are checked before selection. Group loading rechecks prompt reservation, selection, group object and filename after rendering and terminal events before reporting success. Normal extension metadata replacement is compatible.

The welcome recent-group action uses an entry serial plus original group/file identity and live saving/generation guards. The legacy `openGroupById` false return for an already-selected group remains unchanged and still permits opening that group's other recent history. Matching group ID alone is insufficient to continue an old entry. No new public API or rendering scheduling is introduced.

The additional actual-source tests show 10 assertion failures on old behavior (41 tests total, 31 pass, no cancellations/timeouts) in `task2-red.log`, then all 159 targeted prompt/chat/media/frontend tests pass in `task2-green.log`. Early aborted/harness-timeout diagnostic runs are retained separately and are not RED evidence. Root browser/full Node 20/24 acceptance and independent review remain separate. The baseline registry now has 12 original `.bak` files. This boundary fix does not make every in-flight group greeting/render/extension operation atomic or undo side effects already performed inside those operations; unrelated direct history/generation/delete races remain outside scope.

## Character editor single-pass candidate (2026-10-09)

The isolated `codex/sillytavern-character-editor-flow` candidate skips unrelated creation-draft fields, creator-note formatting, world/favorite helpers and transient chrome changes when opening an existing character. The private preparation option defaults to full draft restoration for ordinary creation. Selection retains inherited control resets, menu transitions, group peeking, media/source state and the existing terminal editor event followed by settings persistence. The existing draft-avatar/FileList restoration and asynchronous avatar path are preserved without changing avatar lifecycle behavior. Message formatting, rendering, prompt ownership and scheduling are unchanged.

The safe suite includes a stateful DOM adapter executing actual editor/create functions and unchanged world, favorite, creator-note, source, media and avatar helpers. Final state is independently compared with the immutable base, including optional fields, creation return, group peeking, switchMenu false, media overrides and avatar crop outcomes. `CHARACTER_EDITOR_BASELINE` accepts an external original `.bak`; otherwise the test reads the immutable Git ancestor. `CHARACTER_EDITOR_SOURCE` can replay the original source for RED evidence. The adapter checks formatting/sanitization calls and DOM write contracts; it does not reproduce native layout, DOMPurify internals or timing.

Evidence and original `.bak` files stay outside Git in `F:\SillyTavern-Research\2026-10-09-character-editor-flow`. The final original-source RED run has 26 tests, 20 pass and 6 expected work-reduction assertion failures, with no cancellations or skipped tests. Native browser contracts, matched timing, full Node 20/24 suites, protected-workspace hashes and actual artifact restoration are separate root acceptance steps. This candidate alone makes no measured speedup claim. It uses only synthetic localhost port 8779; no production access, deployment, restart, dependency installation or permanent deletion is authorized.

## Expression mode flow candidate (2026-10-09)

The isolated `codex/sillytavern-expression-mode-flow` candidate remembers the last visual-novel mode applied by the expressions worker. Initial state is false, matching its initially hidden wrapper. Each active worker still enforces both wrapper display styles; the private state advances synchronously before sprite validation awaits. Stable VN mode preserves sprites and drag geometry even when no layout boxes or a CSS-hidden ancestor make the wrapper fail jQuery :visible. Genuine desktop/mobile, group/single or waifu-mode transitions retain one message invalidation, sprite clear and holder-style reset. Home returns before applying a mode, preserving the last applied state. Explicit message invalidation, CHAT_CHANGED clearing, newChat refresh, classification and offline connectivity visibility behavior remain unchanged.

The safe `test:perf` suite executes the complete actual expressions module, including private state and worker, with import/export syntax removed for a Node VM. Tests use synthetic context and a stateful display/write adapter, sprite validation/rendering seams and the actual none-API classification path. The no-layout-box case supplies synthetic :visible=false, representing zero offsets and no client rects; the adapter does not compute native geometry. Width/height zero alone may still satisfy native jQuery :visible when a client rect exists. The actual CHAT_CHANGED callback is evaluated separately without browser initialization. An immutable Git blob at `0b2bdbc9d17433b191f921b5a946772c7676dc2f` provides independent normal-geometry behavior comparison and original-source RED replay via `EXPRESSION_MODE_SOURCE=baseline`. Native layout, real sprite validation/network requests, in-flight classification ownership and extension initialization are outside this adapter's scope; browser and complete application acceptance are separate root checks.

Original-source RED has 19 tests: 10 pass and 9 expected geometry/transition assertions fail, with no cancellations or skipped tests. Evidence and original `.bak` files remain outside Git in `F:\SillyTavern-Research\2026-10-09-expression-mode-flow`. This worktree uses only synthetic localhost `127.0.0.1:8780`, its own `.lab-data/` and `.lab-config.yaml`; no production access, deployment, restart, dependency installation or permanent deletion is authorized. The change does not remove painting layout or other visibility checks and makes no measured speedup or phone-performance claim.

## 1.19.0 同步分支（2026-10-09）

The isolated `codex/sillytavern-1.19-sync` branch merges official SillyTavern 1.19.0 into this lab on top of the 1.18-based rounds. 62 upstream-changed files applied cleanly, five conflicts were resolved semantically (lab async IO/locks/recycle/backup-isolation kept; upstream resilience and hooks adopted), and two upstream application modules were imported. Safe suites pass 442/442 on Node 20.20.2 and Node 24.15.0. Browser-level re-acceptance on the new base is pending; see `docs/2026-10-09-sillytavern-1.19-sync.md`.

## Legacy hold-*.json recovery

启动遇到遗留 `hold-*.json` 损坏或路径校验失败会拒绝继续，错误包含文件路径和原因。
先停止使用该数据根的所有进程和外部写入，备份整个数据根（包括隐藏目录）。
逐个检查报错文件及其所属生命周期根：`chats/`、`characters/`、`group chats/`。
`relative_path` 必须是该根内的非空相对路径，不含 `..`、保留目录或符号链接；
不要根据文件名猜测目标，也不要把根外文件复制进来。
从备份、对应退休记录和 `.recycle/` 内容确认原目标。若能确认目标且目标不存在，
人工修正该文件的 JSON 和 `relative_path`，保留其他字段，再重启让现有迁移恢复退休标记。
若目标或对应退休标记已存在，先核对并归档冲突证据，人工决定保留哪份数据及退休保护。
无法确认目标时保持停机，先查备份；确认不再需要该 hold 后才将这一份文件移到数据根外的恢复存档。
不要批量删除 `.chat-lifecycle/`、hold 文件或退休标记；没有自动恢复 API。

### Owner record v2 and rollback

V2 owner records contain `v: 2`, `pid`, `hostname`, `startedAt`, a random
`token`, and available identity fields. Linux writes `bootId` and raw
`startTicks`; it no longer writes `processStartMs`. Windows still writes
`processStartMs` when CreationTime probing succeeds, and may write `bootId`.
Other platforms omit unavailable fields.

At rollback target `6f6c825`, the owner parser accepts unknown fields: it
ignores `v` and `startTicks`, rather than rejecting v2. A different hostname
is refused; a dead PID (ESRCH) is reclaimable. For a live or EPERM PID, old
code compares `processStartMs` when both sides have it (equal refuses,
different reclaims); a start time on only one side refuses. Thus a Linux v2
record without `processStartMs` is refused when the old Linux probe obtains
one, including if that PID has been reused. If neither side has a start
time, differing exact non-Windows boot IDs permit reclaim; missing or
matching boot IDs refuse. Approximate `win-boot:` differences never suffice.
Windows v2 records retain the old CreationTime comparison behavior. Unknown
liveness or unreadable identity fails closed. Stop the current owner before
rollback; if a stale record still refuses startup, verify the owner process
is really gone, then manually delete the reported `.st-lab-owner.lock` path.
Never remove that file while its owner is running.

### Startup lifecycle reconciliation

With exclusive data-root ownership held, startup restores legacy holds and scans
`chats/`, `characters/`, and `group chats/` before migrations and serving requests.
Explicit retired-path publication atomically rewrites the same marker with
`intent: "publish"`, preserving its fields; the marker remains until publication
commits. With a previously absent target, startup moves the marker to `.recycle/`
if the target is now visible, or removes only the intent fields if it is absent.
New deletes write explicit `intent: "delete"` before moving their target; exclusive startup completes interrupted deletes by moving the visible target into `.recycle/`.
A plain marker with a visible target stays protected and logs a manual-handling
warning: automatically completing a directory deletion could move unrelated
contents, so reconciliation preserves this ambiguous evidence. Publication that
started with existing visible evidence (`publish_visible_before: true`) likewise
requires manual handling rather than treating old data as proof of completion.

Chat, character-card, and retirement-marker atomic writes now stage in reserved `.chat-staging/` directories using
UUID v4 names. Startup moves UUID entries and their write-file-atomic decimal
suffix temps, plus legacy hash-named marker temps in `.chat-lifecycle/`, into
the lifecycle root's `.recycle/`, logging each move; nested
recycle directories are never scanned. Ambiguous legacy `filename.NUMBER` files
outside staging are reported, not moved, because user files can have those names.
Other staging filenames are untouched. No marker is permanently deleted, and no
recovery API or bulk marker cleanup is provided. Without exclusive ownership the
pre-existing legacy hold migration keeps its behavior, then a read-only
`scanLifecycle` pass logs finding counts by kind and integrity-check guidance;
no reconciliation writes run. The read-only `scanLifecycle` classification is
separate from startup's `applyReconciliation` mutations; a quiescent root gives a consistent scan, and mutations are for startup under ownership only.

### Read-only integrity check

Stop the server to obtain a consistent offline view, then run
`npm run check:integrity -- --data-root <dir>` (add `--json` for machine output;
use `node scripts/check-integrity.mjs` directly to avoid npm's banner).
The command reads the same user storage keys and chats, characters and group-chat
roots as startup. It reports malformed JSONL rows with physical line numbers,
legacy holds, marker/visible-file conflicts with intent state, recognized orphan
staging/temp files, and recycled bytes/file counts per root. Recycled contents
are counted rather than parsed. Nonempty recycle usage counts as a finding.
Exit codes: 0 clean, 1 findings, 2 usage or I/O/metadata errors.
It changes nothing: no directories, ownership locks, recovery, or cleanup are
created or performed. Reads can update filesystem access times; a running writer
can change the data during this unlocked inspection.

### Deployment prerequisites and manual triage

**Deployment prerequisite:** the deployment configuration must enable
`exclusiveDataRoot: true`. Without it, startup only runs legacy hold migration
plus the read-only `scanLifecycle`, logs the number of findings by kind, and
suggests `npm run check:integrity -- --data-root <dir>` and exclusive mode; no
reconciliation writes run. `check:integrity` warns when the data root has a live
owner: results may then include in-flight writes.

**Legacy marker without intent and a visible target** (only markers created
before this upgrade; new deletes write `intent: "delete"` and new publications
`intent: "publish"`):

1. Stop the server and back up the whole data root, including hidden
   directories (`.chat-lifecycle/`, `.chat-staging/`, `.recycle/`).
2. Read the marker JSON: `relative_path`, `reason`, `retired_at`, `token`,
   `version` and any publish fields. Match it to the visible path through
   `relative_path` (the marker name is a hash), not by file name alone.
3. Compare the visible target's content and mtime with `retired_at`, and look
   for the matching copy and timestamps under `.recycle/`.
4. Decide:
   - Delete did not finish (`reason` is a delete, target unchanged since before
     `retired_at`, no later edits): move the visible target into its own
     container under `.recycle/` and keep the marker.
   - Marker is left over from a finished publication/re-import (target written
     after `retired_at`, or content newer than the recycled copy): move only that
     marker file into `.recycle/` and keep the visible target.
   - Unsure: keep all evidence and leave the server stopped. Never `rm` and never
     bulk-clean markers.
5. Run `npm run check:integrity` again before starting the server.

**Rollback/upgrade note:** Windows `processStartMs` rounding changed from
floating point to BigInt. An owner process started by the older build that is
still running can differ by 1 ms, which causes a refusal (the safe direction).
Stop the old process before starting the new build, in either direction.
