import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import {
  comboKey, isColorMode, isStyleMode, migrateLegacyTheme, setActiveTheme,
  type ColorMode, type StyleMode, type ComboKey,
} from '@/theme/tokens'

const COLOR_KEY = 'workbench.colorMode'
const STYLE_KEY = 'workbench.styleMode'
const LEGACY_KEY = 'workbench.theme'

function loadInitial(): { color: ColorMode; style: StyleMode } {
  try {
    const c = localStorage.getItem(COLOR_KEY)
    const s = localStorage.getItem(STYLE_KEY)
    if (isColorMode(c) && isStyleMode(s)) return { color: c, style: s }
    // 迁移旧的单维主题值
    const migrated = migrateLegacyTheme(localStorage.getItem(LEGACY_KEY))
    if (migrated) return migrated
  } catch {
    /* ignore */
  }
  return { color: 'light', style: 'normal' }
}

export const useThemeStore = defineStore('theme', () => {
  const init = loadInitial()
  const colorMode = ref<ColorMode>(init.color)
  const styleMode = ref<StyleMode>(init.style)

  const combo = computed<ComboKey>(() => comboKey(colorMode.value, styleMode.value))
  // 兼容旧调用点：dark 仍表示「是否暗色系」
  const dark = computed(() => colorMode.value === 'dark')
  const mode = computed(() => colorMode.value)

  function apply() {
    setActiveTheme(combo.value)
    const root = document.documentElement
    root.dataset.color = colorMode.value
    root.dataset.style = styleMode.value
    root.classList.toggle('dark', dark.value)
    try {
      localStorage.setItem(COLOR_KEY, colorMode.value)
      localStorage.setItem(STYLE_KEY, styleMode.value)
    } catch {
      /* ignore */
    }
  }

  /** 顶栏 Sun/Moon 与 Ctrl+Shift+D：只切明暗，保留当前风格 */
  function toggle() {
    colorMode.value = dark.value ? 'light' : 'dark'
    apply()
  }

  function setColorMode(m: ColorMode) {
    if (isColorMode(m)) colorMode.value = m
    apply()
  }

  function setStyleMode(s: StyleMode) {
    if (isStyleMode(s)) styleMode.value = s
    apply()
  }

  apply()

  return { colorMode, styleMode, combo, dark, mode, toggle, setColorMode, setStyleMode }
})
