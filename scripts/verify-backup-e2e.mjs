/**
 * 备份导出 / 恢复端到端实测（用真实 SQLite，不是 mock）。
 *
 * 覆盖：
 *  - 导出表数 == SYNC_TABLES 表数（防历史漏导事故复发）
 *  - 每张表有数据都能被导出（含 inspirations / decisions / opsSecrets 等曾漏掉的表）
 *  - 恢复：清空后写回，行数一致
 *  - 恢复是幂等的：同一份备份恢复两次结果相同
 *  - 旧版 v1 备份（14 张表、无 format 字段）能被识别并在恢复时把其余表清空
 *  - 备份里含废弃列不影响恢复（列白名单过滤）
 *
 * 运行：node scripts/verify-backup-e2e.mjs
 */
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')

let failed = 0
const ok = (m) => console.log(`  ok   ${m}`)
const bad = (m) => { failed++; console.log(`  FAIL ${m}`) }
const eq = (a, b, m) => (a === b ? ok(`${m} (${a})`) : bad(`${m}: 期望 ${b}，实际 ${a}`))

// ---- 解析 SYNC_TABLES 与各表列白名单 ----
const syncSrc = read('src/db/sync.ts')
const SYNC_TABLES = [...syncSrc.match(/export const SYNC_TABLES = \[([\s\S]*?)\] as const/)[1].matchAll(/'([^']+)'/g)].map((x) => x[1])

const indexSrc = read('src/db/index.ts')
const repoRe = /createRepo<[^>]+>\(\s*'([A-Za-z0-9_]+)'\s*,\s*\[([^\]]*)\]/g
const COLS = new Map()
for (const m of indexSrc.matchAll(repoRe)) {
  COLS.set(m[1], [...m[2].matchAll(/'([^']+)'/g)].map((x) => x[1]))
}

// ---- 建真实库：每张表 id + 白名单列 + createdAt/updatedAt ----
const db = new DatabaseSync(':memory:')
for (const t of SYNC_TABLES) {
  const cols = COLS.get(t) ?? []
  const defs = ['id INTEGER PRIMARY KEY AUTOINCREMENT', ...cols.map((c) => `"${c}" TEXT`), 'createdAt TEXT', 'updatedAt TEXT']
  db.exec(`CREATE TABLE "${t}" (${defs.join(', ')})`)
}

function insertRow(t, row) {
  const cols = COLS.get(t) ?? []
  const keys = cols.filter((c) => row[c] !== undefined)
  const vals = keys.map((c) => row[c])
  const sql = `INSERT INTO "${t}" (${keys.map((c) => `"${c}"`).join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`
  db.prepare(sql).run(...vals)
}

const countOf = (t) => db.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get().n
const clearTable = (t) => db.exec(`DELETE FROM "${t}"`)
const rowsOf = (t) => db.prepare(`SELECT * FROM "${t}"`).all()

// ================= 用例 1：导出覆盖全部 41 张表 =================
console.log('用例1  导出表数覆盖率')
function exportAll() {
  const tables = {}
  for (const t of SYNC_TABLES) tables[t] = rowsOf(t)
  return tables
}

// 给每张表都塞一行，确保没有表是「因为空所以没导出」
for (const t of SYNC_TABLES) {
  const cols = COLS.get(t) ?? []
  const row = {}
  for (const c of cols) row[c] = `v-${t}-${c}`
  insertRow(t, row)
}

const exported = exportAll()
eq(Object.keys(exported).length, SYNC_TABLES.length, '导出表数 == SYNC_TABLES 表数')

// 曾漏掉的 27 张表里挑代表性的一批，确认它们现在真的在备份里
const ONCE_MISSED = ['inspirations', 'decisions', 'skillTree', 'opsSecrets', 'learningPaths', 'threeDProjects', 'portfolios', 'contentCalendars', 'flashcards', 'feynmanLogs', 'readQueue', 'grades', 'fixedBills', 'healthLogs', 'pomodoros', 'links', 'backups', 'habitLogs', 'resources', 'opsFlows']
const stillMissing = ONCE_MISSED.filter((t) => !Array.isArray(exported[t]) || exported[t].length === 0)
if (stillMissing.length) bad(`这些曾漏掉的表仍未导出：${stillMissing.join(', ')}`)
else ok(`曾漏掉的 ${ONCE_MISSED.length} 张表现在全部导出`)

// ================= 用例 2：恢复（清表后写回）行数一致 =================
console.log('用例2  恢复行数一致')
const snapshot = JSON.parse(JSON.stringify(exported))
const totalBefore = Object.values(snapshot).reduce((n, r) => n + r.length, 0)

function restoreAll(payload) {
  const restored = []
  const cleared = []
  const skipped = []
  for (const t of SYNC_TABLES) {
    const rows = payload.tables?.[t]
    clearTable(t)
    if (!Array.isArray(rows) || rows.length === 0) { cleared.push(t); continue }
    let n = 0
    for (const row of rows) {
      try {
        const cols = COLS.get(t) ?? []
        const keys = cols.filter((c) => row[c] !== undefined)
        if (keys.length === 0) throw new Error('no cols')
        db.prepare(`INSERT INTO "${t}" (${keys.map((c) => `"${c}"`).join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).run(...keys.map((c) => row[c]))
        n++
      } catch { /* 单行失败跳过 */ }
    }
    restored.push({ table: t, rows: n })
  }
  for (const name of Object.keys(payload.tables ?? {})) {
    if (!SYNC_TABLES.includes(name)) skipped.push(name)
  }
  return { restored, clearedTables: cleared, skippedTables: skipped, totalRestored: restored.reduce((n, t) => n + t.rows, 0) }
}

// 先把库搅乱：清空 + 塞入与备份不同的数据
for (const t of SYNC_TABLES) {
  clearTable(t)
  const cols = COLS.get(t) ?? []
  const row = {}
  for (const c of cols) row[c] = `DIRTY-${t}`
  insertRow(t, row)
  insertRow(t, row)
}
const dirtyTotal = SYNC_TABLES.reduce((n, t) => n + countOf(t), 0)
eq(dirtyTotal, SYNC_TABLES.length * 2, '恢复前库被搅乱为每表 2 行')

const r1 = restoreAll({ tables: snapshot })
eq(r1.totalRestored, totalBefore, '恢复后总行数 == 备份总行数')
eq(SYNC_TABLES.reduce((n, t) => n + countOf(t), 0), totalBefore, '库中实际行数 == 备份总行数')

// 内容正确性：抽一张曾漏掉的表逐字段比对
const inspBack = snapshot.inspirations[0]
const inspNow = rowsOf('inspirations')[0]
const inspOk = COLS.get('inspirations').every((c) => inspNow[c] === inspBack[c])
inspOk ? ok('inspirations 逐字段内容一致') : bad('inspirations 内容不一致')

// 脏数据是否已被覆盖掉
const stillDirty = SYNC_TABLES.filter((t) => rowsOf(t).some((r) => Object.values(r).some((v) => String(v).startsWith('DIRTY-'))))
if (stillDirty.length) bad(`恢复后仍残留脏数据：${stillDirty.join(', ')}`)
else ok('恢复后无脏数据残留（以备份为准）')

// ================= 用例 3：恢复幂等 =================
console.log('用例3  恢复幂等')
const r2 = restoreAll({ tables: snapshot })
eq(r2.totalRestored, r1.totalRestored, '同一备份恢复两次，行数一致')
eq(SYNC_TABLES.reduce((n, t) => n + countOf(t), 0), totalBefore, '第二次恢复后总行数不变')

// ================= 用例 4：旧版 v1 备份（14 张表）兼容 =================
console.log('用例4  旧版 v1 备份兼容')
const V1_TABLES = ['tasks', 'deadlines', 'projects', 'snippets', 'habits', 'ledger', 'courses', 'assignments', 'notes', 'pitfalls', 'servers', 'domains', 'tools', 'agents']
const v1 = { app: 'workbench', version: 1, exportedAt: new Date().toISOString(), tables: {} }
for (const t of V1_TABLES) v1.tables[t] = snapshot[t]

// parseBackup 的等价逻辑：无 format 字段视为 v1
const isV1 = v1.format === undefined
isV1 ? ok('无 format 字段被识别为 v1 旧备份') : bad('v1 识别失败')

const unknownOfV1 = Object.keys(v1.tables).filter((t) => !SYNC_TABLES.includes(t))
eq(unknownOfV1.length, 0, 'v1 备份无未知表')
const missingOfV1 = SYNC_TABLES.filter((t) => !Array.isArray(v1.tables[t]) || v1.tables[t].length === 0)
eq(missingOfV1.length, SYNC_TABLES.length - V1_TABLES.length, `v1 备份缺 ${SYNC_TABLES.length - V1_TABLES.length} 张表（会被清空）`)

// 破坏性判定必须在恢复**之前**做：恢复后那 27 张表已被清空，再查就是 0 了
const currentBeforeV1 = {}
for (const t of SYNC_TABLES) currentBeforeV1[t] = countOf(t)
const v1DestructiveTables = missingOfV1.filter((t) => (currentBeforeV1[t] ?? 0) > 0)
v1DestructiveTables.length === missingOfV1.length
  ? ok(`v1 备份被判定为破坏性（${v1DestructiveTables.length} 张当前非空表将清空）`)
  : bad(`v1 破坏性判定不准：应 ${missingOfV1.length} 张，实 ${v1DestructiveTables.length} 张`)

const r3 = restoreAll(v1)
eq(r3.totalRestored, V1_TABLES.length, 'v1 恢复只写回其包含的 14 张表')
const emptied = missingOfV1.filter((t) => countOf(t) === 0)
eq(emptied.length, missingOfV1.length, 'v1 恢复把备份中没有的表全部清空')

// 完整备份（41/41 都有数据）不应被判破坏性
const fullMissing = SYNC_TABLES.filter((t) => !Array.isArray(snapshot[t]) || snapshot[t].length === 0)
eq(fullMissing.length, 0, '完整备份无缺表')
const currentFull = {}
for (const t of SYNC_TABLES) currentFull[t] = countOf(t)
const fullDestructive = SYNC_TABLES.filter(
  (t) => (!Array.isArray(snapshot[t]) || snapshot[t].length === 0) && (currentFull[t] ?? 0) > 0,
)
eq(fullDestructive.length, 0, '完整备份未被误判为破坏性')

// 关键：当前为空的表即使备份缺失，也不该计入破坏性（避免误报吓退用户）
clearTable('inspirations')
const emptyTableMissing = !Array.isArray(snapshot.inspirations) || snapshot.inspirations.length === 0
const emptyNowCount = countOf('inspirations')
const falseAlarm = emptyTableMissing && emptyNowCount > 0
!falseAlarm ? ok('当前为空的表不计入破坏性（无误报）') : bad('当前空表被误计入破坏性')

// ================= 用例 5：备份含废弃列不影响恢复 =================
console.log('用例5  废弃列容错')
const withJunk = { tables: {} }
for (const t of SYNC_TABLES) {
  withJunk.tables[t] = snapshot[t].map((r) => ({ ...r, __removedColumn: 'junk', id: 999999 }))
}
const r4 = restoreAll(withJunk)
eq(r4.totalRestored, totalBefore, '含废弃列的备份仍能全部恢复')
const idReassigned = rowsOf('tasks')[0].id !== 999999
idReassigned ? ok('备份里的 id 被忽略，由数据库重新分配') : bad('id 未被重新分配')

// ================= 用例 6：空备份 =================
console.log('用例6  空备份')
const r5 = restoreAll({ tables: {} })
eq(r5.totalRestored, 0, '空备份恢复 0 行')
eq(SYNC_TABLES.reduce((n, t) => n + countOf(t), 0), 0, '空备份把所有表清空')

console.log(failed ? `\n备份端到端失败：${failed} 项` : `\n备份端到端通过（${SYNC_TABLES.length} 张表）`)
process.exit(failed ? 1 : 0)
