import { defineStore } from 'pinia'
import { ref } from 'vue'

/** 全局命令面板状态（Ctrl+K 触发） */
export const usePaletteStore = defineStore('palette', () => {
  const open = ref(false)

  function toggle() {
    open.value = !open.value
  }

  function openPanel() {
    open.value = true
  }

  function close() {
    open.value = false
  }

  return { open, toggle, openPanel, close }
})
