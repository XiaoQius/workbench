<script setup lang="ts">
import { watch, ref, onMounted, onUnmounted, computed } from 'vue'
import { refreshTick } from '@/stores/ui'
import { NButton, NTag, NTabs, NTabPane, NIcon, useMessage, NInputNumber, NSelect, NInput, NSlider, NDatePicker } from 'naive-ui'
import { Plus, Trash, Check } from '@vicons/tabler'
import EmptyState from '@/components/EmptyState.vue'
import ModalForm, { type FieldDef } from '@/components/ModalForm.vue'
import { habitsRepo, habitLogsRepo, ledgerRepo, pomodorosRepo, healthLogsRepo, fixedBillsRepo, deadlinesRepo, tasksRepo } from '@/db'
import type { Habit, HabitLog, LedgerEntry, Pomodoro, HealthLog, FixedBill, Deadline, Task } from '../../drizzle/schema'

const message = useMessage()
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

async function load() {
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
    loadPomos()
    loadHealth()
  } catch (e) {
    message.warning('数据加载失败（浏览器降级为演示模式）')
    console.warn(e)
  }
}
watch(refreshTick, () => load())
onMounted(load)

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
  try {
    await habitsRepo.remove(h.id)
    message.success('已删除')
    load()
  } catch { message.error('删除失败') }
}

const checkedToday = (habitId: number) =>
  habitLogs.value.some((l) => l.habitId === habitId && l.date === todayStr)

const habitStreak = (habitId: number) => {
  const dates = new Set(habitLogs.value.filter((l) => l.habitId === habitId).map((l) => l.date))
  let streak = 0
  const d = new Date()
  while (dates.has(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)) {
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
  { key: 'category', label: '分类', options: [
    { label: '餐饮', value: '餐饮' }, { label: '交通', value: '交通' },
    { label: '购物', value: '购物' }, { label: '居住', value: '居住' },
    { label: '学习', value: '学习' }, { label: '娱乐', value: '娱乐' },
    { label: '医疗', value: '医疗' }, { label: '工资', value: '工资' },
    { label: '其他', value: '其他' },
  ] },
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
  try {
    await ledgerRepo.remove(e.id)
    message.success('已删除')
    load()
  } catch { message.error('删除失败') }
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
    pomoRecords.value = (await pomodorosRepo.listAll()).sort((a, b) => (b.id || 0) - (a.id || 0)).slice(0, 20)
  } catch {
    pomoRecords.value = []
  }
}

function startPomo() {
  if (pomoRunning.value) return
  pomoLeft.value = pomoMinutes.value * 60
  pomoRunning.value = true
  pomoInterval = window.setInterval(() => {
    pomoLeft.value--
    if (pomoLeft.value <= 0) completePomo()
  }, 1000)
}

function stopPomo() {
  clearPomoInterval()
  if (pomoRunning.value) {
    pomoRunning.value = false
    try {
      pomodorosRepo.insert({ task: pomoTask.value || '专注', minutes: pomoMinutes.value, startedAt: nowStamp(), completed: 0 }).then(loadPomos)
    } catch { /* 忽略写入失败 */ }
  }
}

function completePomo() {
  clearPomoInterval()
  pomoRunning.value = false
  pomoLeft.value = 0
  try {
    pomodorosRepo.insert({ task: pomoTask.value || '专注', minutes: pomoMinutes.value, startedAt: nowStamp(), completed: 1 }).then(loadPomos)
  } catch { /* 忽略写入失败 */ }
  message.success('番茄钟完成，休息一下吧')
}

const pomoDoneCount = computed(() => pomoRecords.value.filter((p) => p.completed === 1).length)

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
  try {
    await healthLogsRepo.insert({
      date: v.date || todayStr,
      sleepHours: Number(v.sleepHours),
      exerciseMin: Number(v.exerciseMin),
      mood: Number(v.mood),
      weight: v.weight ? Number(v.weight) : undefined,
      note: v.note || '',
    })
    message.success('健康记录已保存')
    loadHealth()
  } catch {
    message.error('保存失败（请通过 npm run tauri dev 启动）')
  }
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
  try { await fixedBillsRepo.remove(b.id); message.success('已删除'); load() } catch { message.error('删除失败') }
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

// ---- 提醒聚合 ----
const remindItems = computed(() => {
  const items: { kind: string; text: string; color: 'warning' | 'error' | 'info' | 'default' }[] = []
  billDueSoon.value.forEach((b) => items.push({ kind: '账单', text: `${b.name} ${b.dueDay} 日扣款 ¥${b.amount}`, color: 'warning' }))
  dueAggregated.value.slice(0, 5).forEach((d) => items.push({ kind: '到期', text: `${d.title}（${d.days} 天后）`, color: d.days <= 3 ? 'error' : 'info' }))
  const pending = chores.value.filter((t) => t.status !== 'done').length
  if (pending) items.push({ kind: '杂事', text: `还有 ${pending} 件杂事待办`, color: 'default' })
  return items
})
</script>

<template>
  <div>

    <n-tabs type="line" class="wb-tabs">
      <!-- 习惯打卡 -->
      <n-tab-pane name="habits" tab="习惯打卡">
        <div class="toolbar">
          <NButton size="small" type="primary" ghost @click="habitFormShow = true">
            <template #icon><NIcon :component="Plus" /></template>
            新建习惯
          </NButton>
        </div>
        <div v-if="habits.length" class="habit-grid">
          <div v-for="h in habits" :key="h.id" class="habit-card wb-card">
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
              <NButton size="tiny" text type="error" @click="removeHabit(h)"><template #icon><NIcon :component="Trash" /></template></NButton>
            </div>
          </div>
        </div>
        <EmptyState v-else text="暂无习惯，新建一个开始打卡" />
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
        <div class="toolbar">
          <NButton size="small" type="primary" ghost @click="ledgerFormShow = true">
            <template #icon><NIcon :component="Plus" /></template>
            记一笔
          </NButton>
        </div>
        <div v-if="recentLedger.length" class="ledger-table">
          <div class="l-row head">
            <span>日期</span><span>类型</span><span>分类</span><span>金额</span><span>备注</span><span></span>
          </div>
          <div v-for="e in recentLedger" :key="e.id" class="l-row">
            <span class="mono">{{ e.date }}</span>
            <span><NTag size="tiny" :bordered="false" :type="e.type === 'income' ? 'success' : 'default'">{{ e.type === 'income' ? '收入' : '支出' }}</NTag></span>
            <span>{{ e.category }}</span>
            <span class="mono" :style="e.type === 'income' ? 'color: var(--wb-success)' : ''">
              {{ e.type === 'income' ? '+' : '-' }}¥{{ e.amount.toFixed(2) }}
            </span>
            <span class="l-note">{{ e.note || '—' }}</span>
            <span style="text-align: right">
              <NButton size="tiny" text type="error" @click="removeLedger(e)"><template #icon><NIcon :component="Trash" /></template></NButton>
            </span>
          </div>
        </div>
        <EmptyState v-else text="暂无记账记录" />
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
            <NButton v-if="!pomoRunning" size="small" type="primary" ghost @click="startPomo">
              <template #icon><NIcon :component="Check" /></template>
              开始
            </NButton>
            <NButton v-else size="small" type="warning" ghost @click="stopPomo">暂停并记录</NButton>
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
        <div v-if="pomoRecords.length" class="pomo-records">
          <div class="pr-row head">
            <span>任务</span><span>时长</span><span>开始时间</span><span>状态</span>
          </div>
          <div v-for="p in pomoRecords" :key="p.id" class="pr-row">
            <span>{{ p.task || '专注' }}</span>
            <span class="mono">{{ p.minutes }} 分钟</span>
            <span class="mono">{{ p.startedAt || '—' }}</span>
            <span><NTag size="tiny" :bordered="false" :type="p.completed === 1 ? 'success' : 'warning'">{{ p.completed === 1 ? '已完成' : '中断' }}</NTag></span>
          </div>
        </div>
        <EmptyState v-else text="暂无番茄钟记录" />
      </n-tab-pane>

      <!-- 健康记录 -->
      <n-tab-pane name="health" tab="健康记录">
        <div class="health-form wb-card">
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
          <NButton size="small" type="primary" ghost @click="saveHealth">保存今日记录</NButton>
        </div>
        <div v-if="healthRecords.length" class="health-table">
          <div class="ht-row head">
            <span>日期</span><span>睡眠</span><span>运动</span><span>心情</span><span>体重</span><span>备注</span>
          </div>
          <div v-for="h in healthRecords" :key="h.id" class="ht-row">
            <span class="mono">{{ h.date }}</span>
            <span class="mono">{{ h.sleepHours ?? '—' }}</span>
            <span class="mono">{{ h.exerciseMin ?? '—' }}</span>
            <span class="mono">{{ h.mood ? moodLabels[h.mood] || h.mood : '—' }}</span>
            <span class="mono">{{ h.weight ?? '—' }}</span>
            <span class="ht-note">{{ h.note || '—' }}</span>
          </div>
        </div>
        <EmptyState v-else text="暂无健康记录" />
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
        <div class="toolbar">
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
        <div v-if="bills.length" class="ledger-table">
          <div class="l-row head">
            <span>名称</span><span>分类</span><span>金额</span><span>周期</span><span>扣款日</span><span>状态</span><span></span>
          </div>
          <div v-for="b in bills" :key="b.id" class="l-row">
            <span>{{ b.name }}</span>
            <span><NTag size="tiny" :bordered="false" :type="b.status === 'active' ? 'info' : 'default'">{{ b.category }}</NTag></span>
            <span class="mono">¥{{ b.amount.toFixed(2) }}</span>
            <span class="mono">{{ { monthly: '每月', quarterly: '每季', yearly: '每年', weekly: '每周' }[b.cycle] || b.cycle }}</span>
            <span class="mono">{{ b.dueDay }} 日</span>
            <span><NTag size="tiny" :bordered="false" :type="b.status === 'active' ? 'success' : 'default'">{{ b.status === 'active' ? '启用' : '暂停' }}</NTag></span>
            <span style="text-align: right">
              <NButton size="tiny" text type="error" @click="removeBill(b)"><template #icon><NIcon :component="Trash" /></template></NButton>
            </span>
          </div>
        </div>
        <EmptyState v-else text="暂无固定账单" />
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
            <div v-if="dueAggregated.length" class="bc-list">
              <div v-for="d in dueAggregated.slice(0, 10)" :key="d.id" class="bc-row">
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
            <div v-if="chores.length" class="bc-list">
              <div v-for="t in chores" :key="t.id" class="bc-row" style="justify-content: space-between">
                <span :style="t.status === 'done' ? 'text-decoration: line-through; color: var(--wb-text-3)' : ''">
                  <NTag size="tiny" :bordered="false" :type="t.status === 'done' ? 'success' : 'default'" style="margin-right: 6px">{{ t.status === 'done' ? '完成' : '待办' }}</NTag>
                  {{ t.title }}
                </span>
                <span style="display: flex; gap: 2px">
                  <NButton size="tiny" text @click="toggleChore(t)"><template #icon><NIcon :component="Check" /></template></NButton>
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
        <div v-if="countdownList.length" class="cd-grid">
          <div v-for="c in countdownList" :key="c.id" class="cd-card wb-card">
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
  </div>
</template>

<style scoped>
.wb-tabs :deep(.n-tabs-nav) { margin-bottom: 14px; }
.toolbar { display: flex; justify-content: flex-end; margin-bottom: 12px; }
.habit-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 12px;
}
.habit-card { padding: 14px 16px; }
.hc-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.hc-name { font-size: 14px; font-weight: 600; }
.streak { font-size: 11.5px; color: var(--wb-text-3); }
.hc-ops { display: flex; align-items: center; justify-content: space-between; margin-top: 12px; }
.ledger-stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  margin-bottom: 14px;
}
@media (max-width: 1000px) {
  .ledger-stats { grid-template-columns: repeat(2, 1fr); }
}
.ledger-stat { padding: 14px 16px; }
.ls-label { font-size: 12px; color: var(--wb-text-2); }
.ls-value { font-size: 19px; font-weight: 650; margin-top: 2px; }
.ledger-table {
  border: 1px solid var(--wb-border);
  border-radius: var(--wb-radius-md);
  overflow: hidden;
}
.l-row {
  display: grid;
  grid-template-columns: 1fr 0.8fr 0.9fr 1.2fr 2fr 0.5fr;
  gap: 10px;
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
  font-size: 12px;
}
.l-note { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--wb-text-2); }
.pomo-panel { max-width: 520px; padding: 18px; display: flex; flex-direction: column; align-items: center; gap: 14px; margin-bottom: 14px; }
.pomo-clock { font-size: 44px; font-weight: 700; line-height: 1; letter-spacing: 1px; }
.pomo-config { display: flex; align-items: center; gap: 10px; }
.pomo-ops { display: flex; gap: 8px; }
.pomo-stats { display: flex; gap: 12px; margin-bottom: 14px; }
.pomo-stat { padding: 10px 16px; display: flex; flex-direction: column; gap: 2px; }
.pomo-stat-num { font-size: 15px; font-weight: 650; }
.pomo-records, .health-table {
  border: 1px solid var(--wb-border);
  border-radius: var(--wb-radius-md);
  overflow: hidden;
}
.pr-row, .ht-row {
  display: grid;
  gap: 10px;
  align-items: center;
  padding: 8px 14px;
  border-bottom: 1px solid var(--wb-border);
  font-size: 12.5px;
}
.pr-row { grid-template-columns: 2fr 0.8fr 1.6fr 0.8fr; }
.ht-row { grid-template-columns: 1fr 0.8fr 0.8fr 0.8fr 0.8fr 2fr; }
.pr-row:last-child, .ht-row:last-child { border-bottom: none; }
.pr-row.head, .ht-row.head {
  background: var(--wb-card-alt);
  font-weight: 600;
  color: var(--wb-text-2);
  font-size: 12px;
}
.ht-note { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--wb-text-2); }
.health-form { max-width: 520px; padding: 16px 18px; display: flex; flex-direction: column; gap: 12px; margin-bottom: 14px; }
.hf-row { display: flex; align-items: center; gap: 10px; }
.hf-label { width: 100px; font-size: 12.5px; color: var(--wb-text-2); flex: none; }
.hf-mood { font-size: 12.5px; color: var(--wb-module-life); width: 40px; }
.heat-wrap { padding: 14px; display: flex; gap: 4px; align-items: flex-end; overflow-x: auto; }
.heat-col { display: flex; flex-direction: column; gap: 4px; }
.heat-cell { width: 11px; height: 11px; border-radius: 2.5px; }
.heat-cell.lvl0 { background: var(--wb-card-alt); }
.heat-cell.lvl1 { background: #d1fae5; }
.heat-cell.lvl2 { background: #6ee7b7; }
.heat-cell.lvl3 { background: #059669; }
.heat-legend { display: flex; align-items: center; gap: 5px; margin-left: 12px; font-size: 11px; color: var(--wb-text-3); }
.remind-list { padding: 10px 14px; display: flex; flex-direction: column; gap: 6px; }
.remind-title { font-size: 12.5px; font-weight: 650; color: var(--wb-warning, #f0a020); }
.remind-item { display: flex; align-items: center; gap: 8px; font-size: 12.5px; }
.board-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 12px; }
.board-card { padding: 14px 16px; display: flex; flex-direction: column; gap: 10px; }
.bc-head { display: flex; align-items: center; justify-content: space-between; font-size: 13px; font-weight: 650; }
.bc-list { display: flex; flex-direction: column; gap: 6px; }
.bc-row { display: flex; align-items: center; gap: 8px; font-size: 12.5px; }
.cost-bars { display: flex; flex-direction: column; gap: 8px; }
.cb-row { display: flex; align-items: center; gap: 8px; }
.cb-ym { width: 46px; flex: none; font-size: 11px; }
.cb-track { flex: 1; display: flex; gap: 2px; height: 10px; background: var(--wb-card-alt); border-radius: 5px; overflow: hidden; }
.cb-bar { height: 100%; }
.cb-exp { background: #f87171; }
.cb-inc { background: #34d399; }
.cb-val { width: 92px; flex: none; font-size: 11px; text-align: right; }
</style>
