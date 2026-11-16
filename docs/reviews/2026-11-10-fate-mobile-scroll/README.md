# 手机选牌后操作被裁剪：命运牌 1.3.2

源码基线：`5d5b2ac`。用户提供的两张手机截图显示：暂存的大牌和替换候选并存；点击候选后只剩居中的选中牌，下面的进度与操作无法使用。图片未加入仓库；未读取、下载或修改生产聊天。

## 复现与根因

在真实 ZIP 安装的优化版宿主上，以 390×700、触控与 1.25 字体倍率建立合成场景：先保留一张牌，再发出替换候选，并在下一次模型请求进入传输时暂停。

原生弹窗默认 `allowVerticalScrolling=false`，其 `.popup-content` 使用 `overflow:hidden`。实际内容高 905px、可视高 600px；下部的强度、进度和操作被截断，手指无法滚到那里。回归在修复前明确因 overflowY=hidden 失败。

暂存旧牌直到新牌成功，以及等待模型期间暂时禁用选牌，是现有状态规则，不把它们当作数据错误修改。选牌动画不阻塞模型调用；此次没有证据证明用户当时的提供方是否卡住。此问题发生在选牌阶段，与此前修复的采用后停止事件问题不同。

## 修复

Fate 使用的原生 Popup 明确传入 `allowVerticalScrolling:true`，调用宿主现成的滚动样式。Director 版本更新为 1.3.2。没有修改模型请求、事件私密规则、卡牌保存与消耗、第三方扩展、宿主源码或 Affinity。

关闭窗口不等于取消已发出的模型调用；等待期间可以关闭、重新打开并查看进度，模型返回后再继续采用。翻面仍须等采用成功：选择候选牌写好事件 →「让意外发生」生成正文 → 点击翻牌或自动揭晓。

## 验证

- 新增真实 Popup 滚动与操作可达性的浏览器回归：修复前因裁剪失败，修复后通过。
- 补充替换过程中保留旧牌、显示进行中状态、禁止重复采用、完成后恢复操作的检查。
- 相关单元与打包测试 78/78；0 失败、0 取消、0 跳过。
- 官方与优化版分别安装实际 ZIP，各 6/6 检查通过。保留旧牌并暂停新牌请求，发送真实触摸开始/移动/结束的浏览器输入，弹窗 scrollTop 从 0 增加至 235px；验证关闭重开、进度可达、延后响应、采用与揭晓。两边均无页面异常。
- 优化版有一条 `/sounds/message.mp3` 的 HTTP404 控制台记录，修复前基线也有；官方无该记录。没有把它写成“控制台零错误”。
- ESLint、Python 编译、CRLF-aware diff 检查通过。

仅使用本地合成提供方，未验证真实模型、实体手机或移动 Safari。本次不声称所有造成等待的提供方问题已解决。

证据：[修复前](../../../.evidence/fate-pick-20261110/scroll-baseline-results.json)、[优化版触摸检查](../../../.evidence/fate-pick-20261110/fork-touch-final-results.json)、[官方触摸检查](../../../.evidence/fate-pick-20261110/official-touch-final-results.json)。hostCommit 记录宿主基线；插件来源由包内 sourceHash 和 ZIP SHA256 绑定。两宿主使用相同 ZIP：SHA256 `7b5580ab1c3adf0b6da02e93229ebd28aae8e3b23100180e73a12ffe5bfdc81d`，sourceHash `dea7078eb2ae0ddf0f0f363e9df2535c6a088a4543c2db8219d8c5f480a9c60a`。

中途采用 CDP synthesizeScrollGesture 的两次检查未移动页面；同一调用在不带酒馆代码的独立原生滚动容器里也未移动。夹具改为逐帧发送 touchStart/move/end 后通过，未为此继续修改产品代码。失败结果保留，没有计入最终通过数。

## 命令

```sh
node --test tests/director-fate-ui.test.mjs tests/director-fate-reveal.test.mjs tests/director-fate-offer.test.mjs tests/director-fate-persistence.test.mjs tests/standalone-plugin-package.test.mjs
node node_modules/eslint/bin/eslint.js public/scripts/extensions/director/fate-ui.js tests/director-fate-ui.test.mjs
python -m py_compile tests/browser-standalone-plugins.py
python tests/browser-standalone-plugins.py --host-root . --fate-pick-only --output .evidence/fate-pick-20261110/fork-touch-final-results.json
python tests/browser-standalone-plugins.py --host-root .worktrees/official-plugin-host --fate-pick-only --output .evidence/fate-pick-20261110/official-touch-final-results.json
```
