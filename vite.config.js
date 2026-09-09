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
        globPatterns: ['**/*.{js,css,html,svg,png}'],
        // 排除约 32MB 的 ffmpeg WASM 文件不纳入 SW 预缓存，
        // 避免 SW 安装时下载该文件导致挂起（尤其在 iOS 上表现为提取卡死）
        // WASM 文件由应用代码按需 fetch，浏览器磁盘缓存会自动加速后续加载
        exclude: [/\.wasm$/],
      },
    }),
  ],
  optimizeDeps: {
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
  },
})
