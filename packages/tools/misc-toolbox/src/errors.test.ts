import { describe, expect, it } from 'vitest'

import { MISC_TOOLBOX_ERROR_CODES, errorMessage, toolError } from './errors'

describe('errors', () => {
  it('错误码集合稳定', () => {
    expect([...MISC_TOOLBOX_ERROR_CODES]).toEqual([
      'MT_CIDR_INVALID',
      'MT_CAPTURE_FAILED',
      'MT_RULER_INVALID',
      'MT_CLIPBOARD_FAILED'
    ])
  })

  it('toolError 生成结构化错误与中文文案', () => {
    expect(toolError('MT_CIDR_INVALID')).toEqual({
      code: 'MT_CIDR_INVALID',
      message: '子网 / IP 输入无效'
    })
    expect(toolError('MT_CIDR_INVALID', '前缀长度 33 超出 0–32')).toEqual({
      code: 'MT_CIDR_INVALID',
      message: '子网 / IP 输入无效',
      detail: '前缀长度 33 超出 0–32'
    })
    expect(toolError('MT_CIDR_INVALID', '')).toEqual({
      code: 'MT_CIDR_INVALID',
      message: '子网 / IP 输入无效'
    })
  })

  it('errorMessage 未知码回退原码', () => {
    expect(errorMessage('MT_CIDR_INVALID')).toBe('子网 / IP 输入无效')
    expect(errorMessage('MT_CAPTURE_FAILED')).toBe('屏幕截图失败')
    expect(errorMessage('MT_RULER_INVALID')).toBe('测量参数无效')
    expect(errorMessage('MT_CLIPBOARD_FAILED')).toBe('复制到剪贴板失败')
    expect(errorMessage('UNKNOWN')).toBe('UNKNOWN')
  })
})
