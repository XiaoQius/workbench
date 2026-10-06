/**
 * 撤销机制门禁：只保留最近一次 + 自动过期 + 撤销后清空。
 * 撤销是「删错了能救回来」的最后一道防线，过期/残留都会误导用户。
 */
let pass = 0, fail = 0
function ok(name, cond) {
  if (cond) { pass++; console.log('  \u2714 ' + name) }
  else { fail++; console.log('  \u2718 ' + name) }
}
function group(t) { console.log('\n[' + t + ']') }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const mod = await import('../src/composables/useUndo.ts')
const useUndo = mod.useUndo

group('1 推入与撤销')
{
  const u = useUndo()
  let undone = false
  ok('初始无可撤销项', u.pending.value === null)
  u.push({ label: '已删除 3 条任务', undo: () => { undone = true } })
  ok('推入后 pending 有值', u.pending.value !== null && u.pending.value.label === '已删除 3 条任务')
  const r = await u.undo()
  ok('undo 返回 true', r === true)
  ok('撤销回调被执行', undone === true)
  ok('撤销后 pending 清空', u.pending.value === null)
}

group('2 只保留最近一次（不是栈）')
{
  const u = useUndo()
  const calls = []
  u.push({ label: 'A', undo: () => calls.push('A') })
  u.push({ label: 'B', undo: () => calls.push('B') })
  ok('pending 是后推入的 B', u.pending.value.label === 'B')
  await u.undo()
  ok('只撤销最近一次', calls.join(',') === 'B')
}

group('3 自动过期')
{
  const u = useUndo()
  u.push({ label: '临时', undo: () => {} }, 300)
  ok('未过期时可见', u.pending.value !== null)
  await sleep(500)
  ok('过期后自动清空', u.pending.value === null)
}

group('4 过期后再撤销不误触发')
{
  const u = useUndo()
  let fired = false
  u.push({ label: '已过期', undo: () => { fired = true } }, 200)
  await sleep(400)
  const r = await u.undo()
  ok('无可撤销项时 undo 返回 false', r === false)
  ok('过期的回调不会被执行', fired === false)
}

group('5 dismiss 手动关闭')
{
  const u = useUndo()
  u.push({ label: 'x', undo: () => {} })
  u.dismiss()
  ok('dismiss 后清空', u.pending.value === null)
}

group('6 撤销回调抛错时安全返回 false')
{
  const u = useUndo()
  u.push({ label: '会抛错', undo: () => { throw new Error('boom') } })
  const r = await u.undo()
  ok('抛错时返回 false', r === false)
  ok('抛错后 pending 仍被清空', u.pending.value === null)
}

group('7 新推入会重置旧计时器')
{
  const u = useUndo()
  u.push({ label: 'first', undo: () => {} }, 300)
  await sleep(200)
  u.push({ label: 'second', undo: () => {} }, 300)
  await sleep(200)
  ok('第二次推入后 200ms 仍可见（旧计时器已被清）', u.pending.value !== null && u.pending.value.label === 'second')
  await sleep(250)
  ok('再过 250ms 后过期', u.pending.value === null)
}

console.log('\n\u2714 通过 ' + pass + ' / \u2718 失败 ' + fail)
process.exit(fail === 0 ? 0 : 1)
