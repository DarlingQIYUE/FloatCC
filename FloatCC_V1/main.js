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
let wsClients = [];

// WebSocket服务器配置
const WS_PORT = 8765;

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
      nodeIntegration: false
    },
    // 最小化到托盘而不是任务栏
    show: false
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

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
  wss = new WebSocket.Server({ port: WS_PORT, host: '0.0.0.0' });

  wss.on('error', (error) => {
    console.error('[FloatCC] WebSocket服务器错误:', error.message);
  });

  wss.on('listening', () => {
    console.log(`[FloatCC] WebSocket服务器已启动: ws://0.0.0.0:${WS_PORT}`);
  });

  wss.on('connection', (ws) => {
    console.log('[FloatCC] 新客户端连接');
    wsClients.push(ws);

    // 发送欢迎消息
    ws.send(JSON.stringify({ type: 'connected', message: 'FloatCC已连接' }));

    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message);
        console.log('[FloatCC] 收到消息:', data.type);

        // 转发给渲染进程
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('subtitle-update', data);
        }

        // 广播给所有客户端
        wsClients.forEach(client => {
          if (client !== ws && client.readyState === WebSocket.OPEN) {
            client.send(message);
          }
        });
      } catch (e) {
        console.error('[FloatCC] 消息解析失败:', e);
      }
    });

    ws.on('close', () => {
      console.log('[FloatCC] 客户端断开连接');
      wsClients = wsClients.filter(client => client !== ws);
    });

    ws.on('error', (error) => {
      console.error('[FloatCC] WebSocket错误:', error);
    });
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
    if (mainWindow) {
      mainWindow.setOpacity(opacity);
    }
  });

  // 设置是否可拖拽
  ipcMain.on('set-draggable', (event, draggable) => {
    if (mainWindow) {
      // 使用CSS控制拖拽，app-region: drag/nodrag由渲染进程自己处理
      // 这里只发送消息给渲染进程
      console.log('[FloatCC] 拖拽状态:', draggable ? '启用' : '禁用');
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
      connectedClients: wsClients.length
    };
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
