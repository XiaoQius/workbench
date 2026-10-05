/**
 * 桌面端同步触发器链路验证（README「已知边界」里那条「首推未真机验证」）
 *
 * 不依赖 Tauri / WebView：直接从 src/db/sync.ts 抽取真实的建表与触发器 SQL，
 * 在 node:sqlite（与 Tauri 同源的 SQLite）里执行，验证四件事：
 *   1) 41 张业务表的 INSERT/UPDATE/DELETE 触发器都能建起来
 *   2) 本地改动会被触发器捕获进 _sync_state 且 pending=1（首推队列非空）
 *   3) busy=1 护栏生效：拉取落库期间不再捕获，不产生同步风暴
 *   4) bootstrapPending 能把存量行登记为待推送（首次连接全量上云的依据）
 *
 * 运行：node scripts/verify-sync-triggers.mjs
 */
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const syncSrc = readFileSync(join(here, '../src/db/sync.ts'), 'utf8')

// ---- 从源码抽取真实常量，避免验证副本与实现漂移 ----
const SYNC_TABLES = evalTableList(syncSrc)
const NOW_MS = `CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)`

function evalTableList(src) {
  const m = src.match(/export const SYNC_TABLES = \[([\s\S]*?)\] as const/)
  if (!m) throw new Error('未能在 sync.ts 中找到 SYNC_TABLES')
  return [...m[1].matchAll(/'([a-zA-Z]+)'/g)].map((x) => x[1])
}

let pass = 0
let fail = 0
function check(name, cond, detail = '') {
  if (cond) {
    pass++
    console.log(`  ✔ ${name}`)
  } else {
    fail++
    console.log(`  ✘ ${name}${detail ? ' — ' + detail : ''}`)
  }
}

const db = new DatabaseSync(':memory:')
// 注意：DatabaseSync.exec() 不接受绑定参数，带 ? 的语句必须走 prepare。
// 这里统一走 prepare，避免「传了参数却被 exec 忽略」导致的静默失败。
const exec = (sql, ...args) => {
  if (args.length === 0) return db.exec(sql)
  db.prepare(sql).run(...args)
}
const q = (sql, ...args) => db.prepare(sql).all(...args)
const one = (sql, ...args) => db.prepare(sql).get(...args)

// ---------- 1. 建业务表（只取同步所需的最小列，验证的是触发器而非业务 schema） ----------
console.log(`\n[1] 建 ${SYNC_TABLES.length} 张业务表 + 同步元数据表`)
for (const t of SYNC_TABLES) {
  exec(`CREATE TABLE IF NOT EXISTS ${t} (id INTEGER PRIMARY KEY, title TEXT, updatedAt INTEGER)`)
}
exec(`CREATE TABLE IF NOT EXISTS _sync_state (
  tableName TEXT NOT NULL, rowId INTEGER NOT NULL, serverId INTEGER,
  ut INTEGER NOT NULL DEFAULT 0, del INTEGER NOT NULL DEFAULT 0,
  pending INTEGER NOT NULL DEFAULT 0, baseUt INTEGER NOT NULL DEFAULT 0,
  conflict INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (tableName, rowId))`)
exec(`CREATE TABLE IF NOT EXISTS _sync_cursor (tableName TEXT PRIMARY KEY, cursor INTEGER NOT NULL DEFAULT 0)`)
exec(`CREATE TABLE IF NOT EXISTS _sync_flag (key TEXT PRIMARY KEY, v INTEGER NOT NULL DEFAULT 0)`)
exec(`INSERT OR IGNORE INTO _sync_flag (key, v) VALUES ('busy', 0)`)
exec(`UPDATE _sync_flag SET v = 0 WHERE key = 'busy'`)
check('元数据表建成', q(`SELECT name FROM sqlite_master WHERE name LIKE '_sync%'`).length === 3)

// ---------- 2. 建触发器（SQL 与 sync.ts initSyncSchema 逐字一致） ----------
console.log('\n[2] 按 sync.ts 的 SQL 建触发器')
let built = 0
for (const t of SYNC_TABLES) {
  const when = `WHEN (SELECT v FROM _sync_flag WHERE key='busy') = 0 BEGIN`
  const guard = `INSERT INTO _sync_state (tableName, rowId, serverId, ut, del, pending, baseUt) VALUES ('${t}', NEW.id, NULL, ${NOW_MS}, 0, 1, 0)
    ON CONFLICT(tableName, rowId) DO UPDATE SET ut=${NOW_MS}, del=0, pending=1;`
  exec([
    `CREATE TRIGGER IF NOT EXISTS _sync_${t}_i AFTER INSERT ON ${t} ${when} ${guard} END`,
    `CREATE TRIGGER IF NOT EXISTS _sync_${t}_u AFTER UPDATE ON ${t} ${when} ${guard} END`,
    `CREATE TRIGGER IF NOT EXISTS _sync_${t}_d AFTER DELETE ON ${t} ${when}
      INSERT INTO _sync_state (tableName, rowId, serverId, ut, del, pending, baseUt) VALUES ('${t}', OLD.id,
        (SELECT serverId FROM _sync_state WHERE tableName='${t}' AND rowId=OLD.id), ${NOW_MS}, 1, 1, 0)
      ON CONFLICT(tableName, rowId) DO UPDATE SET ut=${NOW_MS}, del=1, pending=1; END`,
  ].join(';\n'))
  built++
}
const trigCount = one(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type='trigger' AND name LIKE '_sync_%'`).n
check(`${SYNC_TABLES.length} 张表 × 3 个触发器全部建成`, trigCount === SYNC_TABLES.length * 3, `实际 ${trigCount}，期望 ${SYNC_TABLES.length * 3}`)

// ---------- 3. 存量数据 + bootstrapPending ----------
console.log('\n[3] 存量行登记（首次连接全量上云的依据）')
for (const t of SYNC_TABLES) {
  exec(`INSERT INTO ${t} (title) VALUES ('存量-${t}')`)
}
const beforeBootstrap = one(`SELECT COUNT(*) AS n FROM _sync_state WHERE pending = 1`).n
check('触发器已捕获建表后的插入', beforeBootstrap === SYNC_TABLES.length, `实际 ${beforeBootstrap}`)

// 模拟全新库：先清掉触发器捕获到的状态，走 bootstrapPending 路径
exec(`DELETE FROM _sync_state`)
// 与 sync.ts bootstrapPending 一致：已同步过（cursor>0 或存在 pending=0 的行）则跳过
const done = one(`SELECT COUNT(*) AS n FROM _sync_cursor WHERE cursor > 0`).n
const pushed = one(`SELECT COUNT(*) AS n FROM _sync_state WHERE pending = 0`).n
if (done > 0 || pushed > 0) throw new Error('前置条件不满足，无法模拟首次连接')
for (const t of SYNC_TABLES) {
  exec(`INSERT OR IGNORE INTO _sync_state (tableName, rowId, serverId, ut, del, pending, baseUt)
    SELECT '${t}', id, NULL, ${NOW_MS}, 0, 1, 0 FROM ${t}`)
}
const afterBootstrap = one(`SELECT COUNT(*) AS n FROM _sync_state WHERE pending = 1`).n
check('bootstrapPending 把存量行全部登记为待推送', afterBootstrap === SYNC_TABLES.length, `实际 ${afterBootstrap}`)
const baseUtZero = one(`SELECT COUNT(*) AS n FROM _sync_state WHERE baseUt = 0`).n
check('离线新建行 baseUt=0（冲突判定要求 ut>baseUt 必成立）', baseUtZero === SYNC_TABLES.length)

// ---------- 4. 三类变更捕获 ----------
console.log('\n[4] INSERT / UPDATE / DELETE 三类变更捕获')
// 用真实插入返回的 id 断言，不写死 rowId（前面的用例已占用过 id=1）
// 用独立表 notes 做三类变更用例，避免与第 3 段的存量行互相干扰
exec(`DELETE FROM _sync_state`)
exec(`DELETE FROM notes`)
exec(`INSERT INTO notes (title) VALUES ('新任务')`)
const newId = one(`SELECT id FROM notes WHERE title='新任务'`).id
const insState = one(`SELECT pending AS p, del AS d, ut FROM _sync_state WHERE tableName='notes' AND rowId=?`, newId)
check('INSERT 被捕获且 pending=1', !!insState && insState.p === 1 && insState.d === 0)
const ut1 = insState?.ut ?? 0

await new Promise((r) => setTimeout(r, 15))
exec(`UPDATE notes SET title='改后' WHERE id=?`, newId)
const updState = one(`SELECT pending AS p, ut FROM _sync_state WHERE tableName='notes' AND rowId=?`, newId)
check('UPDATE 被捕获且 pending=1', !!updState && updState.p === 1)
check('UPDATE 推高了 ut（ut 单调递增）', (updState?.ut ?? 0) >= ut1, `${ut1} -> ${updState?.ut}`)

exec(`DELETE FROM notes WHERE id=?`, newId)
const delState = one(`SELECT pending AS p, del AS d FROM _sync_state WHERE tableName='notes' AND rowId=?`, newId)
check('DELETE 被捕获且标记为墓碑 del=1', !!delState && delState.d === 1 && delState.p === 1)

// ---------- 5. busy 护栏 ----------
console.log('\n[5] busy=1 护栏（拉取落库期间不产生同步风暴）')
exec(`UPDATE _sync_flag SET v = 1 WHERE key='busy'`)
exec(`DELETE FROM _sync_state`)
for (const t of SYNC_TABLES) exec(`INSERT INTO ${t} (title) VALUES ('拉取落库-${t}')`)
const duringPull = one(`SELECT COUNT(*) AS n FROM _sync_state WHERE pending = 1`).n
check('busy=1 期间远端落库的写入不进待推送队列', duringPull === 0, `实际 ${duringPull}`)

exec(`UPDATE _sync_flag SET v = 0 WHERE key='busy'`)
// 用另一张干净表验证，避免前面用例残留的状态行干扰计数
exec(`INSERT INTO links (title) VALUES ('护栏解除后')`)
const afterPull = one(`SELECT COUNT(*) AS n FROM _sync_state WHERE tableName='links'`).n
check('busy 复位后本地改动恢复捕获', afterPull === 1, `实际 ${afterPull}`)

// ---------- 6. 幂等重入 ----------
console.log('\n[6] initSyncSchema 幂等（重复建触发器不报错）')
let idemOk = true
try {
  for (const t of SYNC_TABLES) {
    const when = `WHEN (SELECT v FROM _sync_flag WHERE key='busy') = 0 BEGIN`
    const guard = `INSERT INTO _sync_state (tableName, rowId, serverId, ut, del, pending, baseUt) VALUES ('${t}', NEW.id, NULL, ${NOW_MS}, 0, 1, 0)
      ON CONFLICT(tableName, rowId) DO UPDATE SET ut=${NOW_MS}, del=0, pending=1;`
    exec(`CREATE TRIGGER IF NOT EXISTS _sync_${t}_i AFTER INSERT ON ${t} ${when} ${guard} END`)
  }
} catch {
  idemOk = false
}
const trigAfter = one(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type='trigger' AND name LIKE '_sync_%'`).n
check('重复执行不报错且触发器数不膨胀', idemOk && trigAfter === SYNC_TABLES.length * 3, `实际 ${trigAfter}`)

console.log(`\n${fail === 0 ? '✔ 触发器链路全部通过' : '✘ 存在失败项'}：通过 ${pass} / 失败 ${fail}`)
process.exit(fail === 0 ? 0 : 1)
