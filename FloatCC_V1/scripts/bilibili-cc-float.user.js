// ==UserScript==
// @name         FloatCC 字幕推送
// @namespace    floatcc
// @version      1.4.0
// @description  将B站视频字幕实时推送到FloatCC悬浮字幕应用
// @author       FloatCC
// @match        https://www.bilibili.com/video/*
// @match        https://www.bilibili.com/bangumi/play/*
// @match        https://www.bilibili.com/cheese/play/*
// @icon         https://www.bilibili.com/favicon.ico
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @connect     api.bilibili.com
// @connect     comment.bilibili.com
// @connect     aisubtitle.hdslb.com
// @run-at       document-end
// ==/UserScript==

(function() {
  'use strict';

  const WS_URL = 'ws://localhost:8765';

  let ws = null;
  let reconnectTimer = null;
  let lastSubtitle = '';
  let subtitleData = null;
  let isConnected = false;
  let worker = null;

  // 缓存视频信息
  let cachedInfo = null;

  function log(message) {
    console.log('[FloatCC推送]', message);
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
          }, 300);
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
      };
      ws.onmessage = (event) => {
        try { JSON.parse(event.data); } catch (e) {}
      };
      ws.onclose = () => {
        log('连接断开，3秒后重连...');
        isConnected = false;
        reconnectTimer = setTimeout(connect, 3000);
        stopListener();
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

  // 核心：获取视频信息 - 参考downloadCC.js的实现
  function getVideoInfo() {
    if (cachedInfo) return cachedInfo;

    const info = {};

    // 1. 从URL获取bvid
    const urlMatch = location.pathname.match(/\/video\/(BV[\w]+)/);
    if (urlMatch) {
      info.bvid = urlMatch[1];
    }

    // 2. 从 __INITIAL_STATE__.cidMap[bvid] 获取 cid, aid (最重要!)
    try {
      const state = window.__INITIAL_STATE__;
      const cidMap = state?.cidMap;
      const page = state?.p || 1;

      log('__INITIAL_STATE__ 存在: ' + !!state);
      log('cidMap 存在: ' + !!cidMap);
      if (cidMap) {
        log('cidMap keys: ' + Object.keys(cidMap).slice(0, 5).join(','));
      }

      if (cidMap && info.bvid) {
        const ep = cidMap[info.bvid];
        log('cidMap[bvid] ep: ' + JSON.stringify(ep));
        if (ep) {
          info.aid = ep.aid;
          info.cid = ep.cids?.[page] || ep.cids?.[1];
          log('从cidMap获取: aid=' + info.aid + ', cid=' + info.cid);
        }
      }
    } catch (e) {
      log('cidMap获取失败: ' + e.message);
    }

    // 2.5 打印 __INITIAL_STATE__ 的键
    try {
      const state = window.__INITIAL_STATE__;
      if (state) {
        log('__INITIAL_STATE__ keys: ' + Object.keys(state).join(','));
      }
    } catch (e) {}

    // 3. 备选：从 __INITIAL_STATE__.videoData 获取
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

    // 4. 备选：从 playerRaw 获取
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

    // 4.5 备选：从 window.player 获取
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

    // 4.6 备选：从 __playinfo__ 获取 (H5播放器数据)
    if (!info.cid || !info.aid) {
      try {
        const playInfo = window.__playinfo__ || window.__PLAYINFO__;
        if (playInfo) {
          // playInfo结构可能包含 cid
          log('__playinfo__ 存在');
        }
      } catch (e) {}
    }

    // 5. 备选：从页面URL参数获取 (旧版播放器)
    if (!info.cid) {
      const cidMatch = location.search.match(/[?&]cid=(\d+)/);
      if (cidMatch) info.cid = cidMatch[1];
    }
    if (!info.aid) {
      const aidMatch = location.search.match(/[?&]aid=(\d+)/);
      if (aidMatch) info.aid = aidMatch[1];
    }

    log('最终视频信息: bvid=' + info.bvid + ', aid=' + info.aid + ', cid=' + info.cid);

    // 如果有bvid但没有cid/aid，尝试用另一个API获取
    if (info.bvid && (!info.cid || !info.aid)) {
      log('尝试通过view API获取cid...');
      // 这个API调用是异步的，暂时跳过，先用已有信息
    }

    cachedInfo = info;
    return info;
  }

  // 获取字幕列表 - 使用downloadCC.js相同的API
  function fetchSubtitleList() {
    return new Promise(async (resolve, reject) => {
      let info = getVideoInfo();

      // 如果有bvid但没有cid，尝试通过view API获取
      if (info.bvid && !info.cid) {
        log('尝试通过view API获取cid...');
        try {
          const viewData = await new Promise((res, rej) => {
            GM_xmlhttpRequest({
              method: 'GET',
              url: `https://api.bilibili.com/x/web-interface/view?bvid=${info.bvid}`,
              onload: (r) => {
                try { res(JSON.parse(r.response)); } catch(e) { res({code:-1}); }
              },
              onerror: () => res({code:-1})
            });
          });
          if (viewData.code === 0 && viewData.data) {
            info.cid = viewData.data.cid;
            info.aid = viewData.data.aid;
            log('view API获取成功: cid=' + info.cid + ', aid=' + info.aid);
          }
        } catch (e) {
          log('view API获取失败: ' + e.message);
        }
      }

      let url = '';

      // 使用downloadCC.js的API构建方式
      if (info.cid) {
        // 有cid用wbi接口
        url = `https://api.bilibili.com/x/player/wbi/v2?cid=${info.cid}&aid=${info.aid}`;
        log('请求字幕API (wbi): ' + url);
      } else if (info.bvid) {
        // 没有cid尝试只用bvid
        url = `https://api.bilibili.com/x/player/v2?bvid=${info.bvid}`;
        log('请求字幕API (bvid only): ' + url);
      }

      if (!url) {
        log('无法构建API URL');
        resolve([]);
        return;
      }

      GM_xmlhttpRequest({
        method: 'GET',
        url: url,
        onload: (res) => {
          log('API响应状态: ' + res.status);
          try {
            const data = JSON.parse(res.response);
            log('API响应: code=' + data.code);

            if (data.code === 0 && data.data?.subtitle?.subtitles) {
              log('字幕数量: ' + data.data.subtitle.subtitles.length);
              resolve(data.data.subtitle.subtitles);
            } else if (data.code === -404) {
              // -404时尝试备用API (APP弹幕)
              log('主API返回-404，尝试备用API');
              const backupUrl = `//api.bilibili.com/x/v2/dm/view?aid=${info.aid}&oid=${info.cid}&type=1`;
              log('备用API: ' + backupUrl);
              GM_xmlhttpRequest({
                method: 'GET',
                url: backupUrl,
                onload: (res2) => {
                  try {
                    const data2 = JSON.parse(res2.response);
                    if (data2.code === 0 && data2.data?.subtitle?.subtitles) {
                      log('备用API字幕数量: ' + data2.data.subtitle.subtitles.length);
                      resolve(data2.data.subtitle.subtitles);
                    } else {
                      resolve([]);
                    }
                  } catch (e) {
                    resolve([]);
                  }
                },
                onerror: () => resolve([])
              });
            } else {
              log('API返回: code=' + data.code + ', message=' + data.message);
              resolve([]);
            }
          } catch (e) {
            log('解析失败: ' + e.message);
            resolve([]);
          }
        },
        onerror: (err) => {
          log('请求失败: ' + err.error);
          resolve([]);
        }
      });
    });
  }

  // 获取字幕内容
  function fetchSubtitleContent(subtitleUrl) {
    return new Promise((resolve, reject) => {
      const url = 'https:' + subtitleUrl.replace(/^\/\//, '');
      log('请求字幕内容: ' + url);
      GM_xmlhttpRequest({
        method: 'GET',
        url: url,
        onload: (res) => {
          try {
            resolve(JSON.parse(res.response));
          } catch (e) {
            reject(e);
          }
        },
        onerror: reject
      });
    });
  }

  // 根据时间获取当前字幕
  function getSubtitleByTime(currentTime, subtitle) {
    if (!subtitle?.body) return null;
    for (const item of subtitle.body) {
      if (currentTime >= item.from && currentTime <= item.to) {
        return item.content;
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

  // 检测视频是否切换
  function detectVideoChange() {
    const info = getVideoInfo();
    const currentBvid = info.bvid;

    // 从页面获取当前bvid
    const urlMatch = location.pathname.match(/\/video\/(BV[\w]+)/);
    const pageBvid = urlMatch ? urlMatch[1] : null;

    if (pageBvid && pageBvid !== currentBvid) {
      log('检测到视频切换: ' + currentBvid + ' -> ' + pageBvid);
      cachedInfo = null; // 清除缓存
      subtitleData = null; // 清除字幕数据
    }
  }

  async function checkAndSend() {
    const currentTime = getCurrentTime();
    const duration = getDuration();

    // 检测视频切换
    detectVideoChange();

    // 尝试获取字幕数据
    try {
      if (!subtitleData) {
        const list = await fetchSubtitleList();
        if (list && list.length > 0) {
          // 优先中文简体
          const zhCn = list.find(s => s.lan === 'zh-CN' || s.lan_doc === '简体中文');
          const subtitle = zhCn || list[0];
          log('选择字幕: ' + (subtitle.lan_doc || subtitle.lan));
          subtitleData = await fetchSubtitleContent(subtitle.subtitle_url);
          subtitleData.source = getVideoTitle();
          log('字幕数据加载完成');
        }
      }

      if (subtitleData) {
        const content = getSubtitleByTime(currentTime, subtitleData);
        if (content !== lastSubtitle) {
          lastSubtitle = content || '';
          send({
            type: 'subtitle',
            content: lastSubtitle,
            from: currentTime,
            to: currentTime + 5,
            source: subtitleData.source || getVideoTitle(),
            currentTime,
            duration
          });
          if (lastSubtitle) log('发送字幕: ' + lastSubtitle.substring(0, 20));
        }
      }
    } catch (e) {
      log('获取字幕失败: ' + e.message);
    }

    // 持续发送时间
    send({ type: 'time', currentTime, duration });
  }

  function startListener() {
    if (worker) worker.postMessage({ type: 'start' });
    log('字幕监听已启动');
  }

  function stopListener() {
    if (worker) worker.postMessage({ type: 'stop' });
  }

  window.addEventListener('beforeunload', () => {
    send({ type: 'close' });
    if (ws) ws.close();
    if (worker) worker.terminate();
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

  // 定期检测视频变化
  setInterval(detectVideoChange, 5000);

  log('FloatCC 字幕推送脚本 v1.4.0 已加载');
})();
