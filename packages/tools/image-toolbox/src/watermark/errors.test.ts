/**
 * @file errors.test.ts 错误码文案/重试判定单测
 * @author cuilanchao
 * @date 2026-11-20
 */
import { describe, expect, it } from 'vitest'
import { IMAGE_WATERMARK_ERROR_CODES, isRetryable, toolError } from './errors'

describe('toolError', () => {
  it('带 detail 时保留，空 detail 省略', () => {
    expect(toolError('IW_FILE_LOCKED', 'EBUSY')).toEqual({
      code: 'IW_FILE_LOCKED',
      message: '图片被其他程序占用，请关闭后重试',
      detail: 'EBUSY'
    })
    expect(toolError('OP_TIMEOUT')).toEqual({
      code: 'OP_TIMEOUT',
      message: '处理超时（10 分钟），已终止'
    })
    expect(toolError('IW_WRITE_FAILED', '')).not.toHaveProperty('detail')
  })

  it('全部错误码都有非空中文文案', () => {
    for (const code of IMAGE_WATERMARK_ERROR_CODES) {
      const error = toolError(code)
      expect(error.code).toBe(code)
      expect(error.message.length).toBeGreaterThan(0)
    }
  })
})

describe('isRetryable', () => {
  it('可重试码返回 true，其余 false', () => {
    expect(isRetryable('IW_FILE_LOCKED')).toBe(true)
    expect(isRetryable('OP_TIMEOUT')).toBe(true)
    expect(isRetryable('CANCELLED')).toBe(false)
    expect(isRetryable('IW_INPUT_INVALID')).toBe(false)
    expect(isRetryable('UNKNOWN_CODE')).toBe(false)
  })
})
