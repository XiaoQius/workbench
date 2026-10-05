<script setup lang="ts">
import { computed, onMounted, nextTick, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { NButton, NIcon, NTag, NPopover, NTooltip, NInput, useMessage } from 'naive-ui'
import { Moon, Sun, Command, LayoutSidebar, Activity, Refresh, Settings, Bulb, Home, Briefcase, Code, Server, Heart, Book2, School } from '@vicons/tabler'
import { modules, moduleColor } from '@/theme/tokens'
import { avatarColor, avatarChar, avatarName, avatarSeed } from '@/composables/avatar'
import { useThemeStore } from '@/stores/theme'
import { usePaletteStore } from '@/stores/palette'
import { useSettings, UPDATE_SOURCE, APP_VERSION } from '@/composables/useSettings'
import { llmConfigured } from '@/composables/llmClient'
import { diskSpace, llmStatus, proxyDetect, checkUpdate, type DiskInfo, type LlmStatus, type ProxyInfo } from '@/composables/useTauri'
import { inspirationsRepo } from '@/db'
import CommandPalette from './CommandPalette.vue'
import SettingsPanel from '@/components/SettingsPanel.vue'
import { refreshTick, settingsOpen, settingsTab, requestRefresh } from '@/stores/ui'
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

const shortcuts = ['1', '2', '3', '4', '5', '6', '7', '8']

// 模块线条图标:折叠侧栏下靠图标辨认模块(圆点仅展开时做点缀)
const MODULE_ICONS: Record<string, unknown> = {
  home: Home, workspace: Briefcase, dev: Code, ops: Server,
  life: Heart, study: Book2, knowledge: School, inspiration: Bulb,
}

// 侧栏顶部头像：自定义 > 登录用户名定色 > 设备名稳定取色
// 展示名优先级：用户自定义 displayName > 登录用户名 > 设备名。
// avatarText 只控制头像圈里的字（未上传图片时），与展示名互不干扰。
const avatarLabel = computed(() => s.displayName.trim() || avatarName(s.deviceName, s.cloudUser))
const avatarBg = computed(() => s.avatarColor || avatarColor(avatarSeed(s.deviceName, s.cloudUser)))
const avatarCharText = computed(() => s.avatarText.trim() ? s.avatarText.trim()[0] : avatarChar(avatarLabel.value))

// 板块开关：设置中可关闭的板块从侧栏隐藏（当前激活页不受影响）
const navModules = computed(() => modules.filter((m) => s.sections[m.key]))

// ---- 顶栏快速捕获灵感：单行输入，回车即存 ----
const message = useMessage()
const quickInsp = ref('')
const quickInspShow = ref(false)
const quickInputEl = ref<{ focus: () => void } | null>(null)
watch(quickInspShow, (v) => {
  if (v) nextTick(() => quickInputEl.value?.focus())
  else quickInsp.value = ''
})
async function saveQuickInspiration() {
  const raw = quickInsp.value.trim()
  if (!raw) return
  const { parseInspiration } = await import('@/composables/inspiration')
  const { content, tags } = parseInspiration(raw)
  if (!content && !tags) return
  try {
    await inspirationsRepo.insert({ content: content || raw, tags: tags || null })
    quickInsp.value = ''
    message.success('灵感已记录')
    requestRefresh()
  } catch {
    message.error('记录失败：数据层不可用')
  }
}

// ---- 启动即监控本机状态（磁盘 / LLM / 代理 / 更新） ----
const sysStatus = ref<{
  diskUsed: string
  llm: LlmStatus | null
  proxy: ProxyInfo | null
  update: { has: boolean; latest: string; url: string } | null
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
      const up = await checkUpdate(url, APP_VERSION)
      sysStatus.value.update = up.has_update
        ? { has: true, latest: up.latest ?? '', url: up.release_url ?? '' }
        : null
    } catch {
      sysStatus.value.update = null
    }
  }
}

const syncStatus = ref<SyncStatus>({ state: 'idle', message: '', lastSyncAt: null, pending: 0, conflicts: 0 })
function openSettings(tab?: string) {
  settingsTab.value = tab
  settingsOpen.value = true
}
function openDownload() {
  // 应用内下载/安装统一在设置页「更新与备份」完成，避免两处重复实现
  openSettings('version')
}
onSyncStatus((st) => { syncStatus.value = st })
const syncLabel = computed(() => {
  if (!useSettings().cloudToken) return ''
  if (syncStatus.value.state === 'syncing') return '同步中'
  if (syncStatus.value.state === 'error') return '同步异常'
  if (syncStatus.value.state === 'offline') return '离线待传'
  if (syncStatus.value.conflicts > 0) return syncStatus.value.conflicts + ' 处冲突'
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
      <div class="logo" :title="avatarLabel + ' · WORKBENCH'">
        <span class="avatar-slot">
          <img v-if="s.avatarImg" class="user-avatar" :src="s.avatarImg" :alt="avatarLabel" />
          <span v-else class="user-avatar" :style="{ background: avatarBg }">{{ avatarCharText }}</span>
        </span>
        <span v-if="!s.sidebarCollapsed" class="logo-text">{{ avatarLabel }}</span>
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
          <NIcon class="nav-icon" :component="MODULE_ICONS[m.key] || Home" :style="{ color: activeModule.key === m.key ? moduleColor(m.key, themeStore.dark) : undefined }" />
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
              <div v-if="sysStatus.update" class="sys-update">
                <span>发现新版本 v{{ sysStatus.update.latest }}</span>
                <NButton
                  v-if="sysStatus.update.url"
                  size="tiny"
                  type="primary"
                  ghost
                  @click="openDownload()"
                >下载并安装</NButton>
                <NButton v-else size="tiny" text type="primary" @click="openSettings()">查看</NButton>
              </div>
              <div class="sys-checked">检查于 {{ sysStatus.checkedAt || '--' }}</div>
            </div>
          </NPopover>
          <NButton size="tiny" quaternary circle :loading="sysStatus.loading" @click="refreshSysStatus()" title="刷新系统状态">
            <template #icon><NIcon :component="Activity" /></template>
          </NButton>
          <span class="divider"></span>
          <NPopover v-model:show="quickInspShow" trigger="click" placement="bottom-end" :style="{ width: '340px' }">
            <template #trigger>
              <NButton size="small" quaternary circle title="记灵感" class="quick-bulb">
                <template #icon><NIcon :component="Bulb" /></template>
              </NButton>
            </template>
            <div class="quick-insp">
              <NInput
                ref="quickInputEl"
                v-model:value="quickInsp"
                placeholder="灵感稍纵即逝… 支持 #标签 回车即存"
                size="small"
                clearable
                @keyup.enter="saveQuickInspiration()"
              />
              <div class="quick-insp-tip">Enter 保存 · 自动解析 #标签</div>
            </div>
          </NPopover>
          <div v-if="syncLabel" class="sync-chip" :class="{ err: syncStatus.state === 'error', busy: syncStatus.state === 'syncing' }"
              title="云同步状态，点击管理" @click="openSettings()">
            <span class="sync-dot"></span>{{ syncLabel }}
          </div>
          <NButton size="small" quaternary circle title="刷新当前页" @click="requestRefresh()">
            <template #icon><NIcon :component="Refresh" /></template>
          </NButton>
          <NButton size="small" quaternary circle title="系统设置" @click="openSettings()">
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
    <SettingsPanel v-model:show="settingsOpen" :initial-tab="settingsTab" />
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
  border: var(--wb-border-w) solid var(--wb-border);
  border-radius: var(--wb-radius-lg);
  margin: 10px 0 10px 10px;
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
  /* 折叠态头像与图标各自水平居中，中心线天然对齐 */
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
  /* 12px 与 .nav-item 左内衬一致：头像左缘 = 导航图标左缘 */
  padding: 0 12px;
}
.avatar-slot {
  /* 与 .nav-icon 同宽并让头像居中：头像中心线 = 导航图标中心线（展开态左缘同 padding 时精确对齐） */
  width: 17px;
  flex: none;
  display: flex;
  justify-content: center;
}
.user-avatar {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  flex: none;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 14px;
  letter-spacing: 0.5px;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.18);
}
img.user-avatar {
  object-fit: cover;
}
.logo-text {
  font-weight: 700;
  font-size: 14px;
  letter-spacing: 0.4px;
  color: var(--wb-text-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
  border-radius: var(--wb-radius-md);
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 12px;
  color: var(--wb-text-3);
  transition: background-color 120ms ease-out;
  text-decoration: none;
}
.nav-icon {
  flex: none;
  font-size: 17px;
  color: var(--wb-text-3);
}
.nav-item.active .nav-icon {
  color: var(--wb-text-1);
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
  margin: var(--wb-shell-edge) var(--wb-shell-edge) 0 var(--wb-shell-edge);
  padding: 0 var(--wb-topbar-pad-x);
  border: var(--wb-border-w) solid var(--wb-border);
  border-radius: var(--wb-radius-lg);
  background: var(--wb-card);
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
  border: var(--wb-border-w) solid var(--wb-border);
  border-radius: var(--wb-radius-lg);
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
  background: var(--wb-success);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--wb-success) 20%, transparent);
}
.sync-chip.busy .sync-dot {
  background: var(--wb-warning);
  animation: wb-spin 1s linear infinite;
  border-radius: 50% 2px 50% 50%;
}
.sync-chip.err .sync-dot {
  background: var(--wb-danger);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--wb-danger) 20%, transparent);
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
  padding: 14px var(--wb-content-pad-x) 26px;
}
.sys-status {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: var(--wb-text-2);
  cursor: default;
  padding: 2px 6px;
  border: var(--wb-border-w) solid var(--wb-border);
  border-radius: var(--wb-radius-sm);
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
.quick-bulb {
  color: var(--wb-warning);
}
.quick-insp-tip {
  margin-top: 6px;
  font-size: 11px;
  color: var(--wb-text-3);
}
@keyframes wb-spin {
  to { transform: rotate(360deg); }
}
</style>
