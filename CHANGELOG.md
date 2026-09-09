# 更新日志

本项目遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

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
