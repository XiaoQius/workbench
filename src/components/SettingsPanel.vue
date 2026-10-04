<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import {
  NModal, NInput, NSlider, NSwitch, NButton, NTag, NText, NList, NListItem, NThing, NSelect, NTabs, NTabPane,
} from 'naive-ui'
import { useSettings, UPDATE_SOURCE, type CustomCard } from '@/composables/useSettings'
import { modules, tokens, COLOR_MODES, STYLE_MODES, comboKey, type ColorMode, type StyleMode } from '@/theme/tokens'
import { AVATAR_PALETTE, avatarColor, avatarChar, avatarName, avatarSeed, resizeAvatarImage } from '@/composables/avatar'
import { useThemeStore } from '@/stores/theme'
import { exportBackupTo, checkUpdate, downloadUpdate, installUpdate, llmStatus, openPath } from '@/composables/useTauri'
import { APP_VERSION } from '@/composables/useSettings'
import { llmConfigured, llmConfigLabel, llmChat } from '@/composables/llmClient'
import { cloudRegister, cloudLogin, cloudLogout, syncNow, onSyncStatus, listConflicts, resolveConflict, type SyncStatus, type ConflictRow } from '@/db/sync'
import { useConfirm } from '@/composables/useConfirm'
import {
  tasksRepo, deadlinesRepo, projectsRepo, snippetsRepo, habitsRepo, ledgerRepo,
  coursesRepo, assignmentsRepo, notesRepo, pitfallsRepo, serversRepo, domainsRepo,
  toolsRepo, agentsRepo,
} from '@/db'

const props = defineProps<{ show: boolean; initialTab?: string }>()
const emit = defineEmits<{ (e: 'update:show', v: boolean): void }>()

const s = useSettings()
const themeStore = useThemeStore()
const { confirm } = useConfirm()

// 主题预览：配色维度用当前风格的组合取色，风格维度用当前配色的组合取色
function comboPreview(color: ColorMode, style: StyleMode) {
  const tk = tokens[comboKey(color, style)]
  return { bg: tk.bg, accent: tk.accent, border: tk.border, text: tk.text1 }
}


// ---- 设置面板二级分类（工作台升级：单页过长过乱，按类别分组） ----
const activeTab = ref('general')
// 外部指定初始标签（如顶栏「下载并安装」直达更新页）
watch(() => [props.show, props.initialTab] as const, ([show, tab]) => {
  if (show && tab) activeTab.value = tab
}, { immediate: true })
const LLM_PROVIDERS = [
  { label: 'OpenAI 兼容（自定义端点）', value: 'custom' },
  { label: 'OpenAI', value: 'openai' },
  { label: 'DeepSeek', value: 'deepseek' },
  { label: 'Anthropic', value: 'anthropic' },
  { label: 'Ollama（本地）', value: 'ollama' },
]

// ---- 升级检测（Rust 命令 check_update：支持 GitHub owner/repo 或自定义 JSON 端点） ----
const checking = ref(false)
const updateMsg = ref('')
const updateUrl = ref('')
const updateLatest = ref('')
async function checkUpdateNow() {
  updateMsg.value = ''
  updateUrl.value = ''
  updateLatest.value = ''
  checking.value = true
  try {
    const res = await checkUpdate(UPDATE_SOURCE, APP_VERSION)
    if (res.has_update) {
      updateMsg.value = `发现新版本 v${res.latest}（当前 v${APP_VERSION}）`
      updateUrl.value = res.release_url || ''
      updateLatest.value = res.latest || ''
    } else {
      updateMsg.value = `当前已是最新版本 v${APP_VERSION}`
    }
  } catch (e) {
    updateMsg.value = `自动检查失败（${String(e)}），请手动访问更新地址确认版本`
  } finally {
    checking.value = false
  }
}
function openReleasePage() {
  if (!updateUrl.value) return
  openPath(updateUrl.value).catch(() => window.open(updateUrl.value, '_blank'))
}

// ---- 应用内更新：下载 MSI + 拉起 msiexec（仅 Tauri 环境） ----
const installing = ref(false)
const installPhase = ref<'download' | 'install'>('download')
async function downloadAndInstall() {
  if (!updateUrl.value || installing.value) return
  installing.value = true
  installPhase.value = 'download'
  updateMsg.value = '下载中…（安装包约 4 MB）'
  try {
    const path = await downloadUpdate(updateUrl.value, updateLatest.value)
    installPhase.value = 'install'
    // msiexec 覆盖安装时若本应用仍在运行会占用 exe 导致失败（错误 1603），先如实告知
    updateMsg.value = `正在安装 v${updateLatest.value}…（请勿关闭本窗口；若提示文件占用，请先退出 WORKBENCH 再点「在浏览器打开」手动安装）`
    const result = await installUpdate(path)
    updateMsg.value = `v${updateLatest.value} ${result}`
  } catch (e) {
    updateMsg.value = `应用内更新失败：${String(e)}\n可点「在浏览器打开」手动下载安装`
  } finally {
    installing.value = false
  }
}

// ---- LLM 服务：开关 + 自定义配置（工作台升级：非仅开关） ----
const llmMsg = ref('')
const llmTesting = ref(false)

const avatarFileInput = ref<HTMLInputElement | null>(null)
const avatarMsg = ref('')
async function pickAvatarImage(ev: Event) {
  const input = ev.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  const dataUrl = await resizeAvatarImage(file)
  if (!dataUrl) {
    avatarMsg.value = '图片读取失败，请换一张（支持 PNG/JPEG/WebP 等）'
    return
  }
  s.avatarImg = dataUrl
  avatarMsg.value = ''
}
async function refreshLlmStatus() {
  llmMsg.value = ''
  if (llmConfigured()) {
    llmMsg.value = `已配置：${llmConfigLabel()}`
    return
  }
  try {
    const st = await llmStatus()
    llmMsg.value = st.configured ? `已配置（环境变量）：${st.provider}` : '未配置（可在下方填写自定义服务地址与密钥，或使用环境变量）'
  } catch {
    llmMsg.value = '探测失败（需 Tauri 环境）'
  }
}
async function testLlm() {
  llmTesting.value = true
  llmMsg.value = ''
  try {
    const reply = await llmChat('你是 WORKBENCH 智能助手，只回复 OK 两个字母。', '连接测试')
    llmMsg.value = `连接成功：${(reply || '').slice(0, 120)}`
  } catch (e) {
    llmMsg.value = '连接失败：' + String(e)
  } finally {
    llmTesting.value = false
  }
}

// ---- 数据备份（F-SYS-07）：导出全部数据为 JSON 到本地目录 ----
const syncing = ref(false)
const syncMsg = ref('')
async function syncToGitDir() {
  syncMsg.value = ''
  syncing.value = true
  try {
    const dir = s.gitSyncDir.trim()
    if (!dir) {
      syncMsg.value = '请先填写本地备份目录'
      return
    }
    const [tasks, deadlines, projects, snippets, habits, ledger, courses, assignments, notes, pitfalls, servers, domains, tools, agents] =
      await Promise.all([
        tasksRepo.listAll(), deadlinesRepo.listAll(), projectsRepo.listAll(),
        snippetsRepo.listAll(), habitsRepo.listAll(), ledgerRepo.listAll(),
        coursesRepo.listAll(), assignmentsRepo.listAll(), notesRepo.listAll(),
        pitfallsRepo.listAll(), serversRepo.listAll(), domainsRepo.listAll(),
        toolsRepo.listAll(), agentsRepo.listAll(),
      ])
    const payload = {
      app: 'workbench',
      version: 1,
      exportedAt: new Date().toISOString(),
      tables: { tasks, deadlines, projects, snippets, habits, ledger, courses, assignments, notes, pitfalls, servers, domains, tools, agents },
    }
    const target = await exportBackupTo(dir, JSON.stringify(payload))
    syncMsg.value = `已导出备份：${target}\n将该目录接入网盘或 Git 即可实现多机同步`
  } catch (e) {
    syncMsg.value = '备份失败：' + String(e)
  } finally {
    syncing.value = false
  }
}

// ---- 自定义卡片（F-SYS-06 简化版：注册名称+内容卡片，不支持任意 JS 执行） ----
const cardName = ref('')
const cardContent = ref('')
const cardColor = ref('#3b82f6')
function addCard() {
  const name = cardName.value.trim()
  const content = cardContent.value.trim()
  if (!name || !content) return
  const card: CustomCard = { id: String(Date.now()), name, content, color: cardColor.value }
  s.cards.push(card)
  cardName.value = ''
  cardContent.value = ''
}
async function removeCard(id: string) {
  const card = s.cards.find((c) => c.id === id)
  const ok = await confirm({ title: '删除这张自定义卡片？', content: card ? `「${card.name}」将从首页移除。` : '该卡片将从首页移除。' })
  if (!ok) return
  const i = s.cards.findIndex((c) => c.id === id)
  if (i >= 0) s.cards.splice(i, 1)
}

const hintColor = '#999'

onMounted(() => { if (s.cloudEnabled && s.cloudToken) void loadConflicts() })

const tableLabels: Record<string, string> = {
  tasks: '任务', deadlines: '截止', links: '链接', projects: '项目', snippets: '代码片段',
  tools: '工具', agents: 'Agent', servers: '服务器', domains: '域名', backups: '备份',
  habits: '习惯', habitLogs: '习惯打卡', ledger: '记账', pomodoros: '专注', healthLogs: '健康',
  courses: '课程', assignments: '作业', notes: '笔记', pitfalls: '踩坑', resources: '资源',
  opsFlows: '指标', opsChanges: '变更', opsSecChecks: '安全检查', opsSecrets: '密钥', opsDns: 'DNS',
  deployments: '部署', envVars: '环境变量', techDebts: '技术债', cmdSnippets: '命令',
  decisions: '决策', skillTree: '技能树', learningPaths: '学习路径', threeDProjects: '3D 项目',
  portfolios: '作品', contentCalendars: '内容日历', fixedBills: '固定账单', grades: '成绩',
  flashcards: '闪卡', readQueue: '阅读', feynmanLogs: '费曼', inspirations: '灵感',
}

// ---- 云同步：注册/登录 + 状态（可选能力，不开启不影响本地使用） ----
const cloudForm = ref({ server: s.cloudUrl || 'https://testapi.xusn.cn', username: '', password: '', device: '我的电脑' })
const cloudBusy = ref(false)
const cloudMsg = ref('')
const syncStatus = ref<SyncStatus>({ state: 'idle', message: '', lastSyncAt: null, pending: 0, conflicts: 0 })
const conflicts = ref<ConflictRow[]>([])
async function loadConflicts() {
  try { conflicts.value = await listConflicts() } catch { conflicts.value = [] }
}
onSyncStatus((st) => {
  syncStatus.value = st
  if (st.lastSyncAt) s.lastSyncAt = st.lastSyncAt
  void loadConflicts()
})

async function resolveConflictRow(c: ConflictRow, choice: 'local' | 'remote') {
  try {
    await resolveConflict(c.table, c.rowId, choice)
    await loadConflicts()
    cloudMsg.value = choice === 'local' ? '已保留本地版本并上传' : '已采用云端版本'
  } catch (e) {
    cloudMsg.value = '处理失败：' + String(e instanceof Error ? e.message : e)
  }
}
async function doCloudRegister() {
  cloudBusy.value = true; cloudMsg.value = ''
  try {
    await cloudRegister(cloudForm.value.server, cloudForm.value.username.trim(), cloudForm.value.password, cloudForm.value.device.trim() || '我的电脑')
    cloudMsg.value = '注册成功，已开始首次同步…'
    void syncNow()
  } catch (e) { cloudMsg.value = '注册失败：' + String(e instanceof Error ? e.message : e) } finally { cloudBusy.value = false }
}
async function doCloudLogin() {
  cloudBusy.value = true; cloudMsg.value = ''
  try {
    await cloudLogin(cloudForm.value.server, cloudForm.value.username.trim(), cloudForm.value.password, cloudForm.value.device.trim() || '我的电脑')
    cloudMsg.value = '登录成功，正在同步…'
    void syncNow()
  } catch (e) { cloudMsg.value = '登录失败：' + String(e instanceof Error ? e.message : e) } finally { cloudBusy.value = false }
}
function doCloudLogout() {
  cloudLogout(); cloudMsg.value = '已退出云同步（本地数据保留不动）'
}
async function doSyncNow() {
  cloudMsg.value = ''; void syncNow()
}
const syncStateLabel = computed(() => ({
  idle: s.cloudToken ? '已连接' : '未启用',
  syncing: '同步中…',
  error: '异常',
  offline: '离线',
}[syncStatus.value.state] || syncStatus.value.state))

// 字号滑块：拖动时用本地值保持流畅，松手才提交到全局设置（避免每帧触发深监听写盘）
const fontScaleDraft = ref(s.fontScale)
function commitFontScale(v: number) {
  fontScaleDraft.value = v
  s.fontScale = v
}
</script>

<template>
  <NModal :show="props.show" @update:show="(v: boolean) => emit('update:show', v)" preset="card" style="width: 680px; max-width: 94vw">
    <div class="sp-title">系统设置</div>

    <NTabs v-model:value="activeTab" type="line" animated class="sp-tabs">
      <!-- 通用：头像 / 无障碍 / 快捷键 / 自定义卡片 -->
      <NTabPane name="general" tab="通用">
        <div class="sp-sec">
          <div class="sp-label">头像</div>
          <div class="sp-row" style="align-items: center; gap: 14px">
            <img v-if="s.avatarImg" class="avatar-preview avatar-img" :src="s.avatarImg" alt="头像" />
            <span v-else class="avatar-preview" :style="{ background: s.avatarColor || avatarColor(avatarSeed(s.deviceName, s.cloudUser)) }">{{ (s.avatarText.trim() || avatarChar(avatarName(s.deviceName, s.cloudUser))) }}</span>
            <NInput v-model:value="s.avatarText" placeholder="头像文字（留空自动取用户名/设备名首字）" maxlength="2" style="flex: 1" />
          </div>
          <div class="sp-row" style="flex-wrap: wrap; gap: 8px">
            <NButton size="tiny" @click="avatarFileInput?.click()">上传图片</NButton>
            <NButton v-if="s.avatarImg" size="tiny" quaternary @click="s.avatarImg = ''">移除图片</NButton>
            <input ref="avatarFileInput" type="file" accept="image/*" style="display: none" @change="pickAvatarImage($event)" />
            <span v-if="avatarMsg" class="sp-dim">{{ avatarMsg }}</span>
          </div>
          <div class="sp-row" style="flex-wrap: wrap; gap: 8px">
            <button
              v-for="c in AVATAR_PALETTE"
              :key="c"
              type="button"
              class="avatar-dot"
              :class="{ active: s.avatarColor === c }"
              :style="{ background: c }"
              @click="s.avatarColor = s.avatarColor === c ? '' : c"
            ></button>
            <NButton v-if="s.avatarColor" size="tiny" quaternary @click="s.avatarColor = ''">恢复自动配色</NButton>
          </div>
          <div class="sp-dim">可上传图片作为头像（自动裁成方形并压缩）；未上传图片时，点选色块自定义底色，再点一次取消；未设置时按登录用户名自动配色。</div>
        </div>

        <div class="sp-sec">
          <div class="sp-label">无障碍 · 字号可调</div>
          <div class="sp-row">
            <span class="sp-dim">85%</span>
            <NSlider :value="fontScaleDraft" :min="0.85" :max="1.3" :step="0.05" style="flex: 1" @update-value="commitFontScale" />
            <span class="sp-dim">130%</span>
          </div>
          <div class="sp-row">
            <span>减少动效（prefers-reduced-motion）</span>
            <NSwitch v-model:value="s.reducedMotion" />
          </div>
        </div>

        <div class="sp-sec">
          <div class="sp-label">快捷键自定义</div>
          <div class="sp-row"><span>Ctrl+1..8 模块切换</span><NSwitch v-model:value="s.keymap.ctrlNum" /></div>
          <div class="sp-row"><span>g 序列跳转（g d / g l / g s / g o / g k / g w / g h）</span><NSwitch v-model:value="s.keymap.gSeq" /></div>
          <div class="sp-row"><span>Ctrl+Shift+D 主题切换</span><NSwitch v-model:value="s.keymap.theme" /></div>
          <div class="sp-row"><span>n 快速新建（编辑区外）</span><NSwitch v-model:value="s.keymap.newShortcut" /></div>
          <div class="sp-dim">关闭某项可避免与系统或应用快捷键冲突；Ctrl+K 命令面板固定保留。</div>
        </div>

        <div class="sp-sec">
          <div class="sp-label">自定义卡片</div>
          <div class="sp-row">
            <NInput v-model:value="cardName" placeholder="卡片名称" style="flex: 0 0 160px" />
            <NInput v-model:value="cardContent" placeholder="内容（文本 / 键值行）" style="flex: 1" />
            <NButton size="small" type="primary" ghost @click="addCard()">添加</NButton>
          </div>
          <NList v-if="s.cards.length" size="small" style="margin-top: 8px">
            <NListItem v-for="c in s.cards" :key="c.id">
              <NThing :title="c.name" :description="c.content">
                <template #header-extra>
                  <NButton size="tiny" text type="error" @click="removeCard(c.id)">删除</NButton>
                </template>
              </NThing>
            </NListItem>
          </NList>
          <div class="sp-dim">简化实现：注册文本卡片展示在首页，不执行任意 JS（安全考虑）。</div>
        </div>
      </NTabPane>

      <!-- 显示：主题选择 + 板块显示开关 -->
      <NTabPane name="display" tab="显示">
        <div class="sp-sec">
          <div class="sp-label">配色（明暗）</div>
          <div class="theme-grid">
            <button
              v-for="c in COLOR_MODES"
              :key="c.key"
              type="button"
              class="theme-item"
              :class="{ active: themeStore.colorMode === c.key }"
              @click="themeStore.setColorMode(c.key)"
            >
              <span class="theme-swatch" :style="{ background: comboPreview(c.key, themeStore.styleMode).bg, borderColor: comboPreview(c.key, themeStore.styleMode).border }">
                <span class="swatch-bar" :style="{ background: comboPreview(c.key, themeStore.styleMode).accent }"></span>
                <span class="swatch-block" :style="{ background: comboPreview(c.key, themeStore.styleMode).bg, borderColor: comboPreview(c.key, themeStore.styleMode).border, color: comboPreview(c.key, themeStore.styleMode).text }"></span>
              </span>
              <span class="theme-name">{{ c.label }}</span>
            </button>
          </div>
          <div class="sp-label" style="margin-top: 14px">风格（造型）</div>
          <div class="theme-grid">
            <button
              v-for="st in STYLE_MODES"
              :key="st.key"
              type="button"
              class="theme-item"
              :class="{ active: themeStore.styleMode === st.key }"
              @click="themeStore.setStyleMode(st.key)"
            >
              <span class="theme-swatch" :style="{ background: comboPreview(themeStore.colorMode, st.key).bg, borderColor: comboPreview(themeStore.colorMode, st.key).border }">
                <span class="swatch-bar" :style="{ background: comboPreview(themeStore.colorMode, st.key).accent }"></span>
                <span class="swatch-block" :style="{ background: comboPreview(themeStore.colorMode, st.key).bg, borderColor: comboPreview(themeStore.colorMode, st.key).border, color: comboPreview(themeStore.colorMode, st.key).text }"></span>
              </span>
              <span class="theme-name">{{ st.label }}</span>
            </button>
          </div>
          <div class="sp-dim">配色与风格两维独立组合（共 6 套）；顶栏的 ☀/☾ 按钮与 Ctrl+Shift+D 只切明暗、保留当前风格；选择会记住并在重启后保持。</div>
        </div>

        <div class="sp-sec">
          <div class="sp-label">板块显示（关闭后在左侧菜单隐藏对应板块）</div>
          <div class="sp-grid">
            <div v-for="m in modules" :key="m.key" class="sp-row sp-switch">
              <span>{{ m.label }}</span>
              <NSwitch v-model:value="s.sections[m.key]" size="small" />
            </div>
          </div>
          <div class="sp-dim">当前激活板块不受影响；关闭全部板块时仍保留总览入口。</div>
        </div>
      </NTabPane>

      <!-- AI 与 LLM：自定义 LLM 服务配置 -->
      <NTabPane name="ai" tab="AI 与 LLM">
        <div class="sp-sec">
          <div class="sp-label">LLM 服务（自定义配置）</div>
          <div class="sp-row">
            <span>启用智能层 / LLM 能力</span>
            <NSwitch v-model:value="s.llmEnabled" />
            <NButton size="tiny" quaternary @click="refreshLlmStatus()">探测状态</NButton>
            <NButton size="tiny" type="primary" ghost :loading="llmTesting" @click="testLlm()">测试连接</NButton>
          </div>
          <div class="sp-row">
            <span class="sp-dim sp-k">服务类型</span>
            <NSelect v-model:value="s.llm.provider" :options="LLM_PROVIDERS" style="flex: 1" />
          </div>
          <div class="sp-row">
            <span class="sp-dim sp-k">Base URL</span>
            <NInput v-model:value="s.llm.baseUrl" placeholder="如 https://api.openai.com/v1 或 http://localhost:11434/v1（留空按服务类型取默认）" style="flex: 1" />
          </div>
          <div class="sp-row">
            <span class="sp-dim sp-k">API Key</span>
            <NInput v-model:value="s.llm.apiKey" type="password" show-password-on="click" placeholder="留空则使用系统环境变量" style="flex: 1" />
          </div>
          <div class="sp-row">
            <span class="sp-dim sp-k">模型</span>
            <NInput v-model:value="s.llm.model" placeholder="如 gpt-4o-mini / deepseek-chat / llama3" style="flex: 1" />
          </div>
          <div class="sp-dim" v-if="llmMsg">{{ llmMsg }}</div>
          <div class="sp-dim">配置后智能问答将优先调用该服务回答；关闭开关仅隐藏 AI 入口，不影响本地数据能力。API Key 仅保存在本机，不上传。</div>
        </div>
      </NTabPane>

      <!-- 更新与备份：应用更新 / 数据备份 -->
      <NTabPane name="version" tab="更新与备份">
        <div class="sp-sec">
          <div class="sp-label">应用更新 · 当前 v{{ APP_VERSION }}</div>
          <div class="sp-row">
            <NButton size="small" type="primary" ghost :loading="checking" @click="checkUpdateNow()">检查更新</NButton>
          </div>
          <div class="sp-row">
            <span>启动时自动检查更新</span>
            <NSwitch v-model:value="s.autoCheckUpdate" size="small" />
          </div>
          <div class="sp-dim" v-if="updateMsg" style="white-space: pre-line">{{ updateMsg }}</div>
          <div class="sp-row" v-if="updateUrl">
            <NButton size="small" type="primary" :loading="installing" @click="downloadAndInstall()">
              {{ installing ? (installPhase === 'download' ? '下载中…' : '启动安装…') : '下载并安装' }}
            </NButton>
            <NButton size="small" quaternary @click="openReleasePage()">在浏览器打开</NButton>
          </div>
        </div>

        <div class="sp-sec">
          <div class="sp-label">数据备份</div>
          <div class="sp-row">
            <NInput v-model:value="s.gitSyncDir" placeholder="本地备份目录，如 D:\sync\workbench" style="flex: 1" />
            <NButton size="small" type="primary" ghost :loading="syncing" @click="syncToGitDir()">导出备份</NButton>
          </div>
          <div class="sp-dim" v-if="syncMsg" style="white-space: pre-line; color: var(--wb-success)">{{ syncMsg }}</div>
          <div class="sp-dim">将工作台全部数据导出为 JSON 备份文件，可搭配网盘或 Git 实现多机同步。</div>
        </div>
      </NTabPane>

      <!-- 云同步：可选能力。注册/登录后多端实时同步；不开启则纯本地，无强制登录 -->
      <NTabPane name="cloud" tab="云同步">
        <div class="sp-sec">
          <div class="sp-row">
            <span style="flex:1">启用云同步（多端实时同步全部数据）</span>
            <NSwitch v-model:value="s.cloudEnabled" />
          </div>
        </div>

        <template v-if="!s.cloudToken">
          <div class="sp-sec">
            <div class="sp-label">注册 / 登录云端账户</div>
            <div class="sp-row"><NInput v-model:value="cloudForm.server" placeholder="服务地址" style="flex: 1" /></div>
            <div class="sp-row"><NInput v-model:value="cloudForm.username" placeholder="用户名" style="flex: 1" /></div>
            <div class="sp-row"><NInput v-model:value="cloudForm.password" type="password" show-password-on="click" placeholder="密码（≥6位）" style="flex: 1" /></div>
            <div class="sp-row"><NInput v-model:value="cloudForm.device" placeholder="设备名称" style="flex: 1" /></div>
            <div class="sp-row">
              <NButton size="small" type="primary" :loading="cloudBusy" @click="doCloudRegister()">注册并同步</NButton>
              <NButton size="small" :loading="cloudBusy" @click="doCloudLogin()">登录</NButton>
            </div>
            <div class="sp-dim" v-if="cloudMsg" style="white-space: pre-line">{{ cloudMsg }}</div>
          </div>
        </template>

        <template v-else>
          <div class="sp-sec">
            <div class="sp-label">同步状态</div>
            <div class="sp-row"><span class="sp-dim" style="margin:0">状态：</span><NTag size="small" :type="syncStatus.state === 'error' ? 'error' : syncStatus.state === 'offline' ? 'warning' : 'success'">{{ syncStateLabel }}</NTag>
              <span class="sp-dim" style="margin:0 0 0 10px" v-if="syncStatus.message">{{ syncStatus.message }}</span></div>
            <div class="sp-row"><span class="sp-dim" style="margin:0">设备：{{ s.deviceName || '（未命名）' }}</span></div>
            <div class="sp-row"><span class="sp-dim" style="margin:0">上次同步：{{ s.lastSyncAt ? new Date(s.lastSyncAt).toLocaleString() : '从未' }}</span>
              <span class="sp-dim" style="margin:0 0 0 10px">待推送：{{ syncStatus.pending }} 行</span></div>
            <div class="sp-row">
              <NButton size="small" type="primary" ghost :loading="syncStatus.state === 'syncing'" @click="doSyncNow()">立即同步</NButton>
              <NButton size="small" quaternary type="warning" @click="doCloudLogout()">退出登录</NButton>
            </div>
            <div v-if="conflicts.length" class="conflict-box">
              <div class="conflict-title">{{ conflicts.length }} 处改动与云端冲突</div>
              <div class="sp-dim" style="margin-bottom: 8px">这些记录在你离线期间被其它设备改过。请选择保留哪一边，未处理前两边都会保留。</div>
              <div v-for="c in conflicts" :key="c.table + c.rowId" class="conflict-row">
                <div class="conflict-info">
                  <span class="conflict-label">{{ c.label }}</span>
                  <span class="sp-dim">{{ tableLabels[c.table] || c.table }}</span>
                </div>
                <div class="conflict-ops">
                  <NButton size="tiny" type="primary" ghost @click="resolveConflictRow(c, 'local')">保留我的</NButton>
                  <NButton size="tiny" quaternary @click="resolveConflictRow(c, 'remote')">用云端的</NButton>
                </div>
              </div>
            </div>
            <div class="sp-dim" v-if="cloudMsg" style="white-space: pre-line">{{ cloudMsg }}</div>
          </div>
        </template>
      </NTabPane>
    </NTabs>

    <template #footer>
      <NButton type="primary" size="small" @click="emit('update:show', false)">完成</NButton>
    </template>
  </NModal>
</template>

<style scoped>
.sp-title { font-size: 16px; font-weight: 650; margin-bottom: 12px; }
.sp-tabs { margin-top: 4px; }
.sp-sec { margin-bottom: 18px; }
.sp-label { font-size: 13px; font-weight: 600; margin-bottom: 8px; }
.sp-row { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; font-size: 13px; }
.sp-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 0 16px; }
.avatar-preview {
  width: 34px; height: 34px; flex: none;
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-weight: 700; font-size: 15px;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.18);
}
.avatar-img { object-fit: cover; }
.avatar-dot {
  width: 22px; height: 22px; border-radius: 50%;
  border: 2px solid transparent; cursor: pointer; padding: 0;
  transition: transform 120ms ease-out;
}
.avatar-dot:hover { transform: scale(1.15); }
.avatar-dot.active { border-color: var(--wb-text-1); box-shadow: 0 0 0 2px var(--wb-bg) inset; }
.sp-switch > span { flex: 1; }
.sp-switch .n-switch { margin-left: auto; }
.sp-dim { font-size: 12px; color: var(--wb-text-3); margin-top: 4px; }
.sp-k { width: 110px; flex: none; margin-top: 0; }
.theme-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.theme-item {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 6px;
  padding: 6px;
  border: 1px solid var(--wb-border);
  border-radius: var(--wb-radius-md);
  background: var(--wb-card);
  cursor: pointer;
  font: inherit;
  color: var(--wb-text-1);
  transition: border-color 120ms ease-out, box-shadow 120ms ease-out;
}
.theme-item:hover { border-color: var(--wb-accent); }
.theme-item.active {
  border: 2px solid var(--wb-accent);
  padding: 5px;
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--wb-accent) 22%, transparent);
}
.theme-swatch {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px;
  border-radius: var(--wb-radius-sm);
  border: 2px solid;
}
.swatch-bar { height: 8px; border-radius: 3px; }
.swatch-block {
  height: 20px;
  border-radius: 3px;
  border: 1px solid;
  font-size: 9px;
  line-height: 18px;
  text-align: center;
}
.theme-name { font-size: 12px; text-align: center; }
.conflict-box {
  margin-top: 10px;
  padding: 10px 12px;
  border: 1px solid var(--wb-warning, #f59e0b);
  border-radius: var(--wb-radius-md);
  background: var(--wb-card-alt);
}
.conflict-title { font-size: 12.5px; font-weight: 600; color: var(--wb-warning, #f59e0b); margin-bottom: 4px; }
.conflict-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 6px 0;
  border-top: 1px solid var(--wb-border);
}
.conflict-info { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.conflict-label { font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.conflict-ops { display: flex; gap: 6px; flex: none; }
</style>
