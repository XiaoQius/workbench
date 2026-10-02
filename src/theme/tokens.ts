// ============================================================
// WORKBENCH 设计 token（单一数据源）
// 现代极简：灰阶打底 + 低饱和强调色 + 状态色 + 紧凑密度
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
  shadowHover: string
  font: string
  fontMono: string
}

/** 可用主题 key：light / dark 为原有两套，brutal / tech 为新增两套 */
export type ThemeKey = 'light' | 'dark' | 'brutal' | 'tech'

export interface ThemeMeta {
  key: ThemeKey
  label: string // 设置页展示名
  short: string // 短名
  dark: boolean // 是否暗色系：决定模块色取亮侧还是暗侧、Naive 是否套 darkTheme
  radius: boolean // 是否自带圆角阶梯
}

export const THEMES: ThemeMeta[] = [
  { key: 'light', label: '浅色极简', short: '浅色', dark: false, radius: false },
  { key: 'dark', label: '深色', short: '深色', dark: true, radius: false },
  { key: 'brutal', label: '圆角粗野风', short: '粗野', dark: false, radius: true },
  { key: 'tech', label: '科技风', short: '科技', dark: true, radius: true },
]

const THEME_MAP: Record<ThemeKey, ThemeMeta> = {
  light: THEMES[0],
  dark: THEMES[1],
  brutal: THEMES[2],
  tech: THEMES[3],
}

export function themeMeta(key: ThemeKey): ThemeMeta {
  return THEME_MAP[key]
}

/** 非法值（含手工篡改的 localStorage）一律回退 'light' */
export function normalizeTheme(key: unknown): ThemeKey {
  return key === 'dark' || key === 'brutal' || key === 'tech' ? key : 'light'
}

const FONT_SANS =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif'
const FONT_MONO =
  '"JetBrains Mono", "Cascadia Code", Consolas, "Courier New", monospace'

// 当前生效主题。moduleColor(key, dark) 签名保持不变（HomeView 等 20 余处调用点不动），
// 但 brutal 与 light 的 dark 同为 false，单靠布尔无法区分，故由 store 的 apply() 写入此处。
let activeTheme: ThemeKey = 'light'

export function setActiveTheme(key: ThemeKey): void {
  activeTheme = key
}

export const tokens: Record<ThemeKey, ThemeTokens> = {
  light: {
    bg: '#FAFAF9',
    card: '#FFFFFF',
    cardAlt: '#F4F4F5',
    border: '#E4E4E7',
    text1: '#18181B',
    text2: '#71717A',
    text3: '#A1A1AA',
    accent: '#4F46E5',
    success: '#16A34A',
    warning: '#D97706',
    danger: '#DC2626',
    info: '#2563EB',
    module: {
      home: '#4F46E5',
      workspace: '#0D9488',
      dev: '#059669',
      ops: '#D97706',
      life: '#DB2777',
      study: '#7C3AED',
      knowledge: '#2563EB',
    },
    radiusSm: 6,
    radiusMd: 8,
    radiusLg: 12,
    shadowHover: '0 4px 16px rgba(0,0,0,0.06)',
    font: FONT_SANS,
    fontMono: FONT_MONO,
  },
  dark: {
    bg: '#0F0F10',
    card: '#1A1A1C',
    cardAlt: '#232326',
    border: '#27272A',
    text1: '#F4F4F5',
    text2: '#A1A1AA',
    text3: '#71717A',
    accent: '#818CF8',
    success: '#4ADE80',
    warning: '#FBBF24',
    danger: '#F87171',
    info: '#60A5FA',
    module: {
      home: '#818CF8',
      workspace: '#2DD4BF',
      dev: '#34D399',
      ops: '#FBBF24',
      life: '#F472B6',
      study: '#A78BFA',
      knowledge: '#60A5FA',
    },
    radiusSm: 6,
    radiusMd: 8,
    radiusLg: 12,
    shadowHover: '0 4px 16px rgba(0,0,0,0.35)',
    font: FONT_SANS,
    fontMono: FONT_MONO,
  },

  // 圆角新粗野风（明色系）：厚描边 + 硬偏移投影 + 大圆角 + 高饱和撞色
  brutal: {
    bg: '#FFF8E7',
    card: '#FFFFFF',
    cardAlt: '#FFF1C9',
    border: '#141414',
    text1: '#141414',
    text2: '#4A4A4A',
    text3: '#6E6E6E',
    accent: '#2B44FF',
    success: '#0B8A4B',
    warning: '#C2410C',
    danger: '#E1000F',
    info: '#0066CC',
    module: {
      home: '#2B44FF',
      workspace: '#0B6E4F',
      dev: '#0B8A4B',
      ops: '#C2410C',
      life: '#B3005C',
      study: '#5B2D8E',
      knowledge: '#14509E',
    },
    radiusSm: 8,
    radiusMd: 14,
    radiusLg: 20,
    shadowHover: '4px 4px 0 #141414',
    font: FONT_SANS,
    fontMono: FONT_MONO,
  },

  // 科技风（暗色系）：近黑深蓝底 + 霓虹青 + 细描边 + 微弱辉光
  tech: {
    bg: '#05070D',
    card: '#0C1220',
    cardAlt: '#111A2E',
    border: '#1B2740',
    text1: '#E6F1FF',
    text2: '#8FA3C0',
    text3: '#5A6B85',
    accent: '#00E5FF',
    success: '#2BE08A',
    warning: '#FFB020',
    danger: '#FF4D6A',
    info: '#4DA3FF',
    module: {
      home: '#00E5FF',
      workspace: '#2BE08A',
      dev: '#2BE08A',
      ops: '#FFB020',
      life: '#FF6FB5',
      study: '#A78BFA',
      knowledge: '#4DA3FF',
    },
    radiusSm: 6,
    radiusMd: 8,
    radiusLg: 10,
    shadowHover: '0 0 20px rgba(0, 229, 255, 0.22)',
    font: FONT_SANS,
    fontMono: FONT_MONO,
  },
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
] as const

export type ModuleKey = (typeof modules)[number]['key']

/** 模块色：签名不变，按当前生效主题取色（brutal 取压暗色、tech 取霓虹色） */
export function moduleColor(key: string, dark: boolean): string {
  const t = tokens[activeTheme]
  const m = key in t.module ? t.module[key as keyof typeof t.module] : undefined
  if (m) return m
  const fallback = dark ? tokens.dark : tokens.light
  return fallback.module[key as keyof typeof fallback.module] || fallback.accent
}
