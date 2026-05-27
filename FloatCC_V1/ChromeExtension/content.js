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
  // 同时通过 ws 推到主进程，方便用户在终端统一查看（避免再去 B 站页面开 F12）
  try {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'log', message: String(message) }));
    }
  } catch (e) {}
}

// 扩展上下文是否还有效（扩展被重载后旧页面上的 content script 会失效）
function isExtensionAlive() {
  try {
    return !!(chrome.runtime && chrome.runtime.id);
  } catch (e) {
    return false;
  }
}

// 安全调用 chrome.runtime.sendMessage，扩展失效时静默忽略并触发清理
function safeRuntimeSend(message, callback) {
  if (!isExtensionAlive()) {
    cleanupOrphan();
    return;
  }
  try {
    if (callback) {
      chrome.runtime.sendMessage(message, callback);
    } else {
      chrome.runtime.sendMessage(message);
    }
  } catch (e) {
    if (String(e && e.message).includes('Extension context invalidated')) {
      cleanupOrphan();
    } else {
      log('runtime.sendMessage 异常: ' + e.message);
    }
  }
}

// 扩展重载后，旧页面里这份 content script 变成孤儿，做一次彻底清理
let orphaned = false;
function cleanupOrphan() {
  if (orphaned) return;
  orphaned = true;
  log('扩展上下文已失效，停止本页 content script');
  try { stopListener(); } catch (e) {}
  try { if (worker) { worker.terminate(); worker = null; } } catch (e) {}
  try { if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; } } catch (e) {}
  try { if (ws) { ws.close(); ws = null; } } catch (e) {}
}

// 发送HTTP请求（通过background脚本代理，解决跨域和cookie问题）
function httpRequest(url) {
  return new Promise((resolve, reject) => {
    if (!isExtensionAlive()) {
      cleanupOrphan();
      reject(new Error('扩展上下文已失效'));
      return;
    }
    try {
      chrome.runtime.sendMessage({ type: 'fetch', url }, (res) => {
        // callback 是异步上下文，外层 try/catch 抓不到 — 这里再包一层
        try {
          if (!isExtensionAlive()) {
            cleanupOrphan();
            reject(new Error('扩展上下文已失效'));
            return;
          }
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message || '请求失败'));
            return;
          }
          if (res?.success) {
            resolve(res.data);
          } else {
            reject(new Error(res?.error || '请求失败'));
          }
        } catch (e) {
          if (String(e && e.message).includes('Extension context invalidated')) {
            cleanupOrphan();
          }
          reject(e);
        }
      });
    } catch (e) {
      if (String(e && e.message).includes('Extension context invalidated')) {
        cleanupOrphan();
      }
      reject(e);
    }
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
  if (orphaned) return;
  if (ws && ws.readyState === WebSocket.OPEN) return;
  try {
    ws = new WebSocket(WS_URL);
    ws.onopen = () => {
      log('已连接到FloatCC');
      isConnected = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      send({ type: 'connected', message: 'B站已连接' });
      sendHello();
      startListener();
      // 通知背景脚本连接状态
      safeRuntimeSend({ type: 'connectionStatus', connected: true });
    };
    ws.onmessage = (event) => {
      try { JSON.parse(event.data); } catch (e) {}
    };
    ws.onclose = () => {
      log('连接断开，3秒后重连...');
      isConnected = false;
      if (!orphaned) {
        reconnectTimer = setTimeout(connect, 3000);
      }
      stopListener();
      safeRuntimeSend({ type: 'connectionStatus', connected: false });
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

// 上报当前视频元数据（让客户端在主进程那边能被准确命名）
function sendHello() {
  const info = getVideoInfo();
  send({
    type: 'hello',
    source: getVideoTitle(),
    bvid: info.bvid || null
  });
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

    // 关键：B 站 SPA 切换时 __INITIAL_STATE__/player 内部状态会滞后于 URL，
    // getVideoInfo() 可能返回 "新 bvid + 旧 cid"，导致 fetch 拉到旧视频字幕。
    // 这里强制用 view API 按 bvid 重新校准 cid/aid，覆盖 cache 里可能脏的值。
    if (info.bvid) {
      try {
        log('[CC] fetchSubtitleList: 用 view API 校准 cid/aid，bvid=' + info.bvid);
        const viewData = await httpRequest(`https://api.bilibili.com/x/web-interface/view?bvid=${info.bvid}`);
        if (viewData.code === 0 && viewData.data) {
          const oldCid = info.cid;
          const oldAid = info.aid;
          info.cid = viewData.data.cid;
          info.aid = viewData.data.aid;
          if (cachedInfo) {
            cachedInfo.cid = info.cid;
            cachedInfo.aid = info.aid;
          }
          log('[CC] view API 返回 cid=' + info.cid + ' aid=' + info.aid
            + (oldCid && oldCid !== info.cid ? ' (cid纠正: ' + oldCid + ' -> ' + info.cid + ')' : '')
            + (oldAid && oldAid !== info.aid ? ' (aid纠正: ' + oldAid + ' -> ' + info.aid + ')' : ''));
        }
      } catch (e) {
        log('[CC] view API 失败: ' + e.message);
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
      let subtitles = [];

      if (data.code === 0 && data.data) {
        subtitles = data.data?.subtitle?.subtitles ||          // 标准字段
                    data.data?.subtitles ||                     // 备用字段
                    data.data?.closed_caption?.subtitles ||    // cc字段
                    [];
      }

      // 归属校验：B 站对没有字幕的视频，接口有时会串台返回「其他视频」的字幕，
      // 内容毫无关联。AI 字幕的 subtitle_url 形如 .../ai_subtitle/prod/{aid}{cid}xxx，
      // 用当前视频的 aid+cid 校验，对不上的直接丢弃。人工字幕 URL 格式不同，放行不误杀。
      const tag = '' + (info.aid || '') + (info.cid || '');
      const valid = subtitles.filter(s => {
        const u = s.subtitle_url || '';
        if (!u.includes('ai_subtitle')) return true;      // 非 AI 字幕放行
        if (!info.aid || !info.cid) return true;          // 信息不全放行
        const belongs = u.includes(tag);
        if (!belongs) {
          log('[CC] 丢弃串台字幕 lan=' + s.lan + ' 期望含 ' + tag + ' 实际 url=' + u.slice(0, 90));
        }
        return belongs;
      });

      log('[CC] 字幕数 原始=' + subtitles.length + ' 校验后=' + valid.length);
      resolve(valid);
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
// 视频切换冷却：SPA 跳转后 B 站全局状态需要时间稳定，期间不 fetch 字幕避免拉到旧 cid
let videoSwitchedAt = 0;
const SWITCH_COOLDOWN_MS = 1500;

function detectVideoChange() {
  // 检测URL变化
  if (location.href !== lastUrl) {
    const oldUrl = lastUrl;
    lastUrl = location.href;
    log('[CC] URL变化 ' + oldUrl + ' -> ' + lastUrl);
    log('[CC] 重置: cachedInfo/subtitleData/lastSubtitle 清空，进入冷却期');
    cachedInfo = null;
    subtitleData = null;
    lastSubtitle = '';
    videoSwitchedAt = Date.now();
    // 主动告知主进程"当前没有字幕"，避免渲染进程残留旧视频字幕
    const title = getVideoTitle();
    log('[CC] 发送空 subtitle 强制清屏, source=' + title);
    send({ type: 'subtitle', content: '', source: title });
    sendHello();
    return;
  }

  // 同时检测bvid变化
  const urlMatch = location.pathname.match(/\/video\/(BV[\w]+)/);
  const pageBvid = urlMatch ? urlMatch[1] : null;

  if (pageBvid && cachedInfo && pageBvid !== cachedInfo.bvid) {
    log('[CC] bvid变化 ' + cachedInfo.bvid + ' -> ' + pageBvid);
    cachedInfo = null;
    subtitleData = null;
    lastSubtitle = '';
    videoSwitchedAt = Date.now();
    const title = getVideoTitle();
    log('[CC] 发送空 subtitle 强制清屏, source=' + title);
    send({ type: 'subtitle', content: '', source: title });
    sendHello();
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

  // 视频切换后的冷却期：B 站 __INITIAL_STATE__/player 内部需要时间更新，
  // 此时拉字幕会拿到旧视频的 cid，导致显示错乱
  const elapsed = Date.now() - videoSwitchedAt;
  if (elapsed < SWITCH_COOLDOWN_MS) {
    log('[CC] 冷却期(' + elapsed + 'ms / ' + SWITCH_COOLDOWN_MS + 'ms)，跳过字幕处理');
    send({ type: 'time', currentTime, duration });
    return;
  }

  try {
    if (!subtitleData) {
      log('[CC] subtitleData为空，开始 fetch。info=' + JSON.stringify(info) + ' currentTime=' + currentTime);
      // race token：fetch 跨多个 await，期间 URL 又变就丢弃
      const tokenUrl = lastUrl;
      const list = await fetchSubtitleList();
      if (lastUrl !== tokenUrl) {
        log('[CC] fetchSubtitleList 期间 URL 又变了，丢弃。tokenUrl=' + tokenUrl + ' now=' + lastUrl);
        send({ type: 'time', currentTime, duration });
        return;
      }
      log('[CC] fetchSubtitleList 完成, len=' + (list?.length || 0));

      if (list && list.length > 0) {
        // 优先选择中文简体
        const zhCn = list.find(s =>
          s.lan === 'zh-CN' ||
          s.lan === 'ai-zh' ||
          s.lan_doc === '简体中文' ||
          s.lan_doc === '中文'
        );
        const subtitle = zhCn || list[0];
        log('[CC] 选择字幕 lan=' + subtitle.lan + ' subtitle_url=' + subtitle.subtitle_url);
        const fetched = await fetchSubtitleContent(subtitle.subtitle_url);
        if (lastUrl !== tokenUrl) {
          log('[CC] fetchSubtitleContent 期间 URL 又变了，丢弃。tokenUrl=' + tokenUrl + ' now=' + lastUrl);
          send({ type: 'time', currentTime, duration });
          return;
        }
        subtitleData = fetched;
        subtitleData.source = getVideoTitle();
        log('[CC] subtitleData写入完成 body长度=' + (subtitleData.body?.length || 0) + ' source=' + subtitleData.source);
      } else {
        log('[CC] fetch返回空字幕列表');
      }
    }

    if (subtitleData) {
      const content = getSubtitleByTime(currentTime, subtitleData);
      if (content !== lastSubtitle) {
        lastSubtitle = content || '';
        log('[CC] 推送subtitle currentTime=' + currentTime + ' content=' + (lastSubtitle || '(空)').substring(0, 30) + ' source=' + (subtitleData.source || getVideoTitle()));
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
