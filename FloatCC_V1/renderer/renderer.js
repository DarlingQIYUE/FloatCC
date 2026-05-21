// FloatCC 悬浮字幕渲染进程
console.log('[FloatCC] 渲染进程启动');

let currentSubtitle = '';
let isPinned = false;  // 默认不固定，窗口可拖动
let currentOpacity = 0.9;

// DOM元素
const subtitleText = document.getElementById('subtitle-text');
const subtitleContainer = document.getElementById('subtitle-container');
const statusDot = document.querySelector('.status-dot');
const statusText = document.querySelector('.status-text');
const timeInfo = document.getElementById('time-info');
const sourceInfo = document.getElementById('source-info');
const opacityControl = document.getElementById('opacity-control');
const opacitySlider = document.getElementById('opacity-slider');
const opacityValue = document.getElementById('opacity-value');

// 按钮元素
const opacityBtn = document.getElementById('opacity-btn');
const pinBtn = document.getElementById('pin-btn');
const minimizeBtn = document.getElementById('minimize-btn');
const closeBtn = document.getElementById('close-btn');
const fontBtn = document.getElementById('font-btn');
const fontPanel = document.getElementById('font-panel');
const fontColor = document.getElementById('font-color');
const fontSize = document.getElementById('font-size');
const fontSizeValue = document.getElementById('font-size-value');
const sourceBtn = document.getElementById('source-btn');
const sourcePanel = document.getElementById('source-panel');

let clientsList = [];

// 更新字幕显示
function updateSubtitle(data) {
  if (!data || !data.content) {
    subtitleText.textContent = '等待字幕数据...';
    subtitleText.classList.add('empty');
    subtitleText.classList.remove('highlight');
    return;
  }

  subtitleText.classList.remove('empty');

  // 简单动画效果
  if (data.content !== currentSubtitle) {
    subtitleText.style.opacity = '0';
    setTimeout(() => {
      subtitleText.textContent = data.content;
      subtitleText.style.opacity = '1';
    }, 50);
    currentSubtitle = data.content;
  }

  // 更新时间信息
  if (data.from !== undefined && data.to !== undefined) {
    const fromTime = formatTime(data.from);
    const toTime = formatTime(data.to);
    timeInfo.textContent = `${fromTime} / ${toTime}`;
  }

  // 更新来源
  if (data.source) {
    sourceInfo.textContent = data.source;
    sourceInfo.classList.add('connected');
  }
}

// 格式化时间
function formatTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

// 更新连接状态
function updateConnectionStatus(connected) {
  if (connected) {
    statusDot.classList.add('connected');
    statusDot.classList.remove('disconnected');
    statusText.textContent = '已连接';
  } else {
    statusDot.classList.remove('connected');
    statusDot.classList.add('disconnected');
    statusText.textContent = '等待连接...';
  }
}

// 切换置顶状态
function togglePin() {
  isPinned = !isPinned;
  pinBtn.classList.toggle('active', isPinned);

  const app = document.getElementById('app');

  if (isPinned) {
    // 固定：禁止拖动整个窗口，禁用其他按钮，禁止调整窗口大小
    app.classList.remove('draggable');
    // 禁用其他按钮
    opacityBtn.disabled = true;
    minimizeBtn.disabled = true;
    closeBtn.disabled = true;
    fontBtn.disabled = true;
    sourceBtn.disabled = true;
    // 固定时收起所有面板
    sourcePanel.style.display = 'none';
    fontPanel.style.display = 'none';
    // 禁止调整窗口大小
    if (window.electronAPI) {
      window.electronAPI.setResizable(false);
    }
  } else {
    // 不固定：允许拖动整个窗口，启用所有按钮，允许调整窗口大小
    app.classList.add('draggable');
    // 启用所有按钮
    opacityBtn.disabled = false;
    minimizeBtn.disabled = false;
    closeBtn.disabled = false;
    fontBtn.disabled = false;
    sourceBtn.disabled = false;
    // 允许调整窗口大小
    if (window.electronAPI) {
      window.electronAPI.setResizable(true);
    }
  }

  if (window.electronAPI) {
    // 透明度保持一致
    window.electronAPI.setOpacity(currentOpacity);
  }
}

// 切换透明度控制显示
function toggleOpacityControl() {
  const isVisible = opacityControl.style.display === 'flex';
  opacityControl.style.display = isVisible ? 'none' : 'flex';
}

// 渲染字幕源面板
function renderSourcePanel() {
  sourcePanel.innerHTML = '';
  if (!clientsList || clientsList.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'source-item empty';
    empty.textContent = '没有正在播放的视频';
    sourcePanel.appendChild(empty);
    return;
  }
  clientsList.forEach(c => {
    const item = document.createElement('div');
    item.className = 'source-item' + (c.isActive ? ' active' : '');
    item.textContent = c.source;
    item.title = c.source;
    item.addEventListener('click', () => {
      if (window.electronAPI) window.electronAPI.selectClient(c.id);
      sourcePanel.style.display = 'none';
    });
    sourcePanel.appendChild(item);
  });
}

// 切换字幕源面板
function toggleSourcePanel() {
  const isVisible = sourcePanel.style.display === 'block';
  if (isVisible) {
    sourcePanel.style.display = 'none';
  } else {
    renderSourcePanel();
    sourcePanel.style.display = 'block';
  }
}

// 切换文字设置面板
function toggleFontPanel() {
  const isVisible = fontPanel.style.display === 'flex';
  fontPanel.style.display = isVisible ? 'none' : 'flex';
}

// 调整透明度
function adjustOpacity(value) {
  currentOpacity = value;
  opacitySlider.value = value;
  opacityValue.textContent = `${Math.round(value * 100)}%`;

  if (window.electronAPI) {
    window.electronAPI.setOpacity(value);
  }
}

// 事件监听 - 从主进程接收字幕更新
if (window.electronAPI) {
  window.electronAPI.onSubtitleUpdate((data) => {
    console.log('[FloatCC] 收到字幕更新:', data);

    if (data.type === 'connected') {
      updateConnectionStatus(true);
    } else if (data.type === 'subtitle') {
      updateSubtitle(data);
    } else if (data.type === 'time') {
      // 更新时间
      if (data.currentTime !== undefined) {
        const current = formatTime(data.currentTime);
        timeInfo.textContent = `${current} / ${data.duration ? formatTime(data.duration) : '--:--'}`;
      }
    } else if (data.type === 'close' || data.type === 'disconnect') {
      updateConnectionStatus(false);
    } else if (data.type === 'source-changed') {
      // 切换字幕源时清空字幕等下一帧推送
      currentSubtitle = '';
      subtitleText.textContent = '等待字幕数据...';
      subtitleText.classList.add('empty');
      timeInfo.textContent = '--:-- / --:--';
      sourceInfo.textContent = '未连接';
      sourceInfo.classList.remove('connected');
    }
  });

  // 监听客户端列表变化
  window.electronAPI.onClientsUpdate((list) => {
    clientsList = list || [];
    if (sourcePanel.style.display === 'block') renderSourcePanel();
  });

  // 监听透明度设置
  window.electronAPI.onSetOpacity((opacity) => {
    adjustOpacity(opacity);
  });

  // 初始获取连接状态（防止渲染进程晚于客户端连接导致首次通知丢失）
  window.electronAPI.getConnectionStatus().then(status => {
    console.log('[FloatCC] 连接状态:', status);
    if (status && status.connectedClients > 0) {
      updateConnectionStatus(true);
    }
  });

  // 初始拉一次客户端列表
  window.electronAPI.getClients().then(list => {
    clientsList = list || [];
  });
}

// 按钮事件绑定
opacityBtn.addEventListener('click', toggleOpacityControl);
pinBtn.addEventListener('click', togglePin);
sourceBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  toggleSourcePanel();
});
fontBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  toggleFontPanel();
});

// 点击面板外部时收起
document.addEventListener('click', (e) => {
  if (sourcePanel.style.display === 'block'
      && !sourcePanel.contains(e.target)
      && e.target !== sourceBtn) {
    sourcePanel.style.display = 'none';
  }
  if (fontPanel.style.display === 'flex'
      && !fontPanel.contains(e.target)
      && e.target !== fontBtn) {
    fontPanel.style.display = 'none';
  }
});
minimizeBtn.addEventListener('click', () => {
  if (window.electronAPI) {
    window.electronAPI.minimizeWindow();
  }
});
closeBtn.addEventListener('click', () => {
  if (window.electronAPI) {
    window.electronAPI.closeWindow();
  }
});

// 透明度滑块事件
opacitySlider.addEventListener('input', (e) => {
  adjustOpacity(parseFloat(e.target.value));
});

// 颜色 + 字号事件
fontColor.addEventListener('input', (e) => {
  subtitleText.style.color = e.target.value;
});
fontSize.addEventListener('input', (e) => {
  const v = parseInt(e.target.value, 10);
  subtitleText.style.fontSize = v + 'px';
  fontSizeValue.textContent = v + 'px';
});

// 初始化状态
updateConnectionStatus(false);
// 默认不固定：整个窗口可拖动，所有按钮可用
document.getElementById('app').classList.add('draggable');

console.log('[FloatCC] 渲染进程初始化完成');
