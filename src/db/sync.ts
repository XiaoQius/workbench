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
import { useSettings } from '@/composables/useSettings'

/** 与云端 db/schema.sql 对齐的 40 张业务表 */
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

  for (const t of SYNC_TABLES) {
    const when = `WHEN (SELECT v FROM _sync_flag WHERE key='busy') = 0 BEGIN`
    const guard = `INSERT INTO _sync_state (tableName, rowId, serverId, ut, del, pending) VALUES ('${t}', NEW.id, NULL, ${NOW_MS}, 0, 1)
      ON CONFLICT(tableName, rowId) DO UPDATE SET ut=${NOW_MS}, del=0, pending=1;`
    await exec(`CREATE TRIGGER IF NOT EXISTS _sync_${t}_i AFTER INSERT ON ${t} ${when} ${guard} END`)
    await exec(`CREATE TRIGGER IF NOT EXISTS _sync_${t}_u AFTER UPDATE ON ${t} ${when} ${guard} END`)
    await exec(`CREATE TRIGGER IF NOT EXISTS _sync_${t}_d AFTER DELETE ON ${t} ${when}
      INSERT INTO _sync_state (tableName, rowId, serverId, ut, del, pending) VALUES ('${t}', OLD.id,
        (SELECT serverId FROM _sync_state WHERE tableName='${t}' AND rowId=OLD.id), ${NOW_MS}, 1, 1)
      ON CONFLICT(tableName, rowId) DO UPDATE SET ut=${NOW_MS}, del=1, pending=1; END`)
  }
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

    // 服务端已删除但本地从未上送过的墓碑：直接丢弃
    const rows: Record<string, unknown>[] = []
    const entries: { rowId: number; serverId: number | null; del: number }[] = []
    for (const st of states) {
      if (st.del === 1 && st.serverId == null) {
        await exec(`DELETE FROM _sync_state WHERE tableName = ? AND rowId = ?`, [t, st.rowId])
        continue
      }
      if (st.del === 1) {
        rows.push({ id: st.serverId, _del: 1, _ut: st.ut })
      } else {
        const rowData = await query<Record<string, unknown>>(`SELECT * FROM ${t} WHERE id = ?`, [st.rowId])
        if (rowData.length === 0) {
          await exec(`DELETE FROM _sync_state WHERE tableName = ? AND rowId = ?`, [t, st.rowId])
          continue
        }
        const clean: Record<string, unknown> = { _ut: st.ut }
        for (const [k, v] of Object.entries(rowData[0])) {
          if (k !== 'id' && !k.startsWith('_')) clean[k] = v
        }
        if (st.serverId != null) clean.id = st.serverId
        else clean.tempId = String(st.rowId)
        rows.push(clean)
      }
      entries.push({ rowId: st.rowId, serverId: st.serverId, del: st.del })
    }
    if (rows.length === 0) continue

    const r = await api<{ results: PushResult[] }>(`/sync/${t}/push`, {
      method: 'POST',
      body: JSON.stringify({ rows }),
    })

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]
      const res = r.results[i]
      if (!res) continue
      if (res.accepted) {
        const serverId = res.id ?? entry.serverId
        if (entry.del === 1) {
          await exec(`DELETE FROM _sync_state WHERE tableName = ? AND rowId = ?`, [t, entry.rowId])
        } else {
          await exec(`UPDATE _sync_state SET pending = 0, serverId = ? WHERE tableName = ? AND rowId = ?`, [serverId, t, entry.rowId])
        }
      }
      // stale/冲突：放弃本次推送标记，保持 pending=0 由服务端版本为准（拉取会覆盖本地）
      if (!res.accepted && res.reason === 'stale') {
        await exec(`UPDATE _sync_state SET pending = 0 WHERE tableName = ? AND rowId = ?`, [t, entry.rowId])
      }
    }
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
    if (r.rows.length > 0) {
      await exec(`UPDATE _sync_flag SET v = 1 WHERE key = 'busy'`)
      try {
        for (const row of r.rows) await applyRemote(t, row)
      } finally {
        await exec(`UPDATE _sync_flag SET v = 0 WHERE key = 'busy'`)
      }
    }
    await exec(`INSERT INTO _sync_cursor (tableName, cursor) VALUES (?, ?)
      ON CONFLICT(tableName) DO UPDATE SET cursor = excluded.cursor`, [t, r.cursor])
    if (!r.hasMore) break
  }
}

async function applyRemote(t: string, row: PullRow): Promise<void> {
  const { id, _ut, _del } = row
  const known = await query<{ rowId: number; ut: number }>(
    `SELECT rowId, ut FROM _sync_state WHERE tableName = ? AND serverId = ?`, [t, id],
  )

  if (_del === 1) {
    if (known.length > 0) {
      await exec(`UPDATE _sync_flag SET v = 1 WHERE key = 'busy'`) // 触发器带 busy 护栏，这里的删除不会进队列
      await exec(`DELETE FROM ${t} WHERE id = ?`, [known[0].rowId])
      await exec(`DELETE FROM _sync_state WHERE tableName = ? AND rowId = ?`, [t, known[0].rowId])
    }
    return
  }

  if (known.length > 0) {
    if (_ut <= known[0].ut) return // 本地较新，跳过
    const local = await query<{ id: number }>(`SELECT id FROM ${t} WHERE id = ?`, [known[0].rowId])
    if (local.length === 0) return
    const cols = Object.keys(row).filter((k) => !['id', ...REMOTE_ONLY_COLS].includes(k))
    const sets = cols.map((c) => `${c} = ?`).join(', ')
    await exec(`UPDATE ${t} SET ${sets} WHERE id = ?`, [...cols.map((c) => (row as Record<string, unknown>)[c]), known[0].rowId])
    await exec(`UPDATE _sync_state SET ut = ?, pending = 0 WHERE tableName = ? AND rowId = ?`, [_ut, t, known[0].rowId])
    return
  }

  // 本地没有该服务端行 → 插入（优先用服务端 id，被占用则换新 id）
  let localId = id
  const occupied = await query<{ id: number }>(`SELECT id FROM ${t} WHERE id = ?`, [id])
  if (occupied.length > 0) {
    const mx = await query<{ m: number }>(`SELECT MAX(id) AS m FROM ${t}`)
    localId = (mx[0]?.m ?? 0) + 1
  }
  const cols = ['id', ...Object.keys(row).filter((k) => !REMOTE_ONLY_COLS.includes(k))]
  const placeholders = cols.map(() => '?').join(', ')
  const vals: unknown[] = [localId, ...cols.slice(1).map((c) => (row as Record<string, unknown>)[c])]
  await exec(`INSERT INTO ${t} (${cols.join(', ')}) VALUES (${placeholders})`, vals)
  await exec(`INSERT INTO _sync_state (tableName, rowId, serverId, ut, del, pending) VALUES (?, ?, ?, ?, 0, 0)`, [t, localId, id, _ut])
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
  setStatus({ state: 'syncing', message: '同步中…' })
  try {
    await bootstrapPending()
    await pushPending()
    for (const t of SYNC_TABLES) await pullTable(t)
    const pend = await query<{ n: number }>(`SELECT COUNT(*) AS n FROM _sync_state WHERE pending = 1`)
    setStatus({ state: 'idle', message: '同步完成', lastSyncAt: Date.now(), pending: pend[0]?.n ?? 0 })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const stack = e instanceof Error ? (e.stack || '').split('\n').slice(0, 6).join(' | ') : ''
    setStatus({ state: 'error', message: msg + (stack ? ' | ' + stack : '') })
  } finally {
    syncing = false
  }
}

export function connectLive(): void {
  const s = useSettings()
  if (!s.cloudEnabled || !s.cloudUrl || !s.cloudToken) return
  try { ws?.close() } catch { /* ignore */ }
  const wsUrl = s.cloudUrl.replace(/^http/, 'ws')
  ws = new WebSocket(`${wsUrl}/ws?token=${s.cloudToken}`)
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
    if (useSettings().cloudEnabled) window.setTimeout(connectLive, 10_000)
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
  // 兜底周期同步（WS 断线也能追上）
  window.setInterval(() => { if (useSettings().cloudEnabled) void syncNow() }, 5 * 60 * 1000)
}
