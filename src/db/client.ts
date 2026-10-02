import Database from '@tauri-apps/plugin-sql'

let db: Database | null = null

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
  return d.execute(sql, params)
}

/** 执行查询 SQL，返回行对象数组 */
export async function query<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const d = await getDb()
  return d.select<T[]>(sql, params)
}
