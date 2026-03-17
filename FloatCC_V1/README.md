# FloatCC - B站悬浮字幕

当你在浏览器中播放B站视频并切换到其他页面时，在屏幕最上层显示实时字幕。

## 功能特点

- 🎬 支持所有B站视频（普通视频、番剧、课程）
- 🖥️ 悬浮窗始终置顶
- 🔄 实时同步字幕（通过WebSocket）
- 🎨 可调整透明度和大小
- 📌 支持置顶/取消置顶
- 🖱️ 可拖拽位置
- 🔊 系统托盘支持

## 快速开始

### 1. 安装依赖

```bash
cd FloatCC_V1
npm install
```

### 2. 启动FloatCC应用

```bash
npm start
```

应用启动后会在屏幕右下角显示悬浮窗。

### 3. 安装油猴脚本

1. 安装 [Tampermonkey](https://tampermonkey.net/) 扩展
2. 在扩展管理界面添加新脚本
3. 复制 `scripts/bilibili-cc-float.user.js` 的内容并保存

### 4. 使用

1. 在Chrome浏览器中访问B站视频
2. 开启字幕（CC按钮）
3. 最小化浏览器或切换到其他页面
4. 悬浮窗会实时显示当前字幕

## 项目结构

```
FloatCC_V1/
├── package.json           # 项目配置和依赖
├── main.js                # Electron主进程
├── preload.js             # 预加载脚本（IPC通信）
├── renderer/              # 悬浮窗界面
│   ├── index.html         # HTML结构
│   ├── style.css          # 样式
│   └── renderer.js        # 界面逻辑
├── scripts/               # 油猴脚本
│   └── bilibili-cc-float.user.js  # B站字幕推送脚本
├── assets/                # 资源文件
│   └── icon.png           # 应用图标
└── dist/                  # 构建输出
```

## 窗口操作

- **拖拽**: 拖动顶部标题栏移动窗口
- **调整大小**: 拖动窗口边缘调整大小
- **透明度**: 点击 ◐ 按钮或右键托盘菜单调整
- **置顶**: 点击 📌 按钮切换置顶状态
- **最小化**: 点击 − 按钮最小化到托盘
- **关闭**: 点击 × 按钮退出应用

## 技术原理

### 整体架构

```
┌─────────────────┐         WebSocket          ┌─────────────────┐
│   Chrome浏览器   │ ←─────────────────────────→│   FloatCC应用    │
│  (油猴脚本)      │    ws://localhost:8765     │  (Electron)     │
└─────────────────┘                             └─────────────────┘
        │                                                │
        │ 1. 获取B站字幕API                              │
        │ 2. 根据播放时间匹配字幕                        │
        │ 3. 通过WebSocket推送                          │
        │                                                │
        ▼                                                ▼
┌─────────────────┐                             ┌─────────────────┐
│ B站API服务器     │                             │  悬浮字幕窗口    │
│ api.bilibili.com│                             │  (透明置顶)     │
└─────────────────┘                             └─────────────────┘
```

### 1. 视频信息获取

油猴脚本通过多种途径获取视频信息 (cid, aid, bvid)：

```javascript
// 优先级顺序：
1. window.__INITIAL_STATE__.cidMap[bvid]  // React状态中的cidMap
2. window.__INITIAL_STATE__.videoData      // 视频数据
3. window.playerRaw.getManifest()           // 播放器实例
4. window.player                           // 备用播放器
5. URL参数 (?cid=xxx&aid=xxx)
```

### 2. 字幕API调用

获取到cid和aid后，调用B站API获取字幕列表：

```javascript
// 主API (需要cid)
GET https://api.bilibili.com/x/player/wbi/v2?cid={cid}&aid={aid}

// 备用API (只有bvid时)
GET https://api.bilibili.com/x/player/v2?bvid={bvid}

// 再次备用 (APP弹幕)
GET https://api.bilibili.com/x/v2/dm/view?aid={aid}&oid={cid}
```

API返回字幕列表，包含每个字幕的语言和下载URL。

### 3. 字幕匹配

获取字幕内容后，根据当前播放时间匹配显示的字幕：

```javascript
function getSubtitleByTime(currentTime, subtitleData) {
  for (const item of subtitleData.body) {
    if (currentTime >= item.from && currentTime <= item.to) {
      return item.content;  // 返回当前时间对应的字幕
    }
  }
  return null;
}
```

### 4. 后台运行

页面隐藏后，浏览器会暂停页面JavaScript执行。为了继续获取字幕：

- **Web Worker**: 在独立线程中运行定时器，不受页面可见性影响
- **定时轮询**: 每300ms检查一次播放时间和字幕

### 5. Electron悬浮窗

- **无边框窗口**: `frame: false, transparent: true`
- **始终置顶**: `alwaysOnTop: true`
- **系统托盘**: 最小化时隐藏到托盘

### 通信协议

```javascript
// 客户端 -> 服务器
{ type: "subtitle", content: "字幕内容", from: 0, to: 5, source: "视频标题", currentTime: 0, duration: 120 }
{ type: "time", currentTime: 10.5, duration: 120 }
{ type: "close" }

// 服务器 -> 客户端
{ type: "connected", message: "FloatCC已连接" }
```

## 构建发布

```bash
# 开发模式
npm run dev

# 构建Windows安装包
npm run build
```

构建完成后在 `dist` 目录生成安装文件。

## 注意事项

- 需要保持油猴脚本运行才能推送字幕
- WebSocket连接地址: `ws://localhost:8765`
- 如果连接失败请检查防火墙设置

## 许可证

MIT
