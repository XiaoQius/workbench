import { computed, ref, watch, type Ref } from 'vue'

/**
 * 列表批量选择的通用逻辑（纯逻辑层，不碰视图）。
 *
 * 背景：Dev/Study/Life 三张列表各自要做「批量删除 / 批量改状态」，
 * 如果每个视图自己维护一套 `Set<number>`，就会重复踩同一个坑：
 * 过滤或重新 load 之后，已选中但已不在列表里的 id 还留在集合里，
 * 批量删除时把「看不见的行」一起删掉。这里收口为一份实现。
 *
 * 约定：
 * - 传入的 items 是**当前可见**的数据源（过滤/翻页后的结果），不是全量；
 *   `toggleAll()` 只作用于它。
 * - 数据源变化时自动剔除失效 id（prune），保证「选中的一定是看得见的」。
 * - 内部用 Set<number>，isSelected / toggle 都是 O(1)。
 */
export function useBatchSelect<T extends { id: number }>(items: Ref<T[]> | (() => T[])) {
  const read = (): T[] => (typeof items === 'function' ? items() : items.value)
  const selectedIds = ref<Set<number>>(new Set())

  /** 数据源变化（过滤 / 翻页 / 重新 load）时剔除已不在列表里的 id */
  function prune() {
    const alive = new Set(read().map((i) => i.id))
    let dirty = false
    const next = new Set<number>()
    for (const id of selectedIds.value) {
      if (alive.has(id)) next.add(id)
      else dirty = true
    }
    if (dirty) selectedIds.value = next
  }

  watch(
    () => read().map((i) => i.id).join(','),
    () => prune(),
    { flush: 'post' },
  )

  const selected = computed<T[]>(() => read().filter((i) => selectedIds.value.has(i.id)))
  const count = computed(() => selectedIds.value.size)
  const active = computed(() => count.value > 0)
  const allChecked = computed(() => {
    const n = read().length
    return n > 0 && count.value === n
  })
  const someChecked = computed(() => count.value > 0 && !allChecked.value)

  function toggle(id: number) {
    const next = new Set(selectedIds.value)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    selectedIds.value = next
  }

  /** 全选 / 反选：只作用于当前过滤后的 items */
  function toggleAll() {
    const list = read()
    if (allChecked.value) {
      selectedIds.value = new Set()
      return
    }
    selectedIds.value = new Set(list.map((i) => i.id))
  }

  function clear() {
    if (selectedIds.value.size) selectedIds.value = new Set()
  }

  function isSelected(id: number): boolean {
    return selectedIds.value.has(id)
  }

  return {
    selectedIds,
    selected,
    count,
    active,
    allChecked,
    someChecked,
    toggle,
    toggleAll,
    clear,
    isSelected,
    prune,
  }
}
