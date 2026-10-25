# SillyTavern 性能实验室

这是基于 SillyTavern 1.19.0 的研究分支，包含聊天可靠性、生命周期、启动和前端实验。
当前入口是 **`codex-improvements`**；`codex/sillytavern-1.19-sync` 是较早的集成基线。
其他候选分支和带日期的验收记录属于历史实验，本分支不是生产发行版。

安装项目依赖后，使用 Node.js 20 或更高版本，在仓库根目录运行：

```sh
npm run test:perf
npm run lint
npm run perf:lab
```

`test:perf` 包含 29 个测试文件，使用人工夹具，部分测试需要监听本地端口。
三个依赖独立历史源码的测试套件在 Git 或历史对象缺失时跳过；完整历史检出可启用这些比较。
`bench:perf` 仍要求历史 Git 对象。`lint` 检查项目源码语法，并对实验模块、脚本和测试启用部分规则，
并非完整的 recommended 规则检查。

`perf:lab` 固定运行于 **http://127.0.0.1:8780/**，数据和配置位于当前检出的
`.lab-data/`、`.lab-config.yaml`。每次启动都强制本地 IPv4、关闭 SSL、自动打开浏览器、
扩展自动更新和服务器插件，并移除继承的 `SILLYTAVERN_*` 环境覆盖。端口占用时直接报错。
仅使用人工数据，同一个数据根目录只运行一个服务器进程。

`python tests/browser-performance-lab.py` 与 `python tests/browser-lifecycle-lab.py`
默认访问同一地址。可用 `LAB_URL` 或 `LAB_ORIGIN`、`LAB_BROWSER_EXECUTABLE`、
`LAB_EVIDENCE_DIR` 覆盖。未设置浏览器路径时使用 Playwright 自带 Chromium。
证据默认写到仓库 `.evidence/browser/`。页面没有单独的实验室标记；脚本核对
SillyTavern 标题和源地址后再创建人工数据。运行前需要安装 Playwright 及 Chromium
（`playwright install chromium`）。

2026-10-25 在 Node 20.19.2 下，无需套接字的 `node --test` 选择报告 **20 项通过**；
此沙箱的输出每个文件计一项，不代表完整套件的独立用例数或浏览器验收。
完整运行报告 28 个文件项：20 通过，8 个需要本地监听权限的套件因沙箱限制失败。
旧的 442/442 是带日期的 1.19 同步验收记录。
隔离、恢复和限制见 [ISOLATION.md](ISOLATION.md)，英文说明见 [README.md](README.md)。

## CHANGES

近期修复覆盖角色编辑生命周期锁、关闭期间的请求与处理器排空、群聊历史路径校验，
以及每次启动时的隔离配置强制检查。关闭排空现在也会跟踪返回 Promise 的同步处理器，
并在 `SILLYTAVERN_DRAIN_TIMEOUT_MS`（默认 30 秒）后停止等待并继续关闭。
`numberOfBackups` 只限制可见备份个数；`backups.chat.maxRecycleBytes`（默认 `-1`，不限制）
可清理备份目录 `.recycle/` 中最旧的回收件。
本次补充修复角色写入失败仍返回成功的问题；
结构化克隆不可用或拒绝扩展数据时使用独立 JSON 快照，JSON 也无法序列化时保留已有存储；
历史测试源码缺失时明确跳过相关套件。

## 许可证

AGPL-3.0
