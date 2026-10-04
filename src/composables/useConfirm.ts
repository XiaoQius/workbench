import { useDialog } from 'naive-ui'

export interface ConfirmOptions {
  title?: string
  content?: string
  confirmText?: string
  cancelText?: string
  danger?: boolean
}

/**
 * 删除等破坏性操作前的二次确认。
 * 依赖 App.vue 根部的 NDialogProvider；无 provider 时降级为 window.confirm。
 */
export function useConfirm() {
  let dialog: ReturnType<typeof useDialog> | null = null
  try {
    dialog = useDialog()
  } catch {
    dialog = null
  }

  function confirm(opts: ConfirmOptions = {}): Promise<boolean> {
    const {
      title = '确认删除？',
      content = '删除后无法恢复。',
      confirmText = '删除',
      cancelText = '取消',
      danger = true,
    } = opts

    if (!dialog) {
      return Promise.resolve(window.confirm(`${title}\n${content}`))
    }

    return new Promise<boolean>((resolve) => {
      const d = dialog!.warning({
        title,
        content,
        positiveText: confirmText,
        negativeText: cancelText,
        positiveButtonProps: danger ? { type: 'error' } : { type: 'primary' },
        onPositiveClick: () => { resolve(true) },
        onNegativeClick: () => { resolve(false) },
        onClose: () => { resolve(false) },
      })
      // 极少数情况下 dialog 未挂载时返回 undefined，兜底避免永久挂起
      if (!d) resolve(window.confirm(`${title}\n${content}`))
    })
  }

  return { confirm }
}
