import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

const STORAGE_KEY = 'workbench.theme'

export const useThemeStore = defineStore('theme', () => {
  let initial = false
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'dark') initial = true
  } catch {
    /* ignore */
  }
  const dark = ref<boolean>(initial)

  const mode = computed(() => (dark.value ? 'dark' : 'light'))

  function toggle() {
    dark.value = !dark.value
    apply()
  }

  function setMode(m: 'light' | 'dark') {
    dark.value = m === 'dark'
    apply()
  }

  function apply() {
    document.documentElement.classList.toggle('dark', dark.value)
    try {
      localStorage.setItem(STORAGE_KEY, dark.value ? 'dark' : 'light')
    } catch {
      /* ignore */
    }
  }

  // 初始应用一次
  apply()

  return { dark, mode, toggle, setMode }
})
