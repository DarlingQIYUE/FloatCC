// FloatCC Chrome 扩展 - 内容脚本
// 功能：从B站获取字幕并推送到FloatCC

const WS_URL = 'ws://localhost:8765';

let ws = null;
let reconnectTimer = null;
let lastSubtitle = '';
let subtitleData = null;
let isConnected = false;
let worker = null;
let cachedInfo = null;

function log(message) {
  console.log('[FloatCC扩展]', message);
}

// 发送HTTP请求（通过background脚本代理，解决跨域和cookie问题）
function httpRequest(url) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: 'fetch', url }, (res) => {
      if (res?.success) {
        resolve(res.data);
      } else {
        reject(new Error(res?.error || '请求失败'));
      }
    });
  });
}

// 创建Web Worker
function createWorker() {
  const workerCode = `
    let intervalId = null;
    self.onmessage = function(e) {
      if (e.data.type === 'start') {
        if (intervalId) clearInterval(intervalId);
        intervalId = setInterval(() => {
          self.postMessage({ type: 'check' });
        }, 500);
      } else if (e.data.type === 'stop') {
        if (intervalId) {
          clearInterval(intervalId);
          intervalId = null;
        }
      }
    };
  `;
  const blob = new Blob([workerCode], { type: 'application/javascript' });
  worker = new Worker(URL.createObjectURL(blob));
  worker.onmessage = (e) => {
    if (e.data.type === 'check') checkAndSend();
  };
}

function connect() {
  if (ws && ws.readyState === WebSocket.OPEN) return;
  try {
    ws = new WebSocket(WS_URL);
    ws.onopen = () => {
      log('已连接到FloatCC');
      isConnected = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      send({ type: 'connected', message: 'B站已连接' });
      startListener();
      // 通知背景脚本连接状态
      chrome.runtime.sendMessage({ type: 'connectionStatus', connected: true });
    };
    ws.onmessage = (event) => {
      try { JSON.parse(event.data); } catch (e) {}
    };
    ws.onclose = () => {
      log('连接断开，3秒后重连...');
      isConnected = false;
      reconnectTimer = setTimeout(connect, 3000);
      stopListener();
      chrome.runtime.sendMessage({ type: 'connectionStatus', connected: false });
    };
    ws.onerror = () => log('WebSocket错误');
  } catch (e) {
    log('连接失败: ' + e.message);
    reconnectTimer = setTimeout(connect, 3000);
  }
}

function send(data) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
}

// 获取视频信息
function getVideoInfo() {
  if (cachedInfo) return cachedInfo;

  const info = {};

  const urlMatch = location.pathname.match(/\/video\/(BV[\w]+)/);
  if (urlMatch) {
    info.bvid = urlMatch[1];
  }

  try {
    const state = window.__INITIAL_STATE__;
    const cidMap = state?.cidMap;
    const page = state?.p || 1;

    if (cidMap && info.bvid) {
      const ep = cidMap[info.bvid];
      if (ep) {
        info.aid = ep.aid;
        info.cid = ep.cids?.[page] || ep.cids?.[1];
      }
    }
  } catch (e) {}

  if (!info.cid || !info.aid) {
    try {
      const state = window.__INITIAL_STATE__;
      if (state?.videoData) {
        info.bvid = info.bvid || state.videoData.bvid;
        info.aid = info.aid || state.videoData.aid;
        info.cid = info.cid || state.videoData.cid;
      }
    } catch (e) {}
  }

  if (!info.cid || !info.aid) {
    try {
      const manifest = window.playerRaw?.getManifest?.();
      if (manifest) {
        info.aid = info.aid || manifest.aid;
        info.cid = info.cid || manifest.cid;
        info.bvid = info.bvid || manifest.bvid;
        log('从playerRaw获取: aid=' + info.aid + ', cid=' + info.cid);
      }
    } catch (e) {}
  }

  // 从 window.player 获取
  if (!info.cid || !info.aid) {
    try {
      const player = window.player;
      if (player) {
        info.aid = info.aid || player.aid || player.getAid?.();
        info.cid = info.cid || player.cid || player.getCid?.();
        info.bvid = info.bvid || player.bvid;
        log('从player获取: aid=' + info.aid + ', cid=' + info.cid);
      }
    } catch (e) {}
  }

  if (!info.cid) {
    const cidMatch = location.search.match(/[?&]cid=(\d+)/);
    if (cidMatch) info.cid = cidMatch[1];
  }
  if (!info.aid) {
    const aidMatch = location.search.match(/[?&]aid=(\d+)/);
    if (aidMatch) info.aid = aidMatch[1];
  }

  cachedInfo = info;
  return info;
}

// 获取字幕列表
function fetchSubtitleList() {
  return new Promise(async (resolve) => {
    let info = getVideoInfo();

    if (info.bvid && !info.cid) {
      try {
        const viewData = await httpRequest(`https://api.bilibili.com/x/web-interface/view?bvid=${info.bvid}`);
        if (viewData.code === 0 && viewData.data) {
          info.cid = viewData.data.cid;
          info.aid = viewData.data.aid;
          log('通过view API获取: cid=' + info.cid + ', aid=' + info.aid);
        }
      } catch (e) {
        log('view API请求失败: ' + e.message);
      }
    }

    let url = '';
    if (info.cid) {
      url = `https://api.bilibili.com/x/player/wbi/v2?cid=${info.cid}&aid=${info.aid}`;
    } else if (info.bvid) {
      url = `https://api.bilibili.com/x/player/v2?bvid=${info.bvid}`;
    }

    if (!url) {
      resolve([]);
      return;
    }

    try {
      const data = await httpRequest(url);
      log('字幕API响应: code=' + data.code);

      // 检查所有可能的字幕字段
      let subtitles = null;

      if (data.code === 0 && data.data) {
        // 尝试多种字幕字段
        subtitles = data.data?.subtitle?.subtitles ||          // 标准字段
                    data.data?.subtitles ||                     // 备用字段
                    data.data?.closed_caption?.subtitles ||    // cc字段
                    [];

        if (subtitles.length > 0) {
          log('字幕数量: ' + subtitles.length);
          resolve(subtitles);
          return;
        }

        // 如果没有字幕，尝试其他API
        log('标准API无字幕，尝试其他接口...');

        // 尝试获取视频所有字幕列表
        if (info.cid) {
          const subListUrl = `https://api.bilibili.com/x/player/v2?cid=${info.cid}&aid=${info.aid}&fnval=16`;
          try {
            const data2 = await httpRequest(subListUrl);
            if (data2.data?.subtitle?.subtitles) {
              log('字幕列表2: ' + data2.data.subtitle.subtitles.length);
              resolve(data2.data.subtitle.subtitles);
              return;
            }
          } catch (e) {}
        }
      }

      log('无字幕或API错误: code=' + data.code + ', message=' + data.message);
      resolve([]);
    } catch (e) {
      log('请求字幕列表失败: ' + e.message);
      resolve([]);
    }
  });
}

// 获取字幕内容
async function fetchSubtitleContent(subtitleUrl) {
  // 处理各种格式的URL
  let url = subtitleUrl.trim();
  // 确保URL以 https:// 开头
  if (url.startsWith('//')) {
    url = 'https:' + url;
  } else if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = 'https://' + url;
  }
  log('请求字幕内容: ' + url);
  const data = await httpRequest(url);
  log('字幕内容获取成功, body长度: ' + (data.body?.length || 0));
  return data;
}

// 根据时间获取当前字幕
function getSubtitleByTime(currentTime, subtitle) {
  if (!subtitle?.body) {
    log('字幕数据无body');
    return null;
  }

  // 查找当前时间对应的字幕
  for (const item of subtitle.body) {
    if (currentTime >= item.from && currentTime <= item.to) {
      log('匹配字幕: time=' + currentTime + ', from=' + item.from + ', to=' + item.to + ', content=' + item.content.substring(0, 20));
      return item.content;
    }
  }

  // 没有匹配时，显示当前时间段的字幕用于调试
  if (subtitle.body.length > 0) {
    const nearItem = subtitle.body.find(item => Math.abs(currentTime - item.from) < 5);
    if (nearItem) {
      log('附近字幕: time=' + currentTime + ', from=' + nearItem.from + ', to=' + nearItem.to);
    }
  }
  return null;
}

function getCurrentTime() {
  try {
    const video = document.querySelector('video');
    if (video) return video.currentTime;
  } catch (e) {}
  return 0;
}

function getDuration() {
  try {
    const video = document.querySelector('video');
    if (video) return video.duration;
  } catch (e) {}
  return 0;
}

function getVideoTitle() {
  return document.querySelector('h1')?.textContent?.trim() ||
         document.title.replace('_哔哩哔哩_bilibili', '').trim() ||
         '未知视频';
}

// 记录上一次URL，用于检测SPA页面变化
let lastUrl = location.href;

function detectVideoChange() {
  // 检测URL变化
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    log('检测到URL变化，重置数据');
    cachedInfo = null;
    subtitleData = null;
    return;
  }

  // 同时检测bvid变化
  const urlMatch = location.pathname.match(/\/video\/(BV[\w]+)/);
  const pageBvid = urlMatch ? urlMatch[1] : null;

  if (pageBvid && cachedInfo && pageBvid !== cachedInfo.bvid) {
    log('检测到视频变化，重置数据');
    cachedInfo = null;
    subtitleData = null;
  }
}

async function checkAndSend() {
  const currentTime = getCurrentTime();
  const duration = getDuration();

  // 打印调试信息
  const info = getVideoInfo();
  if (!info.bvid && !info.cid && !info.aid) {
    // 没有视频信息，不处理
    return;
  }

  detectVideoChange();

  try {
    if (!subtitleData) {
      log('开始获取字幕列表, videoInfo: ' + JSON.stringify(info));
      const list = await fetchSubtitleList();
      log('字幕列表: ' + JSON.stringify(list));

      if (list && list.length > 0) {
        // 优先选择中文简体
        const zhCn = list.find(s =>
          s.lan === 'zh-CN' ||
          s.lan === 'ai-zh' ||
          s.lan_doc === '简体中文' ||
          s.lan_doc === '中文'
        );
        const subtitle = zhCn || list[0];
        log('选择字幕: ' + JSON.stringify(subtitle));
        subtitleData = await fetchSubtitleContent(subtitle.subtitle_url);
        subtitleData.source = getVideoTitle();
        log('字幕数据加载完成, body长度: ' + (subtitleData.body?.length || 0));
      } else {
        log('没有找到字幕');
      }
    }

    if (subtitleData) {
      const content = getSubtitleByTime(currentTime, subtitleData);
      if (content !== lastSubtitle) {
        lastSubtitle = content || '';
        if (lastSubtitle) {
          log('发送字幕: ' + lastSubtitle.substring(0, 20));
        }
        send({
          type: 'subtitle',
          content: lastSubtitle,
          from: currentTime,
          to: currentTime + 5,
          source: subtitleData.source || getVideoTitle(),
          currentTime,
          duration
        });
      }
    }
  } catch (e) {
    log('获取字幕失败: ' + e.message);
  }

  send({ type: 'time', currentTime, duration });
}

function startListener() {
  if (worker) worker.postMessage({ type: 'start' });
  log('字幕监听已启动');
}

function stopListener() {
  if (worker) worker.postMessage({ type: 'stop' });
}

// 监听来自popup的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'getStatus') {
    sendResponse({
      connected: isConnected,
      hasSubtitle: !!subtitleData,
      videoTitle: getVideoTitle()
    });
  }
});

// 初始化
if (document.readyState === 'complete') {
  createWorker();
  setTimeout(connect, 2000);
} else {
  window.addEventListener('load', () => {
    createWorker();
    setTimeout(connect, 2000);
  });
}

setInterval(detectVideoChange, 1000);

log('FloatCC Chrome扩展已加载');
