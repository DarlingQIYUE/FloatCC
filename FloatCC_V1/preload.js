const { contextBridge, ipcRenderer } = require('electron');

// 暴露API给渲染进程
contextBridge.exposeInMainWorld('electronAPI', {
  // 窗口控制
  minimizeWindow: () => ipcRenderer.send('minimize-window'),
  closeWindow: () => ipcRenderer.send('close-window'),
  setOpacity: (opacity) => ipcRenderer.send('set-opacity', opacity),
  setDraggable: (draggable) => ipcRenderer.send('set-draggable', draggable),
  setResizable: (resizable) => ipcRenderer.send('set-resizable', resizable),

  // 监听字幕更新
  onSubtitleUpdate: (callback) => {
    ipcRenderer.on('subtitle-update', (event, data) => callback(data));
  },

  // 监听透明度变化
  onSetOpacity: (callback) => {
    ipcRenderer.on('set-opacity', (event, opacity) => callback(opacity));
  },

  // 获取连接状态
  getConnectionStatus: () => ipcRenderer.invoke('get-connection-status')
});

console.log('[FloatCC] Preload脚本已加载');
