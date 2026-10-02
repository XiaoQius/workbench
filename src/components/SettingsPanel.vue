<script setup lang="ts">
import { ref, computed } from 'vue'
import {
  NModal, NInput, NSlider, NSwitch, NButton, NTag, NText, NList, NListItem, NThing, NSelect, NTabs, NTabPane,
} from 'naive-ui'
import { useSettings, UPDATE_SOURCE, type CustomCard } from '@/composables/useSettings'
import { modules } from '@/theme/tokens'
import { exportBackupTo, checkUpdate, llmStatus } from '@/composables/useTauri'
import { llmConfigured, llmConfigLabel, llmChat } from '@/composables/llmClient'
import { cloudRegister, cloudLogin, cloudLogout, syncNow, onSyncStatus, type SyncStatus } from '@/db/sync'
import {
  tasksRepo, deadlinesRepo, projectsRepo, snippetsRepo, habitsRepo, ledgerRepo,
  coursesRepo, assignmentsRepo, notesRepo, pitfallsRepo, serversRepo, domainsRepo,
  toolsRepo, agentsRepo,
} from '@/db'

const props = defineProps<{ show: boolean }>()
const emit = defineEmits<{ (e: 'update:show', v: boolean): void }>()

const s = useSettings()

const APP_VERSION = '0.1.2'

// ---- 设置面板二级分类（工作台升级：单页过长过乱，按类别分组） ----
const activeTab = ref('general')
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
async function checkUpdateNow() {
  updateMsg.value = ''
  checking.value = true
  try {
    const res = await checkUpdate(UPDATE_SOURCE, APP_VERSION)
    if (res.has_update) {
      updateMsg.value = `发现新版本 v${res.latest}（当前 v${APP_VERSION}）` + (res.release_url ? `\n发布页：${res.release_url}` : '')
    } else {
      updateMsg.value = `当前已是最新版本 v${APP_VERSION}`
    }
  } catch (e) {
    updateMsg.value = `自动检查失败（${String(e)}），请手动访问更新地址确认版本`
  } finally {
    checking.value = false
  }
}

// ---- LLM 服务：开关 + 自定义配置（工作台升级：非仅开关） ----
const llmMsg = ref('')
const llmTesting = ref(false)
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
function removeCard(id: string) {
  const i = s.cards.findIndex((c) => c.id === id)
  if (i >= 0) s.cards.splice(i, 1)
}

const hintColor = '#999'

// ---- 云同步：注册/登录 + 状态（可选能力，不开启不影响本地使用） ----
const cloudForm = ref({ server: s.cloudUrl || 'https://testapi.xusn.cn', username: '', password: '', device: '我的电脑' })
const cloudBusy = ref(false)
const cloudMsg = ref('')
const syncStatus = ref<SyncStatus>({ state: 'idle', message: '', lastSyncAt: null, pending: 0 })
onSyncStatus((st) => {
  syncStatus.value = st
  if (st.lastSyncAt) s.lastSyncAt = st.lastSyncAt
})
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
</script>

<template>
  <NModal :show="props.show" @update:show="(v: boolean) => emit('update:show', v)" preset="card" style="width: 680px; max-width: 94vw">
    <div class="sp-title">系统设置</div>

    <NTabs v-model:value="activeTab" type="line" animated class="sp-tabs">
      <!-- 通用：无障碍 / 快捷键 / 自定义卡片 -->
      <NTabPane name="general" tab="通用">
        <div class="sp-sec">
          <div class="sp-label">无障碍 · 字号可调（F-SYS-11）</div>
          <div class="sp-row">
            <span class="sp-dim">85%</span>
            <NSlider v-model:value="s.fontScale" :min="0.85" :max="1.3" :step="0.05" style="flex: 1" />
            <span class="sp-dim">130%</span>
          </div>
          <div class="sp-row">
            <span>减少动效（prefers-reduced-motion）</span>
            <NSwitch v-model:value="s.reducedMotion" />
          </div>
        </div>

        <div class="sp-sec">
          <div class="sp-label">快捷键自定义（F-SYS-02）</div>
          <div class="sp-row"><span>Ctrl+1..7 模块切换</span><NSwitch v-model:value="s.keymap.ctrlNum" /></div>
          <div class="sp-row"><span>g 序列跳转（g d / g l / g s / g o / g k / g w / g h）</span><NSwitch v-model:value="s.keymap.gSeq" /></div>
          <div class="sp-row"><span>Ctrl+Shift+D 主题切换</span><NSwitch v-model:value="s.keymap.theme" /></div>
          <div class="sp-row"><span>n 快速新建（编辑区外）</span><NSwitch v-model:value="s.keymap.newShortcut" /></div>
          <div class="sp-dim">关闭某项可避免与系统或应用快捷键冲突；Ctrl+K 命令面板固定保留。</div>
        </div>

        <div class="sp-sec">
          <div class="sp-label">自定义卡片（F-SYS-06 简化版）</div>
          <div class="sp-row">
            <NInput v-model:value="cardName" placeholder="卡片名称" style="flex: 0 0 160px" />
            <NInput v-model:value="cardContent" placeholder="内容（文本 / 键值行）" style="flex: 1" />
            <NButton size="small" type="primary" ghost @click="addCard">添加</NButton>
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

      <!-- 显示：板块显示开关 -->
      <NTabPane name="display" tab="显示">
        <div class="sp-sec">
          <div class="sp-label">板块显示（关闭后在左侧菜单隐藏对应板块）</div>
          <div class="sp-grid">
            <div v-for="m in modules" :key="m.key" class="sp-row">
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
            <NButton size="tiny" quaternary @click="refreshLlmStatus">探测状态</NButton>
            <NButton size="tiny" type="primary" ghost :loading="llmTesting" @click="testLlm">测试连接</NButton>
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
            <NButton size="small" type="primary" ghost :loading="checking" @click="checkUpdateNow">检查更新</NButton>
            <span class="sp-dim">更新检查已内置，无需配置</span>
          </div>
          <div class="sp-row">
            <span>启动时自动检查更新</span>
            <NSwitch v-model:value="s.autoCheckUpdate" size="small" />
          </div>
          <div class="sp-dim" v-if="updateMsg" style="white-space: pre-line">{{ updateMsg }}</div>
          <div class="sp-dim">启动后自动检测官方发布的新版本，发现更新会在顶栏状态区提示。</div>
        </div>

        <div class="sp-sec">
          <div class="sp-label">数据备份（F-SYS-07）</div>
          <div class="sp-row">
            <NInput v-model:value="s.gitSyncDir" placeholder="本地备份目录，如 D:\sync\workbench" style="flex: 1" />
            <NButton size="small" type="primary" ghost :loading="syncing" @click="syncToGitDir">导出备份</NButton>
          </div>
          <div class="sp-dim" v-if="syncMsg" style="white-space: pre-line; color: #16a34a">{{ syncMsg }}</div>
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
          <div class="sp-dim">云端服务为可选能力：不注册、不登录，工作台所有功能照常本地使用。</div>
        </div>

        <template v-if="!s.cloudToken">
          <div class="sp-sec">
            <div class="sp-label">注册 / 登录云端账户</div>
            <div class="sp-row"><NInput v-model:value="cloudForm.server" placeholder="服务地址" style="flex: 1" /></div>
            <div class="sp-row"><NInput v-model:value="cloudForm.username" placeholder="用户名" style="flex: 1" /></div>
            <div class="sp-row"><NInput v-model:value="cloudForm.password" type="password" show-password-on="click" placeholder="密码（≥6位）" style="flex: 1" /></div>
            <div class="sp-row"><NInput v-model:value="cloudForm.device" placeholder="设备名称" style="flex: 1" /></div>
            <div class="sp-row">
              <NButton size="small" type="primary" :loading="cloudBusy" @click="doCloudRegister">注册并同步</NButton>
              <NButton size="small" :loading="cloudBusy" @click="doCloudLogin">登录</NButton>
            </div>
            <div class="sp-dim" v-if="cloudMsg" style="white-space: pre-line">{{ cloudMsg }}</div>
          </div>
        </template>

        <template v-else>
          <div class="sp-sec">
            <div class="sp-label">同步状态</div>
            <div class="sp-row"><span class="sp-dim" style="margin:0">状态：</span><NTag size="small" :type="syncStatus.state === 'error' ? 'error' : 'success'">{{ syncStateLabel }}</NTag>
              <span class="sp-dim" style="margin:0 0 0 10px" v-if="syncStatus.message">{{ syncStatus.message }}</span></div>
            <div class="sp-row"><span class="sp-dim" style="margin:0">设备：{{ s.deviceName || '（未命名）' }}</span></div>
            <div class="sp-row"><span class="sp-dim" style="margin:0">上次同步：{{ s.lastSyncAt ? new Date(s.lastSyncAt).toLocaleString() : '从未' }}</span>
              <span class="sp-dim" style="margin:0 0 0 10px">待推送：{{ syncStatus.pending }} 行</span></div>
            <div class="sp-row">
              <NButton size="small" type="primary" ghost :loading="syncStatus.state === 'syncing'" @click="doSyncNow">立即同步</NButton>
              <NButton size="small" quaternary type="warning" @click="doCloudLogout">退出登录</NButton>
            </div>
            <div class="sp-dim" v-if="cloudMsg" style="white-space: pre-line">{{ cloudMsg }}</div>
            <div class="sp-dim">改动会实时推送到云端并同步到你的其他设备；断网时本地照常使用，联网后自动补传。冲突按"最新修改优先"合并。</div>
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
.sp-dim { font-size: 12px; color: #999; margin-top: 4px; }
.sp-k { width: 110px; flex: none; margin-top: 0; }
</style>
