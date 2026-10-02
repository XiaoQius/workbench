import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { normalizeTheme, setActiveTheme, themeMeta, type ThemeKey } from '@/theme/tokens'

const STORAGE_KEY = 'workbench.theme'
const THEME_CLASSES = ['theme-light', 'theme-dark', 'theme-brutal', 'theme-tech']

export const useThemeStore = defineStore('theme', () => {
  let initial: ThemeKey = 'light'
  try {
    // 历史存的是 'light' / 'dark'，新增 brutal / tech，非法值回退 light
    initial = normalizeTheme(localStorage.getItem(STORAGE_KEY))
  } catch {
    /* ignore */
  }
  const themeKey = ref<ThemeKey>(initial)

  // 保留 dark / mode：HomeView、AppShell、PageHeader、CommandPalette 的调用点不受影响
  const dark = computed(() => themeMeta(themeKey.value).dark)
  const mode = computed(() => (dark.value ? 'dark' : 'light'))

  /** 顶栏 Sun/Moon 与 Ctrl+Shift+D 的快捷切换：保持「浅 ⇄ 深」原有语义 */
  function toggle() {
    themeKey.value = dark.value ? 'light' : 'dark'
    apply()
  }

  function setMode(m: 'light' | 'dark') {
    themeKey.value = m
    apply()
  }

  function setTheme(key: ThemeKey) {
    themeKey.value = normalizeTheme(key)
    apply()
  }

  function apply() {
    setActiveTheme(themeKey.value)
    const root = document.documentElement
    root.classList.toggle('dark', dark.value)
    THEME_CLASSES.forEach((c) => root.classList.remove(c))
    root.classList.add('theme-' + themeKey.value)
    try {
      localStorage.setItem(STORAGE_KEY, themeKey.value)
    } catch {
      /* ignore */
    }
  }

  // 初始应用一次
  apply()

  return { themeKey, dark, mode, toggle, setMode, setTheme }
})
