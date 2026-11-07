# SillyTavern Perf Lab · 隐藏关系记忆开发分支

这是个人 SillyTavern 项目的开发仓库。此分支 `feature/hidden-affinity` 基于 `698119e`，交付隐藏好感度／关系记忆功能、离线 fixture 测试与实现文档。尚未合入 `codex-improvements`，也未部署。

本轮交叉审查补修了跨事件重复计分、重述承诺重复奖励、最近记忆顺序、单条坏记录导致整批丢弃、字面文本误删，以及流式保存／继续生成和模型切换的边界。实际验证、独立复核与提交记录见 [交叉审查修复报告](docs/reviews/2026-11-07-affinity-cross-review/README.md)。真实模型语义质量和手机实机仍未验证。

上一轮历史结果为好感度 **160/160**、相关检查 **427/427**，完整回归 **1226 通过、0 失败、20 项按平台／权限条件跳过**，见 [补完报告](docs/reviews/2026-11-06-affinity-completion/README.md)。本轮本地只运行相关测试，不把历史全仓结果冒充当前验证。

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

> 请打开 [功能合同](docs/affinity.md) 和[交叉审查修复报告](docs/reviews/2026-11-07-affinity-cross-review/README.md)，先理解现有功能、验证范围与设计风险。重点复核独立评分证据、已完成请求的单次凭据、原生继续生成／停止时序、重大变化核验和模型切换预算。只运行与新改动相关的测试；不要删保护测试、使用真实聊天或把历史结果当成当前通过。保留已有提交，追加 commit、普通 push 当前分支；合并与部署仍须单独确认。

```bash
# 好感度专项（Node 24.22.1；当前结果见交叉审查报告）
node --test tests/director-affinity-state.test.mjs tests/director-affinity-lifecycle.test.mjs tests/director-affinity-provider.test.mjs tests/director-affinity-budget.test.mjs

# 仅在改动涉及相应集成时运行 Director + 思维隐藏
node --test tests/director-*.test.mjs tests/reasoning-visibility.test.mjs

# 指定源码／测试的 lint
npx eslint --max-warnings=0 public/script.js public/scripts/openai.js public/scripts/textgen-settings.js public/scripts/isolated-quiet-prompt.js public/scripts/extensions/director/*.js tests/director-*.test.mjs tests/windows-path-key.test.mjs

# 浏览器专项（合成 provider；不调用真实模型）
python tests/browser-director-lab.py --affinity-only
```

## 首版 a72f9e7 交付时实测（历史记录）

- 使用 Node `v24.22.1`，好感度专项 **98 / 98** 通过，Director + 思维隐藏 **365 / 365** 通过。
- 指定 ESLint、三个生产模块的 `node --check`、`git diff --check` 通过。
- 全仓 `npm run test:perf`：**73 个测试文件中 58 通过、15 失败**。失败中出现本地监听 `listen EPERM` 与子进程捕获 `spawnSync /usr/local/lib/nodejs/node EPERM`，但不能不验证就归类为环境问题，所以目前**不能宣称全仓通过**。
- 仅离线 fixture，未调用真实模型；未测试手机／实际 UI，未验证真实 provider 的抽取质量，未部署。原始结果与限制见 [验证记录](docs/reviews/2026-11-06-affinity/README.md)。
