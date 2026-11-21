import { describe, expect, it } from 'vitest'

import { COLOR_TOOLBOX_ERROR_CODES, errorMessage, toolError } from './errors'

describe('color-toolbox errors', () => {
  it('错误码全集与顺序', () => {
    expect(COLOR_TOOLBOX_ERROR_CODES).toEqual([
      'CT_INVALID_COLOR',
      'CT_CLIPBOARD_FAILED',
      'CT_CAPTURE_FAILED',
      'CT_PALETTE_FAILED'
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
    expect(toolError('CT_PALETTE_FAILED', '图片过大')).toEqual({
      code: 'CT_PALETTE_FAILED',
      message: '图片解析失败，请换一张图片重试',
      detail: '图片过大'
    })
  })

  it('errorMessage 未知码回退原码', () => {
    expect(errorMessage('CT_INVALID_COLOR')).toBe('颜色格式不正确，请输入 HEX / RGB / HSL 值')
    expect(errorMessage('UNKNOWN_CODE')).toBe('UNKNOWN_CODE')
  })
})
