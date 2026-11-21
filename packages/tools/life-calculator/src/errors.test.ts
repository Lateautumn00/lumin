import { describe, expect, it } from 'vitest'

import { LIFE_CALCULATOR_ERROR_CODES, errorMessage, toolError } from './errors'

describe('错误码与文案', () => {
  it('错误码全集完整', () => {
    expect(LIFE_CALCULATOR_ERROR_CODES).toEqual([
      'LC_MORTGAGE_INVALID',
      'LC_TAX_INVALID',
      'LC_PERCENT_INVALID',
      'LC_CLIPBOARD_FAILED'
    ])
  })

  it('toolError 带 detail 与不带 detail', () => {
    expect(toolError('LC_MORTGAGE_INVALID')).toEqual({
      code: 'LC_MORTGAGE_INVALID',
      message: '房贷参数不合法，请检查本金、利率与年限'
    })
    expect(toolError('LC_TAX_INVALID', '工资越界')).toEqual({
      code: 'LC_TAX_INVALID',
      message: '个税参数不合法，请检查工资与扣除项',
      detail: '工资越界'
    })
    expect(toolError('LC_PERCENT_INVALID', '')).toEqual({
      code: 'LC_PERCENT_INVALID',
      message: '百分比参数不合法'
    })
  })

  it('errorMessage 未知码回退原码', () => {
    expect(errorMessage('LC_CLIPBOARD_FAILED')).toBe('复制失败，请手动选择文本复制')
    expect(errorMessage('LC_UNKNOWN')).toBe('LC_UNKNOWN')
  })
})
