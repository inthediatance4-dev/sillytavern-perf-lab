# 独立酒馆文件保护与长历史实验

2026-10-08 在 `.worktrees/reliability-render`、`codex/sillytavern-reliability-render` 选择性采纳已审查的官方修复，基于上一轮交付 `cbb6208a72a01483992196e65651c733ba762adf`。继承 After Hours 主题、启动、媒体滚动、自动补全及聊天直达改进。用户已授权决策和隔离实现；部署继续需要明确授权。

## 数据和服务边界

`npm run perf:lab` 固定使用 `127.0.0.1:8776`、本 worktree 的 `.lab-data/` 和 `.lab-config.yaml`。启动器拒绝外部或经过链接的数据路径，移除继承的 `SILLYTAVERN_*` 覆盖，关闭扩展自动更新、服务器插件及自动打开浏览器。端口被占用就报错，不停止其他程序。

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
