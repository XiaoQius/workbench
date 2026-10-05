import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import 'uno.css'
import './styles/main.css'
import { dbPerf } from './db/client'

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#app')

// 性能探针：dev 下挂到 window，配合 client.ts 的 ?perf=1 / localStorage wb:perf 使用。
// 生产构建里这段会被 vite 的 import.meta.env.DEV 判定剔除。
if (import.meta.env.DEV) {
  ;(window as unknown as Record<string, unknown>).__wbPerf = dbPerf
}