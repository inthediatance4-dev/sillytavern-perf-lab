# codex-improvements 质量检测报告

日期：2026-10-28（Asia/Shanghai）

## 结论

**暂不建议直接合并或部署。** 新增实现中独立复现了 3 项 P1 数据保护问题、1 项 P2 关机问题。正常功能冒烟通过，不代表故障边界已经安全。

此外，旧基线已有的损坏日志导出、重新导入后不能保存聊天、重新导入与删除竞争问题仍然存在。这三项也在基线重放确认，不归因于 Grok 的 47 个提交。

检测阶段仅审查、测试和保存证据。经用户要求，本审查分支发布报告与复现材料；应用代码未修复或合并，未连接生产服务器或操作真实聊天数据。

## 审查对象与隔离

- 仓库：[inthediatance4-dev/sillytavern-perf-lab](https://github.com/inthediatance4-dev/sillytavern-perf-lab)
- 目标：`codex-improvements`，`f28a54c6e47cd1915e5838caf8d1ecae3d6ae751`。
- 基线：`codex/sillytavern-1.19-sync`，`48a153eef7411c8c6e9fa5b33bbbea74f7db892e`。
- 关系：基线落后 47 个提交，没有反向独有提交；共改动 67 个文件。
- 审查副本：`<AUDIT_WORKTREE>`，detached HEAD。
- 对照副本：`<BASELINE_WORKTREE>`，detached HEAD。
- 两份副本的受跟踪文件均未修改；`git diff --check` 通过。原有本地分支没有移动。
- 两份 `package-lock.json` 完全相同，SHA-256：`5ee4095a82d2b326e30290480b33529553cba60d2f418bc086ed3c08d874d888`。
- 新依赖安装因本机 npm 缓存错误失败，未完成的目录移入审查回收区。随后通过 junction 复用原基线同一锁文件对应的依赖，未更新依赖。

## 新增问题

### N1 · P1 · Linux 校时后可能错误抢占存活进程的数据目录锁

位置：[process-identity.js:167](../../../src/process-identity.js#L167)，判断发生于同文件 308 行。

Linux 身份由 `/proc/stat` 的 `btime` 加 `/proc/<pid>/stat` 的启动 ticks 换算成 Unix 时间，并在每个进程中分别缓存 `btime`。旧所有者缓存校时前的值，新进程读到校时后的值，二者对同一活 PID 得到不同 `processStartMs`；比较函数直接返回 `reused`，即使 `boot_id` 一致。

**复现：** 在 WSL Ubuntu 的真实 Linux 进程和真实 `/proc` 上，仅对竞争者读取的 `btime` 注入 +60 秒。PID、启动 ticks、boot_id 保持真实且不变。原所有者仍然存活，竞争者成功取得新的锁 token，且不是 `unverified` 降级结果。没有修改系统时间。

这是根据源码与读取层故障注入得到的结论，并非对真实系统改时后的部署验收。内核的 `getboottime64` 明确说明其返回值会受 `settimeofday` 影响，`/proc/stat` 用该函数生成 `btime`：[Linux 时间实现](https://raw.githubusercontent.com/torvalds/linux/v6.12/kernel/time/timekeeping.c)、[/proc/stat 实现](https://raw.githubusercontent.com/torvalds/linux/master/fs/proc/stat.c)。

建议使用不依赖墙上时钟的 `(boot_id, 原始启动 ticks)` 身份，并为旧格式设计保守兼容策略。加入同 boot、同 ticks、不同 btime 的双进程回归。

证据：`linux-clock-owner.mjs`、`linux-clock-owner.json`。

### N2 · P1 · 开启独占模式仍可能在锁检查失败后无锁启动

位置：[data-root-owner.js:705](../../../src/data-root-owner.js#L705)，`giveUp()` 返回 `unverifiedResult()`；`server-main.js` 105 行附近没有检查返回值。

锁文件创建、读取等发生 `EACCES` 或其他环境错误时，只警告并返回 `lockPath: null, unverified: true`，启动继续。某个锁文件的 ACL 不可读不代表同目录下的业务文件不可写，因此无法排除已有服务仍在写入。特别是在移除跨进程文件锁后，这会让“一个数据目录一个服务”的主要保护失效。

**复现：** 在合成目录放置真实存活 PID 的所有者记录，只向该锁文件的打开操作注入 `EACCES`。函数没有拒绝，返回了无锁降级结果，原所有者文件仍在。

文档确实披露了降级行为；本项是对这个安全设计的否决意见，不是指文档隐瞒。建议显式开启独占模式时，无法确认所有权就拒绝启动，不能默默降级。

证据：`independent-repros.json` 的 `owner-fail-open`。

### N3 · P1 · 重用退役名称的发布前崩溃窗口会丢失持久保护

位置：[chat-io.js:309](../../../src/chat-io.js#L309)，`holdRetiredPathIfAbsent()` 将有效退役标记改名为 `hold-*.json` 后，才执行异步发布操作。

异常回滚仅在 JavaScript `catch` 能运行时有效。若在移走标记之后、发布之前进程退出，重启后 `assertChatWritable()` 只查原标记路径，不检查遗留 hold；旧页面的普通自动保存能够重新创建已退役的聊天。角色创建、聊天改名等重用名称路径会使用该机制。

**复现：** 先删除并回收一份合成聊天，确认普通保存被 `retired_path` 阻止；子进程进入名称复用后在发布前退出，退出码 73。随后原进程按重启后只依赖磁盘状态的检查路径执行，旧保存通过，留下 1 个 orphan hold，原始内容仍保留在回收区。

建议在发布提交前保留有效退役事实，以令牌授权本次显式创建；或在接受普通写入前恢复/解析未提交 hold。增加真实子进程在各事务阶段退出的回归。

证据：`retired-reuse-crash.mjs`、`retired-reuse-crash.json`。

### N4 · P2 · 排空超时不等于整个关机流程有界

位置：[server-main.js:338](../../../src/server-main.js#L338)，后续进入 `chats.js` 115 行的无界 `waitForChatIO()`，以及备份 scheduler 的 flush。

`requestDrain.stop()` 超时后，关机立刻继续等待同一批可能卡住的 I/O。因而配置 30 秒并不能确保整个关机在该期限内继续完成；服务管理器仍可能强杀。

**复现：** 通过实际 persistence tracker 注册一个占用聊天路径锁的未完成写入。配置 20ms，排空约 25ms 返回，随后 `waitForChatIO()` 在额外 150ms 观察窗口仍被阻塞；释放写入后才完成。该观察窗口确认阻塞链，源码确认后续等待没有期限。

建议为整个停机链设统一期限，并明确到期时如何保留/恢复未完成写入。不能只通过强行退出掩盖数据落盘风险。

证据：`independent-repros.json` 的 `shutdown-bound`。

## 仍然存在的基线问题

以下三项已对 `48a153e` 和 `f28a54c` 分别复现，不能作为“Grok 新增回归”的数量。

| 编号 | 级别 | 问题和影响 | 位置 |
|---|---|---|---|
| E1 | P1 | 文本导出的 `line` 事件直接 `JSON.parse`，损坏行触发未捕获 `SyntaxError`。路由外围 try/catch 与请求 Promise 包装都不能捕获事件回调异常；完整应用会进入全局异常关机流程。 | `src/endpoints/chats.js:704` |
| E2 | P1 | 删除角色及聊天后重新导入同名角色，接口返回 200、角色可见且可以编辑，但聊天目录旧标记仍在，新聊天写入被 `retired_path` 拒绝。 | `src/endpoints/characters.js:1647` |
| E3 | P1 | `/import` 没有参与同一角色生命周期锁。在图像处理暂停时删除角色可返回 200；恢复导入后又重新发布该角色，删除结果被反转。 | `src/endpoints/characters.js:1670` |

建议分别补齐导出流/解析错误处理和响应单次结算；将导入、重导入、复制等角色发布路径纳入同一生命周期事务，并正确处理退役标记。新增的四类编辑锁并未覆盖 `/import`。

证据：`independent-repros.json`、`baseline-independent-repros.json`。导出子进程在捕获到全局异常后以 70 退出用于记录，不是声称应用原本会返回退出码 70。

## 其他质量问题与边界

### Q1 · P2 · 嵌套共享锁仍有死锁组合

`withPathLocks()` 允许共享到共享的嵌套。外层持有目录共享锁时，另一个调用排入目录独占锁；外层再请求同目录另一文件，会把新的共享请求排在独占请求后。独占请求等外层释放，外层等内层完成，构成环。

已复现该锁 API 死锁，但同类嵌套在旧队列也会卡住，因此不标成新回归。**本轮没有证明当前 HTTP 路由能够触发该组合**，不将它升级为线上必现 P1。建议明确禁止这类嵌套，或复用外层共享所有权，并增加排队写者场景。

位置：`src/chat-io.js:180`。证据：两个版本的 `nested-shared`。

### Q2 · P2 · Windows 测试策略和默认测试登记需要修正

新增所有者测试把近似 `win-boot` 也算作可比较身份；可靠 PowerShell 启动时间缺失时，却仍要求回收。这和实现中“近似 Windows 启动时间不能授权回收”的安全策略相矛盾。本机三个回收断言失败是这种情况，不能据此要求削弱实现的保守策略。

另有六项测试在建立符号链接时因 Windows 权限得到 `EPERM`，尚未运行到安全断言。应明确检查运行能力并记录跳过原因，或在具有权限的独立 Windows 环境完成；不能当作已验证通过。

`tests/process-identity.test.mjs` 未登记到 `npm run test:perf`，已手工补跑 6/6 通过。建议纳入默认入口。

### 回收容量选项

`maxRecycleBytes` 默认是 `-1`，即无限保留。设为非负数时，会永久清除备份 `.recycle` 中的旧文件。用户要求保留回收内容的环境不应直接开启此项。测试执行时已用审查保护层将删除改为移入独立回收区；本轮没有对真实备份启用该选项。

## 验证结果

| 检查 | 结果 | 说明 |
|---|---|---|
| 基线 Windows Node 24.15.0 全套 | 442/442 通过，0 跳过 | 新建独立对照副本，同一依赖和回收保护层 |
| 新版 Windows Node 24.15.0 全套 | 514 通过 / 523，总计 9 失败、0 跳过 | 六项符号链接权限、三项缺失可靠 Windows 身份时的预期 |
| 身份专项，Windows | 6/6 通过 | 默认套件未包含，手工补跑 |
| 新版 WSL Ubuntu Node 24.14.1 全套 | 471 通过 / 522，3 失败、48 跳过 | 见下方限制，不能作为 Linux 原生验收通过 |
| WSL 串行定向复查 | 109 通过 / 157，2 失败、46 跳过 | 复查生命周期、所有者、启动失败及历史对照等 |
| 独立故障复现 | 8 个场景复现异常 | 六个通用场景，加 Linux 校时和退役复用崩溃 |
| 完整应用 HTTP 冒烟 | 8/8 通过，正常退出码 0 | 真实应用启动约 14.7 秒，合成角色/聊天，随机 localhost 端口 |
| `npm run lint` | 通过 | 规则以解析和少量选定规则为主，并非完整推荐规则集 |
| `git diff --check` | 通过 | 对整个 47 提交差异检查 |
| 内置基准 | 执行成功 | 对照的是 `db53872`，不是 `48a153e`，不能把差异归功于这次 47 个提交 |

WSL 测试直接访问 Windows 工作树和依赖。历史 Git oracle 在该访问方式下不可用，导致跳过；若干子进程导入/完整启动达到既有 10/45 秒期限，所有者回收竞争的清理标记断言也出现失败。串行复查后仍有失败；未把这些结果简单归咎为产品回归，也未声称 Linux 全套通过。Linux 校时复现独立于这些集成环境问题，使用实际 Linux 进程和 /proc，读取层注入事实已单独记录。

内置基准中 10MiB 合成写入的总耗时约 20.80ms，对照约 19.29ms；计时器响应约 0.57ms 对 19.44ms，说明该样本中异步写入减小主循环阻塞。搜索、备份扫描的结果也已保留，但基线不同、部分文件系统接口为 mock，单次样本不能证明新分支比 1.19 同步基线更快。

## 方法限制

- 为遵守删除需回收的要求，Node 文件删除接口经审查保护层改为可恢复重命名，并记录原路径。受测源文件未改，但这属于带保护层测试，不能冒充完全未经干预的原生验收。
- 完整应用测试覆盖 HTTP 与持久化链；未完成浏览器实际界面、手机布局、扩展组合或真实模型生成验收。
- 未在 Node 20 上补跑；本机 Windows 与 WSL 的 Node 小版本不同。
- 不访问生产服务器、真实角色卡、聊天或 API 密钥；未部署或合并；本分支只发布审查材料。
- 正常路径通过不抵消故障场景；没有发现问题的部分也不等于已证明没有缺陷。

## 建议处理顺序

1. 先修 N1、N2、N3，保住单实例所有权与崩溃后的退役保护。
2. 补齐 E1、E2、E3；这些是旧问题，但用户存档路径仍然受影响。
3. 完成整个关机链的期限与恢复策略，处理 Q1；修正 Windows 测试前提并登记身份专项。
4. 在独立修复分支重跑 Node 20/24、Windows/Linux 完整测试，再做浏览器合成数据验收。
5. 验收通过后再考虑合并；上线仍需针对真实部署配置核对备份与回滚方案。

## 已发布的复现材料

- [README.md](README.md)：给 Grok bot 的入口与运行方式。
- [findings.json](findings.json)：结构化问题与原始测试数量。
- [independent-repros.mjs](independent-repros.mjs)：六个通用异常场景。
- [linux-clock-owner.mjs](linux-clock-owner.mjs)：Linux 存活锁误回收。
- [retired-reuse-crash.mjs](retired-reuse-crash.mjs)：名称复用发布前崩溃。
- [evidence/](evidence/)：脱敏后的历史复现结果、测试日志、完整应用 HTTP 冒烟摘要。
- [evidence/publish-validation/](evidence/publish-validation/)：相对路径脚本在提交前的重跑结果。

记录中的本机目录和主机名已替换为占位符。原始大型夹具、回收内容、应用运行配置、依赖目录、恢复日志及原始压缩包没有上传。可移植脚本的输出另存系统临时目录，不修改本报告的历史记录。
