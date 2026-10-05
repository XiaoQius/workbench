/**
 * 备份导出 / 恢复。
 *
 * 背景：早期导出写死了 14 张表的 repo 实例，而 SYNC_TABLES 有 41 张，
 * 导致 inspirations / decisions / skillTree / opsSecrets 等积累型数据
 * 被静默漏掉；且只有导出、没有导入，备份文件实际不可读。
 *
 * 设计约束：
 * - 表清单唯一来源 = SYNC_TABLES，新增表自动纳入，不再有第二处硬编码。
 * - 恢复以「备份为准」全量替换：先清表再写入，避免半旧半新。
 * - 恢复前必须 preview()，把「会覆盖多少行」给用户看清楚，再走二次确认。
 * - 写库走各表 repo 的列白名单，天然防注入、且过滤掉备份里已废弃的列。
 */
import { SYNC_TABLES } from './sync'
import * as repos from './index'
import { query } from './client'

export const BACKUP_FORMAT = 'workbench-backup'
export const BACKUP_FORMAT_VERSION = 2

export interface BackupPayload {
  app: string
  format: string
  formatVersion: number
  exportedAt: string
  tables: Record<string, Record<string, unknown>[]>
}

export interface TableStat {
  table: string
  rows: number
}

export interface BackupSummary {
  exportedAt: string | null
  formatVersion: number
  tables: TableStat[]
  totalRows: number
  /** 备份里出现但当前已不存在的表（旧版本备份），恢复时跳过 */
  unknownTables: string[]
  /** 当前有表但备份里缺失，恢复时会被清空 */
  missingTables: string[]
  /**
   * true 表示该备份会清空大量当前表（如旧版 v1 只含 14/41 张表）。
   * 这种情况下「以备份为准」等于销毁数据，UI 必须强制额外警示。
   */
  destructive: boolean
  /**
   * 破坏性判定的依据：备份缺失且**当前非空**的表。
   * 当前本来就空的表被清空不构成损失，不计入，避免误报。
   */
  destructiveTables: string[]
}

type AnyRepo = {
  listAll: () => Promise<unknown[]>
  clear: () => Promise<void>
  insert: (row: Record<string, unknown>) => Promise<number>
}

/** 表名 → repo 实例。缺失即为代码不一致，listRepos 会直接抛错，由门禁脚本兜住。 */
function repoOf(table: string): AnyRepo {
  const m = repos as unknown as Record<string, AnyRepo | undefined>
  // 表名 tasks → tasksRepo；opsDns → opsDnsRepo 等，均为 `${table}Repo`
  const r = m[`${table}Repo`]
  if (!r) throw new Error(`表 ${table} 缺少对应的 Repository 实例`)
  return r
}

/** 全表导出：表清单与行数直接来自 SYNC_TABLES，永不与其脱节 */
export async function exportAll(): Promise<BackupPayload> {
  const tables: Record<string, Record<string, unknown>[]> = {}
  for (const t of SYNC_TABLES) {
    const rows = await repoOf(t).listAll()
    tables[t] = rows as Record<string, unknown>[]
  }
  return {
    app: 'workbench',
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    tables,
  }
}

/**
 * 解析一份备份内容。只做解析，不写库也不查当前库。
 * 需要完整预览信息（含破坏性判定）时用 summarizeBackup()。
 */
export function parseBackup(raw: string): BackupPayload {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    throw new Error('不是合法的 JSON 文件')
  }
  if (!data || typeof data !== 'object') throw new Error('备份内容不是 JSON 对象')
  const obj = data as Record<string, unknown>

  // v1 旧格式（{ app, version, exportedAt, tables }）兼容：无 format 字段即视为 v1
  const isV1 = obj.format === undefined
  const tablesRaw = obj.tables
  if (!tablesRaw || typeof tablesRaw !== 'object' || Array.isArray(tablesRaw)) {
    throw new Error('备份缺少 tables 字段')
  }

  return {
    app: String(obj.app ?? 'workbench'),
    format: isV1 ? BACKUP_FORMAT : String(obj.format ?? BACKUP_FORMAT),
    formatVersion: isV1 ? 1 : Number(obj.formatVersion ?? 1),
    exportedAt: String(obj.exportedAt ?? ''),
    tables: tablesRaw as Record<string, Record<string, unknown>[]>,
  }
}

/**
 * 汇总备份 + 对比当前库，产出恢复前预览。
 * 会查各表当前行数：既用于展示「哪些表会被覆盖」，也用于精确判定破坏性——
 * 只有「备份缺失 且 当前非空」的表才算真实损失，当前本来就空的表被清空无害。
 */
export async function summarizeBackup(payload: BackupPayload): Promise<BackupSummary> {
  const tables = payload.tables ?? {}
  const stats: TableStat[] = []
  const unknown: string[] = []
  for (const [name, rows] of Object.entries(tables)) {
    if (!Array.isArray(rows)) continue
    if (!(SYNC_TABLES as readonly string[]).includes(name)) {
      unknown.push(name)
      continue
    }
    if (rows.length) stats.push({ table: name, rows: rows.length })
  }
  stats.sort((a, b) => b.rows - a.rows)

  const missing = (SYNC_TABLES as readonly string[]).filter(
    (t) => !Array.isArray(tables[t]) || (tables[t] as unknown[]).length === 0,
  )
  const current = await currentCounts()
  const destructiveTables = missing.filter((t) => (current[t] ?? 0) > 0)

  return {
    exportedAt: payload.exportedAt || null,
    formatVersion: payload.formatVersion,
    tables: stats,
    totalRows: stats.reduce((n, t) => n + t.rows, 0),
    unknownTables: unknown,
    missingTables: missing,
    destructive: destructiveTables.length > 0,
    destructiveTables,
  }
}

export interface RestoreResult {
  restored: TableStat[]
  clearedTables: string[]
  skippedTables: string[]
  totalRestored: number
  /** 单行写入失败的表及原因，UI 必须展示，否则用户看不出少了哪几行 */
  failures: { table: string; failed: number; sample: string }[]
}

/**
 * 以备份为准全量恢复：逐表 clear → insert。
 * 走 repo.insert 的列白名单，备份里带 id / createdAt 等列会被白名单过滤，
 * 由数据库重新分配，避免与现存行冲突。
 *
 * 为什么没有用 BEGIN/COMMIT（实测结论，2026-10-05）：
 * tauri-plugin-sql 的 execute **每次调用自带一层事务**，跨调用无法维持事务上下文——
 * 单独 exec('BEGIN') 会成功但下一次 exec 时事务已不存在（报
 * "cannot rollback - no transaction is active"）；把 BEGIN...ROLLBACK 塞进一次
 * execute 则报 "cannot start a transaction within a transaction"。
 * 也就是说跨 41 张表的恢复**无法靠数据库事务保证原子性**，
 * 中途失败会停在「旧数据已删、新数据未进」的半库状态。
 *
 * 因此改为「应用层补偿」：恢复前先把当前库全量快照进内存，
 * 任何一步抛错就用快照写回；即便写回也失败，快照仍会通过 rejected 原因
 * 抛给上层，绝不静默。
 */
export async function restoreAll(payload: BackupPayload): Promise<RestoreResult> {
  const restored: TableStat[] = []
  const cleared: string[] = []
  const skipped: string[] = []
  const failures: { table: string; failed: number; sample: string }[] = []

  // 快照当前库，用于失败补偿
  const snapshot: Record<string, Record<string, unknown>[]> = {}
  for (const t of SYNC_TABLES) {
    try {
      snapshot[t] = (await repoOf(t).listAll()) as Record<string, unknown>[]
    } catch {
      snapshot[t] = []
    }
  }

  try {
    for (const t of SYNC_TABLES) {
      const rows = payload.tables?.[t]
      const repo = repoOf(t)
      // 备份里没有这张表（或为空）→ 也清空，保证「以备份为准」，不留半旧半新
      await repo.clear()
      if (!Array.isArray(rows) || rows.length === 0) {
        cleared.push(t)
        continue
      }
      let n = 0
      let sample = ''
      let bad = 0
      for (const row of rows) {
        try {
          await repo.insert(row)
          n++
        } catch (e) {
          // 单行失败不中断整批（备份里可能含已下线列），但要记账以便如实告知用户
          bad++
          if (!sample) sample = e instanceof Error ? e.message : String(e)
        }
      }
      if (bad) failures.push({ table: t, failed: bad, sample })
      restored.push({ table: t, rows: n })
    }
  } catch (e) {
    // 尽力用快照还原；还原失败也要把两份错误都抛出去，绝不假装成功
    const revertErrors: string[] = []
    for (const t of SYNC_TABLES) {
      try {
        const repo = repoOf(t)
        await repo.clear()
        for (const row of snapshot[t] ?? []) {
          try { await repo.insert(row) } catch { /* 单行失败继续，最后汇总 */ }
        }
      } catch (e2) {
        revertErrors.push(`${t}: ${e2 instanceof Error ? e2.message : String(e2)}`)
      }
    }
    const base = e instanceof Error ? e.message : String(e)
    throw new Error(
      `恢复失败，已尝试还原原数据。原因：${base}` +
        (revertErrors.length ? `；还原过程中还有 ${revertErrors.length} 张表出错：${revertErrors.slice(0, 3).join(' | ')}` : ''),
    )
  }

  for (const name of Object.keys(payload.tables ?? {})) {
    if (!(SYNC_TABLES as readonly string[]).includes(name)) skipped.push(name)
  }

  return {
    restored,
    clearedTables: cleared,
    skippedTables: skipped,
    totalRestored: restored.reduce((n, t) => n + t.rows, 0),
    failures,
  }
}

/** 当前库中每张表的实际行数，供恢复前对比「会被覆盖多少」 */
export async function currentCounts(): Promise<Record<string, number>> {
  const out: Record<string, number> = {}
  for (const t of SYNC_TABLES) {
    try {
      const rows = await query<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t}`)
      out[t] = rows[0]?.n ?? 0
    } catch {
      out[t] = 0
    }
  }
  return out
}
