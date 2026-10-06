<script setup lang="ts">
import { watch, ref, onMounted, onUnmounted, computed } from 'vue'
import { refreshTick } from '@/stores/ui'
import { NButton, NTag, NTabs, NTabPane, NIcon, useMessage, NInputNumber, NSelect, NInput, NSlider, NDatePicker } from 'naive-ui'
import { Plus, Trash, Check } from '@vicons/tabler'
import EmptyState from '@/components/EmptyState.vue'
import ListSkeleton from '@/components/ListSkeleton.vue'
import ModalForm, { type FieldDef } from '@/components/ModalForm.vue'
import { useConfirm } from '@/composables/useConfirm'
import { useListNav } from '@/composables/useListNav'
import { habitsRepo, habitLogsRepo, ledgerRepo, pomodorosRepo, healthLogsRepo, fixedBillsRepo, deadlinesRepo, tasksRepo } from '@/db'
import type { Habit, HabitLog, LedgerEntry, Pomodoro, HealthLog, FixedBill, Deadline, Task } from '../../drizzle/schema'
import { matchKw } from '@/composables/match'

const message = useMessage()
const { confirm } = useConfirm()
const habits = ref<Habit[]>([])
const habitLogs = ref<HabitLog[]>([])
const ledger = ref<LedgerEntry[]>([])
const habitFormShow = ref(false)
const ledgerFormShow = ref(false)
const billFormShow = ref(false)
const bills = ref<FixedBill[]>([])
const deadlines = ref<Deadline[]>([])
const chores = ref<Task[]>([])

const today = new Date()
const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`

const loading = ref(false)
// 当前激活的页签，供列表键盘导航判断「哪个列表此刻可见」（同 DevView 的 tab 用法）
const tab = ref('habits')
async function load() {
  loading.value = true
  try {
    const [hs, hsLogs, ls, bs, dls, ts] = await Promise.all([
      habitsRepo.listAll(), habitLogsRepo.listAll(), ledgerRepo.listAll(),
      fixedBillsRepo.listAll(), deadlinesRepo.listAll(), tasksRepo.listAll(),
    ])
    habits.value = hs
    habitLogs.value = hsLogs
    ledger.value = ls
    bills.value = bs
    deadlines.value = dls
    chores.value = ts.filter((t) => t.scope === 'life' || t.type === 'life')
    await Promise.all([loadPomos(), loadHealth()])
  } catch (e) {
    message.warning('数据加载失败（浏览器降级为演示模式）')
    console.warn(e)
  } finally {
    loading.value = false
  }
}
watch(refreshTick, () => load())
onMounted(load)
// 离开页面时停掉倒计时，否则计时器继续跑并在后台写记录
onUnmounted(() => {
  clearPomoInterval()
  pomoRunning.value = false
})

// ---- 习惯打卡 ----
const habitFields: FieldDef[] = [
  { key: 'name', label: '习惯名称', required: true },
  { key: 'color', label: '颜色', placeholder: '#059669' },
]

async function addHabit(v: Record<string, unknown>) {
  try {
    await habitsRepo.insert({ name: String(v.name), color: String(v.color || '#059669') })
    message.success('习惯已创建')
    load()
  } catch { message.error('创建失败（请通过 npm run tauri dev 启动）') }
}

async function removeHabit(h: Habit) {
  const ok = await confirm({ title: '删除这个习惯？', content: `「${h.name}」及其打卡记录将一并删除，无法恢复。` })
  if (!ok) return
  try {
    await habitsRepo.remove(h.id)
    message.success('已删除')
    load()
  } catch { message.error('删除失败') }
}

// ---- 编辑习惯 ----
// habits 只有两个业务列：name / color（habitsRepo 白名单也是这两个），其余由 id 定位
const editHabitShow = ref(false)
const editHabitId = ref<number | null>(null)
const editHabitForm = ref<Record<string, unknown>>({})

function openEditHabit(h: Habit) {
  editHabitId.value = h.id
  editHabitForm.value = { name: h.name, color: h.color ?? '#059669' }
  editHabitShow.value = true
}

async function saveEditHabit(v: Record<string, unknown>) {
  if (editHabitId.value === null) return
  try {
    await habitsRepo.update(editHabitId.value, { name: String(v.name || ''), color: String(v.color || '#059669') })
    message.success('已更新')
    editHabitShow.value = false
    load()
  } catch { message.error('保存失败') }
}

// 预计算：habitId -> 已打卡日期集合。
// 原先每个习惯卡片要各调两次全表 filter/some（模板里 checkedToday 还调了两次），
// 习惯与日志一多就是 O(习惯数 × 日志数)，改为一次建索引后 O(1) 查询。
const habitDatesMap = computed(() => {
  const m = new Map<number, Set<string>>()
  for (const l of habitLogs.value) {
    let s = m.get(l.habitId)
    if (!s) { s = new Set(); m.set(l.habitId, s) }
    s.add(l.date)
  }
  return m
})

const checkedToday = (habitId: number) => habitDatesMap.value.get(habitId)?.has(todayStr) ?? false

function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const habitStreak = (habitId: number) => {
  const dates = habitDatesMap.value.get(habitId)
  if (!dates) return 0
  let streak = 0
  const d = new Date()
  while (dates.has(fmtDate(d))) {
    streak++
    d.setDate(d.getDate() - 1)
  }
  return streak
}

async function toggleHabit(h: Habit) {
  try {
    if (checkedToday(h.id)) {
      const log = habitLogs.value.find((l) => l.habitId === h.id && l.date === todayStr)
      if (log) await habitLogsRepo.remove(log.id)
    } else {
      await habitLogsRepo.insert({ habitId: h.id, date: todayStr })
    }
    load()
  } catch { message.error('打卡失败') }
}

// ---- 记账 ----
const ledgerFields: FieldDef[] = [
  { key: 'type', label: '类型', type: 'select', options: [
    { label: '支出', value: 'expense' }, { label: '收入', value: 'income' },
  ] },
  { key: 'amount', label: '金额', type: 'number' },
  // 分类随「类型」联动：支出类与收入类是两套语义，混着选会出现「收入-购物」。
  // options 列出全量（旧数据里有这些取值），optionsBy 控制按类型显示的档位。
  { key: 'category', label: '分类', dependsOn: 'type', options: [
    { label: '餐饮', value: '餐饮' }, { label: '交通', value: '交通' },
    { label: '购物', value: '购物' }, { label: '居住', value: '居住' },
    { label: '学习', value: '学习' }, { label: '娱乐', value: '娱乐' },
    { label: '医疗', value: '医疗' }, { label: '订阅', value: '订阅' },
    { label: '其他', value: '其他' },
    { label: '工资', value: '工资' }, { label: '奖金', value: '奖金' },
    { label: '理财', value: '理财' }, { label: '兼职', value: '兼职' },
    { label: '报销', value: '报销' }, { label: '红包', value: '红包' },
    { label: '其他收入', value: '其他收入' },
  ], optionsBy: {
    expense: ['餐饮', '交通', '购物', '居住', '学习', '娱乐', '医疗', '订阅', '其他'],
    income: ['工资', '奖金', '理财', '兼职', '报销', '红包', '其他收入'],
  } },
  { key: 'date', label: '日期', type: 'date' },
  { key: 'note', label: '备注', span: 2 },
]

async function addLedger(v: Record<string, unknown>) {
  try {
    await ledgerRepo.insert({
      type: String(v.type || 'expense'), amount: Number(v.amount || 0),
      category: String(v.category || '其他'), date: String(v.date || todayStr),
      note: String(v.note || ''),
    })
    message.success('已记账')
    load()
  } catch { message.error('记账失败（请通过 npm run tauri dev 启动）') }
}

async function removeLedger(e: LedgerEntry) {
  const ok = await confirm({ title: '删除这笔记录？', content: `${e.category || '未分类'} · ${e.amount} 元` })
  if (!ok) return
  try {
    await ledgerRepo.remove(e.id)
    message.success('已删除')
    load()
  } catch { message.error('删除失败') }
}

// ---- 编辑记账 ----
// ledger 的可编辑业务列：type/amount/category/note/date
// 复用 ledgerFields（分类随 type 联动由 optionsBy 提供，编辑时同样生效）
const editLedgerShow = ref(false)
const editLedgerId = ref<number | null>(null)
const editLedgerForm = ref<Record<string, unknown>>({})

function openEditLedger(e: LedgerEntry) {
  editLedgerId.value = e.id
  editLedgerForm.value = {
    type: e.type ?? 'expense', amount: e.amount ?? 0, category: e.category ?? '其他',
    date: e.date ?? todayStr, note: e.note ?? '',
  }
  editLedgerShow.value = true
}

async function saveEditLedger(v: Record<string, unknown>) {
  if (editLedgerId.value === null) return
  try {
    await ledgerRepo.update(editLedgerId.value, {
      type: String(v.type || 'expense'), amount: Number(v.amount || 0),
      category: String(v.category || '其他'), date: String(v.date || todayStr),
      note: String(v.note || ''),
    })
    message.success('已更新')
    editLedgerShow.value = false
    load()
  } catch { message.error('保存失败') }
}

const incomeTotal = computed(() => ledger.value.filter((e) => e.type === 'income').reduce((s, e) => s + e.amount, 0))
const expenseTotal = computed(() => ledger.value.filter((e) => e.type === 'expense').reduce((s, e) => s + e.amount, 0))
const balance = computed(() => incomeTotal.value - expenseTotal.value)

const monthExpense = computed(() => {
  const ym = todayStr.slice(0, 7)
  return ledger.value
    .filter((e) => e.type === 'expense' && e.date.startsWith(ym))
    .reduce((s, e) => s + e.amount, 0)
})

const recentLedger = computed(() => [...ledger.value].sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 20))

// ---- 番茄钟（F-LIFE-04）----
const pomoMinutes = ref(25)
const pomoTask = ref('')
const pomoRunning = ref(false)
const pomoLeft = ref(25 * 60)
const pomoRecords = ref<Pomodoro[]>([])
const pomoLimit = ref(20)
const pomoEndsAt = ref(0)
let pomoInterval: number | undefined

const fmtClock = (secs: number) => {
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

const nowStamp = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
}

function clearPomoInterval() {
  if (pomoInterval !== undefined) {
    clearInterval(pomoInterval)
    pomoInterval = undefined
  }
}

async function loadPomos() {
  try {
    pomoRecords.value = (await pomodorosRepo.listAll())
      .sort((a, b) => (b.id || 0) - (a.id || 0))
      .slice(0, pomoLimit.value)
  } catch {
    pomoRecords.value = []
  }
}

function showMorePomos() {
  pomoLimit.value += 50
  loadPomos()
}

// 倒计时按结束时间戳计算，避免切窗口被节流后每秒自减产生漂移
function startPomo() {
  if (pomoRunning.value) return
  pomoRunning.value = true
  pomoLeft.value = pomoMinutes.value * 60
  pomoEndsAt.value = Date.now() + pomoMinutes.value * 60 * 1000
  clearPomoInterval()
  pomoInterval = window.setInterval(() => {
    const left = Math.max(0, Math.round((pomoEndsAt.value - Date.now()) / 1000))
    pomoLeft.value = left
    if (left <= 0) completePomo()
  }, 250)
}

// 暂停只是中断，不产生记录；此前会误写一条未完成记录
function stopPomo() {
  clearPomoInterval()
  pomoRunning.value = false
  pomoLeft.value = 0
}

async function completePomo() {
  clearPomoInterval()
  pomoRunning.value = false
  pomoLeft.value = 0
  try {
    await pomodorosRepo.insert({ task: pomoTask.value || '专注', minutes: pomoMinutes.value, startedAt: nowStamp(), completed: 1 })
    message.success('番茄钟完成，休息一下吧')
    loadPomos()
  } catch {
    message.error('记录保存失败')
  }
}

// ---- 专注记录增删改 ----
const pomoFormShow = ref(false)
const pomoEditing = ref<Pomodoro | null>(null)
const pomoFields: FieldDef[] = [
  { key: 'task', label: '专注内容', required: true, placeholder: '例如：写周报' },
  { key: 'minutes', label: '时长（分钟）', type: 'number', required: true },
  { key: 'startedAt', label: '开始时间', type: 'date', required: true },
  { key: 'completed', label: '是否完成', type: 'select', options: [
    { label: '已完成', value: 1 }, { label: '未完成', value: 0 },
  ] },
]

function openPomoAdd() {
  pomoEditing.value = null
  pomoFormShow.value = true
}

function openPomoEdit(p: Pomodoro) {
  pomoEditing.value = p
  pomoFormShow.value = true
}

async function submitPomo(v: Record<string, unknown>) {
  const patch = {
    task: String(v.task || '').trim(),
    minutes: Number(v.minutes) || 0,
    startedAt: String(v.startedAt || nowStamp()),
    completed: Number(v.completed ?? 1),
  }
  try {
    if (pomoEditing.value) {
      await pomodorosRepo.update(pomoEditing.value.id, patch)
      message.success('已保存')
    } else {
      await pomodorosRepo.insert(patch)
      message.success('已添加')
    }
    loadPomos()
  } catch {
    message.error('保存失败')
  }
}

async function removePomo(p: Pomodoro) {
  const ok = await confirm({ title: '删除这条专注记录？', content: `${p.task || '专注'} · ${p.minutes} 分钟` })
  if (!ok) return
  try {
    await pomodorosRepo.remove(p.id)
    message.success('已删除')
    loadPomos()
  } catch {
    message.error('删除失败')
  }
}

// 统计按 startedAt 的日期前缀判定，不依赖当前列表截断范围
const pomoDoneCount = computed(() => pomoRecords.value.filter((p) => p.completed === 1 && (p.startedAt || '').slice(0, 10) === todayStr).length)

// ---- 健康记录（F-LIFE-06）----
const healthRecords = ref<HealthLog[]>([])
const healthToday = ref<{ date: string; sleepHours: number; exerciseMin: number; mood: number; weight: string; note: string }>({
  date: todayStr,
  sleepHours: 7,
  exerciseMin: 30,
  mood: 3,
  weight: '',
  note: '',
})
const moodLabels = ['', '很差', '较差', '一般', '不错', '很好']

async function loadHealth() {
  try {
    const all = await healthLogsRepo.listAll()
    healthRecords.value = [...all].sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 20)
  } catch {
    healthRecords.value = []
  }
}

async function saveHealth() {
  const v = healthToday.value
  const patch = {
    date: v.date || todayStr,
    sleepHours: Number(v.sleepHours),
    exerciseMin: Number(v.exerciseMin),
    mood: Number(v.mood),
    weight: v.weight ? Number(v.weight) : undefined,
    note: v.note || '',
  }
  try {
    // 同一天只应有一条记录：表单里选中了已有日期时改为更新，避免重复打卡产生多行
    if (healthEditId.value !== null) {
      await healthLogsRepo.update(healthEditId.value, patch)
      healthEditId.value = null
      message.success('健康记录已更新')
    } else {
      await healthLogsRepo.insert(patch)
      message.success('健康记录已保存')
    }
    loadHealth()
  } catch {
    message.error('保存失败（请通过 npm run tauri dev 启动）')
  }
}

// ---- 编辑健康记录 ----
// 复用上方那张录入表单（不新增弹窗、不动布局）：点行的「编辑」把该行回填进表单，
// 保存时走 update 分支。healthLogs 业务列：date/sleepHours/exerciseMin/mood/weight/note
const healthEditId = ref<number | null>(null)

function openEditHealth(h: HealthLog) {
  healthEditId.value = h.id
  healthToday.value = {
    date: h.date || todayStr,
    sleepHours: h.sleepHours ?? 0,
    exerciseMin: h.exerciseMin ?? 0,
    mood: h.mood ?? 3,
    weight: h.weight === null || h.weight === undefined ? '' : String(h.weight),
    note: h.note ?? '',
  }
}

function cancelEditHealth() {
  healthEditId.value = null
  healthToday.value = { date: todayStr, sleepHours: 7, exerciseMin: 30, mood: 3, weight: '', note: '' }
}

onUnmounted(clearPomoInterval)

// ---- F-LIFE-02 打卡热力图 ----
const heatWeeks = computed(() => {
  // 以今天为最后一天，向前推 16 周，按周分组，0=周日
  const weeks: { date: string; level: number }[][] = []
  const cells: { date: string; level: number }[] = []
  const countByDate = new Map<string, number>()
  habitLogs.value.forEach((l) => countByDate.set(l.date, (countByDate.get(l.date) || 0) + 1))
  const end = new Date()
  const start = new Date()
  start.setDate(end.getDate() - 111)
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const s = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const c = countByDate.get(s) || 0
    const max = Math.max(1, habits.value.length)
    cells.push({ date: s, level: c === 0 ? 0 : c >= max ? 3 : c >= Math.ceil(max / 2) ? 2 : 1 })
  }
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))
  return weeks
})

// ---- F-LIFE-04 固定账单 ----
const billFields: FieldDef[] = [
  { key: 'name', label: '账单名称', required: true },
  { key: 'amount', label: '金额', type: 'number' },
  { key: 'category', label: '分类', options: [
    { label: '房租', value: '房租' }, { label: '订阅', value: '订阅' }, { label: '会员', value: '会员' },
    { label: '保险', value: '保险' }, { label: '话费', value: '话费' }, { label: '其他', value: '其他' },
  ] },
  { key: 'cycle', label: '周期', type: 'select', options: [
    { label: '每月', value: 'monthly' }, { label: '每季度', value: 'quarterly' }, { label: '每年', value: 'yearly' }, { label: '每周', value: 'weekly' },
  ] },
  { key: 'dueDay', label: '扣款日（1~31）', type: 'number' },
  { key: 'payMethod', label: '支付方式' },
  { key: 'status', label: '状态', type: 'select', options: [
    { label: '启用', value: 'active' }, { label: '暂停', value: 'paused' },
  ] },
  { key: 'note', label: '备注', span: 2 },
]
async function addBill(v: Record<string, unknown>) {
  try {
    await fixedBillsRepo.insert({
      name: String(v.name), amount: Number(v.amount || 0), category: String(v.category || '订阅'),
      cycle: String(v.cycle || 'monthly'), dueDay: Number(v.dueDay || 1),
      payMethod: String(v.payMethod || ''), status: String(v.status || 'active'), note: String(v.note || ''),
    })
    message.success('固定账单已添加')
    load()
  } catch { message.error('保存失败（请通过 npm run tauri dev 启动）') }
}
async function removeBill(b: FixedBill) {
  const ok = await confirm({ title: '删除这笔固定账单？', content: `${b.name} · ${b.amount} 元` })
  if (!ok) return
  try { await fixedBillsRepo.remove(b.id); message.success('已删除'); load() } catch { message.error('删除失败') }
}

// ---- 编辑固定账单 ----
// fixedBills 的可编辑业务列：name/amount/category/cycle/dueDay/payMethod/status/note
const editBillShow = ref(false)
const editBillId = ref<number | null>(null)
const editBillForm = ref<Record<string, unknown>>({})

function openEditBill(b: FixedBill) {
  editBillId.value = b.id
  editBillForm.value = {
    name: b.name, amount: b.amount ?? 0, category: b.category ?? '订阅',
    cycle: b.cycle ?? 'monthly', dueDay: b.dueDay ?? 1, payMethod: b.payMethod ?? '',
    status: b.status ?? 'active', note: b.note ?? '',
  }
  editBillShow.value = true
}

async function saveEditBill(v: Record<string, unknown>) {
  if (editBillId.value === null) return
  try {
    await fixedBillsRepo.update(editBillId.value, {
      name: String(v.name || ''), amount: Number(v.amount || 0), category: String(v.category || '订阅'),
      cycle: String(v.cycle || 'monthly'), dueDay: Number(v.dueDay || 1),
      payMethod: String(v.payMethod || ''), status: String(v.status || 'active'), note: String(v.note || ''),
    })
    message.success('已更新')
    editBillShow.value = false
    load()
  } catch { message.error('保存失败') }
}
const billDueSoon = computed(() => {
  const day = today.getDate()
  return bills.value.filter((b) => b.status !== 'paused' && (b.dueDay >= day ? b.dueDay - day : b.dueDay + (30 - day)) <= 3)
})
const billMonthlyTotal = computed(() =>
  bills.value.filter((b) => b.status !== 'paused').reduce((s, b) => s + b.amount * (b.cycle === 'yearly' ? 1 / 12 : b.cycle === 'quarterly' ? 1 / 3 : b.cycle === 'weekly' ? 52 / 12 : 1), 0),
)

// ---- F-LIFE-05 到期聚合 / F-LIFE-07 杂事清单 / F-LIFE-09 成本收益 ----
// ---- F-LIFE-06 倒计时牌 ----
const countdownList = computed(() =>
  [...deadlines.value]
    .filter((d) => d.status !== 'done')
    .map((d) => {
      const target = new Date(d.dueDate + 'T23:59:59').getTime()
      const days = Math.ceil((target - Date.now()) / 86400000)
      return { ...d, days }
    })
    .sort((a, b) => a.days - b.days),
)
const cdColor = (days: number) => (days < 0 ? 'var(--wb-danger)' : days <= 3 ? 'var(--wb-warning, #d97706)' : 'var(--wb-success)')

const dueAggregated = computed(() =>
  [...deadlines.value]
    .filter((d) => d.status === 'open')
    .map((d) => {
      const ms = new Date(d.dueDate).getTime() - Date.now()
      return { ...d, days: Math.ceil(ms / 86400000) }
    })
    .filter((d) => d.days <= 30)
    .sort((a, b) => a.days - b.days),
)
async function toggleChore(t: Task) {
  try { await tasksRepo.update(t.id, { status: t.status === 'done' ? 'todo' : 'done' }); t.status = t.status === 'done' ? 'todo' : 'done' } catch { message.error('更新失败') }
}
async function removeChore(t: Task) {
  const ok = await confirm({ title: '删除这条事务？', content: t.title || '未命名事务' })
  if (!ok) return
  try { await tasksRepo.remove(t.id); message.success('已删除'); load() } catch { message.error('删除失败') }
}
const choreFormShow = ref(false)
const choreText = ref('')
async function addChore() {
  const title = choreText.value.trim()
  if (!title) { message.warning('请输入事项'); return }
  try {
    await tasksRepo.insert({ title, scope: 'life', type: 'life', status: 'todo', priority: 'medium' })
    message.success('已加入杂事清单')
    choreText.value = ''
    choreFormShow.value = false
    load()
  } catch { message.error('保存失败（请通过 npm run tauri dev 启动）') }
}

// ---- 编辑杂事 ----
// 杂事复用 tasks 表，可编辑业务列取自 schema.ts：title/status/priority/dueDate/note。
// scope/type 决定它出现在「生活杂事」列表里（load 里按 scope==='life' || type==='life' 过滤），
// 编辑时不下发这两个字段，避免改坏归属。
const editChoreShow = ref(false)
const editChoreId = ref<number | null>(null)
const editChoreForm = ref<Record<string, unknown>>({})
const choreFields: FieldDef[] = [
  { key: 'title', label: '事项', required: true, span: 2 },
  { key: 'priority', label: '优先级', type: 'select', options: [
    { label: '低', value: 'low' }, { label: '中', value: 'medium' }, { label: '高', value: 'high' }, { label: '紧急', value: 'urgent' },
  ] },
  { key: 'status', label: '状态', type: 'select', options: [
    { label: '待办', value: 'todo' }, { label: '进行中', value: 'doing' }, { label: '已完成', value: 'done' },
  ] },
  { key: 'dueDate', label: '截止日期', type: 'date' },
  { key: 'note', label: '备注', span: 2 },
]

function openEditChore(t: Task) {
  editChoreId.value = t.id
  editChoreForm.value = {
    title: t.title, priority: t.priority ?? 'medium',
    status: t.status ?? 'todo', dueDate: t.dueDate ?? '', note: t.note ?? '',
  }
  editChoreShow.value = true
}

async function saveEditChore(v: Record<string, unknown>) {
  if (editChoreId.value === null) return
  try {
    await tasksRepo.update(editChoreId.value, {
      title: String(v.title || ''), priority: String(v.priority || 'medium'),
      status: String(v.status || 'todo'),
      dueDate: v.dueDate ? String(v.dueDate) : undefined,
      note: String(v.note || ''),
    })
    message.success('已更新')
    editChoreShow.value = false
    load()
  } catch { message.error('保存失败') }
}
const costBars = computed(() => {
  const map = new Map<string, { expense: number; income: number }>()
  ledger.value.forEach((e) => {
    const ym = (e.date || '').slice(0, 7)
    if (!ym) return
    const cur = map.get(ym) || { expense: 0, income: 0 }
    if (e.type === 'expense') cur.expense += e.amount
    else cur.income += e.amount
    map.set(ym, cur)
  })
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-6)
})
const maxCost = computed(() => Math.max(1, ...costBars.value.map(([, v]) => Math.max(v.expense, v.income))))

// ---- 列表搜索 ----
// 每张表只按「人认得出来的那几列」匹配，不逐字段全扫。
const ledgerKw = ref('')
const pomoKw = ref('')
const healthKw = ref('')
const billKw = ref('')


const filteredLedger = computed(() => recentLedger.value.filter((e) => matchKw(ledgerKw.value, e.category, e.note, e.type, e.date, e.amount)))
const filteredPomoRecords = computed(() => pomoRecords.value.filter((p) => matchKw(pomoKw.value, p.task, p.startedAt, p.minutes)))
const filteredHealthRecords = computed(() => healthRecords.value.filter((h) => matchKw(healthKw.value, h.date, h.note, h.sleepHours, h.exerciseMin, h.mood, h.weight)))
const filteredBills = computed(() => bills.value.filter((b) => matchKw(billKw.value, b.name, b.category, b.cycle, b.payMethod, b.note, b.amount)))

// ---- 提醒聚合 ----
const remindItems = computed(() => {
  const items: { kind: string; text: string; color: 'warning' | 'error' | 'info' | 'default' }[] = []
  billDueSoon.value.forEach((b) => items.push({ kind: '账单', text: `${b.name} ${b.dueDay} 日扣款 ¥${b.amount}`, color: 'warning' }))
  dueAggregated.value.slice(0, 5).forEach((d) => items.push({ kind: '到期', text: `${d.title}（${d.days} 天后）`, color: d.days <= 3 ? 'error' : 'info' }))
  const pending = chores.value.filter((t) => t.status !== 'done').length
  if (pending) items.push({ kind: '杂事', text: `还有 ${pending} 件杂事待办`, color: 'default' })
  return items
})

// ---- 列表键盘导航（↑↓ 选择 · Enter 执行行首操作 · Esc 取消高亮）----
// 与 DevView 任务表同一套写法：容器 ref + rowSelector，高亮态由 main.css 的
// [data-wb-cursor='true'] 统一提供，这里不碰样式。
// 约定：Enter 只绑非破坏性操作；删除一律保留给按钮（二次确认），不接 Enter。

// 习惯卡片：最高频操作是「今天打卡 / 取消打卡」
const habitGridEl = ref<HTMLElement>()
useListNav(habitGridEl, {
  rowSelector: '.habit-card',
  enabled: () => !loading.value && tab.value === 'habits',
  onEnter: (el) => {
    const id = Number(el.getAttribute('data-row-id'))
    const row = habits.value.find((h) => h.id === id)
    if (row) void toggleHabit(row)
  },
})

// 记账明细：行级只有删除（需二次确认），因此只提供 ↑↓ 浏览，不绑 Enter
const ledgerTableEl = ref<HTMLElement>()
useListNav(ledgerTableEl, {
  rowSelector: '.l-row:not(.head)',
  enabled: () => !loading.value && tab.value === 'ledger',
})

// 专注记录：Enter 打开编辑弹窗（行内有编辑/删除两个按钮，取非破坏性的那个）
const pomoRecordsEl = ref<HTMLElement>()
useListNav(pomoRecordsEl, {
  rowSelector: '.pr-row:not(.head)',
  enabled: () => !loading.value && tab.value === 'pomo',
  onEnter: (el) => {
    const id = Number(el.getAttribute('data-row-id'))
    const row = pomoRecords.value.find((p) => p.id === id)
    if (row) openPomoEdit(row)
  },
})

// 健康记录：只读表格，行级无操作，只提供 ↑↓ 浏览
const healthTableEl = ref<HTMLElement>()
useListNav(healthTableEl, {
  rowSelector: '.ht-row:not(.head)',
  enabled: () => !loading.value && tab.value === 'health',
})

// 固定账单：行级只有删除（需二次确认），只提供 ↑↓ 浏览
const billTableEl = ref<HTMLElement>()
useListNav(billTableEl, {
  rowSelector: '.l-row:not(.head)',
  enabled: () => !loading.value && tab.value === 'bills',
})

// 杂事清单：Enter 切换完成 / 待办
// （注意：同一 Tab 的「30 天内到期」卡片里也有 .bc-row，两个结合各自容器 ref 分隔，互不干扰）
const choreListEl = ref<HTMLElement>()
useListNav(choreListEl, {
  rowSelector: '.bc-row',
  enabled: () => !loading.value && tab.value === 'board',
  onEnter: (el) => {
    const id = Number(el.getAttribute('data-row-id'))
    const row = chores.value.find((t) => t.id === id)
    if (row) void toggleChore(row)
  },
})

// 生活看板「30 天内到期」：只读聚合列表，只提供 ↑↓ 浏览
const dueListEl = ref<HTMLElement>()
useListNav(dueListEl, {
  rowSelector: '.bc-row',
  enabled: () => !loading.value && tab.value === 'board',
})

// 倒计时牌：只读卡片网格，只提供 ↑↓ 浏览
const countdownGridEl = ref<HTMLElement>()
useListNav(countdownGridEl, {
  rowSelector: '.cd-card',
  enabled: () => !loading.value && tab.value === 'countdown',
})
</script>

<template>
  <div>

    <n-tabs v-model:value="tab" type="line" class="wb-tabs">
      <!-- 习惯打卡 -->
      <n-tab-pane name="habits" tab="习惯打卡">
        <div class="toolbar">
          <NButton size="small" type="primary" ghost @click="habitFormShow = true">
            <template #icon><NIcon :component="Plus" /></template>
            新建习惯
          </NButton>
        </div>
        <ListSkeleton v-if="loading" :rows="3" />
        <div v-else-if="habits.length" class="habit-grid" ref="habitGridEl" tabindex="0" :aria-label="'习惯列表，共 ' + habits.length + ' 行，↑↓ 选择、Enter 打卡/取消打卡'">
          <div v-for="h in habits" :key="h.id" class="habit-card wb-card" :data-row-id="h.id">
            <div class="hc-top">
              <span class="hc-name" :style="{ color: h.color }">{{ h.name }}</span>
              <span class="mono streak">连续 {{ habitStreak(h.id) }} 天</span>
            </div>
            <div class="hc-ops">
              <NButton
                size="small"
                :type="checkedToday(h.id) ? 'success' : 'default'"
                ghost
                @click="toggleHabit(h)"
              >
                <template #icon><NIcon :component="Check" /></template>
                {{ checkedToday(h.id) ? '已打卡' : '打卡' }}
              </NButton>
              <NButton size="tiny" text type="primary" @click="openEditHabit(h)">编辑</NButton>
              <NButton size="tiny" text type="error" @click="removeHabit(h)"><template #icon><NIcon :component="Trash" /></template></NButton>
            </div>
          </div>
        </div>
        <EmptyState v-else text="暂无习惯，新建一个开始打卡" />
        <ModalForm v-model:show="editHabitShow" title="编辑习惯" :fields="habitFields" :initial="editHabitForm" confirm-text="保存" @submit="saveEditHabit" />
      </n-tab-pane>

      <!-- 极简记账 -->
      <n-tab-pane name="ledger" tab="极简记账">
        <div class="ledger-stats">
          <div class="ledger-stat wb-card">
            <div class="ls-label">本月支出</div>
            <div class="ls-value mono">¥{{ monthExpense.toFixed(2) }}</div>
          </div>
          <div class="ledger-stat wb-card">
            <div class="ls-label">累计收入</div>
            <div class="ls-value mono" style="color: var(--wb-success)">¥{{ incomeTotal.toFixed(2) }}</div>
          </div>
          <div class="ledger-stat wb-card">
            <div class="ls-label">累计支出</div>
            <div class="ls-value mono" style="color: var(--wb-danger)">¥{{ expenseTotal.toFixed(2) }}</div>
          </div>
          <div class="ledger-stat wb-card">
            <div class="ls-label">结余</div>
            <div class="ls-value mono" :style="balance >= 0 ? 'color: var(--wb-success)' : 'color: var(--wb-danger)'">¥{{ balance.toFixed(2) }}</div>
          </div>
        </div>
        <div class="toolbar toolbar-split">
          <NInput v-if="recentLedger.length" v-model:value="ledgerKw" size="small" placeholder="搜索记账（分类 / 备注 / 金额）…" clearable class="toolbar-search" />
          <NButton size="small" type="primary" ghost @click="ledgerFormShow = true">
            <template #icon><NIcon :component="Plus" /></template>
            记一笔
          </NButton>
        </div>
        <ListSkeleton v-if="loading" :rows="5" />
        <div v-else-if="filteredLedger.length" class="ledger-table" ref="ledgerTableEl" tabindex="0" :aria-label="'记账明细列表，共 ' + filteredLedger.length + ' 行，↑↓ 选择'">
          <div class="l-row head">
            <span>日期</span><span>类型</span><span>分类</span><span>金额</span><span>备注</span><span></span>
          </div>
          <div v-for="e in filteredLedger" :key="e.id" class="l-row" :data-row-id="e.id">
            <span class="mono">{{ e.date }}</span>
            <span><NTag size="tiny" :bordered="false" :type="e.type === 'income' ? 'success' : 'default'">{{ e.type === 'income' ? '收入' : '支出' }}</NTag></span>
            <span>{{ e.category }}</span>
            <span class="mono" :style="e.type === 'income' ? 'color: var(--wb-success)' : ''">
              {{ e.type === 'income' ? '+' : '-' }}¥{{ e.amount.toFixed(2) }}
            </span>
            <span class="l-note">{{ e.note || '—' }}</span>
            <span style="text-align: right">
              <NButton size="tiny" text type="primary" @click="openEditLedger(e)">编辑</NButton>
              <NButton size="tiny" text type="error" @click="removeLedger(e)"><template #icon><NIcon :component="Trash" /></template></NButton>
            </span>
          </div>
        </div>
        <EmptyState v-else :text="recentLedger.length ? '没有匹配的记账记录' : '暂无记账记录'" />
        <ModalForm v-model:show="editLedgerShow" title="编辑记账" :fields="ledgerFields" :initial="editLedgerForm" confirm-text="保存" @submit="saveEditLedger" />
      </n-tab-pane>

      <!-- 番茄钟 -->
      <n-tab-pane name="pomo" tab="番茄钟">
        <div class="pomo-panel wb-card">
          <div class="pomo-clock mono" :style="pomoRunning && pomoLeft <= 300 ? 'color: var(--wb-danger)' : ''">{{ fmtClock(pomoLeft) }}</div>
          <div class="pomo-config">
            <NInput v-model:value="pomoTask" size="small" placeholder="本次专注任务（可选）" clearable style="width: 220px" />
            <NInputNumber v-model:value="pomoMinutes" size="small" :min="1" :max="120" :disabled="pomoRunning" style="width: 100px" />
            <span class="dim" style="font-size: 12px">分钟</span>
          </div>
          <div class="pomo-ops">
            <NButton v-if="!pomoRunning" size="small" type="primary" ghost @click="startPomo()">
              <template #icon><NIcon :component="Check" /></template>
              开始
            </NButton>
            <NButton v-else size="small" type="warning" ghost @click="stopPomo()">暂停</NButton>
          </div>
        </div>
        <div class="pomo-stats">
          <div class="pomo-stat wb-card">
            <span class="dim">今日已完成</span>
            <span class="mono pomo-stat-num">{{ pomoDoneCount }} 个</span>
          </div>
          <div class="pomo-stat wb-card">
            <span class="dim">累计专注</span>
            <span class="mono pomo-stat-num">{{ pomoRecords.filter((p) => p.completed === 1).reduce((s, p) => s + (p.minutes || 0), 0) }} 分钟</span>
          </div>
        </div>
        <div class="sec-head" style="margin-top: 12px">
          <span class="sec-title">专注记录</span>
          <NInput v-if="pomoRecords.length" v-model:value="pomoKw" size="small" placeholder="搜索专注记录（任务 / 开始时间）…" clearable class="toolbar-search" />
          <NButton size="tiny" secondary @click="openPomoAdd()">
            <template #icon><NIcon :component="Plus" /></template>
            手动添加
          </NButton>
        </div>
        <ListSkeleton v-if="loading" :rows="4" />
        <div v-else-if="filteredPomoRecords.length" class="pomo-records" ref="pomoRecordsEl" tabindex="0" :aria-label="'专注记录列表，共 ' + filteredPomoRecords.length + ' 行，↑↓ 选择、Enter 编辑'">
          <div class="pr-row head">
            <span>任务</span><span>时长</span><span>开始时间</span><span>状态</span><span>操作</span>
          </div>
          <div v-for="p in filteredPomoRecords" :key="p.id" class="pr-row" :data-row-id="p.id">
            <span>{{ p.task || '专注' }}</span>
            <span class="mono">{{ p.minutes }} 分钟</span>
            <span class="mono">{{ p.startedAt || '—' }}</span>
            <span><NTag size="tiny" :bordered="false" :type="p.completed === 1 ? 'success' : 'warning'">{{ p.completed === 1 ? '已完成' : '中断' }}</NTag></span>
            <span class="pr-ops">
              <NButton size="tiny" quaternary @click="openPomoEdit(p)">编辑</NButton>
              <NButton size="tiny" quaternary type="error" @click="removePomo(p)">
                <template #icon><NIcon :component="Trash" /></template>
              </NButton>
            </span>
          </div>
          <div v-if="pomoRecords.length >= pomoLimit" class="pr-more">
            <NButton size="tiny" quaternary @click="showMorePomos()">加载更多</NButton>
          </div>
        </div>
        <EmptyState v-else :text="pomoRecords.length ? '没有匹配的专注记录' : '暂无专注记录，可跑一个番茄钟或手动添加'" />
        <ModalForm
          v-model:show="pomoFormShow"
          :title="pomoEditing ? '编辑专注记录' : '添加专注记录'"
          :fields="pomoFields"
          :initial="pomoEditing ? { task: pomoEditing.task, minutes: pomoEditing.minutes, startedAt: (pomoEditing.startedAt || '').slice(0, 10), completed: pomoEditing.completed } : { task: '', minutes: 25, startedAt: todayStr, completed: 1 }"
          @submit="submitPomo"
        />
      </n-tab-pane>

      <!-- 健康记录 -->
      <n-tab-pane name="health" tab="健康记录">
        <div class="health-form wb-card">
          <div v-if="healthEditId !== null" class="hf-edit-bar">
            <span>正在编辑历史记录（{{ healthToday.date }}），保存后将覆盖该条</span>
            <NButton size="tiny" quaternary @click="cancelEditHealth()">取消编辑</NButton>
          </div>
          <div class="hf-row">
            <NDatePicker v-model:formatted-value="healthToday.date" type="date" size="small" value-format="yyyy-MM-dd" style="width: 140px" />
          </div>
          <div class="hf-row">
            <span class="hf-label">睡眠（小时）</span>
            <NInputNumber v-model:value="healthToday.sleepHours" size="small" :min="0" :max="24" :step="0.5" style="width: 110px" />
          </div>
          <div class="hf-row">
            <span class="hf-label">运动（分钟）</span>
            <NInputNumber v-model:value="healthToday.exerciseMin" size="small" :min="0" :max="600" style="width: 110px" />
          </div>
          <div class="hf-row">
            <span class="hf-label">心情</span>
            <NSlider v-model:value="healthToday.mood" :min="1" :max="5" :step="1" style="width: 200px" />
            <span class="mono hf-mood">{{ moodLabels[healthToday.mood] || '' }}</span>
          </div>
          <div class="hf-row">
            <span class="hf-label">体重（kg）</span>
            <NInput v-model:value="healthToday.weight" size="small" placeholder="选填" clearable style="width: 110px" />
          </div>
          <div class="hf-row">
            <NInput v-model:value="healthToday.note" size="small" placeholder="备注（选填）" clearable style="width: 260px" />
          </div>
          <NButton size="small" type="primary" ghost @click="saveHealth()">保存今日记录</NButton>
        </div>
        <div class="toolbar toolbar-split">
          <NInput v-if="healthRecords.length" v-model:value="healthKw" size="small" placeholder="搜索健康记录（日期 / 备注）…" clearable class="toolbar-search" />
        </div>
        <ListSkeleton v-if="loading" :rows="5" />
        <div v-else-if="filteredHealthRecords.length" class="health-table" ref="healthTableEl" tabindex="0" :aria-label="'健康记录列表，共 ' + filteredHealthRecords.length + ' 行，↑↓ 选择'">
          <div class="ht-row head">
            <span>日期</span><span>睡眠</span><span>运动</span><span>心情</span><span>体重</span><span>备注</span><span></span>
          </div>
          <div v-for="h in filteredHealthRecords" :key="h.id" class="ht-row" :data-row-id="h.id">
            <span class="mono">{{ h.date }}</span>
            <span class="mono">{{ h.sleepHours ?? '—' }}</span>
            <span class="mono">{{ h.exerciseMin ?? '—' }}</span>
            <span class="mono">{{ h.mood ? moodLabels[h.mood] || h.mood : '—' }}</span>
            <span class="mono">{{ h.weight ?? '—' }}</span>
            <span class="ht-note">{{ h.note || '—' }}</span>
            <span style="text-align: right">
              <NButton size="tiny" text type="primary" @click="openEditHealth(h)">编辑</NButton>
            </span>
          </div>
        </div>
        <EmptyState v-else :text="healthRecords.length ? '没有匹配的健康记录' : '暂无健康记录'" />
      </n-tab-pane>

      <!-- 打卡热力图 F-LIFE-02 -->
      <n-tab-pane name="heatmap" tab="热力图">
        <div class="review-head" style="margin-bottom: 12px">近 16 周打卡热力图：格内颜色越深代表当天打卡习惯数越多</div>
        <div class="heat-wrap wb-card">
          <div v-for="(week, wi) in heatWeeks" :key="wi" class="heat-col">
            <div
              v-for="cell in week" :key="cell.date"
              class="heat-cell"
              :class="'lvl' + cell.level"
              :title="cell.date"
            ></div>
          </div>
          <div class="heat-legend">
            <span class="heat-cell lvl0"></span><span class="dim">少</span>
            <span class="heat-cell lvl1"></span>
            <span class="heat-cell lvl2"></span>
            <span class="heat-cell lvl3"></span><span class="dim">多</span>
          </div>
        </div>
      </n-tab-pane>

      <!-- 固定账单 F-LIFE-04 -->
      <n-tab-pane name="bills" tab="固定账单">
        <div class="toolbar toolbar-split">
          <NInput v-if="bills.length" v-model:value="billKw" size="small" placeholder="搜索固定账单（名称 / 分类 / 周期）…" clearable class="toolbar-search" />
          <NButton size="small" type="primary" ghost @click="billFormShow = true">
            <template #icon><NIcon :component="Plus" /></template>
            添加固定账单
          </NButton>
        </div>
        <div class="ledger-stats">
          <div class="ledger-stat wb-card">
            <span class="ls-label">启用账单</span>
            <span class="ls-value">{{ bills.filter((b) => b.status !== 'paused').length }} 项</span>
          </div>
          <div class="ledger-stat wb-card">
            <span class="ls-label">月均固定支出</span>
            <span class="ls-value mono">¥{{ billMonthlyTotal.toFixed(2) }}</span>
          </div>
          <div class="ledger-stat wb-card">
            <span class="ls-label">3 日内扣款</span>
            <span class="ls-value" style="color: var(--wb-warning, #f0a020)">{{ billDueSoon.length }} 项</span>
          </div>
          <div class="ledger-stat wb-card">
            <span class="ls-label">年固定支出</span>
            <span class="ls-value mono">¥{{ (billMonthlyTotal * 12).toFixed(0) }}</span>
          </div>
        </div>
        <div v-if="billDueSoon.length" class="remind-list wb-card" style="margin-bottom: 12px">
          <span class="remind-title">即将扣款提醒</span>
          <div v-for="b in billDueSoon" :key="b.id" class="remind-item">
            <NTag size="tiny" :bordered="false" type="warning">{{ b.category }}</NTag>
            <span>{{ b.name }} · {{ b.dueDay }} 日 · ¥{{ b.amount.toFixed(2) }}</span>
          </div>
        </div>
        <ListSkeleton v-if="loading" :rows="4" />
        <div v-else-if="filteredBills.length" class="ledger-table" ref="billTableEl" tabindex="0" :aria-label="'固定账单列表，共 ' + filteredBills.length + ' 行，↑↓ 选择'">
          <div class="l-row head">
            <span>名称</span><span>分类</span><span>金额</span><span>周期</span><span>扣款日</span><span>状态</span><span></span>
          </div>
          <div v-for="b in filteredBills" :key="b.id" class="l-row" :data-row-id="b.id">
            <span>{{ b.name }}</span>
            <span><NTag size="tiny" :bordered="false" :type="b.status === 'active' ? 'info' : 'default'">{{ b.category }}</NTag></span>
            <span class="mono">¥{{ b.amount.toFixed(2) }}</span>
            <span class="mono">{{ { monthly: '每月', quarterly: '每季', yearly: '每年', weekly: '每周' }[b.cycle] || b.cycle }}</span>
            <span class="mono">{{ b.dueDay }} 日</span>
            <span><NTag size="tiny" :bordered="false" :type="b.status === 'active' ? 'success' : 'default'">{{ b.status === 'active' ? '启用' : '暂停' }}</NTag></span>
            <span style="text-align: right">
              <NButton size="tiny" text type="primary" @click="openEditBill(b)">编辑</NButton>
              <NButton size="tiny" text type="error" @click="removeBill(b)"><template #icon><NIcon :component="Trash" /></template></NButton>
            </span>
          </div>
        </div>
        <EmptyState v-else :text="bills.length ? '没有匹配的固定账单' : '暂无固定账单'" />
        <ModalForm v-model:show="editBillShow" title="编辑固定账单" :fields="billFields" :initial="editBillForm" confirm-text="保存" @submit="saveEditBill" />
      </n-tab-pane>

      <!-- 生活看板 F-LIFE-05/07/09 -->
      <n-tab-pane name="board" tab="生活看板">
        <div v-if="remindItems.length" class="remind-list wb-card" style="margin-bottom: 12px">
          <span class="remind-title">今日提醒</span>
          <div v-for="(r, i) in remindItems" :key="i" class="remind-item">
            <NTag size="tiny" :bordered="false" :type="r.color">{{ r.kind }}</NTag>
            <span>{{ r.text }}</span>
          </div>
        </div>
        <div class="board-grid">
          <div class="wb-card board-card">
            <header class="bc-head"><span>30 天内到期（F-LIFE-05）</span></header>
            <div v-if="dueAggregated.length" class="bc-list" ref="dueListEl" tabindex="0" :aria-label="'到期事项列表，共 ' + dueAggregated.slice(0, 10).length + ' 行，↑↓ 选择'">
              <div v-for="d in dueAggregated.slice(0, 10)" :key="d.id" class="bc-row" :data-row-id="d.id">
                <NTag size="tiny" :bordered="false" :type="d.days <= 3 ? 'error' : d.days <= 7 ? 'warning' : 'info'">{{ d.days }} 天</NTag>
                <span>{{ d.title }}</span>
              </div>
            </div>
            <EmptyState v-else text="30 天内无到期事项" />
          </div>
          <div class="wb-card board-card">
            <header class="bc-head"><span>杂事清单（F-LIFE-07）</span>
              <NButton size="tiny" type="primary" ghost @click="choreFormShow = true"><template #icon><NIcon :component="Plus" /></template>添加</NButton>
            </header>
            <div v-if="chores.length" class="bc-list" ref="choreListEl" tabindex="0" :aria-label="'杂事清单，共 ' + chores.length + ' 行，↑↓ 选择、Enter 切换完成'">
              <div v-for="t in chores" :key="t.id" class="bc-row" style="justify-content: space-between" :data-row-id="t.id">
                <span :style="t.status === 'done' ? 'text-decoration: line-through; color: var(--wb-text-3)' : ''">
                  <NTag size="tiny" :bordered="false" :type="t.status === 'done' ? 'success' : 'default'" style="margin-right: 6px">{{ t.status === 'done' ? '完成' : '待办' }}</NTag>
                  {{ t.title }}
                </span>
                <span style="display: flex; gap: 2px">
                  <NButton size="tiny" text @click="toggleChore(t)"><template #icon><NIcon :component="Check" /></template></NButton>
                  <NButton size="tiny" text type="primary" @click="openEditChore(t)">编辑</NButton>
                  <NButton size="tiny" text type="error" @click="removeChore(t)"><template #icon><NIcon :component="Trash" /></template></NButton>
                </span>
              </div>
            </div>
            <EmptyState v-else text="杂事清单为空" />
          </div>
          <div class="wb-card board-card">
            <header class="bc-head"><span>成本收益（F-LIFE-09）</span></header>
            <div v-if="costBars.length" class="cost-bars">
              <div v-for="([ym, v]) in costBars" :key="ym" class="cb-row">
                <span class="mono cb-ym">{{ ym }}</span>
                <div class="cb-track">
                  <div class="cb-bar cb-exp" :style="{ width: (v.expense / maxCost * 100) + '%' }" title="支出"></div>
                  <div class="cb-bar cb-inc" :style="{ width: (v.income / maxCost * 100) + '%' }" title="收入"></div>
                </div>
                <span class="mono cb-val">¥{{ v.expense.toFixed(0) }}/{{ v.income.toFixed(0) }}</span>
              </div>
            </div>
            <EmptyState v-else text="暂无收支数据" />
          </div>
        </div>
      </n-tab-pane>

      <!-- 倒计时牌 F-LIFE-06 -->
      <n-tab-pane name="countdown" tab="倒计时牌">
        <div v-if="countdownList.length" class="cd-grid" ref="countdownGridEl" tabindex="0" :aria-label="'倒计时列表，共 ' + countdownList.length + ' 行，↑↓ 选择'">
          <div v-for="c in countdownList" :key="c.id" class="cd-card wb-card" :data-row-id="c.id">
            <div class="cd-days" :style="{ color: cdColor(c.days) }">{{ c.days >= 0 ? c.days + ' 天' : '已超 ' + Math.abs(c.days) + ' 天' }}</div>
            <div class="cd-title">{{ c.title }}</div>
            <div class="cd-sub dim mono">{{ c.dueDate }}</div>
            <div v-if="c.days >= 0 && c.days <= 7" class="cd-soon">临近，请优先处理</div>
          </div>
        </div>
        <EmptyState v-else text="暂无倒计时目标，可在课程/任务中创建带截止日期的项目" />
      </n-tab-pane>
    </n-tabs>

    <ModalForm v-model:show="habitFormShow" title="新建习惯" :fields="habitFields" @submit="addHabit" />
    <ModalForm v-model:show="ledgerFormShow" title="记一笔" :fields="ledgerFields" @submit="addLedger" />
    <ModalForm v-model:show="billFormShow" title="添加固定账单" :fields="billFields" @submit="addBill" />
    <ModalForm v-model:show="choreFormShow" title="添加杂事" @submit="addChore">
      <template #default>
        <NInput v-model:value="choreText" type="textarea" :rows="3" placeholder="要处理的生活杂事…" />
      </template>
    </ModalForm>
    <ModalForm v-model:show="editChoreShow" title="编辑杂事" :fields="choreFields" :initial="editChoreForm" confirm-text="保存" @submit="saveEditChore" />
  </div>
</template>

<style scoped>
.wb-tabs :deep(.n-tabs-nav) { margin-bottom: 14px; }
.toolbar { display: flex; justify-content: flex-end; margin-bottom: 12px; }
.toolbar-split { justify-content: space-between; align-items: center; gap: var(--wb-sp-3); }
.toolbar-search { max-width: 280px; }
.habit-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: var(--wb-sp-3);
}
.habit-card { padding: 14px 16px; }
.hc-top { display: flex; align-items: center; justify-content: space-between; gap: var(--wb-sp-2); }
.hc-name { font-size: var(--wb-fs-lg); font-weight: 600; }
.streak { font-size: 11.5px; color: var(--wb-text-3); }
.hc-ops { display: flex; align-items: center; justify-content: space-between; margin-top: 12px; }
.ledger-stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--wb-sp-3);
  margin-bottom: 14px;
}
@media (max-width: 1000px) {
  .ledger-stats { grid-template-columns: repeat(2, 1fr); }
}
.ledger-stat { padding: 14px 16px; }
.ls-label { font-size: var(--wb-fs-sm); color: var(--wb-text-2); }
.ls-value { font-size: 19px; font-weight: 650; margin-top: 2px; }
.ledger-table {
  border: 1px solid var(--wb-border);
  border-radius: var(--wb-radius-md);
  overflow: hidden;
}
.l-row {
  display: grid;
  grid-template-columns: 1fr 0.8fr 0.9fr 1.2fr 2fr 0.5fr;
  gap: var(--wb-sp-3);
  align-items: center;
  padding: 8px 14px;
  border-bottom: 1px solid var(--wb-border);
  font-size: 12.5px;
}
.l-row:last-child { border-bottom: none; }
.l-row.head {
  background: var(--wb-card-alt);
  font-weight: 600;
  color: var(--wb-text-2);
  font-size: var(--wb-fs-sm);
}
.l-note { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--wb-text-2); }
.pomo-panel { max-width: 520px; padding: 18px; display: flex; flex-direction: column; align-items: center; gap: var(--wb-sp-4); margin-bottom: 14px; }
.pomo-clock { font-size: 44px; font-weight: 700; line-height: 1; letter-spacing: 1px; }
.pomo-config { display: flex; align-items: center; gap: var(--wb-sp-3); }
.pomo-ops { display: flex; gap: var(--wb-sp-2); }
.pomo-stats { display: flex; gap: var(--wb-sp-3); margin-bottom: 14px; }
.pomo-stat { padding: 10px 16px; display: flex; flex-direction: column; gap: var(--wb-sp-1); }
.pomo-stat-num { font-size: var(--wb-fs-lg); font-weight: 650; }
.pomo-records, .health-table {
  border: 1px solid var(--wb-border);
  border-radius: var(--wb-radius-md);
  overflow: hidden;
}
.pr-row, .ht-row {
  display: grid;
  gap: var(--wb-sp-3);
  align-items: center;
  padding: 8px 14px;
  border-bottom: 1px solid var(--wb-border);
  font-size: 12.5px;
}
.pr-row { grid-template-columns: 2fr 0.8fr 1.6fr 0.8fr 1fr; }
.pr-ops { display: flex; align-items: center; gap: var(--wb-sp-1); justify-content: flex-end; }
.pr-more { padding: 8px 14px; text-align: center; border-top: 1px solid var(--wb-border); }
.sec-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.sec-title { font-size: var(--wb-fs-md); font-weight: 600; color: var(--wb-text-2); }
/* 末列是「编辑」操作列（健康记录可编辑后新增） */
.ht-row { grid-template-columns: 1fr 0.8fr 0.8fr 0.8fr 0.8fr 2fr 0.6fr; }
.hf-edit-bar {
  display: flex; align-items: center; justify-content: space-between; gap: var(--wb-sp-2);
  font-size: 12px; color: var(--wb-warning, #f0a020);
  background: color-mix(in srgb, var(--wb-warning, #f0a020) 10%, transparent);
  border-radius: var(--wb-radius-sm); padding: 5px 8px;
}
.pr-row:last-child, .ht-row:last-child { border-bottom: none; }
.pr-row.head, .ht-row.head {
  background: var(--wb-card-alt);
  font-weight: 600;
  color: var(--wb-text-2);
  font-size: var(--wb-fs-sm);
}
.ht-note { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--wb-text-2); }
.health-form { max-width: 520px; padding: 16px 18px; display: flex; flex-direction: column; gap: var(--wb-sp-3); margin-bottom: 14px; }
.hf-row { display: flex; align-items: center; gap: var(--wb-sp-3); }
.hf-label { width: 100px; font-size: 12.5px; color: var(--wb-text-2); flex: none; }
.hf-mood { font-size: 12.5px; color: var(--wb-module-life); width: 40px; }
.heat-wrap { padding: 14px; display: flex; gap: var(--wb-sp-1); align-items: flex-end; overflow-x: auto; }
.heat-col { display: flex; flex-direction: column; gap: var(--wb-sp-1); }
.heat-cell { width: 11px; height: 11px; border-radius: 2.5px; }
.heat-cell.lvl0 { background: var(--wb-card-alt); }
.heat-cell.lvl1 { background: color-mix(in srgb, var(--wb-success) 22%, var(--wb-card)); }
.heat-cell.lvl2 { background: color-mix(in srgb, var(--wb-success) 55%, var(--wb-card)); }
.heat-cell.lvl3 { background: var(--wb-success); }
.heat-legend { display: flex; align-items: center; gap: 5px; margin-left: 12px; font-size: var(--wb-fs-xs); color: var(--wb-text-3); }
.remind-list { padding: 10px 14px; display: flex; flex-direction: column; gap: var(--wb-sp-2); }
.remind-title { font-size: 12.5px; font-weight: 650; color: var(--wb-warning, #f0a020); }
.remind-item { display: flex; align-items: center; gap: var(--wb-sp-2); font-size: 12.5px; }
.board-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: var(--wb-sp-3); }
.board-card { padding: 14px 16px; display: flex; flex-direction: column; gap: var(--wb-sp-3); }
.bc-head { display: flex; align-items: center; justify-content: space-between; font-size: var(--wb-fs-md); font-weight: 650; }
.bc-list { display: flex; flex-direction: column; gap: var(--wb-sp-2); }
.bc-row { display: flex; align-items: center; gap: var(--wb-sp-2); font-size: 12.5px; }
.cost-bars { display: flex; flex-direction: column; gap: var(--wb-sp-2); }
.cb-row { display: flex; align-items: center; gap: var(--wb-sp-2); }
.cb-ym { width: 46px; flex: none; font-size: var(--wb-fs-xs); }
.cb-track { flex: 1; display: flex; gap: var(--wb-sp-1); height: 10px; background: var(--wb-card-alt); border-radius: 5px; overflow: hidden; }
.cb-bar { height: 100%; }
.cb-exp { background: var(--wb-danger); }
.cb-inc { background: var(--wb-success); }
.cb-val { width: 92px; flex: none; font-size: var(--wb-fs-xs); text-align: right; }
</style>
