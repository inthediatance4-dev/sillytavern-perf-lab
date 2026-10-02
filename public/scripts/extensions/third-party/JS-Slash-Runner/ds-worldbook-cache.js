/**
 * DS的世界书缓存优化器
 * 优化世界书条目顺序以提高 DeepSeek 缓存命中率
 *
 * 原理：DeepSeek 缓存基于 prompt 前缀匹配。
 * 世界书条目插入到 prompt 中的位置会影响前缀一致性。
 *
 * 优化策略：
 * 1. 监控世界书条目的插入顺序
 * 2. 建议将 constant 条目放在前面（稳定前缀）
 * 3. 检测条目内容变化对缓存的影响
 */

(function () {
  'use strict';

  const TAG = '[DS世界书]';
  const STATE_KEY = '_ds_worldbook_state';

  window[STATE_KEY] = window[STATE_KEY] || {
    lastEntryHashes: {},
    entryChangeCount: 0,
    totalChecks: 0,
    suggestions: [],
  };

  const state = window[STATE_KEY];

  function hashStr(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0;
    }
    return hash.toString(36);
  }

  // 检查世界书条目配置
  function analyzeWorldBook() {
    try {
      // 通过 SillyTavern 的全局变量获取世界书数据
      const context = window.SillyTavern?.getContext?.();
      if (!context) return;

      const chat = context.chat;
      if (!chat) return;

      // 获取当前加载的世界书条目
      // 世界书条目会被注入到 system prompt 中
      // 我们通过检查 chat metadata 来获取世界书信息
      const metadata = context.chatMetadata;
      if (!metadata) return;

      // 检查是否有活跃的世界书
      const worldNames = context.world_names || [];
      if (worldNames.length === 0) return;

      state.totalChecks++;

      // 提供优化建议
      if (state.totalChecks === 1) {
        showInitialTips();
      }
    } catch (e) {
      console.error(TAG, '分析世界书失败:', e);
    }
  }

  function showInitialTips() {
    console.log(`${TAG} 缓存优化建议：`);
    console.log(`  1. 将常驻条目设为 "constant" 并设置较小的 order 值`);
    console.log(`  2. 避免在世界书条目中使用日期/时间相关的内容`);
    console.log(`  3. 触发词较少的条目放在前面`);
    console.log(`  4. 条目内容尽量保持稳定，减少频繁修改`);
  }

  // 拦截 fetch 请求，在请求前检查世界书状态
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;

    if (url && url.includes('/api/backends/chat-completions/generate')) {
      try {
        let body = args[1]?.body;
        if (typeof body === 'string') {
          body = JSON.parse(body);
        }

        if (body?.messages) {
          // 检查 system prompt 中的世界书内容
          const systemMsg = body.messages.find(m => m.role === 'system');
          if (systemMsg) {
            const content = systemMsg.content || '';

            // 检测世界书内容是否变化
            const worldBookSection = extractWorldBookSection(content);
            if (worldBookSection) {
              const currentHash = hashStr(worldBookSection);

              if (state.lastEntryHashes.system && currentHash !== state.lastEntryHashes.system) {
                state.entryChangeCount++;

                if (state.entryChangeCount <= 3) {
                  console.info(`${TAG} 世界书内容发生变化 (${state.entryChangeCount}次)，可能影响缓存`);
                }
              }

              state.lastEntryHashes.system = currentHash;
            }
          }

          // 检查前几条消息中是否包含世界书内容
          for (let i = 0; i < Math.min(3, body.messages.length); i++) {
            const msg = body.messages[i];
            if (msg.role === 'system') continue;

            const content = msg.content || '';
            const hash = hashStr(content);
            const key = `msg_${i}_${msg.role}`;

            if (state.lastEntryHashes[key] && hash !== state.lastEntryHashes[key]) {
              state.entryChangeCount++;
            }
            state.lastEntryHashes[key] = hash;
          }
        }
      } catch (e) {
        console.error(TAG, '检查世界书缓存失败:', e);
      }
    }

    return originalFetch.apply(this, args);
  };

  // 从 system prompt 中提取世界书部分
  function extractWorldBookSection(content) {
    // SillyTavern 通常在 system prompt 末尾附加世界书内容
    // 尝试找到世界书的边界标记
    const markers = [
      '[World Info]',
      '---',
      '<world_info>',
      'World Info:',
    ];

    for (const marker of markers) {
      const idx = content.lastIndexOf(marker);
      if (idx !== -1) {
        return content.slice(idx);
      }
    }

    // 如果找不到标记，返回最后 30% 的内容作为可能的世界书区域
    const start = Math.floor(content.length * 0.7);
    return content.slice(start);
  }

  // 监听世界书更新事件
  function setupEventListeners() {
    try {
      const context = window.SillyTavern?.getContext?.();
      if (context?.eventSource && context?.eventTypes) {
        const events = context.eventTypes;

        // 世界书更新时重新分析
        if (events.WORLDINFO_UPDATED) {
          context.eventSource.on(events.WORLDINFO_UPDATED, () => {
            analyzeWorldBook();
          });
        }

        // 聊天切换时重置状态
        if (events.CHAT_CHANGED) {
          context.eventSource.on(events.CHAT_CHANGED, () => {
            state.lastEntryHashes = {};
            state.entryChangeCount = 0;
            state.totalChecks = 0;
          });
        }
      }
    } catch (e) {
      // 静默失败，不影响正常使用
    }
  }

  // 初始化
  setupEventListeners();

  // 延迟执行初始分析
  setTimeout(() => {
    analyzeWorldBook();
  }, 2000);

  console.log(TAG, '世界书缓存优化器已加载');
})();
