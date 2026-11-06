# SillyTavern Perf Lab · 隐藏关系记忆开发分支

这是个人 SillyTavern 项目的开发仓库。此分支 `feature/hidden-affinity` 基于 `698119e`，交付隐藏好感度／关系记忆功能、离线 fixture 测试与实现文档。尚未合入 `codex-improvements`，也未部署。

本机补完已修复重叠引文重复计分、未知信息泄漏、并发 quiet、上下文预算和即时聊天重载丢凭据等问题。好感度专项 **160/160**、相关检查 **427/427**；完整回归 **1226 通过、0 失败、20 项按平台／权限条件跳过**。浏览器、第三方扩展共存和 CI 的完整结果见 [补完报告](docs/reviews/2026-11-06-affinity-completion/README.md)。真实模型语义质量和手机实机仍未验证。

## 使用功能

后台启用「命运之笔」后，关系记忆整理默认开启，可在设置中关闭。默认每 **10** 条有效角色回复整理一次，也可选 **5** 条；界面不会显示分数、等级或攻略提示。

分数限在 `-100…+100`，只作内部信号。普通事实与约定常记但不自动加分；角色兑现自己的承诺不加分，玩家秘密行动或仅自报完成也不加分。玩家履约需目标角色本人后来明确知情／态度表达才可能有正向变化。高分时正收益递减：50 分前轻微 `+2`／重大 `+5`；50…79 分为 `+1`／`+2`；80 后正分不再增加。负向轻微 `-3`／重大 `-8`，不衰减；重大变化须由独立核验确认。

关系记忆只注入少量既有事实、待兑现约定与弱倾向，不可借它获得亲密、恋爱或服从。角色不在场时历史冻结、不注入、不产生新评估；原文被真实编辑、删除或 swipe 切换 仍会撤回对应证据。

实现合同见 [docs/affinity.md](docs/affinity.md)。

## 交给本机 Codex

在本机先获取并进入这份已推送的功能分支。不要直接复制旧的 `/workspace` 路径或继续使用开发机工作树。

```bash
git fetch origin feature/hidden-affinity codex-improvements
git switch feature/hidden-affinity
npm ci
```

把下面这段原样交给本机 Codex：

> 请打开 [docs/affinity.md](docs/affinity.md) 及 [docs/reviews/2026-11-06-affinity/README.md](docs/reviews/2026-11-06-affinity/README.md)，先理解现有功能与已知验证边界，不要重写功能、删保护测试或把未验证当成通过。重点复核离线记忆冻结／恢复、原文编辑撤回、同一完成的单次计分、独立 major 核验和中断／群聊／长聊天兼容。请运行专项与完整回归，修任何真实失败；不要用真实聊天或新增 provider／模型配置测试。然后在本机做界面与非阻塞体验验证；未做前要明示未做。完成后即可 commit、push 当前分支，并正常准备合入 `codex-improvements`；不要重写既有提交或自动部署。

```bash
# 专项（本机补完实测 160/160，使用 Node 24.22.1）
node --test tests/director-affinity-state.test.mjs tests/director-affinity-lifecycle.test.mjs tests/director-affinity-provider.test.mjs tests/director-affinity-budget.test.mjs

# Director + 思维隐藏（本机补完实测 427/427）
node --test tests/director-*.test.mjs tests/reasoning-visibility.test.mjs

# 指定源码／测试的 lint
npx eslint --max-warnings=0 public/script.js public/scripts/openai.js public/scripts/textgen-settings.js public/scripts/isolated-quiet-prompt.js public/scripts/extensions/director/*.js tests/director-*.test.mjs tests/windows-path-key.test.mjs

# 全仓回归：本机必须重跑，不可跳过
npm run test:perf
```

## 首版 a72f9e7 交付时实测（历史记录）

- 使用 Node `v24.22.1`，好感度专项 **98 / 98** 通过，Director + 思维隐藏 **365 / 365** 通过。
- 指定 ESLint、三个生产模块的 `node --check`、`git diff --check` 通过。
- 全仓 `npm run test:perf`：**73 个测试文件中 58 通过、15 失败**。失败中出现本地监听 `listen EPERM` 与子进程捕获 `spawnSync /usr/local/lib/nodejs/node EPERM`，但不能不验证就归类为环境问题，所以目前**不能宣称全仓通过**。
- 仅离线 fixture，未调用真实模型；未测试手机／实际 UI，未验证真实 provider 的抽取质量，未部署。原始结果与限制见 [验证记录](docs/reviews/2026-11-06-affinity/README.md)。
