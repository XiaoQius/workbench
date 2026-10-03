import type { GlobalThemeOverrides } from 'naive-ui'
import { tokens, type ComboKey } from './tokens'

/** 由设计 token 生成 Naive UI 主题覆盖（6 组合共用一套映射，颜色取自对应组合 token） */
export function naiveOverrides(key: ComboKey): GlobalThemeOverrides {
  const t = tokens[key]
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

function primaryHover(key: ComboKey): string {
  switch (key) {
    case 'dark-normal':
      return '#93A0FA'
    case 'light-brutal':
      return '#1E33D6'
    case 'dark-brutal':
      return '#7A86FF'
    case 'light-tech':
      return '#0E7490'
    case 'dark-tech':
      return '#5CF3FF'
    default:
      return '#6366F1'
  }
}

function primaryPressed(key: ComboKey): string {
  switch (key) {
    case 'dark-normal':
      return '#6E7AF2'
    case 'light-brutal':
      return '#18279E'
    case 'dark-brutal':
      return '#4353E0'
    case 'light-tech':
      return '#155E75'
    case 'dark-tech':
      return '#00B8CC'
    default:
      return '#4338CA'
  }
}

function inputBg(key: ComboKey): string {
  switch (key) {
    case 'dark-normal':
      return '#141416'
    case 'light-brutal':
      return '#FFFFFF'
    case 'dark-brutal':
      return '#14141A'
    case 'light-tech':
      return '#F6FAFE'
    case 'dark-tech':
      return '#0A0F1A'
    default:
      return '#FCFCFB'
  }
}
