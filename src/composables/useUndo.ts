import { getCurrentScope, onScopeDispose, ref } from 'vue'

/** 一次可撤销操作：只知道怎么把自己撤销掉，其余一概不关心 */
export interface UndoEntry {
  /** 提示文案，如「已删除 3 条任务」 */
  label: string
  /** 撤销动作。抛错即视为撤销失败，由调用方决定怎么提示 */
  undo: () => Promise<void> | void
}

/**
 * 轻量撤销：**只保留最近一次**可撤销操作（不是栈）。
 *
 * 为什么不是栈：全量 undo 栈要维护快照一致性（跨视图跳转、同步冲突回滚、
 * 数据被别处改过），语义风险远大于收益。删错东西立刻能撤回，
 * 是性价比最高的那部分人性化，只做这一点。
 *
 * 用法：
 *   const { push } = appUndo
 *   await tasksRepo.remove(id)
 *   push({ label: `已删除「${name}」`, undo: () => tasksRepo.insert(snapshot) })
 *
 * 注意调用顺序：请先把要恢复的**数据快照**取出来再删，
 * 别指望撤销回调里还能查到已删除的行。
 */
export function useUndo() {
  const pending = ref<UndoEntry | null>(null)
  let timer: ReturnType<typeof setTimeout> | undefined

  function clearTimer() {
    if (timer !== undefined) {
      clearTimeout(timer)
      timer = undefined
    }
  }

  /** 手动关掉提示（用户点了关闭 / 路由切换） */
  function dismiss() {
    clearTimer()
    pending.value = null
  }

  /**
   * 推入一次可撤销操作，并在 N 毫秒后自动过期。
   * 后推入的会顶掉前一个：同一个删除动作连续发生时，
   * 保留最近一次比留着一堆过期又不准确的入口更诚实。
   */
  function push(entry: UndoEntry, timeoutMs = 8000) {
    clearTimer()
    pending.value = entry
    timer = setTimeout(() => {
      timer = undefined
      pending.value = null
    }, timeoutMs)
  }

  /**
   * 执行撤销并清空。
   * @returns 成功 true；无可撤销项或撤销动作抛错时 false（提示交给调用方出）
   */
  async function undo(): Promise<boolean> {
    const entry = pending.value
    if (!entry) return false
    // 先清状态再执行：撤销回调里如果又推入新提示也不会被自己覆盖
    clearTimer()
    pending.value = null
    try {
      await entry.undo()
      return true
    } catch (e) {
      console.error('[WORKBENCH] 撤销失败:', e)
      return false
    }
  }

  // 组件内使用（useUndo()）时随 scope 清理定时器。
  // 单例在模块作用域创建，没有 active scope，因此不会被误清。
  if (getCurrentScope()) onScopeDispose(clearTimer)

  return { pending, push, undo, dismiss }
}

/**
 * 全局共享的撤销状态。
 * 必须是模块级单例：删除发生在某个视图，提示条挂在 AppShell，
 * 每个组件各 new 一个的话两边各是一份状态，撤销条永远不会亮。
 */
export const appUndo = useUndo()
