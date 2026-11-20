import { describe, expect, it } from 'vitest'

import { TIME_TOOLBOX_ERROR_CODES, errorMessage, toolError } from './errors'

describe('errors', () => {
  it('错误码集合稳定', () => {
    expect([...TIME_TOOLBOX_ERROR_CODES]).toEqual([
      'TT_INVALID_INPUT',
      'TT_OUT_OF_RANGE',
      'TT_CLIPBOARD_FAILED'
    ])
  })

  it('toolError 生成结构化错误与中文文案', () => {
    expect(toolError('TT_INVALID_INPUT')).toEqual({
      code: 'TT_INVALID_INPUT',
      message: '输入格式不正确，请检查后重试'
    })
    expect(toolError('TT_OUT_OF_RANGE', '超出 Date 范围')).toEqual({
      code: 'TT_OUT_OF_RANGE',
      message: '数值超出可表示范围',
      detail: '超出 Date 范围'
    })
    expect(toolError('TT_CLIPBOARD_FAILED', '')).toEqual({
      code: 'TT_CLIPBOARD_FAILED',
      message: '复制失败，请手动选择文本复制'
    })
  })

  it('errorMessage 未知码回退原码', () => {
    expect(errorMessage('TT_INVALID_INPUT')).toBe('输入格式不正确，请检查后重试')
    expect(errorMessage('UNKNOWN')).toBe('UNKNOWN')
  })
})
