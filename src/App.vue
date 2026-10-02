<script setup lang="ts">
import { onMounted, ref, computed, h } from 'vue'
import { darkTheme, zhCN, dateZhCN, NConfigProvider, NMessageProvider, NDialogProvider } from 'naive-ui'
import { useThemeStore } from './stores/theme'
import { useDataStore } from './stores/data'
import { naiveOverrides } from './theme/naive'
import { initDb } from './db/migrate'
import { useKeyboard } from './composables/useKeyboard'
import { useSettings, applyAccessibility } from './composables/useSettings'
import { watch } from 'vue'
import AppShell from '@/components/layout/AppShell.vue'

const themeStore = useThemeStore()
const dataStore = useDataStore()
const initError = ref('')
const settings = useSettings()

const naiveTheme = computed(() => (themeStore.dark ? darkTheme : null))
const overrides = computed(() => naiveOverrides(themeStore.dark))

useKeyboard()

// F-SYS-11 无障碍：字号可调 + 减少动效（全局生效）
applyAccessibility(settings)
watch(settings, () => applyAccessibility(settings), { deep: true })

onMounted(async () => {
  try {
    await initDb()
    dataStore.ready = true
  } catch (e) {
    initError.value = e instanceof Error ? e.message : String(e)
    // 浏览器预览降级：仍进入界面，写操作会提示
    dataStore.ready = true
    dataStore.degraded = true
    console.error('[WORKBENCH] 数据库初始化失败（非 Tauri 环境将降级为只读演示）:', e)
  }
})

const bootTip = computed(() =>
  initError.value
    ? `数据层不可用：${initError.value}（请通过 npm run tauri dev 启动以启用 SQLite）`
    : '初始化数据层…',
)
</script>

<template>
  <n-config-provider
    :theme="naiveTheme"
    :theme-overrides="overrides"
    :locale="zhCN"
    :date-locale="dateZhCN"
    :inline-theme-disabled="false"
  >
    <n-message-provider>
      <n-dialog-provider>
        <div v-if="dataStore.ready" class="app-root">
          <AppShell />
        </div>
        <div v-else class="boot-screen">
          <div class="empty-icon">◫</div>
          <div>{{ bootTip }}</div>
        </div>
      </n-dialog-provider>
    </n-message-provider>
  </n-config-provider>
</template>

<style scoped>
.app-root {
  height: 100vh;
  overflow: hidden;
}
</style>
