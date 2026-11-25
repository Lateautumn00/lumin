/**
 * @file errors.test.ts
 * @author cuilanchao
 * @date 2026-11-25
 * @description 结构化错误码与可重试判定单测。
 */
import { describe, expect, it } from 'vitest'
import { errnoCode, isRetryable, isStructuredError, toolError } from './errors'

describe('toolError', () => {
  it('按码生成中文文案', () => {
    expect(toolError('PR_PDF_PASSWORD')).toEqual({
      code: 'PR_PDF_PASSWORD',
      message: 'PDF 已加密，请先解除密码保护'
    })
  })

  it('detail 非空时携带；空串不携带', () => {
    expect(toolError('PR_PRINT_FAILED', 'printer offline')).toEqual({
      code: 'PR_PRINT_FAILED',
      message: '打印失败，请重试或检查打印机',
      detail: 'printer offline'
    })
    expect(toolError('PR_PRINT_FAILED', '')).not.toHaveProperty('detail')
  })
})

describe('isRetryable', () => {
  it('锁占用/转换/打印失败可重试', () => {
    expect(isRetryable('PR_LOCKED')).toBe(true)
    expect(isRetryable('PR_CONVERT_FAILED')).toBe(true)
    expect(isRetryable('PR_PRINT_BUSY')).toBe(true)
  })

  it('密码/格式错误不可重试', () => {
    expect(isRetryable('PR_PDF_PASSWORD')).toBe(false)
    expect(isRetryable('UNKNOWN')).toBe(false)
  })
})

describe('isStructuredError / errnoCode', () => {
  it('透传结构化错误，Error 实例不算', () => {
    expect(isStructuredError({ code: 'PR_NOT_FOUND', message: 'x' })).toBe(true)
    expect(isStructuredError(new Error('x'))).toBe(false)
  })

  it('从对象取 errno 码', () => {
    expect(errnoCode({ code: 'EBUSY' })).toBe('EBUSY')
    expect(errnoCode(new Error('x'))).toBe('')
  })
})
