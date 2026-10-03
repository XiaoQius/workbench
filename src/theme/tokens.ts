// ============================================================
// WORKBENCH 设计 token（单一数据源）
// 两维正交主题模型（参考云端管理面板 skins 设计）：
//   · 配色 colorMode：light / dark          —— 决定明暗色系
//   · 风格 styleMode：normal / brutal / tech —— 决定造型质感
// 两者组合成 6 套完整主题，共用一套 token 结构。
// 被 UnoCSS / main.css / Naive UI 覆盖共同消费
// ============================================================

export interface ModuleColors {
  home: string
  workspace: string
  dev: string
  ops: string
  life: string
  study: string
  knowledge: string
  inspiration: string
}

export interface ThemeTokens {
  bg: string
  card: string
  cardAlt: string
  border: string
  text1: string
  text2: string
  text3: string
  accent: string
  success: string
  warning: string
  danger: string
  info: string
  module: ModuleColors
  radiusSm: number
  radiusMd: number
  radiusLg: number
  borderWidth: number
  shadowHover: string
  font: string
  fontMono: string
}

export type ColorMode = 'light' | 'dark'
export type StyleMode = 'normal' | 'brutal' | 'tech'
export type ComboKey = `${ColorMode}-${StyleMode}`

export interface ColorMeta {
  key: ColorMode
  label: string
  short: string
}
export interface StyleMeta {
  key: StyleMode
  label: string
  short: string
  desc: string
}

export const COLOR_MODES: ColorMeta[] = [
  { key: 'light', label: '浅色', short: '浅色' },
  { key: 'dark', label: '深色', short: '深色' },
]

export const STYLE_MODES: StyleMeta[] = [
  { key: 'normal', label: '标准', short: '标准', desc: '极简灰阶 · 柔阴影' },
  { key: 'brutal', label: '粗野', short: '粗野', desc: '厚描边 · 硬偏移投影 · 大圆角' },
  { key: 'tech', label: '科技', short: '科技', desc: '终端等宽 · 霓虹辉光' },
]

export function comboKey(color: ColorMode, style: StyleMode): ComboKey {
  return `${color}-${style}`
}

export function isColorMode(v: unknown): v is ColorMode {
  return v === 'light' || v === 'dark'
}
export function isStyleMode(v: unknown): v is StyleMode {
  return v === 'normal' || v === 'brutal' || v === 'tech'
}

/** 旧单维主题值 → 两维，用于迁移历史 localStorage */
export function migrateLegacyTheme(legacy: unknown): { color: ColorMode; style: StyleMode } | null {
  switch (legacy) {
    case 'light': return { color: 'light', style: 'normal' }
    case 'dark': return { color: 'dark', style: 'normal' }
    case 'brutal': return { color: 'light', style: 'brutal' }
    case 'tech': return { color: 'dark', style: 'tech' }
    default: return null
  }
}

const FONT_SANS =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif'
const FONT_MONO =
  '"JetBrains Mono", "Cascadia Code", Consolas, "Courier New", monospace'

// 造型参数按风格归组（与明暗无关）
const SHAPE: Record<StyleMode, { radiusSm: number; radiusMd: number; radiusLg: number; borderWidth: number }> = {
  normal: { radiusSm: 6, radiusMd: 8, radiusLg: 12, borderWidth: 1 },
  brutal: { radiusSm: 8, radiusMd: 14, radiusLg: 20, borderWidth: 3 },
  tech: { radiusSm: 6, radiusMd: 8, radiusLg: 10, borderWidth: 1 },
}

// 颜色按 6 组合定义：明暗两套 base，风格再覆盖强调/描边/阴影
type Palette = Omit<ThemeTokens, 'radiusSm' | 'radiusMd' | 'radiusLg' | 'borderWidth' | 'font' | 'fontMono'>

const PALETTES: Record<ComboKey, Palette> = {
  // —— 标准 · 浅色（原 light）——
  'light-normal': {
    bg: '#FAFAF9', card: '#FFFFFF', cardAlt: '#F4F4F5', border: '#E4E4E7',
    text1: '#18181B', text2: '#71717A', text3: '#A1A1AA',
    accent: '#4F46E5', success: '#16A34A', warning: '#D97706', danger: '#DC2626', info: '#2563EB',
    module: { home: '#4F46E5', workspace: '#0D9488', dev: '#059669', ops: '#D97706', life: '#DB2777', study: '#7C3AED', knowledge: '#2563EB', inspiration: '#CA8A04' },
    shadowHover: '0 4px 16px rgba(0,0,0,0.06)',
  },
  // —— 标准 · 深色（原 dark）——
  'dark-normal': {
    bg: '#0F0F10', card: '#1A1A1C', cardAlt: '#232326', border: '#27272A',
    text1: '#F4F4F5', text2: '#A1A1AA', text3: '#71717A',
    accent: '#818CF8', success: '#4ADE80', warning: '#FBBF24', danger: '#F87171', info: '#60A5FA',
    module: { home: '#818CF8', workspace: '#2DD4BF', dev: '#34D399', ops: '#FBBF24', life: '#F472B6', study: '#A78BFA', knowledge: '#60A5FA', inspiration: '#FACC15' },
    shadowHover: '0 4px 16px rgba(0,0,0,0.35)',
  },
  // —— 粗野 · 浅色（原 brutal）：米白纸底 + 墨黑厚描边 + 硬偏移投影 ——
  'light-brutal': {
    bg: '#FFF8E7', card: '#FFFFFF', cardAlt: '#FFF1C9', border: '#141414',
    text1: '#141414', text2: '#4A4A4A', text3: '#6E6E6E',
    accent: '#2B44FF', success: '#0B8A4B', warning: '#C2410C', danger: '#E1000F', info: '#0066CC',
    module: { home: '#2B44FF', workspace: '#0B6E4F', dev: '#0B8A4B', ops: '#C2410C', life: '#B3005C', study: '#5B2D8E', knowledge: '#14509E', inspiration: '#FF8A00' },
    shadowHover: '4px 4px 0 #141414',
  },
  // —— 粗野 · 深色（新）：墨黑底 + 亮纸色厚描边 + 硬偏移投影 ——
  'dark-brutal': {
    bg: '#16161C', card: '#1E1E26', cardAlt: '#26262F', border: '#F2F0E4',
    text1: '#F5F3E7', text2: '#B8B6AC', text3: '#807E76',
    accent: '#5B6BFF', success: '#22C55E', warning: '#F97316', danger: '#FF4D4D', info: '#3B9EFF',
    module: { home: '#5B6BFF', workspace: '#2DD4BF', dev: '#34D399', ops: '#FB923C', life: '#F472B6', study: '#A78BFA', knowledge: '#60A5FA', inspiration: '#FFB020' },
    shadowHover: '4px 4px 0 #F2F0E4',
  },
  // —— 科技 · 浅色（新）：冷白蓝底 + 深霓虹青 + 细描边 ——
  'light-tech': {
    bg: '#EEF4FB', card: '#FFFFFF', cardAlt: '#E4EEF8', border: '#B9D3E8',
    text1: '#0A1A2B', text2: '#3E5C78', text3: '#7C96AE',
    accent: '#0891B2', success: '#059669', warning: '#B45309', danger: '#E11D48', info: '#2563EB',
    module: { home: '#0891B2', workspace: '#059669', dev: '#0D9488', ops: '#B45309', life: '#DB2777', study: '#7C3AED', knowledge: '#2563EB', inspiration: '#CA8A04' },
    shadowHover: '0 0 18px rgba(8,145,178,0.22)',
  },
  // —— 科技 · 深色（原 tech）：近黑深蓝底 + 霓虹青 + 青色辉光 ——
  'dark-tech': {
    bg: '#05070D', card: '#0C1220', cardAlt: '#111A2E', border: '#1B2740',
    text1: '#E6F1FF', text2: '#8FA3C0', text3: '#5A6B85',
    accent: '#00E5FF', success: '#2BE08A', warning: '#FFB020', danger: '#FF4D6A', info: '#4DA3FF',
    module: { home: '#00E5FF', workspace: '#2BE08A', dev: '#2BE08A', ops: '#FFB020', life: '#FF6FB5', study: '#A78BFA', knowledge: '#4DA3FF', inspiration: '#FFE45C' },
    shadowHover: '0 0 20px rgba(0, 229, 255, 0.22)',
  },
}

function build(key: ComboKey): ThemeTokens {
  const color = key.split('-')[0] as ColorMode
  const style = key.split('-').slice(1).join('-') as StyleMode
  const p = PALETTES[key]
  const shape = SHAPE[style]
  return {
    ...p,
    radiusSm: shape.radiusSm,
    radiusMd: shape.radiusMd,
    radiusLg: shape.radiusLg,
    borderWidth: shape.borderWidth,
    font: FONT_SANS,
    fontMono: FONT_MONO,
    // 内部用不到 color，但保留在下面 meta 判断
    ...(color === 'dark' ? {} : {}),
  }
}

export const tokens: Record<ComboKey, ThemeTokens> = {
  'light-normal': build('light-normal'),
  'dark-normal': build('dark-normal'),
  'light-brutal': build('light-brutal'),
  'dark-brutal': build('dark-brutal'),
  'light-tech': build('light-tech'),
  'dark-tech': build('dark-tech'),
}

// 当前生效组合。moduleColor(key, dark) 签名保持不变（20 余处调用点不动），
// 具体取色由 store 的 apply() 通过 setActiveTheme 写入此处。
let activeCombo: ComboKey = 'light-normal'

export function setActiveTheme(key: ComboKey): void {
  activeCombo = key
}

export function activeThemeKey(): ComboKey {
  return activeCombo
}

/** 模块路由元信息（名称 / 强调色 / 图标点） */
export const modules = [
  { key: 'home', path: '/', label: '总览', name: 'HOME', colorKey: 'home' },
  { key: 'workspace', path: '/workspace', label: '工作台', name: 'WORKSPACE', colorKey: 'workspace' },
  { key: 'dev', path: '/dev', label: '开发', name: 'DEV', colorKey: 'dev' },
  { key: 'ops', path: '/ops', label: '运维', name: 'OPS', colorKey: 'ops' },
  { key: 'life', path: '/life', label: '生活', name: 'LIFE', colorKey: 'life' },
  { key: 'study', path: '/study', label: '学习', name: 'STUDY', colorKey: 'study' },
  { key: 'knowledge', path: '/knowledge', label: '知识库', name: 'KNOWLEDGE', colorKey: 'knowledge' },
  { key: 'inspiration', path: '/inspiration', label: '灵感', name: 'INSPIRATION', colorKey: 'inspiration' },
] as const

export type ModuleKey = (typeof modules)[number]['key']

/** 模块色：签名不变，按当前生效组合取色 */
export function moduleColor(key: string, dark: boolean): string {
  const t = tokens[activeCombo]
  const m = key in t.module ? t.module[key as keyof typeof t.module] : undefined
  if (m) return m
  const fallback = dark ? tokens['dark-normal'] : tokens['light-normal']
  return fallback.module[key as keyof typeof fallback.module] || fallback.accent
}
