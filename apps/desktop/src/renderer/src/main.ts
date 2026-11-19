import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { router } from './router'
import { useThemeStore } from './stores/theme'
import './assets/main.css'

async function boot(): Promise<void> {
  const app = createApp(App)
  const pinia = createPinia()
  app.use(pinia)
  app.use(router)
  // 主题先应用再挂载：避免首帧亮色闪白（失败不阻断启动）
  await useThemeStore(pinia).load().catch(() => undefined)
  app.mount('#app')
}

void boot()
