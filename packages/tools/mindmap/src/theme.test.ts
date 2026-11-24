/**
 * @file 主题桥接单测
 * @author cuilanchao
 * @date 2026-11-24
 * @description 覆盖 tokens 读取兜底、cssVar 映射、Theme 构造与导出 CSS 文本。
 */
import { describe, expect, it } from 'vitest'
import { buildTheme, readThemeTokens, themeCssText, toCssVarMap, type ThemeTokens } from './theme'

const TOKENS: ThemeTokens = {
  bg: '#ffffff',
  text: '#111111',
  primary: '#3366ff',
  primaryHover: '#2255ee',
  primarySoft: '#eef2ff',
  surface: '#fafafa',
  border: '#dddddd',
  bgElevated: '#f5f5f5',
  accent: '#ff8800',
  radiusMd: '8px'
}

describe('theme', () => {
  it('readThemeTokens 读取完整变量', () => {
    const read = (name: string): string => (name === '--lumin-color-bg' ? '#fff ' : 'value')
    const tokens = readThemeTokens(read)
    expect(tokens.bg).toBe('#fff')
    expect(tokens.radiusMd).toBe('value')
  })

  it('readThemeTokens 空值回退系统色关键字', () => {
    const tokens = readThemeTokens(() => '  ')
    expect(tokens).toEqual({
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
    })
  })

  it('toCssVarMap 输出 mind-elixir 变量全集', () => {
    const vars = toCssVarMap(TOKENS)
    expect(vars['--bgcolor']).toBe(TOKENS.bg)
    expect(vars['--main-border']).toBe(`1px solid ${TOKENS.border}`)
    expect(vars['--root-bgcolor']).toBe(TOKENS.primarySoft)
    expect(vars['--main-radius']).toBe(TOKENS.radiusMd)
    expect(Object.keys(vars)).toHaveLength(17)
  })

  it('buildTheme 名称/类型/调色板与 cssVar 同步', () => {
    const light = buildTheme(TOKENS, 'light')
    expect(light.name).toBe('lumin-light')
    expect(light.type).toBe('light')
    expect(light.palette).toEqual([TOKENS.primary, TOKENS.accent, TOKENS.primaryHover])
    expect(light.cssVar).toEqual(toCssVarMap(TOKENS))

    const dark = buildTheme(TOKENS, 'dark')
    expect(dark.name).toBe('lumin-dark')
    expect(dark.type).toBe('dark')
  })

  it('themeCssText 生成 :root 变量块', () => {
    const css = themeCssText(TOKENS)
    expect(css.startsWith(':root{')).toBe(true)
    expect(css.endsWith('}')).toBe(true)
    expect(css).toContain(`--bgcolor:${TOKENS.bg}`)
    expect(css).toContain('--topic-padding:8px 12px')
  })
})
