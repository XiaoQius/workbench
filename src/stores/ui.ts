import { ref } from 'vue'

/** 全局 UI 总线：顶栏动作 → 视图响应 */
export const refreshTick = ref(0)
export const settingsOpen = ref(false)

export function requestRefresh() {
  refreshTick.value++
}
