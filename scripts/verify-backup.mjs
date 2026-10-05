/**
 * 备份完整性门禁。
 *
 * 历史事故：导出曾写死 14 张表的 repo 实例，而 SYNC_TABLES 有 41 张，
 * inspirations / decisions / skillTree / opsSecrets 等被静默漏掉，
 * 备份文件实际残缺；且只有导出没有导入。
 *
 * 本脚本守住两件事：
 *  1. 每张 SYNC_TABLES 里的表都有对应的 `<table>Repo` 实例（否则导出/恢复会抛错）
 *  2. 备份模块的表清单来源唯一 = SYNC_TABLES，代码里不得出现第二份硬编码表清单
 *
 * 运行：node scripts/verify-backup.mjs
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')

let failed = 0
const ok = (msg) => console.log(`  ok   ${msg}`)
const bad = (msg) => {
  failed++
  console.log(`  FAIL ${msg}`)
}

// ---- 1. 解析 SYNC_TABLES ----
const syncSrc = read('src/db/sync.ts')
const m = syncSrc.match(/export const SYNC_TABLES = \[([\s\S]*?)\] as const/)
if (!m) {
  bad('无法在 src/db/sync.ts 中定位 SYNC_TABLES')
  process.exit(1)
}
const SYNC_TABLES = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1])
console.log(`SYNC_TABLES: ${SYNC_TABLES.length} 张`)

if (SYNC_TABLES.length === 0) bad('SYNC_TABLES 解析结果为空')
else ok(`SYNC_TABLES 解析出 ${SYNC_TABLES.length} 张表`)
if (new Set(SYNC_TABLES).size !== SYNC_TABLES.length) bad('SYNC_TABLES 存在重复表名')
else ok('SYNC_TABLES 无重复')

// ---- 2. 每张表必须有 repo 实例 ----
const indexSrc = read('src/db/index.ts')
const missing = SYNC_TABLES.filter((t) => !indexSrc.includes(`export const ${t}Repo`))
if (missing.length) bad(`以下表缺少 ${missing.map((t) => `${t}Repo`).join(', ')}：${missing.join(', ')}`)
else ok(`全部 ${SYNC_TABLES.length} 张表都有对应的 Repository 实例`)

// ---- 3. 备份模块必须以 SYNC_TABLES 为唯一来源 ----
const backupSrc = read('src/db/backup.ts')
if (!/from '\.\/sync'/.test(backupSrc) || !/SYNC_TABLES/.test(backupSrc)) {
  bad('src/db/backup.ts 未引用 SYNC_TABLES，表清单可能已脱节')
} else {
  ok('backup.ts 表清单取自 SYNC_TABLES')
}

// backup.ts 里不得出现手写表清单（连续 5 个以上表名字面量）
const literalRun = [...backupSrc.matchAll(/'([a-zA-Z][a-zA-Z0-9]*)'/g)].map((x) => x[1])
const tableLiterals = literalRun.filter((x) => SYNC_TABLES.includes(x))
if (tableLiterals.length > 2) {
  bad(`backup.ts 疑似硬编码了表清单（命中 ${tableLiterals.length} 个表名）`)
} else {
  ok('backup.ts 未硬编码表清单')
}

// ---- 4. 设置面板不得再手写导出表清单 ----
const panelSrc = read('src/components/SettingsPanel.vue')
const panelRepoRefs = [...panelSrc.matchAll(/(\w+)Repo\.listAll\(\)/g)].map((x) => x[1])
if (panelRepoRefs.length) {
  bad(`SettingsPanel.vue 仍在手写导出表（${[...new Set(panelRepoRefs)].join(', ')}），应改为调用 exportAll()`)
} else {
  ok('SettingsPanel.vue 已改为调用 exportAll()，无手写表清单')
}
if (!panelSrc.includes('exportAll')) bad('SettingsPanel.vue 未调用 exportAll')
else ok('SettingsPanel.vue 使用 exportAll 导出')

// ---- 5. 导入/导出必须成对存在 ----
if (!/export async function restoreAll/.test(backupSrc)) bad('backup.ts 缺少 restoreAll（只有导出没有导入）')
else ok('导出 exportAll 与恢复 restoreAll 成对存在')
if (!/export function parseBackup/.test(backupSrc)) bad('backup.ts 缺少 parseBackup 预览')
else ok('恢复前有 parseBackup 预览')

// ---- 7. 破坏性恢复必须有保护 ----
// 旧版 v1 备份只含 14/41 张表，直接「以备份为准」恢复会清空其余 27 张表，
// 等于静默销毁数据。必须标记 destructive 并由 UI 强制额外确认。
if (!/destructive:/.test(backupSrc)) bad('backup.ts 未标记 destructive（旧备份恢复会静默清空缺表）')
else ok('backup.ts 标记 destructive')
if (!/destructiveTables/.test(backupSrc)) bad('backup.ts 缺少 destructiveTables（应只统计当前非空的表）')
else ok('destructive 仅统计当前非空表，避免误报')
if (!/export async function summarizeBackup/.test(backupSrc)) bad('backup.ts 缺少 summarizeBackup')
else ok('parseBackup 与 summarizeBackup 职责分离')
if (!/destructiveAck/.test(panelSrc)) bad('SettingsPanel.vue 缺少 destructiveAck 显式确认')

// ---- 8. 恢复必须有失败补偿（实测：数据库事务跨调用不可用） ----
// tauri-plugin-sql 每次 execute 自带事务，跨 41 张表的恢复无法用 BEGIN/COMMIT 保证原子性，
// 一旦中途失败就是「旧数据已删、新数据未进」的半库。因此必须在应用层先快照再补偿。
if (!/snapshot\[t\]/.test(backupSrc)) bad('backup.ts 恢复前未做快照，中途失败无法还原')
else ok('恢复前先快照当前库')
if (!/已尝试还原原数据/.test(backupSrc)) bad('backup.ts 失败时未尝试用快照还原')
else ok('恢复失败会用快照还原')
// 不要误用 BEGIN/COMMIT：实测插件已自带事务，嵌套会报 cannot start a transaction within a transaction
if (/await exec\('BEGIN'\)/.test(backupSrc)) {
  bad('backup.ts 用了 BEGIN——实测插件自带事务，跨调用无效且嵌套会报错')
} else {
  ok('未误用跨调用 BEGIN 事务')
}
if (!/destructiveAck/.test(panelSrc)) bad('SettingsPanel.vue 缺少 destructiveAck 显式确认')
else ok('破坏性恢复需显式勾选确认')
if (!/:disabled="restoreSummary\.destructive && !destructiveAck"/.test(panelSrc)) {
  bad('破坏性恢复未禁用按钮（未确认也能点）')
} else {
  ok('未确认时恢复按钮被禁用')
}

// ---- 6. 恢复必须走二次确认 ----
if (!/confirm\(\{[\s\S]{0,400}?content:/.test(panelSrc)) {
  bad('SettingsPanel.vue 恢复流程未见二次确认')
} else {
  ok('恢复流程含二次确认')
}

console.log(failed ? `\n备份门禁失败：${failed} 项` : '\n备份门禁通过')
process.exit(failed ? 1 : 0)
