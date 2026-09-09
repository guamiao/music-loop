# 🎵 Music Loop

把喜欢的视频片段变成可以循环播放的"歌曲"。一个纯前端的本地音乐播放器：导入视频 → 剪辑片段 → 提取音频 → 建歌单 → 循环播放。

所有数据（音频文件、歌单）都保存在浏览器本地（IndexedDB），不上传任何服务器。

## 功能

- **视频剪辑提取**：导入本地视频（如小红书保存的演奏视频），拖动滑块选择起止时间，一键提取为 MP3（基于 ffmpeg.wasm，在浏览器内完成）
- **音频导入**：也支持直接导入 MP3/M4A 等音频文件
- **音乐库**：命名、重命名、删除歌曲
- **歌单**：创建/删除歌单，添加/移除歌曲，调整顺序
- **播放器**：单曲循环 🔂 / 列表循环 🔁 / 随机播放 🔀，上一首/下一首，进度拖拽

## 快速开始

要求：Node.js ≥ 18

```bash
git clone <仓库地址>
cd music-loop
npm install
npm run dev
```

浏览器打开终端里显示的地址（默认 http://localhost:5173）即可使用。

## 使用说明

1. 在小红书 App 中把喜欢的视频**保存到本地**（或录屏）
2. 打开「音乐库」→「导入视频并剪辑」，选择视频文件
3. 拖动滑块选择想要的片段，起个名字，点击「提取音频并存入音乐库」
   - 首次使用需要加载 ffmpeg 核心文件（约 25MB），稍等片刻即可
4. 到「歌单」页创建歌单、添加歌曲，然后循环播放 🎧

## 技术栈

| 部分 | 技术 |
|---|---|
| 框架 | Vue 3 + Vite |
| UI | Naive UI |
| 音视频处理 | ffmpeg.wasm（核心文件本地打包，无需联网加载） |
| 本地存储 | IndexedDB（Dexie.js） |

## 构建部署

### 只 build 出静态文件

```bash
npm run build   # 产物在 dist/，是纯静态文件
```

`dist/` 可部署到任意静态托管（GitHub Pages、Cloudflare Pages、Vercel、Nginx 等）。

### 别人想用这个项目：两条路线

#### 路线 A：只想用，不想自己部署

最简单——直接打开你已部署好的网址（例如 `https://<你的用户名>.github.io/music-loop/`），在浏览器里就能用，手机端「添加到主屏幕」后体验等同 App。**无需任何部署**。

#### 路线 B：想自己 fork 一份部署

**PC 端本地跑（开发 / 自用）**

```bash
git clone <他们 fork 后的仓库地址>
cd music-loop
npm install
npm run dev        # 开发模式，浏览器打开终端显示的地址
# 或
npm run build && npm run preview   # 预览生产构建
```

**GitHub Pages 自动部署（推荐，免费）**

仓库已内置 GitHub Actions 工作流（`.github/workflows/deploy.yml`），fork 后只需：

1. 到自己仓库的 **Settings → Pages**
2. **Source** 选 **GitHub Actions**
3. 推一次 `main` 分支（或在 Actions 页手动触发一次 `Deploy to GitHub Pages`）
4. 等 1~2 分钟，访问 `https://<他们的用户名>.github.io/<仓库名>/`

工作流会自动处理子路径（通过 `BASE_URL` 注入），无需改任何配置。

**其它静态托管（Vercel / Cloudflare Pages / Netlify / Nginx）**

- 构建命令：`npm run build`
- 输出目录：`dist`
- 如果部署在**子路径**下（如 `example.com/music-loop/`），构建时需设置环境变量 `BASE_URL=/music-loop/`；部署在根域名则不用管

### 手机端「部署」

严格说手机端不需要部署——它只是访问一个网址：

**iPhone（Safari）**
1. Safari 打开部署好的网址
2. 点「分享」→「添加到主屏幕」
3. 以后从主屏幕图标打开，就是全屏 App 体验（无浏览器地址栏）

**Android（Chrome）**
1. Chrome 打开网址
2. 菜单 →「添加到主屏幕」/「安装应用」

### 部署后拿到新版本要不要重新安装？

**一般不需要**。项目在 `vite.config.js` 里配置了 PWA `registerType: 'autoUpdate'`：

- 你 push 代码到 GitHub → Actions 自动重新部署
- 用户下次打开 App（或从后台切回前台），Service Worker 检测到新版本会**自动在后台下载并热更新**
- 数据（歌曲、歌单）存在浏览器 IndexedDB 里，**更新不会丢数据**

唯一需要注意：ffmpeg 核心文件约 32MB，首次更新后可能重新下载一次（视缓存策略），之后再离线可用。

### 什么情况下手机端需要「重新安装」

下面几类改动改的是 **`index.html` 里的 meta 标签 / PWA manifest**，已经安装在主屏幕的 App **不会**自动应用这些变化，需要用户在手机上重新走一遍「添加到主屏幕」流程：

- 修改 `apple-mobile-web-app-*` 系列 meta（状态栏样式、标题、图标等）
- 修改 `manifest.webmanifest` 中的应用名称、图标、`display`、`theme_color`、`start_url` 等
- 修复主屏幕 App 的显示异常（典型例子：v1.0.2 修复灵动岛遮挡，就是改 `apple-mobile-web-app-status-bar-style`）

**iPhone 重新安装步骤**：

1. 长按主屏幕的 Music Loop 图标 → **移除 App**（歌曲数据在浏览器 IndexedDB 里，不会因为移除图标而丢失）
2. 用 Safari 打开部署地址
3. **上滑杀掉 Safari 后台**，再重新打开网址——确保加载的是最新 HTML（避免旧缓存）
4. 点「分享」→「添加到主屏幕」
5. 从新的主屏幕图标打开

**Android 重新安装步骤**：

1. 长按主屏幕图标 → 卸载 / 移除
2. Chrome 打开部署地址，菜单 →「添加到主屏幕」/「安装应用」

> 💡 **判断要不要重新安装的简便原则**：只改了 `.vue` / `.js` / `.css` 等应用代码 → 用户无需操作，自动更新；改了 `index.html` 的 meta 或 `vite.config.js` 里的 manifest → 需要提醒用户重新添加到主屏幕。维护者应在 CHANGELOG 里对这类改动明确标注「需要重新安装」。



## 注意

- 数据存在当前设备的浏览器中（IndexedDB），清除浏览器数据会丢失歌曲；**各设备数据不互通**——在手机上导入的歌只存在手机上
- 请仅将下载的视频用于个人欣赏，不要二次分发，尊重创作者版权

## 更新日志

见 [CHANGELOG.md](./CHANGELOG.md)。当前版本 **v1.0.3**。
