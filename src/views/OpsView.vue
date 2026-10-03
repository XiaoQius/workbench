<script setup lang="ts">
import { watch, ref, onMounted, computed } from 'vue'
import { refreshTick } from '@/stores/ui'
import { NButton, NTag, NTabs, NTabPane, NIcon, useMessage, NProgress, NInput } from 'naive-ui'
import { Plus, Trash, Refresh } from '@vicons/tabler'
import EmptyState from '@/components/EmptyState.vue'
import ModalForm, { type FieldDef } from '@/components/ModalForm.vue'
import { serversRepo, domainsRepo, opsFlowsRepo, opsChangesRepo, opsSecChecksRepo, opsSecretsRepo, opsDnsRepo } from '@/db'
import { diskSpace, portUsage, healthCheck, proxyDetect, wslStatus, schtasksList, backupVerify, type DiskInfo, type PortInfo, type HealthResult, type ProxyInfo, type WslDistro, type ScheduledTask, type BackupVerifyInfo } from '@/composables/useTauri'
import type { Server, Domain, OpsFlow, OpsChange, OpsSecCheck, OpsSecret, OpsDnsRecord } from '../../drizzle/schema'

const message = useMessage()
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

async function load() {
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
  { key: 'note', label: '备注', type: 'textarea', span: 2 },
]

async function addDomain(v: Record<string, unknown>) {
  try {
    await domainsRepo.insert({
      name: String(v.name), registrar: String(v.registrar || ''), dnsProvider: String(v.dnsProvider || ''),
      expireDate: v.expireDate ? String(v.expireDate) : undefined,
      sslExpireDate: v.sslExpireDate ? String(v.sslExpireDate) : undefined,
      serverId: v.serverId ? Number(v.serverId) : undefined, note: String(v.note || ''),
    })
    message.success('域名已登记')
    load()
  } catch { message.error('添加失败（请通过 npm run tauri dev 启动）') }
}

async function removeDomain(d: Domain) {
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
  try { await opsDnsRepo.remove(d.id); message.success('已删除'); load() } catch { message.error('删除失败') }
}
</script>

<template>
  <div>

    <div v-if="expiringCount" class="expire-alert">
      <span class="ea-dot"></span>
      共 {{ expiringCount }} 项资源将在 30 天内到期或已过期（服务器续费 / 域名 / SSL），请及时处理
    </div>

    <n-tabs type="line" class="wb-tabs">
      <!-- 服务器清单 -->
      <n-tab-pane name="servers" tab="服务器">
        <div class="toolbar">
          <NButton size="small" type="primary" ghost @click="serverFormShow = true">
            <template #icon><NIcon :component="Plus" /></template>
            登记服务器
          </NButton>
        </div>
        <div v-if="servers.length" class="server-grid">
          <div v-for="s in servers" :key="s.id" class="server-card wb-card">
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
        <EmptyState v-else text="暂无服务器" />
      </n-tab-pane>

      <!-- 域名清单 -->
      <n-tab-pane name="domains" tab="域名">
        <div class="toolbar">
          <NButton size="small" type="primary" ghost @click="domainFormShow = true">
            <template #icon><NIcon :component="Plus" /></template>
            登记域名
          </NButton>
        </div>
        <div v-if="domains.length" class="domain-table">
          <div class="d-row head">
            <span>域名</span><span>注册商</span><span>DNS</span><span>域名到期</span><span>SSL 到期</span><span>关联服务器</span><span>剩余</span><span></span>
          </div>
          <div v-for="d in domains" :key="d.id" class="d-row">
            <span class="mono d-name">{{ d.name }}</span>
            <span>{{ d.registrar || '—' }}</span>
            <span>{{ d.dnsProvider || '—' }}</span>
            <span class="mono" :style="d.expireDate && d.expireDate < new Date().toISOString().slice(0, 10) ? 'color: var(--wb-danger)' : ''">{{ d.expireDate || '—' }}</span>
            <span class="mono" :style="d.sslExpireDate && d.sslExpireDate < new Date().toISOString().slice(0, 10) ? 'color: var(--wb-danger)' : ''">{{ d.sslExpireDate || '—' }}</span>
            <span>{{ serverName(d.serverId) }}</span>
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
        <EmptyState v-else text="暂无域名" />
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
        <div v-if="ports.length" class="port-table">
          <div class="p-row head">
            <span>协议</span><span>端口</span><span>状态</span><span>PID</span><span>进程</span>
          </div>
          <div v-for="p in filteredPorts" :key="`${p.proto}-${p.port}-${p.pid}`" class="p-row">
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
        <div class="toolbar">
          <NButton size="small" type="primary" ghost @click="flowFormShow = true">
            <template #icon><NIcon :component="Plus" /></template>
            登记指标
          </NButton>
        </div>
        <div v-if="flows.length" class="domain-table">
          <div class="d-row head">
            <span>指标</span><span>类型</span><span>当前值</span><span>阈值</span><span>状态</span><span>备注</span><span></span>
          </div>
          <div v-for="f in flows" :key="f.id" class="d-row">
            <span class="mono d-name">{{ f.name }}</span>
            <span>{{ f.metric }}</span>
            <span class="mono" :style="f.current >= f.threshold && f.threshold > 0 ? 'color: var(--wb-danger); font-weight: 600' : ''">{{ f.current }}</span>
            <span class="mono">{{ f.threshold }}</span>
            <span><NTag size="tiny" :bordered="false" :type="flowStatus(f).color as any">{{ flowStatus(f).label }}</NTag></span>
            <span class="dim ellipsis">{{ f.note || '—' }}</span>
            <span style="text-align: right"><NButton size="tiny" text type="error" @click="removeFlow(f)"><template #icon><NIcon :component="Trash" /></template></NButton></span>
          </div>
        </div>
        <EmptyState v-else text="暂无流量指标，登记后按阈值自动标红预警" />
      </n-tab-pane>

      <!-- 配置变更台账（F-OPS-14） -->
      <n-tab-pane name="changes" tab="配置变更">
        <div class="toolbar">
          <NButton size="small" type="primary" ghost @click="changeFormShow = true">
            <template #icon><NIcon :component="Plus" /></template>
            记录变更
          </NButton>
        </div>
        <div v-if="changes.length" class="domain-table">
          <div class="d-row head">
            <span>变更</span><span>环境</span><span>类型</span><span>操作人</span><span>时间</span><span>状态</span><span></span>
          </div>
          <div v-for="c in changes" :key="c.id" class="d-row">
            <span class="d-name">{{ c.title }}</span>
            <span class="mono">{{ c.env }}</span>
            <span>{{ c.category }}</span>
            <span>{{ c.operator || '—' }}</span>
            <span class="mono">{{ c.changedAt || '—' }}</span>
            <span><NTag size="tiny" :bordered="false" :type="changeStatus(c).color as any">{{ changeStatus(c).label }}</NTag></span>
            <span style="text-align: right"><NButton size="tiny" text type="error" @click="removeChange(c)"><template #icon><NIcon :component="Trash" /></template></NButton></span>
          </div>
        </div>
        <EmptyState v-else text="暂无配置变更记录" />
      </n-tab-pane>

      <!-- 安全巡检台账（F-OPS-15） -->
      <n-tab-pane name="secchecks" tab="安全巡检">
        <div class="toolbar">
          <NButton size="small" type="primary" ghost @click="secFormShow = true">
            <template #icon><NIcon :component="Plus" /></template>
            记录巡检
          </NButton>
        </div>
        <div v-if="secChecks.length" class="domain-table">
          <div class="d-row head">
            <span>巡检项</span><span>分类</span><span>级别</span><span>结果</span><span>日期</span><span>详情</span><span></span>
          </div>
          <div v-for="s in secChecks" :key="s.id" class="d-row">
            <span class="d-name">{{ s.title }}</span>
            <span>{{ s.category }}</span>
            <span><NTag size="tiny" :bordered="false" :type="secSeverity(s).color as any">{{ secSeverity(s).label }}</NTag></span>
            <span><NTag size="tiny" :bordered="false" :type="secResult(s).color as any">{{ secResult(s).label }}</NTag></span>
            <span class="mono">{{ s.checkedAt || '—' }}</span>
            <span class="dim ellipsis">{{ s.detail || '—' }}</span>
            <span style="text-align: right"><NButton size="tiny" text type="error" @click="removeSec(s)"><template #icon><NIcon :component="Trash" /></template></NButton></span>
          </div>
        </div>
        <EmptyState v-else text="暂无安全巡检记录" />
      </n-tab-pane>

      <!-- 密钥管理台账（F-OPS-16） -->
      <n-tab-pane name="secrets" tab="密钥管理">
        <div class="toolbar">
          <NButton size="small" type="primary" ghost @click="secretFormShow = true">
            <template #icon><NIcon :component="Plus" /></template>
            登记密钥
          </NButton>
        </div>
        <div v-if="secrets.length" class="domain-table">
          <div class="d-row head">
            <span>密钥</span><span>提供方</span><span>账号</span><span>状态</span><span>过期</span><span>备注</span><span></span>
          </div>
          <div v-for="s in secrets" :key="s.id" class="d-row">
            <span class="mono d-name">{{ s.name }}</span>
            <span>{{ s.provider || '—' }}</span>
            <span class="mono">{{ s.account || '—' }}</span>
            <span><NTag size="tiny" :bordered="false" :type="secretStatus(s).color as any">{{ secretStatus(s).label }}</NTag></span>
            <span class="mono" :style="s.expiresAt && s.expiresAt < new Date().toISOString().slice(0, 10) ? 'color: var(--wb-danger)' : ''">{{ s.expiresAt || '—' }}</span>
            <span class="dim ellipsis">{{ s.note || '—' }}</span>
            <span style="text-align: right"><NButton size="tiny" text type="error" @click="removeSecret(s)"><template #icon><NIcon :component="Trash" /></template></NButton></span>
          </div>
        </div>
        <EmptyState v-else text="暂无密钥记录（仅登记元信息，不存储密钥内容）" />
      </n-tab-pane>

      <!-- DNS 记录台账（F-OPS-17） -->
      <n-tab-pane name="dns" tab="DNS 记录">
        <div class="toolbar">
          <NButton size="small" type="primary" ghost @click="dnsFormShow = true">
            <template #icon><NIcon :component="Plus" /></template>
            登记记录
          </NButton>
        </div>
        <div v-if="dnsRecords.length" class="domain-table">
          <div class="d-row head">
            <span>域名</span><span>类型</span><span>主机</span><span>记录值</span><span>TTL</span><span>状态</span><span></span>
          </div>
          <div v-for="d in dnsRecords" :key="d.id" class="d-row">
            <span class="mono d-name">{{ d.name }}</span>
            <span class="mono">{{ d.recordType }}</span>
            <span class="mono">{{ d.host }}</span>
            <span class="mono ellipsis">{{ d.value }}</span>
            <span class="mono">{{ d.ttl }}</span>
            <span><NTag size="tiny" :bordered="false" :type="dnsStatus(d).color as any">{{ dnsStatus(d).label }}</NTag></span>
            <span style="text-align: right"><NButton size="tiny" text type="error" @click="removeDns(d)"><template #icon><NIcon :component="Trash" /></template></NButton></span>
          </div>
        </div>
        <EmptyState v-else text="暂无 DNS 记录" />
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
.expire-alert {
  display: flex; align-items: center; gap: 8px;
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
  gap: 12px;
}
.server-card { padding: 14px 16px; }
.sc-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.sc-name { font-size: 14px; font-weight: 600; }
.sc-meta { display: flex; flex-direction: column; gap: 2px; font-size: 12px; color: var(--wb-text-2); margin-top: 8px; }
.dim { color: var(--wb-text-3); }
.ellipsis { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 220px; }
.sc-config {
  margin-top: 8px; font-size: 11.5px; color: var(--wb-text-3);
  background: var(--wb-card-alt); border-radius: 6px; padding: 6px 8px;
}
.sc-foot {
  display: flex; align-items: center; gap: 12px; margin-top: 10px;
}
.cost { font-size: 12px; color: var(--wb-module-ops); font-weight: 600; }
.due { font-size: 11.5px; color: var(--wb-text-3); flex: 1; }
.domain-table, .port-table {
  border: 1px solid var(--wb-border);
  border-radius: var(--wb-radius-md);
  overflow: hidden;
}
.d-row, .p-row {
  display: grid;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--wb-border);
  font-size: 12.5px;
}
.d-row { grid-template-columns: 2fr 1fr 1fr 1.2fr 1.2fr 1fr 0.7fr 0.4fr; }
.p-row { grid-template-columns: 0.7fr 0.8fr 1.2fr 0.8fr 2fr; }
.d-row:last-child, .p-row:last-child { border-bottom: none; }
.d-row.head, .p-row.head {
  background: var(--wb-card-alt);
  font-weight: 600;
  color: var(--wb-text-2);
  font-size: 12px;
}
.d-name { font-weight: 550; }
.disk-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 12px;
}
.disk-card { padding: 14px 16px; }
.dk-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.dk-mount { font-weight: 700; font-size: 14px; }
.dk-pct { font-size: 13px; font-weight: 600; }
.dk-detail { display: flex; justify-content: space-between; font-size: 11.5px; color: var(--wb-text-3); margin-top: 8px; }
.port { font-weight: 600; }
.health-card, .proxy-card { max-width: 640px; padding: 16px 18px; }
.hc-head, .pc-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.hc-target { font-size: 13px; font-weight: 600; }
.hc-detail { display: flex; align-items: center; gap: 16px; margin-top: 12px; font-size: 12px; color: var(--wb-text-2); }
.detail-text { color: var(--wb-text-3); }
.pc-title { font-size: 14px; font-weight: 600; }
.pc-rows { display: flex; flex-direction: column; gap: 8px; margin-top: 12px; font-size: 12.5px; }
.pc-row { display: flex; align-items: center; gap: 12px; }
.pc-label { width: 96px; color: var(--wb-text-3); }
.wsl-list { display: flex; flex-direction: column; gap: 8px; max-width: 640px; }
.wsl-item { padding: 12px 16px; }
.wsl-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
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
  gap: 10px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--wb-border);
  font-size: 12.5px;
}
.t-row:last-child { border-bottom: none; }
.t-row.head {
  background: var(--wb-card-alt);
  font-weight: 600;
  color: var(--wb-text-2);
  font-size: 12px;
}
.t-name { font-weight: 550; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
