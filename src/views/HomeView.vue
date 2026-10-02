<script setup lang="ts">
import { watch, ref, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { NButton, NTag, NIcon, NSwitch, NSelect, NInput } from 'naive-ui'
import { ArrowRight } from '@vicons/tabler'
import StatCard from '@/components/StatCard.vue'
import EmptyState from '@/components/EmptyState.vue'
import { refreshTick } from '@/stores/ui'
import { useSettings } from '@/composables/useSettings'
import { useThemeStore } from '@/stores/theme'
import { moduleColor, modules } from '@/theme/tokens'
import {
  tasksRepo, deadlinesRepo, projectsRepo, snippetsRepo, habitsRepo,
  ledgerRepo, coursesRepo, assignmentsRepo, notesRepo, pitfallsRepo,
  serversRepo, domainsRepo, toolsRepo, agentsRepo, habitLogsRepo,
} from '@/db'
import { diskSpace, exportBackup, listBackups, readBackup, llmStatus, type DiskInfo, type BackupInfo, type LlmStatus } from '@/composables/useTauri'
import { aiSemanticSearch, aiAutoClassify, aiDedupe, aiSuggest, aiSummarize, aiGenerate, aiQa, aiAutoTag, type AiEngineResult } from '@/composables/aiEngine'
import { llmConfigured, llmConfigLabel } from '@/composables/llmClient'
import type { Repo } from '@/db/repo'
import type { Task, Deadline, Domain, Assignment, HabitLog } from '../../drizzle/schema'

const router = useRouter()
const themeStore = useThemeStore()

const settings = useSettings()

const loading = ref(false)
const counts = ref<Record<string, number>>({})
const focusTasks = ref<Task[]>([])
const deadlineAlerts = ref<Deadline[]>([])
const disks = ref<DiskInfo[]>([])
const backups = ref<BackupInfo[]>([])
const llm = ref<LlmStatus | null>(null)

// 智能层就绪状态：优先取「设置 → AI 与 LLM」里的自定义服务配置，
// 其次回退到 Rust 侧的环境变量探测（llm_status）。
const llmState = computed<LlmStatus | null>(() => {
  if (llmConfigured()) return { configured: true, provider: llmConfigLabel() }
  return llm.value
})
const exporting = ref(false)
const restoring = ref(false)
const allTasks = ref<Task[]>([])
const allDeadlines = ref<Deadline[]>([])
const allDomains = ref<Domain[]>([])
const allAssignments = ref<Assignment[]>([])
const allHabitLogs = ref<HabitLog[]>([])
const allLedger = ref<Array<{ type: string; amount: number; category: string | null; note: string | null; date: string | null }>>([])
const firstRun = ref(false)
const weeklyReport = ref('')
const weeklyReportVisible = ref(false)
const today = new Date()
const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`

// ---- 智能层能力开关（F-AI-01~10）：localStorage 持久化，全部可开关 ----
const AI_FEATURES = [
  { key: 'semantic_search', label: '语义搜索', desc: '按语义检索文档与图片（F-AI-01）' },
  { key: 'auto_classify', label: '自动分类', desc: '文件 / 笔记自动归类（F-AI-02）' },
  { key: 'dedupe', label: '去重检测', desc: '识别重复文件与重复内容（F-AI-03）' },
  { key: 'smart_suggest', label: '智能建议', desc: '基于使用习惯给出建议（F-AI-04）' },
  { key: 'insight', label: '数据洞察', desc: '从台账数据生成洞察（F-AI-05）' },
  { key: 'summarize', label: '内容摘要', desc: '长文档一键摘要（F-AI-06）' },
  { key: 'generate', label: '内容生成', desc: '草稿与文案生成（F-AI-07）' },
  { key: 'qa', label: '智能问答', desc: '知识库问答（F-AI-08）' },
  { key: 'rules', label: '规则引擎', desc: '自动化规则执行（F-AI-09）' },
  { key: 'auto_tag', label: '自动标签', desc: '内容自动打标签（F-AI-10）' },
]
const aiSwitches = ref<Record<string, boolean>>(Object.fromEntries(AI_FEATURES.map((f) => [f.key, true])))
function loadAiSwitches() {
  try {
    const raw = localStorage.getItem('wb:ai-switches')
    if (raw) aiSwitches.value = { ...aiSwitches.value, ...JSON.parse(raw) }
  } catch { /* 忽略损坏数据 */ }
}
function toggleAi(key: string) {
  aiSwitches.value[key] = !aiSwitches.value[key]
  try { localStorage.setItem('wb:ai-switches', JSON.stringify(aiSwitches.value)) } catch { /* ignore */ }
}
loadAiSwitches()

// ---- 数据备份护栏（F-SYS-03）：上次备份超过 7 天提醒 ----
const lastBackupDays = computed(() => {
  if (!backups.value.length) return null
  const latest = Math.max(...backups.value.map((b) => b.modified))
  return Math.floor((Date.now() / 1000 - latest) / 86400)
})

async function loadBackups() {
  try {
    backups.value = await listBackups()
  } catch {
    backups.value = []
  }
}

async function loadLlm() {
  try {
    llm.value = await llmStatus()
  } catch {
    llm.value = null
  }
}

async function doExport() {
  if (exporting.value) return
  exporting.value = true
  try {
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
      tables: {
        tasks, deadlines, projects, snippets, habits, ledger,
        courses, assignments, notes, pitfalls, servers, domains, tools, agents,
      },
    }
    const name = await exportBackup(JSON.stringify(payload))
    backups.value = await listBackups()
    window.alert(`已导出备份：${name}`)
  } catch (e) {
    console.warn('[Home] 导出失败', e)
    window.alert('导出失败：' + String(e))
  } finally {
    exporting.value = false
  }
}

async function doRestore(name: string) {
  if (restoring.value) return
  if (!window.confirm(`确认从备份 ${name} 恢复数据？现有数据将被覆盖。`)) return
  restoring.value = true
  try {
    const json = await readBackup(name)
    const payload = JSON.parse(json)
    const tables = payload.tables ?? {}
    const all: Array<{ rows: unknown[]; repo: Repo<{ id: number }> }> = [
      { rows: tables.tasks ?? [], repo: tasksRepo },
      { rows: tables.deadlines ?? [], repo: deadlinesRepo },
      { rows: tables.projects ?? [], repo: projectsRepo },
      { rows: tables.snippets ?? [], repo: snippetsRepo },
      { rows: tables.habits ?? [], repo: habitsRepo },
      { rows: tables.ledger ?? [], repo: ledgerRepo },
      { rows: tables.courses ?? [], repo: coursesRepo },
      { rows: tables.assignments ?? [], repo: assignmentsRepo },
      { rows: tables.notes ?? [], repo: notesRepo },
      { rows: tables.pitfalls ?? [], repo: pitfallsRepo },
      { rows: tables.servers ?? [], repo: serversRepo },
      { rows: tables.domains ?? [], repo: domainsRepo },
      { rows: tables.tools ?? [], repo: toolsRepo },
      { rows: tables.agents ?? [], repo: agentsRepo },
    ]
    for (const { rows, repo } of all) {
      const olds = await repo.listAll()
      for (const o of olds) await repo.remove(o.id)
      for (const row of rows) await repo.insert(row as never)
    }
    window.alert(`已从 ${name} 恢复数据`)
    await load()
  } catch (e) {
    console.warn('[Home] 恢复失败', e)
    window.alert('恢复失败：' + String(e))
  } finally {
    restoring.value = false
  }
}

async function load() {
  loading.value = true
  try {
    const [tasks, deadlines, projects, snippets, habits, ledger, courses, assignments, notes, pitfalls, servers, domains, tools, agents, habitLogs] =
      await Promise.all([
        tasksRepo.listAll(), deadlinesRepo.listAll(), projectsRepo.listAll(),
        snippetsRepo.listAll(), habitsRepo.listAll(), ledgerRepo.listAll(),
        coursesRepo.listAll(), assignmentsRepo.listAll(), notesRepo.listAll(),
        pitfallsRepo.listAll(), serversRepo.listAll(), domainsRepo.listAll(),
        toolsRepo.listAll(), agentsRepo.listAll(), habitLogsRepo.listAll(),
      ])
    allTasks.value = tasks
    allDeadlines.value = deadlines
    allDomains.value = domains
    allAssignments.value = assignments
    allHabitLogs.value = habitLogs
    allLedger.value = ledger
    counts.value = {
      tasks: tasks.length, deadlines: deadlines.length, projects: projects.length,
      snippets: snippets.length, habits: habits.length, ledger: ledger.length,
      courses: courses.length, assignments: assignments.length, notes: notes.length,
      pitfalls: pitfalls.length, servers: servers.length, domains: domains.length,
      tools: tools.length, agents: agents.length,
    }
    focusTasks.value = tasks
      .filter((t) => t.focusDate === todayStr && t.status !== 'done')
      .sort((a, b) => (a.priority === 'high' || a.priority === 'urgent' ? -1 : 1))
      .slice(0, 6)
    deadlineAlerts.value = deadlines
      .filter((d) => d.status === 'open' && d.dueDate >= todayStr)
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
      .slice(0, 4)
  } catch (e) {
    console.warn('[Home] 数据加载失败（浏览器降级）', e)
  }
  try {
    disks.value = await diskSpace()
  } catch {
    disks.value = []
  }
  loading.value = false
}

watch(refreshTick, () => { load() })
onMounted(() => {
  load()
  loadBackups()
  loadLlm()
  initFirstRun()
})

const diskAlert = computed(() => {
  const d = disks.value.find((x) => x.used_percent >= 90)
  return d ? `${d.mount} 盘已用 ${d.used_percent.toFixed(1)}%` : ''
})

const deadlineAlert = computed(() => {
  if (!deadlineAlerts.value.length) return ''
  const d = deadlineAlerts.value[0]
  return `最近截止：${d.title}（${d.dueDate}）`
})

const overdueTasks = computed(() => {
  const n = deadlineAlerts.value.length
  return n ? `${n} 项近期截止` : ''
})

const stats = computed(() => [
  { key: 'dev', label: '任务', value: counts.value.tasks ?? 0, sub: `截止 ${counts.value.deadlines ?? 0}` },
  { key: 'dev', label: '项目', value: counts.value.projects ?? 0, sub: `片段 ${counts.value.snippets ?? 0}` },
  { key: 'ops', label: '服务器', value: counts.value.servers ?? 0, sub: `域名 ${counts.value.domains ?? 0}` },
  { key: 'life', label: '习惯', value: counts.value.habits ?? 0, sub: `记账 ${counts.value.ledger ?? 0} 笔` },
  { key: 'study', label: '课程', value: counts.value.courses ?? 0, sub: `作业 ${counts.value.assignments ?? 0}` },
  { key: 'knowledge', label: '笔记', value: counts.value.notes ?? 0, sub: `踩坑 ${counts.value.pitfalls ?? 0}` },
  { key: 'workspace', label: '工具', value: counts.value.tools ?? 0, sub: `Agent ${counts.value.agents ?? 0}` },
])

// ---- 首次引导（F-SYS-11）：localStorage 标记，仅首次展示 ----
function initFirstRun() {
  try {
    if (!localStorage.getItem('wb:first-run')) {
      firstRun.value = true
      localStorage.setItem('wb:first-run', '1')
    }
  } catch { /* ignore */ }
}
function dismissFirstRun() { firstRun.value = false }

// ---- 规则引擎执行（F-AI-09 rules 开关联动）：基于台账求值，命中可一键生成任务 ----
interface RuleHit {
  id: string
  name: string
  detail: string
  scope: 'ops' | 'dev' | 'study' | 'life'
  taskTitle: string
}
function daysUntil(dateStr?: string | null): number | null {
  if (!dateStr) return null
  const d = new Date(`${dateStr}T00:00:00`)
  if (Number.isNaN(d.getTime())) return null
  return Math.ceil((d.getTime() - Date.now()) / 86400000)
}
const ruleHits = computed<RuleHit[]>(() => {
  if (!aiSwitches.value.rules) return []
  const hits: RuleHit[] = []
  const fullDisk = disks.value.find((x) => x.used_percent >= 90)
  if (fullDisk) hits.push({ id: 'disk', name: '磁盘空间预警', detail: `${fullDisk.mount} 盘已用 ${fullDisk.used_percent.toFixed(1)}%，建议清理`, scope: 'ops', taskTitle: `清理磁盘空间：${fullDisk.mount} 盘已用 ${fullDisk.used_percent.toFixed(1)}%` })
  for (const dom of allDomains.value) {
    const dd = daysUntil(dom.expireDate)
    if (dd !== null && dd >= 0 && dd <= 30) hits.push({ id: `domain-${dom.id}`, name: '域名到期', detail: `${dom.name} 将于 ${dom.expireDate} 到期（剩余 ${dd} 天）`, scope: 'ops', taskTitle: `续费域名 ${dom.name}（${dom.expireDate} 到期）` })
    const sd = daysUntil(dom.sslExpireDate)
    if (sd !== null && sd >= 0 && sd <= 30) hits.push({ id: `ssl-${dom.id}`, name: 'SSL 证书到期', detail: `${dom.name} 的 SSL 证书将于 ${dom.sslExpireDate} 到期（剩余 ${sd} 天）`, scope: 'ops', taskTitle: `更新 SSL 证书 ${dom.name}（${dom.sslExpireDate} 到期）` })
  }
  for (const a of allAssignments.value) {
    if (a.status === 'done') continue
    const ad = daysUntil(a.dueDate)
    if (ad !== null && ad >= 0 && ad <= 3) hits.push({ id: `hw-${a.id}`, name: '作业临近截止', detail: `${a.title} 将于 ${a.dueDate} 截止（剩余 ${ad} 天）`, scope: 'study', taskTitle: `完成作业：${a.title}（${a.dueDate} 截止）` })
  }
  const overdue = allTasks.value.filter((t) => t.status !== 'done' && t.dueDate && daysUntil(t.dueDate) !== null && daysUntil(t.dueDate)! < 0)
  if (overdue.length) hits.push({ id: 'overdue', name: '任务逾期', detail: `${overdue.length} 项任务已逾期未完成`, scope: 'dev', taskTitle: `处理逾期任务：${overdue.slice(0, 3).map((t) => t.title).join('、')}${overdue.length > 3 ? ' 等' : ''}` })
  if (lastBackupDays.value !== null && lastBackupDays.value > 7) hits.push({ id: 'backup', name: '备份护栏', detail: `距上次备份已 ${lastBackupDays.value} 天，建议立即导出`, scope: 'ops', taskTitle: '导出数据备份（已超过 7 天未备份）' })
  return hits
})
async function applyRuleTask(r: RuleHit) {
  try {
    await tasksRepo.insert({
      title: r.taskTitle, scope: r.scope, type: 'task', priority: 'high',
      dueDate: todayStr, note: `由规则引擎自动生成（${r.name}）`,
    })
    window.alert(`已生成任务：${r.taskTitle}`)
    await load()
  } catch (e) {
    window.alert('生成任务失败：' + String(e))
  }
}

// ---- 数据洞察（F-AI-05 insight 开关联动）：基于台账统计 ----
const insights = computed(() => {
  if (!aiSwitches.value.insight) return []
  const out: string[] = []
  const doneToday = allTasks.value.filter((t) => t.status === 'done' && t.focusDate === todayStr).length
  const pending = allTasks.value.filter((t) => t.status !== 'done').length
  const monthKey = todayStr.slice(0, 7)
  const spend = allLedger.value.filter((l) => l.type === 'expense' && (l.date ?? '').startsWith(monthKey)).reduce((s, l) => s + (Number(l.amount) || 0), 0)
  const doneLogs = allHabitLogs.value.filter((h) => h.date === todayStr).length
  const habitTotal = counts.value.habits ?? 0
  const rate = habitTotal ? Math.round((doneLogs / habitTotal) * 100) : 0
  const overdueAll = allTasks.value.filter((t) => t.status !== 'done' && t.dueDate && daysUntil(t.dueDate) !== null && daysUntil(t.dueDate)! < 0).length
  if (doneToday) out.push(`今日已完成 ${doneToday} 项任务，继续保持节奏`)
  if (pending) out.push(`当前有 ${pending} 项待办任务，积压压力${pending > 10 ? '较大' : '适中'}`)
  if (spend) out.push(`本月支出合计 ¥${spend.toFixed(2)}，建议月底复盘`)
  if (habitTotal) out.push(`习惯今日完成率 ${rate}%（${doneLogs}/${habitTotal}）`)
  if (overdueAll) out.push(`有 ${overdueAll} 项逾期任务待处理，建议优先清空`)
  if (!out.length) out.push('暂无足够数据生成洞察，先去各模块录入台账吧')
  return out
})

// ---- 每周总结 / 报表生成（F-AI-06 summarize / F-AI-09 报表导出联动）----
function buildWeeklyReport() {
  const now = new Date()
  const day = now.getDay() === 0 ? 7 : now.getDay()
  const mon = new Date(now)
  mon.setDate(now.getDate() - day + 1)
  const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const monStr = fmt(mon)
  const doneThisWeek = allTasks.value.filter((t) => t.status === 'done' && t.focusDate && t.focusDate >= monStr && t.focusDate <= todayStr).length
  const newThisWeek = allTasks.value.filter((t) => t.dueDate && t.dueDate >= monStr && t.dueDate <= todayStr && t.status !== 'done').length
  const monthKey = todayStr.slice(0, 7)
  const spend = allLedger.value.filter((l) => l.type === 'expense' && (l.date ?? '').startsWith(monthKey)).reduce((s, l) => s + (Number(l.amount) || 0), 0)
  const doneLogs = allHabitLogs.value.filter((h) => h.date === todayStr).length
  const habitTotal = counts.value.habits ?? 0
  const rate = habitTotal ? Math.round((doneLogs / habitTotal) * 100) : 0
  const lines: string[] = []
  lines.push(`# WORKBENCH 周报（${monStr} ~ ${todayStr}）`)
  lines.push('')
  lines.push('## 本周概览')
  lines.push(`- 完成任务：${doneThisWeek}`)
  lines.push(`- 进行中任务：${newThisWeek}`)
  lines.push(`- 本月支出：¥${spend.toFixed(2)}`)
  lines.push(`- 习惯今日完成率：${rate}%`)
  lines.push('')
  lines.push('## 规则引擎命中')
  if (ruleHits.value.length) {
    for (const r of ruleHits.value) lines.push(`- [${r.scope}] ${r.name}：${r.detail}`)
  } else {
    lines.push('- 无命中，全部指标正常')
  }
  lines.push('')
  lines.push(`> 由 WORKBENCH 智能层自动生成于 ${todayStr}`)
  weeklyReport.value = lines.join('\n')
  weeklyReportVisible.value = true
}
function downloadWeeklyReport() {
  if (!weeklyReport.value) return
  const blob = new Blob([weeklyReport.value], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `workbench-weekly-${todayStr}.md`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

function go(path: string) {
  router.push(path)
}

// ---- 智能层执行面板（F-AI-01/02/03/04/06/07/08/10 实际后端执行，开关联动）----
const aiExecMode = ref<'semantic_search' | 'auto_classify' | 'smart_suggest' | 'summarize' | 'generate' | 'qa' | 'auto_tag' | 'dedupe'>('semantic_search')
const aiExecInput = ref('')
const aiExecResult = ref<AiEngineResult | null>(null)
const aiExecLoading = ref(false)
const AI_MODE_OPTIONS = [
  { value: 'semantic_search', label: '语义搜索', feature: 'semantic_search' },
  { value: 'auto_classify', label: '自动分类', feature: 'auto_classify' },
  { value: 'dedupe', label: '去重检测', feature: 'dedupe' },
  { value: 'smart_suggest', label: '智能建议', feature: 'smart_suggest' },
  { value: 'summarize', label: '内容摘要', feature: 'summarize' },
  { value: 'generate', label: '内容生成', feature: 'generate' },
  { value: 'qa', label: '智能问答', feature: 'qa' },
  { value: 'auto_tag', label: '自动标签', feature: 'auto_tag' },
]
function aiModeFeature(mode: string): string {
  return AI_MODE_OPTIONS.find((m) => m.value === mode)?.feature ?? 'semantic_search'
}
async function runAiExec() {
  const feature = aiModeFeature(aiExecMode.value)
  if (!aiSwitches.value[feature]) {
    window.alert(`「${AI_FEATURES.find((f) => f.key === feature)?.label}」开关已关闭，请先在智能层状态中开启`)
    return
  }
  aiExecLoading.value = true
  aiExecResult.value = null
  try {
    const m = aiExecMode.value
    if (m === 'semantic_search') aiExecResult.value = await aiSemanticSearch(aiExecInput.value)
    else if (m === 'auto_classify') aiExecResult.value = aiAutoClassify(aiExecInput.value)
    else if (m === 'dedupe') aiExecResult.value = await aiDedupe()
    else if (m === 'smart_suggest') aiExecResult.value = await aiSuggest()
    else if (m === 'summarize') aiExecResult.value = aiSummarize(aiExecInput.value)
    else if (m === 'generate') aiExecResult.value = await aiGenerate('report', aiExecInput.value)
    else if (m === 'qa') aiExecResult.value = await aiQa(aiExecInput.value)
    else if (m === 'auto_tag') aiExecResult.value = aiAutoTag(aiExecInput.value)
    if (aiExecResult.value?.ok) recordActivity(`智能层执行：${aiExecMode.value}`)
  } catch (e) {
    aiExecResult.value = { ok: false, kind: aiExecMode.value, items: [], summary: '执行失败：' + String(e) }
  } finally {
    aiExecLoading.value = false
  }
}

// ---- F-OVW-03 动态流：记录最近操作，展示最近 8 条 ----
interface ActivityItem { at: string; text: string }
const activityFeed = ref<ActivityItem[]>([])
function loadActivity() {
  try {
    const raw = localStorage.getItem('wb:activity')
    activityFeed.value = raw ? (JSON.parse(raw) as ActivityItem[]).slice(0, 8) : []
  } catch { activityFeed.value = [] }
}
function recordActivity(text: string) {
  try {
    const now = new Date()
    const at = `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
    const arr = [{ at, text }, ...activityFeed.value].slice(0, 30)
    activityFeed.value = arr.slice(0, 8)
    localStorage.setItem('wb:activity', JSON.stringify(arr))
  } catch { /* ignore */ }
}
loadActivity()

// ---- F-OVW-04 每日快照 + 7 日趋势：基于任务完成/记账/习惯统计，简单柱状图 ----
const trendData = computed(() => {
  const out: { date: string; done: number; spend: number; habits: number }[] = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const done = allTasks.value.filter((t) => t.status === 'done' && t.focusDate === key).length
    const spend = allLedger.value.filter((l) => l.type === 'expense' && (l.date ?? '') === key).reduce((s, l) => s + (Number(l.amount) || 0), 0)
    const habits = allHabitLogs.value.filter((h) => h.date === key).length
    out.push({ date: key.slice(5), done, spend, habits })
  }
  return out
})
const trendMax = computed(() => Math.max(1, ...trendData.value.map((d) => Math.max(d.done, d.habits))))

// ---- F-OVW-06 卡片隐藏：模块统计卡支持隐藏/恢复（localStorage）----
const hiddenStats = ref<string[]>([])
function loadHiddenStats() {
  try {
    const raw = localStorage.getItem('wb:hidden-stats')
    hiddenStats.value = raw ? (JSON.parse(raw) as string[]) : []
  } catch { hiddenStats.value = [] }
}
function toggleStatHidden(key: string) {
  const i = hiddenStats.value.indexOf(key)
  if (i >= 0) hiddenStats.value.splice(i, 1)
  else hiddenStats.value.push(key)
  try { localStorage.setItem('wb:hidden-stats', JSON.stringify(hiddenStats.value)) } catch { /* ignore */ }
}
loadHiddenStats()
const visibleStats = computed(() => stats.value.filter((s) => !hiddenStats.value.includes(s.key)))

// ---- F-SYS-05 全局搜索（语法过滤）：支持 type:/tag:/date: 前缀 ----
const searchQuery = ref('')
const searchResults = computed(() => {
  const q = searchQuery.value.trim()
  if (!q) return []
  let typeFilter = ''
  let tagFilter = ''
  let dateFilter = ''
  const typeMatch = q.match(/\btype:(\w+)\b/)
  const tagMatch = q.match(/\btag:([\w\u4e00-\u9fa5]+)\b/)
  const dateMatch = q.match(/\bdate:(\d{4}-\d{2}-\d{2})\b/)
  let kw = q
  if (typeMatch) { typeFilter = typeMatch[1]; kw = kw.replace(typeMatch[0], '') }
  if (tagMatch) { tagFilter = tagMatch[1]; kw = kw.replace(tagMatch[0], '') }
  if (dateMatch) { dateFilter = dateMatch[1]; kw = kw.replace(dateMatch[0], '') }
  kw = kw.trim().toLowerCase()
  const hit = (s: string) => !kw || s.toLowerCase().includes(kw)
  const out: { type: string; title: string; meta: string }[] = []
  if (!typeFilter || typeFilter === 'task') allTasks.value.filter((t) => hit(`${t.title} ${t.note || ''}`) && (!dateFilter || (t.focusDate ?? '') === dateFilter || (t.dueDate ?? '') === dateFilter)).slice(0, 6).forEach((t) => out.push({ type: '任务', title: t.title, meta: `${t.scope || ''} ${t.dueDate || ''}` }))
  if (!typeFilter || typeFilter === 'note') allNotes.value.filter((n) => hit(`${n.title} ${n.content || ''}`) && (!tagFilter || (n.tags ?? '').includes(tagFilter))).slice(0, 6).forEach((n) => out.push({ type: '笔记', title: n.title, meta: `${n.tags || '未分类'} ${n.updatedAt || ''}` }))
  if (!typeFilter || typeFilter === 'pitfall') allPitfalls.value.filter((p) => hit(`${p.title} ${p.problem || ''} ${p.solution || ''}`) && (!tagFilter || (p.tags ?? '').includes(tagFilter))).slice(0, 6).forEach((p) => out.push({ type: '踩坑', title: p.title, meta: `${p.category || ''}` }))
  if (!typeFilter || typeFilter === 'snippet') allSnippets.value.filter((s) => hit(`${s.title} ${s.code || ''}`) && (!tagFilter || (s.tags ?? '').includes(tagFilter))).slice(0, 6).forEach((s) => out.push({ type: '片段', title: s.title, meta: `${s.language || ''}` }))
  if (!typeFilter || typeFilter === 'deadline') allDeadlines.value.filter((d) => hit(d.title) && (!dateFilter || (d.dueDate ?? '') === dateFilter)).slice(0, 6).forEach((d) => out.push({ type: '截止', title: d.title, meta: `${d.dueDate || ''} ${d.status || ''}` }))
  return out.slice(0, 12)
})
function recordSearch() {
  if (searchQuery.value.trim()) recordActivity(`全局搜索：${searchQuery.value.trim()}`)
}

// ---- 加载补充数据源（供全局搜索与 aiEngine 使用）----
const allNotes = ref<Array<{ id: number; title: string; content: string | null; tags: string | null; updatedAt: string | null }>>([])
const allPitfalls = ref<Array<{ id: number; title: string; problem: string | null; solution: string | null; category: string | null; tags: string | null }>>([])
const allSnippets = ref<Array<{ id: number; title: string; code: string | null; language: string | null; tags: string | null }>>([])
async function loadSearchSources() {
  try {
    const [notes, pitfalls, snippets] = await Promise.all([notesRepo.listAll(), pitfallsRepo.listAll(), snippetsRepo.listAll()])
    allNotes.value = notes
    allPitfalls.value = pitfalls
    allSnippets.value = snippets
  } catch { /* 浏览器降级忽略 */ }
}
onMounted(() => {
  loadSearchSources()
  loadActivity()
})
</script>

<template>
  <div>

    <!-- 自定义卡片（F-SYS-06 简化版：设置面板注册的文本卡片） -->
    <div v-if="settings.cards.length" class="plugin-cards" style="margin-bottom: 16px">
      <section v-for="c in settings.cards" :key="c.id" class="wb-card plugin-card">
        <header class="card-head">
          <span class="accent-bar" :style="{ background: c.color || moduleColor('home', themeStore.dark) }"></span>
          <h2>{{ c.name }}</h2>
        </header>
        <pre class="plugin-content">{{ c.content }}</pre>
      </section>
    </div>

    <!-- 越界告警条 -->
    <div v-if="diskAlert || deadlineAlert" class="alerts" style="margin-bottom: 16px">
      <div v-if="diskAlert" class="alert-strip danger">◉ {{ diskAlert }}，请及时清理磁盘空间</div>
      <div v-if="deadlineAlert" class="alert-strip warn">◉ {{ deadlineAlert }}，请及时处理</div>
      <div v-if="overdueTasks" class="alert-strip warn">◉ {{ overdueTasks }}</div>
    </div>

    <!-- 首次引导（F-SYS-11） -->
    <div v-if="firstRun" class="onboard-card" style="margin-bottom: 16px">
      <div class="onboard-title">欢迎使用 WORKBENCH</div>
      <div class="onboard-body">
        <span>按 <span class="mono">Ctrl/Cmd + 1..7</span> 切换模块，<span class="mono">Ctrl/Cmd + K</span> 打开命令面板，<span class="mono">g</span> 后按 <span class="mono">d/l/s/o/k/w/h</span> 快速跳转，<span class="mono">n</span> 快速新建。首次进入请先在各模块录入台账，智能层将自动提供规则预警与洞察。</span>
      </div>
      <NButton size="tiny" type="primary" ghost @click="dismissFirstRun">我知道了</NButton>
    </div>

    <!-- 今日焦点 -->
    <div class="section-grid">
      <section class="wb-card focus-card">
        <header class="card-head">
          <span class="accent-bar" :style="{ background: moduleColor('home', themeStore.dark) }"></span>
          <h2>今日焦点</h2>
          <NTag size="small" :bordered="false" class="mono">{{ todayStr }}</NTag>
        </header>
        <div v-if="focusTasks.length" class="focus-list">
          <div v-for="t in focusTasks" :key="t.id" class="focus-item">
            <NTag size="small" :bordered="false" :color="{ color: 'transparent', textColor: moduleColor(t.scope === 'study' ? 'study' : t.scope === 'life' ? 'life' : 'dev', themeStore.dark) }">
              {{ t.scope }}
            </NTag>
            <span class="focus-title">{{ t.title }}</span>
            <span class="mono" style="color: var(--wb-text-3); font-size: 11.5px">{{ t.dueDate || '—' }}</span>
          </div>
        </div>
        <EmptyState v-else text="今天还没有焦点任务" />
        <div class="card-foot">
          <NButton size="tiny" text type="primary" @click="go('/dev')">去任务列表 <template #icon><NIcon :component="ArrowRight" /></template></NButton>
        </div>
      </section>

      <section class="wb-card stats-card">
        <header class="card-head">
          <span class="accent-bar" :style="{ background: moduleColor('home', themeStore.dark) }"></span>
          <h2>模块统计</h2>
        </header>
        <div v-if="loading" class="load-strip">数据加载中…</div>
        <div class="stats-grid">
          <StatCard v-for="s in visibleStats" :key="s.key" :label="s.label" :value="s.value" :sub="s.sub" :color="moduleColor(s.key, themeStore.dark)" />
        </div>
        <div class="stats-tools">
          <span class="stats-hint">点击隐藏 / 恢复统计卡片（F-OVW-06）</span>
          <span v-for="s in stats" :key="s.key" class="stat-toggle mono" :class="{ off: hiddenStats.includes(s.key) }" @click="toggleStatHidden(s.key)">{{ s.key }}</span>
        </div>
      </section>
    </div>

    <!-- 能力层：系统底座 + 智能层 -->
    <div class="section-grid cap-grid" style="margin-bottom: 16px">
      <section class="wb-card">
        <header class="card-head">
          <span class="accent-bar" :style="{ background: moduleColor('ops', themeStore.dark) }"></span>
          <h2>系统底座 · 数据备份</h2>
          <NButton size="tiny" type="primary" :loading="exporting" @click="doExport">导出备份</NButton>
        </header>
        <div class="cap-body">
          <div v-if="lastBackupDays !== null && lastBackupDays > 7" class="backup-guard">
            <span class="bg-dot"></span>
            距上次备份已 {{ lastBackupDays }} 天（超过 7 天建议立即导出）
          </div>
          <div v-if="backups.length" class="backup-list">
            <div v-for="b in backups" :key="b.name" class="backup-item">
              <span class="mono backup-name">{{ b.name }}</span>
              <span class="mono backup-meta">{{ (b.size / 1024).toFixed(1) }} KB</span>
              <NButton size="tiny" text type="primary" :loading="restoring" @click="doRestore(b.name)">恢复</NButton>
            </div>
          </div>
          <EmptyState v-else text="暂无备份，点击「导出备份」生成一份" />
        </div>
      </section>

      <section class="wb-card" v-if="settings.llmEnabled">
        <header class="card-head">
          <span class="accent-bar" :style="{ background: moduleColor('knowledge', themeStore.dark) }"></span>
          <h2>智能层 · 状态检测</h2>
        </header>
        <div class="cap-body">
          <template v-if="llmState">
            <div class="llm-row">
              <NTag size="small" :bordered="false" :type="llmState.configured ? 'success' : 'warning'">
                {{ llmState.configured ? '已启用' : '未配置' }}
              </NTag>
              <span class="llm-provider">{{ llmState.provider }}</span>
            </div>
            <p class="llm-tip">
              {{ llmState.configured ? '智能层已就绪，智能问答会优先调用该服务生成回答。' : '未检测到 LLM 服务：请在「系统设置 → AI 与 LLM」填写服务地址与 API Key，或使用环境变量。下方各能力仍可本地运行。' }}
            </p>
          </template>
          <EmptyState v-else text="智能层状态不可用（浏览器降级）" />
          <div class="ai-switches">
            <div v-for="f in AI_FEATURES" :key="f.key" class="ai-switch">
              <div class="ai-meta">
                <div class="ai-name">{{ f.label }}</div>
                <div class="ai-desc">{{ f.desc }}</div>
              </div>
              <NSwitch size="small" :value="!!aiSwitches[f.key]" @update:value="toggleAi(f.key)" />
            </div>
          </div>
        </div>
      </section>
    </div>

    <!-- 智能层执行：规则引擎 / 数据洞察 / 每周总结 -->
    <div class="ai-exec-grid" style="margin-bottom: 16px" v-if="settings.llmEnabled">
      <section class="wb-card">
        <header class="card-head">
          <span class="accent-bar" :style="{ background: moduleColor('ops', themeStore.dark) }"></span>
          <h2>规则引擎 · 执行结果</h2>
          <NTag v-if="!aiSwitches.rules" size="small" :bordered="false" type="warning">已关闭</NTag>
          <NTag v-else size="small" :bordered="false" :type="ruleHits.length ? 'warning' : 'success'">{{ ruleHits.length }} 条命中</NTag>
        </header>
        <div class="cap-body">
          <div v-if="aiSwitches.rules && ruleHits.length" class="rule-list">
            <div v-for="r in ruleHits" :key="r.id" class="rule-item">
              <span class="rule-tag mono">{{ r.scope }}</span>
              <div class="rule-meta">
                <div class="rule-name">{{ r.name }}</div>
                <div class="rule-detail">{{ r.detail }}</div>
              </div>
              <NButton size="tiny" type="primary" @click="applyRuleTask(r)">生成任务</NButton>
            </div>
          </div>
          <div v-else class="rule-empty">
            {{ aiSwitches.rules ? '当前无规则命中，所有指标正常。' : '规则引擎已关闭，在下方开关中开启后自动求值。' }}
          </div>
          <div v-if="insights.length" class="insight-list">
            <div class="insight-title">数据洞察</div>
            <div v-for="(ins, i) in insights" :key="i" class="insight-item">◉ {{ ins }}</div>
          </div>
        </div>
      </section>

      <section class="wb-card">
        <header class="card-head">
          <span class="accent-bar" :style="{ background: moduleColor('knowledge', themeStore.dark) }"></span>
          <h2>每周总结 · 报表导出</h2>
        </header>
        <div class="cap-body">
          <p class="llm-tip">基于本周任务、记账与习惯数据自动汇总，可生成 Markdown 报表导出。</p>
          <div class="report-actions">
            <NButton size="small" type="primary" @click="buildWeeklyReport">生成周报</NButton>
            <NButton size="small" :disabled="!weeklyReport" @click="downloadWeeklyReport">下载 .md</NButton>
          </div>
          <pre v-if="weeklyReportVisible && weeklyReport" class="report-preview">{{ weeklyReport }}</pre>
        </div>
      </section>
    </div>

    <!-- 智能层执行面板（F-AI-01/02/03/04/06/07/08/10：本地引擎执行 + 开关联动） -->
    <section class="wb-card ai-panel" style="margin-bottom: 16px">
      <header class="card-head">
        <span class="accent-bar" :style="{ background: moduleColor('knowledge', themeStore.dark) }"></span>
        <h2>智能层 · 执行面板</h2>
        <NTag size="small" :bordered="false" type="info">本地引擎</NTag>
      </header>
      <div class="cap-body">
        <div class="ai-exec-bar">
          <NSelect v-model:value="aiExecMode" :options="AI_MODE_OPTIONS" size="small" style="width: 170px" />
          <NInput v-model:value="aiExecInput" size="small" placeholder="输入内容 / 关键词 / 问题（搜索、分类、摘要、问答、标签、生成用）" @keyup.enter="runAiExec" clearable />
          <NButton size="small" type="primary" :loading="aiExecLoading" @click="runAiExec">执行</NButton>
        </div>
        <div v-if="aiExecResult" class="ai-exec-result">
          <div class="insight-title">{{ aiExecResult.summary }}</div>
          <div v-if="aiExecResult.kind === 'generate'" class="gen-preview"><pre>{{ aiExecResult.items[0]?.meta }}</pre></div>
          <div v-else-if="aiExecResult.items.length" class="ai-result-list">
            <div v-for="(it, i) in aiExecResult.items" :key="i" class="ai-result-item">
              <span class="rule-tag mono">#{{ i + 1 }}</span>
              <div class="rule-meta">
                <div class="rule-name">{{ it.title }}</div>
                <div class="rule-detail">{{ it.meta }}</div>
              </div>
            </div>
          </div>
          <EmptyState v-else-if="aiExecResult.ok" text="暂无结果" />
        </div>
        <div v-if="aiSwitches.dedupe || aiSwitches.smart_suggest" class="ai-proactive">
          <div v-if="aiSwitches.smart_suggest && !aiExecLoading && !aiExecResult" class="proactive-row">
            <NButton size="tiny" text type="primary" @click="aiExecMode = 'smart_suggest'; runAiExec()">生成智能建议</NButton>
            <span class="proactive-hint">基于习惯 / 任务 / 记账 / Agent 状态</span>
          </div>
          <div v-if="aiSwitches.dedupe" class="proactive-row">
            <NButton size="tiny" text type="primary" @click="aiExecMode = 'dedupe'; runAiExec()">扫描重复条目</NButton>
            <span class="proactive-hint">任务 / 笔记 / 片段 相似标题检测</span>
          </div>
        </div>
      </div>
    </section>

    <!-- F-OVW-03 动态流 + F-OVW-04 7日趋势 -->
    <div class="section-grid" style="margin-bottom: 16px">
      <section class="wb-card">
        <header class="card-head">
          <span class="accent-bar" :style="{ background: moduleColor('dev', themeStore.dark) }"></span>
          <h2>7 日趋势</h2>
          <NTag size="small" :bordered="false" class="mono">任务完成 / 习惯打卡</NTag>
        </header>
        <div class="cap-body">
          <div v-if="trendData.length" class="trend-bars">
            <div v-for="d in trendData" :key="d.date" class="trend-col">
              <div class="trend-bar-wrap">
                <div class="trend-bar" :style="{ height: Math.max(4, (d.done / trendMax) * 80) + 'px' }" :title="`完成 ${d.done}`"></div>
                <div class="trend-bar second" :style="{ height: Math.max(4, (d.habits / trendMax) * 80) + 'px' }" :title="`打卡 ${d.habits}`"></div>
              </div>
              <span class="trend-label mono">{{ d.date }}</span>
            </div>
          </div>
          <EmptyState v-else text="暂无趋势数据" />
        </div>
      </section>

      <section class="wb-card">
        <header class="card-head">
          <span class="accent-bar" :style="{ background: moduleColor('home', themeStore.dark) }"></span>
          <h2>动态流</h2>
          <NTag size="small" :bordered="false" class="mono">最近操作</NTag>
        </header>
        <div class="cap-body">
          <div v-if="activityFeed.length" class="activity-list">
            <div v-for="(a, i) in activityFeed" :key="i" class="activity-item">
              <span class="mono activity-at">{{ a.at }}</span>
              <span>{{ a.text }}</span>
            </div>
          </div>
          <EmptyState v-else text="暂无动态，执行智能层操作后自动记录" />
        </div>
      </section>
    </div>

    <!-- F-SYS-05 全局搜索（支持 type:/tag:/date: 语法） -->
    <section class="wb-card global-search-card" style="margin-bottom: 16px">
      <header class="card-head">
        <span class="accent-bar" :style="{ background: moduleColor('knowledge', themeStore.dark) }"></span>
        <h2>全局搜索</h2>
        <NTag size="small" :bordered="false" type="info" class="mono">type:task · tag:vue · date:2026-09-01</NTag>
      </header>
      <div class="cap-body">
        <div class="search-bar">
          <NInput v-model:value="searchQuery" size="small" placeholder="跨任务 / 笔记 / 踩坑 / 片段 / 截止检索，支持 type: / tag: / date: 语法" @keyup.enter="recordSearch" clearable />
        </div>
        <div v-if="searchResults.length" class="search-results">
          <div v-for="(r, i) in searchResults" :key="i" class="ai-result-item">
            <span class="rule-tag mono">{{ r.type }}</span>
            <div class="rule-meta">
              <div class="rule-name">{{ r.title }}</div>
              <div class="rule-detail">{{ r.meta }}</div>
            </div>
          </div>
        </div>
        <EmptyState v-else-if="searchQuery.trim()" text="无匹配结果" />
      </div>
    </section>

    <!-- 模块入口 -->
    <section class="wb-card modules-card">
      <header class="card-head">
        <span class="accent-bar" :style="{ background: moduleColor('home', themeStore.dark) }"></span>
        <h2>模块导航</h2>
      </header>
      <div class="module-grid">
        <button v-for="m in modules" :key="m.key" class="module-entry" @click="go(m.path)">
          <span class="module-dot" :style="{ background: moduleColor(m.key, themeStore.dark) }"></span>
          <span class="me-name">{{ m.label }}</span>
          <span class="me-code mono">{{ m.name }}</span>
        </button>
      </div>
    </section>

    
  </div>
</template>

<style scoped>
.plugin-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; }
.plugin-card pre.plugin-content { white-space: pre-wrap; font-family: var(--wb-mono, monospace); font-size: 12.5px; color: var(--wb-text-2); margin: 0; }
.section-grid {
  display: grid;
  grid-template-columns: 1fr 1.4fr;
  gap: 16px;
  margin-bottom: 16px;
}
.card-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--wb-border);
}
.card-head h2 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  flex: 1;
}
.focus-list {
  padding: 6px 12px 12px;
}
.focus-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 4px;
  border-bottom: 1px dashed var(--wb-border);
}
.focus-item:last-child {
  border-bottom: none;
}
.focus-title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.card-foot {
  padding: 0 14px 12px;
}
.stats-card {
  min-height: 260px;
}
.load-strip {
  margin: 12px 14px 0;
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--wb-card-alt);
  color: var(--wb-text-2);
  font-size: 12.5px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.load-strip::before {
  content: '';
  width: 10px;
  height: 10px;
  border-radius: 50%;
  border: 2px solid var(--wb-border);
  border-top-color: var(--wb-accent);
  animation: wb-spin 0.8s linear infinite;
  flex: none;
}
@keyframes wb-spin {
  to { transform: rotate(360deg); }
}
.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
  padding: 14px;
}
@media (max-width: 1100px) {
  .section-grid {
    grid-template-columns: 1fr;
  }
  .stats-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}
.modules-card {
  margin-bottom: 4px;
}
.module-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 10px;
  padding: 14px;
}
.module-entry {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 11px 12px;
  border: 1px solid var(--wb-border);
  border-radius: var(--wb-radius-md);
  background: transparent;
  cursor: pointer;
  font-family: var(--wb-font);
  color: var(--wb-text-1);
  transition: border-color 120ms ease-out, background-color 120ms ease-out;
  text-align: left;
}
.module-entry:hover {
  border-color: var(--wb-text-3);
  background: var(--wb-card-alt);
}
.me-name {
  font-size: 13px;
  font-weight: 550;
  flex: 1;
}
.me-code {
  font-size: 10.5px;
  color: var(--wb-text-3);
  letter-spacing: 0.05em;
}
.alerts {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.onboard-card {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 16px;
  border: 1px solid color-mix(in srgb, var(--wb-primary) 45%, transparent);
  background: color-mix(in srgb, var(--wb-primary) 10%, transparent);
  border-radius: var(--wb-radius-md);
}
.onboard-title {
  font-weight: 650;
  font-size: 13px;
  color: var(--wb-primary);
  white-space: nowrap;
}
.onboard-body {
  flex: 1;
  font-size: 12px;
  line-height: 1.6;
  color: var(--wb-text-2);
}
.ai-exec-grid {
  display: grid;
  grid-template-columns: 1.4fr 1fr;
  gap: 16px;
}
@media (max-width: 1100px) {
  .ai-exec-grid { grid-template-columns: 1fr; }
}
.rule-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.rule-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border: 1px solid var(--wb-border);
  border-radius: var(--wb-radius-sm);
  background: var(--wb-card-alt);
}
.rule-tag {
  flex: none;
  font-size: 10.5px;
  padding: 2px 7px;
  border-radius: var(--wb-radius-sm);
  background: color-mix(in srgb, var(--wb-primary) 16%, transparent);
  color: var(--wb-primary);
}
.rule-meta {
  flex: 1;
  min-width: 0;
}
.rule-name {
  font-size: 12.5px;
  font-weight: 600;
}
.rule-detail {
  font-size: 11px;
  color: var(--wb-text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rule-empty {
  font-size: 12px;
  color: var(--wb-text-3);
  padding: 6px 2px;
}
.insight-list {
  margin-top: 12px;
  border-top: 1px dashed var(--wb-border);
  padding-top: 10px;
}
.insight-title {
  font-size: 12px;
  font-weight: 650;
  color: var(--wb-text-2);
  margin-bottom: 6px;
}
.insight-item {
  font-size: 12px;
  line-height: 1.7;
  color: var(--wb-text-2);
}
.report-actions {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}
.report-preview {
  margin-top: 12px;
  max-height: 220px;
  overflow: auto;
  font-size: 11.5px;
  line-height: 1.6;
  padding: 10px 12px;
  background: var(--wb-card-alt);
  border: 1px solid var(--wb-border);
  border-radius: var(--wb-radius-sm);
  white-space: pre-wrap;
  word-break: break-all;
  color: var(--wb-text-2);
}
.cap-grid {
  grid-template-columns: 1.4fr 1fr;
}
.cap-body {
  padding: 12px 14px;
  min-height: 120px;
}
.backup-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.backup-guard {
  display: flex; align-items: center; gap: 8px;
  background: color-mix(in srgb, var(--wb-warning) 14%, transparent);
  border: 1px solid color-mix(in srgb, var(--wb-warning) 60%, transparent);
  color: var(--wb-warning);
  border-radius: var(--wb-radius-md);
  padding: 8px 12px;
  margin-bottom: 10px;
  font-size: 12px;
}
.bg-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--wb-warning); flex: none; }
.backup-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 8px;
  border: 1px solid var(--wb-border);
  border-radius: var(--wb-radius-md);
}
.backup-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
}
.backup-meta {
  color: var(--wb-text-3);
  font-size: 11px;
}
.llm-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}
.llm-provider {
  font-size: 13px;
  color: var(--wb-text-1);
}
.llm-tip {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--wb-text-3);
}
.ai-switches {
  margin-top: 14px;
  border-top: 1px dashed var(--wb-border);
  padding-top: 12px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px 16px;
}
@media (max-width: 900px) {
  .ai-switches { grid-template-columns: 1fr; }
}
.ai-switch {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 7px 10px;
  border-radius: var(--wb-radius-sm);
  background: var(--wb-card-alt);
}
.ai-name { font-size: 12.5px; font-weight: 600; }
.ai-desc { font-size: 11px; color: var(--wb-text-3); }
@media (max-width: 1100px) {
  .cap-grid {
    grid-template-columns: 1fr;
  }
}
/* 智能层执行面板 */
.ai-panel .cap-body { display: flex; flex-direction: column; gap: 10px; }
.ai-exec-bar { display: flex; gap: 8px; }
.ai-exec-bar .n-input { flex: 1; }
.ai-exec-result { padding: 10px; border-radius: var(--wb-radius-sm); background: var(--wb-card-alt); }
.gen-preview pre { white-space: pre-wrap; font-family: var(--wb-mono, monospace); font-size: 12px; color: var(--wb-text-2); margin: 0; }
.ai-result-list { display: flex; flex-direction: column; gap: 6px; margin-top: 6px; }
.ai-result-item { display: flex; align-items: flex-start; gap: 8px; padding: 6px 8px; border-radius: var(--wb-radius-sm); background: var(--wb-card); }
.ai-result-item .rule-tag { flex-shrink: 0; margin-top: 2px; }
.ai-result-item .rule-meta { flex: 1; min-width: 0; }
.ai-proactive { display: flex; flex-wrap: wrap; gap: 8px 18px; }
.proactive-row { display: flex; align-items: center; gap: 8px; font-size: 12px; }
.proactive-hint { color: var(--wb-text-3); font-size: 11.5px; }
/* 7 日趋势 */
.trend-bars { display: flex; align-items: flex-end; gap: 10px; height: 110px; padding-top: 6px; }
.trend-col { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 6px; }
.trend-bar-wrap { display: flex; align-items: flex-end; gap: 3px; height: 88px; }
.trend-bar { width: 12px; border-radius: 4px 4px 0 0; background: var(--wb-accent-dev, #3b82f6); min-height: 4px; }
.trend-bar.second { background: var(--wb-accent-life, #22c55e); }
.trend-label { font-size: 10.5px; color: var(--wb-text-3); }
/* 动态流 */
.activity-list { display: flex; flex-direction: column; gap: 5px; }
.activity-item { display: flex; gap: 10px; font-size: 12.5px; padding: 5px 8px; border-radius: var(--wb-radius-sm); background: var(--wb-card); }
.activity-at { color: var(--wb-text-3); font-size: 11px; flex-shrink: 0; }
/* 全局搜索 */
.search-bar .n-input { width: 100%; }
.search-results { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; }
/* 卡片隐藏 */
.stats-tools { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 10px 16px; border-top: 1px solid var(--wb-border); }
.stats-hint { font-size: 11px; color: var(--wb-text-3); margin-right: 4px; }
.stat-toggle { font-size: 11px; padding: 2px 8px; border-radius: 10px; background: var(--wb-card-alt); cursor: pointer; user-select: none; }
.stat-toggle.off { opacity: 0.45; text-decoration: line-through; }
</style>
