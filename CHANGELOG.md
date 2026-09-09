# 更新日志

本项目遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [1.0.3] - 2026-09-09

> 本次更新仅改动应用代码（`.vue` / `.js`），用户端无需重新安装，Service Worker 会自动更新。

### 修复

- **提取音频时多次点击导致多个"提取中"按钮堆叠**：提取按钮加入 `busy` 防抖锁，提取期间完全禁止重复触发，从根源杜绝并发请求
- **ffmpeg 核心文件加载偶发 NetworkError（Service Worker / iOS 后台限制）**：加载失败后自动重试 3 次，指数退避（2s → 4s → 8s），重试成功则正常继续，仍失败再向用户报错
- **错误提示不够友好**：NetworkError 场景单独提示「网络加载 ffmpeg 核心文件失败，请检查网络后重试」，避免晦涩的 WASM RuntimeError 原始信息

## [1.0.2] - 2026-09-09

### 修复

- **iOS 主屏幕 App 顶部按钮仍被灵动岛遮挡（v1.0.1 未完全解决）**：根因是 `black-translucent` 状态栏样式在部分 iOS 版本下 `env(safe-area-inset-top)` 返回 0。改为：
  - `apple-mobile-web-app-status-bar-style` 由 `black-translucent` 改为 `default`，系统保留状态栏占位，内容不再顶到屏幕最上方
  - CSS 变量 `--safe-top` 在 standalone 模式下使用 `max(env(safe-area-inset-top), 24px)` 兜底，即使环境变量失效也保留 24px 安全间距

### 注意

- 本修复**只对通过 Safari「添加到主屏幕」打开的 App 生效**；在 Safari 浏览器标签页中打开仍会看到系统 UI 遮挡（属 iOS 浏览器行为，无法通过网页代码规避）
- ⚠️ **需要重新安装**：本版本改动了 `apple-mobile-web-app-status-bar-style` meta 标签，已添加到主屏幕的 App 不会自动应用，需在手机上移除主屏幕图标后重新「添加到主屏幕」。详细步骤见 README「什么情况下手机端需要重新安装」

## [1.0.1] - 2026-09-09

### 修复

- **iPhone 主屏幕 App 顶部按钮被遮挡**：header 增加 `env(safe-area-inset-top)` 安全区内边距，「音乐库」「歌单」按钮避开灵动岛/刘海区域；左右两侧也适配横屏安全区
- **底部播放器被 Home 指示条遮挡**：footer 增加 `env(safe-area-inset-bottom)` 内边距
- **`apple-touch-icon` 子路径部署 404**：改为相对路径 `./icons/...`，修复 GitHub Pages 子路径部署下主屏幕图标不显示的问题

### 文档

- README 重写「构建部署」章节：区分「直接用」和「fork 自部署」两条路线，补充 PC 本地开发、GitHub Pages、其它静态托管、手机端安装、PWA 自动更新机制的说明

## [1.0.0] - 初始版本

### 新增

- 视频剪辑提取音频（ffmpeg.wasm 浏览器内完成）
- 音频文件直接导入（MP3/M4A）
- 音乐库管理（命名、重命名、删除）
- 歌单管理（创建、添加、排序、删除）
- 播放器：单曲循环 / 列表循环 / 随机播放，上一首/下一首，进度拖拽
- PWA 支持：主屏幕安装、离线缓存、Media Session 锁屏控制
- GitHub Pages 自动部署
