import { describe, expect, it } from 'vitest'

import { COLOR_TOOLBOX_ERROR_CODES, errorMessage, toolError } from './errors'

describe('color-toolbox errors', () => {
  it('错误码全集与顺序', () => {
    expect(COLOR_TOOLBOX_ERROR_CODES).toEqual([
      'CT_INVALID_COLOR',
      'CT_CLIPBOARD_FAILED',
      'CT_EYEDROPPER_FAILED'
    ])
  })

  it('构造结构化错误：无 detail 时省略字段', () => {
    expect(toolError('CT_INVALID_COLOR')).toEqual({
      code: 'CT_INVALID_COLOR',
      message: '颜色格式不正确，请输入 HEX / RGB / HSL 值'
    })
    expect(toolError('CT_CLIPBOARD_FAILED', '')).toEqual({
      code: 'CT_CLIPBOARD_FAILED',
      message: '复制失败，请手动选择文本复制'
    })
  })

  it('带 detail 时保留技术细节', () => {
    expect(toolError('CT_INVALID_COLOR', '无效的 HEX 值')).toEqual({
      code: 'CT_INVALID_COLOR',
      message: '颜色格式不正确，请输入 HEX / RGB / HSL 值',
      detail: '无效的 HEX 值'
    })
  })

  it('errorMessage 未知码回退原码', () => {
    expect(errorMessage('CT_INVALID_COLOR')).toBe('颜色格式不正确，请输入 HEX / RGB / HSL 值')
    expect(errorMessage('UNKNOWN_CODE')).toBe('UNKNOWN_CODE')
  })
})
