import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import {
  comboKey, isColorMode, isStyleMode, migrateLegacyTheme, setActiveTheme,
  type ColorMode, type StyleMode, type ComboKey,
} from '@/theme/tokens'

const COLOR_KEY = 'workbench.colorMode'
const STYLE_KEY = 'workbench.styleMode'
const LEGACY_KEY = 'workbench.theme'
const FOLLOW_KEY = 'workbench.followSystem'

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
  /** 跟随系统：开启后监听 prefers-color-scheme，手动切换会自动关闭跟随 */
  const followSystem = ref(localStorage.getItem(FOLLOW_KEY) === '1')

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

  /** 系统明暗变化时实际采用的模式 */
  function systemMode(): ColorMode {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }

  /** 切换跟随系统。开启时立即采用系统当前值 */
  function setFollowSystem(v: boolean) {
    followSystem.value = v
    try { localStorage.setItem(FOLLOW_KEY, v ? '1' : '0') } catch { /* ignore */ }
    if (v) {
      colorMode.value = systemMode()
      apply()
    }
  }

  // 监听系统主题变化：仅在开启跟随时生效
  if (typeof window !== 'undefined' && window.matchMedia) {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e: MediaQueryListEvent) => {
      if (followSystem.value) {
        colorMode.value = e.matches ? 'dark' : 'light'
        apply()
      }
    }
    mq.addEventListener('change', handler)
  }

  /** 顶栏 Sun/Moon 与 Ctrl+Shift+D：只切明暗，保留当前风格 */
  function toggle() {
    // 手动切换 = 用户明确了偏好，自动退出跟随模式
    if (followSystem.value) {
      followSystem.value = false
      try { localStorage.setItem(FOLLOW_KEY, '0') } catch { /* ignore */ }
    }
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

  return { colorMode, styleMode, combo, dark, mode, followSystem, toggle, setColorMode, setStyleMode, setFollowSystem }
})
