// repo 白名单 vs drizzle schema 全表对账
// 目的：createRepo(table, columns) 的 pick() 只写入白名单内的列，
// schema 里新增了列但漏进白名单时，写入会被静默丢弃（历史上 domains 的 cost/renewCycle 就踩过）。
// 用法：node scripts/verify-repo-columns.mjs
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const schema = await import(pathToFileURL(join(root, 'drizzle', 'schema.ts')).href)
const indexSrc = readFileSync(join(root, 'src', 'db', 'index.ts'), 'utf8')

// 从 src/db/index.ts 抓 createRepo<X>('table', [ ... ])
const repoRe = /createRepo<[^>]+>\(\s*'([A-Za-z0-9_]+)'\s*,\s*\[([^\]]*)\]/g
const repos = new Map()
for (const m of indexSrc.matchAll(repoRe)) {
  const table = m[1]
  const cols = [...m[2].matchAll(/'([^']+)'/g)].map((x) => x[1])
  repos.set(table, cols)
}

// drizzle 导出名 -> 表名
const tableOf = (exp) => exp?.[Symbol.for('drizzle:Name')] ?? exp?._?.name ?? null
const schemaTables = new Map()
for (const [name, exp] of Object.entries(schema)) {
  if (!exp || typeof exp !== 'object') continue
  const t = exp[Symbol.for('drizzle:Name')]
  if (typeof t !== 'string') continue
  const cols = Object.keys(exp).filter((k) => !k.startsWith('_') && k !== '$inferSelect' && k !== '$inferInsert')
  schemaTables.set(t, { exportName: name, cols })
}

const AUTO = new Set(['id', 'createdAt', 'updatedAt'])
const results = []

for (const [table, whitelist] of repos) {
  const meta = schemaTables.get(table)
  if (!meta) {
    results.push({ table, ok: false, msg: `schema 里找不到表 ${table}（drizzle 导出名与表名不一致？）` })
    continue
  }
  const writables = meta.cols.filter((c) => !AUTO.has(c))
  const missing = writables.filter((c) => !whitelist.includes(c)) // schema 有但白名单漏 —— 写入被静默丢弃
  const dead = whitelist.filter((c) => !meta.cols.includes(c)) // 白名单有但 schema 无 —— INSERT 会报 no such column
  if (!missing.length && !dead.length) {
    results.push({ table, ok: true, msg: `${writables.length} 列全部对齐` })
  } else {
    const parts = []
    if (missing.length) parts.push(`漏列(MISSING): ${missing.join(', ')}`)
    if (dead.length) parts.push(`死列(DEAD): ${dead.join(', ')}`)
    results.push({ table, ok: false, msg: parts.join(' | ') })
  }
}

const covered = new Set(repos.keys())
const uncovered = [...schemaTables.keys()].filter((t) => !covered.has(t))

let fail = 0
for (const r of results.sort((a, b) => a.table.localeCompare(b.table))) {
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.table.padEnd(18)} ${r.msg}`)
  if (!r.ok) fail++
}
if (uncovered.length) {
  console.log(`\n信息：schema 中未建 repo 的表（可能有意，如 _sync_state / 只读表）：${uncovered.join(', ')}`)
}
console.log(`\n共 ${results.length} 个 repo，通过 ${results.length - fail}，失败 ${fail}`)
process.exit(fail ? 1 : 0)
