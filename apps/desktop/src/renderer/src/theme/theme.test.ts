import { describe, expect, it } from 'vitest'
import {
  DEFAULT_THEME_MODE,
  THEME_MODE_KEY,
  applyThemeAttribute,
  parseThemeMode,
  resolveTheme
} from './theme'

describe('parseThemeMode', () => {
  it('接受三个合法值', () => {
    expect(parseThemeMode('system')).toBe('system')
    expect(parseThemeMode('light')).toBe('light')
    expect(parseThemeMode('dark')).toBe('dark')
  })

  it('非法/缺失值回落 system', () => {
    expect(parseThemeMode('sepia')).toBe(DEFAULT_THEME_MODE)
    expect(parseThemeMode('')).toBe(DEFAULT_THEME_MODE)
    expect(parseThemeMode(undefined)).toBe(DEFAULT_THEME_MODE)
    expect(parseThemeMode(null)).toBe(DEFAULT_THEME_MODE)
    expect(parseThemeMode(1)).toBe(DEFAULT_THEME_MODE)
    expect(parseThemeMode({ mode: 'dark' })).toBe(DEFAULT_THEME_MODE)
  })

  it('持久化键固定', () => {
    expect(THEME_MODE_KEY).toBe('shell.theme.mode')
  })
})

describe('resolveTheme', () => {
  it('显式 light/dark 忽略系统偏好', () => {
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('light', false)).toBe('light')
    expect(resolveTheme('dark', true)).toBe('dark')
    expect(resolveTheme('dark', false)).toBe('dark')
  })

  it('system 跟随系统偏好', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
  })
})

describe('applyThemeAttribute', () => {
  it('写入 data-theme', () => {
    const el: { dataset: Record<string, string | undefined> } = { dataset: {} }
    applyThemeAttribute(el, 'dark')
    expect(el.dataset['theme']).toBe('dark')
    applyThemeAttribute(el, 'light')
    expect(el.dataset['theme']).toBe('light')
  })
})
