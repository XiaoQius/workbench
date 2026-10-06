<script setup lang="ts">
import { watch, ref, onMounted, computed } from 'vue'
import { refreshTick } from '@/stores/ui'
import { NButton, NTag, NTabs, NTabPane, NIcon, useMessage, NProgress, NInput } from 'naive-ui'
import { Plus, Trash, Refresh } from '@vicons/tabler'
import EmptyState from '@/components/EmptyState.vue'
import ListSkeleton from '@/components/ListSkeleton.vue'
import ModalForm, { type FieldDef } from '@/components/ModalForm.vue'
import { serversRepo, domainsRepo, opsFlowsRepo, opsChangesRepo, opsSecChecksRepo, opsSecretsRepo, opsDnsRepo } from '@/db'
import { diskSpace, portUsage, healthCheck, proxyDetect, wslStatus, schtasksList, backupVerify, type DiskInfo, type PortInfo, type HealthResult, type ProxyInfo, type WslDistro, type ScheduledTask, type BackupVerifyInfo } from '@/composables/useTauri'
import type { Server, Domain, OpsFlow, OpsChange, OpsSecCheck, OpsSecret, OpsDnsRecord } from '../../drizzle/schema'
import { useConfirm } from '@/composables/useConfirm'
import { useListNav } from '@/composables/useListNav'
import { matchKw } from '@/composables/match'

const message = useMessage()
const { confirm } = useConfirm()
const servers = ref<Server[]>([])
const domains = ref<Domain[]>([])
const disks = ref<DiskInfo[]>([])
const ports = ref<PortInfo[]>([])
const serverFormShow = ref(false)
const domainFormShow = ref(false)
const portFilter = ref('')

// ---- 到期倒计时 / 预警（F-OPS-02/04） ----
const today = new Date()
const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
const dayDiff = (d?: string | null) => {
  if (!d) return null
  return Math.ceil((new Date(d + 'T00:00:00').getTime() - new Date(todayStr + 'T00:00:00').getTime()) / 86400000)
}
const dueTag = (d?: string | null) => {
  const diff = dayDiff(d)
  if (diff === null) return null
  if (diff < 0) return { color: 'error' as const, text: `已过期 ${-diff} 天` }
  if (diff <= 30) return { color: 'warning' as const, text: `剩 ${diff} 天` }
  if (diff <= 90) return { color: 'info' as const, text: `剩 ${diff} 天` }
  return null
}
const expiringCount = computed(() => {
  let n = 0
  for (const s of servers.value) {
    const sd = dayDiff(s.expireDate)
    if (sd !== null && sd <= 30) n++
  }
  for (const d of domains.value) {
    const dd = dayDiff(d.expireDate)
    const ssl = dayDiff(d.sslExpireDate)
    if (dd !== null && dd <= 30) n++
    if (ssl !== null && ssl <= 30) n++
  }
  return n
})

// ---- 列表搜索 ----
// 每张表只按「人认得出来的那几列」匹配，不逐字段全扫。
const serverKw = ref('')
const domainKw = ref('')
const flowKw = ref('')
const changeKw = ref('')
const secKw = ref('')
const secretKw = ref('')
const dnsKw = ref('')


const filteredServers = computed(() => servers.value.filter((s) => matchKw(serverKw.value, s.name, s.ip, s.region, s.note)))
const filteredDomains = computed(() => domains.value.filter((d) => matchKw(domainKw.value, d.name, d.registrar, d.dnsProvider, d.note)))

/**
 * 域名年成本合计：按续费周期折算成年成本后求和。
 * monthly ×12、yearly ×1、once 不摊入年成本（一次性买入不算年度支出）。
 */
const domainYearCost = computed(() => {
  let sum = 0
  for (const d of domains.value) {
    const c = Number((d as { cost?: number | null }).cost ?? 0)
    if (!Number.isFinite(c) || c <= 0) continue
    const cycle = String((d as { renewCycle?: string | null }).renewCycle || 'yearly')
    if (cycle === 'monthly') sum += c * 12
    else if (cycle === 'yearly') sum += c
  }
  return sum
})
/** 单条域名的年成本（列表展示用），一次性返回 null */
function yearlyCost(d: Domain): number | null {
  const c = Number((d as { cost?: number | null }).cost ?? 0)
  if (!Number.isFinite(c) || c <= 0) return null
  const cycle = String((d as { renewCycle?: string | null }).renewCycle || 'yearly')
  if (cycle === 'monthly') return c * 12
  if (cycle === 'yearly') return c
  return null
}
const filteredFlows = computed(() => flows.value.filter((f) => matchKw(flowKw.value, f.name, f.metric, f.status, f.note)))
const filteredChanges = computed(() => changes.value.filter((c) => matchKw(changeKw.value, c.title, c.env, c.category, c.operator, c.detail)))
const filteredSecChecks = computed(() => secChecks.value.filter((s) => matchKw(secKw.value, s.title, s.category, s.result, s.detail)))
const filteredSecrets = computed(() => secrets.value.filter((s) => matchKw(secretKw.value, s.name, s.provider, s.account, s.note)))
const filteredDnsRecords = computed(() => dnsRecords.value.filter((d) => matchKw(dnsKw.value, d.name, d.recordType, d.host, d.value)))

// ---- 域名↔服务器关联 / 一键复制 SSH（F-OPS-05/06） ----
const serverName = (id?: number | null) => (id ? servers.value.find((x) => x.id === id)?.name || `#${id}` : '—')
const serverDomainCount = (id: number) => domains.value.filter((d) => d.serverId === id).length
async function copySsh(s: Server) {
  const cmd = s.user && s.ip ? `ssh ${s.user}@${s.ip} -p ${s.sshPort}` : ''
  if (!cmd) {
    message.warning('该服务器缺少 IP 或登录用户，无法生成连接命令')
    return
  }
  try {
    await navigator.clipboard.writeText(cmd)
    message.success(`已复制：${cmd}`)
  } catch {
    message.error('复制失败')
  }
}

// ---- 能力层：健康探测 / 代理检测（F-OPS-07/10） ----
const healthTarget = ref('127.0.0.1:5173')
const healthResult = ref<HealthResult | null>(null)
const healthLoading = ref(false)
const proxyInfo = ref<ProxyInfo | null>(null)
const proxyLoading = ref(false)

async function runHealth() {
  healthLoading.value = true
  healthResult.value = null
  try {
    healthResult.value = await healthCheck(healthTarget.value)
  } catch {
    message.warning('健康探测仅 Tauri 环境可用')
  } finally {
    healthLoading.value = false
  }
}

async function runProxy() {
  proxyLoading.value = true
  proxyInfo.value = null
  try {
    proxyInfo.value = await proxyDetect()
  } catch {
    message.warning('代理检测仅 Tauri 环境可用')
  } finally {
    proxyLoading.value = false
  }
}

// ---- WSL 发行版状态（F-OPS-11）/ 定时任务台账（F-DEV-10） ----
const wslDists = ref<WslDistro[]>([])
const wslLoading = ref(false)
const tasks = ref<ScheduledTask[]>([])
const taskLoading = ref(false)
const taskFilter = ref('')
const backups = ref<BackupVerifyInfo[]>([])
const backupLoading = ref(false)

const fmtBackupSize = (n: number) => {
  if (n >= 1048576) return `${(n / 1048576).toFixed(1)} MB`
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${n} B`
}

async function runBackupVerify() {
  backupLoading.value = true
  backups.value = []
  try {
    backups.value = await backupVerify()
  } catch {
    message.warning('备份验证仅 Tauri 环境可用')
  } finally {
    backupLoading.value = false
  }
}

async function runWsl() {
  wslLoading.value = true
  wslDists.value = []
  try {
    wslDists.value = await wslStatus()
  } catch {
    message.warning('WSL 检测仅 Tauri 环境可用')
  } finally {
    wslLoading.value = false
  }
}

async function runTasks() {
  taskLoading.value = true
  tasks.value = []
  try {
    tasks.value = await schtasksList()
  } catch {
    message.warning('定时任务读取仅 Tauri 环境可用')
  } finally {
    taskLoading.value = false
  }
}

async function copyWslCmd(name: string) {
  const cmd = `wsl -d ${name}`
  try {
    await navigator.clipboard.writeText(cmd)
    message.success(`已复制：${cmd}`)
  } catch {
    message.error('复制失败')
  }
}

const filteredTasks = computed(() =>
  taskFilter.value
    ? tasks.value.filter((t) => t.task_name.toLowerCase().includes(taskFilter.value.toLowerCase()) || t.status.toLowerCase().includes(taskFilter.value.toLowerCase()))
    : tasks.value.slice(0, 200),
)

const loading = ref(false)
async function load() {
  loading.value = true
  try {
    const [ss, ds, fl, ch, sc, sk, dn] = await Promise.all([
      serversRepo.listAll(), domainsRepo.listAll(), opsFlowsRepo.listAll(), opsChangesRepo.listAll(),
      opsSecChecksRepo.listAll(), opsSecretsRepo.listAll(), opsDnsRepo.listAll(),
    ])
    servers.value = ss
    domains.value = ds
    flows.value = fl
    changes.value = ch
    secChecks.value = sc
    secrets.value = sk
    dnsRecords.value = dn
  } catch (e) {
    message.warning('数据加载失败（浏览器降级为演示模式）')
    console.warn(e)
  }
  try {
    disks.value = await diskSpace()
  } catch { disks.value = [] }
  try {
    ports.value = await portUsage()
  } catch { ports.value = [] }
  loading.value = false
}
watch(refreshTick, () => load())
onMounted(load)

// ---- 服务器 ----
const serverFields: FieldDef[] = [
  { key: 'name', label: '名称', required: true },
  { key: 'vendor', label: '厂商' },
  { key: 'region', label: '区域' },
  { key: 'ip', label: 'IP' },
  { key: 'sshPort', label: 'SSH 端口', type: 'number' },
  { key: 'user', label: '登录用户' },
  { key: 'purpose', label: '用途', span: 2 },
  { key: 'monthlyCost', label: '月费用 (¥)', type: 'number' },
  { key: 'expireDate', label: '到期日期', type: 'date' },
  { key: 'status', label: '状态', type: 'select', options: [
    { label: '运行中', value: 'active' }, { label: '已停', value: 'stopped' }, { label: '即将到期', value: 'expiring' },
  ] },
  { key: 'config', label: '配置', span: 2 },
  { key: 'note', label: '备注', type: 'textarea', span: 2 },
]

async function addServer(v: Record<string, unknown>) {
  try {
    await serversRepo.insert({
      name: String(v.name), vendor: String(v.vendor || ''), region: String(v.region || ''),
      ip: String(v.ip || ''), sshPort: v.sshPort ? Number(v.sshPort) : 22,
      user: String(v.user || ''), purpose: String(v.purpose || ''),
      monthlyCost: v.monthlyCost ? Number(v.monthlyCost) : undefined,
      expireDate: v.expireDate ? String(v.expireDate) : undefined,
      status: String(v.status || 'active'), config: String(v.config || ''), note: String(v.note || ''),
    })
    message.success('服务器已登记')
    load()
  } catch { message.error('添加失败（请通过 npm run tauri dev 启动）') }
}

async function removeServer(s: Server) {
  const ok = await confirm({ title: '删除服务器？', content: `「${s.name}」${s.ip || '无 IP'}，删除后无法恢复。` })
  if (!ok) return
  try {
    await serversRepo.remove(s.id)
    message.success('已删除')
    load()
  } catch { message.error('删除失败') }
}

const serverStatus = (s: Server) => {
  const color = s.status === 'active' ? 'success' : s.status === 'expiring' ? 'warning' : 'default'
  const label = s.status === 'active' ? '运行中' : s.status === 'expiring' ? '即将到期' : '已停'
  return { color, label }
}

// ---- 域名 ----
const domainFields: FieldDef[] = [
  { key: 'name', label: '域名', required: true },
  { key: 'registrar', label: '注册商' },
  { key: 'dnsProvider', label: 'DNS 服务商' },
  { key: 'expireDate', label: '域名到期', type: 'date' },
  { key: 'sslExpireDate', label: 'SSL 到期', type: 'date' },
  { key: 'serverId', label: '关联服务器 ID', type: 'number' },
  { key: 'cost', label: '成本(元)', type: 'number' },
  { key: 'renewCycle', label: '续费周期', type: 'select', options: [
    { label: '按年', value: 'yearly' }, { label: '按月', value: 'monthly' }, { label: '一次性', value: 'once' },
  ] },
  { key: 'note', label: '备注', type: 'textarea', span: 2 },
]

async function addDomain(v: Record<string, unknown>) {
  try {
    await domainsRepo.insert({
      name: String(v.name), registrar: String(v.registrar || ''), dnsProvider: String(v.dnsProvider || ''),
      expireDate: v.expireDate ? String(v.expireDate) : undefined,
      sslExpireDate: v.sslExpireDate ? String(v.sslExpireDate) : undefined,
      serverId: v.serverId ? Number(v.serverId) : undefined, note: String(v.note || ''),
      cost: v.cost === null || v.cost === undefined || v.cost === '' ? undefined : Number(v.cost),
      renewCycle: v.renewCycle ? String(v.renewCycle) : undefined,
    })
    message.success('域名已登记')
    load()
  } catch { message.error('添加失败（请通过 npm run tauri dev 启动）') }
}

async function removeDomain(d: Domain) {
  const ok = await confirm({ title: '删除域名？', content: `「${d.name}」删除后无法恢复。` })
  if (!ok) return
  try {
    await domainsRepo.remove(d.id)
    message.success('已删除')
    load()
  } catch { message.error('删除失败') }
}

const fmtGb = (b: number) => (b / 1024 / 1024 / 1024).toFixed(1)
const fmtPercent = (p: number) => p.toFixed(1)

const filteredPorts = computed(() =>
  portFilter.value
    ? ports.value.filter((p) => String(p.port).includes(portFilter.value) || p.process.toLowerCase().includes(portFilter.value.toLowerCase()))
    : ports.value.slice(0, 200),
)

// ---- 流量预警台账（F-OPS-13） ----
const flows = ref<OpsFlow[]>([])
const flowFormShow = ref(false)
const flowFields: FieldDef[] = [
  { key: 'name', label: '指标名称', required: true },
  { key: 'metric', label: '指标类型', type: 'select', options: [
    { label: 'QPS', value: 'qps' }, { label: 'CPU 使用率', value: 'cpu' }, { label: '内存', value: 'mem' },
    { label: '带宽', value: 'bandwidth' }, { label: '磁盘', value: 'disk' },
  ] },
  { key: 'threshold', label: '预警阈值', type: 'number' },
  { key: 'current', label: '当前值', type: 'number' },
  { key: 'status', label: '状态', type: 'select', options: [
    { label: '正常', value: 'ok' }, { label: '预警', value: 'warn' }, { label: '严重', value: 'critical' },
  ] },
  { key: 'note', label: '备注', type: 'textarea', span: 2 },
]
const flowStatus = (f: OpsFlow) => {
  const color = f.status === 'critical' ? 'error' : f.status === 'warn' ? 'warning' : 'success'
  const label = f.status === 'critical' ? '严重' : f.status === 'warn' ? '预警' : '正常'
  return { color, label }
}
async function addFlow(v: Record<string, unknown>) {
  try {
    await opsFlowsRepo.insert({
      name: String(v.name), metric: String(v.metric || 'qps'),
      threshold: v.threshold ? Number(v.threshold) : 0, current: v.current ? Number(v.current) : 0,
      status: String(v.status || 'ok'), note: String(v.note || ''),
    })
    message.success('已登记流量指标')
    load()
  } catch { message.error('添加失败（请通过 npm run tauri dev 启动）') }
}
async function removeFlow(f: OpsFlow) {
  const ok = await confirm({ title: '删除流量预警？', content: `「${f.name}」${f.metric}，阈值 ${f.threshold}。` })
  if (!ok) return
  try { await opsFlowsRepo.remove(f.id); message.success('已删除'); load() } catch { message.error('删除失败') }
}

// ---- 配置变更台账（F-OPS-14） ----
const changes = ref<OpsChange[]>([])
const changeFormShow = ref(false)
const changeFields: FieldDef[] = [
  { key: 'title', label: '变更标题', required: true },
  { key: 'env', label: '环境', type: 'select', options: [
    { label: '生产', value: 'prod' }, { label: '预发', value: 'staging' }, { label: '开发', value: 'dev' },
  ] },
  { key: 'category', label: '类型', type: 'select', options: [
    { label: '配置', value: 'config' }, { label: '发布', value: 'deploy' }, { label: '回滚', value: 'rollback' }, { label: '其他', value: 'other' },
  ] },
  { key: 'operator', label: '操作人' },
  { key: 'changedAt', label: '变更时间', type: 'date' },
  { key: 'status', label: '状态', type: 'select', options: [
    { label: '计划中', value: 'planned' }, { label: '执行中', value: 'doing' }, { label: '已完成', value: 'done' }, { label: '已回滚', value: 'rollback' },
  ] },
  { key: 'detail', label: '变更详情', type: 'textarea', span: 2 },
]
const changeStatus = (c: OpsChange) => {
  const color = c.status === 'done' ? 'success' : c.status === 'rollback' ? 'error' : c.status === 'doing' ? 'warning' : 'default'
  const label = c.status === 'done' ? '已完成' : c.status === 'rollback' ? '已回滚' : c.status === 'doing' ? '执行中' : '计划中'
  return { color, label }
}
async function addChange(v: Record<string, unknown>) {
  try {
    await opsChangesRepo.insert({
      title: String(v.title), env: String(v.env || 'prod'), category: String(v.category || 'config'),
      detail: String(v.detail || ''), operator: String(v.operator || ''),
      changedAt: v.changedAt ? String(v.changedAt) : undefined, status: String(v.status || 'done'),
    })
    message.success('已记录配置变更')
    load()
  } catch { message.error('添加失败（请通过 npm run tauri dev 启动）') }
}
async function removeChange(c: OpsChange) {
  const ok = await confirm({ title: '删除变更记录？', content: `「${c.title}」${c.env}，${c.changedAt || '无日期'}。` })
  if (!ok) return
  try { await opsChangesRepo.remove(c.id); message.success('已删除'); load() } catch { message.error('删除失败') }
}

// ---- 安全巡检台账（F-OPS-15） ----
const secChecks = ref<OpsSecCheck[]>([])
const secFormShow = ref(false)
const secFields: FieldDef[] = [
  { key: 'title', label: '巡检项', required: true },
  { key: 'category', label: '分类', type: 'select', options: [
    { label: '端口', value: 'port' }, { label: '补丁', value: 'patch' }, { label: '账号', value: 'account' },
    { label: '证书', value: 'cert' }, { label: '日志', value: 'log' }, { label: '其他', value: 'other' },
  ] },
  { key: 'severity', label: '严重级别', type: 'select', options: [
    { label: '低', value: 'low' }, { label: '中', value: 'medium' }, { label: '高', value: 'high' }, { label: '严重', value: 'critical' },
  ] },
  { key: 'result', label: '结果', type: 'select', options: [
    { label: '通过', value: 'pass' }, { label: '失败', value: 'fail' }, { label: '警告', value: 'warn' },
  ] },
  { key: 'checkedAt', label: '巡检日期', type: 'date' },
  { key: 'detail', label: '详情', type: 'textarea', span: 2 },
]
const secSeverity = (s: OpsSecCheck) => {
  const color = s.severity === 'critical' ? 'error' : s.severity === 'high' ? 'error' : s.severity === 'medium' ? 'warning' : 'default'
  const label = s.severity === 'critical' ? '严重' : s.severity === 'high' ? '高' : s.severity === 'medium' ? '中' : '低'
  return { color, label }
}
const secResult = (s: OpsSecCheck) => {
  const color = s.result === 'pass' ? 'success' : s.result === 'warn' ? 'warning' : 'error'
  const label = s.result === 'pass' ? '通过' : s.result === 'warn' ? '警告' : '失败'
  return { color, label }
}
async function addSec(v: Record<string, unknown>) {
  try {
    await opsSecChecksRepo.insert({
      title: String(v.title), category: String(v.category || 'other'), severity: String(v.severity || 'low'),
      result: String(v.result || 'pass'), detail: String(v.detail || ''),
      checkedAt: v.checkedAt ? String(v.checkedAt) : undefined,
    })
    message.success('已记录安全巡检')
    load()
  } catch { message.error('添加失败（请通过 npm run tauri dev 启动）') }
}
async function removeSec(s: OpsSecCheck) {
  const ok = await confirm({ title: '删除安全巡检记录？', content: `「${s.title}」${s.checkedAt || '无日期'}，结果 ${s.result}。` })
  if (!ok) return
  try { await opsSecChecksRepo.remove(s.id); message.success('已删除'); load() } catch { message.error('删除失败') }
}

// ---- 密钥管理台账（F-OPS-16） ----
const secrets = ref<OpsSecret[]>([])
const secretFormShow = ref(false)
const secretFields: FieldDef[] = [
  { key: 'name', label: '密钥名称', required: true },
  { key: 'provider', label: '提供方' },
  { key: 'account', label: '账号' },
  { key: 'status', label: '状态', type: 'select', options: [
    { label: '有效', value: 'active' }, { label: '已过期', value: 'expired' }, { label: '已轮换', value: 'rotated' },
  ] },
  { key: 'expiresAt', label: '过期日期', type: 'date' },
  { key: 'note', label: '备注', type: 'textarea', span: 2 },
]
const secretStatus = (s: OpsSecret) => {
  const color = s.status === 'active' ? 'success' : s.status === 'rotated' ? 'info' : 'error'
  const label = s.status === 'active' ? '有效' : s.status === 'rotated' ? '已轮换' : '已过期'
  return { color, label }
}
async function addSecret(v: Record<string, unknown>) {
  try {
    await opsSecretsRepo.insert({
      name: String(v.name), provider: String(v.provider || ''), account: String(v.account || ''),
      status: String(v.status || 'active'), expiresAt: v.expiresAt ? String(v.expiresAt) : undefined, note: String(v.note || ''),
    })
    message.success('已登记密钥')
    load()
  } catch { message.error('添加失败（请通过 npm run tauri dev 启动）') }
}
async function removeSecret(s: OpsSecret) {
  const ok = await confirm({ title: '删除密钥记录？', content: `「${s.name}」${s.provider || '无服务商'}，删除后无法恢复。` })
  if (!ok) return
  try { await opsSecretsRepo.remove(s.id); message.success('已删除'); load() } catch { message.error('删除失败') }
}

// ---- DNS 记录台账（F-OPS-17） ----
const dnsRecords = ref<OpsDnsRecord[]>([])
const dnsFormShow = ref(false)
const dnsFields: FieldDef[] = [
  { key: 'name', label: '域名', required: true },
  { key: 'recordType', label: '记录类型', type: 'select', options: [
    { label: 'A', value: 'A' }, { label: 'AAAA', value: 'AAAA' }, { label: 'CNAME', value: 'CNAME' },
    { label: 'MX', value: 'MX' }, { label: 'TXT', value: 'TXT' }, { label: 'NS', value: 'NS' }, { label: 'SRV', value: 'SRV' },
  ] },
  { key: 'host', label: '主机记录' },
  { key: 'value', label: '记录值', required: true },
  { key: 'ttl', label: 'TTL (s)', type: 'number' },
  { key: 'status', label: '状态', type: 'select', options: [
    { label: '生效', value: 'active' }, { label: '待生效', value: 'pending' }, { label: '停用', value: 'disabled' },
  ] },
  { key: 'note', label: '备注', type: 'textarea', span: 2 },
]
const dnsStatus = (d: OpsDnsRecord) => {
  const color = d.status === 'active' ? 'success' : d.status === 'pending' ? 'warning' : 'default'
  const label = d.status === 'active' ? '生效' : d.status === 'pending' ? '待生效' : '停用'
  return { color, label }
}
async function addDns(v: Record<string, unknown>) {
  try {
    await opsDnsRepo.insert({
      name: String(v.name), recordType: String(v.recordType || 'A'), host: String(v.host || '@'),
      value: String(v.value), ttl: v.ttl ? Number(v.ttl) : 600,
      status: String(v.status || 'active'), note: String(v.note || ''),
    })
    message.success('已登记 DNS 记录')
    load()
  } catch { message.error('添加失败（请通过 npm run tauri dev 启动）') }
}
async function removeDns(d: OpsDnsRecord) {
  const ok = await confirm({ title: '删除 DNS 记录？', content: `「${d.name}」${d.recordType} 记录，主机 ${d.host}，指向 ${d.value}。` })
  if (!ok) return
  try { await opsDnsRepo.remove(d.id); message.success('已删除'); load() } catch { message.error('删除失败') }
}

// ============================================================
// 列表键盘导航（↑↓ 选择 · Enter 触发该行主操作 · Esc 取消高亮）
// ============================================================

// OpsView 的 n-tabs 原先没有 v-model，激活的 tab 名只存在于 naive-ui 内部，
// 组件外读不到；这里补一个 tab 变量接管它，enabled 才能写成
// `!loading.value && tab.value === '<tab name>'`，与 DevView 的样板一致。
// 初值取第一个面板的 name（'servers'），与未接管时的默认行为相同。
const tab = ref('servers')

// ---- 配置变更（changes）：Enter = 推进到下一状态 ----
// 变更台账的主线就是「计划中 → 执行中 → 已完成」，行内唯一的按钮是删除（破坏性，
// 按项目约定不能绑 Enter），所以把 Enter 绑到状态推进上：安全、可逆、最高频。
const nextChangeStatus: Record<string, string> = { planned: 'doing', doing: 'done', done: 'planned', rollback: 'planned' }
async function advanceChange(c: OpsChange) {
  const next = nextChangeStatus[c.status] ?? 'planned'
  try {
    await opsChangesRepo.update(c.id, { status: next })
    c.status = next as OpsChange['status']
    message.success(`「${c.title}」→ ${changeStatus(c).label}`)
  } catch {
    message.error('更新失败')
  }
}

// ---- 安全巡检（secchecks）：Enter = 在 通过/警告/失败 之间循环 ----
// 巡检记录的核心字段就是结果，行内同样只有删除按钮，故把 Enter 绑到结果循环上。
const nextSecResult: Record<string, string> = { pass: 'warn', warn: 'fail', fail: 'pass' }
async function cycleSecResult(s: OpsSecCheck) {
  const next = nextSecResult[s.result] ?? 'pass'
  try {
    await opsSecChecksRepo.update(s.id, { result: next })
    s.result = next as OpsSecCheck['result']
    message.success(`「${s.title}」→ ${secResult(s).label}`)
  } catch {
    message.error('更新失败')
  }
}

// ---- 密钥管理（secrets）：Enter = 在 有效/已轮换/已过期 之间循环 ----
const nextSecretStatus: Record<string, string> = { active: 'rotated', rotated: 'expired', expired: 'active' }
async function cycleSecretStatus(s: OpsSecret) {
  const next = nextSecretStatus[s.status] ?? 'active'
  try {
    await opsSecretsRepo.update(s.id, { status: next })
    s.status = next as OpsSecret['status']
    message.success(`「${s.name}」→ ${secretStatus(s).label}`)
  } catch {
    message.error('更新失败')
  }
}

// ---- DNS 记录（dns）：Enter = 在 生效/待生效/停用 之间循环 ----
// TTL / 记录值这类字段不适合盲改，但「启用/停用」是开关型操作，循环安全。
const nextDnsStatus: Record<string, string> = { active: 'pending', pending: 'disabled', disabled: 'active' }
async function cycleDnsStatus(d: OpsDnsRecord) {
  const next = nextDnsStatus[d.status] ?? 'active'
  try {
    await opsDnsRepo.update(d.id, { status: next })
    d.status = next as OpsDnsRecord['status']
    message.success(`「${d.name}」→ ${dnsStatus(d).label}`)
  } catch {
    message.error('更新失败')
  }
}

// ---- 流量预警（flows）：Enter = 在 正常/预警/严重 之间循环 ----
// 状态是流量指标最常被手工修正的字段（阈值命中后要人工确认/升级）。
const nextFlowStatus: Record<string, string> = { ok: 'warn', warn: 'critical', critical: 'ok' }
async function cycleFlowStatus(f: OpsFlow) {
  const next = nextFlowStatus[f.status] ?? 'ok'
  try {
    await opsFlowsRepo.update(f.id, { status: next })
    f.status = next as OpsFlow['status']
    message.success(`「${f.name}」→ ${flowStatus(f).label}`)
  } catch {
    message.error('更新失败')
  }
}

// ---- 域名（domains）：Enter = 复制域名 ----
// 域名行只有删除按钮（破坏性，按项目约定不绑 Enter），这里取「复制域名」——
// 与 copySsh / copyWslCmd 同一套写法，是域名行最高频的非破坏性动作。
async function copyDomain(d: Domain) {
  try {
    await navigator.clipboard.writeText(d.name)
    message.success(`已复制：${d.name}`)
  } catch {
    message.error('复制失败')
  }
}

// ---- 端口占用（ports）：Enter = 复制该端口/进程信息 ----
// 端口表是系统只读数据，行内没有任何按钮；最高频的下游动作是
// 「把这条记录带出去查进程 / 关端口」，所以 Enter 绑复制。
async function copyPortInfo(p: PortInfo) {
  const line = `${p.proto} ${p.port} ${p.state} pid=${p.pid} ${p.process || ''}`.trim()
  try {
    await navigator.clipboard.writeText(line)
    message.success(`已复制：${line}`)
  } catch {
    message.error('复制失败')
  }
}

// ============================================================
// useListNav 接线：一个列表 = 一个容器 ref + 一次 useListNav 调用。
// 全部照 DevView 的样板：rowSelector 用 :not(.head) 排除表头行，
// enabled 用 !loading && 当前 tab，onEnter 用 data-row-id 回查数据数组。
// ============================================================

const domainTableEl = ref<HTMLElement>()
useListNav(domainTableEl, {
  rowSelector: '.d-row:not(.head)',
  enabled: () => !loading.value && tab.value === 'domains',
  onEnter: (el) => {
    const id = Number(el.getAttribute('data-row-id'))
    const row = filteredDomains.value.find((d) => d.id === id)
    if (row) void copyDomain(row)
  },
})

const portTableEl = ref<HTMLElement>()
useListNav(portTableEl, {
  rowSelector: '.p-row:not(.head)',
  enabled: () => !loading.value && tab.value === 'ports',
  onEnter: (el) => {
    // 端口没有单一 id，沿用模板 :key 的复合键 proto-port-pid
    const key = el.getAttribute('data-row-id')
    const row = filteredPorts.value.find((p) => `${p.proto}-${p.port}-${p.pid}` === key)
    if (row) void copyPortInfo(row)
  },
})

const flowTableEl = ref<HTMLElement>()
useListNav(flowTableEl, {
  rowSelector: '.d-row:not(.head)',
  enabled: () => !loading.value && tab.value === 'flows',
  onEnter: (el) => {
    const id = Number(el.getAttribute('data-row-id'))
    const row = filteredFlows.value.find((f) => f.id === id)
    if (row) void cycleFlowStatus(row)
  },
})

const changeTableEl = ref<HTMLElement>()
useListNav(changeTableEl, {
  rowSelector: '.d-row:not(.head)',
  enabled: () => !loading.value && tab.value === 'changes',
  onEnter: (el) => {
    const id = Number(el.getAttribute('data-row-id'))
    const row = filteredChanges.value.find((c) => c.id === id)
    if (row) void advanceChange(row)
  },
})

const secTableEl = ref<HTMLElement>()
useListNav(secTableEl, {
  rowSelector: '.d-row:not(.head)',
  enabled: () => !loading.value && tab.value === 'secchecks',
  onEnter: (el) => {
    const id = Number(el.getAttribute('data-row-id'))
    const row = filteredSecChecks.value.find((s) => s.id === id)
    if (row) void cycleSecResult(row)
  },
})

const secretTableEl = ref<HTMLElement>()
useListNav(secretTableEl, {
  rowSelector: '.d-row:not(.head)',
  enabled: () => !loading.value && tab.value === 'secrets',
  onEnter: (el) => {
    const id = Number(el.getAttribute('data-row-id'))
    const row = filteredSecrets.value.find((s) => s.id === id)
    if (row) void cycleSecretStatus(row)
  },
})

const dnsTableEl = ref<HTMLElement>()
useListNav(dnsTableEl, {
  rowSelector: '.d-row:not(.head)',
  enabled: () => !loading.value && tab.value === 'dns',
  onEnter: (el) => {
    const id = Number(el.getAttribute('data-row-id'))
    const row = filteredDnsRecords.value.find((d) => d.id === id)
    if (row) void cycleDnsStatus(row)
  },
})

// 服务器是卡片网格（.server-grid > .server-card），不是 .d-row 表，
// 但同样是平铺 DOM，一并接入；行内最高频的非破坏性动作是 copySsh。
const serverGridEl = ref<HTMLElement>()
useListNav(serverGridEl, {
  rowSelector: '.server-card',
  enabled: () => !loading.value && tab.value === 'servers',
  onEnter: (el) => {
    const id = Number(el.getAttribute('data-row-id'))
    const row = filteredServers.value.find((s) => s.id === id)
    if (row) void copySsh(row)
  },
})

</script>

<template>
  <div>

    <div v-if="expiringCount" class="expire-alert">
      <span class="ea-dot"></span>
      共 {{ expiringCount }} 项资源将在 30 天内到期或已过期（服务器续费 / 域名 / SSL），请及时处理
    </div>

    <n-tabs v-model:value="tab" type="line" class="wb-tabs">
      <!-- 服务器清单 -->
      <n-tab-pane name="servers" tab="服务器">
        <div class="toolbar toolbar-split">
          <NInput v-if="servers.length" v-model:value="serverKw" size="small" placeholder="搜索服务器（名称 / IP / 区域）…" clearable class="toolbar-search" />
          <NButton size="small" type="primary" ghost @click="serverFormShow = true">
            <template #icon><NIcon :component="Plus" /></template>
            登记服务器
          </NButton>
        </div>
        <ListSkeleton v-if="loading" :rows="6" />
        <div v-else-if="filteredServers.length" class="server-grid" ref="serverGridEl" tabindex="0" :aria-label="'服务器列表，共 ' + filteredServers.length + ' 行，↑↓ 选择、Enter 复制 SSH 命令'">
          <div v-for="s in filteredServers" :key="s.id" class="server-card wb-card" :data-row-id="s.id">
            <div class="sc-head">
              <span class="sc-name">{{ s.name }}</span>
              <NTag size="tiny" :bordered="false" :type="serverStatus(s).color as any">{{ serverStatus(s).label }}</NTag>
            </div>
            <div class="sc-meta mono">
              <div v-if="s.ip">{{ s.ip }}:{{ s.sshPort }}</div>
              <div v-else class="dim">无 IP</div>
              <div v-if="s.vendor">{{ s.vendor }}{{ s.region ? ' · ' + s.region : '' }}</div>
              <div v-if="s.purpose">{{ s.purpose }}</div>
            </div>
            <div v-if="s.config" class="sc-config mono">{{ s.config }}</div>
            <div class="sc-foot">
              <span v-if="s.monthlyCost" class="mono cost">¥{{ s.monthlyCost }}/月</span>
              <span v-if="s.expireDate" class="mono due">到期 {{ s.expireDate }}</span>
              <NTag v-if="dueTag(s.expireDate)" size="tiny" :bordered="false" :type="dueTag(s.expireDate)!.color as any">{{ dueTag(s.expireDate)!.text }}</NTag>
              <span v-if="serverDomainCount(s.id)" class="mono due">{{ serverDomainCount(s.id) }} 个域名</span>
              <NButton size="tiny" text type="primary" @click="copySsh(s)">SSH</NButton>
              <NButton size="tiny" text type="error" @click="removeServer(s)"><template #icon><NIcon :component="Trash" /></template></NButton>
            </div>
          </div>
        </div>
        <EmptyState v-else :text="servers.length ? '没有匹配的服务器' : '暂无服务器'" />
      </n-tab-pane>

      <!-- 域名清单 -->
      <n-tab-pane name="domains" tab="域名">
        <div class="toolbar toolbar-split">
          <NInput v-if="domains.length" v-model:value="domainKw" size="small" placeholder="搜索域名（域名 / 注册商）…" clearable class="toolbar-search" />
          <span v-if="domainYearCost > 0" class="dim mono" style="white-space: nowrap">年成本合计 ¥{{ domainYearCost.toFixed(2) }}</span>
          <NButton size="small" type="primary" ghost @click="domainFormShow = true">
            <template #icon><NIcon :component="Plus" /></template>
            登记域名
          </NButton>
        </div>
        <ListSkeleton v-if="loading" :rows="6" />
        <div v-else-if="filteredDomains.length" class="domain-table" ref="domainTableEl" tabindex="0" :aria-label="'域名列表，共 ' + filteredDomains.length + ' 行，↑↓ 选择、Enter 复制域名'">
          <div class="d-row d-row-domain head">
            <span>域名</span><span>注册商</span><span>DNS</span><span>域名到期</span><span>SSL 到期</span><span>关联服务器</span><span>年成本</span><span>剩余</span><span></span>
          </div>
          <div v-for="d in filteredDomains" :key="d.id" class="d-row d-row-domain" :data-row-id="d.id">
            <span class="mono d-name">{{ d.name }}</span>
            <span>{{ d.registrar || '—' }}</span>
            <span>{{ d.dnsProvider || '—' }}</span>
            <span class="mono" :style="d.expireDate && d.expireDate < new Date().toISOString().slice(0, 10) ? 'color: var(--wb-danger)' : ''">{{ d.expireDate || '—' }}</span>
            <span class="mono" :style="d.sslExpireDate && d.sslExpireDate < new Date().toISOString().slice(0, 10) ? 'color: var(--wb-danger)' : ''">{{ d.sslExpireDate || '—' }}</span>
            <span>{{ serverName(d.serverId) }}</span>
            <span class="mono">{{ yearlyCost(d) === null ? '—' : '¥' + yearlyCost(d)!.toFixed(2) }}</span>
            <span>
              <NTag v-if="dueTag(d.expireDate) || dueTag(d.sslExpireDate)" size="tiny" :bordered="false" :type="(dueTag(d.expireDate) || dueTag(d.sslExpireDate))!.color as any">
                {{ (dueTag(d.expireDate) || dueTag(d.sslExpireDate))!.text }}
              </NTag>
              <span v-else class="dim">—</span>
            </span>
            <span style="text-align: right">
              <NButton size="tiny" text type="error" @click="removeDomain(d)"><template #icon><NIcon :component="Trash" /></template></NButton>
            </span>
          </div>
        </div>
        <EmptyState v-else :text="domains.length ? '没有匹配的域名' : '暂无域名'" />
      </n-tab-pane>

      <!-- 磁盘 -->
      <n-tab-pane name="disks" tab="磁盘空间">
        <div v-if="disks.length" class="disk-grid">
          <div v-for="d in disks" :key="d.mount" class="disk-card wb-card">
            <div class="dk-head">
              <span class="dk-mount mono">{{ d.mount }}</span>
              <span class="mono dk-pct" :style="d.used_percent >= 90 ? 'color: var(--wb-danger)' : d.used_percent >= 75 ? 'color: var(--wb-warning)' : ''">
                {{ fmtPercent(d.used_percent) }}%
              </span>
            </div>
            <n-progress
              type="line" :percentage="Math.round(d.used_percent)" :show-indicator="false"
              :color="d.used_percent >= 90 ? 'var(--wb-danger)' : d.used_percent >= 75 ? 'var(--wb-warning)' : 'var(--wb-accent)'"
              :rail-color="'var(--wb-card-alt)'" :height="6"
            />
            <div class="dk-detail mono">
              <span>已用 {{ fmtGb(d.used) }} GB</span>
              <span>可用 {{ fmtGb(d.free) }} GB</span>
            </div>
          </div>
        </div>
        <EmptyState v-else text="磁盘数据仅 Tauri 环境可用（npm run tauri dev）" />
      </n-tab-pane>

      <!-- 端口 -->
      <n-tab-pane name="ports" tab="端口占用">
        <div class="toolbar">
          <NInput v-model:value="portFilter" size="small" placeholder="按端口 / 进程名过滤…" clearable style="width: 240px" />
        </div>
        <div v-if="ports.length" class="port-table" ref="portTableEl" tabindex="0" :aria-label="'端口列表，共 ' + filteredPorts.length + ' 行，↑↓ 选择、Enter 复制端口信息'">
          <div class="p-row head">
            <span>协议</span><span>端口</span><span>状态</span><span>PID</span><span>进程</span>
          </div>
          <div v-for="p in filteredPorts" :key="`${p.proto}-${p.port}-${p.pid}`" class="p-row" :data-row-id="`${p.proto}-${p.port}-${p.pid}`">
            <span class="mono">{{ p.proto }}</span>
            <span class="mono port">{{ p.port }}</span>
            <span><NTag size="tiny" :bordered="false" :type="p.state === 'LISTENING' ? 'warning' : 'default'">{{ p.state }}</NTag></span>
            <span class="mono">{{ p.pid }}</span>
            <span class="mono">{{ p.process || '—' }}</span>
          </div>
        </div>
        <EmptyState v-else text="端口数据仅 Tauri 环境可用（npm run tauri dev）" />
      </n-tab-pane>

      <!-- 健康探测 -->
      <n-tab-pane name="health" tab="健康探测">
        <div class="toolbar">
          <NInput v-model:value="healthTarget" size="small" placeholder="host:port 或 http(s)://url" clearable style="width: 300px; margin-right: 8px" />
          <NButton size="small" type="primary" ghost :loading="healthLoading" @click="runHealth()">
            <template #icon><NIcon :component="Refresh" /></template>
            探测
          </NButton>
        </div>
        <div v-if="healthResult" class="health-card wb-card">
          <div class="hc-head">
            <span class="mono hc-target">{{ healthResult.target }}</span>
            <NTag size="small" :bordered="false" :type="healthResult.ok ? 'success' : 'error'">{{ healthResult.ok ? '在线' : '不可达' }}</NTag>
          </div>
          <div class="hc-detail">
            <span class="mono">延迟 {{ healthResult.latency_ms }}ms</span>
            <span class="mono detail-text">{{ healthResult.detail }}</span>
          </div>
        </div>
        <EmptyState v-else :text="healthLoading ? '探测中…' : '输入目标后探测（仅 Tauri 环境可用）'" />
      </n-tab-pane>

      <!-- 代理状态 -->
      <n-tab-pane name="proxy" tab="代理状态">
        <div class="toolbar">
          <NButton size="small" type="primary" ghost :loading="proxyLoading" @click="runProxy()">
            <template #icon><NIcon :component="Refresh" /></template>
            检测
          </NButton>
        </div>
        <div v-if="proxyInfo" class="proxy-card wb-card">
          <div class="pc-head">
            <span class="pc-title">系统代理</span>
            <NTag size="small" :bordered="false" :type="proxyInfo.enabled ? 'success' : 'default'">{{ proxyInfo.enabled ? '已启用' : '未启用' }}</NTag>
          </div>
          <div class="pc-rows mono">
            <div class="pc-row"><span class="pc-label">Server</span><span>{{ proxyInfo.server || '—' }}</span></div>
            <div class="pc-row"><span class="pc-label">PAC</span><span>{{ proxyInfo.auto_config || '—' }}</span></div>
            <div class="pc-row">
              <span class="pc-label">7890 端口</span>
              <NTag size="tiny" :bordered="false" :type="proxyInfo.port7890_ok ? 'success' : 'warning'">{{ proxyInfo.port7890_ok ? '可连通' : '未监听' }}</NTag>
            </div>
          </div>
        </div>
        <EmptyState v-else :text="proxyLoading ? '检测中…' : '点击检测（仅 Tauri 环境可用）'" />
      </n-tab-pane>

      <!-- WSL 发行版状态 -->
      <n-tab-pane name="wsl" tab="WSL 状态">
        <div class="toolbar">
          <NButton size="small" type="primary" ghost :loading="wslLoading" @click="runWsl()">
            <template #icon><NIcon :component="Refresh" /></template>
            检测
          </NButton>
        </div>
        <div v-if="wslDists.length" class="wsl-list">
          <div v-for="d in wslDists" :key="d.name" class="wsl-item wb-card">
            <div class="wsl-row">
              <span class="mono wsl-name">{{ d.name }}</span>
              <NTag size="tiny" :bordered="false" :type="d.state.toLowerCase() === 'running' ? 'success' : 'default'">{{ d.state }}</NTag>
            </div>
            <div class="wsl-meta mono">
              <span>WSL {{ d.version }}</span>
              <NButton size="tiny" text type="primary" @click="copyWslCmd(d.name)">复制进入命令</NButton>
            </div>
          </div>
        </div>
        <EmptyState v-else :text="wslLoading ? '检测中…' : '未检测到 WSL 发行版（仅 Tauri 环境可用）'" />
      </n-tab-pane>

      <!-- 定时任务台账 -->
      <n-tab-pane name="tasks" tab="定时任务">
        <div class="toolbar" style="justify-content: space-between; align-items: center">
          <span class="dim" style="font-size: 12px">系统计划任务台账（schtasks，F-DEV-10）</span>
          <div style="display: flex; gap: 8px">
            <NInput v-model:value="taskFilter" size="small" placeholder="按任务名 / 状态过滤…" clearable style="width: 220px" />
            <NButton size="small" type="primary" ghost :loading="taskLoading" @click="runTasks()">
              <template #icon><NIcon :component="Refresh" /></template>
              读取
            </NButton>
          </div>
        </div>
        <div v-if="tasks.length" class="task-table">
          <div class="t-row head">
            <span>任务</span><span>下次运行</span><span>状态</span><span>上次运行</span><span>上次结果</span>
          </div>
          <div v-for="t in filteredTasks" :key="t.task_name" class="t-row">
            <span class="mono t-name">{{ t.task_name }}</span>
            <span class="mono">{{ t.next_run }}</span>
            <span>
              <NTag size="tiny" :bordered="false" :type="t.status === 'Running' ? 'warning' : 'default'">{{ t.status }}</NTag>
            </span>
            <span class="mono">{{ t.last_run }}</span>
            <span class="mono" :style="t.last_result !== '0' && t.last_result !== '' && t.last_result !== '—' ? 'color: var(--wb-danger)' : ''">{{ t.last_result || '—' }}</span>
          </div>
        </div>
        <EmptyState v-else :text="taskLoading ? '读取中…' : '点击读取（仅 Tauri 环境可用）'" />
      </n-tab-pane>

      <!-- 备份验证 -->
      <n-tab-pane name="backups" tab="备份验证">
        <div class="toolbar" style="justify-content: space-between; align-items: center">
          <span class="dim" style="font-size: 12px">备份健康检查（解析校验 / 表数量 / 记录数，F-OPS-18）</span>
          <NButton size="small" type="primary" ghost :loading="backupLoading" @click="runBackupVerify()">
            <template #icon><NIcon :component="Refresh" /></template>
            验证
          </NButton>
        </div>
        <div v-if="backups.length" class="task-table">
          <div class="t-row head">
            <span>备份文件</span><span>大小</span><span>表数</span><span>记录数</span><span>状态</span>
          </div>
          <div v-for="b in backups" :key="b.name" class="t-row">
            <span class="mono t-name">{{ b.name }}</span>
            <span class="mono">{{ fmtBackupSize(b.size) }}</span>
            <span class="mono">{{ b.tables }}</span>
            <span class="mono">{{ b.records }}</span>
            <span>
              <NTag size="tiny" :bordered="false" :type="b.valid ? 'success' : 'error'">{{ b.valid ? '健康' : '损坏' }}</NTag>
            </span>
          </div>
          <div v-if="backups.some((b) => !b.valid)" class="dim" style="font-size: 12px; margin-top: 6px">
            损坏项：{{ backups.filter((b) => !b.valid).map((b) => b.error).filter(Boolean).join('；') }}
          </div>
        </div>
        <EmptyState v-else :text="backupLoading ? '验证中…' : '暂无备份文件（Tauri 环境可用）'" />
      </n-tab-pane>

      <!-- 流量预警台账（F-OPS-13） -->
      <n-tab-pane name="flows" tab="流量预警">
        <div class="toolbar toolbar-split">
          <NInput v-if="flows.length" v-model:value="flowKw" size="small" placeholder="搜索指标（名称 / 类型）…" clearable class="toolbar-search" />
          <NButton size="small" type="primary" ghost @click="flowFormShow = true">
            <template #icon><NIcon :component="Plus" /></template>
            登记指标
          </NButton>
        </div>
        <ListSkeleton v-if="loading" :rows="4" />
        <div v-else-if="filteredFlows.length" class="domain-table" ref="flowTableEl" tabindex="0" :aria-label="'流量预警列表，共 ' + filteredFlows.length + ' 行，↑↓ 选择、Enter 循环状态'">
          <div class="d-row head">
            <span>指标</span><span>类型</span><span>当前值</span><span>阈值</span><span>状态</span><span>备注</span><span></span>
          </div>
          <div v-for="f in filteredFlows" :key="f.id" class="d-row" :data-row-id="f.id">
            <span class="mono d-name">{{ f.name }}</span>
            <span>{{ f.metric }}</span>
            <span class="mono" :style="f.current >= f.threshold && f.threshold > 0 ? 'color: var(--wb-danger); font-weight: 600' : ''">{{ f.current }}</span>
            <span class="mono">{{ f.threshold }}</span>
            <span><NTag size="tiny" :bordered="false" :type="flowStatus(f).color as any">{{ flowStatus(f).label }}</NTag></span>
            <span class="dim ellipsis">{{ f.note || '—' }}</span>
            <span style="text-align: right"><NButton size="tiny" text type="error" @click="removeFlow(f)"><template #icon><NIcon :component="Trash" /></template></NButton></span>
          </div>
        </div>
        <EmptyState v-else :text="flows.length ? '没有匹配的指标' : '暂无流量指标，登记后按阈值自动标红预警'" />
      </n-tab-pane>

      <!-- 配置变更台账（F-OPS-14） -->
      <n-tab-pane name="changes" tab="配置变更">
        <div class="toolbar toolbar-split">
          <NInput v-if="changes.length" v-model:value="changeKw" size="small" placeholder="搜索变更（标题 / 环境 / 操作人）…" clearable class="toolbar-search" />
          <NButton size="small" type="primary" ghost @click="changeFormShow = true">
            <template #icon><NIcon :component="Plus" /></template>
            记录变更
          </NButton>
        </div>
        <ListSkeleton v-if="loading" :rows="5" />
        <div v-else-if="filteredChanges.length" class="domain-table" ref="changeTableEl" tabindex="0" :aria-label="'配置变更列表，共 ' + filteredChanges.length + ' 行，↑↓ 选择、Enter 推进状态'">
          <div class="d-row head">
            <span>变更</span><span>环境</span><span>类型</span><span>操作人</span><span>时间</span><span>状态</span><span></span>
          </div>
          <div v-for="c in filteredChanges" :key="c.id" class="d-row" :data-row-id="c.id">
            <span class="d-name">{{ c.title }}</span>
            <span class="mono">{{ c.env }}</span>
            <span>{{ c.category }}</span>
            <span>{{ c.operator || '—' }}</span>
            <span class="mono">{{ c.changedAt || '—' }}</span>
            <span><NTag size="tiny" :bordered="false" :type="changeStatus(c).color as any">{{ changeStatus(c).label }}</NTag></span>
            <span style="text-align: right"><NButton size="tiny" text type="error" @click="removeChange(c)"><template #icon><NIcon :component="Trash" /></template></NButton></span>
          </div>
        </div>
        <EmptyState v-else :text="changes.length ? '没有匹配的变更' : '暂无配置变更记录'" />
      </n-tab-pane>

      <!-- 安全巡检台账（F-OPS-15） -->
      <n-tab-pane name="secchecks" tab="安全巡检">
        <div class="toolbar toolbar-split">
          <NInput v-if="secChecks.length" v-model:value="secKw" size="small" placeholder="搜索巡检项（名称 / 结果）…" clearable class="toolbar-search" />
          <NButton size="small" type="primary" ghost @click="secFormShow = true">
            <template #icon><NIcon :component="Plus" /></template>
            记录巡检
          </NButton>
        </div>
        <ListSkeleton v-if="loading" :rows="5" />
        <div v-else-if="filteredSecChecks.length" class="domain-table" ref="secTableEl" tabindex="0" :aria-label="'安全巡检列表，共 ' + filteredSecChecks.length + ' 行，↑↓ 选择、Enter 循环结果'">
          <div class="d-row head">
            <span>巡检项</span><span>分类</span><span>级别</span><span>结果</span><span>日期</span><span>详情</span><span></span>
          </div>
          <div v-for="s in filteredSecChecks" :key="s.id" class="d-row" :data-row-id="s.id">
            <span class="d-name">{{ s.title }}</span>
            <span>{{ s.category }}</span>
            <span><NTag size="tiny" :bordered="false" :type="secSeverity(s).color as any">{{ secSeverity(s).label }}</NTag></span>
            <span><NTag size="tiny" :bordered="false" :type="secResult(s).color as any">{{ secResult(s).label }}</NTag></span>
            <span class="mono">{{ s.checkedAt || '—' }}</span>
            <span class="dim ellipsis">{{ s.detail || '—' }}</span>
            <span style="text-align: right"><NButton size="tiny" text type="error" @click="removeSec(s)"><template #icon><NIcon :component="Trash" /></template></NButton></span>
          </div>
        </div>
        <EmptyState v-else :text="secChecks.length ? '没有匹配的巡检项' : '暂无安全巡检记录'" />
      </n-tab-pane>

      <!-- 密钥管理台账（F-OPS-16） -->
      <n-tab-pane name="secrets" tab="密钥管理">
        <div class="toolbar toolbar-split">
          <NInput v-if="secrets.length" v-model:value="secretKw" size="small" placeholder="搜索密钥（名称 / 提供方）…" clearable class="toolbar-search" />
          <NButton size="small" type="primary" ghost @click="secretFormShow = true">
            <template #icon><NIcon :component="Plus" /></template>
            登记密钥
          </NButton>
        </div>
        <ListSkeleton v-if="loading" :rows="5" />
        <div v-else-if="filteredSecrets.length" class="domain-table" ref="secretTableEl" tabindex="0" :aria-label="'密钥列表，共 ' + filteredSecrets.length + ' 行，↑↓ 选择、Enter 循环状态'">
          <div class="d-row head">
            <span>密钥</span><span>提供方</span><span>账号</span><span>状态</span><span>过期</span><span>备注</span><span></span>
          </div>
          <div v-for="s in filteredSecrets" :key="s.id" class="d-row" :data-row-id="s.id">
            <span class="mono d-name">{{ s.name }}</span>
            <span>{{ s.provider || '—' }}</span>
            <span class="mono">{{ s.account || '—' }}</span>
            <span><NTag size="tiny" :bordered="false" :type="secretStatus(s).color as any">{{ secretStatus(s).label }}</NTag></span>
            <span class="mono" :style="s.expiresAt && s.expiresAt < new Date().toISOString().slice(0, 10) ? 'color: var(--wb-danger)' : ''">{{ s.expiresAt || '—' }}</span>
            <span class="dim ellipsis">{{ s.note || '—' }}</span>
            <span style="text-align: right"><NButton size="tiny" text type="error" @click="removeSecret(s)"><template #icon><NIcon :component="Trash" /></template></NButton></span>
          </div>
        </div>
        <EmptyState v-else :text="secrets.length ? '没有匹配的密钥' : '暂无密钥记录（仅登记元信息，不存储密钥内容）'" />
      </n-tab-pane>

      <!-- DNS 记录台账（F-OPS-17） -->
      <n-tab-pane name="dns" tab="DNS 记录">
        <div class="toolbar toolbar-split">
          <NInput v-if="dnsRecords.length" v-model:value="dnsKw" size="small" placeholder="搜索 DNS（域名 / 主机 / 记录值）…" clearable class="toolbar-search" />
          <NButton size="small" type="primary" ghost @click="dnsFormShow = true">
            <template #icon><NIcon :component="Plus" /></template>
            登记记录
          </NButton>
        </div>
        <ListSkeleton v-if="loading" :rows="5" />
        <div v-else-if="filteredDnsRecords.length" class="domain-table" ref="dnsTableEl" tabindex="0" :aria-label="'DNS 记录列表，共 ' + filteredDnsRecords.length + ' 行，↑↓ 选择、Enter 循环状态'">
          <div class="d-row head">
            <span>域名</span><span>类型</span><span>主机</span><span>记录值</span><span>TTL</span><span>状态</span><span></span>
          </div>
          <div v-for="d in filteredDnsRecords" :key="d.id" class="d-row" :data-row-id="d.id">
            <span class="mono d-name">{{ d.name }}</span>
            <span class="mono">{{ d.recordType }}</span>
            <span class="mono">{{ d.host }}</span>
            <span class="mono ellipsis">{{ d.value }}</span>
            <span class="mono">{{ d.ttl }}</span>
            <span><NTag size="tiny" :bordered="false" :type="dnsStatus(d).color as any">{{ dnsStatus(d).label }}</NTag></span>
            <span style="text-align: right"><NButton size="tiny" text type="error" @click="removeDns(d)"><template #icon><NIcon :component="Trash" /></template></NButton></span>
          </div>
        </div>
        <EmptyState v-else :text="dnsRecords.length ? '没有匹配的 DNS 记录' : '暂无 DNS 记录'" />
      </n-tab-pane>
    </n-tabs>

    <ModalForm v-model:show="serverFormShow" title="登记服务器" :fields="serverFields" @submit="addServer" />
    <ModalForm v-model:show="domainFormShow" title="登记域名" :fields="domainFields" @submit="addDomain" />
    <ModalForm v-model:show="flowFormShow" title="登记流量指标" :fields="flowFields" @submit="addFlow" />
    <ModalForm v-model:show="changeFormShow" title="记录配置变更" :fields="changeFields" @submit="addChange" />
    <ModalForm v-model:show="secFormShow" title="记录安全巡检" :fields="secFields" @submit="addSec" />
    <ModalForm v-model:show="secretFormShow" title="登记密钥" :fields="secretFields" @submit="addSecret" />
    <ModalForm v-model:show="dnsFormShow" title="登记 DNS 记录" :fields="dnsFields" @submit="addDns" />
  </div>
</template>

<style scoped>
.wb-tabs :deep(.n-tabs-nav) { margin-bottom: 14px; }
.toolbar { display: flex; justify-content: flex-end; margin-bottom: 12px; }
.toolbar-split { justify-content: space-between; align-items: center; gap: var(--wb-sp-3); }
.toolbar-search { max-width: 280px; }
.expire-alert {
  display: flex; align-items: center; gap: var(--wb-sp-2);
  background: color-mix(in srgb, var(--wb-warning) 14%, transparent);
  border: 1px solid color-mix(in srgb, var(--wb-warning) 60%, transparent);
  color: var(--wb-warning);
  border-radius: var(--wb-radius-md);
  padding: 10px 14px;
  margin-bottom: 14px;
  font-size: 12.5px;
}
.ea-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--wb-warning); flex: none; }
.server-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: var(--wb-sp-3);
}
.server-card { padding: 14px 16px; }
.sc-head { display: flex; align-items: center; justify-content: space-between; gap: var(--wb-sp-2); }
.sc-name { font-size: var(--wb-fs-lg); font-weight: 600; }
.sc-meta { display: flex; flex-direction: column; gap: var(--wb-sp-1); font-size: var(--wb-fs-sm); color: var(--wb-text-2); margin-top: 8px; }
.dim { color: var(--wb-text-3); }
.ellipsis { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 220px; }
.sc-config {
  margin-top: 8px; font-size: 11.5px; color: var(--wb-text-3);
  background: var(--wb-card-alt); border-radius: var(--wb-radius-sm); padding: 6px 8px;
}
.sc-foot {
  display: flex; align-items: center; gap: var(--wb-sp-3); margin-top: 10px;
}
.cost { font-size: var(--wb-fs-sm); color: var(--wb-module-ops); font-weight: 600; }
.due { font-size: 11.5px; color: var(--wb-text-3); flex: 1; }
.domain-table, .port-table {
  border: 1px solid var(--wb-border);
  border-radius: var(--wb-radius-md);
  overflow: hidden;
}
.d-row, .p-row {
  display: grid;
  align-items: center;
  gap: var(--wb-sp-3);
  padding: 8px 14px;
  border-bottom: 1px solid var(--wb-border);
  font-size: 12.5px;
}
.d-row { grid-template-columns: 2fr 1fr 1fr 1.2fr 1.2fr 1fr 0.7fr 0.4fr; }
/* 域名表比其它 .d-row 多一列「年成本」；单独覆盖，不动共用栅格 */
.d-row-domain { grid-template-columns: 1.8fr 1fr 1fr 1.1fr 1.1fr 1fr 0.8fr 0.6fr 0.4fr; }
.p-row { grid-template-columns: 0.7fr 0.8fr 1.2fr 0.8fr 2fr; }
.d-row:last-child, .p-row:last-child { border-bottom: none; }
.d-row.head, .p-row.head {
  background: var(--wb-card-alt);
  font-weight: 600;
  color: var(--wb-text-2);
  font-size: var(--wb-fs-sm);
}
.d-name { font-weight: 550; }
.disk-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: var(--wb-sp-3);
}
.disk-card { padding: 14px 16px; }
.dk-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.dk-mount { font-weight: 700; font-size: var(--wb-fs-lg); }
.dk-pct { font-size: var(--wb-fs-md); font-weight: 600; }
.dk-detail { display: flex; justify-content: space-between; font-size: 11.5px; color: var(--wb-text-3); margin-top: 8px; }
.port { font-weight: 600; }
.health-card, .proxy-card { max-width: 640px; padding: 16px 18px; }
.hc-head, .pc-head { display: flex; align-items: center; justify-content: space-between; gap: var(--wb-sp-3); }
.hc-target { font-size: var(--wb-fs-md); font-weight: 600; }
.hc-detail { display: flex; align-items: center; gap: var(--wb-sp-4); margin-top: 12px; font-size: var(--wb-fs-sm); color: var(--wb-text-2); }
.detail-text { color: var(--wb-text-3); }
.pc-title { font-size: var(--wb-fs-lg); font-weight: 600; }
.pc-rows { display: flex; flex-direction: column; gap: var(--wb-sp-2); margin-top: 12px; font-size: 12.5px; }
.pc-row { display: flex; align-items: center; gap: var(--wb-sp-3); }
.pc-label { width: 96px; color: var(--wb-text-3); }
.wsl-list { display: flex; flex-direction: column; gap: var(--wb-sp-2); max-width: 640px; }
.wsl-item { padding: 12px 16px; }
.wsl-row { display: flex; align-items: center; justify-content: space-between; gap: var(--wb-sp-2); }
.wsl-name { font-size: 13.5px; font-weight: 600; }
.wsl-meta { display: flex; align-items: center; justify-content: space-between; margin-top: 6px; font-size: 11.5px; color: var(--wb-text-3); }
.task-table {
  border: 1px solid var(--wb-border);
  border-radius: var(--wb-radius-md);
  overflow: hidden;
}
.t-row {
  display: grid;
  grid-template-columns: 2.4fr 1.2fr 0.8fr 1.2fr 0.9fr;
  align-items: center;
  gap: var(--wb-sp-3);
  padding: 8px 14px;
  border-bottom: 1px solid var(--wb-border);
  font-size: 12.5px;
}
.t-row:last-child { border-bottom: none; }
.t-row.head {
  background: var(--wb-card-alt);
  font-weight: 600;
  color: var(--wb-text-2);
  font-size: var(--wb-fs-sm);
}
.t-name { font-weight: 550; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
