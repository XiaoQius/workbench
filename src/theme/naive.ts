import type { GlobalThemeOverrides } from 'naive-ui'
import { tokens } from './tokens'

/** 由设计 token 生成 Naive UI 主题覆盖（浅色 / 深色共用一套映射，颜色取自对应 token） */
export function naiveOverrides(dark: boolean): GlobalThemeOverrides {
  const t = dark ? tokens.dark : tokens.light
  const radius = `${t.radiusMd}px`
  return {
    common: {
      primaryColor: t.accent,
      primaryColorHover: dark ? '#93A0FA' : '#6366F1',
      primaryColorPressed: dark ? '#6E7AF2' : '#4338CA',
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
      inputColor: dark ? '#141416' : '#FCFCFB',
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
      thColor: dark ? '#232326' : '#F4F4F5',
      thColorHover: dark ? '#232326' : '#F4F4F5',
      thTextColor: t.text2,
      tdColorHover: dark ? '#1F1F22' : '#FAFAF9',
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
