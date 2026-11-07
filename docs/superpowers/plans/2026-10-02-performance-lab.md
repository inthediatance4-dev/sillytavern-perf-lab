# 独立酒馆性能实验实施计划

执行方式：本会话顺序实现和自审；用户已授权独立尝试，完成后保留分支。禁止修改服务器服务和数据。

目标：让真实酒馆源码在独立本机应用中使用线性关键词匹配与有序异步聊天I/O，保持格式和完整性。

## 1. 基线与测试

- [x] 白名单捕获源码、原始SHA及独立Git worktree；安装锁文件依赖，关闭安装脚本。
- [x] 创建`tests/performance-lab.test.mjs`，以新合成数据目录和配置动态导入真实`chats.js`路由；用loopback临时端口验证关键词跨消息、文件名匹配、空尾行、同步保存计数和同路径完整性竞争。
- [x] 运行`node --test tests/performance-lab.test.mjs`，保留原代码失败输出，确认失败来自重复匹配、挂起与同步写入。

## 2. 搜索与完成分支

- [x] `src/chat-search.js`导出`createTextMatcher(fragments)`，每消息更新Set中的未命中词。
- [x] `src/endpoints/chats.js`在每文件创建独立matcher，保留文件名pure matcher；`getChatInfo`将stat移出async executor，忽略空行，连接stream与readline错误分支，明确完成空内容。
- [x] 用请求测试及差分合成用例验证结果一致和检查数上界；提交对应文件。

## 3. 有序写入与备份

- [x] 创建`src/chat-io.js`：`withPathLock(path, task)`排队、`writeChatFile(path,data)`async原子落盘、`recycleOldChatBackups(directory,prefix,limit)`单次stat及可恢复rename。
- [x] `trySaveChat`在队列内校验与写入；`backupChat`返回Promise并使用目录队列，节流保留，接入正常退出等待。调用方在同文件串行后再应答，备份失败维持原来记录错误的行为。
- [x] `getChatData`改为async读文件并更新两个路由等待，保持返回数组和读取失败空数组。
- [x] 验证写入失败旧文件未变、同路径不并行/不同路径可并行、冲突校验在队列内、原子文件内容一致、备份过期只移动不删除。提交对应文件。

## 4. 完整独立应用及交付

- [x] 创建`scripts/start-performance-lab.mjs`，固定loopback与工作区数据/配置，拒绝链接与端口占用，移除SillyTavern环境覆盖。
- [x] 创建同批基准脚本，记录原版/改版时间和操作数，保留输出于`.evidence`。
- [x] 完整应用启动并验证主页、CSRF、新建合成角色/聊天、搜索、保存、备份列表及浏览器加载；不调用模型API。
- [x] 运行适当回归、变更文件语法/样式检查、`git diff --cached --check`，确认暂存清单没有运行数据、配置、依赖或凭据。
- [x] 只读核验生产状态与原哈希；写中文启动说明及验证边界，提交并保留实验分支。
