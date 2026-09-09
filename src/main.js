import { createApp } from 'vue'
import App from './App.vue'
import { dbReady } from './db'
import './style.css'

// 等待 IndexedDB 备份恢复完成后再挂载，确保数据完整
dbReady.then(() => {
  createApp(App).mount('#app')
})
