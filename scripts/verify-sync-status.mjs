/**
 * 同步状态字段完整性门禁。
 *
 * 背景：status 是模块内单例，setStatus 用 Object.assign 做**部分合并**。
 * 因此任何一个分支漏传某个字段，那个字段就会保留上一次的值而不报错——
 * 表现为「冲突已解决但顶栏数字不动」这类难以察觉的陈旧状态。
 *
 * 实测踩到过：syncNow 的 catch 分支（离线 / 出错）只传 state/message/pending，
 * 没传 conflicts，导致离线期间冲突数变化无法反映到顶栏。
 *
 * 本脚本守住：syncNow 的**每个** setStatus 调用都必须带上 pending 与 conflicts。
 *
 * 运行：node scripts/verify-sync-status.mjs
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = readFileSync(join(root, 'src', 'db', 'sync.ts'), 'utf8')

let failed = 0
const ok = (m) => console.log(`  ok   ${m}`)
const bad = (m) => { failed++; console.log(`  FAIL ${m}`) }

// ---- 1. setStatus 必须是部分合并（确认这条前提仍然成立） ----
const setStatusFn = src.match(/function setStatus\(patch: Partial<SyncStatus>\)\s*\{([\s\S]*?)\n\}/)
if (!setStatusFn) bad('未找到 setStatus 定义')
else if (!/Object\.assign\(status, patch\)/.test(setStatusFn[1])) {
  bad('setStatus 不再是 Object.assign 部分合并，本门禁的前提需重新评估')
} else {
  ok('setStatus 为部分合并（漏传字段会保留旧值，必须每分支都传全）')
}

// ---- 2. syncNow 内所有 setStatus 都要带 pending 与 conflicts ----
const syncNowBody = src.match(/export async function syncNow\(\)[\s\S]*?\n\}/)
if (!syncNowBody) bad('未找到 syncNow 定义')
else {
  const calls = [...syncNowBody[0].matchAll(/setStatus\(\{([\s\S]*?)\n\s*\}\)/g)].map((m) => m[1])
  if (calls.length === 0) bad('syncNow 内未找到 setStatus 调用')
  else {
    ok(`syncNow 内共 ${calls.length} 处 setStatus`)
    calls.forEach((body, i) => {
      const hasPending = /\bpending\s*:/.test(body)
      const hasConflicts = /\bconflicts\s*:/.test(body)
      if (hasPending && hasConflicts) ok(`第 ${i + 1} 处带上 pending 与 conflicts`)
      else bad(`第 ${i + 1} 处缺少 ${[!hasPending && 'pending', !hasConflicts && 'conflicts'].filter(Boolean).join(' / ')}`)
    })
  }
}

// ---- 3. 顶栏必须在有冲突时醒目并直达裁决入口 ----
const shell = readFileSync(join(root, 'src', 'components', 'layout', 'AppShell.vue'), 'utf8')
if (!/hasConflicts/.test(shell)) bad('AppShell.vue 未使用 hasConflicts（冲突不会在顶栏醒目提示）')
else ok('顶栏按 conflicts 计算 hasConflicts')
if (!/openSettings\(hasConflicts\.value \? 'cloud'/.test(shell)) {
  bad('顶栏冲突时未直达云同步页')
} else {
  ok('冲突时点击直达云同步页（裁决入口）')
}
if (!/\.sync-chip\.conflict/.test(shell)) bad('缺少 .sync-chip.conflict 警示样式')
else ok('冲突态有独立警示样式')

console.log(failed ? `\n同步状态门禁失败：${failed} 项` : '\n同步状态门禁通过')
process.exit(failed ? 1 : 0)
