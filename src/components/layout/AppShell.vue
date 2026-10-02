<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { NButton, NIcon, NTag, NPopover, NTooltip } from 'naive-ui'
import { Moon, Sun, Command, LayoutSidebar, Activity, Refresh, Settings } from '@vicons/tabler'
import { modules, moduleColor } from '@/theme/tokens'
import { useThemeStore } from '@/stores/theme'
import { usePaletteStore } from '@/stores/palette'
import { useSettings, UPDATE_SOURCE } from '@/composables/useSettings'
import { llmConfigured } from '@/composables/llmClient'
import { diskSpace, llmStatus, proxyDetect, checkUpdate, type DiskInfo, type LlmStatus, type ProxyInfo } from '@/composables/useTauri'
import CommandPalette from './CommandPalette.vue'
import SettingsPanel from '@/components/SettingsPanel.vue'
import { refreshTick, settingsOpen, requestRefresh } from '@/stores/ui'
import { onSyncStatus, type SyncStatus } from '@/db/sync'

const route = useRoute()
const themeStore = useThemeStore()
const paletteStore = usePaletteStore()
const s = useSettings()

const activeModule = computed(() => {
  const key = route.meta.module as string | undefined
  return modules.find((m) => m.key === key) ?? modules[0]
})
const accent = computed(() => moduleColor(activeModule.value.key, themeStore.dark))

const shortcuts = ['1', '2', '3', '4', '5', '6', '7']

// 板块开关：设置中可关闭的板块从侧栏隐藏（当前激活页不受影响）
const navModules = computed(() => modules.filter((m) => s.sections[m.key]))

// ---- 启动即监控本机状态（磁盘 / LLM / 代理 / 更新） ----
const sysStatus = ref<{
  diskUsed: string
  llm: LlmStatus | null
  proxy: ProxyInfo | null
  update: { has: boolean; latest: string } | null
  checkedAt: string
  loading: boolean
}>({ diskUsed: '', llm: null, proxy: null, update: null, checkedAt: '', loading: false })

async function refreshSysStatus() {
  sysStatus.value.loading = true
  try {
    const [disks, llm, proxy] = await Promise.allSettled([
      diskSpace(),
      llmStatus(),
      proxyDetect(),
    ])
    if (disks.status === 'fulfilled') {
      const total = disks.value.reduce((a, d) => a + d.total, 0)
      const used = disks.value.reduce((a, d) => a + d.used, 0)
      const pct = total > 0 ? Math.round((used / total) * 100) : 0
      sysStatus.value.diskUsed = `${pct}%`
    } else {
      sysStatus.value.diskUsed = '--'
    }
    sysStatus.value.llm = llmConfigured()
      ? { configured: true, provider: '自定义配置' }
      : (llm.status === 'fulfilled' ? llm.value : null)
    sysStatus.value.proxy = proxy.status === 'fulfilled' ? proxy.value : null
  } finally {
    sysStatus.value.loading = false
    sysStatus.value.checkedAt = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  }
  // 更新检测：使用内置更新源，用户无需配置；允许自动检查时静默探测
  const url = UPDATE_SOURCE.trim()
  if (s.autoCheckUpdate && url) {
    try {
      const up = await checkUpdate(url, '0.1.0')
      sysStatus.value.update = up.has_update
        ? { has: true, latest: up.latest ?? '' }
        : null
    } catch {
      sysStatus.value.update = null
    }
  }
}

const syncStatus = ref<SyncStatus>({ state: 'idle', message: '', lastSyncAt: null, pending: 0 })
onSyncStatus((st) => { syncStatus.value = st })
const syncLabel = computed(() => {
  if (!useSettings().cloudToken) return ''
  if (syncStatus.value.state === 'syncing') return '同步中'
  if (syncStatus.value.state === 'error') return '同步异常'
  return syncStatus.value.pending > 0 ? '待同步 ' + syncStatus.value.pending : '已同步'
})

onMounted(() => {
  refreshSysStatus()
})
</script>

<template>
  <div class="shell">
    <!-- 侧栏：7 模块导航（设置中可关闭板块；可折叠为图标栏） -->
    <aside class="sidebar" :class="{ collapsed: s.sidebarCollapsed }">
      <div class="logo" title="WORKBENCH">
        <span class="logo-mark">W</span>
        <span v-if="!s.sidebarCollapsed" class="logo-text">WORKBENCH</span>
      </div>
      <nav class="nav">
        <router-link
          v-for="(m, i) in navModules"
          :key="m.key"
          :to="m.path"
          class="nav-item"
          :class="{ active: activeModule.key === m.key }"
          :title="`${m.label} (Ctrl+${shortcuts[i]})`"
        >
          <span class="module-dot" :style="{ background: moduleColor(m.key, themeStore.dark) }"></span>
          <span v-if="!s.sidebarCollapsed" class="nav-label">{{ m.label }}</span>
        </router-link>
      </nav>
      <div class="sidebar-footer">
        <NTooltip :disabled="!s.sidebarCollapsed">
          <template #trigger>
            <NButton quaternary circle size="small" @click="s.sidebarCollapsed = !s.sidebarCollapsed" :title="s.sidebarCollapsed ? '展开侧栏' : '折叠侧栏'">
              <template #icon>
                <NIcon :component="LayoutSidebar" />
              </template>
            </NButton>
          </template>
          {{ s.sidebarCollapsed ? '展开侧栏' : '折叠侧栏' }}
        </NTooltip>
        <NButton quaternary circle size="small" @click="themeStore.toggle()" :title="themeStore.dark ? '切换到浅色 (Ctrl+Shift+D)' : '切换到深色 (Ctrl+Shift+D)'">
          <template #icon>
            <NIcon :component="themeStore.dark ? Sun : Moon" />
          </template>
        </NButton>
      </div>
    </aside>

    <!-- 主区 -->
    <div class="main">
      <header class="topbar">
        <div class="crumb">
          <span class="accent-bar" :style="{ background: accent }"></span>
          <span class="crumb-module">{{ activeModule.label }}</span>
        </div>
        <div class="topbar-right">
          <!-- 启动即监控：本机状态摘要 -->
          <NPopover trigger="hover" placement="bottom-end">
            <template #trigger>
              <div class="sys-status">
                <NIcon :component="Activity" :class="{ spin: sysStatus.loading }" />
                <span v-if="sysStatus.diskUsed">磁盘 {{ sysStatus.diskUsed }}</span>
                <span v-if="sysStatus.update">· 新版本 {{ sysStatus.update.latest }}</span>
              </div>
            </template>
            <div class="sys-pop">
              <div>磁盘占用：{{ sysStatus.diskUsed || '--' }}</div>
              <div v-if="s.llmEnabled">LLM 服务：{{ sysStatus.llm?.configured ? `${sysStatus.llm.provider} 已配置` : '未配置' }}</div>
              <div>代理状态：{{ sysStatus.proxy?.enabled ? sysStatus.proxy.server : '未启用' }}</div>
              <div v-if="sysStatus.update">发现新版本 v{{ sysStatus.update.latest }}，可在设置中查看发布说明</div>
              <div class="sys-checked">检查于 {{ sysStatus.checkedAt || '--' }}</div>
            </div>
          </NPopover>
          <NButton size="tiny" quaternary circle :loading="sysStatus.loading" @click="refreshSysStatus" title="刷新系统状态">
            <template #icon><NIcon :component="Activity" /></template>
          </NButton>
          <span class="divider"></span>
          <div v-if="syncLabel" class="sync-chip" :class="{ err: syncStatus.state === 'error', busy: syncStatus.state === 'syncing' }"
              title="云同步状态，点击管理" @click="settingsOpen = true">
            <span class="sync-dot"></span>{{ syncLabel }}
          </div>
          <NButton size="small" quaternary circle title="刷新当前页" @click="requestRefresh()">
            <template #icon><NIcon :component="Refresh" /></template>
          </NButton>
          <NButton size="small" quaternary circle title="系统设置" @click="settingsOpen = true">
            <template #icon><NIcon :component="Settings" /></template>
          </NButton>
          <NButton size="small" quaternary circle title="命令面板 (Ctrl K)" @click="paletteStore.openPanel()">
            <template #icon><NIcon :component="Command" /></template>
          </NButton>
        </div>
      </header>
      <main class="content">
        <router-view />
      </main>
    </div>

    <CommandPalette />
    <SettingsPanel v-model:show="settingsOpen" />
  </div>
</template>

<style scoped>
.shell {
  display: flex;
  height: 100vh;
}
.sidebar {
  width: 196px;
  flex: none;
  background: var(--wb-card);
  border-right: 1px solid var(--wb-border);
  display: flex;
  flex-direction: column;
  align-items: stretch;
  padding: 14px 10px;
  gap: 16px;
  transition: width 160ms ease-out;
  overflow: hidden;
}
.sidebar.collapsed {
  width: 56px;
  padding: 14px 8px;
}
.sidebar.collapsed .logo {
  justify-content: center;
  padding: 0;
}
.sidebar.collapsed .nav-item {
  justify-content: center;
  padding: 0;
  gap: 0;
}
.logo {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 4px;
}
.logo-mark {
  width: 30px;
  height: 30px;
  border-radius: 8px;
  background: var(--wb-accent);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 15px;
  letter-spacing: 0.5px;
}
html.dark .logo-mark {
  color: #0f0f10;
}
.logo-text {
  font-weight: 700;
  font-size: 14px;
  letter-spacing: 0.4px;
  color: var(--wb-text-1);
}
.nav {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
  width: 100%;
  align-items: stretch;
}
.nav-item {
  width: 100%;
  height: 36px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 12px;
  color: var(--wb-text-3);
  transition: background-color 120ms ease-out;
  text-decoration: none;
}
.module-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex: none;
}
.nav-label {
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  color: var(--wb-text-2);
}
.nav-item:hover {
  background: var(--wb-card-alt);
}
.nav-item.active {
  background: var(--wb-card-alt);
}
.nav-item.active .nav-label {
  color: var(--wb-text-1);
}
.nav-item.active .module-dot {
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--wb-accent) 18%, transparent);
}
.sidebar-footer {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.topbar {
  height: 48px;
  flex: none;
  position: relative;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px;
  border-bottom: 1px solid var(--wb-border);
  background: var(--wb-bg);
}
.crumb {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  white-space: nowrap;
}
.crumb-module {
  font-weight: 600;
  font-size: 13.5px;
}
.topbar-right {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: none;
}
.divider {
  width: 1px;
  height: 18px;
  background: var(--wb-border);
}
.sync-chip {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: var(--wb-text-2);
  padding: 2px 8px;
  border: 1px solid var(--wb-border);
  border-radius: 20px;
  cursor: pointer;
  user-select: none;
}
.sync-chip:hover {
  background: var(--wb-card-alt);
}
.sync-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #10b981;
  box-shadow: 0 0 0 2px color-mix(in srgb, #10b981 20%, transparent);
}
.sync-chip.busy .sync-dot {
  background: #f59e0b;
  animation: wb-spin 1s linear infinite;
  border-radius: 50% 2px 50% 50%;
}
.sync-chip.err .sync-dot {
  background: #ef4444;
  box-shadow: 0 0 0 2px color-mix(in srgb, #ef4444 20%, transparent);
}
.kbd {
  font-family: var(--wb-font-mono);
  font-size: 11px;
  color: var(--wb-text-3);
  border: 1px solid var(--wb-border);
  border-radius: 4px;
  padding: 0 5px;
  margin-left: 4px;
}
.content {
  flex: 1;
  overflow-y: auto;
  padding: 14px 18px 36px;
}
.sys-status {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: var(--wb-text-2);
  cursor: default;
  padding: 2px 6px;
  border: 1px solid var(--wb-border);
  border-radius: 6px;
  background: var(--wb-card);
}
.sys-status .spin {
  animation: wb-spin 1s linear infinite;
}
.sys-pop {
  font-size: 12px;
  line-height: 1.8;
  color: var(--wb-text-2);
}
.sys-pop .sys-checked {
  color: var(--wb-text-3);
  margin-top: 4px;
  border-top: 1px solid var(--wb-border);
  padding-top: 4px;
}
@keyframes wb-spin {
  to { transform: rotate(360deg); }
}
</style>
