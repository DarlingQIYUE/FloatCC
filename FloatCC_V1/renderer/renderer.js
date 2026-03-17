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
    // 固定：禁止拖动整个窗口，禁用其他按钮
    app.classList.remove('draggable');
    // 禁用其他按钮
    opacityBtn.disabled = true;
    minimizeBtn.disabled = true;
    closeBtn.disabled = true;
  } else {
    // 不固定：允许拖动整个窗口，启用所有按钮
    app.classList.add('draggable');
    // 启用所有按钮
    opacityBtn.disabled = false;
    minimizeBtn.disabled = false;
    closeBtn.disabled = false;
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
    }
  });

  // 监听透明度设置
  window.electronAPI.onSetOpacity((opacity) => {
    adjustOpacity(opacity);
  });

  // 初始获取连接状态
  window.electronAPI.getConnectionStatus().then(status => {
    console.log('[FloatCC] 连接状态:', status);
  });
}

// 按钮事件绑定
opacityBtn.addEventListener('click', toggleOpacityControl);
pinBtn.addEventListener('click', togglePin);
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

// 初始化状态
updateConnectionStatus(false);
// 默认不固定：整个窗口可拖动，所有按钮可用
document.getElementById('app').classList.add('draggable');

console.log('[FloatCC] 渲染进程初始化完成');
