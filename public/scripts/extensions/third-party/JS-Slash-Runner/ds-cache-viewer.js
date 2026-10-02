/**
 * DS缓存命中查看器
 * 在页面角落显示缓存命中率，不干扰聊天
 */

(function () {
  'use strict';

  const TAG = '[DS缓存]';
  const STATS_KEY = '_ds_cache_stats';
  const PANEL_ID = 'ds-cache-panel';

  // 累计统计
  window[STATS_KEY] = window[STATS_KEY] || {
    totalRequests: 0,
    cacheHits: 0,
    totalPromptTokens: 0,
    totalCachedTokens: 0,
    lastCached: 0,
    lastPrompt: 0,
    lastHitRate: '0%',
  };

  const stats = window[STATS_KEY];

  function formatPercent(cached, total) {
    if (!total) return '0%';
    return (cached / total * 100).toFixed(1) + '%';
  }

  // 创建浮动面板
  function createPanel() {
    if (document.getElementById(PANEL_ID)) return;

    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.style.cssText = `
      position: fixed;
      bottom: 12px;
      right: 12px;
      z-index: 99999;
      background: rgba(20, 20, 30, 0.88);
      color: #e0e0e0;
      border: 1px solid rgba(100, 140, 255, 0.3);
      border-radius: 8px;
      padding: 8px 12px;
      font-family: 'Consolas', 'Monaco', monospace;
      font-size: 12px;
      line-height: 1.6;
      min-width: 180px;
      backdrop-filter: blur(8px);
      cursor: move;
      user-select: none;
      box-shadow: 0 2px 12px rgba(0,0,0,0.4);
      transition: opacity 0.3s;
    `;

    panel.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
        <span style="color:#7aa2f7; font-weight:bold; font-size:11px;">DS 缓存</span>
        <span id="${PANEL_ID}-close" style="cursor:pointer; color:#666; font-size:14px; padding:0 2px;">&times;</span>
      </div>
      <div id="${PANEL_ID}-body">
        <div>本次: <span id="${PANEL_ID}-last">--</span></div>
        <div>累计: <span id="${PANEL_ID}-avg">--</span></div>
        <div>命中: <span id="${PANEL_ID}-count">0/0</span></div>
      </div>
    `;

    document.body.appendChild(panel);

    // 关闭按钮
    document.getElementById(`${PANEL_ID}-close`).addEventListener('click', (e) => {
      e.stopPropagation();
      panel.style.display = 'none';
    });

    // 拖拽
    let isDragging = false;
    let offsetX, offsetY;

    panel.addEventListener('mousedown', (e) => {
      if (e.target.id === `${PANEL_ID}-close`) return;
      isDragging = true;
      offsetX = e.clientX - panel.getBoundingClientRect().left;
      offsetY = e.clientY - panel.getBoundingClientRect().top;
      panel.style.transition = 'none';
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const x = e.clientX - offsetX;
      const y = e.clientY - offsetY;
      panel.style.left = x + 'px';
      panel.style.top = y + 'px';
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
    });

    document.addEventListener('mouseup', () => {
      isDragging = false;
      panel.style.transition = 'opacity 0.3s';
    });
  }

  function updatePanel() {
    const lastEl = document.getElementById(`${PANEL_ID}-last`);
    const avgEl = document.getElementById(`${PANEL_ID}-avg`);
    const countEl = document.getElementById(`${PANEL_ID}-count`);

    if (lastEl) {
      lastEl.textContent = `${stats.lastCached}/${stats.lastPrompt} (${stats.lastHitRate})`;
      lastEl.style.color = stats.lastCached > 0 ? '#9ece6a' : '#f7768e';
    }
    if (avgEl) {
      const avgRate = formatPercent(stats.totalCachedTokens, stats.totalPromptTokens);
      avgEl.textContent = `${stats.totalCachedTokens}/${stats.totalPromptTokens} (${avgRate})`;
      avgEl.style.color = stats.totalCachedTokens > 0 ? '#9ece6a' : '#f7768e';
    }
    if (countEl) {
      countEl.textContent = `${stats.cacheHits}/${stats.totalRequests}`;
    }
  }

  function showCacheInfo(data) {
    try {
      const usage = data?.usage;
      if (!usage) return;

      const promptTokens = usage.prompt_tokens || 0;
      const cachedTokens =
        usage.prompt_tokens_details?.cached_tokens ??
        usage.cached_tokens ??
        0;

      const hitRate = formatPercent(cachedTokens, promptTokens);

      stats.totalRequests++;
      stats.totalPromptTokens += promptTokens;
      stats.totalCachedTokens += cachedTokens;
      if (cachedTokens > 0) stats.cacheHits++;

      stats.lastCached = cachedTokens;
      stats.lastPrompt = promptTokens;
      stats.lastHitRate = hitRate;

      // 确保面板可见
      const panel = document.getElementById(PANEL_ID);
      if (panel) {
        panel.style.display = 'block';
        updatePanel();
      }

      console.log(`${TAG} 本次: ${cachedTokens}/${promptTokens} (${hitRate}) | 累计: ${stats.totalCachedTokens}/${stats.totalPromptTokens} (${formatPercent(stats.totalCachedTokens, stats.totalPromptTokens)})`);
    } catch (e) {
      console.error(TAG, '解析缓存数据失败:', e);
    }
  }

  // 拦截 fetch 请求
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await originalFetch.apply(this, args);

    try {
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;

      if (url && url.includes('/api/backends/chat-completions/generate')) {
        const contentType = response.headers.get('content-type') || '';

        if (contentType.includes('text/event-stream')) {
          const cloned = response.clone();
          const reader = cloned.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';

          const processStream = async () => {
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });

                const lines = buffer.split('\n');
                for (const line of lines) {
                  if (line.startsWith('data: ') && line !== 'data: [DONE]') {
                    try {
                      const json = JSON.parse(line.slice(6));
                      if (json.usage) showCacheInfo(json);
                    } catch (_) {}
                  }
                }
              }
            } catch (_) {}
          };

          processStream();
        } else {
          response.clone().json().then(data => {
            if (data?.usage) showCacheInfo(data);
          }).catch(() => {});
        }
      }
    } catch (_) {}

    return response;
  };

  // 初始化面板
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createPanel);
  } else {
    createPanel();
  }

  console.log(TAG, '缓存命中查看器已加载（浮动面板模式）');
})();
