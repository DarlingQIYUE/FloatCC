// FloatCC Chrome 扩展 - 后台脚本
// 用于管理扩展状态和弹出界面通信

let isConnected = false;

// 处理content script发来的fetch请求（解决跨域和cookie问题）
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // 代理fetch请求
  if (message.type === 'fetch') {
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
