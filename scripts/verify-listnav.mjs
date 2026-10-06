/**
 * useListNav 行为验证（在 Node 里用最小 DOM 替身跑，不依赖浏览器）。
 *
 * 覆盖它最容易回归的三件事：
 *   1. 容器重建后（Tab 切走再切回）方向键还能不能用——这是子代理接入时
 *      实测出来的坑：监听器绑在旧节点上就失效了。
 *   2. 行数变少（搜索过滤）后 cursor 会不会停在已消失的行上。
 *   3. 方向键的边界：首行往上、末行往下、空列表，都不应越界。
 */
import { installDomStub } from './stub-dom.mjs'

const dom = installDomStub()
const { useListNav } = await import('../src/composables/useListNav.ts')

let pass = 0, fail = 0
function check(name, cond, extra = '') {
  if (cond) { console.log('  \u2714 ' + name); pass++ }
  else { console.log('  \u2718 ' + name + (extra ? ' -> ' + extra : '')); fail++ }
}

/** 造一个含 n 行的容器 */
function makeContainer(n, prefix = 'row') {
  const el = dom.createElement('div')
  for (let i = 0; i < n; i++) {
    const row = dom.createElement('div')
    row.className = 'r'
    row.setAttribute('data-row-id', String(i + 1))
    row.textContent = prefix + i
    el.appendChild(row)
  }
  return el
}

console.log('\n[1] 方向键移动与边界')
{
  const el = makeContainer(5)
  const ref = { value: el }
  const nav = useListNav(ref, { rowSelector: '.r' })

  nav.move(1)
  check('首次向下选中第 0 行', nav.cursor.value === 0, 'cursor=' + nav.cursor.value)
  check('第 0 行打上属性', el.children[0].getAttribute('data-wb-cursor') === 'true')

  nav.move(1)
  check('再向下到第 1 行', nav.cursor.value === 1)
  check('旧行高亮已移除', el.children[0].getAttribute('data-wb-cursor') === null)

  nav.move(1); nav.move(1); nav.move(1)
  check('到末行第 4 行', nav.cursor.value === 4)
  nav.move(1)
  check('末行再向下不越界', nav.cursor.value === 4)

  nav.move(-1)
  check('向上回到第 3 行', nav.cursor.value === 3)
  for (let i = 0; i < 10; i++) nav.move(-1)
  check('首行再向上停在 0', nav.cursor.value === 0)

  nav.jumpToEdge(false)
  check('End 跳到末行', nav.cursor.value === 4)
  nav.jumpToEdge(true)
  check('Home 跳到首行', nav.cursor.value === 0)
}

console.log('\n[2] 空列表不炸')
{
  const el = makeContainer(0)
  const ref = { value: el }
  const nav = useListNav(ref, { rowSelector: '.r' })
  nav.move(1)
  check('空列表移动后 cursor=-1', nav.cursor.value === -1)
  nav.jumpToEdge(true)
  check('空列表 Home 不炸', nav.cursor.value === -1)
}

console.log('\n[3] 行数变少后 cursor 自动夹回（搜索过滤场景）')
{
  const el = makeContainer(10)
  const ref = { value: el }
  const nav = useListNav(ref, { rowSelector: '.r' })
  nav.move(1); nav.move(1); nav.move(1); nav.move(1); nav.move(1)
  nav.move(1); nav.move(1); nav.move(1); nav.move(1); nav.move(1)
  check('已到第 9 行', nav.cursor.value === 9, 'cursor=' + nav.cursor.value)

  // 模拟搜索过滤：删到只剩 3 行
  while (el.children.length > 3) el.removeChild(el.lastChild)
  // MutationObserver 在 stub 里是同步触发的
  dom.flushMutations()
  nav.clamp()
  check('行数骤减后 cursor 夹回最后一行(2)', nav.cursor.value === 2, 'cursor=' + nav.cursor.value)
}

console.log('\n[4] 容器重建（Tab 切走再切回）后仍能工作')
{
  const el1 = makeContainer(4)
  const ref = { value: el1 }
  const nav = useListNav(ref, { rowSelector: '.r' })
  nav.move(1)
  check('旧容器上可用', nav.cursor.value === 0)

  // 容器换成新节点
  const el2 = makeContainer(6)
  ref.value = el2
  await new Promise((r) => setTimeout(r, 0)) // 等 watch flush
  nav.move(1)
  check('新容器上移动正常', nav.cursor.value === 0, 'cursor=' + nav.cursor.value)
  check('新容器第 0 行有高亮', el2.children[0].getAttribute('data-wb-cursor') === 'true')
}

console.log(`\n\u2714 通过 ${pass} / \u2718 失败 ${fail}\n`)
process.exit(fail ? 1 : 0)
