<script setup lang="ts">
import { onMounted, ref, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { NButton, NIcon, NTag, NInput, useMessage } from 'naive-ui'
import { ArrowRight, Bulb } from '@vicons/tabler'
import EmptyState from '@/components/EmptyState.vue'
import { refreshTick, settingsOpen, settingsTab } from '@/stores/ui'
import { useThemeStore } from '@/stores/theme'
import { moduleColor } from '@/theme/tokens'
import {
  tasksRepo, deadlinesRepo, habitsRepo, habitLogsRepo, ledgerRepo,
  coursesRepo, assignmentsRepo, pomodorosRepo, notesRepo, pitfallsRepo, snippetsRepo,
  inspirationsRepo,
} from '@/db'
import {
  aiQa, aiSemanticSearch, aiAutoClassify, aiDedupe, aiAutoTag, aiSuggest, type AiEngineResult,
} from '@/composables/aiEngine'
import { llmConfigured, llmConfigLabel } from '@/composables/llmClient'
import { parseInspiration } from '@/composables/inspiration'
import type {
  Task, Deadline, Habit, HabitLog, LedgerEntry, Course, Assignment, Pomodoro,
  Note, Pitfall, Snippet, Inspiration,
} from '../../drizzle/schema'

const router = useRouter()
const themeStore = useThemeStore()
const message = useMessage()

// ============================================================
// 日期工具（本地时区，避免 toISOString 的 UTC 偏移）
// ============================================================
function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
function shiftDay(base: Date, delta: number): Date {
  const d = new Date(base)
  d.setDate(d.getDate() + delta)
  return d
}
const today = new Date()
const todayStr = dayKey(today)
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
const todayLabel = `${todayStr} ${WEEKDAYS[today.getDay()]}`
// 本周一 / 上周一 ~ 上周日（周一为一周起点）
const mondayDow = today.getDay() === 0 ? 7 : today.getDay()
const thisMonday = dayKey(shiftDay(today, -(mondayDow - 1)))
const lastMonday = dayKey(shiftDay(today, -(mondayDow - 1 + 7)))
const lastSunday = dayKey(shiftDay(today, -mondayDow))
const thisMonthKey = monthKey(today)
const lastMonthDate = new Date(today.getFullYear(), today.getMonth() - 1, 1)
const lastMonthKey = monthKey(lastMonthDate)

function toEpoch(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null
  const t = new Date(`${dateStr}T00:00:00`).getTime()
  return Number.isNaN(t) ? null : t
}

// ============================================================
// 数据装载（全部走现有 repo；浏览器 dev 无 Tauri 时 invoke 抛错 → 静默降级为空数据）
// ============================================================
const loading = ref(false)
const allTasks = ref<Task[]>([])
const allDeadlines = ref<Deadline[]>([])
const allHabits = ref<Habit[]>([])
const allHabitLogs = ref<HabitLog[]>([])
const allLedger = ref<LedgerEntry[]>([])
const allCourses = ref<Course[]>([])
const allAssignments = ref<Assignment[]>([])
const allPomodoros = ref<Pomodoro[]>([])
const allNotes = ref<Note[]>([])
const allPitfalls = ref<Pitfall[]>([])
const allSnippets = ref<Snippet[]>([])
const allInspirations = ref<Inspiration[]>([])

async function load() {
  loading.value = true
  try {
    const [tasks, deadlines, habits, habitLogs, ledger, courses, assignments, pomodoros, notes, pitfalls, snippets, inspirations] =
      await Promise.all([
        tasksRepo.listAll(), deadlinesRepo.listAll(), habitsRepo.listAll(),
        habitLogsRepo.listAll(), ledgerRepo.listAll(), coursesRepo.listAll(),
        assignmentsRepo.listAll(), pomodorosRepo.listAll(), notesRepo.listAll(),
        pitfallsRepo.listAll(), snippetsRepo.listAll(), inspirationsRepo.list(),
      ])
    allTasks.value = tasks
    allDeadlines.value = deadlines
    allHabits.value = habits
    allHabitLogs.value = habitLogs
    allLedger.value = ledger
    allCourses.value = courses
    allAssignments.value = assignments
    allPomodoros.value = pomodoros
    allNotes.value = notes
    allPitfalls.value = pitfalls
    allSnippets.value = snippets
    allInspirations.value = inspirations
  } catch (e) {
    console.warn('[Home] 数据加载失败（浏览器降级）', e)
  }
  loading.value = false
}

watch(refreshTick, () => { load() })
onMounted(() => {
  load()
  initFirstRun()
})

function go(path: string) {
  router.push(path)
}

// ============================================================
// ① 今日焦点：逾期任务 + 今日到期（任务/截止）+ 今日应做（focusDate=今天）
// ============================================================
const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 }

const openTasks = computed(() => allTasks.value.filter((t) => t.status !== 'done'))
const overdueTasks = computed(() =>
  openTasks.value.filter((t) => t.dueDate && t.dueDate < todayStr)
    .sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || '')))
const todayDueTasks = computed(() =>
  openTasks.value.filter((t) => t.dueDate === todayStr))
const focusTasks = computed(() =>
  openTasks.value.filter((t) => t.focusDate === todayStr))
const todayDeadlines = computed(() =>
  allDeadlines.value.filter((d) => d.status === 'open' && d.dueDate === todayStr))

type FocusRow =
  | { uid: string; kind: 'task'; ref: Task; tag: string; title: string; note?: string; jump: string }
  | { uid: string; kind: 'deadline'; ref: Deadline; tag: string; title: string; jump: string }

const focusRows = computed<FocusRow[]>(() => {
  const seen = new Set<string>()
  const rows: FocusRow[] = []
  const pushTask = (t: Task, note?: string) => {
    const uid = `task-${t.id}`
    if (seen.has(uid)) return
    seen.add(uid)
    rows.push({ uid, kind: 'task', ref: t, tag: t.scope || 'dev', title: t.title, note, jump: scopePath(t.scope) })
  }
  for (const t of overdueTasks.value) pushTask(t, `逾期 ${t.dueDate}`)
  for (const t of todayDueTasks.value) pushTask(t, '今日到期')
  for (const t of focusTasks.value) pushTask(t)
  for (const d of todayDeadlines.value) {
    rows.push({ uid: `deadline-${d.id}`, kind: 'deadline', ref: d, tag: d.source || '截止', title: d.title, jump: deadlinePath(d.source) })
  }
  // 逾期组保持按逾期时长排前；其余按优先级排
  const over = rows.filter((r) => r.kind === 'task' && r.note && r.note.startsWith('逾期'))
  const rest = rows.filter((r) => !over.includes(r))
  rest.sort((a, b) => {
    const pa = a.kind === 'task' ? (PRIORITY_RANK[a.ref.priority] ?? 2) : 1
    const pb = b.kind === 'task' ? (PRIORITY_RANK[b.ref.priority] ?? 2) : 1
    return pa - pb
  })
  return [...over, ...rest]
})

// ============================================================
// ①-b 灵感展示：最近 7 天的灵感（最多 6 条），点击跳灵感页
// ============================================================
const INSPIR_LIMIT = 6
const recentInspirations = computed(() => {
  const weekAgo = dayKey(shiftDay(today, -7))
  return allInspirations.value
    .filter((i) => {
      const d = (i.createdAt || '').slice(0, 10)
      return !d || d >= weekAgo
    })
    .slice(0, INSPIR_LIMIT)
})
function inspTime(i: Inspiration): string {
  const t = (i.createdAt || '').trim()
  if (!t) return ''
  // createdAt 形如 2025-01-02 13:04:05，同日只显示时分
  const [d, hm] = t.split(' ')
  const time = (hm || '').slice(0, 5)
  if (d === todayStr) return `今天 ${time}`
  return `${(d || '').slice(5)} ${time}`
}
function inspTags(i: Inspiration): string[] {
  return (i.tags || '').split(',').map((s) => s.trim()).filter(Boolean)
}

function scopePath(scope?: string | null): string {
  return scope === 'study' ? '/study' : scope === 'life' ? '/life' : '/dev'
}
function deadlinePath(source?: string | null): string {
  if (source === 'assignment' || source === 'course') return '/study'
  if (source === 'server' || source === 'domain' || source === 'ssl') return '/ops'
  return '/life'
}

async function completeTask(t: Task) {
  try {
    await tasksRepo.update(t.id, { status: 'done' })
    t.status = 'done'
    message.success('已完成')
  } catch {
    message.error('更新失败：数据层不可用')
  }
}
async function closeDeadline(d: Deadline) {
  try {
    await deadlinesRepo.update(d.id, { status: 'closed' })
    await load()
    message.success('截止事项已关闭')
  } catch {
    message.error('操作失败：数据层不可用')
  }
}

// ============================================================
// ② 截止预警：未来 7 天（任务 dueDate / 截止表 / 作业）按天分组倒计时
// ============================================================
type WatchKind = 'task' | 'deadline' | 'assignment'
interface WatchItem { uid: string; kind: WatchKind; title: string; tag: string; jump: string }

const watchGroups = computed(() => {
  const map = new Map<string, WatchItem[]>()
  const add = (date: string, item: WatchItem) => {
    if (!map.has(date)) map.set(date, [])
    map.get(date)!.push(item)
  }
  const d7 = dayKey(shiftDay(today, 7))
  for (const t of openTasks.value) {
    if (t.dueDate && t.dueDate > todayStr && t.dueDate <= d7)
      add(t.dueDate, { uid: `t-${t.id}`, kind: 'task', title: t.title, tag: t.scope || 'dev', jump: scopePath(t.scope) })
  }
  for (const d of allDeadlines.value) {
    if (d.status === 'open' && d.dueDate > todayStr && d.dueDate <= d7)
      add(d.dueDate, { uid: `d-${d.id}`, kind: 'deadline', title: d.title, tag: d.source || '截止', jump: deadlinePath(d.source) })
  }
  for (const a of allAssignments.value) {
    if (a.status !== 'submitted' && a.dueDate && a.dueDate > todayStr && a.dueDate <= d7)
      add(a.dueDate, { uid: `a-${a.id}`, kind: 'assignment', title: a.title, tag: '作业', jump: '/study' })
  }
  const out: { date: string; label: string; countdown: string; days: number; items: WatchItem[] }[] = []
  for (const [date, items] of [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const diff = Math.round(((toEpoch(date) ?? 0) - (toEpoch(todayStr) ?? 0)) / 86400000)
    const md = date.slice(5)
    const label = diff === 1 ? `明天 · ${md}` : diff === 2 ? `后天 · ${md}` : `${md}（${WEEKDAYS[new Date(date + 'T00:00:00').getDay()]}）`
    out.push({ date, label, countdown: `${diff} 天后`, days: diff, items })
  }
  return out
})

// ============================================================
// ③ 进度卡：习惯 / 记账 / 学习 / 任务
// ============================================================
const habitToday = computed(() => {
  const total = allHabits.value.length
  const loggedToday = new Set(allHabitLogs.value.filter((l) => l.date === todayStr).map((l) => l.habitId))
  return { total, done: total ? allHabits.value.filter((h) => loggedToday.has(h.id)).length : 0 }
})
const habitWeekStreak = computed(() => {
  // 本周内连续打卡天数（按全体习惯的打卡日期去重计，截至今天/昨天起算）
  const days = new Set(allHabitLogs.value.map((l) => l.date))
  let streak = 0
  let cursor = days.has(todayStr) ? today : shiftDay(today, -1)
  const monday = new Date(`${thisMonday}T00:00:00`)
  while (cursor >= monday && days.has(dayKey(cursor))) {
    streak += 1
    cursor = shiftDay(cursor, -1)
  }
  return streak
})

const ledgerThisMonth = computed(() => {
  let spend = 0
  let income = 0
  for (const l of allLedger.value) {
    const d = (l.date || '').slice(0, 7)
    if (d === thisMonthKey) {
      if (l.type === 'expense') spend += Number(l.amount) || 0
      else income += Number(l.amount) || 0
    }
  }
  return { spend, income }
})
const ledgerDelta = computed(() => {
  let prev = 0
  for (const l of allLedger.value) {
    if ((l.date || '').slice(0, 7) === lastMonthKey && l.type === 'expense') prev += Number(l.amount) || 0
  }
  if (prev <= 0) return null
  return ((ledgerThisMonth.value.spend - prev) / prev) * 100
})

const studyProgress = computed(() => ({
  pendingAssignments: allAssignments.value.filter((a) => a.status !== 'submitted').length,
  activeCourses: allCourses.value.length,
}))

const taskWeek = computed(() => {
  const doneAt = (t: Task) => {
    const stamp = t.updatedAt || t.createdAt || ''
    return stamp.slice(0, 10)
  }
  let thisWeek = 0
  let lastWeek = 0
  for (const t of allTasks.value) {
    if (t.status !== 'done') continue
    const d = doneAt(t)
    if (d >= thisMonday && d <= todayStr) thisWeek += 1
    else if (d >= lastMonday && d <= lastSunday) lastWeek += 1
  }
  return { thisWeek, lastWeek }
})

// ============================================================
// ④ 趋势小图（纯 SVG）
//   近 14 天：习惯打卡（habitLogs.date）+ 完成番茄（pomodoros.startedAt 前 10 位）
//   注：tasks 表没有可靠的完成时间字段（updatedAt 会被任意编辑污染），不作数据源
//   近 6 月支出：ledger.date 按 yyyy-MM 汇总
// ============================================================
const trend14 = computed(() => {
  const days: { date: string; habits: number; pomos: number }[] = []
  for (let i = 13; i >= 0; i--) {
    const d = shiftDay(today, -i)
    const key = dayKey(d)
    days.push({
      date: key,
      habits: allHabitLogs.value.filter((l) => l.date === key).length,
      pomos: allPomodoros.value.filter((p) => p.completed === 1 && (p.startedAt || '').slice(0, 10) === key).length,
    })
  }
  return days
})
const trend14Max = computed(() => Math.max(1, ...trend14.value.map((d) => Math.max(d.habits, d.pomos))))
const trend14Empty = computed(() => trend14.value.every((d) => d.habits === 0 && d.pomos === 0))
const TREND_H = 72

const spend6m = computed(() => {
  const keys: string[] = []
  for (let i = 5; i >= 0; i--) keys.push(monthKey(new Date(today.getFullYear(), today.getMonth() - i, 1)))
  const sums = keys.map(() => 0)
  for (const l of allLedger.value) {
    if (l.type !== 'expense') continue
    const idx = keys.indexOf((l.date || '').slice(0, 7))
    if (idx >= 0) sums[idx] += Number(l.amount) || 0
  }
  return keys.map((k, i) => ({ key: k, value: sums[i] }))
})
const spend6mMax = computed(() => Math.max(1, ...spend6m.value.map((m) => m.value)))
const spend6mEmpty = computed(() => spend6m.value.every((m) => m.value === 0))
const SPARK_W = 260
const SPARK_H = 56
const sparkPoints = computed(() =>
  spend6m.value
    .map((m, i) => `${((i / 5) * SPARK_W).toFixed(1)},${(SPARK_H - 4 - (m.value / spend6mMax.value) * (SPARK_H - 8)).toFixed(1)}`)
    .join(' '),
)

// ============================================================
// ⑤ AI 智能问答（常驻）+ 更多 AI 能力折叠区
// ============================================================
const qaQuestion = ref('')
const qaLoading = ref(false)
const qaResult = ref<AiEngineResult | null>(null)

async function askAi(raw?: string) {
  const q = (raw ?? qaQuestion.value).trim()
  if (!q || qaLoading.value) return
  qaQuestion.value = q
  qaLoading.value = true
  qaResult.value = null
  try {
    qaResult.value = await aiQa(q)
  } catch (e) {
    qaResult.value = { ok: false, kind: 'qa', items: [], summary: '问答执行失败：' + String(e) }
  } finally {
    qaLoading.value = false
  }
}
function askChip(q: string) { askAi(q) }

const AI_MORE: Array<{ label: string; hint: string; run: () => Promise<AiEngineResult> }> = [
  { label: '语义搜索', hint: '跨任务/笔记/踩坑/片段/项目，支持 #tag 与 type: 语法', run: () => aiSemanticSearch(qaQuestion.value) },
  { label: '智能建议', hint: '基于习惯、积压、截止与台账生成建议', run: () => aiSuggest() },
  { label: '去重检测', hint: '识别标题相似的重复条目', run: () => aiDedupe() },
  { label: '自动分类', hint: '为输入文本建议归属模块', run: () => Promise.resolve(aiAutoClassify(qaQuestion.value)) },
  { label: '自动标签', hint: '为输入内容推荐标签', run: () => Promise.resolve(aiAutoTag(qaQuestion.value)) },
]

const moreAiOpen = ref(false)
const moreAiLoading = ref(false)
const moreAiResult = ref<AiEngineResult | null>(null)
async function runMoreAi(item: (typeof AI_MORE)[number]) {
  if (moreAiLoading.value) return
  moreAiLoading.value = true
  moreAiResult.value = null
  try {
    moreAiResult.value = await item.run()
  } catch (e) {
    moreAiResult.value = { ok: false, kind: 'more', items: [], summary: '执行失败：' + String(e) }
  } finally {
    moreAiLoading.value = false
  }
}

function openAiSettings() {
  settingsTab.value = 'ai'
  settingsOpen.value = true
}

// ============================================================
// ⑥ 保留区：首次引导 / 全局搜索 / 灵感快速捕获
// ============================================================
const firstRun = ref(false)
function initFirstRun() {
  try {
    if (!localStorage.getItem('wb:first-run')) {
      firstRun.value = true
      localStorage.setItem('wb:first-run', '1')
    }
  } catch { /* ignore */ }
}
function dismissFirstRun() { firstRun.value = false }

const searchQuery = ref('')
const debouncedQuery = ref('')
let searchTimer: number | undefined
watch(searchQuery, (v) => {
  if (searchTimer !== undefined) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => { debouncedQuery.value = v }, 250) as unknown as number
})
interface SearchHit { type: string; title: string; meta: string; jump: string }
const searchResults = computed<SearchHit[]>(() => {
  const q = debouncedQuery.value.trim()
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
  const out: SearchHit[] = []
  if (!typeFilter || typeFilter === 'task') allTasks.value.filter((t) => hit(`${t.title} ${t.note || ''}`) && (!dateFilter || (t.focusDate ?? '') === dateFilter || (t.dueDate ?? '') === dateFilter)).slice(0, 4).forEach((t) => out.push({ type: '任务', title: t.title, meta: `${t.scope || ''} ${t.status || ''} ${t.dueDate || ''}`, jump: scopePath(t.scope) }))
  if (!typeFilter || typeFilter === 'note') allNotes.value.filter((n) => hit(`${n.title} ${n.content || ''}`) && (!tagFilter || (n.tags ?? '').includes(tagFilter))).slice(0, 3).forEach((n) => out.push({ type: '笔记', title: n.title, meta: n.tags || '未分类', jump: '/knowledge' }))
  if (!typeFilter || typeFilter === 'pitfall') allPitfalls.value.filter((p) => hit(`${p.title} ${p.problem || ''} ${p.solution || ''}`) && (!tagFilter || (p.tags ?? '').includes(tagFilter))).slice(0, 3).forEach((p) => out.push({ type: '踩坑', title: p.title, meta: p.category || '', jump: '/knowledge' }))
  if (!typeFilter || typeFilter === 'snippet') allSnippets.value.filter((s) => hit(`${s.title} ${s.code || ''}`) && (!tagFilter || (s.tags ?? '').includes(tagFilter))).slice(0, 3).forEach((s) => out.push({ type: '片段', title: s.title, meta: s.language || '', jump: '/dev' }))
  if (!typeFilter || typeFilter === 'deadline') allDeadlines.value.filter((d) => hit(d.title) && (!dateFilter || (d.dueDate ?? '') === dateFilter)).slice(0, 3).forEach((d) => out.push({ type: '截止', title: d.title, meta: `${d.dueDate || ''} ${d.status || ''}`, jump: deadlinePath(d.source) }))
  return out.slice(0, 8)
})

const inspInput = ref('')
async function saveInspiration() {
  const raw = inspInput.value.trim()
  if (!raw) return
  const { content, tags } = parseInspiration(raw)
  if (!content && !tags) return
  try {
    await inspirationsRepo.insert({ content: content || raw, tags: tags || null })
    inspInput.value = ''
    message.success('灵感已捕获')
  } catch {
    message.error('记录失败：数据层不可用')
  }
}
</script>

<template>
  <div class="dash">

    <!-- 首次引导（保留 wb:first-run 逻辑） -->
    <div v-if="firstRun" class="onboard">
      <span class="ob-title">欢迎使用 WORKBENCH</span>
      <span class="ob-body">
        <span class="mono">Ctrl/Cmd + K</span> 命令面板 ·<span class="mono"> Ctrl/Cmd + 1..8</span> 切换模块 ·
        顶栏灯泡可快速记灵感。先在任务板 / 习惯 / 记账里录入数据，本页即为你的驾驶舱。
      </span>
      <NButton size="tiny" type="primary" ghost @click="dismissFirstRun()">我知道了</NButton>
    </div>

    <!-- 快速条：全局搜索 + 灵感捕获 -->
    <div class="quick-strip">
      <div class="qs-search">
        <NInput
          v-model:value="searchQuery"
          size="small"
          placeholder="全局搜索：任务 / 笔记 / 踩坑 / 片段 / 截止，支持 type: · tag: · date: 语法"
          clearable
        />
        <div v-if="searchResults.length" class="qs-results">
          <div v-for="(r, i) in searchResults" :key="i" class="qs-item clickable" @click="go(r.jump)">
            <span class="qs-type mono">{{ r.type }}</span>
            <span class="qs-title">{{ r.title }}</span>
            <span class="qs-meta mono">{{ r.meta }}</span>
          </div>
        </div>
      </div>
      <div class="qs-insp">
        <NInput
          v-model:value="inspInput"
          size="small"
          placeholder="灵感速记… 支持 #标签"
          @keyup.enter="saveInspiration()"
        >
          <template #prefix><NIcon :component="Bulb" /></template>
        </NInput>
        <NButton size="small" quaternary @click="go('/inspiration')" title="灵感列表">
          <template #icon><NIcon :component="ArrowRight" /></template>
        </NButton>
      </div>
    </div>

    <!-- 第一屏：今日焦点 + 灵感（左，最大权重）｜ 右侧：AI 问答 + 截止预警 -->
    <div class="top-grid">
      <div class="top-left">
      <section class="wb-card focus-card">
        <header class="card-head">
          <span class="accent-bar" :style="{ background: moduleColor('home', themeStore.dark) }"></span>
          <h2>今日焦点</h2>
          <span class="mono head-meta">{{ todayLabel }}</span>
        </header>
        <div v-if="loading" class="load-strip">数据加载中…</div>
        <div v-else-if="focusRows.length" class="focus-list">
          <div v-for="row in focusRows" :key="row.uid" class="focus-item">
            <button
              v-if="row.kind === 'task'"
              class="chk"
              title="勾选完成"
              @click.stop="completeTask(row.ref)"
            >✓</button>
            <button
              v-else
              class="chk"
              title="标记已处理并关闭"
              @click.stop="closeDeadline(row.ref)"
            >✓</button>
            <span class="clickable focus-main" @click="go(row.jump)">
              <span class="f-tag mono" :style="{ color: moduleColor(row.kind === 'task' ? (row.ref.scope === 'study' ? 'study' : row.ref.scope === 'life' ? 'life' : 'dev') : 'ops', themeStore.dark) }">{{ row.tag }}</span>
              <span class="f-title">{{ row.title }}</span>
              <span v-if="row.kind === 'task' && row.note" class="f-due mono" :class="{ danger: row.note.startsWith('逾期') }">{{ row.note }}</span>
            </span>
          </div>
        </div>
        <div v-else class="focus-empty">
          <EmptyState text="今天没有到期事项" />
          <NButton size="tiny" text type="primary" @click="go('/dev')">去任务板看看 <template #icon><NIcon :component="ArrowRight" /></template></NButton>
        </div>
      </section>

      <!-- 灵感：最近记录（点击跳灵感页） -->
      <section class="wb-card insp-card">
        <header class="card-head">
          <span class="accent-bar" :style="{ background: moduleColor('inspiration', themeStore.dark) }"></span>
          <h2>灵感</h2>
          <span class="mono head-meta">近 7 天 · {{ recentInspirations.length }}</span>
          <NButton size="tiny" text type="primary" class="insp-all" @click="go('/inspiration')">全部 <template #icon><NIcon :component="ArrowRight" /></template></NButton>
        </header>
        <div v-if="recentInspirations.length" class="insp-list">
          <div
            v-for="i in recentInspirations"
            :key="i.id"
            class="insp-item clickable"
            :title="i.content"
            @click="go('/inspiration')"
          >
            <NIcon class="insp-icon" :component="Bulb" :style="{ color: moduleColor('inspiration', themeStore.dark) }" />
            <span class="insp-body">
              <span class="insp-text">{{ i.content }}</span>
              <span v-if="inspTags(i).length" class="insp-tags mono">{{ inspTags(i).map((t) => '#' + t).join(' ') }}</span>
            </span>
            <span class="insp-time mono">{{ inspTime(i) }}</span>
          </div>
        </div>
        <div v-else class="insp-empty">
          <EmptyState text="最近 7 天还没有灵感" />
          <span class="insp-empty-tip">点击顶栏 <NIcon :component="Bulb" class="tip-bulb" /> 灯泡，或上方速记框，随时记录一闪而过的想法</span>
        </div>
      </section>
      </div>

      <div class="top-right">
        <!-- AI 智能问答（常驻） -->
        <section class="wb-card qa-card">
          <header class="card-head">
            <span class="accent-bar" :style="{ background: moduleColor('knowledge', themeStore.dark) }"></span>
            <h2>AI 问答</h2>
            <span v-if="llmConfigured()" class="ai-chip mono">{{ llmConfigLabel() }}</span>
            <span v-else class="ai-chip fallback">本地检索</span>
          </header>
          <div class="qa-body">
            <div class="qa-bar">
              <NInput
                v-model:value="qaQuestion"
                size="small"
                :placeholder="llmConfigured() ? '向工作台提问，回车发送' : '未配置 AI：问题将检索本地笔记 / 踩坑 / 片段'"
                @keyup.enter="askAi()"
              />
              <NButton size="small" type="primary" :loading="qaLoading" @click="askAi()">发送</NButton>
            </div>
            <div class="qa-chips">
              <button v-for="c in ['今天做什么', '帮我总结本周', '有什么可以归档']" :key="c" class="chip" :disabled="qaLoading" @click="askChip(c)">{{ c }}</button>
              <NButton v-if="!llmConfigured()" size="tiny" type="primary" ghost class="cfg-btn" @click="openAiSettings()">配置 AI 服务</NButton>
            </div>
            <div v-if="qaResult" class="ai-result">
              <div class="ai-summary">{{ qaResult.summary }}</div>
              <div v-for="(it, i) in qaResult.items.slice(0, 4)" :key="i" class="ai-item">
                <div class="ai-item-title">{{ it.title }}</div>
                <div class="ai-item-meta">{{ it.meta }}</div>
              </div>
            </div>
            <div class="qa-more">
              <button class="more-toggle mono" @click="moreAiOpen = !moreAiOpen">{{ moreAiOpen ? '▾' : '▸' }} 更多 AI 能力</button>
              <div v-if="moreAiOpen" class="more-panel">
                <button v-for="item in AI_MORE" :key="item.label" class="more-btn" :disabled="moreAiLoading" :title="item.hint" @click="runMoreAi(item)">{{ item.label }}</button>
                <div v-if="moreAiResult" class="ai-result">
                  <div class="ai-summary">{{ moreAiResult.summary }}</div>
                  <div v-for="(it, i) in moreAiResult.items.slice(0, 4)" :key="i" class="ai-item">
                    <div class="ai-item-title">{{ it.title }}</div>
                    <div class="ai-item-meta">{{ it.meta }}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <!-- 截止预警 -->
        <section class="wb-card watch-card">
          <header class="card-head">
            <span class="accent-bar" :style="{ background: moduleColor('ops', themeStore.dark) }"></span>
            <h2>截止预警 · 未来 7 天</h2>
            <span class="mono head-meta">{{ watchGroups.length }} 天</span>
          </header>
          <div v-if="watchGroups.length" class="watch-list">
            <div v-for="g in watchGroups" :key="g.date" class="watch-group">
              <div class="wg-head clickable" @click="go('/dev')">
                <span class="wg-label">{{ g.label }}</span>
                <span class="wg-count mono">{{ g.countdown }} · {{ g.items.length }} 项</span>
              </div>
              <div v-for="it in g.items" :key="it.uid" class="wg-item clickable" @click="go(it.jump)">
                <span class="f-tag mono">{{ it.kind === 'assignment' ? '作业' : it.tag }}</span>
                <span class="f-title">{{ it.title }}</span>
              </div>
            </div>
          </div>
          <EmptyState v-else text="未来 7 天没有到期事项" />
        </section>
      </div>
    </div>

    <!-- 进度条区：一行四卡，均可点击跳转 -->
    <div class="prog-grid">
      <div class="wb-card hoverable prog-card clickable" @click="go('/life')">
        <div class="pg-label">习惯 · 今日</div>
        <div class="pg-value mono" :style="{ color: moduleColor('life', themeStore.dark) }">
          {{ habitToday.done }}<span class="pg-suffix">/{{ habitToday.total }}</span>
        </div>
        <div class="pg-sub">已打卡 · 本周连续 {{ habitWeekStreak }} 天</div>
        <div class="pg-bar"><div class="pg-bar-fill" :style="{ width: (habitToday.total ? habitToday.done / habitToday.total * 100 : 0) + '%', background: 'var(--wb-module-life)' }"></div></div>
      </div>

      <div class="wb-card hoverable prog-card clickable" @click="go('/life')">
        <div class="pg-label">记账 · 本月</div>
        <div class="pg-value mono" :style="{ color: moduleColor('ops', themeStore.dark) }">¥{{ ledgerThisMonth.spend.toFixed(0) }}</div>
        <div class="pg-sub">
          支出 / 收入 ¥{{ ledgerThisMonth.income.toFixed(0) }}
          <span v-if="ledgerDelta !== null" :class="ledgerDelta > 0 ? 'delta up' : 'delta down'">{{ ledgerDelta > 0 ? '↑' : '↓' }}{{ Math.abs(ledgerDelta).toFixed(0) }}%</span>
          <span v-else class="delta flat">— 上月无数据</span>
        </div>
      </div>

      <div class="wb-card hoverable prog-card clickable" @click="go('/study')">
        <div class="pg-label">学习</div>
        <div class="pg-value mono" :style="{ color: moduleColor('study', themeStore.dark) }">
          {{ studyProgress.pendingAssignments }}<span class="pg-suffix"> 待完成</span>
        </div>
        <div class="pg-sub">作业 · 课程进行中 {{ studyProgress.activeCourses }} 门</div>
      </div>

      <div class="wb-card hoverable prog-card clickable" @click="go('/dev')">
        <div class="pg-label">任务 · 本周完成</div>
        <div class="pg-value mono" :style="{ color: moduleColor('dev', themeStore.dark) }">{{ taskWeek.thisWeek }}</div>
        <div class="pg-sub">
          上周 {{ taskWeek.lastWeek }}
          <span v-if="taskWeek.thisWeek > taskWeek.lastWeek" class="delta up">↑</span>
          <span v-else-if="taskWeek.thisWeek < taskWeek.lastWeek" class="delta down">↓</span>
          <span v-else class="delta flat">=</span>
          <span class="pending">待办 {{ openTasks.length }}</span>
        </div>
      </div>
    </div>

    <!-- 趋势小图（纯 SVG，无新依赖） -->
    <div class="trend-grid">
      <section class="wb-card">
        <header class="card-head">
          <span class="accent-bar" :style="{ background: moduleColor('life', themeStore.dark) }"></span>
          <h2>近 14 天节奏</h2>
          <span class="legend">
            <i class="lg-swatch bar-a"></i>打卡
            <i class="lg-swatch bar-b"></i>番茄
          </span>
        </header>
        <div class="chart-body">
          <svg :viewBox="`0 0 322 ${TREND_H + 16}`" preserveAspectRatio="none" class="chart">
            <template v-for="(d, i) in trend14" :key="d.date">
              <rect
                :x="i * 23 + 5" :width="7" rx="2"
                :y="TREND_H - Math.max(2, d.habits / trend14Max * TREND_H)"
                :height="Math.max(2, d.habits / trend14Max * TREND_H)"
                class="bar-a"><title>{{ d.date }} 打卡 {{ d.habits }}</title></rect>
              <rect
                :x="i * 23 + 13" :width="7" rx="2"
                :y="TREND_H - Math.max(2, d.pomos / trend14Max * TREND_H)"
                :height="Math.max(2, d.pomos / trend14Max * TREND_H)"
                class="bar-b"><title>{{ d.date }} 番茄 {{ d.pomos }}</title></rect>
              <text v-if="i % 3 === 2 || i === 13" :x="i * 23 + 8" :y="TREND_H + 12" class="tick" text-anchor="middle">{{ d.date.slice(8) }}</text>
            </template>
          </svg>
          <div v-if="trend14Empty" class="chart-empty">近 14 天暂无打卡 / 番茄记录</div>
        </div>
      </section>

      <section class="wb-card">
        <header class="card-head">
          <span class="accent-bar" :style="{ background: moduleColor('ops', themeStore.dark) }"></span>
          <h2>近 6 月支出</h2>
          <span class="mono head-meta">峰值 ¥{{ spend6mMax.toFixed(0) }}</span>
        </header>
        <div class="chart-body">
          <svg :viewBox="`0 0 ${SPARK_W} ${SPARK_H}`" preserveAspectRatio="none" class="chart spark">
            <polyline :points="sparkPoints" class="spark-line" />
            <circle
              v-for="(m, i) in spend6m" :key="m.key"
              :cx="(i / 5) * SPARK_W"
              :cy="SPARK_H - 4 - (m.value / spend6mMax) * (SPARK_H - 8)"
              r="2.5" class="spark-dot"
            ><title>{{ m.key }} ¥{{ m.value.toFixed(2) }}</title></circle>
          </svg>
          <div class="spark-axis mono">
            <span v-for="m in spend6m" :key="m.key">{{ m.key.slice(5) }}</span>
          </div>
          <div v-if="spend6mEmpty" class="chart-empty">近 6 个月暂无支出记录</div>
        </div>
      </section>
    </div>

  </div>
</template>

<style scoped>
.dash {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-width: 1280px;
}

/* ---- 首次引导 ---- */
.onboard {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  border: var(--wb-border-w) solid color-mix(in srgb, var(--wb-accent) 45%, transparent);
  background: color-mix(in srgb, var(--wb-accent) 8%, transparent);
  border-radius: var(--wb-radius-md);
}
.ob-title { font-weight: 650; font-size: 13px; color: var(--wb-accent); white-space: nowrap; }
.ob-body { flex: 1; font-size: 12px; line-height: 1.6; color: var(--wb-text-2); }

/* ---- 快速条 ---- */
.quick-strip {
  display: grid;
  grid-template-columns: 1fr 300px;
  gap: 12px;
}
@media (max-width: 960px) { .quick-strip { grid-template-columns: 1fr; } }
.qs-search { position: relative; }
.qs-results {
  position: absolute;
  z-index: 10;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  background: var(--wb-card);
  border: var(--wb-border-w) solid var(--wb-border);
  border-radius: var(--wb-radius-md);
  box-shadow: var(--wb-shadow-hover);
  overflow: hidden;
}
.qs-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 12px;
  border-bottom: 1px dashed var(--wb-border);
}
.qs-item:last-child { border-bottom: none; }
.qs-type {
  flex: none;
  font-size: 10.5px;
  padding: 1px 7px;
  border-radius: var(--wb-radius-sm);
  background: var(--wb-card-alt);
  color: var(--wb-text-2);
}
.qs-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12.5px; }
.qs-meta { font-size: 11px; color: var(--wb-text-3); flex: none; }
.qs-insp { display: flex; gap: 6px; align-items: center; }

.clickable { cursor: pointer; }
.clickable:hover { background: var(--wb-card-alt); }

/* ---- 第一屏 ---- */
.top-grid {
  display: grid;
  grid-template-columns: 1.15fr 1fr;
  gap: 12px;
  align-items: stretch;
}
@media (max-width: 1100px) { .top-grid { grid-template-columns: 1fr; } }
.top-left { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.top-right { display: flex; flex-direction: column; gap: 12px; min-width: 0; }

.card-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 11px 14px;
  border-bottom: 1px solid var(--wb-border);
}
.card-head h2 { margin: 0; font-size: 13.5px; font-weight: 620; flex: 1; }
.head-meta { font-size: 11px; color: var(--wb-text-3); }

/* 今日焦点 */
.focus-list { padding: 4px 10px 8px; }
.focus-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 4px;
  border-bottom: 1px dashed var(--wb-border);
}
.focus-item:last-child { border-bottom: none; }
.focus-main { flex: 1; min-width: 0; display: flex; align-items: center; gap: 10px; border-radius: var(--wb-radius-sm); padding: 2px 4px; }
.chk {
  flex: none;
  width: 20px;
  height: 20px;
  border-radius: var(--wb-radius-sm);
  border: var(--wb-border-w) solid var(--wb-border);
  background: transparent;
  color: transparent;
  cursor: pointer;
  font-size: 12px;
  line-height: 1;
  transition: border-color 120ms ease-out, color 120ms ease-out;
}
.chk:hover { border-color: var(--wb-success); color: var(--wb-success); }
.f-tag { flex: none; font-size: 10.5px; opacity: 0.85; }
.f-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12.5px; }
.f-due { flex: none; font-size: 11px; color: var(--wb-text-3); }
.f-due.danger { color: var(--wb-danger); }
.focus-empty { display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 8px 0 14px; }

/* 灵感卡片 */
.insp-list { padding: 4px 10px 8px; }
.insp-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 7px 4px;
  border-bottom: 1px dashed var(--wb-border);
  border-radius: var(--wb-radius-sm);
}
.insp-item:last-child { border-bottom: none; }
.insp-icon { flex: none; font-size: 14px; margin-top: 2px; }
.insp-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.insp-text { font-size: 12.5px; line-height: 1.5; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.insp-tags { font-size: 10.5px; color: var(--wb-module-inspiration); opacity: 0.9; }
.insp-time { flex: none; font-size: 11px; color: var(--wb-text-3); margin-top: 2px; }
.insp-all { flex: none; }
.insp-empty { display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 8px 0 14px; }
.insp-empty-tip { font-size: 11.5px; color: var(--wb-text-3); display: flex; align-items: center; gap: 4px; }
.tip-bulb { font-size: 13px; color: var(--wb-module-inspiration); vertical-align: -2px; }
.load-strip {
  margin: 12px 14px;
  padding: 10px 12px;
  border-radius: var(--wb-radius-md);
  background: var(--wb-card-alt);
  color: var(--wb-text-2);
  font-size: 12.5px;
}

/* ---- AI 问答 ---- */
.qa-body { padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; }
.qa-bar { display: flex; gap: 8px; }
.qa-chips { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.chip {
  border: var(--wb-border-w) solid var(--wb-border);
  background: transparent;
  color: var(--wb-text-2);
  border-radius: var(--wb-radius-lg);
  padding: 2px 10px;
  font-size: 11.5px;
  cursor: pointer;
  font-family: var(--wb-font);
  transition: border-color 120ms ease-out, color 120ms ease-out;
}
.chip:hover { border-color: var(--wb-accent); color: var(--wb-accent); }
.chip:disabled { opacity: 0.5; cursor: default; }
.ai-chip {
  flex: none;
  font-size: 10.5px;
  padding: 1px 8px;
  border-radius: var(--wb-radius-lg);
  background: color-mix(in srgb, var(--wb-accent) 14%, transparent);
  color: var(--wb-accent);
}
.ai-chip.fallback { background: var(--wb-card-alt); color: var(--wb-text-3); }
.cfg-btn { margin-left: auto; }
.ai-result {
  border-top: 1px dashed var(--wb-border);
  padding-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.ai-summary { font-size: 12px; font-weight: 600; color: var(--wb-text-2); }
.ai-item { padding: 6px 9px; background: var(--wb-card-alt); border-radius: var(--wb-radius-sm); }
.ai-item-title { font-size: 12px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ai-item-meta { font-size: 11px; color: var(--wb-text-3); line-height: 1.5; max-height: 48px; overflow: hidden; }
.qa-more { display: flex; flex-direction: column; }
.more-toggle {
  align-self: flex-start;
  background: transparent;
  border: none;
  color: var(--wb-text-3);
  font-size: 11px;
  cursor: pointer;
  padding: 2px 0;
  font-family: var(--wb-font-mono);
}
.more-toggle:hover { color: var(--wb-accent); }
.more-panel { display: flex; flex-wrap: wrap; gap: 6px; padding: 8px 0 2px; }
.more-btn {
  border: var(--wb-border-w) solid var(--wb-border);
  background: transparent;
  color: var(--wb-text-2);
  border-radius: var(--wb-radius-sm);
  padding: 3px 10px;
  font-size: 11.5px;
  cursor: pointer;
  font-family: var(--wb-font);
}
.more-btn:hover { border-color: var(--wb-accent); color: var(--wb-accent); }
.more-btn:disabled { opacity: 0.5; cursor: default; }
.more-panel .ai-result { width: 100%; }

/* ---- 截止预警 ---- */
.watch-list { padding: 6px 12px 10px; display: flex; flex-direction: column; gap: 4px; }
.wg-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 6px;
  border-radius: var(--wb-radius-sm);
}
.wg-label { font-size: 12px; font-weight: 620; }
.wg-count { font-size: 10.5px; color: var(--wb-text-3); }
.wg-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 6px 4px 14px;
  border-radius: var(--wb-radius-sm);
}

/* ---- 进度卡 ---- */
.prog-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
}
@media (max-width: 1100px) { .prog-grid { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 640px) { .prog-grid { grid-template-columns: 1fr; } }
.prog-card { padding: 12px 14px; display: flex; flex-direction: column; gap: 3px; }
.pg-label { font-size: 11.5px; color: var(--wb-text-3); letter-spacing: 0.04em; }
.pg-value { font-size: 22px; font-weight: 680; line-height: 1.2; }
.pg-suffix { font-size: 12px; font-weight: 500; color: var(--wb-text-3); }
.pg-sub { font-size: 11.5px; color: var(--wb-text-2); display: flex; align-items: center; gap: 6px; }
.pg-bar { height: 4px; border-radius: 2px; background: var(--wb-card-alt); overflow: hidden; margin-top: 6px; }
.pg-bar-fill { height: 100%; border-radius: 2px; transition: width 200ms ease-out; }
.delta { font-size: 11px; font-weight: 650; }
.delta.up { color: var(--wb-danger); }
.delta.down { color: var(--wb-success); }
.delta.flat { color: var(--wb-text-3); }
.pending { margin-left: auto; font-size: 11px; color: var(--wb-text-3); }

/* ---- 趋势 ---- */
.trend-grid {
  display: grid;
  grid-template-columns: 1.5fr 1fr;
  gap: 12px;
}
@media (max-width: 1100px) { .trend-grid { grid-template-columns: 1fr; } }
.chart-body { position: relative; padding: 12px 14px; }
.chart { width: 100%; height: 88px; display: block; }
.chart.spark { height: 56px; }
.bar-a { fill: var(--wb-accent); }
.bar-b { fill: color-mix(in srgb, var(--wb-accent) 32%, transparent); }
.tick { fill: var(--wb-text-3); font-size: 9px; font-family: var(--wb-font-mono); }
.spark-line { fill: none; stroke: var(--wb-accent); stroke-width: 1.5; }
.spark-dot { fill: var(--wb-accent); }
.spark-axis { display: flex; justify-content: space-between; font-size: 10px; color: var(--wb-text-3); padding-top: 4px; }
.chart-empty {
  position: absolute;
  inset: 12px 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: var(--wb-text-3);
  background: color-mix(in srgb, var(--wb-card) 72%, transparent);
  border-radius: var(--wb-radius-sm);
}
.legend { display: flex; align-items: center; gap: 5px; font-size: 10.5px; color: var(--wb-text-3); margin-right: 6px; }
.lg-swatch { width: 8px; height: 8px; border-radius: 2px; display: inline-block; }
.lg-swatch.bar-a { background: var(--wb-accent); }
.lg-swatch.bar-b { background: color-mix(in srgb, var(--wb-accent) 32%, transparent); }
</style>
