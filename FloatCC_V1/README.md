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

1. **Electron主进程**: 创建无边框透明窗口，运行WebSocket服务器
2. **WebSocket通信**: 油猴脚本通过WebSocket推送实时字幕
3. **渲染进程**: 接收字幕数据并显示在悬浮窗中

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
