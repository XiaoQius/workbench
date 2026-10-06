/**
 * 极简 DOM 替身，给 useListNav 的门禁脚本用。
 *
 * 只实现 useListNav 真正用到的那几个 API：元素树、class/id 查询、
 * 属性读写、MutationObserver（同步帧）与 window/document 事件。
 * 刻意不引入 jsdom —— 那会为了跑一个 200 行的纯逻辑文件拉进整个依赖树。
 */

class StubClassList {
  constructor(el) { this.el = el }
  contains(c) { return (this.el.className || '').split(/\s+/).includes(c) }
}

class StubNode {
  constructor(tag) {
    this.tagName = String(tag || 'div').toUpperCase()
    this.children = []
    this.parentNode = null
    this.attributes = {}
    this.className = ''
    this.textContent = ''
    this._classList = new StubClassList(this)
    this.listeners = {}
  }
  get classList() { return this._classList }
  get lastChild() { return this.children[this.children.length - 1] || null }
  appendChild(c) { c.parentNode = this; this.children.push(c); notify(); return c }
  removeChild(c) {
    const i = this.children.indexOf(c)
    if (i >= 0) this.children.splice(i, 1)
    c.parentNode = null
    notify()
    return c
  }
  setAttribute(k, v) { this.attributes[k] = String(v) }
  getAttribute(k) { return k in this.attributes ? this.attributes[k] : null }
  removeAttribute(k) { delete this.attributes[k] }
  /** querySelectorAll：支持 CSS 类与 :not(.head) 这两类 useListNav 会用到的语法 */
  querySelectorAll(sel) {
    const out = []
    const walk = (node) => {
      for (const c of node.children) { if (matches(c, sel)) out.push(c); walk(c) }
    }
    walk(this)
    return out
  }
  get isContentEditable() { return false }
  matches(sel) { return matches(this, sel) }
  contains(n) {
    if (n === this) return true
    return this.children.some((c) => c.contains(n))
  }
  addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn) }
  removeEventListener(t, fn) {
    const arr = this.listeners[t]
    if (arr) this.listeners[t] = arr.filter((f) => f !== fn)
  }
  scrollIntoView() { /* no-op */ }
}

/** 解析 '.cls'、'.cls:not(.x)' 这类选择器 */
function matches(el, sel) {
  const parts = sel.split(':').filter(Boolean)
  const clsPart = parts[0] || ''
  const cls = clsPart.startsWith('.') ? clsPart.slice(1) : ''
  if (cls && !el.classList.contains(cls)) return false
  for (const p of parts.slice(1)) {
    const neg = /^not\((.*)\)$/.exec(p)
    if (neg) {
      const inner = neg[1].trim()
      if (matches(el, inner)) return false
    }
  }
  return true
}

// ---- MutationObserver：注册回调，由 flushMutations 同步触发 ----
const observers = new Set()
function notify() {
  for (const o of observers) { /* 收集，flush 时统一触发 */ }
}

class StubMutationObserver {
  constructor(cb) { this.cb = cb; observers.add(this) }
  observe() { /* no-op：任何 appendChild/removeChild 后由 flushMutations 触发 */ }
  disconnect() { observers.delete(this) }
}

/**
 * 在真实的 Vue 组件实例里调用 fn，让里面的 onMounted/onUnmounted 真的注册并执行。
 *
 * 背景：直接在模块作用域调用 useListNav 时，Vue 会警告
 * "onMounted is called when there is no active component instance"，
 * 回调被丢弃 → window 上根本没有 keydown 监听 → 没法测 Enter 的回调
 * （move/clamp 这类纯逻辑不依赖生命周期，所以老断言一直没问题）。
 * 这里用 vue 的自定义 renderer 挂一个空组件：只需要 createRenderer + 一套
 * 什么都不做的 nodeOps（不渲染任何东西），比拉 jsdom 轻得多。
 */
/** 已挂载的 app 实例，供 unmountAll 清理（避免上一个用例的监听泄漏到下一个） */
const mountedApps = new Set()

export async function mount(fn) {
  const { createRenderer, defineComponent, h } = await import('vue')
  const nodeOps = {
    createElement: (tag) => new StubNode(tag),
    createText: (t) => ({ text: t }),
    createComment: () => ({ comment: '' }),
    setText: () => {},
    setElementText: () => {},
    insert: (c, p) => { if (p && p.children) { c.parentNode = p; p.children.push(c) } },
    remove: () => {},
    parentNode: (n) => n.parentNode || null,
    nextSibling: () => null,
    patchProp: () => {},
  }
  const { createApp } = createRenderer(nodeOps)
  let result
  const Comp = defineComponent({
    setup() { result = fn(); return () => h('div') },
  })
  const app = createApp(Comp)
  app.mount(new StubNode('div'))
  mountedApps.add(app)
  return result
}

/**
 * 卸载所有 mount() 起来的组件，触发它们的 onUnmounted。
 * useListNav 在 onUnmounted 里摘掉 window 上的 keydown 监听——不摘的话
 * 上一个用例的导航实例还挂着，press() 会同时打到它身上，断言互相污染。
 */
export function unmountAll() {
  for (const app of [...mountedApps]) app.unmount()
  mountedApps.clear()
}

export function installDomStub() {
  const root = new StubNode('div')
  const active = { el: null }
  /** window 上的 keydown 监听（useListNav 绑在这里），供 press() 驱动 */
  const winListeners = {}

  const doc = {
    activeElement: null,
    createElement: (t) => new StubNode(t),
    addEventListener: () => {},
    removeEventListener: () => {},
  }
  globalThis.document = doc
  globalThis.window = {
    addEventListener: (t, fn) => { (winListeners[t] ||= []).push(fn) },
    removeEventListener: (t, fn) => {
      const arr = winListeners[t]
      if (arr) winListeners[t] = arr.filter((f) => f !== fn)
    },
    matchMedia: () => ({ matches: false, addEventListener: () => {} }),
  }
  globalThis.MutationObserver = StubMutationObserver

  return {
    createElement: (t) => new StubNode(t),
    /** 让 onMounted 真的跑起来，用于测键事件路径（见上面的 mount） */
    mount,
    /** 触发所有注册的 observer 回调（同步模拟一帧变更） */
    flushMutations() { for (const o of [...observers]) o.cb() },
    /** 派发一次键盘事件到 window 上的 keydown 监听，返回是否被调用 preventDefault */
    press(key, target = null) {
      let prevented = false
      // 真实浏览器里 keydown 的 target 就是当前焦点元素，
      // 而 useListNav 用 document.activeElement 判断「焦点是否在容器内」——两者要一致
      if (target) doc.activeElement = target
      const ev = {
        key,
        target,
        preventDefault() { prevented = true },
      }
      for (const fn of [...(winListeners.keydown || [])]) fn(ev)
      return prevented
    },
    root,
    setActive(el) { doc.activeElement = el },
  }
}
