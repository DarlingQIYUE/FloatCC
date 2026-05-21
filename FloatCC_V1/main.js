// 解决Windows控制台中文乱码
process.env.CHROME_DEVEL_SANDBOX = '0';
if (process.platform === 'win32') {
  process.env.ELECTRON_NO_ASAR = '1';
  // 设置控制台编码为UTF-8
  try {
    require('child_process').execSync('chcp 65001', { stdio: 'ignore' });
  } catch (e) {}
}

const { app, BrowserWindow, ipcMain, screen, Menu, nativeImage } = require('electron');
const path = require('path');
const WebSocket = require('ws');

let mainWindow = null;
let wss = null;
// 客户端注册：id -> { id, ws, source, bvid, currentTime, duration, connectedAt }
let clients = new Map();
let clientIdSeq = 0;
let currentClientId = null;

// WebSocket服务器配置
const WS_PORT = 8765;
const WS_HOST = '127.0.0.1';
const ALLOWED_WS_ORIGINS = new Set([
  'https://www.bilibili.com',
  'https://bilibili.com'
]);
function isAllowedOrigin(origin) {
  if (!origin) return false;
  if (ALLOWED_WS_ORIGINS.has(origin)) return true;
  if (origin.startsWith('chrome-extension://')) return true;
  return false;
}

// 创建悬浮窗
function createWindow() {
  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;

  mainWindow = new BrowserWindow({
    width: 600,
    height: 150,
    x: screenWidth - 620,
    y: screenHeight - 250,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: true,
    skipTaskbar: false,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false
    },
    // 最小化到托盘而不是任务栏
    show: false
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // 拒绝任何窗口内导航与新窗口打开请求，防止恶意字幕中的链接被点开
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (e) => e.preventDefault());

  // 窗口准备好后显示
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    console.log('[FloatCC] 悬浮窗已启动');
  });

  // 设置任务栏右键菜单
  // 启用拖拽
  mainWindow.setIgnoreMouseEvents(false);

  console.log('[FloatCC] 窗口创建完成');
}

// 启动WebSocket服务器
function startWebSocketServer() {
  wss = new WebSocket.Server({
    port: WS_PORT,
    host: WS_HOST,
    verifyClient: (info, cb) => {
      const origin = info.req.headers.origin;
      if (!isAllowedOrigin(origin)) {
        console.warn('[FloatCC] 拒绝未授权 Origin:', origin);
        return cb(false, 403, 'Forbidden origin');
      }
      cb(true);
    }
  });

  wss.on('error', (error) => {
    console.error('[FloatCC] WebSocket服务器错误:', error.message);
  });

  wss.on('listening', () => {
    console.log(`[FloatCC] WebSocket服务器已启动: ws://${WS_HOST}:${WS_PORT}`);
  });

  wss.on('connection', (ws) => {
    const id = ++clientIdSeq;
    const client = {
      id, ws,
      source: null, bvid: null,
      currentTime: 0, duration: 0,
      connectedAt: Date.now()
    };
    clients.set(id, client);
    console.log('[FloatCC] 新客户端连接 id=' + id);

    // 发送欢迎消息
    ws.send(JSON.stringify({ type: 'connected', message: 'FloatCC已连接' }));

    // 第一个客户端自动成为当前源
    if (currentClientId === null) {
      currentClientId = id;
    }

    notifyConnectionStatus();
    broadcastClients();

    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message);
        const c = clients.get(id);
        if (!c) return;

        // 提取元数据
        let metaChanged = false;
        if (data.source && data.source !== c.source) {
          c.source = data.source;
          metaChanged = true;
        }
        if (data.bvid && data.bvid !== c.bvid) {
          c.bvid = data.bvid;
          metaChanged = true;
        }
        if (typeof data.currentTime === 'number') c.currentTime = data.currentTime;
        if (typeof data.duration === 'number') c.duration = data.duration;
        if (metaChanged) broadcastClients();

        // hello 仅用于上报视频元数据，不转发给渲染进程
        if (data.type === 'hello') return;

        // 仅转发当前选中客户端的消息
        if (id === currentClientId && mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('subtitle-update', data);
        }
      } catch (e) {
        console.error('[FloatCC] 消息解析失败:', e);
      }
    });

    ws.on('close', () => {
      console.log('[FloatCC] 客户端断开 id=' + id);
      clients.delete(id);
      // 如果断开的是当前选中，自动切到下一个最早连上的
      if (id === currentClientId) {
        pickNextClient();
      }
      notifyConnectionStatus();
      broadcastClients();
    });

    ws.on('error', (error) => {
      console.error('[FloatCC] WebSocket错误:', error);
    });
  });
}

// 当前客户端列表（供渲染进程展示）
function getClientList() {
  return Array.from(clients.values())
    .sort((a, b) => a.id - b.id)
    .map(c => ({
      id: c.id,
      source: c.source || '未知视频',
      bvid: c.bvid || null,
      isActive: c.id === currentClientId
    }));
}

function broadcastClients() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('clients-update', getClientList());
}

function selectClient(id) {
  if (id !== null && !clients.has(id)) return false;
  if (currentClientId === id) return true;
  currentClientId = id;
  broadcastClients();
  // 切源时通知渲染进程清空旧字幕
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('subtitle-update', { type: 'source-changed' });
  }
  return true;
}

// 从在线客户端里挑一个接任，按 id 升序（最早连上的优先）
function pickNextClient() {
  if (clients.size === 0) {
    currentClientId = null;
    return;
  }
  const next = Array.from(clients.values()).sort((a, b) => a.id - b.id)[0];
  currentClientId = next.id;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('subtitle-update', { type: 'source-changed' });
  }
}

// 通知渲染进程当前连接状态
function notifyConnectionStatus() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('subtitle-update', {
    type: clients.size > 0 ? 'connected' : 'disconnect'
  });
}

// 处理IPC消息
function setupIPC() {
  // 最小化窗口
  ipcMain.on('minimize-window', () => {
    if (mainWindow) mainWindow.minimize();
  });

  // 关闭窗口
  ipcMain.on('close-window', () => {
    app.isQuitting = true;
    app.quit();
  });

  // 调整透明度
  ipcMain.on('set-opacity', (event, opacity) => {
    if (!mainWindow) return;
    const v = Number(opacity);
    if (!Number.isFinite(v)) return;
    mainWindow.setOpacity(Math.min(1, Math.max(0.1, v)));
  });

  // 设置是否可拖拽
  ipcMain.on('set-draggable', (event, draggable) => {
    if (mainWindow) {
      // 使用CSS控制拖拽，app-region: drag/nodrag由渲染进程自己处理
      // 这里只发送消息给渲染进程
      console.log('[FloatCC] 拖拽状态:', draggable ? '启用' : '禁用');
    }
  });

  // 设置是否可调整窗口大小
  ipcMain.on('set-resizable', (event, resizable) => {
    if (mainWindow) {
      mainWindow.setResizable(resizable);
      console.log('[FloatCC] 窗口调整大小:', resizable ? '允许' : '禁止');
    }
  });

  // 开始拖拽
  ipcMain.on('start-drag', () => {
    // 无边框窗口使用系统拖拽
  });

  // 获取连接状态
  ipcMain.handle('get-connection-status', () => {
    return {
      wsPort: WS_PORT,
      connectedClients: clients.size
    };
  });

  // 获取客户端列表
  ipcMain.handle('get-clients', () => getClientList());

  // 切换当前字幕源
  ipcMain.on('select-client', (event, id) => {
    selectClient(typeof id === 'number' ? id : null);
  });
}

// 应用就绪
app.whenReady().then(() => {
  console.log('[FloatCC] 应用启动中...');
  createWindow();
  startWebSocketServer();
  setupIPC();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// 所有窗口关闭
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// 应用退出前清理
app.on('before-quit', () => {
  app.isQuitting = true;
  if (wss) {
    wss.close();
  }
});

// 全局异常处理
process.on('uncaughtException', (error) => {
  console.error('[FloatCC] 未捕获异常:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[FloatCC] 未处理的Promise拒绝:', reason);
});
