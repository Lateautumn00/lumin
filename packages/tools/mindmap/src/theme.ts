/**
 * @file 主题 tokens → mind-elixir Theme 桥接
 * @author cuilanchao
 * @date 2026-11-24
 * @description 读取 html 上的 --lumin-* 计算样式，映射为 mind-elixir cssVar；
 *              组件不做主题分叉，明暗切换只替换 theme 对象（spec §6）。
 */
import type { Theme } from 'mind-elixir'

/** 主题模式 */
export type ThemeMode = 'light' | 'dark'

/** 主题桥接所需 tokens */
export interface ThemeTokens {
  bg: string
  text: string
  primary: string
  primaryHover: string
  primarySoft: string
  surface: string
  border: string
  bgElevated: string
  accent: string
  radiusMd: string
}

/** 读取器（通常为 getComputedStyle(html).getPropertyValue） */
export type ThemeReader = (variable: string) => string

/** tokens 变量名 → ThemeTokens 字段 */
const TOKEN_MAP: Record<keyof ThemeTokens, string> = {
  bg: '--lumin-color-bg',
  text: '--lumin-color-text',
  primary: '--lumin-color-primary',
  primaryHover: '--lumin-color-primary-hover',
  primarySoft: '--lumin-color-primary-soft',
  surface: '--lumin-color-surface',
  border: '--lumin-color-border',
  bgElevated: '--lumin-color-bg-elevated',
  accent: '--lumin-color-accent',
  radiusMd: '--lumin-radius-md'
}

/** 极端环境兜底（系统色关键字，避免硬编码色值） */
const FALLBACKS: Record<keyof ThemeTokens, string> = {
  bg: 'Canvas',
  text: 'CanvasText',
  primary: 'AccentColor',
  primaryHover: 'AccentColor',
  primarySoft: 'Canvas',
  surface: 'Canvas',
  border: 'GrayText',
  bgElevated: 'Canvas',
  accent: 'AccentColor',
  radiusMd: '8px'
}

/**
 * 读取主题 tokens
 * @param read 变量读取器（可注入假件单测）
 */
export function readThemeTokens(read: ThemeReader): ThemeTokens {
  const tokens = {} as ThemeTokens
  for (const key of Object.keys(TOKEN_MAP) as (keyof ThemeTokens)[]) {
    const value = read(TOKEN_MAP[key]).trim()
    tokens[key] = value === '' ? FALLBACKS[key] : value
  }
  return tokens
}

/**
 * tokens → mind-elixir cssVar
 * @param tokens 主题 tokens
 */
export function toCssVarMap(tokens: ThemeTokens): Record<string, string> {
  return {
    '--bgcolor': tokens.bg,
    '--color': tokens.text,
    '--main-color': tokens.primary,
    '--main-bgcolor': tokens.surface,
    '--main-bgcolor-transparent': 'transparent',
    '--main-border': `1px solid ${tokens.border}`,
    '--root-bgcolor': tokens.primarySoft,
    '--root-color': tokens.text,
    '--root-border-color': tokens.primary,
    '--selected': tokens.primaryHover,
    '--accent-color': tokens.accent,
    '--panel-bgcolor': tokens.bgElevated,
    '--panel-color': tokens.text,
    '--panel-border-color': tokens.border,
    '--main-radius': tokens.radiusMd,
    '--root-radius': tokens.radiusMd,
    '--topic-padding': '8px 12px'
  }
}

/**
 * 构造 mind-elixir 主题
 * @param tokens 主题 tokens
 * @param mode 明暗模式
 */
export function buildTheme(tokens: ThemeTokens, mode: ThemeMode): Theme {
  return {
    name: `lumin-${mode}`,
    type: mode,
    palette: [tokens.primary, tokens.accent, tokens.primaryHover],
    cssVar: toCssVarMap(tokens)
  }
}

/**
 * tokens → 导出用 CSS 文本（图片快照拼进 SVG <style>）
 * @param tokens 主题 tokens
 */
export function themeCssText(tokens: ThemeTokens): string {
  const pairs = Object.entries(toCssVarMap(tokens)).map(([key, value]) => `${key}:${value}`)
  return `:root{${pairs.join(';')}}`
}
