import { onMounted, onUnmounted, ref, watch, type Ref } from 'vue'

/**
 * 列表键盘导航（↑↓ 移动 / Enter 打开 / Home-End 首尾）。
 *
 * 背景：此前所有列表只能鼠标点、或用 Tab 一个个跳（几十行的表要点几十次 Tab）。
 * 这里做成容器无关的通用实现：给容器加一个 ref + 告诉它「哪些元素算行」，
 * 由本函数统一管理高亮索引与滚动定位，视图侧只需：
 *
 *   const listRef = ref<HTMLElement>()
 *   useListNav(listRef, { rowSelector: '.d-row:not(.head)', onEnter: open })
 *
 * 三个约定：
 *  1. 只在元素自身获得焦点或鼠标悬停在容器内时接管方向键，
 *     避免抢走页面其它地方的方向键（比如滚动、输入框光标）。
 *  2. 高亮态用 data-wb-cursor 属性，样式由 main.css 统一提供（.wb-nav-row），
 *     不在 JS 里写死颜色，跟着主题走。
 *  3. 数据源变化时（过滤/翻页）索引可能越界，自动夹回范围内。
 */
export interface ListNavOptions {
  /** 行选择器，相对于容器；必须能排除表头（表头一般带 .head） */
  rowSelector: string
  /** 回车回调：拿到当前行的 DOM 元素与索引，由视图决定做什么（打开详情/编辑） */
  onEnter?: (el: HTMLElement, index: number) => void
  /** 是否启用（例如加载中禁用） */
  enabled?: Ref<boolean> | (() => boolean)
}

const CURSOR_ATTR = 'data-wb-cursor'

function isEditableTarget(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

export function useListNav(containerRef: Ref<HTMLElement | undefined>, opts: ListNavOptions) {
  const cursor = ref(-1)

  /** 行数快照，用于 watch 感知数据源变化 */
  const rowCount = ref(0)

  // 容器子树增删（过滤/翻页）用 MutationObserver 观察最可靠：
  // 数据源是自己传进来的外部 ref，本函数拿不到，无法直接 watch 它。
  let observer: MutationObserver | null = null
  /** 当前正在观察的容器节点，用于识别容器是否被换掉 */
  let observedEl: HTMLElement | null = null

  /**
   * 观察容器子树的增删。
   * 数据源是视图传进来的外部 ref，本函数拿不到，没法直接 watch 它；
   * 而「行数变了」这件事最终一定会反映到 DOM 上，所以观察 DOM 最可靠。
   * 行数变化时立即修正越界 cursor 并重绘，不必等下次按键。
   */
  function observeRows() {
    const root = containerRef.value
    if (!root || typeof MutationObserver === 'undefined') return
    observer?.disconnect()
    observer = new MutationObserver(() => {
      const next = rows().length
      if (next !== rowCount.value) {
        rowCount.value = next
        clamp()
        paint()
      }
    })
    observer.observe(root, { childList: true, subtree: true })
  }

  /**
   * 惰性续订：容器换了节点（v-if 重建）时重置状态并重挂观察。
   * 放在 rows() 里被调用而不是只靠 watch —— 因为 watch 依赖 Vue 的
   * 调度时机，而这是纯 DOM 层面的不变式，每次取行数前先看一眼更稳。
   */
  function ensureObserving() {
    const root = containerRef.value
    if (!root) return
    if (observedEl === root) return
    // 容器换成新节点：旧索引不再对应任何东西，必须重置，
    // 否则「切走 Tab 再切回」第一次按方向键会从残留旧索引继续。
    observedEl = root
    cursor.value = -1
    rowCount.value = Array.from(root.querySelectorAll<HTMLElement>(opts.rowSelector)).length
    observeRows()
  }

  function rows(): HTMLElement[] {
    const root = containerRef.value
    if (!root) return []
    ensureObserving()
    return Array.from(root.querySelectorAll<HTMLElement>(opts.rowSelector))
  }

  function isEnabled(): boolean {
    if (typeof opts.enabled === 'function') return opts.enabled()
    if (opts.enabled && typeof opts.enabled === 'object' && 'value' in opts.enabled) {
      return opts.enabled.value !== false
    }
    return true
  }

  /** 清除所有行的高亮态并从新画当前 cursor */
  function paint() {
    const list = rows()
    list.forEach((el) => el.removeAttribute(CURSOR_ATTR))
    const cur = list[cursor.value]
    if (cur) {
      cur.setAttribute(CURSOR_ATTR, 'true')
      // 键盘移动时把行滚进视野：block:'nearest' 避免整页跳动
      cur.scrollIntoView({ block: 'nearest' })
    }
  }

  function clear() {
    rows().forEach((el) => el.removeAttribute(CURSOR_ATTR))
    cursor.value = -1
  }

  /** 数据变化后调用（或由本函数自动感知）——把越界索引夹回来 */
  function clamp() {
    const len = rows().length
    if (len === 0) {
      cursor.value = -1
      return
    }
    if (cursor.value >= len) cursor.value = len - 1
    if (cursor.value < 0) cursor.value = -1
  }

  function move(delta: number) {
    const len = rows().length
    if (!len) return
    clamp()
    // 还没进入列表时：向下从第一行开始，向上从最后一行开始
    if (cursor.value === -1) {
      cursor.value = delta > 0 ? 0 : len - 1
    } else {
      cursor.value = Math.min(len - 1, Math.max(0, cursor.value + delta))
    }
    paint()
  }

  function jumpToEdge(toFirst: boolean) {
    const len = rows().length
    if (!len) return
    cursor.value = toFirst ? 0 : len - 1
    paint()
  }

  function onKeydown(e: KeyboardEvent) {
    if (!isEnabled() || isEditableTarget(e)) return
    const root = containerRef.value
    if (!root) return
    // 只有当焦点在容器内、或鼠标正悬停在容器内时才接管方向键
    const active = document.activeElement
    const inside = root.contains(active) || root.matches(':hover')
    if (!inside) return

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        move(1)
        break
      case 'ArrowUp':
        e.preventDefault()
        move(-1)
        break
      case 'Home':
        e.preventDefault()
        jumpToEdge(true)
        break
      case 'End':
        e.preventDefault()
        jumpToEdge(false)
        break
      case 'Enter': {
        const list = rows()
        const cur = list[cursor.value]
        if (cur && opts.onEnter) {
          e.preventDefault()
          opts.onEnter(cur, cursor.value)
        }
        break
      }
      case 'Escape':
        clear()
        break
    }
  }

  // Tab 焦点进入容器时给个初始高亮，让键盘用户知道自己在哪
  function onFocusIn() {
    if (cursor.value === -1 && rows().length) {
      cursor.value = 0
      paint()
    }
  }

  // 容器常在 Tab / 分支切换时被 v-if 销毁重建（换了一批 DOM 节点）。
  // 监听器若只在 onMounted 绑一次，重建后 focusin 就绑在已废弃的旧节点上，
  // 表现为「切走再切回来后方向键失灵」。
  // 这里改为把 focusin 绑到 document 上做委托，命中容器内部时才响应——
  // 好处是容器换节点不影响，代价是每次焦点变动都会走一次 contains 判断（可忽略）。
  function onDocFocusIn() {
    const root = containerRef.value
    if (!root) return
    const active = document.activeElement
    if (root.contains(active)) onFocusIn()
  }

  onMounted(() => {
    window.addEventListener('keydown', onKeydown)
    document.addEventListener('focusin', onDocFocusIn)
  })

  // 容器被 v-if 重建时（切换 Tab）容器 ref 指向新节点，需重新挂观察
  onMounted(() => {
    // 首次挂载时容器可能还没渲染（v-else-if 的数据区），
    // 这里先尝试挂一次，真正的续订由 ensureObserving 在每次取行时兜底。
    ensureObserving()
  })

  onUnmounted(() => {
    window.removeEventListener('keydown', onKeydown)
    document.removeEventListener('focusin', onDocFocusIn)
    observer?.disconnect()
    observer = null
  })

  return { cursor, move, clear, paint, clamp, jumpToEdge }
}
