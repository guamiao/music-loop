import { createApp } from 'vue'
import App from './App.vue'
import { dbReady } from './db'
import { prewarmFFmpeg } from './ffmpeg'
import './style.css'

// 等待 IndexedDB 备份恢复完成后再挂载，确保数据完整
dbReady.then(() => {
  createApp(App).mount('#app')
  // 空闲时后台预下载 ffmpeg 引擎，首次点提取时即可直接使用
  prewarmFFmpeg()
})
