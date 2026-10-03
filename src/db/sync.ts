/**
 * 云同步引擎：本地 SQLite ↔ 云端 relay（testapi.xusn.cn）
 *
 * 设计：
 * - 捕获：每张业务表挂 AFTER INSERT/UPDATE/DELETE 触发器，写入 _sync_state（pending 标记）
 * - 推送：读 pending 行 → POST /api/sync/:t/push（新行不带 id 由服务端分配，返回 serverId 映射）
 * - 拉取：每表游标 _sync_cursor → GET /api/sync/:t?since= → 按 _ut LWW 应用本地
 * - 触发器用 _sync_flag.busy 做护栏：拉取应用期间不再捕获，防止同步风暴
 * - 冲突：Last-Write-Wins，比较键为客户端时间戳 _ut(ms)
 */
import { exec, query } from './client'
import { ensureSyncIndexes, runBatch } from './migrate'
import { useSettings } from '@/composables/useSettings'

/** 与云端 db/schema.sql 对齐的 41 张业务表 */
export const SYNC_TABLES = [
  'tasks', 'deadlines', 'links',
  'projects', 'snippets',
  'tools', 'agents',
  'servers', 'domains', 'backups',
  'habits', 'habitLogs', 'ledger', 'pomodoros', 'healthLogs',
  'courses', 'assignments', 'notes',
  'pitfalls', 'resources',
  'opsFlows', 'opsChanges', 'opsSecChecks', 'opsSecrets', 'opsDns',
  'deployments', 'envVars', 'techDebts', 'cmdSnippets',
  'decisions', 'skillTree', 'learningPaths', 'threeDProjects', 'portfolios', 'contentCalendars',
  'fixedBills', 'grades', 'flashcards', 'readQueue', 'feynmanLogs',
  'inspirations',
] as const

const NOW_MS = `CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)`

export interface SyncStatus {
  state: 'idle' | 'syncing' | 'error' | 'offline'
  message: string
  lastSyncAt: number | null
  pending: number
}

type StatusListener = (s: SyncStatus) => void
const listeners = new Set<StatusListener>()
const status: SyncStatus = { state: 'idle', message: '', lastSyncAt: null, pending: 0 }
let syncing = false
let ws: WebSocket | null = null
let retryTimer: number | null = null
let reconnectTimer: number | null = null
let reconnectAttempt = 0
let pollTimer: number | null = null
const BASE_RETRY_MS = 5_000
const MAX_RETRY_MS = 5 * 60 * 1000
/** 最近一次落库失败明细，供 pullTable 抛错时带给用户看 */
let lastError = ''

export function onSyncStatus(fn: StatusListener): () => void {
  listeners.add(fn)
  fn({ ...status })
  return () => listeners.delete(fn)
}
function setStatus(patch: Partial<SyncStatus>) {
  Object.assign(status, patch)
  for (const fn of listeners) fn({ ...status })
}

function cloud(): { url: string; token: string } {
  const s = useSettings()
  return { url: s.cloudUrl.replace(/\/+$/, ''), token: s.cloudToken }
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { url, token } = cloud()
  const res = await fetch(`${url}/api${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init.headers || {}) },
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(`${res.status} ${body.error || res.statusText}`)
  }
  return res.json() as Promise<T>
}

// ---------------- 本地同步元数据 ----------------

export async function initSyncSchema(): Promise<void> {
  await exec(`CREATE TABLE IF NOT EXISTS _sync_state (
    tableName TEXT NOT NULL,
    rowId INTEGER NOT NULL,
    serverId INTEGER,
    ut INTEGER NOT NULL DEFAULT 0,
    del INTEGER NOT NULL DEFAULT 0,
    pending INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (tableName, rowId)
  )`)
  await exec(`CREATE TABLE IF NOT EXISTS _sync_cursor (tableName TEXT PRIMARY KEY, cursor INTEGER NOT NULL DEFAULT 0)`)
  await exec(`CREATE TABLE IF NOT EXISTS _sync_flag (key TEXT PRIMARY KEY, v INTEGER NOT NULL DEFAULT 0)`)
  await exec(`INSERT OR IGNORE INTO _sync_flag (key, v) VALUES ('busy', 0)`)
  // 关键：busy 必须无条件复位。
  // 拉取时靠它给触发器打护栏（busy=1 期间不捕获本地变更），若进程在
  // 「置 1」与「置回 0」之间被杀，这个标志会永久停在 1 —— 此后所有本地
  // 改动都不再进 _sync_state，永远不会上云，而界面照样显示「同步完成」。
  // INSERT OR IGNORE 不会纠正已存在的行，所以这里必须显式 UPDATE。
  await exec(`UPDATE _sync_flag SET v = 0 WHERE key = 'busy'`)

  // 触发器按表拼接后批量执行：120 条逐条 await 会拖慢启动
  const batches: string[] = []
  for (const t of SYNC_TABLES) {
    const when = `WHEN (SELECT v FROM _sync_flag WHERE key='busy') = 0 BEGIN`
    const guard = `INSERT INTO _sync_state (tableName, rowId, serverId, ut, del, pending) VALUES ('${t}', NEW.id, NULL, ${NOW_MS}, 0, 1)
      ON CONFLICT(tableName, rowId) DO UPDATE SET ut=${NOW_MS}, del=0, pending=1;`
    batches.push([
      `CREATE TRIGGER IF NOT EXISTS _sync_${t}_i AFTER INSERT ON ${t} ${when} ${guard} END`,
      `CREATE TRIGGER IF NOT EXISTS _sync_${t}_u AFTER UPDATE ON ${t} ${when} ${guard} END`,
      `CREATE TRIGGER IF NOT EXISTS _sync_${t}_d AFTER DELETE ON ${t} ${when}
        INSERT INTO _sync_state (tableName, rowId, serverId, ut, del, pending) VALUES ('${t}', OLD.id,
          (SELECT serverId FROM _sync_state WHERE tableName='${t}' AND rowId=OLD.id), ${NOW_MS}, 1, 1)
        ON CONFLICT(tableName, rowId) DO UPDATE SET ut=${NOW_MS}, del=1, pending=1; END`,
    ].join(';\n'))
  }
  await runBatch(batches)
  // _sync_state 已存在，补建其索引（initDb 时该表可能尚未创建）
  await ensureSyncIndexes()
}

/** 首次连接：把本地全部存量行登记为待推送 */
async function bootstrapPending(): Promise<void> {
  const done = await query<{ n: number }>(`SELECT COUNT(*) AS n FROM _sync_cursor WHERE cursor > 0`)
  const pushed = await query<{ n: number }>(`SELECT COUNT(*) AS n FROM _sync_state WHERE pending = 0`)
  if ((done[0]?.n ?? 0) > 0 || (pushed[0]?.n ?? 0) > 0) return // 已经同步过
  for (const t of SYNC_TABLES) {
    await exec(`INSERT OR IGNORE INTO _sync_state (tableName, rowId, serverId, ut, del, pending)
      SELECT '${t}', id, NULL, ${NOW_MS}, 0, 1 FROM ${t}`)
  }
}

// ---------------- 推送 ----------------

interface PushResult { tempId?: string; id: number; accepted: boolean; reason?: string; error?: string; _sv?: number }

async function pushPending(): Promise<void> {
  for (const t of SYNC_TABLES) {
    const states = await query<{ rowId: number; serverId: number | null; ut: number; del: number }>(
      `SELECT rowId, serverId, ut, del FROM _sync_state WHERE tableName = ? AND pending = 1 ORDER BY rowId LIMIT 500`,
      [t],
    )
    if (states.length === 0) continue

    // 批量读取本批次的本地行，避免逐行 SELECT（N+1）
    const liveIds = states.filter((s) => s.del === 0).map((s) => s.rowId)
    const rowMap = new Map<number, Record<string, unknown>>()
    if (liveIds.length > 0) {
      const lp = liveIds.map(() => '?').join(', ')
      const rowData = await query<Record<string, unknown>>(`SELECT * FROM ${t} WHERE id IN (${lp})`, liveIds)
      for (const r of rowData) rowMap.set(r.id as number, r)
    }

    // 服务端已删除但本地从未上送过的墓碑：直接丢弃
    const rows: Record<string, unknown>[] = []
    const entries: { rowId: number; serverId: number | null; del: number }[] = []
    const orphan: number[] = [] // 本地行已不存在的残留状态
    for (const st of states) {
      if (st.del === 1 && st.serverId == null) {
        orphan.push(st.rowId)
        continue
      }
      if (st.del === 1) {
        rows.push({ id: st.serverId, _del: 1, _ut: st.ut })
      } else {
        const rowData = rowMap.get(st.rowId)
        if (!rowData) {
          orphan.push(st.rowId)
          continue
        }
        const clean: Record<string, unknown> = { _ut: st.ut }
        for (const [k, v] of Object.entries(rowData)) {
          if (k !== 'id' && !k.startsWith('_')) clean[k] = v
        }
        if (st.serverId != null) clean.id = st.serverId
        else clean.tempId = String(st.rowId)
        rows.push(clean)
      }
      entries.push({ rowId: st.rowId, serverId: st.serverId, del: st.del })
    }
    // 孤儿状态批量清理
    if (orphan.length > 0) {
      const op = orphan.map(() => '?').join(', ')
      await exec(`DELETE FROM _sync_state WHERE tableName = ? AND rowId IN (${op})`, [t, ...orphan])
    }
    if (rows.length === 0) continue

    const r = await api<{ results: PushResult[] }>(`/sync/${t}/push`, {
      method: 'POST',
      body: JSON.stringify({ rows }),
    })

    // 结果回写：按「删除 / 标记已推送 / 放弃 stale」三类拼批，避免逐行 UPDATE
    const doneDeletes: number[] = []
    const doneUpdates: { rowId: number; serverId: number | null }[] = []
    const staleIds: number[] = []
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]
      const res = r.results[i]
      if (!res) continue
      if (res.accepted) {
        if (entry.del === 1) doneDeletes.push(entry.rowId)
        else doneUpdates.push({ rowId: entry.rowId, serverId: res.id ?? entry.serverId })
      } else if (res.reason === 'stale') {
        // 放弃本次推送标记，保持 pending=0 由服务端版本为准（拉取会覆盖本地）
        staleIds.push(entry.rowId)
      }
    }
    const stmts: string[] = []
    if (doneDeletes.length > 0) {
      stmts.push(`DELETE FROM _sync_state WHERE tableName = '${t}' AND rowId IN (${doneDeletes.join(', ')})`)
    }
    for (const u of doneUpdates) {
      stmts.push(
        `UPDATE _sync_state SET pending = 0, serverId = ${u.serverId ?? 'NULL'} WHERE tableName = '${t}' AND rowId = ${u.rowId}`,
      )
    }
    if (staleIds.length > 0) {
      stmts.push(`UPDATE _sync_state SET pending = 0 WHERE tableName = '${t}' AND rowId IN (${staleIds.join(', ')})`)
    }
    if (stmts.length > 0) await runBatch(stmts)
  }
}

// ---------------- 拉取 ----------------

interface PullRow extends Record<string, unknown> { id: number; _ut: number; _del: number; _sv: number }

async function pullTable(t: string): Promise<void> {
  for (let guard = 0; guard < 50; guard++) {
    const cur = await query<{ cursor: number }>(`SELECT cursor FROM _sync_cursor WHERE tableName = ?`, [t])
    const since = cur[0]?.cursor ?? 0
    const r = await api<{ rows: PullRow[]; cursor: number; hasMore: boolean }>(
      `/sync/${t}?since=${since}&limit=500`,
    )
    let failed = 0
    if (r.rows.length > 0) {
      await exec(`UPDATE _sync_flag SET v = 1 WHERE key = 'busy'`)
      try {
        failed = await applyRemoteBatch(t, r.rows)
      } finally {
        await exec(`UPDATE _sync_flag SET v = 0 WHERE key = 'busy'`)
      }
    }
    // 只有整页完整落库才推进游标。
    // 原先无条件推进：某一行因约束/类型写失败后被静默跳过，游标一过，
    // 这一行永远不会再被拉回来 —— 两端从此分叉，且界面上看不出任何异常。
    if (failed > 0) {
      throw new Error(`${t} 本页有 ${failed} 行未能落库，游标未推进（下次同步会重试）：${lastError}`)
    }
    await exec(`INSERT INTO _sync_cursor (tableName, cursor) VALUES (?, ?)
      ON CONFLICT(tableName) DO UPDATE SET cursor = excluded.cursor`, [t, r.cursor])
    if (!r.hasMore) break
  }
}

/** 本地表的列名缓存：既是白名单，也免去每页 PRAGMA table_info */
const localColsCache = new Map<string, Set<string>>()
async function localColumns(t: string): Promise<Set<string>> {
  let hit = localColsCache.get(t)
  if (!hit) {
    const rows = await query<{ name: string }>(`PRAGMA table_info(${t})`)
    hit = new Set(rows.map((r) => r.name))
    localColsCache.set(t, hit)
  }
  return hit
}

/** 本表当前 id 占用情况，按「一次拉取会话」缓存，避免每页全表 SELECT id */
interface IdSpace { ids: Set<number>; max: number }
const idSpaceCache = new Map<string, IdSpace>()
async function loadIdSpace(t: string): Promise<IdSpace> {
  let hit = idSpaceCache.get(t)
  if (!hit) {
    const rows = await query<{ id: number }>(`SELECT id FROM ${t}`)
    const ids = new Set<number>()
    let max = 0
    for (const r of rows) {
      ids.add(r.id)
      if (r.id > max) max = r.id
    }
    hit = { ids, max }
    idSpaceCache.set(t, hit)
  }
  return hit
}

/**
 * 批量应用一页远端行。返回「未能落库的行数」，>0 表示本页不完整。
 * 原实现逐行 await，每行 3~6 次独立 SQL，40 表 × 500 行可达数万次 IPC 往返，
 * 全部落在渲染主线程造成界面冻结。这里改为：
 *   1) 一次查询解析整页的 serverId → 本地行映射
 *   2) 一次查询取本表现有 id 集合与最大 id（整次拉取复用，不再每页重扫）
 *   3) 按「删除 / 更新 / 插入」三类分别拼批，各用少量语句完成
 *
 * 列名一律走本地表列白名单：远端返回的 key 直接拼进 SET 子句，
 * 一旦服务端被攻破（或版本错配多出字段），就是本地 SQL 注入。
 */
async function applyRemoteBatch(t: string, rows: PullRow[]): Promise<number> {
  if (rows.length === 0) return 0

  const ids = rows.map((r) => r.id)
  const ph = ids.map(() => '?').join(', ')

  // 已知映射：serverId -> (rowId, ut)
  const knownRows = await query<{ rowId: number; serverId: number; ut: number }>(
    `SELECT rowId, serverId, ut FROM _sync_state WHERE tableName = ? AND serverId IN (${ph})`,
    [t, ...ids],
  )
  const known = new Map<number, { rowId: number; ut: number }>()
  for (const k of knownRows) known.set(k.serverId, { rowId: k.rowId, ut: k.ut })

  const localCols = await localColumns(t)
  const space = await loadIdSpace(t)
  const existingIds = space.ids
  let maxId = space.max

  const deletes: number[] = [] // 本地 rowId
  const updates: { rowId: number; ut: number; row: PullRow }[] = []
  const inserts: { localId: number; row: PullRow }[] = []

  for (const row of rows) {
    const k = known.get(row.id)
    if (row._del === 1) {
      if (k) deletes.push(k.rowId)
      continue
    }
    if (k) {
      if (row._ut <= k.ut) continue // 本地较新，跳过
      if (!existingIds.has(k.rowId)) continue // 本地行已不存在
      updates.push({ rowId: k.rowId, ut: row._ut, row })
      continue
    }
    // 新行：优先用服务端 id，被占用则顺延
    let localId = row.id
    if (existingIds.has(localId)) localId = ++maxId
    existingIds.add(localId)
    inserts.push({ localId, row })
  }

  // 记一条语句 ↔ 行 的对应关系，失败时才能报出「哪一行没落库」
  const owner: string[] = []
  const stmts: string[] = []
  const push = (sql: string, tag: string) => { stmts.push(sql); owner.push(tag) }

  // 删除：业务行 + 同步状态
  for (const rowId of deletes) {
    push(`DELETE FROM ${t} WHERE id = ${rowId}`, `del#${rowId}`)
    existingIds.delete(rowId)
  }
  if (deletes.length > 0) {
    stmts.push(`DELETE FROM _sync_state WHERE tableName = '${t}' AND rowId IN (${deletes.join(', ')})`)
    owner.push('del-state')
  }

  // 更新：业务行（每行列可能不同，逐条但同一批提交）
  for (const u of updates) {
    const cols = Object.keys(u.row).filter((k) => k !== 'id' && !REMOTE_ONLY_COLS.includes(k) && localCols.has(k))
    if (cols.length === 0) continue
    const sets = cols.map((c) => `${c} = ${sqlLit((u.row as Record<string, unknown>)[c])}`).join(', ')
    push(`UPDATE ${t} SET ${sets} WHERE id = ${u.rowId}`, `upd#${u.rowId}`)
    stmts.push(`UPDATE _sync_state SET ut = ${u.ut}, pending = 0 WHERE tableName = '${t}' AND rowId = ${u.rowId}`)
    owner.push('upd-state')
  }

  // 插入：业务行 + 同步状态
  for (const ins of inserts) {
    const cols = ['id', ...Object.keys(ins.row).filter((k) => !REMOTE_ONLY_COLS.includes(k) && localCols.has(k))]
    if (cols.length === 1) continue // 远端除 id 外没有可落库的列，跳过
    const vals = [ins.localId, ...cols.slice(1).map((c) => sqlLit((ins.row as Record<string, unknown>)[c]))]
    push(`INSERT OR REPLACE INTO ${t} (${cols.join(', ')}) VALUES (${vals.join(', ')})`, `ins#${ins.localId}`)
    stmts.push(
      `INSERT OR REPLACE INTO _sync_state (tableName, rowId, serverId, ut, del, pending) VALUES ('${t}', ${ins.localId}, ${ins.row.id}, ${ins.row._ut}, 0, 0)`,
    )
    owner.push('ins-state')
  }

  if (stmts.length === 0) return 0
  const failures = await runBatch(stmts)
  if (failures.length === 0) return 0

  lastError = failures.map((f) => `${owner[f.index] ?? f.index}: ${f.error}`).slice(0, 3).join(' | ')
  // 只统计业务行（upd/ins/del），_sync_state 那条失败由业务行的失败连带体现
  const badRows = new Set<string>()
  for (const f of failures) {
    const tag = owner[f.index] ?? ''
    if (tag.startsWith('upd#') || tag.startsWith('ins#') || tag.startsWith('del#')) badRows.add(tag)
  }
  // 状态表写入失败但业务行成功：行已经在库里，只是账本没跟上，
  // 属于可自愈（下次拉取会重新处理），因此不计入「本页不完整」。
  return badRows.size
}

/** 把 JS 值转成 SQL 字面量（远端行来自自家服务端，仍做转义以防注入/语法错误） */
function sqlLit(v: unknown): string {
  if (v === null || v === undefined) return 'NULL'
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL'
  if (typeof v === 'boolean') return v ? '1' : '0'
  return `'${String(v).replace(/'/g, "''")}'`
}

/** 服务端行中不落本地库的列（本地表没有这些列） */
const REMOTE_ONLY_COLS = ['_ut', '_del', '_sv', '_dev', 'user_id']

// ---------------- 账户：注册 / 登录 ----------------
// 使用云端才需要注册登录；不开启云同步则完全本地使用，无任何强制。

async function cloudAuth(serverUrl: string, path: string, username: string, password: string, deviceName: string): Promise<void> {
  const s = useSettings()
  const base = serverUrl.replace(/\/+$/, '')
  const res = await fetch(`${base}/api${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, deviceName, platform: 'desktop' }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || String(res.status))
  s.cloudUrl = base
  s.cloudToken = data.token
  s.cloudEnabled = true
  s.deviceName = deviceName
}

export function cloudRegister(serverUrl: string, username: string, password: string, deviceName: string): Promise<void> {
  return cloudAuth(serverUrl, '/auth/register', username, password, deviceName)
}
export function cloudLogin(serverUrl: string, username: string, password: string, deviceName: string): Promise<void> {
  return cloudAuth(serverUrl, '/auth/login', username, password, deviceName)
}
export function cloudLogout(): void {
  const s = useSettings()
  s.cloudEnabled = false
  s.cloudToken = ''
  disconnectLive()
}

// ---------------- 主循环 ----------------

export async function syncNow(): Promise<void> {
  if (syncing) return
  const s = useSettings()
  if (!s.cloudEnabled || !s.cloudUrl || !s.cloudToken) return
  syncing = true
  lastError = ''
  setStatus({ state: 'syncing', message: '同步中…' })
  try {
    // 本轮拉取开始：重建 id 占用快照（上一轮的快照可能已被本地写入改动）
    idSpaceCache.clear()
    await bootstrapPending()
    await pushPending()
    for (const t of SYNC_TABLES) await pullTable(t)
    const pend = await query<{ n: number }>(`SELECT COUNT(*) AS n FROM _sync_state WHERE pending = 1`)
    setStatus({ state: 'idle', message: '同步完成', lastSyncAt: Date.now(), pending: pend[0]?.n ?? 0 })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    setStatus({ state: 'error', message: msg })
  } finally {
    syncing = false
    idSpaceCache.clear()
  }
}

export function connectLive(): void {
  const s = useSettings()
  if (!s.cloudEnabled || !s.cloudUrl || !s.cloudToken) return
  try { ws?.close() } catch { /* ignore */ }
  const wsUrl = s.cloudUrl.replace(/^http/, 'ws')
  ws = new WebSocket(`${wsUrl}/ws?token=${s.cloudToken}`)
  ws.onopen = () => {
    reconnectAttempt = 0 // 连接成功则重置退避
  }
  ws.onmessage = (ev) => {
    try {
      const m = JSON.parse(ev.data)
      if (m.type === 'change') {
        if (retryTimer) window.clearTimeout(retryTimer)
        retryTimer = window.setTimeout(() => void syncNow(), 800) // 防抖
      }
    } catch { /* ignore */ }
  }
  ws.onclose = () => {
    if (!useSettings().cloudEnabled) return
    // 指数退避重连：云端不可达时固定 10s 重试会形成重连风暴，
    // 每次重连还触发一次全量同步，表现为周期性假死。
    const delay = Math.min(BASE_RETRY_MS * 2 ** reconnectAttempt, MAX_RETRY_MS)
    reconnectAttempt++
    if (reconnectTimer) window.clearTimeout(reconnectTimer)
    reconnectTimer = window.setTimeout(() => void connectLive(), delay)
  }
}

export function disconnectLive(): void {
  try { ws?.close() } catch { /* ignore */ }
  ws = null
}

export function getSyncStatus(): SyncStatus {
  return { ...status }
}

/** 应用启动时调用 */
export async function initSync(): Promise<void> {
  const s = useSettings()
  await initSyncSchema()
  if (!s.cloudEnabled || !s.cloudToken) return
  await syncNow()
  connectLive()
  // 兜底周期同步（WS 断线也能追上）。保存句柄去重：
  // 每次登录/注册都会调 initSync，原先重复注册会叠加出多个轮询定时器。
  if (pollTimer !== null) window.clearInterval(pollTimer)
  pollTimer = window.setInterval(() => { if (useSettings().cloudEnabled) void syncNow() }, 5 * 60 * 1000)
}
