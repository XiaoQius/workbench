import { defineStore } from 'pinia'
import { ref } from 'vue'

/** 数据层就绪状态：ready=true 才渲染主界面；degraded=浏览器降级（只读演示） */
export const useDataStore = defineStore('data', () => {
  const ready = ref(false)
  const degraded = ref(false)

  return { ready, degraded }
})
