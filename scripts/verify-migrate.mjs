/**
 * 迁移链路验证：老库升级时后加的列能不能真的补上。
 *
 * 为什么单独验：CREATE TABLE IF NOT EXISTS 对已存在的表不会补列，
 * 新字段只写在 CREATE 里的话，老用户升级后永远读不到它——
 * 而且同步时该列会被静默丢弃，两端数据悄悄分叉，界面上看不出任何异常。
 *
 * 做法：先用「旧版建表语句」（不含新列）造一个老库，再执行 migrate.ts 里
 * 的 ALTERS_V1 清单，最后断言列真的存在、且能写入读出。
 *
 * 运行：node scripts/verify-migrate.mjs
 */
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const migrateSrc = readFileSync(join(here, '../src/db/migrate.ts'), 'utf8')

// 从源码抽取 ALTERS_V1，保证验证的就是真正会执行的那条清单
const alters = [...migrateSrc.matchAll(/\['(\w+)',\s*'(\w+)',\s*'([A-Z]+)'\]/g)].map((m) => ({
  table: m[1], col: m[2], def: m[3],
}))

let pass = 0
let fail = 0
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✔ ${name}`) }
  else { fail++; console.log(`  ✘ ${name}${detail ? ' — ' + detail : ''}`) }
}

console.log(`\n[1] 从 migrate.ts 解析到 ${alters.length} 条待补列`)
check('解析到待补列清单（不为空）', alters.length > 0)

// 造一个「老库」：domains 表只有旧列，没有 cost / renewCycle
const db = new DatabaseSync(':memory:')
db.exec(`CREATE TABLE domains (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  registrar TEXT,
  dnsProvider TEXT,
  expireDate TEXT,
  serverId INTEGER,
  sslExpireDate TEXT,
  note TEXT,
  createdAt TEXT
)`)
const before = db.prepare('PRAGMA table_info(domains)').all().map((r) => r.name)
check('老库确实没有新列', before.includes('cost') === false, 'cols=' + before.join(','))

// 执行与 migrate.ts 相同的 ALTER 逻辑（逐条 try/catch，已存在则忽略）
console.log('\n[2] 执行 ALTER 补列')
for (const a of alters) {
  try {
    db.exec(`ALTER TABLE ${a.table} ADD COLUMN ${a.col} ${a.def}`)
    console.log(`     + ${a.table}.${a.col} ${a.def}`)
  } catch { /* 列已存在 */ }
}

const after = db.prepare('PRAGMA table_info(domains)').all().map((r) => r.name)
for (const a of alters) {
  check(`${a.table}.${a.col} 已补上`, after.includes(a.col), 'cols=' + after.join(','))
}

// 幂等：重复执行不应报错
console.log('\n[3] 幂等（重复执行不报错）')
let idem = true
try {
  for (const a of alters) {
    try { db.exec(`ALTER TABLE ${a.table} ADD COLUMN ${a.col} ${a.def}`) } catch { /* 已存在 */ }
  }
} catch { idem = false }
check('重复 ALTER 被安全忽略', idem)

// 老数据兼容：补列后既有行能读到 NULL，且能写入新值
console.log('\n[4] 补列后读写可用')
db.exec("INSERT INTO domains (name, registrar) VALUES ('old.example.com', '旧注册商')")
const row = db.prepare("SELECT name, cost, renewCycle FROM domains WHERE name='old.example.com'").get()
check('既有行的新列读到 NULL', row.cost === null && row.renewCycle === null, JSON.stringify(row))
db.exec("UPDATE domains SET cost=88.5, renewCycle='yearly' WHERE name='old.example.com'")
const row2 = db.prepare("SELECT cost, renewCycle FROM domains WHERE name='old.example.com'").get()
check('新列可写入并读回', row2.cost === 88.5 && row2.renewCycle === 'yearly', JSON.stringify(row2))

// 与 drizzle schema 对账：migrate 补的列必须在 schema 里存在，否则前端写了也读不到
console.log('\n[5] 与 drizzle/schema.ts 对账')
const schemaSrc = readFileSync(join(here, '../drizzle/schema.ts'), 'utf8')
for (const a of alters) {
  const m = schemaSrc.match(new RegExp(`export const ${a.table} = sqliteTable\\('${a.table}', \\{([\\s\\S]*?)\\n\\}\\)`))
  if (!m) { check(`schema 中找到表 ${a.table}`, false); continue }
  check(`${a.table}.${a.col} 在 drizzle schema 中已声明`, new RegExp(`\\b${a.col}\\s*:`).test(m[1]))
}

console.log(`\n${fail === 0 ? '✔ 迁移链路全部通过' : '✘ 存在失败项'}：通过 ${pass} / 失败 ${fail}`)
process.exit(fail === 0 ? 0 : 1)
