import { ref } from 'vue'

/** 全局 UI 总线：顶栏动作 → 视图响应 */
export const refreshTick = ref(0)
export const settingsOpen = ref(false)
/** 打开设置面板时定位的 tab（如 'ai'）；AppShell 的 SettingsPanel initial-tab 消费此值 */
export const settingsTab = ref<string | undefined>(undefined)

export function requestRefresh() {
  refreshTick.value++
}
