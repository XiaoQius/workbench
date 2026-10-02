import { exec, query } from './client'

export interface Repo<T extends { id: number }> {
  list(): Promise<T[]>
  listAll(): Promise<T[]>
  get(id: number): Promise<T | null>
  insert(row: Partial<T>): Promise<number>
  update(id: number, patch: Partial<T>): Promise<void>
  remove(id: number): Promise<void>
  count(): Promise<number>
}

function nowIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(
    d.getMinutes(),
  ).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
}

/**
 * 通用 Repository 工厂。
 * columns 为允许写入的列白名单（不含 id / createdAt / updatedAt 等自动列），防注入并保证字段一致。
 */
export function createRepo<T extends { id: number }>(
  table: string,
  columns: string[],
  opts: { timestamps?: boolean } = {},
): Repo<T> {
  const { timestamps = false } = opts
  const pick = (row: Record<string, unknown>): Record<string, unknown> => {
    const out: Record<string, unknown> = {}
    for (const c of columns) {
      if (row[c] !== undefined) out[c] = row[c]
    }
    return out
  }

  return {
    async list() {
      return query<T>(`SELECT * FROM ${table} ORDER BY id DESC`)
    },
    async listAll() {
      return query<T>(`SELECT * FROM ${table}`)
    },
    async get(id: number) {
      const rows = await query<T>(`SELECT * FROM ${table} WHERE id = ? LIMIT 1`, [id])
      return rows[0] ?? null
    },
    async insert(row: Partial<T>) {
      const data = pick(row as Record<string, unknown>)
      if (timestamps && data.createdAt === undefined) data.createdAt = nowIso()
      const keys = Object.keys(data)
      if (keys.length === 0) {
        const r = await exec(`INSERT INTO ${table} DEFAULT VALUES`)
        return r.lastInsertId ?? 0
      }
      const placeholders = keys.map(() => '?').join(', ')
      const values = keys.map((k) => data[k])
      const r = await exec(
        `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${placeholders})`,
        values,
      )
      return r.lastInsertId ?? 0
    },
    async update(id: number, patch: Partial<T>) {
      const data = pick(patch as Record<string, unknown>)
      if (Object.keys(data).length === 0) return
      if (timestamps) data.updatedAt = nowIso()
      const set = Object.keys(data)
        .map((k) => `${k} = ?`)
        .join(', ')
      const values = [...Object.values(data), id]
      await exec(`UPDATE ${table} SET ${set} WHERE id = ?`, values)
    },
    async remove(id: number) {
      await exec(`DELETE FROM ${table} WHERE id = ?`, [id])
    },
    async count() {
      const rows = await query<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`)
      return rows[0]?.n ?? 0
    },
  }
}
