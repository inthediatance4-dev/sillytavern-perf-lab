# 验证说明（Verification)

本页汇总对 11 轮交付的独立复核结果与复现方式。所有原始证据（RED/GREEN 日志、浏览器结果、交付产物、审计脚本与日志）保留在作者的本地证据目录中，未进入本仓库。

## 一、交付链

- `main` = 官方 1.18.0 源码基线 + 实验脚手架（2 个提交）。
- `codex/sillytavern-performance` … `codex/sillytavern-expression-mode-flow`：11 轮依次叠加，每轮基于上一轮 head 开分支（git 祖先关系已验证）。
- 全项目累计 diff（`main` → 末端）：**84 个文件，+9,843 / −547 行**。
- 每轮的改动只包含白名单文件：源码、测试、实验启动器与说明；配置、用户数据、依赖、缓存、模型和运行结果从不进入提交或增量包。

## 二、2026-10-09 独立复核（ZCode 执行，只读）

### 1. 证据审计（0 问题）

- **Git 状态**：11 个工作树 HEAD/分支/干净度与各自报告一致。
- **摘要复算**：17,732 条 sha256/md5 声明全部一致（含被测源码指纹、交付物摘要、备份 MD5/SHA-256）。
- **交付物**：11 个 ZIP 逐条目与工作树逐字节一致；10 个 Git bundle 重新 `bundle verify` 通过；每轮 1,177–1,214 个文件的还原副本与工作树逐字节一致；每轮原始 `.bak` 与不可变基线 Git blob 一致。
- **保护核验**：末端轮 **12,915 个受保护文件**全量重扫，11 个受保护工作区 HEAD/状态未变。
- **生产未触碰**：全项目 20 个受监测生产文件（多个时点快照）SHA-256 **跨轮一致**。
- **失败记录**：所有 `passed:false` 的浏览器记录均为基线对照（预期失败）、被后续通过记录取代的早期尝试、或显式标注保留的失败证据；最终验收引用的证据全部为通过记录。

### 2. 实跑复验（全部通过）

- 各轮在**自己的工作树**里实跑本轮新增/改动测试：20 / 93 / 47 / 32 / 53 / 86 / 110 / 48 / 60 / 45 / 38，合计 **632 项，0 失败**。
- 末端累计套件 22 个测试文件：**Node 24.15.0 442/442**、**Node 20.20.2 442/442**。

## 三、对比官方 1.19.0（摘要）

- 官方最新正式版 1.19.0（`7e8663cd`，2026-09-14）与本库逐文件对比：**12 个文件本库独有**、**10 个改动文件官方完全未碰**、**11 个双方都改**。
- 详细矩阵与重点对照见 [COMPARISON-vs-official-1.19.0.md](COMPARISON-vs-official-1.19.0.md)。

## 四、复现方式（示例）

```bash
# 基础身份：每轮 head 与前一分支的 base 关系
git log --oneline codex/sillytavern-expression-mode-flow -3
git merge-base --is-ancestor codex/sillytavern-character-editor-flow codex/sillytavern-expression-mode-flow && echo chain-ok

# 全项目累计差异
git diff --shortstat main codex/sillytavern-expression-mode-flow

# 安全测试（末端分支）
node --test tests/expression-mode-flow.test.mjs tests/performance-lab.test.mjs

# 与官方对比：下载 1.19.0 源码后逐文件比对
#   https://github.com/SillyTavern/SillyTavern/releases/tag/1.19.0  (commit 7e8663cd)
```

## 五、未验证范围

真实模型生成、真实账号、生产 Linux 环境、真实手机设备、长期高并发与强制终止场景均未验证；浏览器证据为合成数据 + 无 GPU headless Chrome 的小样本中位数，不作为生产性能承诺。
