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

export function installDomStub() {
  const root = new StubNode('div')
  const active = { el: null }

  const doc = {
    activeElement: null,
    createElement: (t) => new StubNode(t),
    addEventListener: () => {},
    removeEventListener: () => {},
  }
  globalThis.document = doc
  globalThis.window = {
    addEventListener: () => {},
    removeEventListener: () => {},
    matchMedia: () => ({ matches: false, addEventListener: () => {} }),
  }
  globalThis.MutationObserver = StubMutationObserver

  return {
    createElement: (t) => new StubNode(t),
    /** 触发所有注册的 observer 回调（同步模拟一帧变更） */
    flushMutations() { for (const o of [...observers]) o.cb() },
    root,
    setActive(el) { doc.activeElement = el },
  }
}
