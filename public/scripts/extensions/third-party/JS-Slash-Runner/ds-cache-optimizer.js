/**
 * DeepSeek V4缓存优化器
 * 通过稳定 prompt 前缀来提高缓存命中率
 *
 * 原理：DeepSeek 的缓存基于 prompt 前缀匹配。
 * 如果 system prompt 和前几条消息保持不变，后续请求可以复用缓存。
 *
 * 优化策略：
 * 1. 检测 system prompt 是否包含动态内容（时间宏等）
 * 2. 在每次请求前检查前缀一致性
 * 3. 提供优化建议
 */

(function () {
  'use strict';

  const TAG = '[DS优化]';
  const STATE_KEY = '_ds_optimizer_state';

  window[STATE_KEY] = window[STATE_KEY] || {
    lastSystemPromptHash: null,
    lastPrefixHash: null,
    prefixChanges: 0,
    totalRequests: 0,
    warnings: [],
  };

  const state = window[STATE_KEY];

  // 简单字符串哈希
  function hashStr(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0;
    }
    return hash.toString(36);
  }

  // 检测常见的动态宏
  const DYNAMIC_PATTERNS = [
    { pattern: /\{\{date\}\}/gi, name: '{{date}}' },
    { pattern: /\{\{time\}\}/gi, name: '{{time}}' },
    { pattern: /\{\{datetime\}\}/gi, name: '{{datetime}}' },
    { pattern: /\{\{weekday\}\}/gi, name: '{{weekday}}' },
    { pattern: /\d{4}[-/]\d{1,2}[-/]\d{1,2}/g, name: '日期文本' },
    /\d{1,2}:\d{2}/g,
  ];

  function detectDynamicContent(messages) {
    const warnings = [];

    for (const msg of messages) {
      if (msg.role === 'system' || msg.role === 'user' && messages.indexOf(msg) === 0) {
        const content = msg.content || '';
        for (const item of DYNAMIC_PATTERNS) {
          const pattern = item.pattern || item;
          const name = item.name || (typeof item === 'object' ? item.pattern?.toString() : '动态内容');
          if (pattern.test ? pattern.test(content) : new RegExp(pattern).test(content)) {
            warnings.push(`检测到 ${name}，可能导致缓存失效`);
            // 重置 lastIndex（如果适用）
            if (pattern.lastIndex) pattern.lastIndex = 0;
          }
        }
      }
    }

    return warnings;
  }

  // 拦截 fetch 请求
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;

    if (url && url.includes('/api/backends/chat-completions/generate')) {
      try {
        // 读取请求体
        let body = args[1]?.body;
        if (typeof body === 'string') {
          body = JSON.parse(body);
        }

        if (body?.messages) {
          state.totalRequests++;

          // 检测动态内容
          const warnings = detectDynamicContent(body.messages);
          if (warnings.length > 0 && state.totalRequests <= 3) {
            console.warn(`${TAG} ${warnings.join('; ')}`);
          }

          // 计算前缀哈希（前3条消息）
          const prefixMessages = body.messages.slice(0, 3);
          const prefixStr = prefixMessages.map(m => `${m.role}:${m.content}`).join('|');
          const currentHash = hashStr(prefixStr);

          if (state.lastPrefixHash && currentHash !== state.lastPrefixHash) {
            state.prefixChanges++;
            if (state.totalRequests <= 5) {
              console.info(`${TAG} 检测到 prompt 前缀变化，本次缓存可能失效`);
            }
          }

          state.lastPrefixHash = currentHash;

          // 记录 system prompt 哈希
          const systemMsg = body.messages.find(m => m.role === 'system');
          if (systemMsg) {
            const sysHash = hashStr(systemMsg.content || '');
            if (state.lastSystemPromptHash && sysHash !== state.lastSystemPromptHash) {
              if (state.totalRequests <= 3) {
                console.warn(`${TAG} System prompt 已变更，这是缓存失效的主要原因`);
              }
            }
            state.lastSystemPromptHash = sysHash;
          }
        }
      } catch (e) {
        console.error(TAG, '分析请求失败:', e);
      }
    }

    return originalFetch.apply(this, args);
  };

  console.log(TAG, '缓存优化器已加载');
})();
