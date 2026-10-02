import { reactive, watch } from 'vue'
import { modules, type ModuleKey } from '@/theme/tokens'

/**
 * 本地设置中心（F-SYS 底座）：
 * - 字号可调 / 减少动效（F-SYS-11 无障碍）
 * - 快捷键开关（F-SYS-02 键盘驱动自定义）
 * - Git 同步目录（F-SYS-07）
 * - 更新检查地址（升级检测，自动指向 GitHub 仓库，无需手动填写）
 * - 自定义卡片（F-SYS-06 卡片插件机制，简化版：文本/键值模板，不支持任意 JS 执行）
 * - 板块显示开关 / 侧栏折叠 / 启动自动检查更新 / GitHub 仓库（工作台升级）
 * - LLM 服务：开关 + 自定义服务配置（provider / baseUrl / apiKey / model，工作台升级）
 */
export interface CustomCard {
  id: string
  name: string
  content: string
  color?: string
}

/** 自定义 LLM 服务配置（设置 → AI 与 LLM） */
export interface LlmConfig {
  provider: string // openai | anthropic | deepseek | ollama | custom
  baseUrl: string
  apiKey: string
  model: string
}

export interface KeymapSwitches {
  ctrlNum: boolean // Ctrl+1..7 模块切换
  gSeq: boolean // g 序列跳转
  theme: boolean // Ctrl+Shift+D 主题
  newShortcut: boolean // n 新建
}

const KEY = 'wb_settings_v1'

function defaults() {
  return {
    fontScale: 1,
    reducedMotion: false,
    gitSyncDir: '',
    updateUrl: 'XiaoQius/workbench',
    keymap: { ctrlNum: true, gSeq: true, theme: true, newShortcut: true } as KeymapSwitches,
    cards: [] as CustomCard[],
    sections: Object.fromEntries(modules.map((m) => [m.key, true])) as Record<ModuleKey, boolean>,
    llmEnabled: true,
    sidebarCollapsed: false,
    autoCheckUpdate: true,
    githubRepo: 'XiaoQius/workbench',
    llm: { provider: 'custom', baseUrl: '', apiKey: '', model: '' } as LlmConfig,
  }
}

export interface WbSettings {
  fontScale: number
  reducedMotion: boolean
  gitSyncDir: string
  updateUrl: string
  keymap: KeymapSwitches
  cards: CustomCard[]
  sections: Record<ModuleKey, boolean>
  llmEnabled: boolean
  sidebarCollapsed: boolean
  autoCheckUpdate: boolean
  githubRepo: string
  llm: LlmConfig
}

function load(): WbSettings {
  const d = defaults()
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return d
    const p = JSON.parse(raw)
    return {
      fontScale: typeof p.fontScale === 'number' ? p.fontScale : d.fontScale,
      reducedMotion: !!p.reducedMotion,
      gitSyncDir: typeof p.gitSyncDir === 'string' ? p.gitSyncDir : '',
      updateUrl: typeof p.updateUrl === 'string' && p.updateUrl ? p.updateUrl : d.updateUrl,
      keymap: { ...d.keymap, ...(p.keymap || {}) },
      cards: Array.isArray(p.cards) ? p.cards : [],
      sections: { ...d.sections, ...(p.sections || {}) },
      llmEnabled: p.llmEnabled !== false,
      sidebarCollapsed: !!p.sidebarCollapsed,
      autoCheckUpdate: p.autoCheckUpdate !== false,
      githubRepo: typeof p.githubRepo === 'string' && p.githubRepo ? p.githubRepo : d.githubRepo,
      llm: { ...d.llm, ...(p.llm || {}) },
    }
  } catch {
    return d
  }
}

const settings = reactive<WbSettings>(load())

watch(
  settings,
  () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(settings))
    } catch {
      // 存储不可用时静默降级（配置不持久化）
    }
  },
  { deep: true },
)

export function useSettings() {
  return settings
}

export function applyAccessibility(settings: WbSettings) {
  const root = document.documentElement
  root.style.fontSize = `${Math.round(settings.fontScale * 100) / 100 * 16}px`
  root.classList.toggle('wb-reduced-motion', settings.reducedMotion)
}
