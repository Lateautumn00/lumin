/**
 * @file Naive UI 主题覆盖：值全部来自 tokens（R4 单源）
 * @author cuilanchao
 * @date 2026-11-19
 * @description Naive 内部对颜色做 rgba 运算，无法解析 var()，故按主题切换后从
 *              getComputedStyle 重新读取 token 计算值；读取器可注入以便单测。
 */
import type { GlobalThemeOverrides } from 'naive-ui'

export type TokenReader = (name: string) => string

export function buildThemeOverrides(read: TokenReader): GlobalThemeOverrides {
  const token = (name: string): string => read(name).trim()
  return {
    common: {
      primaryColor: token('--lumin-color-primary'),
      primaryColorHover: token('--lumin-color-primary-hover'),
      primaryColorPressed: token('--lumin-color-primary'),
      primaryColorSuppl: token('--lumin-color-primary'),
      bodyColor: token('--lumin-color-bg'),
      cardColor: token('--lumin-color-surface'),
      popoverColor: token('--lumin-color-surface'),
      borderColor: token('--lumin-color-border'),
      dividerColor: token('--lumin-color-border'),
      textColor1: token('--lumin-color-text'),
      textColor2: token('--lumin-color-text'),
      textColor3: token('--lumin-color-text-secondary'),
      errorColor: token('--lumin-color-error'),
      warningColor: token('--lumin-color-warning'),
      successColor: token('--lumin-color-success'),
      textColorDisabled: token('--lumin-color-text-tertiary'),
      boxShadow1: token('--lumin-shadow-sm'),
      boxShadow2: token('--lumin-shadow-md'),
      boxShadow3: token('--lumin-shadow-lg'),
      borderRadius: token('--lumin-radius-md'),
      borderRadiusSmall: token('--lumin-radius-sm'),
      fontSize: token('--lumin-font-size-md'),
      fontWeightStrong: '600',
      fontFamily: token('--lumin-font-sans'),
      fontFamilyMono: token('--lumin-font-mono')
    }
  }
}
