/**
 * @file errors.test.ts 结构化错误单测
 * @author cuilanchao
 * @date 2026-11-22
 */
import { describe, expect, it } from 'vitest'
import { errorMessage, isRetryable, isStructuredError, toolError } from './errors'

describe('toolError', () => {
  it('缺省不带 detail，传空串同样省略', () => {
    expect(toolError('SI_COLLECT_FAILED')).toEqual({
      code: 'SI_COLLECT_FAILED',
      message: '采集系统信息失败'
    })
    expect(toolError('SI_CLIPBOARD_FAILED', '')).toEqual({
      code: 'SI_CLIPBOARD_FAILED',
      message: '复制失败（剪贴板不可用）'
    })
  })

  it('传入 detail 时保留技术细节', () => {
    expect(toolError('SI_COLLECT_FAILED', 'EACCES')).toEqual({
      code: 'SI_COLLECT_FAILED',
      message: '采集系统信息失败',
      detail: 'EACCES'
    })
  })
})

describe('isRetryable', () => {
  it('仅采集失败可重试', () => {
    expect(isRetryable('SI_COLLECT_FAILED')).toBe(true)
    expect(isRetryable('SI_CLIPBOARD_FAILED')).toBe(false)
    expect(isRetryable('UNKNOWN')).toBe(false)
  })
})

describe('errorMessage', () => {
  it('已知码取文案，未知码回退通用文案', () => {
    expect(errorMessage('SI_COLLECT_FAILED')).toBe('采集系统信息失败')
    expect(errorMessage('SI_CLIPBOARD_FAILED')).toBe('复制失败（剪贴板不可用）')
    expect(errorMessage('NOPE')).toBe('操作失败')
  })
})

describe('isStructuredError', () => {
  it('形状匹配返回 true，普通 Error 返回 false', () => {
    expect(isStructuredError({ code: 'SI_COLLECT_FAILED', message: 'x' })).toBe(true)
    expect(isStructuredError(new Error('x'))).toBe(false)
  })
})
