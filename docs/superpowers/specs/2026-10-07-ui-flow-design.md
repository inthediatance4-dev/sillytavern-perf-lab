# SillyTavern After Hours 与媒体滚动设计

用户授权：完成后自行继续迭代、美化 UI、提高流畅度；酒馆可更自由、有氛围，之前的克制风格仅针对 TBOX。沿用“不改现有服务、不用真实聊天数据、未经授权不部署、删除必须回收”的边界。设计选择由本轮自行决策，不另设审批步骤。

## 选择

采用原主题引擎增加 `After Hours`（夜航），搭配一个有反例支撑的媒体滚动修复。保留主题切换能力。整套全局 CSS 替换会扩大对自定义主题、插件及移动 UI 的影响；重建聊天框架会涉及数据、事件和扩展协议，均不在本轮范围。

## 视觉

深墨蓝背景、暖铜色重点、乳白正文、低饱和次级文字。桌面聊天面板和工具栏留出呼吸空间；消息使用更明确的角色层次与舒适行距，输入区像一块独立的书写面板。使用现有 Noto 字体，标题可用本机 Georgia/serif，不下载字体或图片。

新文件 `default/content/themes/After Hours.json` 使用原主题参数，并以 `custom_css` 的同源 `@import url('/css/after-hours.css')` 加载独立样式。`default/content/index.json` 增加一个 theme 条目，由现有默认内容安装流程分发；不改用户原主题选择或默认 settings。只在本轮人工实验账号中选择新主题。

主题关闭模糊和文字发光，避免无限动画与全屏滤镜；支持原有 reduced-motion 开关和系统减少动画偏好。桌面普通模式可调整面板边距；movingUI、waifuMode 不强制套入固定布局。手机包含 360、390、768 像素宽、横屏和多行输入检查，文字、按钮不能横向溢出或遮挡输入区。保留警告/删除的既有语义颜色和工具可见性。

## 交互修复

原 `scrollOnMediaLoad` 每次给未完成图片/音视频增加监听器，却不在重复调用、聊天清空或截止时间后释放，也没有检查用户上翻形成的 `scrollLock`。

新增无第三方依赖的 `public/scripts/media-load-scroll.js`，导出 `createMediaLoadScrollHandler({scroll, shouldScroll, timeoutMs=1000})`，返回 `track(media)`、`cancel()`。每次 track 先取消上批；仅等待实际未就绪的图片、音频和视频，每项只结算一次。批次内全部就绪后先移除监听和计时器，再检查当前滚动许可，并最多滚动一次。超过 1 秒直接释放，不补滚动。空列表不滚动，全部已就绪保留原来的即时滚动语义。

主脚本以 `!scrollLock && power_user.auto_scroll_chat_to_bottom` 作为许可条件，仍使用原 `scrollChatToBottom({waitForFrame:true})`。`clearChat` 在清理 DOM 前取消批次，旧聊天的迟到媒体事件不能影响新聊天。保留原 Promise/消息保存格式和其他渲染管线，不调整模型生成、扩展执行顺序或截断设置。

## 隔离与验收

分支 `codex/sillytavern-ui-flow`，新 worktree `.worktrees/ui-flow`，基于 `567300a837f7cef8eb4aa1c5e09d36a8a6901c7c`。实验端口 8774；依赖 junction 只读，新数据来自发行默认内容和人工角色/聊天。保护此前五个工作区共 5,785 份跟踪文件及六份原始备份。

先用实际旧 `scrollOnMediaLoad` 代码和原生 EventTarget 证明失败，再测试清理、用户意图、成功/失败媒体事件、重复事件、重入和取消；实际浏览器补验人工图片的延迟加载、上翻位置、主题切换和保存/重开。没有将模型网络等待宣称为 UI 提速；若浏览器测得差异小，则报告限制。

交付包括本地提交、增量 ZIP、完整 Git bundle、源码指纹、浏览器截图与人工场景结果、Node 20/24 完整回归和剩余问题。不得仅凭截图或单元测试宣称线上性能。
