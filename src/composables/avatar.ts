// 用户头像：与云端管理面板 avatar.js 同一算法，同一用户名两端同色
export const AVATAR_PALETTE = [
  '#4F46E5', '#0D9488', '#059669', '#D97706', '#DB2777',
  '#7C3AED', '#2563EB', '#CA8A04', '#DC2626', '#0891B2',
]

export function avatarColor(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length]
}

/** 展示名：登录用户名，未登录回退设备名 */
export function avatarName(deviceName: string, username: string): string {
  const name = (username || '').trim()
  if (name) return name
  const dev = (deviceName || '').trim()
  return dev || '本机'
}

export function avatarChar(name: string): string {
  const n = (name || '?').trim()
  if (!n) return '?'
  return /[a-zA-Z]/.test(n[0]) ? n[0].toUpperCase() : n[0]
}

/** 未登录时按设备名/本机名定色；登录用户名优先。要求稳定：同一名字永远同色 */
export function avatarSeed(deviceName: string, username: string): string {
  return (username || '').trim() || (deviceName || '').trim() || 'workbench-local'
}

export const AVATAR_IMG_MAX_SIDE = 256

/** 读取并压缩用户上传的头像：正方形裁切居中内容，最长边 256px，输出 JPEG dataURL（约几十 KB，适配 localStorage）。解码失败返回 null。 */
export async function resizeAvatarImage(file: File): Promise<string | null> {
  if (file.type && !/^image\//.test(file.type)) return null
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const im = new Image()
      im.onload = () => res(im)
      im.onerror = () => rej(new Error('decode'))
      im.src = url
    })
    const side = Math.min(img.naturalWidth, img.naturalHeight)
    if (!side) return null
    const out = AVATAR_IMG_MAX_SIDE
    const canvas = document.createElement('canvas')
    canvas.width = out
    canvas.height = out
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, out, out)
    return canvas.toDataURL('image/jpeg', 0.85)
  } catch {
    return null
  } finally {
    URL.revokeObjectURL(url)
  }
}
