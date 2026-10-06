/**
 * useListNav 行为验证（在 Node 里用最小 DOM 替身跑，不依赖浏览器）。
 *
 * 覆盖它最容易回归的三件事：
 *   1. 容器重建后（Tab 切走再切回）方向键还能不能用——这是子代理接入时
 *      实测出来的坑：监听器绑在旧节点上就失效了。
 *   2. 行数变少（搜索过滤）后 cursor 会不会停在已消失的行上。
 *   3. 方向键的边界：首行往上、末行往下、空列表，都不应越界。
 *   4. items/onEnterItem 免回查路径：拿到的数据对象与下标要对得上，
 *      越界要静默，且不能破坏旧写法（onEnter 第一个参数仍是 DOM 元素）。
 */
import { installDomStub, mount, unmountAll } from './stub-dom.mjs'

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

console.log('\n[5] items + onEnterItem：直接拿到数据对象，不用回查 DOM')
await (async () => {
  const el = makeContainer(3)
  const ref = { value: el }
  // DOM 行顺序与 items 严格一致（都是过滤后的结果）：id 打乱，验证按下标取而非按 id
  const items = [{ id: 30, name: 'c' }, { id: 10, name: 'a' }, { id: 20, name: 'b' }]
  const got = []
  // 必须走真实组件挂载：否则 onMounted 被丢弃，window 上根本没有 keydown 监听
  const nav = await mount(() => useListNav(ref, {
    rowSelector: '.r',
    items: () => items,
    onEnterItem: (item, index, rowEl) => got.push({ item, index, rowEl }),
  }))
  nav.move(1); nav.move(1) // cursor -> 1
  const prevented = dom.press('Enter', el)
  check('Enter 被接管（preventDefault）', prevented === true)
  check('onEnterItem 触发 1 次', got.length === 1, 'n=' + got.length)
  check('拿到的是 items[1]（按 DOM 顺序，不是按 id）', got[0] && got[0].item === items[1])
  check('index 与 cursor 一致', got[0] && got[0].index === 1, 'index=' + (got[0] && got[0].index))
  check('第三个参数仍是 DOM 元素', got[0] && got[0].rowEl === el.children[1])
  // 每个 Enter 用例结束即卸载：window 上的 keydown 监听是全局的，
  // 不清会把 press() 同时打到上一个用例的导航实例上
  unmountAll()
})()

console.log('\n[6] items 版的下标越界与兼容')
await (async () => {
  // 6a: items 行数少于 DOM 行数（过滤瞬间的错位帧）→ 静默不触发，不传错行
  const el = makeContainer(5)
  const ref = { value: el }
  const short = [{ id: 1 }, { id: 2 }]
  let itemCalls = 0, domCalls = 0
  const nav = await mount(() => useListNav(ref, {
    rowSelector: '.r',
    items: () => short,
    onEnterItem: () => { itemCalls++ },
  }))
  nav.move(1); nav.move(1); nav.move(1); nav.move(1) // cursor -> 3，short[3] 不存在
  const prevented = dom.press('Enter', el)
  check('items 越界时不触发 onEnterItem', itemCalls === 0, 'n=' + itemCalls)
  check('items 越界时不 preventDefault（交给浏览器）', prevented === false)
  unmountAll()

  // 6b: 只传 onEnterItem 但没传 items → 没有数据来源，绝不能拿 DOM 元素冒充数据对象
  const el2 = makeContainer(2)
  const ref2 = { value: el2 }
  let badCalls = 0, fallbackCalls = 0
  const nav2 = await mount(() => useListNav(ref2, {
    rowSelector: '.r',
    onEnterItem: () => { badCalls++ },
    onEnter: () => { fallbackCalls++ },
  }))
  nav2.move(1)
  dom.press('Enter', el2)
  check('没传 items 时不走 onEnterItem（避免把 DOM 当数据）', badCalls === 0, 'n=' + badCalls)
  check('没传 items 时回退到 onEnter', fallbackCalls === 1, 'n=' + fallbackCalls)
  unmountAll()

  // 6c: 旧写法（只有 onEnter）第一个参数必须仍是 DOM 元素
  const el3 = makeContainer(3)
  const ref3 = { value: el3 }
  let first = null
  const nav3 = await mount(() => useListNav(ref3, {
    rowSelector: '.r',
    onEnter: (e, i) => { if (!first) first = { e, i } },
  }))
  nav3.move(1); nav3.move(1) // cursor -> 1
  dom.press('Enter', el3)
  check('旧写法 onEnter 第一个参数是 DOM 元素', first && first.e === el3.children[1])
  check('旧写法 index 正确', first && first.i === 1)
  unmountAll()

  // 6d: items 是 ref 形式（视图里最常见的 { value: [...] }）
  const el4 = makeContainer(2)
  const ref4 = { value: el4 }
  const itemsRef = { value: [{ id: 7 }] }
  let refItem = null
  const nav4 = await mount(() => useListNav(ref4, {
    rowSelector: '.r',
    items: itemsRef,
    onEnterItem: (it) => { refItem = it },
  }))
  nav4.move(1)
  dom.press('Enter', el4)
  check('items 为 ref 时取值正确', refItem === itemsRef.value[0])
  // 清掉挂在 window 上的 keydown 监听，避免泄漏到后续用例
  unmountAll()
  const leaked = dom.press('Enter', el4)
  check('卸载后监听已摘除（不泄漏到下一个用例）', leaked === false)
})()

console.log(`\n\u2714 通过 ${pass} / \u2718 失败 ${fail}\n`)
process.exit(fail ? 1 : 0)
