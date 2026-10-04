<script setup lang="ts">
import { watch, ref, onMounted, computed } from 'vue'
import { refreshTick } from '@/stores/ui'
import { NButton, NTag, NInput, NTabs, NTabPane, NIcon, useMessage, NEmpty, NDropdown, NModal } from 'naive-ui'
import { Plus, Trash, Edit, Check, Book2, Code, Refresh } from '@vicons/tabler'
import EmptyState from '@/components/EmptyState.vue'
import ModalForm, { type FieldDef } from '@/components/ModalForm.vue'
import { projectsRepo, tasksRepo, snippetsRepo, deploymentsRepo, envVarsRepo, techDebtsRepo, cmdSnippetsRepo } from '@/db'
import type { Project, Task, Snippet, Deployment, EnvVar, TechDebt, CmdSnippet } from '../../drizzle/schema'
import { scanProjects, gitStatus, openPath, gitLog, codeStats, envList, repoHealth, depsCheck, type ProjectInfo, type GitStatus, type GitCommitInfo, type LangStat, type RepoHealth, type DepCheckItem } from '@/composables/useTauri'
import { useConfirm } from '@/composables/useConfirm'

const message = useMessage()
const { confirm } = useConfirm()
const tab = ref('board')

const projects = ref<Project[]>([])
const tasks = ref<Task[]>([])
const snippets = ref<Snippet[]>([])
const deployments = ref<Deployment[]>([])
const envVars = ref<EnvVar[]>([])
const techDebts = ref<TechDebt[]>([])
const cmdSnippets = ref<CmdSnippet[]>([])
const activeSnippet = ref<Snippet | null>(null)

// ---- 能力层：项目雷达 / Git 清洁度（F-DEV-02/03） ----
const radarRoot = ref('E:\\CODEX')
const radarProjects = ref<ProjectInfo[]>([])
const radarLoading = ref(false)
const gitRepoPath = ref('E:\\CODEX\\workbench')
const gitInfo = ref<GitStatus | null>(null)
const gitLoading = ref(false)

async function runRadar() {
  radarLoading.value = true
  try {
    radarProjects.value = await scanProjects(radarRoot.value)
  } catch {
    radarProjects.value = []
    message.warning('项目扫描仅 Tauri 环境可用')
  } finally {
    radarLoading.value = false
  }
}

async function runGitCheck() {
  gitLoading.value = true
  gitInfo.value = null
  try {
    gitInfo.value = await gitStatus(gitRepoPath.value)
  } catch {
    message.warning('Git 检测仅 Tauri 环境可用')
  } finally {
    gitLoading.value = false
  }
}

const fmtMTime = (ts: number) => {
  if (!ts) return '—'
  const d = new Date(ts * 1000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const projectFormShow = ref(false)
const taskFormShow = ref(false)
const snippetFormShow = ref(false)
const deployFormShow = ref(false)
const envFormShow = ref(false)
const debtFormShow = ref(false)
const cmdFormShow = ref(false)

async function load() {
  try {
    const [ps, ts, ss, ds, ev, td, cs] = await Promise.all([
      projectsRepo.listAll(), tasksRepo.listAll(), snippetsRepo.listAll(),
      deploymentsRepo.listAll(), envVarsRepo.listAll(), techDebtsRepo.listAll(), cmdSnippetsRepo.listAll(),
    ])
    projects.value = ps
    tasks.value = ts
    snippets.value = ss
    deployments.value = ds
    envVars.value = ev
    techDebts.value = td
    cmdSnippets.value = cs
    if (activeSnippet.value) {
      const cur = snippets.value.find((s) => s.id === activeSnippet.value!.id)
      activeSnippet.value = cur ?? null
    }
  } catch (e) {
    message.warning('数据加载失败（浏览器降级为演示模式）')
    console.warn(e)
  }
}
watch(refreshTick, () => load())
onMounted(load)

// ---- F-DEV-07 片段变量占位符：识别 {{var}} 并提示 ----
const snippetVars = computed(() => {
  const code = activeSnippet.value?.code || ''
  const vars = [...code.matchAll(/\{\{\s*([a-zA-Z0-9_\u4e00-\u9fa5]+)\s*\}\}/g)].map((m) => m[1])
  return [...new Set(vars)]
})
function copySnippetCode() {
  if (!activeSnippet.value) return
  navigator.clipboard.writeText(activeSnippet.value.code || '').then(() => {
    if (snippetVars.value.length) message.success(`已复制（含 ${snippetVars.value.length} 个变量占位符：${snippetVars.value.join('、')}）`)
    else message.success('已复制片段')
  })
}

// ---- F-DEV-14 项目活跃度：按 updatedAt 距今天数分级 ----
const activityOf = (p: { updatedAt?: string | null; createdAt?: string | null }): { label: string; type: 'success' | 'info' | 'warning' | 'default' } => {
  const t = p.updatedAt || p.createdAt
  if (!t) return { label: '未知', type: 'default' }
  const days = Math.floor((Date.now() - new Date(t).getTime()) / 86400000)
  if (days <= 3) return { label: '活跃', type: 'success' }
  if (days <= 14) return { label: '一般', type: 'info' }
  if (days <= 45) return { label: '沉寂', type: 'warning' }
  return { label: '休眠', type: 'default' }
}
const activityFromTs = (ts: number): { label: string; type: 'success' | 'info' | 'warning' | 'default' } => {
  if (!ts) return { label: '未知', type: 'default' }
  const days = Math.floor((Date.now() - ts * 1000) / 86400000)
  if (days <= 3) return { label: '活跃', type: 'success' }
  if (days <= 14) return { label: '一般', type: 'info' }
  if (days <= 45) return { label: '沉寂', type: 'warning' }
  return { label: '休眠', type: 'default' }
}

// ---- F-DEV-17 估时校准：由已完成任务的 createdAt→updatedAt 推断参考周期 ----
const estCalib = computed(() => {
  const done = tasks.value.filter((t) => t.status === 'done' && t.createdAt && t.updatedAt)
  if (!done.length) return null
  const hours = done.map((t) => Math.max(0.1, (new Date(t.updatedAt!).getTime() - new Date(t.createdAt!).getTime()) / 3600000))
  const avg = hours.reduce((s, h) => s + h, 0) / hours.length
  return { count: done.length, avgHours: avg }
})

// ---- 项目看板 ----
const projectFields: FieldDef[] = [
  { key: 'name', label: '项目名称', required: true },
  { key: 'status', label: '状态', type: 'select', options: [
    { label: '进行中', value: 'active' }, { label: '暂停', value: 'paused' }, { label: '已归档', value: 'archived' },
  ] },
  { key: 'description', label: '描述', type: 'textarea', span: 2 },
  { key: 'techStack', label: '技术栈' },
  { key: 'repoPath', label: '仓库路径' },
]

async function addProject(v: Record<string, unknown>) {
  try {
    await projectsRepo.insert({
      name: String(v.name), status: String(v.status || 'active'),
      description: String(v.description || ''), techStack: String(v.techStack || ''),
      repoPath: String(v.repoPath || ''),
    })
    message.success('项目已创建')
    load()
  } catch { message.error('创建失败（请通过 npm run tauri dev 启动）') }
}

async function setProjectStatus(p: Project, status: string) {
  try {
    await projectsRepo.update(p.id, { status })
    p.status = status as Project['status']
  } catch { message.error('更新失败') }
}

const boardColumns = computed(() => [
  { key: 'todo', label: '待办', items: tasks.value.filter((t) => t.status === 'todo') },
  { key: 'doing', label: '进行中', items: tasks.value.filter((t) => t.status === 'doing') },
  { key: 'done', label: '已完成', items: tasks.value.filter((t) => t.status === 'done') },
])

async function moveTask(t: Task, status: string) {
  try {
    await tasksRepo.update(t.id, { status })
    t.status = status as Task['status']
  } catch { message.error('移动失败') }
}

const taskScopeColor = (s: string): 'info' | 'success' | 'warning' | 'default' =>
  s === 'study' ? 'info' : s === 'life' ? 'warning' : 'success'
const taskPriorityColor = (p: string): 'error' | 'warning' | 'default' | 'info' =>
  p === 'urgent' ? 'error' : p === 'high' ? 'warning' : p === 'low' ? 'default' : 'info'

// ---- 任务 ----
const taskFields: FieldDef[] = [
  { key: 'title', label: '标题', required: true, span: 2 },
  { key: 'scope', label: '领域', type: 'select', options: [
    { label: '开发', value: 'dev' }, { label: '生活', value: 'life' }, { label: '学习', value: 'study' },
  ] },
  { key: 'type', label: '类型', type: 'select', options: [
    { label: '任务', value: 'task' }, { label: 'Bug', value: 'bug' }, { label: '功能', value: 'feature' },
    { label: '杂务', value: 'chore' }, { label: '学习', value: 'study' }, { label: '生活', value: 'life' },
  ] },
  { key: 'priority', label: '优先级', type: 'select', options: [
    { label: '低', value: 'low' }, { label: '中', value: 'medium' }, { label: '高', value: 'high' }, { label: '紧急', value: 'urgent' },
  ] },
  { key: 'projectId', label: '项目 ID', type: 'number' },
  { key: 'dueDate', label: '截止日期', type: 'date', span: 2 },
  { key: 'focusDate', label: '今日焦点标记 (yyyy-MM-dd)', type: 'date', span: 2 },
  { key: 'note', label: '备注', type: 'textarea', span: 2 },
]

async function addTask(v: Record<string, unknown>) {
  try {
    await tasksRepo.insert({
      title: String(v.title), scope: String(v.scope || 'dev'), type: String(v.type || 'task'),
      priority: String(v.priority || 'medium'),
      projectId: v.projectId ? Number(v.projectId) : undefined,
      dueDate: v.dueDate ? String(v.dueDate) : undefined,
      focusDate: v.focusDate ? String(v.focusDate) : undefined,
      note: String(v.note || ''),
    })
    message.success('任务已创建')
    load()
  } catch { message.error('创建失败（请通过 npm run tauri dev 启动）') }
}

async function removeTask(t: Task) {
  const ok = await confirm({ title: '删除任务？', content: `「${t.title}」删除后无法恢复。` })
  if (!ok) return
  try {
    await tasksRepo.remove(t.id)
    message.success('已删除')
    load()
  } catch { message.error('删除失败') }
}

async function toggleFocus(t: Task) {
  const today = new Date()
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const newFocus = t.focusDate ? null : todayStr
  try {
    await tasksRepo.update(t.id, { focusDate: newFocus })
    t.focusDate = newFocus
  } catch { message.error('更新失败') }
}

// ---- 片段 ----
const snippetFields: FieldDef[] = [
  { key: 'title', label: '标题', required: true, span: 2 },
  { key: 'language', label: '语言' },
  { key: 'tags', label: '标签 (逗号分隔)', span: 2 },
  { key: 'code', label: '代码', type: 'textarea', span: 2, placeholder: '粘贴代码…' },
  { key: 'description', label: '说明', type: 'textarea', span: 2 },
]

async function addSnippet(v: Record<string, unknown>) {
  try {
    const id = await snippetsRepo.insert({
      title: String(v.title), language: String(v.language || 'text'),
      code: String(v.code || ''), tags: String(v.tags || ''), description: String(v.description || ''),
    })
    message.success('片段已保存')
    load()
    const all = await snippetsRepo.listAll()
    activeSnippet.value = all.find((s) => s.id === id) ?? null
  } catch { message.error('保存失败（请通过 npm run tauri dev 启动）') }
}

async function removeSnippet(s: Snippet) {
  const ok = await confirm({ title: '删除代码片段？', content: `「${s.title}」（${s.language}）删除后无法恢复。` })
  if (!ok) return
  try {
    await snippetsRepo.remove(s.id)
    if (activeSnippet.value?.id === s.id) activeSnippet.value = null
    message.success('已删除')
    load()
  } catch { message.error('删除失败') }
}

const LANG_COLORS = {
  ts: 'info', typescript: 'info', js: 'warning', javascript: 'warning', py: 'success', python: 'success',
  rust: 'error', rs: 'error', sql: 'default', vue: 'success', css: 'info',
} as const
const langColor = (l: string): 'info' | 'warning' | 'success' | 'error' | 'default' =>
  LANG_COLORS[l.toLowerCase() as keyof typeof LANG_COLORS] ?? 'default'

// ---- F-DEV-04 一键打开项目 ----
async function openProjectPath(p: { repoPath?: string | null; name: string }) {
  const target = p.repoPath || radarProjects.value.find((r) => r.name === p.name)?.path
  if (!target) { message.warning('该项目未配置仓库路径'); return }
  try {
    const r = await openPath(target)
    message.success(r)
  } catch (e) {
    message.error(String(e))
  }
}

// ---- F-DEV-09 部署台账 ----
const deployFields: FieldDef[] = [
  { key: 'project', label: '项目', required: true },
  { key: 'env', label: '环境', type: 'select', options: [
    { label: '生产', value: 'prod' }, { label: '预发', value: 'staging' }, { label: '开发', value: 'dev' },
  ] },
  { key: 'version', label: '版本' },
  { key: 'status', label: '状态', type: 'select', options: [
    { label: '成功', value: 'success' }, { label: '失败', value: 'failed' }, { label: '回滚', value: 'rollback' }, { label: '进行中', value: 'pending' },
  ] },
  { key: 'deployedAt', label: '部署时间', type: 'date' },
  { key: 'operator', label: '操作人' },
  { key: 'note', label: '备注', type: 'textarea', span: 2 },
]
async function addDeploy(v: Record<string, unknown>) {
  try {
    await deploymentsRepo.insert({
      project: String(v.project), env: String(v.env || 'prod'), version: String(v.version || ''),
      status: String(v.status || 'success'), operator: String(v.operator || ''),
      deployedAt: v.deployedAt ? String(v.deployedAt) : undefined, note: String(v.note || ''),
    })
    message.success('已记录部署')
    load()
  } catch { message.error('添加失败（请通过 npm run tauri dev 启动）') }
}
async function removeDeploy(d: Deployment) {
  const ok = await confirm({ title: '删除部署记录？', content: `「${d.project}」${d.env}，版本 ${d.version || '未填写'}。` })
  if (!ok) return
  try { await deploymentsRepo.remove(d.id); message.success('已删除'); load() } catch { message.error('删除失败') }
}
const deployStatus = (d: Deployment) => ({
  color: (d.status === 'success' ? 'success' : d.status === 'failed' ? 'error' : d.status === 'rollback' ? 'warning' : 'info') as 'success' | 'error' | 'warning' | 'info',
  label: d.status === 'success' ? '成功' : d.status === 'failed' ? '失败' : d.status === 'rollback' ? '回滚' : '进行中',
})

// ---- F-DEV-11 环境变量清单 ----
const envFields: FieldDef[] = [
  { key: 'key', label: '变量名', required: true },
  { key: 'value', label: '值' },
  { key: 'scope', label: '范围', type: 'select', options: [
    { label: '用户', value: 'user' }, { label: '系统', value: 'system' }, { label: '项目', value: 'project' },
  ] },
  { key: 'note', label: '备注', type: 'textarea', span: 2 },
]
async function addEnv(v: Record<string, unknown>) {
  try {
    await envVarsRepo.insert({
      key: String(v.key), value: String(v.value || ''), scope: String(v.scope || 'user'), note: String(v.note || ''),
    })
    message.success('已记录环境变量')
    load()
  } catch { message.error('添加失败（请通过 npm run tauri dev 启动）') }
}
async function removeEnv(e: EnvVar) {
  const ok = await confirm({ title: '删除环境变量？', content: `「${e.key}」删除后无法恢复。` })
  if (!ok) return
  try { await envVarsRepo.remove(e.id); message.success('已删除'); load() } catch { message.error('删除失败') }
}
const sysEnvVars = ref<Array<[string, string]>>([])
async function loadSysEnv() {
  try {
    sysEnvVars.value = await envList()
  } catch { message.warning('系统环境变量读取仅 Tauri 环境可用') }
}

// ---- F-DEV-12 技术债/已知坑 ----
const debtFields: FieldDef[] = [
  { key: 'title', label: '标题', required: true, span: 2 },
  { key: 'category', label: '分类', type: 'select', options: [
    { label: '技术债', value: 'tech' }, { label: '已知问题', value: 'knownIssue' }, { label: '遗留代码', value: 'legacy' }, { label: 'TODO', value: 'TODO' },
  ] },
  { key: 'severity', label: '严重级别', type: 'select', options: [
    { label: '低', value: 'low' }, { label: '中', value: 'medium' }, { label: '高', value: 'high' }, { label: '严重', value: 'critical' },
  ] },
  { key: 'project', label: '所属项目' },
  { key: 'status', label: '状态', type: 'select', options: [
    { label: '待处理', value: 'open' }, { label: '已计划', value: 'planned' }, { label: '已解决', value: 'done' },
  ] },
  { key: 'detail', label: '详情', type: 'textarea', span: 2 },
]
async function addDebt(v: Record<string, unknown>) {
  try {
    await techDebtsRepo.insert({
      title: String(v.title), category: String(v.category || 'tech'), severity: String(v.severity || 'medium'),
      project: String(v.project || ''), status: String(v.status || 'open'), detail: String(v.detail || ''),
    })
    message.success('已记录技术债')
    load()
  } catch { message.error('添加失败（请通过 npm run tauri dev 启动）') }
}
async function removeDebt(d: TechDebt) {
  const ok = await confirm({ title: '删除技术债？', content: `「${d.title}」删除后无法恢复。` })
  if (!ok) return
  try { await techDebtsRepo.remove(d.id); message.success('已删除'); load() } catch { message.error('删除失败') }
}
const debtSeverity = (d: TechDebt) => ({
  color: (d.severity === 'critical' ? 'error' : d.severity === 'high' ? 'error' : d.severity === 'medium' ? 'warning' : 'default') as 'error' | 'warning' | 'default',
  label: d.severity === 'critical' ? '严重' : d.severity === 'high' ? '高' : d.severity === 'medium' ? '中' : '低',
})

// ---- F-DEV-13 命令片段速查 ----
const cmdFields: FieldDef[] = [
  { key: 'title', label: '标题', required: true },
  { key: 'category', label: '分类', type: 'select', options: [
    { label: 'Shell', value: 'shell' }, { label: 'Git', value: 'git' }, { label: 'Docker', value: 'docker' },
    { label: '数据库', value: 'db' }, { label: '部署', value: 'deploy' }, { label: '其他', value: 'other' },
  ] },
  { key: 'command', label: '命令', type: 'textarea', span: 2, required: true },
  { key: 'note', label: '说明', type: 'textarea', span: 2 },
]
async function addCmd(v: Record<string, unknown>) {
  try {
    await cmdSnippetsRepo.insert({
      title: String(v.title), category: String(v.category || 'shell'),
      command: String(v.command || ''), note: String(v.note || ''),
    })
    message.success('命令片段已保存')
    load()
  } catch { message.error('保存失败（请通过 npm run tauri dev 启动）') }
}
async function removeCmd(c: CmdSnippet) {
  const ok = await confirm({ title: '删除命令片段？', content: `「${c.title}」删除后无法恢复。` })
  if (!ok) return
  try { await cmdSnippetsRepo.remove(c.id); message.success('已删除'); load() } catch { message.error('删除失败') }
}
async function bumpCmd(c: CmdSnippet) {
  try {
    await cmdSnippetsRepo.update(c.id, { hitCount: (c.hitCount || 0) + 1 })
    c.hitCount = (c.hitCount || 0) + 1
  } catch { /* 忽略统计失败 */ }
}
async function copyCmd(c: CmdSnippet) {
  await bumpCmd(c)
  try {
    await navigator.clipboard.writeText(c.command)
    message.success('已复制命令')
  } catch { message.error('复制失败') }
}

// ---- F-DEV-15 仓库体检 + F-DEV-17 Git 历史 ----
const repoHealthInfo = ref<RepoHealth | null>(null)
const gitHistory = ref<GitCommitInfo[]>([])
const codeStatList = ref<LangStat[]>([])
const healthRepoPath = ref('E:\\CODEX\\workbench')
const healthLoading = ref(false)

async function runRepoHealth() {
  healthLoading.value = true
  repoHealthInfo.value = null
  gitHistory.value = []
  codeStatList.value = []
  try {
    const [h, logs, stats] = await Promise.all([
      repoHealth(healthRepoPath.value),
      gitLog(healthRepoPath.value, 40),
      codeStats(healthRepoPath.value),
    ])
    repoHealthInfo.value = h
    gitHistory.value = logs
    codeStatList.value = stats
  } catch (e) {
    message.warning(String(e))
  } finally {
    healthLoading.value = false
  }
}

// ---- F-DEV-16 依赖检查 ----
const depsList = ref<DepCheckItem[]>([])
const depsLoading = ref(false)
async function runDepsCheck() {
  if (!healthRepoPath.value) return
  depsLoading.value = true
  try {
    depsList.value = await depsCheck(healthRepoPath.value)
  } catch (e) {
    message.warning(String(e))
  } finally {
    depsLoading.value = false
  }
}

const healthScore = computed(() => {
  const h = repoHealthInfo.value
  if (!h) return { score: 0, items: [] as Array<{ label: string; ok: boolean }> }
  const items = [
    { label: 'Git 仓库', ok: h.has_git },
    { label: '工作区清洁', ok: h.dirty_files === 0 },
    { label: '与远端同步', ok: h.behind === 0 },
    { label: '近 30 天有提交', ok: h.last_commit_at >= new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10) || (h.last_commit_at ? true : false) },
    { label: '有 README', ok: h.has_readme },
    { label: '有 CI', ok: h.has_ci },
  ]
  const score = Math.round((items.filter((i) => i.ok).length / items.length) * 100)
  return { score, items }
})

</script>

<template>
  <div>

    <n-tabs v-model:value="tab" type="line" class="wb-tabs">
      <!-- 项目看板 -->
      <n-tab-pane name="board" tab="项目看板">
        <div class="board-toolbar">
          <NButton size="small" type="primary" ghost @click="projectFormShow = true">
            <template #icon><NIcon :component="Plus" /></template>
            新建项目
          </NButton>
        </div>
        <div v-if="projects.length || tasks.length" class="board">
          <section v-for="col in boardColumns" :key="col.key" class="board-col">
            <header class="col-head">
              <span>{{ col.label }}</span>
              <span class="mono count">{{ col.items.length }}</span>
            </header>
            <div class="col-body">
              <div v-for="t in col.items" :key="t.id" class="task-card wb-card hoverable">
                <div class="task-top">
                  <span class="task-title">{{ t.title }}</span>
                  <NTag size="tiny" :bordered="false" :color="{ color: 'transparent', textColor: 'var(--wb-module-dev)' }">{{ t.type }}</NTag>
                </div>
                <div class="task-meta">
                  <NTag size="tiny" :bordered="false" :type="taskScopeColor(t.scope)">{{ t.scope }}</NTag>
                  <NTag size="tiny" :bordered="false" :type="taskPriorityColor(t.priority)">{{ t.priority }}</NTag>
                  <span v-if="t.dueDate" class="mono due">{{ t.dueDate }}</span>
                </div>
                <div class="task-ops">
                  <NButton size="tiny" text @click="moveTask(t, col.key === 'todo' ? 'doing' : col.key === 'doing' ? 'done' : 'todo')">
                    {{ col.key === 'doing' ? '完成 →' : col.key === 'todo' ? '开始 →' : '← 重开' }}
                  </NButton>
                  <NButton size="tiny" text :type="t.focusDate ? 'warning' : 'default'" @click="toggleFocus(t)">
                    {{ t.focusDate ? '★ 焦点' : '☆ 焦点' }}
                  </NButton>
                  <NButton size="tiny" text type="error" @click="removeTask(t)">删除</NButton>
                </div>
              </div>
            </div>
          </section>
        </div>
        <EmptyState v-else text="暂无项目与任务，先新建一个项目或任务" />
      </n-tab-pane>

      <!-- 任务列表 -->
      <n-tab-pane name="tasks" tab="任务列表">
        <div class="board-toolbar">
          <NButton size="small" type="primary" ghost @click="taskFormShow = true">
            <template #icon><NIcon :component="Plus" /></template>
            新建任务
          </NButton>
        </div>
        <div v-if="estCalib" class="est-calib wb-card">
          <span class="dim" style="font-size: 12px">估时校准：近 {{ estCalib.count }} 个已完成任务平均周期约 {{ estCalib.avgHours.toFixed(1) }} 小时/个（按 createdAt→updatedAt 推算）</span>
        </div>
        <div v-if="tasks.length" class="task-table">
          <div class="task-row head">
            <span>标题</span><span>领域</span><span>优先级</span><span>截止</span><span>状态</span><span>操作</span>
          </div>
          <div v-for="t in tasks" :key="t.id" class="task-row">
            <span class="tt">
              <span v-if="t.focusDate" class="focus-star">★</span>
              {{ t.title }}
              <span v-if="t.type !== 'task'" class="mono sub">{{ t.type }}</span>
            </span>
            <span><NTag size="tiny" :bordered="false" :type="taskScopeColor(t.scope)">{{ t.scope }}</NTag></span>
            <span><NTag size="tiny" :bordered="false" :type="taskPriorityColor(t.priority)">{{ t.priority }}</NTag></span>
            <span class="mono">{{ t.dueDate || '—' }}</span>
            <span>
              <n-dropdown trigger="click" :options="[
                { label: '待办', key: 'todo' }, { label: '进行中', key: 'doing' }, { label: '已完成', key: 'done' },
              ]" @select="(k: string) => moveTask(t, k)">
                <NTag size="tiny" :bordered="false" :type="t.status === 'done' ? 'success' : t.status === 'doing' ? 'info' : 'default'" style="cursor: pointer">
                  {{ t.status }}
                </NTag>
              </n-dropdown>
            </span>
            <span class="row-ops">
              <NButton size="tiny" text @click="toggleFocus(t)" :type="t.focusDate ? 'warning' : 'default'">{{ t.focusDate ? '★' : '☆' }}</NButton>
              <NButton size="tiny" text type="error" @click="removeTask(t)"><template #icon><NIcon :component="Trash" /></template></NButton>
            </span>
          </div>
        </div>
        <EmptyState v-else text="暂无任务" />
      </n-tab-pane>

      <!-- 代码片段 -->
      <n-tab-pane name="snippets" tab="代码片段">
        <div class="board-toolbar">
          <NButton size="small" type="primary" ghost @click="snippetFormShow = true">
            <template #icon><NIcon :component="Plus" /></template>
            新建片段
          </NButton>
        </div>
        <div v-if="snippets.length" class="snippet-grid">
          <div v-for="s in snippets" :key="s.id" class="snippet-card wb-card hoverable" @click="activeSnippet = s">
            <div class="snippet-head">
              <span class="snippet-title"><NIcon :component="Code" style="margin-right: 6px" />{{ s.title }}</span>
              <NTag size="tiny" :bordered="false" :type="langColor(s.language)">{{ s.language }}</NTag>
            </div>
            <pre class="snippet-preview mono">{{ (s.code || '').slice(0, 200) }}</pre>
            <div v-if="s.tags" class="snippet-tags mono">{{ s.tags }}</div>
          </div>
        </div>
        <EmptyState v-else text="暂无片段" />
        <div v-if="activeSnippet" class="snippet-detail wb-card" style="margin-top: 12px">
          <div class="snippet-head">
            <span class="snippet-title"><NIcon :component="Code" style="margin-right: 6px" />{{ activeSnippet.title }}</span>
            <NButton size="tiny" type="primary" ghost @click="copySnippetCode()">复制片段</NButton>
          </div>
          <pre class="snippet-preview mono">{{ activeSnippet.code }}</pre>
          <div v-if="snippetVars.length" class="snippet-vars mono">
            <NTag size="tiny" :bordered="false" type="warning">变量占位符</NTag>
            <span v-for="v in snippetVars" :key="v" class="var-chip">{{ '{' + '{' + v + '}' + '}' }}</span>
          </div>
          <div v-else class="dim" style="font-size: 12px">无变量占位符</div>
        </div>
      </n-tab-pane>

      <!-- 项目雷达 -->
      <n-tab-pane name="radar" tab="项目雷达">
        <div class="board-toolbar">
          <NInput v-model:value="radarRoot" size="small" placeholder="扫描根目录…" clearable style="width: 260px; margin-right: 8px" />
          <NButton size="small" type="primary" ghost :loading="radarLoading" @click="runRadar()">
            <template #icon><NIcon :component="Refresh" /></template>
            扫描
          </NButton>
        </div>
        <div v-if="radarProjects.length" class="radar-grid">
          <div v-for="p in radarProjects" :key="p.path" class="radar-card wb-card">
            <div class="rc-head">
              <span class="rc-name">{{ p.name }}</span>
              <NTag v-if="p.has_git" size="tiny" :bordered="false" type="success">git</NTag>
              <NTag v-else size="tiny" :bordered="false" type="default">无 git</NTag>
            </div>
            <div class="rc-path mono">{{ p.path }}</div>
            <div v-if="p.techs.length" class="rc-techs">
              <NTag v-for="t in p.techs.slice(0, 5)" :key="t" size="tiny" :bordered="false" type="info">{{ t }}</NTag>
            </div>
            <div class="rc-foot mono">更新 {{ fmtMTime(p.last_modified) }}</div>
            <div class="rc-ops">
              <NButton size="tiny" text @click="openProjectPath(p)">打开</NButton>
            </div>
          </div>
        </div>
        <EmptyState v-else :text="radarLoading ? '扫描中…' : '暂无扫描结果（仅 Tauri 环境可用）'" />
      </n-tab-pane>

      <!-- Git 清洁度 -->
      <n-tab-pane name="git" tab="Git 清洁度">
        <div class="board-toolbar">
          <NInput v-model:value="gitRepoPath" size="small" placeholder="仓库路径…" clearable style="width: 320px; margin-right: 8px" />
          <NButton size="small" type="primary" ghost :loading="gitLoading" @click="runGitCheck()">
            <template #icon><NIcon :component="Refresh" /></template>
            检测
          </NButton>
        </div>
        <div v-if="gitInfo" class="git-card wb-card">
          <div class="git-head">
            <span class="git-repo mono">{{ gitInfo.repo }}</span>
            <NTag size="small" :bordered="false" :type="gitInfo.clean ? 'success' : 'warning'">
              {{ gitInfo.clean ? '清洁' : '有改动' }}
            </NTag>
          </div>
          <div class="git-metrics">
            <div class="gm-item"><span class="gm-label">分支</span><span class="mono gm-value">{{ gitInfo.branch }}</span></div>
            <div class="gm-item"><span class="gm-label">变更文件</span><span class="mono gm-value">{{ gitInfo.changed_files }}</span></div>
            <div class="gm-item"><span class="gm-label">未推送</span><span class="mono gm-value">{{ gitInfo.ahead }}</span></div>
            <div class="gm-item"><span class="gm-label">落后</span><span class="mono gm-value">{{ gitInfo.behind }}</span></div>
            <div class="gm-item"><span class="gm-label">Stash</span><span class="mono gm-value">{{ gitInfo.stash_count }}</span></div>
          </div>
        </div>
        <EmptyState v-else :text="gitLoading ? '检测中…' : '输入仓库路径后检测（仅 Tauri 环境可用）'" />
      </n-tab-pane>

      <!-- 部署台账 F-DEV-09 -->
      <n-tab-pane name="deploys" tab="部署台账">
        <div class="board-toolbar">
          <NButton size="small" type="primary" ghost @click="deployFormShow = true">
            <template #icon><NIcon :component="Plus" /></template>
            记录部署
          </NButton>
        </div>
        <div v-if="deployments.length" class="task-table">
          <div class="task-row head">
            <span>项目</span><span>环境</span><span>版本</span><span>状态</span><span>时间</span><span>操作人</span><span>操作</span>
          </div>
          <div v-for="d in deployments" :key="d.id" class="task-row">
            <span class="tt">{{ d.project }}</span>
            <span><NTag size="tiny" :bordered="false" type="info">{{ d.env }}</NTag></span>
            <span class="mono">{{ d.version || '—' }}</span>
            <span><NTag size="tiny" :bordered="false" :type="deployStatus(d).color">{{ deployStatus(d).label }}</NTag></span>
            <span class="mono">{{ d.deployedAt || '—' }}</span>
            <span>{{ d.operator || '—' }}</span>
            <span class="row-ops">
              <NButton size="tiny" text type="error" @click="removeDeploy(d)"><template #icon><NIcon :component="Trash" /></template></NButton>
            </span>
          </div>
        </div>
        <EmptyState v-else text="暂无部署记录" />
      </n-tab-pane>

      <!-- 环境变量 F-DEV-11 -->
      <n-tab-pane name="envs" tab="环境变量">
        <div class="board-toolbar">
          <NButton size="small" ghost :loading="false" @click="loadSysEnv()">
            <template #icon><NIcon :component="Refresh" /></template>
            读取系统变量
          </NButton>
          <NButton size="small" type="primary" ghost style="margin-left: 8px" @click="envFormShow = true">
            <template #icon><NIcon :component="Plus" /></template>
            登记变量
          </NButton>
        </div>
        <div v-if="envVars.length || sysEnvVars.length" class="task-table">
          <div class="task-row head">
            <span>变量名</span><span>值</span><span>范围</span><span>操作</span>
          </div>
          <div v-for="e in envVars" :key="e.id" class="task-row">
            <span class="tt mono">{{ e.key }}</span>
            <span class="tt mono dim">{{ e.value || '—' }}</span>
            <span><NTag size="tiny" :bordered="false" type="default">{{ e.scope }}</NTag></span>
            <span class="row-ops">
              <NButton size="tiny" text type="error" @click="removeEnv(e)"><template #icon><NIcon :component="Trash" /></template></NButton>
            </span>
          </div>
          <div v-for="([k, v], i) in sysEnvVars" :key="'sys-' + i" class="task-row" style="opacity: 0.85">
            <span class="tt mono">{{ k }}</span>
            <span class="tt mono dim" :title="v">{{ v.length > 60 ? v.slice(0, 60) + '…' : v }}</span>
            <span><NTag size="tiny" :bordered="false" type="info">系统</NTag></span>
            <span class="row-ops"></span>
          </div>
        </div>
        <EmptyState v-else text="暂无环境变量记录，点击「读取系统变量」拉取本机清单" />
      </n-tab-pane>

      <!-- 技术债 F-DEV-12 -->
      <n-tab-pane name="debts" tab="技术债">
        <div class="board-toolbar">
          <NButton size="small" type="primary" ghost @click="debtFormShow = true">
            <template #icon><NIcon :component="Plus" /></template>
            记录技术债
          </NButton>
        </div>
        <div v-if="techDebts.length" class="task-table">
          <div class="task-row head">
            <span>标题</span><span>分类</span><span>级别</span><span>项目</span><span>状态</span><span>操作</span>
          </div>
          <div v-for="d in techDebts" :key="d.id" class="task-row">
            <span class="tt">{{ d.title }}</span>
            <span><NTag size="tiny" :bordered="false" type="default">{{ d.category }}</NTag></span>
            <span><NTag size="tiny" :bordered="false" :type="debtSeverity(d).color">{{ debtSeverity(d).label }}</NTag></span>
            <span class="tt">{{ d.project || '—' }}</span>
            <span><NTag size="tiny" :bordered="false" :type="d.status === 'done' ? 'success' : d.status === 'planned' ? 'info' : 'warning'">{{ d.status }}</NTag></span>
            <span class="row-ops">
              <NButton size="tiny" text type="error" @click="removeDebt(d)"><template #icon><NIcon :component="Trash" /></template></NButton>
            </span>
          </div>
        </div>
        <EmptyState v-else text="暂无技术债记录" />
      </n-tab-pane>

      <!-- 命令速查 F-DEV-13 -->
      <n-tab-pane name="cmds" tab="命令速查">
        <div class="board-toolbar">
          <NButton size="small" type="primary" ghost @click="cmdFormShow = true">
            <template #icon><NIcon :component="Plus" /></template>
            保存命令
          </NButton>
        </div>
        <div v-if="cmdSnippets.length" class="cmd-grid">
          <div v-for="c in cmdSnippets" :key="c.id" class="cmd-card wb-card">
            <div class="cmd-head">
              <span class="cmd-title">{{ c.title }}</span>
              <NTag size="tiny" :bordered="false" type="info">{{ c.category }}</NTag>
            </div>
            <pre class="cmd-code mono">{{ c.command }}</pre>
            <div v-if="c.note" class="cmd-note">{{ c.note }}</div>
            <div class="cmd-foot">
              <NButton size="tiny" text @click="copyCmd(c)">复制</NButton>
              <span class="mono dim">使用 {{ c.hitCount || 0 }} 次</span>
              <NButton size="tiny" text type="error" @click="removeCmd(c)">删除</NButton>
            </div>
          </div>
        </div>
        <EmptyState v-else text="暂无命令片段，把高频命令存进来" />
      </n-tab-pane>

      <!-- 仓库体检 F-DEV-15 + Git 可视化 F-DEV-17 + 代码统计 -->
      <n-tab-pane name="health" tab="仓库体检">
        <div class="board-toolbar">
          <NInput v-model:value="healthRepoPath" size="small" placeholder="仓库路径…" clearable style="width: 320px; margin-right: 8px" />
          <NButton size="small" type="primary" ghost :loading="healthLoading" @click="runRepoHealth()">
            <template #icon><NIcon :component="Refresh" /></template>
            体检
          </NButton>
        </div>
        <div v-if="repoHealthInfo" class="health-grid">
          <div class="health-score wb-card">
            <div class="hs-num" :style="{ color: healthScore.score >= 80 ? 'var(--wb-success)' : healthScore.score >= 50 ? 'var(--wb-warning)' : 'var(--wb-error)' }">{{ healthScore.score }}</div>
            <div class="hs-label">健康分</div>
            <div class="hs-list">
              <div v-for="it in healthScore.items" :key="it.label" class="hs-item">
                <span :class="it.ok ? 'ok' : 'no'">{{ it.ok ? '✓' : '✕' }}</span>{{ it.label }}
              </div>
            </div>
            <div class="hs-meta mono dim">
              体量 {{ repoHealthInfo.size_mb.toFixed(1) }}MB · {{ repoHealthInfo.file_count }} 文件
            </div>
          </div>
          <div class="health-detail wb-card">
            <div class="hd-row"><span class="hd-label">分支</span><span class="mono">{{ repoHealthInfo.branch || '—' }}</span></div>
            <div class="hd-row"><span class="hd-label">变更文件</span><span class="mono">{{ repoHealthInfo.dirty_files }}</span></div>
            <div class="hd-row"><span class="hd-label">未推送 / 落后</span><span class="mono">{{ repoHealthInfo.ahead }} / {{ repoHealthInfo.behind }}</span></div>
            <div class="hd-row"><span class="hd-label">最近提交</span><span class="mono">{{ repoHealthInfo.last_commit_at || '—' }}</span></div>
            <div class="hd-row"><span class="hd-label">最近消息</span><span class="tt">{{ repoHealthInfo.last_commit_msg || '—' }}</span></div>
            <div class="hd-row"><span class="hd-label">关键文件</span>
              <span>
                <NTag v-if="repoHealthInfo.has_cargo" size="tiny" :bordered="false" type="info">Cargo.toml</NTag>
                <NTag v-if="repoHealthInfo.has_package_json" size="tiny" :bordered="false" type="info">package.json</NTag>
                <NTag v-if="repoHealthInfo.has_readme" size="tiny" :bordered="false" type="success">README</NTag>
                <NTag v-if="repoHealthInfo.has_ci" size="tiny" :bordered="false" type="success">CI</NTag>
                <NTag v-if="!repoHealthInfo.has_readme" size="tiny" :bordered="false" type="error">缺 README</NTag>
              </span>
            </div>
          </div>
        </div>
        <div v-if="gitHistory.length" class="git-history">
          <div class="gh-title">最近提交（Git 可视化）</div>
          <div v-for="c in gitHistory" :key="c.hash" class="gh-row">
            <span class="mono gh-hash">{{ c.short_hash }}</span>
            <span class="gh-date mono">{{ c.date }}</span>
            <span class="tt gh-msg">{{ c.message }}</span>
            <span class="mono dim gh-author">{{ c.author }}</span>
          </div>
        </div>
        <div v-if="codeStatList.length" class="code-stats">
          <div class="gh-title">代码统计</div>
          <div class="cs-grid">
            <div v-for="s in codeStatList" :key="s.lang" class="cs-item wb-card">
              <span class="cs-lang">{{ s.lang }}</span>
              <span class="mono cs-lines">{{ s.lines.toLocaleString() }} 行</span>
              <span class="mono dim">{{ s.files }} 文件</span>
            </div>
          </div>
        </div>
        <EmptyState v-else :text="healthLoading ? '体检中…' : '输入仓库路径后体检（仅 Tauri 环境可用）'" />
      </n-tab-pane>

      <!-- 依赖检查 F-DEV-16 -->
      <n-tab-pane name="deps" tab="依赖检查">
        <div class="toolbar">
          <NButton size="small" type="primary" ghost :loading="depsLoading" @click="runDepsCheck()">
            <template #icon><NIcon :component="Refresh" /></template>
            检查依赖
          </NButton>
        </div>
        <div v-if="depsList.length" class="deps-summary wb-card">
          <span class="mono">共 {{ depsList.length }} 个依赖（dependency {{ depsList.filter((d) => d.kind === 'dependency').length }} / devDependency {{ depsList.filter((d) => d.kind === 'devDependency').length }}）</span>
          <span class="dim" style="font-size: 12px">提示：如需更新可运行 npm outdated 定位过期包，再 npm update 升级。</span>
        </div>
        <div v-if="depsList.length" class="deps-table">
          <div class="d-row head">
            <span>包名</span><span>类型</span><span>声明版本</span>
          </div>
          <div v-for="d in depsList" :key="d.kind + d.name" class="d-row">
            <span class="mono">{{ d.name }}</span>
            <span><NTag size="tiny" :bordered="false" :type="d.kind === 'dependency' ? 'info' : 'default'">{{ d.kind === 'dependency' ? '运行时' : '开发' }}</NTag></span>
            <span class="mono">{{ d.version }}</span>
          </div>
        </div>
        <EmptyState v-else text="点击「检查依赖」读取 package.json 依赖清单" />
      </n-tab-pane>
    </n-tabs>

    <!-- 片段详情抽屉（内联模态） -->
    <n-modal v-if="activeSnippet" :show="true" preset="card" :title="activeSnippet.title" style="width: 680px; max-width: calc(100vw - 48px)" @update:show="(v: boolean) => (activeSnippet = v ? activeSnippet : null)">
      <div class="snippet-detail">
        <div class="sd-meta">
          <NTag size="small" :bordered="false" :type="langColor(activeSnippet.language)">{{ activeSnippet.language }}</NTag>
          <span v-if="activeSnippet.tags" class="mono sd-tags">{{ activeSnippet.tags }}</span>
          <span class="mono sd-date">{{ activeSnippet.updatedAt || activeSnippet.createdAt }}</span>
        </div>
        <pre class="sd-code mono">{{ activeSnippet.code }}</pre>
        <p v-if="activeSnippet.description" class="sd-desc">{{ activeSnippet.description }}</p>
        <div style="display: flex; justify-content: flex-end; gap: 8px">
          <NButton size="tiny" text @click="activeSnippet = null">关闭</NButton>
          <NButton size="tiny" text type="error" @click="removeSnippet(activeSnippet); activeSnippet = null">删除</NButton>
        </div>
      </div>
    </n-modal>

    <ModalForm v-model:show="projectFormShow" title="新建项目" :fields="projectFields" @submit="addProject" />
    <ModalForm v-model:show="taskFormShow" title="新建任务" :fields="taskFields" @submit="addTask" />
    <ModalForm v-model:show="snippetFormShow" title="新建代码片段" :fields="snippetFields" confirm-text="保存" @submit="addSnippet" />
    <ModalForm v-model:show="deployFormShow" title="记录部署" :fields="deployFields" @submit="addDeploy" />
    <ModalForm v-model:show="envFormShow" title="登记环境变量" :fields="envFields" @submit="addEnv" />
    <ModalForm v-model:show="debtFormShow" title="记录技术债" :fields="debtFields" @submit="addDebt" />
    <ModalForm v-model:show="cmdFormShow" title="保存命令片段" :fields="cmdFields" confirm-text="保存" @submit="addCmd" />
  </div>
</template>

<style scoped>
.wb-tabs :deep(.n-tabs-nav) {
  margin-bottom: 14px;
}
.board-toolbar {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 12px;
}
.board {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  align-items: start;
}
@media (max-width: 1100px) {
  .board { grid-template-columns: 1fr; }
}
.board-col {
  border: 1px solid var(--wb-border);
  border-radius: var(--wb-radius-md);
  background: var(--wb-card-alt);
  min-height: 120px;
}
.col-head {
  display: flex;
  justify-content: space-between;
  padding: 10px 14px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--wb-text-2);
}
.count { color: var(--wb-text-3); }
.col-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 0 10px 12px;
}
.task-card {
  padding: 10px 12px;
  background: var(--wb-card);
}
.task-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.task-title { font-size: 13px; font-weight: 550; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.task-meta { display: flex; align-items: center; gap: 6px; margin-top: 6px; flex-wrap: wrap; }
.due { font-size: 11px; color: var(--wb-text-3); }
.task-ops { display: flex; gap: 10px; margin-top: 8px; }
.task-table {
  border: 1px solid var(--wb-border);
  border-radius: var(--wb-radius-md);
  overflow: hidden;
}
.task-row {
  display: grid;
  grid-template-columns: 2.2fr 0.8fr 0.9fr 1fr 0.9fr 1fr;
  gap: 10px;
  align-items: center;
  padding: 9px 14px;
  border-bottom: 1px solid var(--wb-border);
  font-size: 12.5px;
}
.task-row:last-child { border-bottom: none; }
.task-row.head {
  background: var(--wb-card-alt);
  font-weight: 600;
  color: var(--wb-text-2);
  font-size: 12px;
}
.tt { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sub { color: var(--wb-text-3); font-size: 11px; margin-left: 4px; }
.focus-star { color: var(--wb-warning); }
.row-ops { display: flex; gap: 4px; }
.snippet-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 12px;
}
.snippet-card { padding: 12px 14px; cursor: pointer; }
.snippet-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.snippet-title { font-size: 13px; font-weight: 600; display: flex; align-items: center; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.snippet-preview {
  margin: 8px 0 4px;
  padding: 8px 10px;
  background: var(--wb-card-alt);
  border-radius: var(--wb-radius-sm);
  font-size: 11.5px;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 96px;
  overflow: hidden;
  color: var(--wb-text-2);
}
.snippet-tags { font-size: 11px; color: var(--wb-text-3); }
.snippet-detail { display: flex; flex-direction: column; gap: 10px; }
.sd-meta { display: flex; align-items: center; gap: 10px; }
.sd-tags { font-size: 12px; color: var(--wb-text-2); }
.sd-date { font-size: 11px; color: var(--wb-text-3); }
.sd-code {
  margin: 0;
  padding: 12px;
  background: var(--wb-card-alt);
  border-radius: var(--wb-radius-sm);
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 46vh;
  overflow: auto;
}
.sd-desc { font-size: 12.5px; color: var(--wb-text-2); margin: 0; }
.radar-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 12px;
}
.radar-card { padding: 13px 14px; }
.rc-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.rc-name { font-size: 13.5px; font-weight: 600; }
.rc-path { font-size: 11px; color: var(--wb-text-3); margin-top: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rc-techs { display: flex; gap: 5px; margin-top: 7px; flex-wrap: wrap; }
.rc-foot { font-size: 11px; color: var(--wb-text-3); margin-top: 8px; }
.git-card { padding: 16px 18px; max-width: 640px; }
.rc-ops { display: flex; justify-content: flex-end; margin-top: 8px; }
.cmd-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 12px;
}
.cmd-card { padding: 12px 14px; }
.cmd-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.cmd-title { font-size: 13px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cmd-code {
  margin: 8px 0 6px;
  padding: 8px 10px;
  background: var(--wb-card-alt);
  border-radius: var(--wb-radius-sm);
  font-size: 11.5px;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 110px;
  overflow: auto;
  color: var(--wb-module-dev);
}
.cmd-note { font-size: 11.5px; color: var(--wb-text-2); margin: 0 0 6px; }
.cmd-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 11px; }
.dim { opacity: 0.72; }
.health-grid {
  display: grid;
  grid-template-columns: minmax(220px, 340px) 1fr;
  gap: 12px;
}
@media (max-width: 900px) {
  .health-grid { grid-template-columns: 1fr; }
}
.health-score { padding: 16px 18px; }
.hs-num { font-size: 42px; font-weight: 750; line-height: 1; }
.hs-label { font-size: 12px; color: var(--wb-text-3); margin: 2px 0 12px; }
.hs-list { display: flex; flex-direction: column; gap: 6px; font-size: 12.5px; }
.hs-item { display: flex; align-items: center; gap: 8px; }
.hs-item .ok { color: var(--wb-success); font-weight: 700; }
.hs-item .no { color: var(--wb-error); font-weight: 700; }
.hs-meta { margin-top: 12px; font-size: 11px; }
.health-detail { padding: 16px 18px; display: flex; flex-direction: column; gap: 10px; }
.hd-row { display: flex; align-items: center; gap: 12px; font-size: 12.5px; }
.hd-label { width: 86px; color: var(--wb-text-3); flex-shrink: 0; }
.git-history { margin-top: 14px; }
.gh-title { font-size: 12.5px; font-weight: 600; color: var(--wb-text-2); margin-bottom: 8px; }
.gh-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border: 1px solid var(--wb-border);
  border-radius: var(--wb-radius-sm);
  margin-bottom: 6px;
  font-size: 12.5px;
}
.gh-hash { color: var(--wb-module-dev); font-weight: 600; }
.gh-date { color: var(--wb-text-3); font-size: 11px; flex-shrink: 0; }
.gh-msg { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gh-author { font-size: 11px; flex-shrink: 0; }
.code-stats { margin-top: 14px; }
.cs-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; }
.cs-item { padding: 10px 12px; display: flex; flex-direction: column; gap: 3px; }
.cs-lang { font-size: 13px; font-weight: 600; }
.cs-lines { font-size: 14px; color: var(--wb-module-dev); }
.git-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.git-repo { font-size: 13px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.git-metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 12px; margin-top: 14px; }
.gm-item {
  border: 1px solid var(--wb-border);
  border-radius: var(--wb-radius-sm);
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.gm-label { font-size: 11px; color: var(--wb-text-3); }
.gm-value { font-size: 16px; font-weight: 650; color: var(--wb-module-dev); }
</style>
