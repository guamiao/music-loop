import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  // GitHub Pages 部署在 /<仓库名>/ 子路径下，由 CI 通过 BASE_URL 注入；
  // 本地开发和直接部署到根域名时为 '/'
  base: process.env.BASE_URL || '/',
  plugins: [
    vue(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icons/*.png'],
      manifest: {
        name: 'Music Loop',
        short_name: 'Music Loop',
        description: '把喜欢的视频片段变成可以循环播放的歌曲',
        theme_color: '#101014',
        background_color: '#101014',
        display: 'standalone',
        // start_url 不手动指定，由插件根据 base 自动生成（GitHub Pages 子路径下也能正确打开）
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/icon-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // 注意：GenerateSW 模式不支持 glob 层面的 exclude 选项（workbox-build 7 会直接
        // 报 WorkboxConfigError 导致构建失败）。globPatterns 本身不包含 wasm，即不会预缓存。
        globPatterns: ['**/*.{js,css,html,svg,png}'],
        // 约 32MB 的 ffmpeg WASM 不进 SW 预缓存（否则 SW 安装时下载该文件一旦挂起，
        // 会阻塞所有经 SW 的请求，表现为提取音频永远“提取中”）。
        // 改为运行时缓存：应用首次提取时下载并存入独立 Cache，之后秒开且可离线使用；
        // 文件名带 hash，版本更新后 URL 变化会自动重新缓存。
        runtimeCaching: [
          {
            urlPattern: /\.wasm$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'ffmpeg-wasm',
              expiration: { maxEntries: 4 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  optimizeDeps: {
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
  },
})
