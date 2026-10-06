<script setup lang="ts">
import { watch, ref, onMounted, onUnmounted, computed } from 'vue'
import { refreshTick } from '@/stores/ui'
import { NButton, NTag, NInput, NSelect, NModal, NForm, NFormItem, NSpace, useMessage, NIcon, NCheckbox } from 'naive-ui'
import { Plus, Trash, Rocket, Refresh, Edit } from '@vicons/tabler'
import EmptyState from '@/components/EmptyState.vue'
import ListSkeleton from '@/components/ListSkeleton.vue'
import ModalForm, { type FieldDef } from '@/components/ModalForm.vue'
import { toolsRepo, agentsRepo } from '@/db'
import type { Tool, Agent } from '../../drizzle/schema'
import { scanAgents, portProbe, agentWorkflow, listInstalledApps, resolveShortcut, launchApp, type AgentSessionInfo, type AgentWorkflowResult, type InstalledApp } from '@/composables/useTauri'
import { useConfirm } from '@/composables/useConfirm'
import { useListNav } from '@/composables/useListNav'
import { useBatchSelect } from '@/composables/useBatchSelect'

const message = useMessage()
const { confirm } = useConfirm()
const tools = ref<Tool[]>([])
const agents = ref<Agent[]>([])
const loading = ref(false)

const toolFormShow = ref(false)
const agentFormShow = ref(false)
const keyword = ref('')

// ---- 添加工具：自动识别本机程序（Rust 命令 list_installed_apps / resolve_shortcut） ----
const toolFormInitial = ref<Record<string, unknown>>({})
const installedApps = ref<InstalledApp[]>([])
const installedKeyword = ref('')
const installedLoading = ref(false)
const installedLimit = ref(40)

// 系统/框架组件判定：路径位于系统目录，或名称命中常见辅助组件关键词
const SYSTEM_NAME_WORDS = [
  'update', 'updater', 'helper', 'helpers', 'service', 'services', 'runtime',
  'component', 'redistributable', 'addon', 'add-in', 'plug-in', 'plugin',
  'installer', 'setup', 'driver', 'shared', 'office telemetry',
  'microsoft edge webview', 'onedrive setup', 'sync center',
]
const SYSTEM_EXE_PREFIXES = [
  'c:\\windows\\', 'c:\\program files\\common files\\microsoft\\',
  'c:\\program files (x86)\\common files\\microsoft\\',
  'c:\\program files\\windowsapps\\', 'c:\\windows\\system32\\',
  'c:\\windows\\syswow64\\', 'c:\\programdata\\microsoft\\windows defender\\',
  '\\windowsapps\\', '\\microsoft shared\\',
]
const SYSTEM_LNK_MARKERS = [
  '\\start menu\\programs\\windows 工具\\',
  '\\start menu\\programs\\accessories\\',
  '\\start menu\\programs\\system tools\\',
  '\\start menu\\programs\\windows powershell',
  '\\start menu\\programs\\附\\',
]
function isSystemApp(a: InstalledApp): boolean {
  const exe = (a.exe_path || '').toLowerCase()
  const lnk = (a.lnk_path || '').toLowerCase()
  if (lnk.includes('\\windowsnt\\')) return true
  if (SYSTEM_LNK_MARKERS.some((m) => lnk.includes(m))) return true
  for (const p of SYSTEM_EXE_PREFIXES) {
    if (exe && exe.startsWith(p)) return true
    if (lnk.includes(p)) return true
  }
  const name = a.name.toLowerCase()
  return SYSTEM_NAME_WORDS.some((w) => name.includes(w))
}
function sortInstalled(list: InstalledApp[]): InstalledApp[] {
  const user: InstalledApp[] = []
  const system: InstalledApp[] = []
  for (const a of list) (isSystemApp(a) ? system : user).push(a)
  return [...user, ...system]
}
function filterInstalled(list: InstalledApp[], kw: string): InstalledApp[] {
  if (!kw) return list
  return list.filter((a) =>
    a.name.toLowerCase().includes(kw) ||
    (a.exe_path || '').toLowerCase().includes(kw) ||
    (a.source === 'start-menu' ? '开始菜单' : '注册表').includes(kw))
}

const filteredInstalled = computed(() => {
  const kw = installedKeyword.value.trim().toLowerCase()
  const list = filterInstalled(sortInstalled(installedApps.value), kw)
  return list.slice(0, installedLimit.value)
})

// 扫描结果缓存：list_installed_apps 要递归开始菜单 + 三路注册表 PowerShell，耗时数秒，
// 不应每次打开应用都重扫。缓存 24h，「重新扫描」强制刷新。
const INSTALLED_CACHE_KEY = 'wb:installed-apps-cache'
const INSTALLED_CACHE_TTL = 24 * 60 * 60 * 1000
function readInstalledCache(): InstalledApp[] | null {
  try {
    const raw = localStorage.getItem(INSTALLED_CACHE_KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as { at: number; apps: InstalledApp[] }
    if (!p || typeof p.at !== 'number' || !Array.isArray(p.apps) || !p.apps.length) return null
    if (Date.now() - p.at > INSTALLED_CACHE_TTL) return null
    return p.apps
  } catch { return null }
}
function writeInstalledCache(apps: InstalledApp[]) {
  try { localStorage.setItem(INSTALLED_CACHE_KEY, JSON.stringify({ at: Date.now(), apps })) } catch { /* 容量满则放弃缓存 */ }
}
const installedScannedAt = ref<number | null>(null)
function fmtScannedAt(ts: number): string {
  const d = new Date(ts)
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

async function loadInstalledApps(force = false) {
  if (installedApps.value.length) return
  if (!force) {
    const cached = readInstalledCache()
    if (cached) {
      installedApps.value = cached
      try { installedScannedAt.value = JSON.parse(localStorage.getItem(INSTALLED_CACHE_KEY) || '{}').at ?? null } catch { installedScannedAt.value = null }
      return
    }
  }
  installedLoading.value = true
  try {
    installedApps.value = await listInstalledApps()
    writeInstalledCache(installedApps.value)
    installedScannedAt.value = Date.now()
  } catch {
    message.error('本机程序识别失败（需 Tauri 环境）')
    installedApps.value = []
  } finally {
    installedLoading.value = false
  }
}

// ---- 工具台「扫描添加」面板：一键把本机程序加入工具列表 ----
const scanPanelShow = ref(false)
const scanKeyword = ref('')
const scanLimit = ref(40)
const scanAdding = ref<Record<string, boolean>>({})
const installedTotal = computed(() => installedApps.value.length)
const scanFiltered = computed(() => {
  const kw = scanKeyword.value.trim().toLowerCase()
  const list = filterInstalled(sortInstalled(installedApps.value), kw)
  return list.slice(0, scanLimit.value)
})
const scanRest = computed(() => {
  const kw = scanKeyword.value.trim().toLowerCase()
  const list = filterInstalled(sortInstalled(installedApps.value), kw)
  return Math.max(0, list.length - scanFiltered.value.length)
})
const isAppAdded = (a: InstalledApp) => {
  const n = a.name.toLowerCase()
  return tools.value.some((t) => t.name.toLowerCase() === n)
}
function toggleScanPanel() {
  scanPanelShow.value = !scanPanelShow.value
  if (scanPanelShow.value) loadInstalledApps()
}
function closeScanPanel() {
  scanPanelShow.value = false
}
function moreScanApps() {
  scanLimit.value += 40
}
async function rescanInstalledApps() {
  installedApps.value = []
  await loadInstalledApps(true)
}
async function addInstalledApp(a: InstalledApp) {
  if (scanAdding.value[a.name] || isAppAdded(a)) return
  scanAdding.value = { ...scanAdding.value, [a.name]: true }
  try {
    let exe = a.exe_path ?? null
    if (!exe && a.lnk_path) exe = await resolveShortcut(a.lnk_path)
    if (!exe) {
      message.warning(`${a.name} 无法解析可执行文件，请用「添加工具」手动填写目标`)
      return
    }
    await toolsRepo.insert({
      name: a.name,
      category: 'local',
      launchType: 'cmd',
      target: exe,
      note: `扫描添加自本机程序（${a.source === 'start-menu' ? '开始菜单' : '注册表'}）`,
      docUrl: '',
    })
    message.success(`已添加：${a.name}`)
    await load()
  } catch {
    message.error(`${a.name} 添加失败`)
  } finally {
    const next = { ...scanAdding.value }
    delete next[a.name]
    scanAdding.value = next
  }
}

async function pickInstalled(a: InstalledApp) {
  try {
    let exe = a.exe_path ?? null
    if (!exe && a.lnk_path) {
      exe = await resolveShortcut(a.lnk_path)
    }
    if (!exe) {
      message.warning(`${a.name} 无法解析可执行文件，请手动填写目标`)
      return
    }
    toolFormInitial.value = {
      name: a.name,
      category: 'local',
      launchType: 'cmd',
      target: exe,
      note: `自动识别自本机程序（${a.source === 'start-menu' ? '开始菜单' : '注册表'}）`,
    }
    message.success(`已识别 ${a.name}，核对后点击保存`)
  } catch {
    message.error(`${a.name} 解析失败`)
  }
}

// ---- Agent 多源会话扫描状态（Rust 命令，F-AGT-01/02/04） ----
const sessions = ref<AgentSessionInfo[]>([])
const sessionLoading = ref(false)

// ---- 端口在线探测（Rust 命令，F-LP-03） ----
const probeMap = ref<Record<number, boolean>>({})
const probeLoading = ref(false)

async function probePorts() {
  const ported = tools.value.filter((t) => t.port && t.port > 0)
  if (!ported.length) return
  probeLoading.value = true
  try {
    const ports = [...new Set(ported.map((t) => t.port as number))]
    const res = await portProbe('127.0.0.1', ports)
    const next: Record<number, boolean> = {}
    for (const r of res) next[r.port] = r.open
    probeMap.value = next
  } catch {
    probeMap.value = {}
  } finally {
    probeLoading.value = false
  }
}

const probeTitle = (t: Tool) => {
  const state = probeMap.value[t.port as number]
  return state === undefined ? '端口探测中…' : state ? `端口 ${t.port} 在线` : `端口 ${t.port} 离线`
}

// ---- 智能体工作流拆解（Rust 命令，F-AGT-06~18）+ 执行历史（F-AGT 执行历史） ----
const wfGoal = ref('')
const wfResult = ref<AgentWorkflowResult | null>(null)
const wfLoading = ref(false)
interface WfHistoryItem { at: string; goal: string; effort: string; tasks: number; risks: number }
const wfHistory = ref<WfHistoryItem[]>([])
function loadWfHistory() {
  try {
    const raw = localStorage.getItem('wb:wf-history')
    if (raw) wfHistory.value = JSON.parse(raw)
  } catch { /* ignore */ }
}
function clearWfHistory() {
  wfHistory.value = []
  try { localStorage.removeItem('wb:wf-history') } catch { /* ignore */ }
}
async function runWorkflow() {
  const goal = wfGoal.value.trim()
  if (!goal) {
    message.warning('请输入目标任务')
    return
  }
  wfLoading.value = true
  try {
    wfResult.value = await agentWorkflow(goal)
    const item: WfHistoryItem = {
      at: new Date().toLocaleString('zh-CN'),
      goal,
      effort: wfResult.value.estimated_effort,
      tasks: wfResult.value.sub_tasks.length,
      risks: wfResult.value.risks.length,
    }
    wfHistory.value = [item, ...wfHistory.value].slice(0, 20)
    try { localStorage.setItem('wb:wf-history', JSON.stringify(wfHistory.value)) } catch { /* ignore */ }

    // F-AGT-07 待审队列：子任务入队（默认待审）
    const queue = wfQueue.value
    for (const st of wfResult.value.sub_tasks) {
      queue.push({ id: `${Date.now()}-${st.seq}`, goal, title: st.title, action: st.action, acceptance: st.acceptance, status: 'todo' })
    }
    wfQueue.value = queue.slice(-50)
    persistQueue()
    // F-AGT-06 完成通知
    addNotify(`工作流拆解完成：${goal}`)
    // F-AGT-09 成本统计
    addCost(wfResult.value.estimated_effort)
    // F-AGT-12 回滚点自动记录
    recordRollbackPoint(goal)
  } catch (e) {
    message.warning('工作流拆解失败（浏览器降级不可用）')
    console.warn(e)
  } finally {
    wfLoading.value = false
  }
}

// ---- F-AGT-07 待审队列 / 分派看板（F-AGT-17） ----
interface QueueItem { id: string; goal: string; title: string; action: string; acceptance: string; status: 'todo' | 'doing' | 'review' | 'done' }
const wfQueue = ref<QueueItem[]>([])
function loadQueue() {
  try {
    const raw = localStorage.getItem('wb:wf-queue')
    if (raw) wfQueue.value = JSON.parse(raw)
  } catch { /* ignore */ }
}
function persistQueue() {
  try { localStorage.setItem('wb:wf-queue', JSON.stringify(wfQueue.value)) } catch { /* ignore */ }
}
function setQueueStatus(id: string, status: QueueItem['status']) {
  const it = wfQueue.value.find((q) => q.id === id)
  if (it) { it.status = status; persistQueue() }
  if (status === 'done') addNotify(`子任务已完成：${it?.title ?? ''}`)
}
function clearQueue() {
  wfQueue.value = []
  persistQueue()
}

// ---- F-AGT-06 完成通知 ----
const notifies = ref<{ at: string; text: string }[]>([])
function loadNotifies() {
  try {
    const raw = localStorage.getItem('wb:wf-notify')
    if (raw) notifies.value = JSON.parse(raw)
  } catch { /* ignore */ }
}
function addNotify(text: string) {
  notifies.value = [{ at: new Date().toLocaleString('zh-CN'), text }, ...notifies.value].slice(0, 20)
  try { localStorage.setItem('wb:wf-notify', JSON.stringify(notifies.value)) } catch { /* ignore */ }
}

// ---- F-AGT-09 成本统计（按规模估算成本点） ----
const costTotal = ref(0)
const costCount = ref(0)
const COST_POINTS: Record<string, number> = { S: 1, M: 3, L: 8, XL: 15 }
function addCost(effort: string) {
  costTotal.value += COST_POINTS[effort] ?? 3
  costCount.value += 1
  try { localStorage.setItem('wb:wf-cost', JSON.stringify({ total: costTotal.value, count: costCount.value })) } catch { /* ignore */ }
}
function loadCost() {
  try {
    const raw = localStorage.getItem('wb:wf-cost')
    if (raw) {
      const d = JSON.parse(raw)
      costTotal.value = d.total ?? 0
      costCount.value = d.count ?? 0
    }
  } catch { /* ignore */ }
}

// ---- F-AGT-11 冲突预警：同一仓库被多个 Agent 登记 ----
const conflictWarns = computed(() => {
  const byRepo = new Map<string, string[]>()
  for (const a of agents.value) {
    // 仓库名约定登记在 note（如 "@repo:my-app"），未登记则跳过
    const m = String(a.note || '').match(/@repo\s*[:：]\s*([^\s,;，；]+)/)
    const repo = m ? m[1] : ''
    if (!repo) continue
    const arr = byRepo.get(repo) ?? []
    arr.push(a.name)
    byRepo.set(repo, arr)
  }
  return [...byRepo.entries()].filter(([, names]) => names.length > 1)
})

// ---- F-AGT-15 Prompt 库（localStorage CRUD） ----
const promptLib = ref<{ id: string; name: string; text: string }[]>([])
const promptName = ref('')
const promptText = ref('')
function loadPrompts() {
  try {
    const raw = localStorage.getItem('wb:prompt-lib')
    if (raw) promptLib.value = JSON.parse(raw)
  } catch { /* ignore */ }
}
function persistPrompts() {
  try { localStorage.setItem('wb:prompt-lib', JSON.stringify(promptLib.value)) } catch { /* ignore */ }
}
function addPrompt() {
  const name = promptName.value.trim()
  const text = promptText.value.trim()
  if (!name || !text) { message.warning('请填写名称与模板内容'); return }
  promptLib.value.push({ id: String(Date.now()), name, text })
  promptName.value = ''
  promptText.value = ''
  persistPrompts()
}
function removePrompt(id: string) {
  promptLib.value = promptLib.value.filter((p) => p.id !== id)
  persistPrompts()
}

// ---- 编辑 Prompt（数据存在 localStorage，没有 repo，走本地数组改写 + 持久化） ----
const editPromptId = ref<string | null>(null)
const editPromptName = ref('')
const editPromptText = ref('')
function openEditPrompt(p: { id: string; name: string; text: string }) {
  editPromptId.value = p.id
  editPromptName.value = p.name
  editPromptText.value = p.text
}
function cancelEditPrompt() {
  editPromptId.value = null
  editPromptName.value = ''
  editPromptText.value = ''
}
function saveEditPrompt() {
  if (!editPromptId.value) return
  const name = editPromptName.value.trim()
  const text = editPromptText.value.trim()
  if (!name || !text) { message.warning('请填写名称与模板内容'); return }
  const i = promptLib.value.findIndex((p) => p.id === editPromptId.value)
  if (i === -1) { cancelEditPrompt(); return }
  promptLib.value[i] = { ...promptLib.value[i], name, text }
  persistPrompts()
  message.success('Prompt 已更新')
  cancelEditPrompt()
}

// ============================================================
// 批量处理：Prompt 库
// 这里不能用共享 useBatchSelect —— 它的签名约束是 T extends { id: number }，
// 而 Prompt 存在 localStorage、id 是 String(Date.now()) 的字符串。
// 逻辑照抄同一套语义（Set + 数据源变化时 prune 失效 id），只是键类型换成 string。
// ============================================================
const promptSelIds = ref<Set<string>>(new Set())
const promptSelCount = computed(() => promptSelIds.value.size)
const promptSelActive = computed(() => promptSelCount.value > 0)
const promptAllChecked = computed(() => promptLib.value.length > 0 && promptSelCount.value === promptLib.value.length)
const promptSomeChecked = computed(() => promptSelCount.value > 0 && !promptAllChecked.value)
function togglePrompt(id: string) {
  const next = new Set(promptSelIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  promptSelIds.value = next
}
function toggleAllPrompts() {
  if (promptAllChecked.value) promptSelIds.value = new Set()
  else promptSelIds.value = new Set(promptLib.value.map((p) => p.id))
}
function clearPromptSel() {
  if (promptSelIds.value.size) promptSelIds.value = new Set()
}
function isPromptSelected(id: string): boolean {
  return promptSelIds.value.has(id)
}
// 数据源变化（增删 / 重新加载）后剔除已不存在的 id，避免对看不见的行做删除
watch(
  () => promptLib.value.map((p) => p.id).join(','),
  () => {
    const alive = new Set(promptLib.value.map((p) => p.id))
    let dirty = false
    const next = new Set<string>()
    for (const id of promptSelIds.value) {
      if (alive.has(id)) next.add(id)
      else dirty = true
    }
    if (dirty) promptSelIds.value = next
  },
  { flush: 'post' },
)

async function batchRemovePrompts() {
  const n = promptSelCount.value
  if (!n) return
  const names = promptLib.value
    .filter((p) => promptSelIds.value.has(p.id))
    .slice(0, 3)
    .map((p) => p.name)
    .join('、')
  const ok = await confirm({
    title: `删除选中的 ${n} 条 Prompt？`,
    content: `${names}${n > 3 ? ` 等 ${n} 条` : ''}，删除后无法恢复。`,
  })
  if (!ok) return
  promptLib.value = promptLib.value.filter((p) => !promptSelIds.value.has(p.id))
  persistPrompts()
  clearPromptSel()
  message.success(`已删除 ${n} 条 Prompt`)
}

/** 批量复制：把选中模板拼成一段文本放进剪贴板 */
async function batchCopyPrompts() {
  const n = promptSelCount.value
  if (!n) return
  const text = promptLib.value
    .filter((p) => promptSelIds.value.has(p.id))
    .map((p) => `## ${p.name}\n${p.text}`)
    .join('\n\n')
  try {
    await navigator.clipboard.writeText(text)
    message.success(`已复制 ${n} 条 Prompt`)
    clearPromptSel()
  } catch {
    message.error('复制失败')
  }
}

// ---- F-AGT-14 交接包：为最近一次工作流生成交接文本 ----
function handoffPack() {
  if (!wfResult.value) { message.warning('请先拆解一个目标任务'); return }
  const r = wfResult.value
  const lines: string[] = [
    `# 交接包 · ${wfGoal.value.trim() || '未命名目标'}`,
    `生成时间：${new Date().toLocaleString('zh-CN')}`,
    `规模评估：${r.estimated_effort} · 子任务 ${r.sub_tasks.length} · 风险 ${r.risks.length}`,
    '',
    '## 子任务清单',
    ...r.sub_tasks.map((st) => `- [ ] ${st.seq} ${st.title}\n    动作：${st.action}\n    验收：${st.acceptance}`),
    '## 质量检查',
    ...r.quality_checks.map((q) => `- ${q}`),
    '## 风险提示',
    ...r.risks.map((x) => `- ${x}`),
    '## 自愈预案',
    ...r.self_heal_hints.map((x) => `- ${x}`),
  ]
  const text = lines.join('\n')
  navigator.clipboard?.writeText(text).then(() => message.success('交接包已复制到剪贴板')).catch(() => window.alert(text))
}

// ---- F-AGT-18 一键续跑：从历史重新拆解 ----
async function rerunHistory(goal: string) {
  wfGoal.value = goal
  wfLoading.value = true
  try {
    wfResult.value = await agentWorkflow(goal)
    const item: WfHistoryItem = { at: new Date().toLocaleString('zh-CN'), goal, effort: wfResult.value.estimated_effort, tasks: wfResult.value.sub_tasks.length, risks: wfResult.value.risks.length }
    wfHistory.value = [item, ...wfHistory.value].slice(0, 20)
    try { localStorage.setItem('wb:wf-history', JSON.stringify(wfHistory.value)) } catch { /* ignore */ }
    addNotify(`续跑完成：${goal}`)
    addCost(wfResult.value.estimated_effort)
  } catch (e) {
    message.warning('续跑失败（浏览器降级不可用）')
  } finally {
    wfLoading.value = false
  }
}

async function load() {
  loading.value = true
  try {
    const [ts, as] = await Promise.all([toolsRepo.listAll(), agentsRepo.listAll()])
    tools.value = ts
    agents.value = as
    probePorts()
  } catch (e) {
    message.warning('数据加载失败（浏览器降级为演示模式）')
    console.warn(e)
  } finally {
    loading.value = false
  }
}

// ---- 实时运行时长（跳秒，F-AGT-04）/ 完成通知（F-AGT-06） ----
const scanAt = ref(0)
watch(refreshTick, () => { load() })
onMounted(() => {
  load()
  loadWfHistory()
  loadQueue()
  loadNotifies()
  loadCost()
  loadPrompts()
  loadRollbackPoints()
})

const liveAge = (s: AgentSessionInfo) => {
  const base = s.age_secs ?? 0
  const live = scanAt.value ? Math.floor((Date.now() - scanAt.value) / 1000) : 0
  return base + live
}

// ---- Agent 多源会话扫描（Rust 命令，F-AGT-01/02/04/06） ----
async function loadSessions() {
  sessionLoading.value = true
  try {
    const prev = sessions.value
    const prevDone = new Set(prev.filter((s) => s.status === 'done').map((s) => s.session_file))
    const next = await scanAgents()
    scanAt.value = Date.now()
    for (const s of next) {
      if (s.status === 'done' && !prevDone.has(s.session_file)) {
        message.success(`已完成：${s.name}`)
      }
    }
    sessions.value = next
  } catch {
    sessions.value = []
  } finally {
    sessionLoading.value = false
  }
}

const fmtAgo = (secs: number) =>
  secs < 60 ? `${secs}s` : secs < 3600 ? `${Math.floor(secs / 60)}m` : `${(secs / 3600).toFixed(1)}h`

const stalledCount = computed(() => sessions.value.filter((s) => s.stalled).length)

// ---- 工具启动台 ----
const toolFields: FieldDef[] = [
  { key: 'name', label: '名称', required: true },
  { key: 'category', label: '分类', type: 'select', options: [
    { label: 'Agent', value: 'agent' }, { label: '编辑器', value: 'editor' },
    { label: '终端', value: 'terminal' }, { label: '运行时', value: 'runtime' },
    { label: '设计', value: 'design' }, { label: '运维', value: 'ops' },
    { label: '本地', value: 'local' }, { label: '在线', value: 'online' },
    { label: '其他', value: 'other' },
  ] },
  { key: 'launchType', label: '启动方式', type: 'select', options: [
    { label: '协议 (vscode:// 等)', value: 'protocol' },
    { label: 'URL', value: 'url' },
    { label: '命令行', value: 'cmd' },
  ] },
  { key: 'target', label: '目标 (协议 / URL / 命令)', required: true },
  { key: 'port', label: '端口', type: 'number' },
  { key: 'note', label: '备注', type: 'textarea', span: 2 },
  { key: 'docUrl', label: '文档链接', span: 2 },
]

async function addTool(v: Record<string, unknown>) {
  try {
    await toolsRepo.insert({
      name: String(v.name), category: String(v.category || 'other'),
      launchType: String(v.launchType || 'protocol'), target: String(v.target),
      port: v.port ? Number(v.port) : undefined, note: String(v.note || ''),
      docUrl: String(v.docUrl || ''),
    })
    message.success('工具已添加')
    load()
  } catch {
    message.error('添加失败（请通过 npm run tauri dev 启动）')
  }
}

async function launchTool(t: Tool) {
  try {
    const next = (Number(t.hitCount) || 0) + 1
    await toolsRepo.update(t.id, { hitCount: next })
    t.hitCount = next
  } catch { /* ignore */ }
  const target = t.target
  if (t.launchType === 'url' || /^https?:\/\//.test(target)) {
    window.open(target, '_blank')
  } else if (t.launchType === 'cmd') {
    try {
      await launchApp(target)
      message.success(`已启动：${t.name}`)
    } catch (e) {
      message.error(`启动失败：${e instanceof Error ? e.message : String(e)}`)
    }
  } else {
    // 协议启动（vscode:// 等）
    window.location.href = target
  }
}

async function removeTool(t: Tool) {
  const ok = await confirm({ title: '删除这个工具？', content: `「${t.name}」${t.note ? ` · ${t.note}` : ''}` })
  if (!ok) return
  try {
    await toolsRepo.remove(t.id)
    message.success('已删除')
    load()
  } catch {
    message.error('删除失败')
  }
}

// ---- 编辑工具（复用 toolFields；hitCount 是使用频次统计，编辑时不覆盖） ----
const editToolShow = ref(false)
const editToolId = ref<number | null>(null)
const editToolForm = ref<Record<string, unknown>>({})
function openEditTool(t: Tool) {
  editToolId.value = t.id
  editToolForm.value = {
    name: t.name, category: t.category, launchType: t.launchType,
    target: t.target, port: t.port ?? null,
    note: t.note ?? '', docUrl: t.docUrl ?? '',
  }
  editToolShow.value = true
}
async function saveEditTool(v: Record<string, unknown>) {
  if (editToolId.value === null) return
  try {
    await toolsRepo.update(editToolId.value, {
      name: String(v.name || '').trim() || '未命名工具',
      category: String(v.category || 'other') as Tool['category'],
      launchType: String(v.launchType || 'protocol') as Tool['launchType'],
      target: String(v.target || ''),
      port: v.port ? Number(v.port) : null,
      note: String(v.note || ''),
      docUrl: String(v.docUrl || ''),
    })
    message.success('工具已更新')
    editToolShow.value = false
    load()
  } catch { message.error('保存失败') }
}

const filteredTools = computed(() =>
  keyword.value ? tools.value.filter((t) => t.name.includes(keyword.value) || (t.note || '').includes(keyword.value)) : tools.value,
)

// ---- Agent 手动台账 ----
const agentFields: FieldDef[] = [
  { key: 'name', label: '名称', required: true },
  { key: 'vendor', label: '厂商 / 模型' },
  { key: 'task', label: '当前任务', span: 2 },
  { key: 'status', label: '状态', type: 'select', options: [
    { label: '空闲', value: 'idle' }, { label: '运行中', value: 'running' },
    { label: '卡住', value: 'stalled' }, { label: '已完成', value: 'done' },
  ] },
  { key: 'note', label: '备注', type: 'textarea', span: 2 },
]

async function addAgent(v: Record<string, unknown>) {
  try {
    await agentsRepo.insert({
      name: String(v.name), vendor: String(v.vendor || ''),
      task: String(v.task || ''), status: String(v.status || 'idle'),
      note: String(v.note || ''),
    })
    message.success('Agent 已登记')
    load()
  } catch {
    message.error('添加失败（请通过 npm run tauri dev 启动）')
  }
}

async function setAgentStatus(a: Agent, status: string) {
  try {
    await agentsRepo.update(a.id, { status })
    a.status = status as Agent['status']
  } catch {
    message.error('更新失败')
  }
}

async function removeAgent(a: Agent) {
  const ok = await confirm({ title: '删除这个 Agent？', content: `「${a.name}」${a.vendor ? ` · ${a.vendor}` : ''}` })
  if (!ok) return
  try {
    await agentsRepo.remove(a.id)
    message.success('已删除')
    load()
  } catch {
    message.error('删除失败')
  }
}

// ---- 编辑 Agent（复用 agentFields；startedAt 由启停动作维护，这里不动） ----
const editAgentShow = ref(false)
const editAgentId = ref<number | null>(null)
const editAgentForm = ref<Record<string, unknown>>({})
function openEditAgent(a: Agent) {
  editAgentId.value = a.id
  editAgentForm.value = {
    name: a.name, vendor: a.vendor ?? '', task: a.task ?? '',
    status: a.status, note: a.note ?? '',
  }
  editAgentShow.value = true
}
async function saveEditAgent(v: Record<string, unknown>) {
  if (editAgentId.value === null) return
  try {
    await agentsRepo.update(editAgentId.value, {
      name: String(v.name || '').trim() || '未命名 Agent',
      vendor: String(v.vendor || ''),
      task: String(v.task || ''),
      status: String(v.status || 'idle') as Agent['status'],
      note: String(v.note || ''),
    })
    message.success('Agent 已更新')
    editAgentShow.value = false
    load()
  } catch { message.error('保存失败') }
}

const agentStatusColor = (s: string) =>
  s === 'running' ? 'success' : s === 'stalled' ? 'warning' : s === 'done' ? 'info' : 'default'
const agentStatusLabel = (s: string) =>
  ({ idle: '空闲', running: '运行中', stalled: '卡住', done: '已完成' })[s] ?? s

// ---- 工具启动台增强（F-LP-04 热键 / F-LP-05 频次排序 / F-LP-06 .bat / F-LP-07 场景 / F-LP-08 一键开始收工） ----
const toolSort = ref<'hot' | 'name'>('hot')
const orderedTools = computed(() => {
  const arr = [...tools.value]
  if (toolSort.value === 'hot') arr.sort((a, b) => (b.hitCount || 0) - (a.hitCount || 0))
  else arr.sort((a, b) => a.name.localeCompare(b.name))
  return arr
})
function toggleToolSort() {
  toolSort.value = toolSort.value === 'hot' ? 'name' : 'hot'
  message.info(toolSort.value === 'hot' ? '已按使用频次排序（F-LP-05）' : '已按名称排序')
}

// ============================================================
// 批量处理：工具（tools）
// 勾选绑到 orderedTools —— 它是模板真正渲染的那份数组（排序后的结果），
// 用 filteredTools 会让「选中集合」与「看得见的行」对不上。
// ============================================================
const {
  selectedIds: selToolIds,
  count: selToolCount,
  active: toolSelActive,
  allChecked: toolAllChecked,
  someChecked: toolSomeChecked,
  toggle: toggleTool,
  toggleAll: toggleAllTools,
  clear: clearToolSel,
  isSelected: isToolSelected,
} = useBatchSelect<Tool>(orderedTools)

// tools.category（schema 注释）：agent | editor | terminal | runtime | design | ops | local | online | other
const batchToolCategory = ref<string>('other')
const batchToolCategoryOptions = [
  { label: 'Agent', value: 'agent' },
  { label: '编辑器', value: 'editor' },
  { label: '终端', value: 'terminal' },
  { label: '运行时', value: 'runtime' },
  { label: '设计', value: 'design' },
  { label: '运维', value: 'ops' },
  { label: '本地', value: 'local' },
  { label: '在线', value: 'online' },
  { label: '其他', value: 'other' },
]

async function batchRemoveTools() {
  const n = selToolCount.value
  if (!n) return
  const names = orderedTools.value
    .filter((t) => selToolIds.value.has(t.id))
    .slice(0, 3)
    .map((t) => t.name)
    .join('、')
  const ok = await confirm({
    title: `删除选中的 ${n} 个工具？`,
    content: `${names}${n > 3 ? ` 等 ${n} 个` : ''}，删除后无法恢复。`,
  })
  if (!ok) return
  const res = await Promise.allSettled([...selToolIds.value].map((id) => toolsRepo.remove(id)))
  const okN = res.filter((r) => r.status === 'fulfilled').length
  const failN = res.length - okN
  clearToolSel()
  if (failN === 0) message.success(`已删除 ${okN} 个工具`)
  else message.error(`成功 ${okN} 个，失败 ${failN} 个`)
  load()
}

async function batchSetToolCategory() {
  const n = selToolCount.value
  if (!n) return
  const category = batchToolCategory.value
  const label = batchToolCategoryOptions.find((o) => o.value === category)?.label ?? category
  const ok = await confirm({
    title: `将选中的 ${n} 个工具改分类为「${label}」？`,
    content: `会写入 tools.category = ${category}（不改动 hitCount 等其它列）。`,
    confirmText: '确认修改',
    danger: false,
  })
  if (!ok) return
  const res = await Promise.allSettled([...selToolIds.value].map((id) => toolsRepo.update(id, { category: category as Tool['category'] })))
  const okN = res.filter((r) => r.status === 'fulfilled').length
  const failN = res.length - okN
  clearToolSel()
  if (failN === 0) message.success(`已更新 ${okN} 个工具`)
  else message.error(`成功 ${okN} 个，失败 ${failN} 个`)
  load()
}

// F-LP-04：Alt+1..9 快速启动前 9 个工具
function onToolHotkey(e: KeyboardEvent) {
  if (e.altKey && !e.ctrlKey && !e.metaKey && e.key >= '1' && e.key <= '9') {
    const idx = Number(e.key) - 1
    const t = orderedTools.value[idx]
    if (t) {
      launchTool(t)
      message.info(`热键启动：${t.name}`)
    }
  }
}
if (typeof window !== 'undefined') {
  onMounted(() => window.addEventListener('keydown', onToolHotkey))
  onUnmounted(() => window.removeEventListener('keydown', onToolHotkey))
}
// F-LP-06：生成工具启动 .bat 脚本（复制文本，用户保存为 .bat 使用）
const batScript = ref('')
function buildBat() {
  const lines: string[] = ['@echo off', 'rem WORKBENCH 工具启动脚本（F-LP-06 自动生成）', 'cd /d %USERPROFILE%', '']
  for (const t of orderedTools.value.slice(0, 20)) {
    if (t.launchType === 'cmd' || /^https?:\/\//.test(t.target)) {
      lines.push(`start "" "${t.target}"`)
    } else if (t.launchType === 'url' && !/^https?:\/\//.test(t.target)) {
      lines.push(`start "" "https://${t.target}"`)
    } else {
      lines.push(`start "" "${t.target}"`)
    }
  }
  batScript.value = lines.join('\r\n')
}
function copyBat() {
  buildBat()
  try {
    navigator.clipboard.writeText(batScript.value)
    message.success('已复制 .bat 内容，可保存为 launch-tools.bat 使用')
  } catch {
    message.info(batScript.value)
  }
}
// F-LP-07 / F-LP-08：工作区场景（保存 / 加载 / 一键开始 / 一键收工）
interface WsScene { at: string; tools: Tool[]; agents: Agent[] }
function saveScene(tag: string): WsScene {
  const sc: WsScene = { at: new Date().toLocaleString('zh-CN'), tools: [...tools.value], agents: [...agents.value] }
  const key = `wb:scene-${tag}`
  try { localStorage.setItem(key, JSON.stringify(sc)) } catch { /* ignore */ }
  return sc
}
function readScene(tag: string): WsScene | null {
  try {
    const raw = localStorage.getItem(`wb:scene-${tag}`)
    return raw ? (JSON.parse(raw) as WsScene) : null
  } catch { return null }
}
function saveSceneNow() {
  const sc = saveScene('auto')
  message.success(`已保存工作区快照（${sc.tools.length} 工具 · ${sc.agents.length} Agent）`)
}
function loadSceneNow() {
  const sc = readScene('auto')
  if (!sc) { message.warning('暂无工作区快照，先点击「收工」保存'); return }
  try {
    Promise.all([
      ...sc.tools.map((t) => toolsRepo.insert({ name: t.name, category: t.category, launchType: t.launchType, target: t.target, port: t.port, note: t.note || '', docUrl: t.docUrl || '', hitCount: t.hitCount || 0 })),
      ...sc.agents.map((a) => agentsRepo.insert({ name: a.name, vendor: a.vendor || '', task: a.task || '', status: a.status as Agent['status'], note: a.note || '' })),
    ]).then(() => { message.success('场景已恢复（追加到当前台账）'); load() })
  } catch { message.error('场景恢复失败') }
}
function quickStart() {
  const first = orderedTools.value[0]
  if (first) launchTool(first)
  const sc = readScene('auto')
  if (sc) message.success(`一键开始：已启动「${first ? first.name : '默认工具'}」，场景快照存在（${sc.at}）`)
  else message.success(`一键开始：已启动「${first ? first.name : '无工具'}」`)
}
function quickEnd() {
  saveSceneNow()
  message.success('收工：已保存工作区快照，下次可一键恢复')
}
// F-AGT-10：Agent 能力档案（基于 vendor 与任务推断能力标签）
const capabilityMap: Record<string, string[]> = {
  claude: ['写作', '分析', '编码'], codex: ['编码', '终端'], gpt: ['问答', '分析', '写作'],
  gemini: ['分析', '多模态'], qwen: ['写作', '分析'], deepseek: ['编码', '问答'],
}
function agentCapabilities(a: Agent): string[] {
  const v = (a.vendor || '').toLowerCase()
  for (const k of Object.keys(capabilityMap)) if (v.includes(k)) return capabilityMap[k]
  const t = (a.task || '')
  const cap: string[] = []
  if (/编码|代码|代码|开发|bug|重构|debug/.test(t)) cap.push('编码')
  if (/写|报告|文档|文案|总结/.test(t)) cap.push('写作')
  if (/分析|调研|检索|对比/.test(t)) cap.push('分析')
  if (/运维|部署|服务器|监控/.test(t)) cap.push('运维')
  return cap.length ? cap : ['通用']
}
// F-AGT-03：卡死归因（stalled 会话自动归因 + 自愈建议）
function stallReason(s: AgentSessionInfo): string {
  if (!s.stalled) return ''
  const age = liveAge(s)
  if (age > 3600) return '长时间无输出（>1h），可能处于死锁或等待外部确认'
  if (age > 600) return '长时间无输出（>10min），疑似模型卡死或网络阻塞'
  return '短时无响应，建议先观察 30s 再重试'
}
function healStalled(s: AgentSessionInfo) {
  message.info(`自愈预案（F-AGT-03）：${s.name} → ① 重试一次 → ② 检查网络/端口 → ③ 回滚到最近检查点`)
  saveSceneNow()
}
// F-AGT-08：变更摘要视图（基于智能体中心队列/历史生成 diff 摘要）
const diffSummary = computed(() => {
  const q = wfQueue.value
  if (!q.length) return '暂无工作流执行记录，无法生成变更摘要'
  const done = q.filter((x) => x.status === 'done').length
  const doing = q.filter((x) => x.status === 'doing').length
  const lines = [`本轮智能体执行摘要：共 ${q.length} 个环节，已完成 ${done}，进行中 ${doing}，待处理 ${q.length - done - doing}`]
  const doneTitles = q.filter((x) => x.status === 'done').slice(0, 4).map((x) => x.title)
  if (doneTitles.length) lines.push(`已完成：${doneTitles.join('、')}`)
  const pending = q.filter((x) => x.status === 'todo').slice(0, 3).map((x) => x.title)
  if (pending.length) lines.push(`待处理：${pending.join('、')}`)
  lines.push(`上次快照：${readScene('auto')?.at ?? '未保存'}（建议执行后点击「收工」固化快照，便于回滚）`)
  return lines
})
// F-AGT-12：回滚点自动记录（每次工作流拆解后自动打点）
const rollbackPoints = ref<Array<{ at: string; goal: string }>>([])
function recordRollbackPoint(goal: string) {
  try {
    const raw = localStorage.getItem('wb:rollback-points')
    const arr: Array<{ at: string; goal: string }> = raw ? JSON.parse(raw) : []
    arr.push({ at: new Date().toLocaleString('zh-CN'), goal: goal.slice(0, 40) })
    rollbackPoints.value = arr.slice(-5)
    localStorage.setItem('wb:rollback-points', JSON.stringify(rollbackPoints.value))
  } catch { /* ignore */ }
}
function loadRollbackPoints() {
  try {
    const raw = localStorage.getItem('wb:rollback-points')
    rollbackPoints.value = raw ? JSON.parse(raw) : []
  } catch { rollbackPoints.value = [] }
}

// ---- 列表键盘导航（↑↓ 选择 · Enter 执行行内最高频操作 · Esc 取消高亮）----
// 本视图不分 Tab，各区块常驻，所以 enabled 只判 loading / 各自的 loading。
// 铁律：Enter 绝不绑删除（删除必须二次确认）。

// 工具启动台：Enter 启动工具（与点击工具名一致的最高动作）
const toolGridEl = ref<HTMLElement>()
useListNav(toolGridEl, {
  rowSelector: '.tool-item',
  enabled: () => !loading.value,
  onEnter: (el) => {
    const id = Number(el.getAttribute('data-row-id'))
    const row = orderedTools.value.find((t) => t.id === id)
    if (row) void launchTool(row)
  },
})

// 扫描结果：Enter 把该程序加入工具列表（addInstalledApp 内部已做重复/失败保护）
const scanListEl = ref<HTMLElement>()
useListNav(scanListEl, {
  rowSelector: '.scan-item',
  enabled: () => !installedLoading.value && scanPanelShow.value,
  onEnter: (el) => {
    const name = el.getAttribute('data-row-id') || ''
    const row = scanFiltered.value.find((a) => a.name === name)
    if (row) void addInstalledApp(row)
  },
})

// Agent 台账：唯一非破坏性操作只有状态下拉（要传具体状态值），没有安全的单一动作 → 仅导航
const agentListEl = ref<HTMLElement>()
useListNav(agentListEl, {
  rowSelector: '.agent-item',
  enabled: () => !loading.value,
})

// Agent 会话扫描：Enter → 卡死会话走自愈预案（healStalled），活跃会话无可执行动作时跳过
const sessionListEl = ref<HTMLElement>()
useListNav(sessionListEl, {
  rowSelector: '.session-item',
  enabled: () => !sessionLoading.value,
  onEnter: (el) => {
    const idx = Number(el.getAttribute('data-row-id'))
    const row = sessions.value[idx]
    if (row?.stalled) healStalled(row)
  },
})

// 工作流子任务：无独立行内操作，仅 ↑↓ 导航
const wfTasksEl = ref<HTMLElement>()
useListNav(wfTasksEl, {
  rowSelector: '.wf-task',
  enabled: () => !wfLoading.value,
})

// 执行历史：Enter 续跑该历史目标（rerunHistory）
const wfHistoryEl = ref<HTMLElement>()
useListNav(wfHistoryEl, {
  rowSelector: '.wf-history-item',
  enabled: () => !wfLoading.value,
  onEnter: (el) => {
    const raw = el.getAttribute('data-row-id') || ''
    const row = wfHistory.value.find((h) => h.at === raw && !!h.goal)
    if (row) void rerunHistory(row.goal)
  },
})

// 待审看板：Enter 把该任务向后推进一步（→ 按钮），已完成的则跳过
const boardColsEl = ref<HTMLElement>()
useListNav(boardColsEl, {
  rowSelector: '.board-card',
  enabled: () => !wfLoading.value,
  onEnter: (el) => {
    const id = el.getAttribute('data-row-id') || ''
    const row = wfQueue.value.find((q) => q.id === id)
    if (!row || row.status === 'done') return
    setQueueStatus(row.id, row.status === 'todo' ? 'doing' : row.status === 'doing' ? 'review' : 'done')
  },
})

// 完成通知：纯只读列表，仅 ↑↓ 导航
const notifyListEl = ref<HTMLElement>()
useListNav(notifyListEl, {
  rowSelector: '.notify-item',
  enabled: () => !wfLoading.value,
})

// Prompt 库：唯一按钮是删除 → 只做 ↑↓ 导航，不给 Enter
const promptListEl = ref<HTMLElement>()
useListNav(promptListEl, {
  rowSelector: '.prompt-item',
  enabled: () => !loading.value,
})

// 回滚点：行内「恢复点」= quickEnd()，作用范围是整个工作区而非该行，
// 绑在单行 Enter 上语义不成立 → 仅 ↑↓ 导航
const rollbackListEl = ref<HTMLElement>()
useListNav(rollbackListEl, {
  rowSelector: '.notify-item',
  enabled: () => !wfLoading.value,
})
</script>

<template>
  <div>

    <div class="grid">
      <!-- 工具启动台 -->
      <section class="wb-card">
        <header class="card-head">
          <span class="accent-bar" style="background: var(--wb-module-workspace)"></span>
          <h2>工具启动台</h2>
          <span class="count mono">{{ filteredTools.length }}</span>
          <NButton size="tiny" type="primary" ghost @click="toggleScanPanel()">
            <template #icon><NIcon :component="Refresh" /></template>
            扫描添加
          </NButton>
          <NButton size="tiny" type="primary" ghost @click="toolFormShow = true">
            <template #icon><NIcon :component="Plus" /></template>
            添加工具
          </NButton>
        </header>
        <div class="card-body">
          <div v-if="scanPanelShow" class="scan-panel">
            <div class="scan-head">
              <span class="scan-title">本机程序快速添加</span>
              <NInput v-model:value="scanKeyword" size="tiny" placeholder="搜索程序（名称 / 路径 / 来源）…" style="width: 220px" clearable />
              <span class="scan-count mono">{{ scanFiltered.length }} / {{ installedTotal }}</span>
              <span v-if="installedScannedAt && !installedLoading" class="scan-cache mono" title="扫描结果缓存 24 小时，点「重新扫描」立即刷新">· 扫描于 {{ fmtScannedAt(installedScannedAt) }}</span>
              <NButton size="tiny" quaternary :loading="installedLoading" @click="rescanInstalledApps()">重新扫描</NButton>
              <NButton size="tiny" quaternary @click="closeScanPanel()">收起</NButton>
            </div>
            <div v-if="installedLoading" class="installed-tip">正在扫描开始菜单与注册表…</div>
            <template v-else-if="installedApps.length">
              <div v-if="scanFiltered.length" class="scan-list" ref="scanListEl" tabindex="0" :aria-label="'本机程序扫描结果，共 ' + scanFiltered.length + ' 行，↑↓ 选择、Enter 添加到工具台'">
                <div v-for="a in scanFiltered" :key="a.name + a.source" class="scan-item" :data-row-id="a.name">
                  <span class="scan-name" :title="a.exe_path || a.lnk_path || ''">{{ a.name }}</span>
                  <NTag size="tiny" :bordered="false" type="default">{{ a.source === 'start-menu' ? '开始菜单' : '注册表' }}</NTag>
                  <NTag v-if="isSystemApp(a)" size="tiny" :bordered="false" type="warning">系统</NTag>
                  <NButton
                    v-if="isAppAdded(a)" size="tiny" disabled
                  >已添加</NButton>
                  <NButton
                    v-else size="tiny" type="primary" ghost
                    :loading="scanAdding[a.name] === true"
                    @click="addInstalledApp(a)"
                  >添加</NButton>
                </div>
              </div>
              <div v-else class="installed-tip">没有匹配「{{ scanKeyword }}」的程序</div>
              <div v-if="scanRest > 0" class="installed-more">
                <NButton size="tiny" text type="primary" @click="moreScanApps()">显示更多（{{ scanRest }}）</NButton>
              </div>
              <div class="installed-tip scan-sort-tip">排序：安装的程序优先，系统 / 组件类靠后</div>
            </template>
            <div v-else class="installed-tip">未扫描到本机程序（需 Tauri 环境），可点击右上角「重新扫描」</div>
          </div>
          <div class="tool-bar">
            <NInput v-model:value="keyword" size="small" placeholder="搜索工具…" clearable style="flex: 1" />
            <NCheckbox
              v-if="tools.length"
              :checked="toolAllChecked"
              :indeterminate="toolSomeChecked"
              size="small"
              @update:checked="toggleAllTools"
            >全选</NCheckbox>
            <NButton size="tiny" quaternary @click="toggleToolSort()">{{ toolSort === 'hot' ? '按频次' : '按名称' }}</NButton>
            <NButton size="tiny" quaternary @click="copyBat()">生成 .bat</NButton>
            <NButton size="tiny" type="primary" ghost @click="quickStart()">一键开始</NButton>
            <NButton size="tiny" type="warning" ghost @click="quickEnd()">收工</NButton>
          </div>
          <div class="tool-hint mono">热键：Alt+1..9 启动前 9 个工具 · F-LP-04/05/06/08</div>
          <ListSkeleton v-if="loading" :rows="6" />
          <div v-if="toolSelActive" class="batch-bar">
            <span class="batch-count">已选 {{ selToolCount }} 项</span>
            <NSelect v-model:value="batchToolCategory" size="small" :options="batchToolCategoryOptions" class="batch-status-select" />
            <NButton size="small" type="primary" ghost @click="batchSetToolCategory">批量改分类</NButton>
            <NButton size="small" type="error" ghost @click="batchRemoveTools">
              <template #icon><NIcon :component="Trash" /></template>
              批量删除
            </NButton>
            <NButton size="small" text @click="clearToolSel">取消选择</NButton>
          </div>
          <div v-else-if="orderedTools.length" class="tool-grid" ref="toolGridEl" tabindex="0" :aria-label="'工具列表，共 ' + orderedTools.length + ' 行，↑↓ 选择、Enter 启动'">
            <div v-for="(t, idx) in orderedTools" :key="t.id" class="tool-item" :data-row-id="t.id">
              <span class="tool-check"><NCheckbox :checked="isToolSelected(t.id)" @update:checked="toggleTool(t.id)" @click.stop /></span>
              <div class="tool-main" @click="launchTool(t)">
                <span class="tool-dot" :style="{ background: 'var(--wb-module-workspace)' }"></span>
                <div class="tool-info">
                  <div class="tool-name">
                    {{ t.name }}
                    <span
                      v-if="t.port"
                      class="probe-dot"
                      :class="probeMap[t.port] === undefined ? 'probe-unknown' : probeMap[t.port] ? 'probe-on' : 'probe-off'"
                      :title="probeTitle(t)"
                    ></span>
                    <span class="mono hits" v-if="t.hitCount">×{{ t.hitCount }}</span>
                    <span v-if="idx < 9" class="hotkey-tag mono">Alt+{{ idx + 1 }}</span>
                  </div>
                  <div class="tool-target mono">{{ t.target }}</div>
                </div>
              </div>
              <div class="tool-ops">
                <NButton size="tiny" quaternary circle @click="launchTool(t)" title="启动">
                  <template #icon><NIcon :component="Rocket" /></template>
                </NButton>
                <NButton size="tiny" quaternary circle @click="openEditTool(t)" title="编辑">
                  <template #icon><NIcon :component="Edit" /></template>
                </NButton>
                <NButton size="tiny" quaternary circle type="error" @click="removeTool(t)" title="删除">
                  <template #icon><NIcon :component="Trash" /></template>
                </NButton>
              </div>
            </div>
          </div>
          <EmptyState v-else text="暂无工具，点击右上角添加" />
        </div>
      </section>

      <!-- Agent 手动台账 -->
      <section class="wb-card">
        <header class="card-head">
          <span class="accent-bar" style="background: var(--wb-module-workspace)"></span>
          <h2>Agent 台账</h2>
          <span class="count mono">{{ agents.length }}</span>
          <NButton size="tiny" type="primary" ghost @click="agentFormShow = true">
            <template #icon><NIcon :component="Plus" /></template>
            登记
          </NButton>
        </header>
        <div class="card-body">
          <ListSkeleton v-if="loading" :rows="4" />
          <div v-else-if="agents.length" class="agent-list" ref="agentListEl" tabindex="0" :aria-label="'Agent 台账列表，共 ' + agents.length + ' 行，↑↓ 选择'">
            <div v-for="a in agents" :key="a.id" class="agent-item" :data-row-id="a.id">
              <div class="agent-row">
                <span class="agent-name">{{ a.name }}</span>
                <NTag size="small" :type="agentStatusColor(a.status)" :bordered="false">{{ agentStatusLabel(a.status) }}</NTag>
              </div>
              <div v-if="a.vendor" class="agent-vendor mono">{{ a.vendor }}</div>
              <div v-if="a.task" class="agent-task">{{ a.task }}</div>
              <div v-if="a.note" class="agent-note">{{ a.note }}</div>
              <div class="agent-caps">
                <NTag v-for="c in agentCapabilities(a)" :key="c" size="tiny" :bordered="false" type="info">{{ c }}</NTag>
                <span class="caps-hint">能力档案（F-AGT-10）</span>
              </div>
              <div class="agent-ops">
                <NSelect
                  size="tiny" :value="a.status" style="width: 96px"
                  :options="[{ label: '空闲', value: 'idle' }, { label: '运行中', value: 'running' }, { label: '卡住', value: 'stalled' }, { label: '已完成', value: 'done' }]"
                  @update:value="(v: string) => setAgentStatus(a, v)"
                />
                <NButton size="tiny" quaternary circle @click="openEditAgent(a)" title="编辑">
                  <template #icon><NIcon :component="Edit" /></template>
                </NButton>
                <NButton size="tiny" quaternary circle type="error" @click="removeAgent(a)">
                  <template #icon><NIcon :component="Trash" /></template>
                </NButton>
              </div>
            </div>
          </div>
          <EmptyState v-else text="暂无 Agent 记录" />
        </div>
      </section>

      <!-- 多源会话扫描 -->
      <section class="wb-card session-card">
        <header class="card-head">
          <span class="accent-bar" style="background: var(--wb-module-workspace)"></span>
          <h2>Agent 会话扫描</h2>
          <span class="count mono">{{ sessions.length }} 会话 · 卡死 {{ stalledCount }}</span>
          <NButton size="tiny" type="primary" ghost :loading="sessionLoading" @click="loadSessions()">
            <template #icon><NIcon :component="Refresh" /></template>
            扫描
          </NButton>
        </header>
        <div class="card-body">
          <div v-if="sessions.length" class="session-list" ref="sessionListEl" tabindex="0" :aria-label="'Agent 会话列表，共 ' + sessions.length + ' 行，↑↓ 选择、Enter 对卡死会话执行自愈预案'">
            <div v-for="(s, i) in sessions" :key="`${s.vendor}-${s.session_file}-${i}`" class="session-item" :class="{ 'is-stalled': s.stalled }" :data-row-id="i">
              <div class="s-row">
                <span class="s-vendor">{{ s.vendor }}</span>
                <NTag size="tiny" :bordered="false" :type="s.stalled ? 'error' : 'success'">{{ s.stalled ? '卡死' : '活跃' }}</NTag>
              </div>
              <div class="s-path mono">{{ s.session_file }}</div>
              <div class="s-meta">
                <span class="mono">{{ s.name }}</span>
                <span class="mono">年龄 {{ fmtAgo(liveAge(s)) }}</span>
                <span class="mono">状态 {{ s.status }}</span>
              </div>
              <template v-if="s.stalled">
                <div class="stall-reason">{{ stallReason(s) }}</div>
                <NButton size="tiny" type="error" ghost @click="healStalled(s)">自愈预案（F-AGT-03）</NButton>
              </template>
            </div>
          </div>
          <EmptyState v-else :text="sessionLoading ? '扫描中…' : '未发现 Agent 会话（Tauri 环境可用）'" />
        </div>
      </section>

      <!-- 智能体工作流拆解 -->
      <section class="wb-card">
        <header class="card-head">
          <span class="accent-bar" style="background: var(--wb-module-workspace)"></span>
          <h2>智能体工作流</h2>
          <span class="count mono">F-AGT-06~18</span>
        </header>
        <div class="card-body">
          <div class="wf-input">
            <NInput v-model:value="wfGoal" size="small" type="textarea" :rows="2" placeholder="输入目标任务，如：把下载目录按类型整理并去重归档" />
            <NButton size="small" type="primary" ghost :loading="wfLoading" @click="runWorkflow()">
              <template #icon><NIcon :component="Rocket" /></template>
              拆解计划
            </NButton>
          </div>
          <template v-if="wfResult">
            <div class="wf-meta mono">
              规模 {{ wfResult.estimated_effort }} · {{ wfResult.sub_tasks.length }} 个子任务 · 质量检查 {{ wfResult.quality_checks.length }} 项
            </div>
            <div class="wf-tasks" ref="wfTasksEl" tabindex="0" :aria-label="'工作流子任务列表，共 ' + wfResult.sub_tasks.length + ' 行，↑↓ 选择'">
              <div v-for="st in wfResult.sub_tasks" :key="st.seq" class="wf-task" :data-row-id="st.seq">
                <div class="wf-seq mono">{{ st.seq }}</div>
                <div class="wf-task-body">
                  <div class="wf-title">{{ st.title }}</div>
                  <div class="wf-line">动作：{{ st.action }}</div>
                  <div class="wf-line">验收：{{ st.acceptance }}</div>
                </div>
              </div>
            </div>
            <div class="wf-checks">
              <div class="wf-block-title">质量评估</div>
              <div v-for="q in wfResult.quality_checks" :key="q" class="wf-line check-item">{{ q }}</div>
              <div class="wf-block-title" style="margin-top: 10px">风险提示</div>
              <div v-for="r in wfResult.risks" :key="r" class="wf-line risk-item">{{ r }}</div>
              <div class="wf-block-title" style="margin-top: 10px">自愈预案</div>
              <div v-for="h in wfResult.self_heal_hints" :key="h" class="wf-line heal-item">{{ h }}</div>
            </div>
          </template>
          <EmptyState v-else text="输入目标后点击拆解计划，生成可执行的子任务与质量护栏" />
          <div v-if="wfHistory.length" class="wf-history" ref="wfHistoryEl" tabindex="0" :aria-label="'执行历史列表，共 ' + wfHistory.length + ' 行，↑↓ 选择、Enter 续跑'">
            <div class="wf-history-head">
              <span>执行历史</span>
              <NButton size="tiny" text type="warning" @click="clearWfHistory()">清空</NButton>
            </div>
            <div v-for="(h, i) in wfHistory" :key="i" class="wf-history-item" :data-row-id="h.at">
              <span class="wf-h-time mono">{{ h.at }}</span>
              <span class="wf-h-goal">{{ h.goal }}</span>
              <span class="wf-h-meta mono">{{ h.tasks }} 子任务 · 风险 {{ h.risks }} · {{ h.effort }}</span>
              <NButton size="tiny" text type="primary" @click="rerunHistory(h.goal)">续跑</NButton>
            </div>
          </div>
        </div>
      </section>

      <!-- 智能体中心：待审看板 / 通知 / 成本 / 冲突 / Prompt 库 / 交接包（F-AGT-06~18） -->
      <section class="wb-card">
        <header class="card-head">
          <span class="accent-bar" style="background: var(--wb-module-workspace)"></span>
          <h2>智能体中心</h2>
          <span class="count mono">F-AGT-03/06~12/14/15/17/18</span>
        </header>
        <div class="card-body">
          <!-- 统计行 -->
          <div class="agent-stats">
            <div class="agent-stat">
              <div class="as-num mono">{{ wfQueue.filter((q) => q.status !== 'done').length }}</div>
              <div class="as-label">进行中任务</div>
            </div>
            <div class="agent-stat">
              <div class="as-num mono">{{ costCount }}</div>
              <div class="as-label">执行次数</div>
            </div>
            <div class="agent-stat">
              <div class="as-num mono">{{ costTotal }}</div>
              <div class="as-label">累计成本点</div>
            </div>
            <div class="agent-stat">
              <div class="as-num mono">{{ conflictWarns.length }}</div>
              <div class="as-label">冲突预警</div>
            </div>
          </div>

          <!-- 待审队列 / 分派看板 -->
          <div class="wf-block-title">任务分派看板（待审队列）</div>
          <div v-if="wfQueue.length" class="board-cols" ref="boardColsEl" tabindex="0" :aria-label="'待审任务看板，共 ' + wfQueue.length + ' 行，↑↓ 选择、Enter 推进到下一状态'">
            <div v-for="st in ['todo', 'doing', 'review', 'done']" :key="st" class="board-col">
              <div class="board-col-title mono">{{ { todo: '待办', doing: '执行中', review: '待审', done: '已完成' }[st as 'todo' | 'doing' | 'review' | 'done'] }}</div>
              <div v-for="q in wfQueue.filter((x) => x.status === st)" :key="q.id" class="board-card" :data-row-id="q.id">
                <div class="board-title">{{ q.title }}</div>
                <div class="board-goal mono">{{ q.goal }}</div>
                <NSpace :size="2">
                  <NButton size="tiny" v-if="st !== 'todo'" @click="setQueueStatus(q.id, 'todo')">←</NButton>
                  <NButton size="tiny" v-if="st !== 'done'" @click="setQueueStatus(q.id, st === 'todo' ? 'doing' : st === 'doing' ? 'review' : 'done')">→</NButton>
                  <NButton size="tiny" v-if="st === 'done'" text type="error" @click="setQueueStatus(q.id, 'todo')">重开</NButton>
                </NSpace>
              </div>
            </div>
          </div>
          <EmptyState v-else text="尚无子任务队列：使用上方拆解计划生成任务" />

          <!-- 完成通知 -->
          <div class="wf-block-title" style="margin-top: 14px">完成通知</div>
          <div v-if="notifies.length" class="notify-list" ref="notifyListEl" tabindex="0" :aria-label="'完成通知列表，共 ' + notifies.length + ' 行，↑↓ 选择'">
            <div v-for="(n, i) in notifies" :key="i" class="notify-item" :data-row-id="i"><span class="mono" style="color: var(--wb-text-3)">{{ n.at }}</span> {{ n.text }}</div>
          </div>
          <EmptyState v-else text="暂无完成通知" />

          <!-- 冲突预警 -->
          <div class="wf-block-title" style="margin-top: 14px">冲突预警</div>
          <div v-if="conflictWarns.length" class="notify-list">
            <div v-for="([repo, names], i) in conflictWarns" :key="i" class="notify-item warn">「{{ repo }}」被多个 Agent 登记：{{ names.join(' / ') }}</div>
          </div>
          <EmptyState v-else text="未发现同一仓库被多个 Agent 登记" />

          <!-- 交接包 -->
          <div class="wf-block-title" style="margin-top: 14px">交接包</div>
          <div class="wf-input" style="margin-top: 6px">
            <span style="font-size: 12px; color: var(--wb-text-3)">为最近一次工作流生成 Markdown 交接包（含子任务/质量检查/风险/自愈预案），复制到剪贴板。</span>
            <NButton size="small" type="primary" ghost @click="handoffPack()">生成并复制交接包</NButton>
          </div>

          <!-- Prompt 库 -->
          <div class="wf-block-title" style="margin-top: 14px">Prompt 库</div>
          <div class="wf-input" style="margin-top: 6px">
            <NInput v-model:value="promptName" size="small" placeholder="名称，如：代码审查" style="flex: 0 0 140px" />
            <NInput v-model:value="promptText" size="small" placeholder="模板内容，可用 {{goal}} 占位" style="flex: 1" />
            <NButton size="small" type="primary" ghost @click="addPrompt()">保存</NButton>
          </div>
          <div v-if="promptLib.length" class="prompt-list" ref="promptListEl" tabindex="0" :aria-label="'Prompt 库列表，共 ' + promptLib.length + ' 行，↑↓ 选择'">
            <div v-if="promptSelActive" class="batch-bar">
              <span class="batch-count">已选 {{ promptSelCount }} 项</span>
              <NButton size="small" type="primary" ghost @click="batchCopyPrompts">批量复制</NButton>
              <NButton size="small" type="error" ghost @click="batchRemovePrompts">
                <template #icon><NIcon :component="Trash" /></template>
                批量删除
              </NButton>
              <NButton size="small" text @click="clearPromptSel">取消选择</NButton>
            </div>
            <div class="prompt-head">
              <NCheckbox :checked="promptAllChecked" :indeterminate="promptSomeChecked" size="small" @update:checked="toggleAllPrompts">全选</NCheckbox>
            </div>
            <div v-for="p in promptLib" :key="p.id" class="prompt-item" :data-row-id="p.id">
              <template v-if="editPromptId === p.id">
                <NInput v-model:value="editPromptName" size="tiny" placeholder="名称" style="flex: 0 0 120px" />
                <NInput v-model:value="editPromptText" size="tiny" placeholder="模板内容" style="flex: 1" />
                <NButton size="tiny" text type="primary" @click="saveEditPrompt()">保存</NButton>
                <NButton size="tiny" text @click="cancelEditPrompt()">取消</NButton>
              </template>
              <template v-else>
                <NCheckbox :checked="isPromptSelected(p.id)" @update:checked="togglePrompt(p.id)" @click.stop />
                <span class="prompt-name">{{ p.name }}</span>
                <span class="prompt-text mono">{{ p.text }}</span>
                <NButton size="tiny" text @click="openEditPrompt(p)">编辑</NButton>
                <NButton size="tiny" text type="error" @click="removePrompt(p.id)">删除</NButton>
              </template>
            </div>
          </div>
          <EmptyState v-else text="Prompt 库为空" />

          <!-- 变更摘要（F-AGT-08） -->
          <div class="wf-block-title" style="margin-top: 14px">变更摘要</div>
          <div class="diff-summary">
            <div v-for="(l, i) in diffSummary" :key="i" class="wf-line">{{ l }}</div>
          </div>

          <!-- 回滚点（F-AGT-12） -->
          <div class="wf-block-title" style="margin-top: 14px">回滚点（自动记录）</div>
          <div v-if="rollbackPoints.length" class="notify-list" ref="rollbackListEl" tabindex="0" :aria-label="'回滚点列表，共 ' + rollbackPoints.length + ' 行，↑↓ 选择'">
            <div v-for="(r, i) in rollbackPoints" :key="i" class="notify-item" :data-row-id="i">
              <span class="mono" style="color: var(--wb-text-3)">{{ r.at }}</span> {{ r.goal }}
              <NButton size="tiny" text type="primary" @click="quickEnd()">恢复点</NButton>
            </div>
          </div>
          <EmptyState v-else text="尚无回滚点：每次拆解计划 / 收工会自动记录" />
        </div>
      </section>
    </div>

    <ModalForm v-model:show="toolFormShow" title="添加工具" :fields="toolFields" :initial="toolFormInitial" @submit="addTool">
      <template #extra>
        <div class="installed-pick">
          <div class="installed-head">
            <span class="installed-title">从本机程序识别</span>
            <NButton size="tiny" :loading="installedLoading" @click="loadInstalledApps()">加载已安装程序</NButton>
            <NInput v-if="installedApps.length" v-model:value="installedKeyword" size="tiny" placeholder="过滤…" style="width: 140px" clearable />
          </div>
          <div v-if="installedApps.length" class="installed-list">
            <NButton
              v-for="a in filteredInstalled"
              :key="a.name + a.source"
              size="tiny"
              quaternary
              class="installed-item"
              @click="pickInstalled(a)"
            >{{ a.name }}</NButton>
          </div>
          <div v-else-if="installedLoading" class="installed-tip">正在扫描开始菜单与注册表…</div>
          <div v-else class="installed-tip">点击「加载已安装程序」自动识别本机软件，选中后回填表单</div>
          <div v-if="installedApps.length > filteredInstalled.length" class="installed-more">
            <NButton size="tiny" text type="primary" @click="installedLimit += 40">显示更多（{{ installedApps.length - filteredInstalled.length }}）</NButton>
          </div>
        </div>
      </template>
    </ModalForm>
    <ModalForm v-model:show="agentFormShow" title="登记 Agent" :fields="agentFields" @submit="addAgent" />
    <!-- 编辑弹窗：与新增共用同一份 fields，initial 回填当前值 -->
    <ModalForm v-model:show="editToolShow" title="编辑工具" :fields="toolFields" :initial="editToolForm" confirm-text="保存" @submit="saveEditTool" />
    <ModalForm v-model:show="editAgentShow" title="编辑 Agent" :fields="agentFields" :initial="editAgentForm" confirm-text="保存" @submit="saveEditAgent" />
  </div>
</template>

<style scoped>
/* 批量操作条：沿用 DevView 同一套写法，配色只取既有 token，不引入新色 */
.batch-bar {
  display: flex;
  align-items: center;
  gap: var(--wb-sp-2);
  flex-wrap: wrap;
  padding: 8px 12px;
  border: 1px solid var(--wb-border);
  border-radius: var(--wb-radius-md);
  background: var(--wb-card-alt);
  font-size: var(--wb-fs-sm);
}
.batch-count { color: var(--wb-text-2); margin-right: var(--wb-sp-1); }
.batch-status-select { width: 110px; }
.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--wb-sp-4);
  align-items: start;
}
@media (max-width: 1100px) {
  .grid { grid-template-columns: 1fr; }
}
.card-head {
  display: flex;
  align-items: center;
  gap: var(--wb-sp-2);
  padding: 12px 16px;
  border-bottom: 1px solid var(--wb-border);
}
.card-head h2 {
  margin: 0; font-size: var(--wb-fs-lg); font-weight: 600; flex: 1;
}
.count {
  color: var(--wb-text-3); font-size: var(--wb-fs-sm);
}
.card-body { padding: 12px 16px 16px; }
.tool-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: var(--wb-sp-2);
}
.tool-item {
  border: 1px solid var(--wb-border);
  border-radius: var(--wb-radius-md);
  padding: 10px 12px;
  display: flex;
  align-items: center;
  gap: var(--wb-sp-2);
}
/* 首列 checkbox：flex 布局里靠 flex:none 占位，不影响 tool-main 的伸缩 */
.tool-check { flex: none; display: flex; align-items: center; }
.tool-main {
  flex: 1; display: flex; align-items: center; gap: 9px; cursor: pointer; min-width: 0;
}
.tool-main:hover .tool-name { color: var(--wb-accent); }
.tool-dot { width: 7px; height: 7px; border-radius: 50%; flex: none; }
.tool-info { min-width: 0; }
.tool-name { font-size: var(--wb-fs-md); font-weight: 550; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hits { font-size: 10.5px; color: var(--wb-text-3); margin-left: 4px; }
.probe-dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  margin-left: 5px;
  vertical-align: middle;
}
.probe-on { background: var(--wb-success, #18a058); box-shadow: 0 0 0 2px color-mix(in srgb, #18a058 25%, transparent); }
.probe-off { background: var(--wb-text-3, #999); }
.probe-unknown { background: transparent; border: 1px solid var(--wb-text-3, #999); }
.tool-target { font-size: var(--wb-fs-xs); color: var(--wb-text-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tool-ops { display: flex; flex: none; }
.agent-list { display: flex; flex-direction: column; gap: var(--wb-sp-2); }
.agent-item {
  border: 1px solid var(--wb-border);
  border-radius: var(--wb-radius-md);
  padding: 10px 12px;
}
.agent-row { display: flex; align-items: center; justify-content: space-between; gap: var(--wb-sp-2); }
.agent-name { font-size: var(--wb-fs-md); font-weight: 600; }
.agent-vendor { font-size: 11.5px; color: var(--wb-text-3); margin-top: 2px; }
.agent-task { font-size: 12.5px; margin-top: 4px; }
.agent-note { font-size: 11.5px; color: var(--wb-text-2); margin-top: 2px; }
.agent-ops { display: flex; justify-content: flex-end; align-items: center; gap: var(--wb-sp-2); margin-top: 8px; }
.session-card { grid-column: 1 / -1; }
.session-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: var(--wb-sp-2); }
.session-item {
  border: 1px solid var(--wb-border);
  border-radius: var(--wb-radius-md);
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.session-item.is-stalled { border-color: color-mix(in srgb, var(--wb-danger) 55%, transparent); }
.s-row { display: flex; align-items: center; justify-content: space-between; }
.s-vendor { font-size: var(--wb-fs-md); font-weight: 600; }
.s-path { font-size: var(--wb-fs-xs); color: var(--wb-text-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.s-meta { display: flex; align-items: center; gap: var(--wb-sp-3); flex-wrap: wrap; font-size: var(--wb-fs-xs); color: var(--wb-text-2); }
.stall-reason { font-size: var(--wb-fs-xs); color: var(--wb-danger); line-height: 1.5; }
.agent-caps { display: flex; align-items: center; gap: var(--wb-sp-1); flex-wrap: wrap; }
.caps-hint { font-size: 10px; color: var(--wb-text-3); margin-left: 2px; }
.tool-bar { display: flex; align-items: center; gap: var(--wb-sp-2); margin-bottom: 6px; }
.tool-hint { font-size: 10.5px; color: var(--wb-text-3); margin-bottom: 8px; }
.hotkey-tag { font-size: 9.5px; color: var(--wb-text-3); border: 1px dashed var(--wb-border); border-radius: var(--wb-radius-md); padding: 0 4px; margin-left: 4px; }
.diff-summary { display: flex; flex-direction: column; gap: 3px; padding: 8px 10px; border-radius: var(--wb-radius-sm); background: var(--wb-card-alt); }
.wf-input { display: flex; gap: var(--wb-sp-2); align-items: flex-start; margin-bottom: 12px; }
.wf-input .n-input { flex: 1; }
.wf-meta { font-size: var(--wb-fs-xs); color: var(--wb-text-3); margin-bottom: 10px; }
.wf-tasks { display: flex; flex-direction: column; gap: var(--wb-sp-2); margin-bottom: 12px; }
.wf-task {
  display: flex; gap: var(--wb-sp-3);
  border: 1px solid var(--wb-border);
  border-radius: var(--wb-radius-md);
  padding: 9px 12px;
}
.wf-seq { font-size: var(--wb-fs-sm); font-weight: 700; color: var(--wb-module-workspace); flex: none; }
.wf-task-body { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.wf-title { font-size: var(--wb-fs-md); font-weight: 600; }
.wf-line { font-size: var(--wb-fs-sm); color: var(--wb-text-2); line-height: 1.55; }
.wf-block-title { font-size: var(--wb-fs-sm); font-weight: 700; margin-bottom: 6px; }
.check-item::before { content: '✓ '; color: var(--wb-success, #18a058); }
.risk-item::before { content: '! '; color: var(--wb-danger); }
.heal-item::before { content: '↻ '; color: var(--wb-info, #2080f0); }
.wf-history {
  margin-top: 14px;
  border-top: 1px dashed var(--wb-border);
  padding-top: 10px;
  display: flex;
  flex-direction: column;
  gap: var(--wb-sp-2);
}
.wf-history-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: var(--wb-fs-sm);
  font-weight: 650;
  color: var(--wb-text-2);
}
.wf-history-item {
  display: flex;
  align-items: center;
  gap: var(--wb-sp-2);
  padding: 6px 8px;
  border: 1px solid var(--wb-border);
  border-radius: var(--wb-radius-sm);
  background: var(--wb-card-alt);
}
.wf-h-time { flex: none; font-size: 10.5px; color: var(--wb-text-3); }
.wf-h-goal { flex: 1; font-size: var(--wb-fs-sm); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wf-h-meta { flex: none; font-size: 10.5px; color: var(--wb-text-3); }
.agent-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--wb-sp-2); margin-bottom: 12px; }
.agent-stat { border: 1px solid var(--wb-border); border-radius: var(--wb-radius-sm); padding: 8px; text-align: center; background: var(--wb-card-alt); }
.as-num { font-size: var(--wb-fs-2xl); font-weight: 700; color: var(--wb-module-workspace); }
.as-label { font-size: var(--wb-fs-xs); color: var(--wb-text-3); margin-top: 2px; }
.board-cols { display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--wb-sp-2); }
.board-col { border: 1px dashed var(--wb-border); border-radius: var(--wb-radius-sm); padding: 6px; min-height: 60px; }
.board-col-title { font-size: var(--wb-fs-xs); font-weight: 650; margin-bottom: 6px; color: var(--wb-text-2); }
.board-card { border: 1px solid var(--wb-border); border-radius: var(--wb-radius-sm); padding: 6px; margin-bottom: 6px; background: var(--wb-card-alt); }
.board-title { font-size: var(--wb-fs-sm); font-weight: 600; }
.board-goal { font-size: 10px; color: var(--wb-text-3); margin: 2px 0 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.notify-list { display: flex; flex-direction: column; gap: var(--wb-sp-1); }
.notify-item { font-size: var(--wb-fs-sm); padding: 5px 8px; border: 1px solid var(--wb-border); border-radius: var(--wb-radius-sm); background: var(--wb-card-alt); }
.notify-item.warn { border-color: var(--wb-warning, #f0a020); color: var(--wb-warning, #f0a020); }
.prompt-list { display: flex; flex-direction: column; gap: var(--wb-sp-1); margin-top: 8px; }
.prompt-head { display: flex; align-items: center; padding: 0 2px; }
.prompt-item { display: flex; align-items: center; gap: var(--wb-sp-2); font-size: var(--wb-fs-sm); padding: 6px 8px; border: 1px solid var(--wb-border); border-radius: var(--wb-radius-sm); background: var(--wb-card-alt); }
.prompt-name { flex: none; font-weight: 650; }
.prompt-text { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--wb-text-3); }
.installed-pick { margin-top: 10px; padding-top: 10px; border-top: 1px dashed var(--wb-border); }
.installed-head { display: flex; align-items: center; gap: var(--wb-sp-2); margin-bottom: 6px; }
.installed-title { font-size: var(--wb-fs-sm); font-weight: 650; color: var(--wb-text-2); }
.installed-list { display: flex; flex-wrap: wrap; gap: var(--wb-sp-1); max-height: 160px; overflow-y: auto; }
.installed-item { border: 1px solid var(--wb-border); }
.installed-item:hover { border-color: var(--wb-accent); color: var(--wb-accent); }
.installed-tip { font-size: 11.5px; color: var(--wb-text-3); padding: 4px 0; }
.installed-more { margin-top: 6px; }
.scan-panel {
  border: 1px solid var(--wb-border);
  border-radius: var(--wb-radius-md);
  background: var(--wb-card-alt);
  padding: 10px 12px;
  margin-bottom: 10px;
}
.scan-head { display: flex; align-items: center; gap: var(--wb-sp-2); margin-bottom: 8px; flex-wrap: wrap; }
.scan-title { font-size: var(--wb-fs-sm); font-weight: 650; color: var(--wb-text-2); }
.scan-count { font-size: var(--wb-fs-xs); color: var(--wb-text-3); margin-left: auto; }
.scan-list {
  display: flex;
  flex-direction: column;
  gap: var(--wb-sp-1);
  max-height: 240px;
  overflow-y: auto;
}
.scan-item {
  display: flex;
  align-items: center;
  gap: var(--wb-sp-2);
  padding: 5px 8px;
  border: 1px solid var(--wb-border);
  border-radius: var(--wb-radius-sm);
  background: var(--wb-card, transparent);
}
.scan-name {
  flex: 1;
  min-width: 0;
  font-size: var(--wb-fs-sm);
  font-weight: 550;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
