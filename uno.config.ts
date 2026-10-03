import { defineConfig, presetUno } from 'unocss'
import { tokens } from './src/theme/tokens'

const light = tokens['light-normal']

// UnoCSS 原子样式：设计 token 注入主题，配合 src/styles/main.css 的 CSS 变量
export default defineConfig({
  presets: [presetUno()],
  theme: {
    colors: {
      bg: light.bg,
      card: light.card,
      border: light.border,
      t1: light.text1,
      t2: light.text2,
      accent: light.accent,
      ok: light.success,
      warn: light.warning,
      danger: light.danger,
      info: light.info,
      home: light.module.home,
      workspace: light.module.workspace,
      dev: light.module.dev,
      ops: light.module.ops,
      life: light.module.life,
      study: light.module.study,
      knowledge: light.module.knowledge,
    },
  },
  shortcuts: {
    'card-base': 'bg-card border border-border rounded-lg transition-shadow duration-150',
    'card-hover': 'hover:-translate-y-0.5 hover:shadow-[0_4px_16px_rgba(0,0,0,0.06)]',
    'text-primary': 'text-t1',
    'text-secondary': 'text-t2 text-13px',
    'px-page': 'px-6',
    'py-page': 'py-5',
  },
  rules: [
    [/^text-(\d+)px$/, ([, n]) => ({ 'font-size': `${n}px` })],
  ],
  darkMode: 'class',
})
