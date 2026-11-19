import { describe, expect, it } from 'vitest'
import { buildThemeOverrides } from './naive'

const TOKENS: Record<string, string> = {
  '--lumin-color-primary': ' #111111 ',
  '--lumin-color-primary-hover': '#222222',
  '--lumin-color-bg': '#333333',
  '--lumin-color-surface': '#444444',
  '--lumin-color-border': '#555555',
  '--lumin-color-text': '#666666',
  '--lumin-color-text-secondary': '#777777',
  '--lumin-color-error': '#888888',
  '--lumin-color-warning': '#999999',
  '--lumin-color-success': '#aaaaaa',
  '--lumin-radius-md': '8px',
  '--lumin-font-size-md': '14px'
}

const read = (name: string): string => TOKENS[name] ?? ''

describe('buildThemeOverrides', () => {
  it('按 tokens 映射 Naive common 键并去除空白', () => {
    const common = buildThemeOverrides(read).common
    expect(common).toMatchObject({
      primaryColor: '#111111',
      primaryColorHover: '#222222',
      primaryColorPressed: '#111111',
      primaryColorSuppl: '#111111',
      bodyColor: '#333333',
      cardColor: '#444444',
      popoverColor: '#444444',
      borderColor: '#555555',
      dividerColor: '#555555',
      textColor1: '#666666',
      textColor2: '#666666',
      textColor3: '#777777',
      errorColor: '#888888',
      warningColor: '#999999',
      successColor: '#aaaaaa',
      borderRadius: '8px',
      fontSize: '14px'
    })
  })

  it('不向 Naive 传 var()（其内部无法解析）', () => {
    const common = buildThemeOverrides(read).common ?? {}
    for (const value of Object.values(common)) {
      if (typeof value === 'string') expect(value).not.toContain('var(')
    }
  })

  it('读取器返回空串时回落空串不抛错', () => {
    const common = buildThemeOverrides(() => '').common
    expect(common?.bodyColor).toBe('')
    expect(common?.borderRadius).toBe('')
  })
})
