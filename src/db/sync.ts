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
  conflicts: number
}

type StatusListener = (s: SyncStatus) => void
const listeners = new Set<StatusListener>()
const status: SyncStatus = { state: 'idle', message: '', lastSyncAt: null, pending: 0, conflicts: 0 }
let syncing = false
let ws: WebSocket | null = null
let retryTimer: number | null = null
let reconnectTimer: number | null = null
let reconnectAttempt = 0
let pollTimer: number | null = null
let onlineHooked = false
const BASE_RETRY_MS = 5_000
const MAX_RETRY_MS = 5 * 60 * 1000
/** 最近一次落库失败明细，供 pullTable 抛错时带给用户看 */
let lastError = ''
/** 本轮同步里「被服务端硬拒、已按云端为准丢弃」的普通行数 */
let rejectedCount = 0

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
    baseUt INTEGER NOT NULL DEFAULT 0,
    conflict INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (tableName, rowId)
  )`)
  // 老库升级：这两列是后加的，ADD COLUMN 对已存在行填默认值 0
  for (const col of ['baseUt INTEGER NOT NULL DEFAULT 0', 'conflict INTEGER NOT NULL DEFAULT 0']) {
    try {
      await exec(`ALTER TABLE _sync_state ADD COLUMN ${col}`)
    } catch {
      /* 列已存在 */
    }
  }
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
    // baseUt 不动：它记录「上次与云端一致时的时间戳」，本地改动只推高 ut。
    // 二者之差就是「本地有未上云的改动」，是判定真冲突的唯一依据。
    const guard = `INSERT INTO _sync_state (tableName, rowId, serverId, ut, del, pending, baseUt) VALUES ('${t}', NEW.id, NULL, ${NOW_MS}, 0, 1, 0)
      ON CONFLICT(tableName, rowId) DO UPDATE SET ut=${NOW_MS}, del=0, pending=1;`
    batches.push([
      `CREATE TRIGGER IF NOT EXISTS _sync_${t}_i AFTER INSERT ON ${t} ${when} ${guard} END`,
      `CREATE TRIGGER IF NOT EXISTS _sync_${t}_u AFTER UPDATE ON ${t} ${when} ${guard} END`,
      `CREATE TRIGGER IF NOT EXISTS _sync_${t}_d AFTER DELETE ON ${t} ${when}
        INSERT INTO _sync_state (tableName, rowId, serverId, ut, del, pending, baseUt) VALUES ('${t}', OLD.id,
          (SELECT serverId FROM _sync_state WHERE tableName='${t}' AND rowId=OLD.id), ${NOW_MS}, 1, 1, 0)
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
    await exec(`INSERT OR IGNORE INTO _sync_state (tableName, rowId, serverId, ut, del, pending, baseUt)
      SELECT '${t}', id, NULL, ${NOW_MS}, 0, 1, 0 FROM ${t}`)
  }
}

// ---------------- 推送 ----------------

interface PushResult { tempId?: string; id: number; accepted: boolean; reason?: string; error?: string; _sv?: number }

/** 推送单张表的待上云改动（原 pushPending 的循环体，改成可并发调用） */
async function pushPendingTable(t: string): Promise<void> {
  const states = await query<{ rowId: number; serverId: number | null; ut: number; del: number; baseUt: number }>(
    `SELECT rowId, serverId, ut, del, baseUt FROM _sync_state WHERE tableName = ? AND pending = 1 ORDER BY rowId LIMIT 500`,
    [t],
  )
  if (states.length === 0) return
  
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
  const entries: { rowId: number; serverId: number | null; del: number; ut: number; baseUt: number }[] = []
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
    entries.push({ rowId: st.rowId, serverId: st.serverId, del: st.del, ut: st.ut, baseUt: st.baseUt ?? 0 })
  }
  // 孤儿状态批量清理
  if (orphan.length > 0) {
    const op = orphan.map(() => '?').join(', ')
    await exec(`DELETE FROM _sync_state WHERE tableName = ? AND rowId IN (${op})`, [t, ...orphan])
  }
  if (rows.length === 0) return
  
  const r = await api<{ results: PushResult[] }>(`/sync/${t}/push`, {
    method: 'POST',
    body: JSON.stringify({ rows }),
  })

  // 回写全靠「请求 rows[i] ↔ 返回 results[i]」下标对齐，这是隐含前提。
  // 服务端返回的条数一旦对不上（漏返、去重、顺序重排），原先的 `if (!res) continue`
  // 会让该行 pending 永不归零 —— 每次同步重推、永远失败；错位更会把 A 行的
  // serverId 写到 B 行上（静默串数据，比失败更难发现）。
  // 因此长度不符就整表判为失败：本批一行都不回写，交给 syncNow 计入 pushErrors，
  // 状态栏也绝不会显示成「同步完成」。
  if (!Array.isArray(r.results) || r.results.length !== rows.length) {
    throw new Error(
      `${t} 推送结果条数不符：请求 ${rows.length} 行，服务端返回 ${Array.isArray(r.results) ? r.results.length : '非数组'} 条（已放弃本批回写）`,
    )
  }

  // 结果回写：按「删除 / 标记已推送 / 放弃 stale」三类拼批，避免逐行 UPDATE
  const doneDeletes: number[] = []
  const doneUpdates: { rowId: number; serverId: number | null; ut: number }[] = []
  const staleIds: number[] = []
  // stale 只说明「服务端版本不比我的旧」，不等于冲突。
  // 真冲突 = 服务端拒绝了 + 我这边的改动确实还没上过云（ut > baseUt）。
  // baseUt 是上次与云端一致时的时间戳，ut 是本地最后改动时间，二者不等
  // 即本地有未上云的改动；服务端那份则是别人改的 → 两边都有真实改动，
  // 标记 conflict 保留双方等用户裁决，绝不静默覆盖。
  // 注意 baseUt=0 表示「从未与云端对齐过」（含离线新建的行），此时
  // ut 必 > 0，同样判为冲突——否则离线新建的记录会被云端无声吃掉。
  const conflictIds: number[] = []
  // 普通行（del === 0）被服务端硬拒、且 reason 不是 stale：原先没有任何分支命中，
  // 不重试、不清 pending、也不报冲突 → 这一行永久卡死，顶栏「待同步 N」长期不归零。
  // 与真冲突要区分开：真冲突是「双方都有改动」，由上面 stale 分支按
  // ut > baseUt && del === 0 判出并保留双方等用户裁决，这里不会碰它。
  // 落到这里的都是服务端明确拒收、本地这份已不可能被接受的情形。
  const rejectedIds: number[] = []
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]
    const res = r.results[i]
    if (res.accepted) {
      if (entry.del === 1) doneDeletes.push(entry.rowId)
      else doneUpdates.push({ rowId: entry.rowId, serverId: res.id ?? entry.serverId, ut: entry.ut })
    } else if (res.reason === 'stale') {
      // 删除类冲突无法裁决：本地行已经不在了，「保留我的」无处可取，
      // 只能以云端为准。其余情况才交给用户挑。
      if (entry.ut > entry.baseUt && entry.del === 0) conflictIds.push(entry.rowId)
      else staleIds.push(entry.rowId)
    } else if (entry.del === 1) {
      // 墓碑被服务端硬拒（如 error: NOT NULL constraint ...）。
      // 原先这里什么都不做：pending 永不清零，每次同步都重推同一批墓碑，
      // 表现为「待同步 N」长期挂着不消失（线上实测 24 条卡了数天）。
      // 墓碑代表的行本地已经不存在了，「保留我的」无处可取，只能以云端为准，
      // 与 AGENTS.md 第六节「本地删除被拒 → 以云端为准」保持一致。
      console.warn(`[sync] ${t}#${entry.rowId} 删除墓碑被服务端拒绝，按云端为准清理：${res.error ?? '未知原因'}`)
      doneDeletes.push(entry.rowId)
    } else {
      // 普通行被硬拒（NOT NULL 约束、类型不符、服务端校验不通过等）。
      // 以云端为准：清 pending 让它不再重推，下次拉取用云端版本覆盖本地；
      // 同时计数上报，避免顶栏显示「同步完成」把这次丢弃掩盖掉。
      console.warn(`[sync] ${t}#${entry.rowId} 被服务端拒绝，按云端为准丢弃本地改动：${res.error ?? res.reason ?? '未知原因'}`)
      rejectedIds.push(entry.rowId)
    }
  }
  const stmts: string[] = []
  if (doneDeletes.length > 0) {
    stmts.push(`DELETE FROM _sync_state WHERE tableName = '${t}' AND rowId IN (${doneDeletes.join(', ')})`)
  }
  for (const u of doneUpdates) {
    // 推送成功即与云端对齐：基准推到本次的 ut，后续改动才算「脏」
    stmts.push(
      `UPDATE _sync_state SET pending = 0, serverId = ${u.serverId ?? 'NULL'}, baseUt = ${u.ut}, conflict = 0 WHERE tableName = '${t}' AND rowId = ${u.rowId}`,
    )
  }
  if (staleIds.length > 0) {
    // 本地没改过（ut == baseUt），服务端版本更新，直接以服务端为准
    stmts.push(`UPDATE _sync_state SET pending = 0, baseUt = ut WHERE tableName = '${t}' AND rowId IN (${staleIds.join(', ')})`)
  }
  if (conflictIds.length > 0) {
    stmts.push(`UPDATE _sync_state SET pending = 0, conflict = 1 WHERE tableName = '${t}' AND rowId IN (${conflictIds.join(', ')})`)
  }
  if (rejectedIds.length > 0) {
    // 与 resolveConflict('remote') 同款记账：baseUt 抬到 ut 表示这行已与云端对齐
    // （本地那份被放弃了），以后再有改动才会重新判脏。
    stmts.push(`UPDATE _sync_state SET pending = 0, baseUt = ut, conflict = 0 WHERE tableName = '${t}' AND rowId IN (${rejectedIds.join(', ')})`)
    // 该行的云端版本可能早已越过本表游标，不回退的话下次拉取不会再带回它，
    // 本地就永远停在「被拒的旧值」上 —— 等于丢了本地改动却没换回云端数据。
    stmts.push(`INSERT INTO _sync_cursor (tableName, cursor) VALUES ('${t}', 0)
      ON CONFLICT(tableName) DO UPDATE SET cursor = 0`)
    rejectedCount += rejectedIds.length
  }
  if (stmts.length > 0) await runBatch(stmts)
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
  const knownRows = await query<{ rowId: number; serverId: number; ut: number; baseUt: number; conflict: number }>(
    `SELECT rowId, serverId, ut, baseUt, conflict FROM _sync_state WHERE tableName = ? AND serverId IN (${ph})`,
    [t, ...ids],
  )
  const known = new Map<number, { rowId: number; ut: number; baseUt: number; conflict: number }>()
  for (const k of knownRows) known.set(k.serverId, { rowId: k.rowId, ut: k.ut, baseUt: k.baseUt ?? 0, conflict: k.conflict ?? 0 })

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
      // 已标记冲突的行不再被远端覆盖，等用户在冲突界面裁决
      if (k.conflict === 1) continue
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
    // 落库即与云端对齐：ut 与 baseUt 一起推高，本地才算「干净」
    stmts.push(`UPDATE _sync_state SET ut = ${u.ut}, baseUt = ${u.ut}, pending = 0, conflict = 0 WHERE tableName = '${t}' AND rowId = ${u.rowId}`)
    owner.push('upd-state')
  }

  // 插入：业务行 + 同步状态
  for (const ins of inserts) {
    const cols = ['id', ...Object.keys(ins.row).filter((k) => !REMOTE_ONLY_COLS.includes(k) && localCols.has(k))]
    if (cols.length === 1) continue // 远端除 id 外没有可落库的列，跳过
    const vals = [ins.localId, ...cols.slice(1).map((c) => sqlLit((ins.row as Record<string, unknown>)[c]))]
    push(`INSERT OR REPLACE INTO ${t} (${cols.join(', ')}) VALUES (${vals.join(', ')})`, `ins#${ins.localId}`)
    stmts.push(
      `INSERT OR REPLACE INTO _sync_state (tableName, rowId, serverId, ut, del, pending, baseUt, conflict) VALUES ('${t}', ${ins.localId}, ${ins.row.id}, ${ins.row._ut}, 0, 0, ${ins.row._ut}, 0)`,
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
  // 服务端 login/register 返回的是 userId（数字），不是用户名。
  // 历史版本曾把 userId 存进 cloudUser，侧栏展示名从此显示成「1」。
  // 登录时我们手里就有用户名，直接存对。
  s.cloudUser = username
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

/**
 * 有界并发：把 fn 映射到 items，最多同时跑 limit 个。
 * 串行跑 41 张表时，每张表一次 HTTP 往返，实测整轮同步 3.4s 里有 ~3.1s
 * 纯粹耗在串行等待网络上（本地 DB 只占 0.23s）。并发度取 6：
 * 足以掩盖 RTT，又不至于把 relay 的连接打满或触发限流。
 */
async function mapLimit<T>(items: readonly T[], limit: number, fn: (item: T) => Promise<void>): Promise<Error[]> {
  const errors: Error[] = []
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = cursor++
      if (i >= items.length) return
      try {
        await fn(items[i])
      } catch (e) {
        errors.push(e instanceof Error ? e : new Error(String(e)))
      }
    }
  })
  await Promise.all(workers)
  return errors
}

export async function syncNow(): Promise<void> {
  if (syncing) return
  const s = useSettings()
  if (!s.cloudEnabled || !s.cloudUrl || !s.cloudToken) return
  syncing = true
  lastError = ''
  rejectedCount = 0
  setStatus({ state: 'syncing', message: '同步中…' })
  try {
    // 本轮拉取开始：重建 id 占用快照（上一轮的快照可能已被本地写入改动）
    idSpaceCache.clear()
    await bootstrapPending()
    // push 同样按表独立：每表只读自己的 _sync_state 分页并回写，无跨表依赖
    const pushErrors = await mapLimit(SYNC_TABLES, 6, (t) => pushPendingTable(t))
    if (pushErrors.length > 0) {
      throw new Error(`${pushErrors.length} 张表推送失败：${pushErrors.slice(0, 2).map((e) => e.message).join(' | ')}`)
    }
    // 各表各写自己的 _sync_cursor，彼此无共享状态，可安全并发
    const pullErrors = await mapLimit(SYNC_TABLES, 6, (t) => pullTable(t))
    // 有表拉取失败不能静默：否则游标停在那儿，用户看到「同步完成」但数据其实缺了
    if (pullErrors.length > 0) {
      throw new Error(`${pullErrors.length} 张表拉取失败：${pullErrors.slice(0, 2).map((e) => e.message).join(' | ')}`)
    }
    const pend = await query<{ n: number }>(`SELECT COUNT(*) AS n FROM _sync_state WHERE pending = 1`)
    const conflicts = await query<{ n: number }>(`SELECT COUNT(*) AS n FROM _sync_state WHERE conflict = 1`)
    const cn = conflicts[0]?.n ?? 0
    // 有行被服务端硬拒并按云端为准丢弃时，绝不能报「同步完成」：
    // 那等于告诉用户数据都上云了，实际这一改动已被放弃。
    const rn = rejectedCount
    setStatus({
      state: 'idle',
      message: cn > 0
        ? `${cn} 处改动与云端冲突，待你确认`
        : rn > 0
          ? `${rn} 处改动被云端拒绝，已改为云端版本`
          : '同步完成',
      lastSyncAt: Date.now(),
      pending: pend[0]?.n ?? 0,
      conflicts: cn,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    // 网络不可达时不算错误：本地改动仍在 pending 队列里，联网后自动补传。
    // 此前一律标红「同步异常」，会让离线用户误以为数据丢了。
    const offline = !navigator.onLine || /fetch|network|Failed to fetch|timeou/i.test(msg)
    const pend = await query<{ n: number }>(`SELECT COUNT(*) AS n FROM _sync_state WHERE pending = 1`).catch(() => [{ n: 0 }])
    // 同步失败/离线时也要刷新冲突数：setStatus 是部分合并，
    // 不传 conflicts 会保留上一次的值，导致冲突已解决（或新产生）时顶栏数字不更新。
    const cnErr = await query<{ n: number }>(`SELECT COUNT(*) AS n FROM _sync_state WHERE conflict = 1`).catch(() => [{ n: 0 }])
    setStatus({
      state: offline ? 'offline' : 'error',
      message: offline ? '离线，改动已保存在本地，联网后自动上传' : msg,
      pending: pend[0]?.n ?? 0,
      conflicts: cnErr[0]?.n ?? 0,
    })
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

// ---------------- 冲突：查询与裁决 ----------------

export interface ConflictRow {
  table: string
  rowId: number
  serverId: number | null
  label: string
  localUppedAt: number
}

/** 业务表里能拿来给人看的一列，用于冲突列表显示「是哪条记录」 */
const LABEL_COLS = ['title', 'name', 'task', 'content', 'topic', 'question', 'domain', 'host', 'key']

export async function listConflicts(): Promise<ConflictRow[]> {
  // 原实现无条件对 41 张表逐表查询，即使一处冲突也没有。
  // 实测启动阶段光这一项就产生 172 次 IPC 往返 / ~1.29s，是全启动最贵的单点
  // （settings 面板挂载 + 每次同步状态变更都会调它）。
  // 改为：一条 SQL 取全部冲突行，再只对「确有冲突」的表补查标签列。
  const all = await query<{ tableName: string; rowId: number; serverId: number | null; ut: number }>(
    `SELECT tableName, rowId, serverId, ut FROM _sync_state WHERE conflict = 1`,
  )
  if (all.length === 0) return []

  const byTable = new Map<string, { rowId: number; serverId: number | null; ut: number }[]>()
  for (const r of all) {
    const arr = byTable.get(r.tableName) ?? []
    arr.push(r)
    byTable.set(r.tableName, arr)
  }

  const out: ConflictRow[] = []
  for (const [t, rows] of byTable) {
    const cols = await localColumns(t)
    const labelCol = LABEL_COLS.find((c) => cols.has(c))
    const ids = rows.map((r) => r.rowId)
    const ph = ids.map(() => '?').join(', ')
    const data = labelCol
      ? await query<Record<string, unknown>>(`SELECT id, ${labelCol} FROM ${t} WHERE id IN (${ph})`, ids)
      : []
    const labelMap = new Map<number, string>()
    for (const d of data) labelMap.set(d.id as number, String(d[labelCol!] ?? ''))
    for (const r of rows) {
      out.push({
        table: t,
        rowId: r.rowId,
        serverId: r.serverId,
        label: labelMap.get(r.rowId) || `#${r.rowId}`,
        localUppedAt: r.ut,
      })
    }
  }
  return out
}

/**
 * 冲突裁决：
 * - 'local'  保留本地版本，重新推上去覆盖云端（把 ut 抬到当前时间以通过服务端 stale 判定）
 * - 'remote' 放弃本地改动，接受云端版本（清掉冲突标记，下次拉取会覆盖本地）
 */
export async function resolveConflict(table: string, rowId: number, choice: 'local' | 'remote'): Promise<void> {
  if (!SYNC_TABLES.includes(table as (typeof SYNC_TABLES)[number])) throw new Error(`未知表：${table}`)
  if (choice === 'local') {
    // 抬 ut 让它大于服务端版本，并重新入队推送
    await exec(
      `UPDATE _sync_state SET ut = ${Date.now()}, pending = 1, conflict = 0 WHERE tableName = ? AND rowId = ?`,
      [table, rowId],
    )
    await syncNow()
  } else {
    // 接受云端：清冲突标记，并把这张表的游标退回，强制重新拉取。
    // 该行的云端版本早已越过游标，不回退的话下一次拉取不会再带回它，
    // 本地会永远停在冲突前的旧值上，等于「选了云端却没生效」。
    await exec(
      `UPDATE _sync_state SET conflict = 0, pending = 0, baseUt = ut WHERE tableName = ? AND rowId = ?`,
      [table, rowId],
    )
    await exec(`UPDATE _sync_cursor SET cursor = 0 WHERE tableName = ?`, [table])
    await syncNow()
  }
}

/** 应用启动时调用 */
export async function initSync(): Promise<void> {
  const s = useSettings()
  await initSyncSchema()
  // 旧数据自愈：cloudUser 为空或被存成了 userId（纯数字）时，
  // 用 token 向服务端换回真实用户名。失败不阻塞同步，仅保持现状。
  if (s.cloudToken && (!s.cloudUser.trim() || /^\d+$/.test(s.cloudUser.trim()))) {
    try {
      const base = s.cloudUrl.replace(/\/+$/, '')
      const res = await fetch(`${base}/api/auth/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: s.cloudToken }),
      })
      if (res.ok) {
        const data = await res.json() as { username?: string }
        if (data.username) s.cloudUser = data.username
      }
    } catch {
      /* 离线等情况忽略，下次启动再试 */
    }
  }
  // 断网期间的本地改动本来就留在 pending 队列里，这里保证网络一恢复就补传，
  // 不必等下一次 5 分钟轮询或 WS 重连。
  if (typeof window !== 'undefined' && !onlineHooked) {
    onlineHooked = true
    window.addEventListener('online', () => { if (useSettings().cloudEnabled) void syncNow() })
  }
  if (!s.cloudEnabled || !s.cloudToken) return
  await syncNow()
  connectLive()
  // 兜底周期同步（WS 断线也能追上）。保存句柄去重：
  // 每次登录/注册都会调 initSync，原先重复注册会叠加出多个轮询定时器。
  if (pollTimer !== null) window.clearInterval(pollTimer)
  pollTimer = window.setInterval(() => { if (useSettings().cloudEnabled) void syncNow() }, 5 * 60 * 1000)
}
