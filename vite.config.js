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
        // 约 32MB 的 ffmpeg WASM 完全不经过 Service Worker：
        // 应用默认从跨域的国内 CDN（npmmirror）下载（同源 SW 无法拦截跨域请求），
        // 同源兜底 URL 又使用 HTTP Range 分块请求（SW 介入反而会影响 206 缓存）。
        // 引擎由应用代码自行写入 Cache Storage（固定键），下载一次后永久秒开、可离线。
      },
    }),
  ],
  optimizeDeps: {
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
  },
})
