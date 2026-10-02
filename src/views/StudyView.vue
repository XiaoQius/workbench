<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { NButton, NTag, NTabs, NTabPane, NIcon, useMessage, NSelect, NDatePicker } from 'naive-ui'
import { Plus, Trash, Check, Checkbox } from '@vicons/tabler'
import PageHeader from '@/components/PageHeader.vue'
import EmptyState from '@/components/EmptyState.vue'
import ModalForm, { type FieldDef } from '@/components/ModalForm.vue'
import { coursesRepo, assignmentsRepo, notesRepo, gradesRepo, flashcardsRepo, pitfallsRepo, readQueueRepo, feynmanLogsRepo, tasksRepo, pomodorosRepo } from '@/db'
import type { Course, Assignment, Note, Grade, Flashcard, Pitfall, ReadQueueItem, FeynmanLog, Task, Pomodoro } from '../../drizzle/schema'

const message = useMessage()
const courses = ref<Course[]>([])
const assignments = ref<Assignment[]>([])
const notes = ref<Note[]>([])
const grades = ref<Grade[]>([])
const cards = ref<Flashcard[]>([])
const studyGoals = ref<Task[]>([])
const focusRecords = ref<Pomodoro[]>([])
const courseFormShow = ref(false)
const assignmentFormShow = ref(false)
const noteFormShow = ref(false)
const gradeFormShow = ref(false)
const cardFormShow = ref(false)
const goalFormShow = ref(false)
const pitfalls = ref<Pitfall[]>([])
const readQueue = ref<ReadQueueItem[]>([])
const feynmanLogs = ref<FeynmanLog[]>([])
const pitfallFormShow = ref(false)
const readFormShow = ref(false)
const feynmanFormShow = ref(false)
const activeNote = ref<Note | null>(null)

const weekdayNames = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
const weekdayMap: Record<string, number> = { 一: 0, 二: 1, 三: 2, 四: 3, 五: 4, 六: 5, 日: 6 }

async function load() {
  try {
    const [cs, as, ns, gs, fcs, ts, ps, pits, rq, fys] = await Promise.all([
      coursesRepo.listAll(), assignmentsRepo.listAll(), notesRepo.listAll(),
      gradesRepo.listAll(), flashcardsRepo.listAll(), tasksRepo.listAll(), pomodorosRepo.listAll(),
      pitfallsRepo.listAll(), readQueueRepo.listAll(), feynmanLogsRepo.listAll(),
    ])
    courses.value = cs
    assignments.value = as
    notes.value = ns
    grades.value = gs
    cards.value = fcs
    studyGoals.value = ts.filter((t) => t.scope === 'study' || t.type === 'study')
    focusRecords.value = ps
    pitfalls.value = pits
    readQueue.value = rq
    feynmanLogs.value = fys
    if (activeNote.value) {
      const cur = notes.value.find((n) => n.id === activeNote.value!.id)
      activeNote.value = cur ?? null
    }
  } catch (e) {
    message.warning('数据加载失败（浏览器降级为演示模式）')
    console.warn(e)
  }
}
onMounted(load)

// ---- 课程表 ----
const courseFields: FieldDef[] = [
  { key: 'name', label: '课程名称', required: true },
  { key: 'weekday', label: '星期', type: 'select', options: [
    { label: '周一', value: '一' }, { label: '周二', value: '二' }, { label: '周三', value: '三' },
    { label: '周四', value: '四' }, { label: '周五', value: '五' }, { label: '周六', value: '六' }, { label: '周日', value: '日' },
  ] },
  { key: 'startPeriod', label: '起始节', type: 'number' },
  { key: 'endPeriod', label: '结束节', type: 'number' },
  { key: 'location', label: '地点' },
  { key: 'teacher', label: '教师' },
  { key: 'weeks', label: '周次 (如 1-16)', span: 2 },
  { key: 'note', label: '备注', span: 2 },
]

async function addCourse(v: Record<string, unknown>) {
  try {
    await coursesRepo.insert({
      name: String(v.name), weekday: String(v.weekday || '一'),
      startPeriod: Number(v.startPeriod || 1), endPeriod: Number(v.endPeriod || 2),
      location: String(v.location || ''), teacher: String(v.teacher || ''),
      weeks: String(v.weeks || ''), note: String(v.note || ''),
    })
    message.success('课程已添加')
    load()
  } catch { message.error('添加失败（请通过 npm run tauri dev 启动）') }
}

async function removeCourse(c: Course) {
  try {
    await coursesRepo.remove(c.id)
    message.success('已删除')
    load()
  } catch { message.error('删除失败') }
}

const maxPeriod = computed(() => Math.max(4, ...courses.value.map((c) => c.endPeriod)))
const periodCount = computed(() => Math.min(12, maxPeriod.value))

const coursesOn = (day: number) =>
  courses.value.filter((c) => weekdayMap[c.weekday] === day).sort((a, b) => a.startPeriod - b.startPeriod)

// F-STU-05 日程冲突检测
const courseConflicts = computed(() => {
  const out: { a: Course; b: Course; day: string }[] = []
  for (let i = 0; i < courses.value.length; i++) {
    for (let j = i + 1; j < courses.value.length; j++) {
      const a = courses.value[i]
      const b = courses.value[j]
      if (a.weekday !== b.weekday) continue
      if (a.startPeriod <= b.endPeriod && b.startPeriod <= a.endPeriod) {
        out.push({ a, b, day: `周${a.weekday}` })
      }
    }
  }
  return out
})

const dueConflicts = computed(() => {
  const groups = new Map<string, { date: string; titles: string[] }>()
  assignments.value
    .filter((a) => a.status !== 'submitted' && a.dueDate)
    .forEach((a) => {
      const key = a.dueDate || ''
      if (!groups.has(key)) groups.set(key, { date: key, titles: [] })
      groups.get(key)?.titles.push(a.title)
    })
  return [...groups.values()].filter((g) => g.titles.length > 1)
})

// ---- 作业双轨 ----
const assignmentFields: FieldDef[] = [
  { key: 'title', label: '作业标题', required: true, span: 2 },
  { key: 'courseId', label: '课程 ID', type: 'number' },
  { key: 'dueDate', label: '截止日期', type: 'date' },
  { key: 'status', label: '状态', type: 'select', options: [
    { label: '待办', value: 'todo' }, { label: '已写', value: 'written' }, { label: '已交', value: 'submitted' },
  ] },
  { key: 'note', label: '备注', type: 'textarea', span: 2 },
]

async function addAssignment(v: Record<string, unknown>) {
  try {
    await assignmentsRepo.insert({
      title: String(v.title), courseId: v.courseId ? Number(v.courseId) : undefined,
      dueDate: v.dueDate ? String(v.dueDate) : undefined,
      status: String(v.status || 'todo'), note: String(v.note || ''),
    })
    message.success('作业已创建')
    load()
  } catch { message.error('创建失败（请通过 npm run tauri dev 启动）') }
}

async function removeAssignment(a: Assignment) {
  try {
    await assignmentsRepo.remove(a.id)
    message.success('已删除')
    load()
  } catch { message.error('删除失败') }
}

async function setAssignmentStatus(a: Assignment, status: string) {
  try {
    await assignmentsRepo.update(a.id, { status })
    a.status = status as Assignment['status']
  } catch { message.error('更新失败') }
}

// ---- F-STU-04 DDL 压力热力图：按截止周聚合未交作业数 ----
const ddlPressure = computed(() => {
  const weeks: { week: string; count: number; level: 'low' | 'mid' | 'high' }[] = []
  const now = new Date()
  for (let i = 0; i < 6; i++) {
    const d = new Date(now)
    d.setDate(d.getDate() + i * 7)
    const start = new Date(d)
    start.setDate(d.getDate() - d.getDay() + 1)
    const end = new Date(start)
    end.setDate(start.getDate() + 7)
    const key = `${start.getMonth() + 1}/${start.getDate()}`
    const count = assignments.value.filter((a) => a.status !== 'submitted' && a.dueDate)?.filter((a) => {
      const t = new Date(a.dueDate!).getTime()
      return t >= start.getTime() && t < end.getTime()
    }).length || 0
    weeks.push({ week: key, count, level: count === 0 ? 'low' : count <= 2 ? 'mid' : 'high' })
  }
  return weeks
})

// ---- F-STU-11 考试倒排计划：以最近考试日期生成 D-n 复习计划 ----
const examPlan = computed(() => {
  const upcoming = grades.value
    .filter((g) => g.date)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .find((g) => new Date(g.date!).getTime() >= Date.now() - 86400000)
  if (!upcoming) return null
  const d = new Date(upcoming.date!)
  const days = Math.max(1, Math.ceil((d.getTime() - Date.now()) / 86400000))
  const steps = [
    { offset: 7, label: '通读教材与笔记' },
    { offset: 3, label: '刷题/错题复盘' },
    { offset: 1, label: '重点背诵 + 模拟' },
    { offset: 0, label: '轻复习 + 早睡' },
  ]
  const plan = steps
    .filter((s) => days >= s.offset)
    .map((s) => ({ label: s.label, at: days - s.offset }))
  return { course: upcoming.courseName, examType: upcoming.examType, date: upcoming.date, days, plan }
})

// ---- F-STU-09 刷题进度：闪卡掌握统计 ----
const flashProgress = computed(() => {
  const total = cards.value.length
  const mastered = cards.value.filter((c) => (c.level || 0) >= 3).length
  const learning = cards.value.filter((c) => (c.level || 0) > 0 && (c.level || 0) < 3).length
  return { total, mastered, learning, pct: total ? Math.round((mastered / total) * 100) : 0 }
})

const courseName = (id?: number | null) =>
  id ? courses.value.find((c) => c.id === id)?.name || `#${id}` : '—'

// ---- 笔记 ----
const noteFields: FieldDef[] = [
  { key: 'title', label: '标题', required: true, span: 2 },
  { key: 'tags', label: '标签 (逗号分隔)', span: 2 },
  { key: 'content', label: '内容', type: 'textarea', span: 2, placeholder: '开始记录…' },
]

async function addNote(v: Record<string, unknown>) {
  try {
    const id = await notesRepo.insert({
      title: String(v.title), tags: String(v.tags || ''), content: String(v.content || ''),
    })
    message.success('笔记已保存')
    load()
    const all = await notesRepo.listAll()
    activeNote.value = all.find((n) => n.id === id) ?? null
  } catch { message.error('保存失败（请通过 npm run tauri dev 启动）') }
}

async function removeNote(n: Note) {
  try {
    await notesRepo.remove(n.id)
    if (activeNote.value?.id === n.id) activeNote.value = null
    message.success('已删除')
    load()
  } catch { message.error('删除失败') }
}

// ---- 成绩单（F-STU-04）----
const gradeFields: FieldDef[] = [
  { key: 'courseName', label: '课程名称', required: true },
  { key: 'examType', label: '考试类型', type: 'select', options: [
    { label: '期中', value: '期中' }, { label: '期末', value: '期末' }, { label: '平时', value: '平时' },
    { label: '实验', value: '实验' }, { label: '其他', value: '其他' },
  ] },
  { key: 'score', label: '得分', type: 'number' },
  { key: 'total', label: '满分', type: 'number' },
  { key: 'weight', label: '权重（如 0.3）', type: 'number' },
  { key: 'date', label: '考试日期', type: 'date' },
  { key: 'note', label: '备注', span: 2 },
]
async function addGrade(v: Record<string, unknown>) {
  try {
    const courseId = courses.value.find((c) => c.name === String(v.courseName))?.id
    await gradesRepo.insert({
      courseId,
      courseName: String(v.courseName),
      examType: String(v.examType || '期中'),
      score: Number(v.score || 0),
      total: Number(v.total || 100),
      weight: Number(v.weight || 1),
      date: v.date ? String(v.date) : undefined,
      note: String(v.note || ''),
    })
    message.success('成绩已记录')
    load()
  } catch { message.error('保存失败（请通过 npm run tauri dev 启动）') }
}
async function removeGrade(g: Grade) {
  try { await gradesRepo.remove(g.id); message.success('已删除'); load() } catch { message.error('删除失败') }
}
const gradeAverage = computed(() => {
  const list = grades.value.filter((g) => g.total > 0)
  if (!list.length) return 0
  const wsum = list.reduce((s, g) => s + (g.weight || 1), 0)
  const ssum = list.reduce((s, g) => s + (g.score / g.total) * 100 * (g.weight || 1), 0)
  return wsum ? ssum / wsum : 0
})
const courseGradeAvg = (name: string) => {
  const list = grades.value.filter((g) => g.courseName === name && g.total > 0)
  if (!list.length) return null
  return (list.reduce((s, g) => s + g.score, 0) / list.length).toFixed(1)
}

// ---- 错题本（F-STU-10）---
const pitfallFields: FieldDef[] = [
  { key: 'title', label: '标题/考点', required: true },
  { key: 'category', label: '分类' },
  { key: 'problem', label: '错因描述', type: 'textarea', span: 2 },
  { key: 'solution', label: '正确解法', type: 'textarea', span: 2 },
  { key: 'tags', label: '标签' },
]
async function addPitfall(v: Record<string, unknown>) {
  try {
    await pitfallsRepo.insert({ title: String(v.title), category: String(v.category || ''), problem: String(v.problem || ''), solution: String(v.solution || ''), tags: String(v.tags || '') })
    message.success('错题已收录')
    load()
  } catch { message.error('保存失败（请通过 npm run tauri dev 启动）') }
}
async function removePitfall(p: Pitfall) {
  try { await pitfallsRepo.remove(p.id); message.success('已删除'); load() } catch { message.error('删除失败') }
}

// ---- 阅读队列（F-STU-08）---
const readFields: FieldDef[] = [
  { key: 'title', label: '书名/文章', required: true },
  { key: 'author', label: '作者' },
  { key: 'category', label: '分类' },
  { key: 'url', label: '链接', span: 2 },
  { key: 'totalPages', label: '总页数', type: 'number' },
  { key: 'priority', label: '优先级', type: 'number' },
]
async function addRead(v: Record<string, unknown>) {
  try {
    await readQueueRepo.insert({ title: String(v.title), author: String(v.author || ''), category: String(v.category || ''), url: String(v.url || ''), status: 'queue', priority: Number(v.priority || 1), totalPages: Number(v.totalPages || 0), currentPage: 0, addedAt: todayStr2 })
    message.success('已加入阅读队列')
    load()
  } catch { message.error('保存失败（请通过 npm run tauri dev 启动）') }
}
const readProgress = (r: ReadQueueItem) => (r.totalPages ? Math.min(100, Math.round(((r.currentPage || 0) / r.totalPages) * 100)) : 0)
async function markRead(r: ReadQueueItem, done: boolean) {
  try {
    await readQueueRepo.update(r.id, done ? { status: 'done', finishedAt: todayStr2 } : { status: 'reading' })
    load()
  } catch { message.error('更新失败') }
}
async function removeRead(r: ReadQueueItem) {
  try { await readQueueRepo.remove(r.id); message.success('已删除'); load() } catch { message.error('删除失败') }
}

// ---- 费曼输出（F-STU-12）---
const feynmanFields: FieldDef[] = [
  { key: 'topic', label: '主题', required: true },
  { key: 'explanation', label: '讲解内容（大白话）', required: true, type: 'textarea', span: 2 },
  { key: 'gap', label: '卡壳点/盲区', type: 'textarea', span: 2 },
  { key: 'source', label: '来源' },
]
async function addFeynman(v: Record<string, unknown>) {
  try {
    await feynmanLogsRepo.insert({ topic: String(v.topic), explanation: String(v.explanation), gap: String(v.gap || ''), source: String(v.source || ''), status: 'draft' })
    message.success('费曼记录已保存')
    load()
  } catch { message.error('保存失败（请通过 npm run tauri dev 启动）') }
}
async function removeFeynman(f: FeynmanLog) {
  try { await feynmanLogsRepo.remove(f.id); message.success('已删除'); load() } catch { message.error('删除失败') }
}

// ---- 闪卡（F-STU-09）----
const cardFields: FieldDef[] = [
  { key: 'front', label: '正面（问题）', required: true, span: 2 },
  { key: 'back', label: '反面（答案）', required: true, type: 'textarea', span: 2 },
  { key: 'deck', label: '卡组' },
]
async function addCard(v: Record<string, unknown>) {
  try {
    await flashcardsRepo.insert({
      front: String(v.front), back: String(v.back), deck: String(v.deck || '默认'),
      level: 0, reviewCount: 0,
    })
    message.success('闪卡已添加')
    load()
  } catch { message.error('保存失败（请通过 npm run tauri dev 启动）') }
}
async function removeCard(c: Flashcard) {
  try { await flashcardsRepo.remove(c.id); message.success('已删除'); load() } catch { message.error('删除失败') }
}
const todayStr2 = new Date().toISOString().slice(0, 10)
const dueCards = computed(() => cards.value.filter((c) => !c.dueDate || c.dueDate <= todayStr2))
const cardLevelLabel = (l?: number | null) => ({ 0: '新卡', 1: '学习中', 2: '熟悉', 3: '已掌握' })[l ?? 0] || '新卡'
const flipIndex = ref(-1)
function flipCard(i: number) {
  if (flipIndex.value === i) flipIndex.value = -1
  else flipIndex.value = i
}
async function reviewCard(c: Flashcard, pass: boolean) {
  try {
    const nextLevel = pass ? Math.min(3, (c.level || 0) + 1) : Math.max(0, (c.level || 0) - 1)
    const days = [0, 1, 3, 7][nextLevel]
    const due = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10)
    await flashcardsRepo.update(c.id, { level: nextLevel, lastReview: todayStr2, dueDate: due, reviewCount: (c.reviewCount || 0) + 1 })
    c.level = nextLevel; c.dueDate = due; c.reviewCount = (c.reviewCount || 0) + 1
    if (flipIndex.value >= 0) flipIndex.value = -1
  } catch { message.error('更新失败') }
}
const deckStats = computed(() => {
  const map = new Map<string, { total: number; due: number; mastered: number }>()
  cards.value.forEach((c) => {
    const key = c.deck || '默认'
    const cur = map.get(key) || { total: 0, due: 0, mastered: 0 }
    cur.total++
    if (!c.dueDate || c.dueDate <= todayStr2) cur.due++
    if ((c.level || 0) >= 3) cur.mastered++
    map.set(key, cur)
  })
  return [...map.entries()]
})

// ---- 学习目标（F-STU-07）----
const goalFields: FieldDef[] = [
  { key: 'title', label: '目标', required: true, span: 2 },
  { key: 'priority', label: '优先级', type: 'select', options: [
    { label: '高', value: 'high' }, { label: '中', value: 'medium' }, { label: '低', value: 'low' },
  ] },
  { key: 'dueDate', label: '截止日期', type: 'date' },
]
const goalText = ref('')
const goalPriority = ref('medium')
const goalDue = ref<string | null>(null)
async function addGoal() {
  const title = goalText.value.trim()
  if (!title) { message.warning('请输入目标'); return }
  try {
    await tasksRepo.insert({ title, scope: 'study', type: 'study', status: 'todo', priority: goalPriority.value, dueDate: goalDue.value || undefined })
    message.success('目标已创建')
    goalText.value = ''; goalDue.value = null
    goalFormShow.value = false
    load()
  } catch { message.error('保存失败（请通过 npm run tauri dev 启动）') }
}
async function toggleGoal(g: Task) {
  try { await tasksRepo.update(g.id, { status: g.status === 'done' ? 'todo' : 'done' }); g.status = g.status === 'done' ? 'todo' : 'done' } catch { message.error('更新失败') }
}
async function removeGoal(g: Task) {
  try { await tasksRepo.remove(g.id); message.success('已删除'); load() } catch { message.error('删除失败') }
}
const goalProgress = computed(() => {
  if (!studyGoals.value.length) return 0
  return Math.round(studyGoals.value.filter((g) => g.status === 'done').length / studyGoals.value.length * 100)
})

// ---- 专注统计（F-STU-11）----
const focusWeek = computed(() => {
  const now = new Date()
  const dayMs = 86400000
  const weekDays = new Map<string, number>()
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now.getTime() - i * dayMs)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    weekDays.set(key, 0)
  }
  focusRecords.value.filter((p) => p.completed === 1).forEach((p) => {
    const key = (p.startedAt || '').slice(0, 10)
    if (weekDays.has(key)) weekDays.set(key, (weekDays.get(key) || 0) + (p.minutes || 0))
  })
  return [...weekDays.entries()].map(([date, minutes]) => ({ date, minutes }))
})
const focusTotalMin = computed(() => focusRecords.value.filter((p) => p.completed === 1).reduce((s, p) => s + (p.minutes || 0), 0))
const focusMaxMin = computed(() => Math.max(1, ...focusWeek.value.map((d) => d.minutes)))
</script>

<template>
  <div>
    <PageHeader title="学习" desc="课程表 · 作业双轨 · 学习笔记" module="study">
      <NButton size="small" @click="load">刷新</NButton>
    </PageHeader>

    <n-tabs type="line" class="wb-tabs">
      <!-- 课程表 -->
      <n-tab-pane name="schedule" tab="课程表">
        <div class="toolbar">
          <NButton size="small" type="primary" ghost @click="courseFormShow = true">
            <template #icon><NIcon :component="Plus" /></template>
            添加课程
          </NButton>
        </div>
        <div v-if="courseConflicts.length" class="conflict-alert">
          <span class="cf-dot"></span>
          检测到 {{ courseConflicts.length }} 处课程时间冲突：
          <span v-for="(c, idx) in courseConflicts" :key="idx" class="cf-item mono">
            {{ c.day }} {{ c.a.name }} ↔ {{ c.b.name }}
          </span>
        </div>
        <div v-if="dueConflicts.length" class="conflict-alert due">
          <span class="cf-dot"></span>
          {{ dueConflicts.length }} 组作业截止撞期：
          <span v-for="(g, idx) in dueConflicts" :key="idx" class="cf-item mono">
            {{ g.date }}（{{ g.titles.join('、') }}）
          </span>
        </div>
        <div v-if="courses.length" class="schedule">
          <div v-for="(day, i) in weekdayNames" :key="day" class="schedule-col">
            <div class="sc-day">{{ day }}</div>
            <div class="sc-cells">
              <template v-for="p in periodCount" :key="p">
                <div
                  v-for="c in coursesOn(i).filter((c) => c.startPeriod <= p && c.endPeriod >= p)"
                  :key="c.id"
                  class="sc-cell"
                  :style="{ gridRow: `${c.startPeriod} / ${c.endPeriod + 1}` }"
                >
                  <div class="sc-name">{{ c.name }}</div>
                  <div class="sc-sub mono">{{ c.location || '' }} {{ c.teacher || '' }}</div>
                </div>
              </template>
            </div>
          </div>
        </div>
        <EmptyState v-else text="暂无课程，添加第一门课吧" />
      </n-tab-pane>

      <!-- 作业双轨 -->
      <n-tab-pane name="assignments" tab="作业双轨">
        <div class="toolbar">
          <NButton size="small" type="primary" ghost @click="assignmentFormShow = true">
            <template #icon><NIcon :component="Plus" /></template>
            新建作业
          </NButton>
        </div>
        <div class="ddl-pressure wb-card">
          <span class="dim" style="font-size: 12px">未来 6 周 DDL 压力：</span>
          <span
            v-for="w in ddlPressure" :key="w.week" class="dp-cell"
            :style="w.count === 0 ? 'background: var(--wb-card-alt); color: var(--wb-dim)' : w.count <= 2 ? 'background: var(--wb-module-study); color: #fff' : 'background: var(--wb-danger); color: #fff'"
            :title="`${w.week} 当周 ${w.count} 个 DDL`"
          >
            {{ w.week }}<b>{{ w.count }}</b>
          </span>
        </div>
        <div v-if="assignments.length" class="assignment-table">
          <div class="a-row head">
            <span>作业</span><span>课程</span><span>截止</span><span>写完</span><span>提交</span><span></span>
          </div>
          <div v-for="a in assignments" :key="a.id" class="a-row">
            <span class="a-title">{{ a.title }}</span>
            <span>{{ courseName(a.courseId) }}</span>
            <span class="mono" :style="a.dueDate && a.dueDate < new Date().toISOString().slice(0, 10) && a.status !== 'submitted' ? 'color: var(--wb-danger)' : ''">
              {{ a.dueDate || '—' }}
            </span>
            <span>
              <NButton
                size="tiny" :type="a.status === 'todo' ? 'default' : 'success'" text
                @click="setAssignmentStatus(a, a.status === 'todo' ? 'written' : 'todo')"
              >
                <template #icon><NIcon :component="Check" /></template>
                {{ a.status === 'todo' ? '未写' : '已写' }}
              </NButton>
            </span>
            <span>
              <NButton
                size="tiny" :type="a.status === 'submitted' ? 'success' : 'default'" text
                @click="setAssignmentStatus(a, a.status === 'submitted' ? 'written' : 'submitted')"
              >
                <template #icon><NIcon :component="Checkbox" /></template>
                {{ a.status === 'submitted' ? '已交' : '未交' }}
              </NButton>
            </span>
            <span style="text-align: right">
              <NButton size="tiny" text type="error" @click="removeAssignment(a)"><template #icon><NIcon :component="Trash" /></template></NButton>
            </span>
          </div>
        </div>
        <EmptyState v-else text="暂无作业" />
      </n-tab-pane>

      <!-- 学习笔记 -->
      <n-tab-pane name="notes" tab="学习笔记">
        <div class="toolbar">
          <NButton size="small" type="primary" ghost @click="noteFormShow = true">
            <template #icon><NIcon :component="Plus" /></template>
            新建笔记
          </NButton>
        </div>
        <div v-if="notes.length" class="note-grid">
          <div v-for="n in notes" :key="n.id" class="note-card wb-card hoverable" @click="activeNote = n">
            <div class="note-title">{{ n.title }}</div>
            <div class="note-preview">{{ (n.content || '').slice(0, 120) }}</div>
            <div v-if="n.tags" class="note-tags mono">{{ n.tags }}</div>
            <div class="note-date mono">{{ n.updatedAt || n.createdAt }}</div>
          </div>
        </div>
        <EmptyState v-else text="暂无笔记" />
      </n-tab-pane>

      <!-- 成绩单 F-STU-04 -->
      <n-tab-pane name="grades" tab="成绩单">
        <div class="toolbar">
          <NButton size="small" type="primary" ghost @click="gradeFormShow = true">
            <template #icon><NIcon :component="Plus" /></template>
            记录成绩
          </NButton>
        </div>
        <div class="gpa-strip">
          <div class="gpa-card wb-card">
            <span class="dim">加权平均分</span>
            <span class="mono gpa-num">{{ gradeAverage.toFixed(1) }}</span>
          </div>
          <div class="gpa-card wb-card">
            <span class="dim">已记录</span>
            <span class="mono gpa-num">{{ grades.length }} 条</span>
          </div>
        </div>
        <div v-if="grades.length" class="grade-table">
          <div class="g-row head">
            <span>课程</span><span>类型</span><span>得分</span><span>满分</span><span>权重</span><span>日期</span><span></span>
          </div>
          <div v-for="g in grades" :key="g.id" class="g-row">
            <span>{{ g.courseName }} <span v-if="courseGradeAvg(g.courseName) !== null" class="mono dim">(均 {{ courseGradeAvg(g.courseName) }})</span></span>
            <span><NTag size="tiny" :bordered="false">{{ g.examType }}</NTag></span>
            <span class="mono" :style="g.total && g.score / g.total >= 0.6 ? 'color: var(--wb-success)' : 'color: var(--wb-danger)'">{{ g.score }}</span>
            <span class="mono">{{ g.total }}</span>
            <span class="mono">{{ g.weight }}</span>
            <span class="mono">{{ g.date || '—' }}</span>
            <span style="text-align: right">
              <NButton size="tiny" text type="error" @click="removeGrade(g)"><template #icon><NIcon :component="Trash" /></template></NButton>
            </span>
          </div>
        </div>
        <EmptyState v-else text="暂无成绩记录" />
      </n-tab-pane>

      <!-- 闪卡 F-STU-09 -->
      <n-tab-pane name="cards" tab="闪卡">
        <div class="toolbar">
          <NButton size="small" type="primary" ghost @click="cardFormShow = true">
            <template #icon><NIcon :component="Plus" /></template>
            添加闪卡
          </NButton>
        </div>
        <div v-if="flashProgress.total" class="flash-progress wb-card">
          <span class="dim" style="font-size: 12px">刷题掌握进度：已掌握 {{ flashProgress.mastered }} / {{ flashProgress.total }}（{{ flashProgress.pct }}%）</span>
          <div class="fp-track"><div class="fp-bar" :style="{ width: flashProgress.pct + '%', background: 'var(--wb-module-study)' }"></div></div>
        </div>
        <div v-if="deckStats.length" class="deck-stats">
          <div v-for="([deck, s]) in deckStats" :key="deck" class="deck-stat wb-card">
            <span class="dim">{{ deck }}</span>
            <span class="mono deck-num">{{ s.total }} 张 · 待复习 {{ s.due }} · 已掌握 {{ s.mastered }}</span>
          </div>
        </div>
        <div v-if="dueCards.length" class="card-list">
          <div v-for="(c, i) in dueCards" :key="c.id" class="flash-card wb-card" :class="{ flipped: flipIndex === i }">
            <div class="fc-head">
              <NTag size="tiny" :bordered="false">{{ c.deck || '默认' }}</NTag>
              <NTag size="tiny" :bordered="false" :type="(c.level || 0) >= 3 ? 'success' : (c.level || 0) >= 2 ? 'info' : 'default'">{{ cardLevelLabel(c.level) }}</NTag>
            </div>
            <div class="fc-body" @click="flipCard(i)">
              <span v-if="flipIndex !== i" class="fc-front">{{ c.front }}</span>
              <span v-else class="fc-back">{{ c.back }}</span>
              <span class="dim" style="font-size: 11px">{{ flipIndex === i ? '答案' : '点击翻面' }}</span>
            </div>
            <div v-if="flipIndex === i" class="fc-ops">
              <NButton size="tiny" @click="reviewCard(c, false)">再记一次</NButton>
              <NButton size="tiny" type="primary" @click="reviewCard(c, true)">记住了</NButton>
            </div>
            <NButton size="tiny" text type="error" style="position: absolute; right: 6px; bottom: 4px" @click="removeCard(c)">
              <template #icon><NIcon :component="Trash" /></template>
            </NButton>
          </div>
        </div>
        <EmptyState v-else text="暂无待复习闪卡，添加一张或稍后回来" />
      </n-tab-pane>

      <!-- 学习目标 F-STU-07 -->
      <n-tab-pane name="goals" tab="学习目标">
        <div class="toolbar">
          <NButton size="small" type="primary" ghost @click="goalFormShow = true">
            <template #icon><NIcon :component="Plus" /></template>
            新建目标
          </NButton>
        </div>
        <div class="goal-progress wb-card">
          <span class="dim">目标总进度</span>
          <span class="mono gp-num">{{ goalProgress }}%</span>
          <div class="gp-track"><div class="gp-bar" :style="{ width: goalProgress + '%' }"></div></div>
        </div>
        <div v-if="studyGoals.length" class="goal-list">
          <div v-for="g in studyGoals" :key="g.id" class="goal-row wb-card">
            <span :style="g.status === 'done' ? 'text-decoration: line-through; color: var(--wb-text-3)' : ''">{{ g.title }}</span>
            <span class="mono dim">{{ g.dueDate || '' }}</span>
            <span style="display: flex; gap: 4px">
              <NButton size="tiny" :type="g.status === 'done' ? 'success' : 'default'" text @click="toggleGoal(g)"><template #icon><NIcon :component="Check" /></template></NButton>
              <NButton size="tiny" text type="error" @click="removeGoal(g)"><template #icon><NIcon :component="Trash" /></template></NButton>
            </span>
          </div>
        </div>
        <EmptyState v-else text="暂无学习目标" />
      </n-tab-pane>

      <!-- 专注统计 F-STU-11 -->
      <n-tab-pane name="focus" tab="专注统计">
        <div class="gpa-strip">
          <div class="gpa-card wb-card">
            <span class="dim">累计专注</span>
            <span class="mono gpa-num">{{ (focusTotalMin / 60).toFixed(1) }} h</span>
          </div>
          <div class="gpa-card wb-card">
            <span class="dim">完成番茄</span>
            <span class="mono gpa-num">{{ focusRecords.filter((p) => p.completed === 1).length }} 个</span>
          </div>
        </div>
        <div class="focus-week wb-card">
          <div v-for="d in focusWeek" :key="d.date" class="fw-col">
            <span class="mono fw-val">{{ d.minutes ? d.minutes + 'm' : '·' }}</span>
            <div class="fw-bar-wrap"><div class="fw-bar" :style="{ height: (d.minutes / focusMaxMin * 100) + '%' }"></div></div>
            <span class="mono fw-day">{{ d.date.slice(5) }}</span>
          </div>
        </div>
      </n-tab-pane>

      <!-- 错题本 F-STU-10 -->
      <n-tab-pane name="pitfalls" tab="错题本">
        <div class="toolbar">
          <NButton size="small" type="primary" ghost @click="pitfallFormShow = true">
            <template #icon><NIcon :component="Plus" /></template>
            收录错题
          </NButton>
        </div>
        <div v-if="pitfalls.length" class="pitfall-list">
          <div v-for="p in pitfalls" :key="p.id" class="pitfall-row wb-card">
            <div class="pf-head">
              <span class="pf-title">{{ p.title }}</span>
              <NTag v-if="p.category" size="tiny" :bordered="false">{{ p.category }}</NTag>
            </div>
            <div class="pf-body">
              <span class="dim">错因：</span><span>{{ p.problem }}</span>
              <span class="dim" style="margin-left: 12px">解法：</span><span>{{ p.solution }}</span>
            </div>
            <span style="position: absolute; right: 8px; top: 8px">
              <NButton size="tiny" text type="error" @click="removePitfall(p)"><template #icon><NIcon :component="Trash" /></template></NButton>
            </span>
          </div>
        </div>
        <EmptyState v-else text="暂无错题，收录一道开始吧" />
      </n-tab-pane>

      <!-- 阅读队列 F-STU-08 -->
      <n-tab-pane name="readQueue" tab="阅读队列">
        <div class="toolbar">
          <NButton size="small" type="primary" ghost @click="readFormShow = true">
            <template #icon><NIcon :component="Plus" /></template>
            加入队列
          </NButton>
        </div>
        <div v-if="readQueue.length" class="read-list">
          <div v-for="r in readQueue" :key="r.id" class="read-row wb-card">
            <div class="rd-info">
              <span class="rd-title">{{ r.title }}</span>
              <span class="dim">{{ r.author || '' }} {{ r.category ? '· ' + r.category : '' }}</span>
            </div>
            <div class="rd-progress">
              <span class="mono dim">{{ r.status === 'done' ? '已完成' : r.totalPages ? r.currentPage + '/' + r.totalPages + ' 页' : '未开始' }}</span>
              <div class="gp-track" style="width: 90px"><div class="gp-bar" :style="{ width: readProgress(r) + '%', background: 'var(--wb-module-study)' }"></div></div>
            </div>
            <span style="display: flex; gap: 4px; align-items: center">
              <NButton size="tiny" text :type="r.status === 'reading' ? 'info' : 'default'" @click="markRead(r, false)"><template #icon><NIcon :component="Checkbox" /></template>在读</NButton>
              <NButton size="tiny" text type="success" @click="markRead(r, true)"><template #icon><NIcon :component="Check" /></template>读完</NButton>
              <NButton size="tiny" text type="error" @click="removeRead(r)"><template #icon><NIcon :component="Trash" /></template></NButton>
            </span>
          </div>
        </div>
        <EmptyState v-else text="阅读队列为空" />
      </n-tab-pane>

      <!-- 费曼输出 F-STU-12 -->
      <n-tab-pane name="feynman" tab="费曼输出">
        <div class="toolbar">
          <NButton size="small" type="primary" ghost @click="feynmanFormShow = true">
            <template #icon><NIcon :component="Plus" /></template>
            记录讲解
          </NButton>
        </div>
        <div v-if="feynmanLogs.length" class="feynman-list">
          <div v-for="f in feynmanLogs" :key="f.id" class="feynman-row wb-card">
            <div class="pf-head">
              <span class="pf-title">{{ f.topic }}</span>
              <NTag size="tiny" :bordered="false" :type="f.status === 'done' ? 'success' : 'default'">{{ f.status === 'done' ? '已讲通' : '待复盘' }}</NTag>
            </div>
            <div class="pf-body">
              <span class="dim">讲解：</span><span>{{ f.explanation }}</span>
            </div>
            <div v-if="f.gap" class="pf-body">
              <span class="dim" style="color: var(--wb-danger)">卡壳点：</span><span>{{ f.gap }}</span>
            </div>
            <span style="position: absolute; right: 8px; top: 8px">
              <NButton size="tiny" text type="error" @click="removeFeynman(f)"><template #icon><NIcon :component="Trash" /></template></NButton>
            </span>
          </div>
        </div>
        <EmptyState v-else text="暂无费曼记录" />
      </n-tab-pane>
    </n-tabs>

    <!-- 笔记详情 -->
    <n-modal v-if="activeNote" :show="true" preset="card" :title="activeNote.title" style="width: 640px; max-width: calc(100vw - 48px)" @update:show="(v: boolean) => (activeNote = v ? activeNote : null)">
      <div class="note-detail">
        <div v-if="activeNote.tags" class="mono note-detail-tags">{{ activeNote.tags }}</div>
        <p class="note-detail-body">{{ activeNote.content || '（空）' }}</p>
        <div style="display: flex; justify-content: flex-end; gap: 8px">
          <NButton size="tiny" text @click="activeNote = null">关闭</NButton>
          <NButton size="tiny" text type="error" @click="removeNote(activeNote); activeNote = null">删除</NButton>
        </div>
      </div>
    </n-modal>

    <ModalForm v-model:show="courseFormShow" title="添加课程" :fields="courseFields" @submit="addCourse" />
    <ModalForm v-model:show="assignmentFormShow" title="新建作业" :fields="assignmentFields" @submit="addAssignment" />
    <ModalForm v-model:show="noteFormShow" title="新建笔记" :fields="noteFields" confirm-text="保存" @submit="addNote" />
    <ModalForm v-model:show="gradeFormShow" title="记录成绩" :fields="gradeFields" confirm-text="保存" @submit="addGrade" />
    <ModalForm v-model:show="cardFormShow" title="添加闪卡" :fields="cardFields" confirm-text="保存" @submit="addCard" />
    <ModalForm v-model:show="pitfallFormShow" title="收录错题" :fields="pitfallFields" confirm-text="保存" @submit="addPitfall" />
    <ModalForm v-model:show="readFormShow" title="加入阅读队列" :fields="readFields" confirm-text="保存" @submit="addRead" />
    <ModalForm v-model:show="feynmanFormShow" title="费曼讲解记录" :fields="feynmanFields" confirm-text="保存" @submit="addFeynman" />
    <ModalForm v-model:show="goalFormShow" title="新建学习目标" confirm-text="创建" @submit="addGoal">
      <template #default>
        <div style="display: flex; flex-direction: column; gap: 10px">
          <NInput v-model:value="goalText" placeholder="目标内容" />
          <div style="display: flex; gap: 8px">
            <NSelect v-model:value="goalPriority" :options="[{ label: '高', value: 'high' }, { label: '中', value: 'medium' }, { label: '低', value: 'low' }]" size="small" style="width: 140px" />
            <NDatePicker v-model:formatted-value="goalDue" type="date" size="small" value-format="yyyy-MM-dd" placeholder="截止日期" style="width: 150px" />
          </div>
        </div>
      </template>
    </ModalForm>
  </div>
</template>

<style scoped>
.wb-tabs :deep(.n-tabs-nav) { margin-bottom: 14px; }
.toolbar { display: flex; justify-content: flex-end; margin-bottom: 12px; }
.schedule {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 8px;
  overflow-x: auto;
}
@media (max-width: 1000px) {
  .schedule { grid-template-columns: 140px; }
}
.schedule-col {
  border: 1px solid var(--wb-border);
  border-radius: var(--wb-radius-md);
  overflow: hidden;
  min-width: 92px;
}
.sc-day {
  text-align: center;
  padding: 8px 0;
  font-size: 12px;
  font-weight: 600;
  background: var(--wb-card-alt);
  color: var(--wb-text-2);
}
.sc-cells {
  position: relative;
  display: grid;
  grid-template-rows: repeat(12, 34px);
  gap: 2px;
  padding: 4px;
  min-height: 400px;
}
.sc-cell {
  grid-column: 1;
  border-radius: 6px;
  padding: 5px 6px;
  background: color-mix(in srgb, var(--wb-module-study) 14%, transparent);
  border: 1px solid color-mix(in srgb, var(--wb-module-study) 34%, transparent);
  overflow: hidden;
  font-size: 11px;
}
.sc-name { font-weight: 600; color: var(--wb-module-study); line-height: 1.3; }
.sc-sub { font-size: 10px; color: var(--wb-text-3); margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.conflict-alert {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-bottom: 12px;
  padding: 10px 14px;
  border-radius: var(--wb-radius-md);
  border: 1px solid color-mix(in srgb, var(--wb-danger) 40%, transparent);
  background: color-mix(in srgb, var(--wb-danger) 8%, transparent);
  font-size: 12.5px;
  color: var(--wb-danger);
}
.conflict-alert.due {
  border-color: color-mix(in srgb, var(--wb-warning, #d97706) 40%, transparent);
  background: color-mix(in srgb, var(--wb-warning, #d97706) 8%, transparent);
  color: var(--wb-warning, #d97706);
}
.cf-dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; flex: none; }
.cf-item {
  padding: 2px 8px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--wb-border) 55%, transparent);
  font-size: 12px;
}
.assignment-table {
  border: 1px solid var(--wb-border);
  border-radius: var(--wb-radius-md);
  overflow: hidden;
}
.a-row {
  display: grid;
  grid-template-columns: 2.2fr 1.2fr 1.2fr 0.9fr 0.9fr 0.5fr;
  gap: 10px;
  align-items: center;
  padding: 9px 14px;
  border-bottom: 1px solid var(--wb-border);
  font-size: 12.5px;
}
.a-row:last-child { border-bottom: none; }
.a-row.head {
  background: var(--wb-card-alt);
  font-weight: 600;
  color: var(--wb-text-2);
  font-size: 12px;
}
.a-title { font-weight: 550; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.note-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 12px;
}
.note-card { padding: 13px 15px; cursor: pointer; }
.note-title { font-size: 13.5px; font-weight: 600; }
.note-preview {
  margin-top: 6px;
  font-size: 12px;
  color: var(--wb-text-2);
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.note-tags { margin-top: 8px; font-size: 11px; color: var(--wb-module-study); }
.note-date { margin-top: 4px; font-size: 10.5px; color: var(--wb-text-3); }
.note-detail { display: flex; flex-direction: column; gap: 10px; }
.note-detail-tags { font-size: 12px; color: var(--wb-module-study); }
.note-detail-body {
  margin: 0;
  font-size: 13.5px;
  line-height: 1.7;
  white-space: pre-wrap;
  max-height: 46vh;
  overflow: auto;
  color: var(--wb-text-1);
}
.gpa-strip { display: flex; gap: 12px; margin-bottom: 14px; }
.gpa-card { padding: 12px 16px; display: flex; flex-direction: column; gap: 2px; }
.gpa-num { font-size: 17px; font-weight: 650; }
.grade-table {
  border: 1px solid var(--wb-border);
  border-radius: var(--wb-radius-md);
  overflow: hidden;
}
.g-row {
  display: grid;
  grid-template-columns: 2fr 0.8fr 0.8fr 0.8fr 0.8fr 1.2fr 0.5fr;
  gap: 10px;
  align-items: center;
  padding: 8px 14px;
  border-bottom: 1px solid var(--wb-border);
  font-size: 12.5px;
}
.g-row:last-child { border-bottom: none; }
.g-row.head {
  background: var(--wb-card-alt);
  font-weight: 600;
  color: var(--wb-text-2);
  font-size: 12px;
}
.deck-stats { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 14px; }
.deck-stat { padding: 10px 14px; display: flex; flex-direction: column; gap: 2px; }
.deck-num { font-size: 13px; font-weight: 600; }
.card-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }
.flash-card { position: relative; padding: 13px 15px; display: flex; flex-direction: column; gap: 10px; min-height: 130px; }
.flash-card.flipped { border-color: color-mix(in srgb, var(--wb-module-study) 50%, transparent); }
.fc-head { display: flex; gap: 6px; }
.fc-body { flex: 1; display: flex; flex-direction: column; justify-content: center; gap: 6px; cursor: pointer; font-size: 13px; }
.fc-front { font-weight: 600; }
.fc-back { color: var(--wb-module-study); font-weight: 600; }
.fc-ops { display: flex; gap: 6px; }
.goal-progress { padding: 12px 16px; display: flex; flex-direction: column; gap: 6px; margin-bottom: 14px; }
.gp-num { font-size: 17px; font-weight: 650; color: var(--wb-module-study); }
.gp-track { height: 8px; background: var(--wb-card-alt); border-radius: 999px; overflow: hidden; }
.gp-bar { height: 100%; background: var(--wb-module-study); border-radius: 999px; transition: width 0.3s; }
.goal-list { display: flex; flex-direction: column; gap: 8px; }
.goal-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 14px; font-size: 12.5px; }
.focus-week { display: flex; gap: 12px; padding: 16px; align-items: flex-end; }
.fw-col { display: flex; flex-direction: column; align-items: center; gap: 6px; width: 44px; }
.fw-val { font-size: 10.5px; color: var(--wb-text-2); }
.fw-bar-wrap { height: 90px; width: 14px; background: var(--wb-card-alt); border-radius: 999px; display: flex; align-items: flex-end; overflow: hidden; }
.fw-bar { width: 100%; background: var(--wb-module-study); border-radius: 999px; }
.fw-day { font-size: 10px; color: var(--wb-text-3); }
</style>
