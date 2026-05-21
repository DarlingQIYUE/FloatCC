// FloatCC Chrome 扩展 - 后台脚本
// 用于管理扩展状态和弹出界面通信

let isConnected = false;

// 允许 fetch 代理访问的主机白名单：仅 B 站字幕/视频 API
const ALLOWED_FETCH_HOSTS = new Set([
  'api.bilibili.com',
  'aisubtitle.hdslb.com',
  'comment.bilibili.com',
  'i0.hdslb.com'
]);

function isAllowedFetchUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    return ALLOWED_FETCH_HOSTS.has(u.hostname);
  } catch {
    return false;
  }
}

// 处理content script发来的fetch请求（解决跨域和cookie问题）
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // 代理fetch请求
  if (message.type === 'fetch') {
    // 仅接受来自本扩展自身 content script 的请求（sender.id 与扩展 ID 一致，且来自 tab 上下文）
    if (!sender || sender.id !== chrome.runtime.id || !sender.tab) {
      sendResponse({ success: false, error: 'untrusted sender' });
      return;
    }
    if (!isAllowedFetchUrl(message.url)) {
      sendResponse({ success: false, error: 'url not allowed' });
      return;
    }
    fetch(message.url, {
      credentials: 'include',
      headers: {
        'Referer': 'https://www.bilibili.com'
      }
    })
      .then(res => res.json())
      .then(data => sendResponse({ success: true, data }))
      .catch(err => sendResponse({ success: false, error: err.toString() }));

    return true; // 异步响应
  }

  // 连接状态更新
  if (message.type === 'connectionStatus') {
    isConnected = message.connected;
    chrome.action.setBadgeText({
      text: isConnected ? '●' : '○'
    });
    chrome.action.setBadgeBackgroundColor({
      color: isConnected ? '#4caf50' : '#666'
    });
  }
});
