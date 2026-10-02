<script setup lang="ts">
import { ref, computed } from 'vue'
import {
  NModal, NInput, NSlider, NSwitch, NButton, NTag, NText, NList, NListItem, NThing,
} from 'naive-ui'
import { useSettings, type CustomCard } from '@/composables/useSettings'
import { modules } from '@/theme/tokens'
import { exportBackupTo, checkUpdate, gitRemoteInfo, gitInitRepo, gitCommitAll, gitGhUpload, llmStatus } from '@/composables/useTauri'
import {
  tasksRepo, deadlinesRepo, projectsRepo, snippetsRepo, habitsRepo, ledgerRepo,
  coursesRepo, assignmentsRepo, notesRepo, pitfallsRepo, serversRepo, domainsRepo,
  toolsRepo, agentsRepo,
} from '@/db'

const props = defineProps<{ show: boolean }>()
const emit = defineEmits<{ (e: 'update:show', v: boolean): void }>()

const s = useSettings()

const APP_VERSION = '0.1.0'
// workbench 项目自身目录（Git 版本管理 / 上传 GitHub 的根目录）
const WORKBENCH_DIR = 'E:\\CODEX\\workbench'

// ---- 升级检测（Rust 命令 check_update：支持 GitHub owner/repo 或自定义 JSON 端点） ----
const checking = ref(false)
const updateMsg = ref('')
async function checkUpdateNow() {
  updateMsg.value = ''
  checking.value = true
  try {
    const url = s.updateUrl.trim()
    if (!url) {
      updateMsg.value = '未配置更新检查地址（可填 GitHub 仓库 owner/repo，或返回 { "version": "x.y.z" } 的 JSON 地址）'
      return
    }
    const res = await checkUpdate(url, APP_VERSION)
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

// ---- LLM 服务开关（关闭后隐藏 AI 能力入口） ----
const llmMsg = ref('')
async function refreshLlmStatus() {
  llmMsg.value = ''
  try {
    const st = await llmStatus()
    llmMsg.value = st.configured ? `已配置：${st.provider}` : '未配置（未检测到 API Key 环境变量）'
  } catch {
    llmMsg.value = '探测失败（需 Tauri 环境）'
  }
}

// ---- Git 版本管理 / 上传 GitHub（Rust 命令 git_remote_info / git_init_repo / git_commit_all / git_gh_upload） ----
const ghPrivate = ref(false)
const ghBusy = ref(false)
const ghMsg = ref('')
async function gitOverview() {
  ghMsg.value = ''
  try {
    const info = await gitRemoteInfo(WORKBENCH_DIR)
    if (!info.is_repo) {
      ghMsg.value = 'workbench 项目尚未初始化 git 仓库，点击「初始化并上传 GitHub」一键完成'
      return
    }
    const parts = [`仓库：${info.branch || '(无分支)'}`]
    parts.push(`远端：${info.remote_url ?? '未配置'}`)
    parts.push(`未提交改动：${info.changed_files} 个文件`)
    ghMsg.value = parts.join('\n')
  } catch (e) {
    ghMsg.value = '状态读取失败：' + String(e)
  }
}
async function commitChanges() {
  ghMsg.value = ''
  ghBusy.value = true
  try {
    const msg = await gitCommitAll(WORKBENCH_DIR, 'chore: workbench 同步改动')
    ghMsg.value = msg
  } catch (e) {
    ghMsg.value = '提交失败：' + String(e)
  } finally {
    ghBusy.value = false
  }
}
async function initAndUpload() {
  ghMsg.value = ''
  ghBusy.value = true
  try {
    const info = await gitRemoteInfo(WORKBENCH_DIR)
    if (!info.is_repo) {
      await gitInitRepo(WORKBENCH_DIR)
      ghMsg.value = '已初始化 git 仓库\n'
    }
    const name = s.githubRepo.trim()
    if (!name) {
      ghMsg.value += '请填写 GitHub 仓库名后再上传'
      return
    }
    const repoName = name.includes('/') ? name.split('/').pop()! : name
    const out = await gitGhUpload(WORKBENCH_DIR, repoName, ghPrivate.value)
    ghMsg.value += out
    if (!s.updateUrl.trim() && name.includes('/')) {
      s.updateUrl = name
      ghMsg.value += '\n已将更新检查地址设置为该 GitHub 仓库，启动时将自动检测新版本'
    }
  } catch (e) {
    ghMsg.value = '上传失败：' + String(e)
  } finally {
    ghBusy.value = false
  }
}

// ---- Git 数据同步（F-SYS-07） ----
const syncing = ref(false)
const syncMsg = ref('')
async function syncToGitDir() {
  syncMsg.value = ''
  syncing.value = true
  try {
    const dir = s.gitSyncDir.trim()
    if (!dir) {
      syncMsg.value = '请先填写 Git 同步目录（私有仓库本地路径）'
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
    syncMsg.value = `已写入：${target}\n在 Git 仓库中执行 git add/commit/push 即可完成多机同步`
  } catch (e) {
    syncMsg.value = '同步失败：' + String(e)
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
</script>

<template>
  <NModal :show="props.show" @update:show="(v: boolean) => emit('update:show', v)" preset="card" style="width: 640px; max-width: 92vw">
    <div class="sp-title">系统设置</div>

    <!-- 无障碍：字号可调 + 减少动效（F-SYS-11） -->
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

    <!-- 板块显示开关（工作台升级：设置中可开关板块） -->
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

    <!-- LLM 服务开关（工作台升级） -->
    <div class="sp-sec">
      <div class="sp-label">LLM 服务</div>
      <div class="sp-row">
        <span>启用智能层 / LLM 能力</span>
        <NSwitch v-model:value="s.llmEnabled" />
        <NButton size="tiny" quaternary @click="refreshLlmStatus">探测状态</NButton>
      </div>
      <div class="sp-dim" v-if="llmMsg">{{ llmMsg }}</div>
      <div class="sp-dim">关闭后隐藏 AI 相关入口，仅保留本地数据能力。</div>
    </div>

    <!-- Git 版本管理 / 上传 GitHub（工作台升级） -->
    <div class="sp-sec">
      <div class="sp-label">Git 版本管理 · GitHub（项目：{{ WORKBENCH_DIR }}）</div>
      <div class="sp-row">
        <NInput v-model:value="s.githubRepo" placeholder="GitHub 仓库名，如 user/workbench（可留空）" style="flex: 1" />
        <span class="sp-dim">私有</span>
        <NSwitch v-model:value="ghPrivate" size="small" />
      </div>
      <div class="sp-row">
        <NButton size="small" type="primary" ghost :loading="ghBusy" @click="initAndUpload">初始化并上传 GitHub</NButton>
        <NButton size="small" ghost :loading="ghBusy" @click="commitChanges">提交改动</NButton>
        <NButton size="small" quaternary @click="gitOverview">查看状态</NButton>
      </div>
      <div class="sp-dim" v-if="ghMsg" style="white-space: pre-line; color: #16a34a">{{ ghMsg }}</div>
      <div class="sp-dim">上传后自动配置更新检查地址（owner/repo 形式），启动时检测 GitHub Releases 新版本。</div>
    </div>

    <!-- 快捷键自定义（F-SYS-02 扩展） -->
    <div class="sp-sec">
      <div class="sp-label">快捷键自定义（F-SYS-02）</div>
      <div class="sp-row"><span>Ctrl+1..7 模块切换</span><NSwitch v-model:value="s.keymap.ctrlNum" /></div>
      <div class="sp-row"><span>g 序列跳转（g d / g l / g s / g o / g k / g w / g h）</span><NSwitch v-model:value="s.keymap.gSeq" /></div>
      <div class="sp-row"><span>Ctrl+Shift+D 主题切换</span><NSwitch v-model:value="s.keymap.theme" /></div>
      <div class="sp-row"><span>n 快速新建（编辑区外）</span><NSwitch v-model:value="s.keymap.newShortcut" /></div>
      <div class="sp-dim">关闭某项可避免与系统或应用快捷键冲突；Ctrl+K 命令面板固定保留。</div>
    </div>

    <!-- Git 数据同步（F-SYS-07） -->
    <div class="sp-sec">
      <div class="sp-label">Git 数据同步（F-SYS-07）</div>
      <div class="sp-row">
        <NInput v-model:value="s.gitSyncDir" placeholder="私有仓库本地目录，如 D:\sync\workbench" style="flex: 1" />
        <NButton size="small" type="primary" ghost :loading="syncing" @click="syncToGitDir">导出并同步</NButton>
      </div>
      <div class="sp-dim" v-if="syncMsg" style="white-space: pre-line; color: #16a34a">{{ syncMsg }}</div>
    </div>

    <!-- 升级检测 -->
    <div class="sp-sec">
      <div class="sp-label">升级检测 · 当前 v{{ APP_VERSION }}</div>
      <div class="sp-row">
        <NInput v-model:value="s.updateUrl" placeholder="GitHub 仓库 owner/repo，或返回 { version } 的 JSON 地址" style="flex: 1" />
        <NButton size="small" type="primary" ghost :loading="checking" @click="checkUpdateNow">检查更新</NButton>
      </div>
      <div class="sp-row">
        <span>启动时自动检查更新</span>
        <NSwitch v-model:value="s.autoCheckUpdate" size="small" />
      </div>
      <div class="sp-dim" v-if="updateMsg" style="white-space: pre-line">{{ updateMsg }}</div>
    </div>

    <!-- 自定义卡片（F-SYS-06） -->
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

    <template #footer>
      <NButton type="primary" size="small" @click="emit('update:show', false)">完成</NButton>
    </template>
  </NModal>
</template>

<style scoped>
.sp-title { font-size: 16px; font-weight: 650; margin-bottom: 12px; }
.sp-sec { margin-bottom: 18px; }
.sp-label { font-size: 13px; font-weight: 600; margin-bottom: 8px; }
.sp-row { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; font-size: 13px; }
.sp-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 0 16px; }
.sp-dim { font-size: 12px; color: #999; margin-top: 4px; }
</style>
