import Database from '@tauri-apps/plugin-sql'

let db: Database | null = null

/**
 * 性能探针（默认关闭）。
 * 开启方式：dev 地址带 ?perf=1，或 localStorage.setItem('wb:perf','1') 后刷新。
 * 关闭时热路径只有一次布尔判断，不影响正常性能。
 */
const perfOn = (): boolean => {
  try {
    if (typeof localStorage !== 'undefined' && localStorage.getItem('wb:perf') === '1') return true
    if (typeof location !== 'undefined' && /[?&]perf=1/.test(location.search)) return true
  } catch {
    /* 忽略 */
  }
  return false
}

interface PerfStat { calls: number; ms: number }
const perf = {
  calls: 0,
  totalMs: 0,
  byTable: new Map<string, PerfStat>(),
  slowest: [] as { sql: string; ms: number }[],
}
const TABLE_RE = /\b(?:from|into|update)\s+([a-zA-Z_][\w]*)/i

function record(sql: string, ms: number): void {
  perf.calls++
  perf.totalMs += ms
  const t = (TABLE_RE.exec(sql)?.[1]) ?? '?'
  const e = perf.byTable.get(t) ?? { calls: 0, ms: 0 }
  e.calls++
  e.ms += ms
  perf.byTable.set(t, e)
  if (ms >= 5) {
    perf.slowest.push({ sql: sql.slice(0, 140), ms: Math.round(ms * 10) / 10 })
    perf.slowest.sort((a, b) => b.ms - a.ms)
    if (perf.slowest.length > 20) perf.slowest.length = 20
  }
}

/** 性能探针对外接口：snapshot() 取快照，reset() 清零以便分段测量 */
export const dbPerf = {
  snapshot() {
    return {
      calls: perf.calls,
      totalMs: Math.round(perf.totalMs * 10) / 10,
      byTable: [...perf.byTable.entries()]
        .map(([table, v]) => ({ table, calls: v.calls, ms: Math.round(v.ms * 10) / 10 }))
        .sort((a, b) => b.ms - a.ms),
      slowest: perf.slowest.slice(),
    }
  },
  reset() {
    perf.calls = 0
    perf.totalMs = 0
    perf.byTable.clear()
    perf.slowest.length = 0
  },
}

/** 加载 SQLite（Tauri 插件；浏览器环境会 reject，由调用方降级） */
export async function getDb(): Promise<Database> {
  if (db) return db
  db = await Database.load('sqlite:workbench.db')
  return db
}

/** 执行写 SQL，返回 { rowsAffected, lastInsertId } */
export async function exec(
  sql: string,
  params: unknown[] = [],
): Promise<{ rowsAffected: number; lastInsertId?: number }> {
  const d = await getDb()
  if (!perfOn()) return d.execute(sql, params)
  const t0 = performance.now()
  try {
    return await d.execute(sql, params)
  } finally {
    record(sql, performance.now() - t0)
  }
}

/** 执行查询 SQL，返回行对象数组 */
export async function query<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const d = await getDb()
  if (!perfOn()) return d.select<T[]>(sql, params)
  const t0 = performance.now()
  try {
    return await d.select<T[]>(sql, params)
  } finally {
    record(sql, performance.now() - t0)
  }
}