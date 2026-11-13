# 好感度记忆验证记录

工作树：`/workspace/wt-affinity`。基线为 `698119ed4a244720c061343f588e6a9566902cda`；功能文件交付到 `feature/hidden-affinity`，未合入目标分支、未部署。本机接手说明见仓库根目录 `README.md`。实现合同见 [affinity.md](../../affinity.md)。

使用本地 Node v24.22.1；未调用真实 LLM API、未读取密钥、未做 live 模型测试。所有模型响应均为明确标注的离线 fixture，不能据此声称真实模型语义效果已经验证。

| 实际执行 | 实测结果 | 原始输出 |
| --- | --- | --- |
| `node --test --test-reporter=spec tests/director-affinity-state.test.mjs tests/director-affinity-lifecycle.test.mjs tests/director-affinity-provider.test.mjs` | **98 / 98 通过**（3 个文件） | [final-focused-expanded.txt](final-focused-expanded.txt) |
| `node --test --test-reporter=spec tests/director-*.test.mjs tests/reasoning-visibility.test.mjs` | **365 / 365 通过**（20 个文件） | [final-director-expanded.txt](final-director-expanded.txt) |
| `npm run test:perf` | **73 个文件中 58 通过、15 失败，exit 1** | [test-perf.txt](test-perf.txt) |

好感度专项 **98** 个用例、Director/reasoning **365** 个用例均已实际通过，新增的 3 个测试文件已加入 `test:perf`。生命周期与状态测试直接使用生产模块和项目 EventEmitter；提供方测试执行真实 quiet/raw/instruct 函数，以 fixture 取代 provider I/O。

指定源码／测试的 ESLint、三个新增／修改生产模块的 `node --check`、`git diff --check` 均实际执行通过。最后在本机由使用者跑完整回归与真实体验；本次没有把手机或真实模型结果写成通过。

## 全仓测试的环境阻碍

全仓测试没有全部通过，不能作为完整回归绿灯。15 个失败文件涉及本地服务器或子进程输出捕获：

- 多项明确报 `listen EPERM: operation not permitted 127.0.0.1`，包括聊天路由、fake endpoint、tokenizer server 和 performance lab。
- deploy、integrity、compile-cache、lazy-import、request-drain 等用例依赖子进程 stdout/stderr；本环境返回空输出，出现 JSON.parse 空字符串或缺少预期标记的次生断言。
- 独立于项目的最小子进程实验也复现相同限制：子进程仅打印固定 stdout/stderr 并以 0、1、78 退出，输出仍为空，同步捕获附带 `EPERM`。实测记录见 [sandbox-spawn.txt](sandbox-spawn.txt)。

不能把这 15 项归类为环境限制后就算回归通过：尚未逐项证明每一个底层失败均与本功能无关。不要修改测试或绕过环境限制来“消红”；应在本机允许本地监听及正常子进程的环境重跑 `npm run test:perf`，检查真实错误后按证据修复。

## 已验证的重点

当前 swipe 物理保存后才计数；停止后的迟到完成不计数；重生成与继续生成不重复计数；群聊按实际头像归属并等整批结束；完整批次排队；跨聊天迟到结果丢弃；删改、swipe 删除与重载对账；承诺零分、后续结果因果引用；重大事件独立核验失败不降级；同证据不重复核验或计分；后台异常与保存失败不抛向正文；隔离请求不替换正文 controller、不释放正文 UI、不展开原始引文中的宏。

实现保留有界记忆与超长消息摘录边界，详见实现合同。实际模型能否稳定抽取所有应有事实仍需使用者日后自行体验；本次没有为此发起任何模型请求。
