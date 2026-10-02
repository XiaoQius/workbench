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

export const tokens: { light: ThemeTokens; dark: ThemeTokens } = {
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
    font:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif',
    fontMono:
      '"JetBrains Mono", "Cascadia Code", Consolas, "Courier New", monospace',
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
    font:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif',
    fontMono:
      '"JetBrains Mono", "Cascadia Code", Consolas, "Courier New", monospace',
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

export function moduleColor(key: string, dark: boolean): string {
  const t = dark ? tokens.dark : tokens.light
  const m = key in t.module ? t.module[key as keyof typeof t.module] : undefined
  return m || t.accent
}
