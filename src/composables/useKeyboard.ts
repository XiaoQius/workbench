import { onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useThemeStore } from '@/stores/theme'
import { usePaletteStore } from '@/stores/palette'
import { useSettings } from '@/composables/useSettings'

/**
 * 全局键盘驱动（F-SYS-02）：
 *  - Ctrl/Cmd+K  打开命令面板（固定保留，不可关闭）
 *  - Ctrl/Cmd+/  打开命令面板（等价）
 *  - Ctrl/Cmd+1..8 切换 8 个页面模块（可在设置面板关闭，F-SYS-02 快捷键自定义）
 *  - Ctrl/Cmd+Shift+D 切换浅/深主题（可关闭）
 *  - g 后按 d/l/s/o/k/w/h/i 跳转模块（可关闭）
 *  - n 触发 wb:quick-new 事件（可关闭）
 *  - Esc 关闭命令面板
 */
export function useKeyboard() {
  const router = useRouter()
  const themeStore = useThemeStore()
  const paletteStore = usePaletteStore()
  const settings = useSettings()

  const MODULE_PATHS = ['/', '/workspace', '/dev', '/ops', '/life', '/study', '/knowledge', '/inspiration']
  const G_PATHS: Record<string, string> = {
    h: '/', w: '/workspace', d: '/dev', o: '/ops', l: '/life', s: '/study', k: '/knowledge', i: '/inspiration',
  }

  function isEditableTarget(e: KeyboardEvent): boolean {
    const el = e.target as HTMLElement | null
    if (!el) return false
    const tag = el.tagName
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
  }

  function onKeydown(e: KeyboardEvent) {
    const mod = e.ctrlKey || e.metaKey

    // Ctrl+K / Ctrl+/ 命令面板（固定保留）
    if (mod && (e.key.toLowerCase() === 'k' || e.key === '/')) {
      e.preventDefault()
      paletteStore.toggle()
      return
    }
    // Ctrl+Shift+D 主题切换
    if (settings.keymap.theme && mod && e.shiftKey && e.key.toLowerCase() === 'd') {
      e.preventDefault()
      themeStore.toggle()
      return
    }
    // Ctrl+1..8 模块切换
    if (settings.keymap.ctrlNum && mod && !e.shiftKey && /^[1-8]$/.test(e.key)) {
      e.preventDefault()
      const idx = Number(e.key) - 1
      router.push(MODULE_PATHS[idx])
      return
    }
    if (isEditableTarget(e) || mod || e.altKey) return

    // g 序列：g 后按 d/l/s/o/k/w/h/i 跳转模块
    if (settings.keymap.gSeq && e.key.toLowerCase() === 'g') {
      e.preventDefault()
      const handler = (ev: KeyboardEvent) => {
        window.removeEventListener('keydown', handler)
        if (isEditableTarget(ev) || ev.ctrlKey || ev.metaKey || ev.altKey) return
        const p = G_PATHS[ev.key.toLowerCase()]
        if (p) {
          ev.preventDefault()
          router.push(p)
        }
      }
      window.addEventListener('keydown', handler)
      return
    }
    // n 新建（触发事件，视图自行监听）
    if (settings.keymap.newShortcut && e.key.toLowerCase() === 'n') {
      e.preventDefault()
      window.dispatchEvent(new CustomEvent('wb:quick-new'))
      return
    }
    // Esc 关闭命令面板
    if (e.key === 'Escape' && paletteStore.open) {
      paletteStore.close()
    }
  }

  onMounted(() => window.addEventListener('keydown', onKeydown))
  onUnmounted(() => window.removeEventListener('keydown', onKeydown))
}
