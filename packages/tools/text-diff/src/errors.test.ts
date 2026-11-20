import { describe, expect, it } from 'vitest'

import { TEXT_DIFF_ERROR_CODES, errorMessage, toolError } from './errors'

describe('TEXT_DIFF_ERROR_CODES', () => {
  it('码集合固定为 2 个', () => {
    expect(TEXT_DIFF_ERROR_CODES).toEqual(['TD_TOO_LARGE', 'TD_CLIPBOARD_FAILED'])
  })
})

describe('toolError', () => {
  it('构造状态化错误并带中文文案', () => {
    expect(toolError('TD_TOO_LARGE')).toEqual({
      code: 'TD_TOO_LARGE',
      message: '文本过大，单侧最多 20,000 行或 1,000,000 字符'
    })
  })

  it('detail 非空时附加', () => {
    expect(toolError('TD_CLIPBOARD_FAILED', 'clipboard unavailable')).toEqual({
      code: 'TD_CLIPBOARD_FAILED',
      message: '复制失败，请手动选择文本复制',
      detail: 'clipboard unavailable'
    })
  })

  it('detail 为空串时省略', () => {
    expect(toolError('TD_TOO_LARGE', '')).not.toHaveProperty('detail')
  })
})

describe('errorMessage', () => {
  it('已知码返回中文文案，未知码回退原码', () => {
    expect(errorMessage('TD_CLIPBOARD_FAILED')).toBe('复制失败，请手动选择文本复制')
    expect(errorMessage('TD_UNKNOWN')).toBe('TD_UNKNOWN')
  })
})
