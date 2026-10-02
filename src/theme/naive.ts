import type { GlobalThemeOverrides } from 'naive-ui'
import { tokens, themeMeta, type ThemeKey } from './tokens'

/** 由设计 token 生成 Naive UI 主题覆盖（四套主题共用一套映射，颜色取自对应主题 token） */
export function naiveOverrides(key: ThemeKey): GlobalThemeOverrides {
  const t = tokens[key]
  const dark = themeMeta(key).dark
  const radius = `${t.radiusMd}px`
  return {
    common: {
      primaryColor: t.accent,
      primaryColorHover: primaryHover(key),
      primaryColorPressed: primaryPressed(key),
      primaryColorSuppl: t.accent,
      successColor: t.success,
      warningColor: t.warning,
      errorColor: t.danger,
      infoColor: t.info,
      bodyColor: t.bg,
      cardColor: t.card,
      modalColor: t.card,
      popoverColor: t.card,
      tableColor: t.card,
      inputColor: inputBg(key),
      borderColor: t.border,
      dividerColor: t.border,
      textColor1: t.text1,
      textColor2: t.text2,
      textColor3: t.text3,
      borderRadius: radius,
      borderRadiusSmall: `${t.radiusSm}px`,
      fontSize: '13px',
      fontSizeSmall: '12px',
      fontSizeMedium: '13px',
      fontSizeLarge: '14px',
      heightSmall: '28px',
      heightMedium: '34px',
      heightLarge: '40px',
    },
    Button: {
      borderRadiusSmall: radius,
      borderRadiusMedium: radius,
      borderRadiusLarge: radius,
      fontWeight: '500',
    },
    Card: {
      borderRadius: `${t.radiusLg}px`,
      borderColor: t.border,
      paddingMedium: '16px',
    },
    DataTable: {
      thColor: t.cardAlt,
      thColorHover: t.cardAlt,
      thTextColor: t.text2,
      tdColorHover: t.cardAlt,
      borderColor: t.border,
      thFontWeight: '500',
    },
    Input: {
      borderRadius: `${t.radiusSm}px`,
    },
    Select: {
      peers: {
        InternalSelection: {
          borderRadius: `${t.radiusSm}px`,
        },
      },
    },
    Tag: {
      borderRadius: `${t.radiusSm}px`,
    },
    Modal: {
      borderRadius: `${t.radiusLg}px`,
    },
    Drawer: {
      bodyPadding: '20px',
    },
    Menu: {
      itemHeight: '38px',
    },
  }
}

// 以下三项原先是写死的三元（按 light/dark 取色），新的两套主题沿用会残留旧配色
function primaryHover(key: ThemeKey): string {
  switch (key) {
    case 'dark':
      return '#93A0FA'
    case 'brutal':
      return '#1E33D6'
    case 'tech':
      return '#5CF3FF'
    default:
      return '#6366F1'
  }
}

function primaryPressed(key: ThemeKey): string {
  switch (key) {
    case 'dark':
      return '#6E7AF2'
    case 'brutal':
      return '#18279E'
    case 'tech':
      return '#00B8CC'
    default:
      return '#4338CA'
  }
}

function inputBg(key: ThemeKey): string {
  switch (key) {
    case 'dark':
      return '#141416'
    case 'brutal':
      return '#FFFFFF'
    case 'tech':
      return '#0A0F1A'
    default:
      return '#FCFCFB'
  }
}
