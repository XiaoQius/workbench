/**
 * 批量选择门禁：验证「选中的一定是看得见的」这条防误删不变式。
 * 浏览器里手测几十条数据成本高且难复现，这里用真实 composable 跑断言。
 */
import { ref, nextTick } from 'vue'

let pass = 0
let fail = 0
function ok(name, cond) {
  if (cond) { pass++; console.log('  \u2714 ' + name) }
  else { fail++; console.log('  \u2718 ' + name) }
}
function group(t) { console.log('\n[' + t + ']') }

const { useBatchSelect } = await import('../src/composables/useBatchSelect.ts')

function makeSel(initial) {
  const items = ref(initial)
  return { items, sel: useBatchSelect(items) }
}

// ---- 1 基本选择 ----
group('1 单选 / 取消 / 计数')
{
  const { sel } = makeSel([{ id: 1 }, { id: 2 }, { id: 3 }])
  ok('初始未选中', sel.count.value === 0 && sel.active.value === false)
  sel.toggle(2)
  ok('选中 1 项', sel.count.value === 1 && sel.isSelected(2))
  sel.toggle(2)
  ok('再点取消', sel.count.value === 0 && !sel.isSelected(2))
}

// ---- 2 全选 / 半选 ----
group('2 全选与 indeterminate 半选')
{
  const { sel } = makeSel([{ id: 1 }, { id: 2 }, { id: 3 }])
  sel.toggleAll()
  ok('全选后 allChecked', sel.allChecked.value === true && sel.count.value === 3)
  ok('全选时非半选', sel.someChecked.value === false)
  sel.toggle(2)
  ok('取消一项后变半选', sel.someChecked.value === true && sel.allChecked.value === false)
  sel.toggleAll()
  ok('半选态点全选 -> 全选', sel.allChecked.value === true)
  sel.toggleAll()
  ok('已全选再点 -> 全不选', sel.count.value === 0)
}

// ---- 3 核心：过滤后失效 id 自动剔除（防误删）----
group('3 数据源变化自动剔除失效 id（防误删关键）')
{
  const { items, sel } = makeSel([{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }])
  sel.toggleAll()
  ok('先全选 5 项', sel.count.value === 5)
  items.value = [{ id: 2 }, { id: 5 }]
  await nextTick()
  await nextTick()
  ok('过滤后只剩仍可见的 2 项', sel.count.value === 2)
  ok('已被过滤掉的 id=1 不再选中', !sel.isSelected(1))
  ok('仍可见的 id=2 保持选中', sel.isSelected(2))
  ok('selected 只含可见项', sel.selected.value.map((i) => i.id).join(',') === '2,5')
}

// ---- 4 清空 ----
group('4 clear 清空')
{
  const { sel } = makeSel([{ id: 1 }, { id: 2 }])
  sel.toggle(1); sel.toggle(2)
  ok('选了 2 项', sel.count.value === 2)
  sel.clear()
  ok('clear 后归零', sel.count.value === 0 && sel.active.value === false)
}

// ---- 5 空列表边界 ----
group('5 空列表边界')
{
  const { sel } = makeSel([])
  ok('空列表 allChecked=false', sel.allChecked.value === false)
  sel.toggleAll()
  ok('空列表点全选不炸', sel.count.value === 0)
}

// ---- 6 selected 顺序与数据源一致 ----
group('6 selected 顺序跟随数据源')
{
  const { sel } = makeSel([{ id: 3 }, { id: 1 }, { id: 2 }])
  sel.toggleAll()
  ok('selected 顺序 = 数据源顺序', sel.selected.value.map((i) => i.id).join(',') === '3,1,2')
}

// ---- 7 getter 形式 ----
group('7 items 支持 getter 形式')
{
  const src = ref([{ id: 7 }, { id: 8 }])
  const sel = useBatchSelect(() => src.value)
  sel.toggleAll()
  ok('getter 形式全选', sel.count.value === 2)
  src.value = [{ id: 7 }]
  await nextTick(); await nextTick()
  ok('getter 形式也能剔除失效 id', sel.count.value === 1 && sel.isSelected(7))
}

console.log('\n\u2714 通过 ' + pass + ' / \u2718 失败 ' + fail)
process.exit(fail === 0 ? 0 : 1)
