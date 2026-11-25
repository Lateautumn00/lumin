import { describe, expect, it } from 'vitest'

import { PASSWORD_GENERATOR_ERROR_CODES, errorMessage, toolError } from './errors'

describe('PASSWORD_GENERATOR_ERROR_CODES', () => {
  it('码集合固定为 2 个', () => {
    expect(PASSWORD_GENERATOR_ERROR_CODES).toEqual(['PG_INVALID_OPTIONS', 'PG_CLIPBOARD_FAILED'])
  })
})

describe('toolError', () => {
  it('构造状态化错误并带中文文案', () => {
    expect(toolError('PG_INVALID_OPTIONS')).toEqual({
      code: 'PG_INVALID_OPTIONS',
      message: '生成参数不合法，请检查长度与字符集'
    })
  })

  it('detail 非空时附加', () => {
    expect(toolError('PG_CLIPBOARD_FAILED', 'clipboard unavailable')).toEqual({
      code: 'PG_CLIPBOARD_FAILED',
      message: '复制失败，请手动选择文本复制',
      detail: 'clipboard unavailable'
    })
  })

  it('detail 为空串时省略', () => {
    expect(toolError('PG_INVALID_OPTIONS', '')).not.toHaveProperty('detail')
  })
})

describe('errorMessage', () => {
  it('已知码返回中文文案，未知码回退原码', () => {
    expect(errorMessage('PG_CLIPBOARD_FAILED')).toBe('复制失败，请手动选择文本复制')
    expect(errorMessage('PG_UNKNOWN')).toBe('PG_UNKNOWN')
  })
})
