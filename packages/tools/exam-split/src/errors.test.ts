import { describe, expect, it } from 'vitest'
import { isRetryable, toolError } from './errors'

describe('toolError', () => {
  it('无 detail 时不带 detail 字段', () => {
    expect(toolError('PDF_LOCKED')).toEqual({
      code: 'PDF_LOCKED',
      message: '文件被其他程序占用，请关闭后重试'
    })
  })

  it('带 detail 时附加上下文', () => {
    expect(toolError('PDF_ENCRYPTED', 'is encrypted')).toEqual({
      code: 'PDF_ENCRYPTED',
      message: 'PDF 已加密，请先解除密码再操作',
      detail: 'is encrypted'
    })
  })

  it('空串 detail 视同无 detail', () => {
    expect(toolError('OP_FAILED', '')).not.toHaveProperty('detail')
  })

  it('每个错误码都有非空中文文案（spec §5）', () => {
    const codes = [
      'PDF_NOT_FOUND',
      'PDF_LOCKED',
      'PDF_ENCRYPTED',
      'PDF_INVALID',
      'RANGE_INVALID',
      'NO_PAGES_LEFT',
      'OP_TIMEOUT',
      'OUTPUT_WRITE_FAILED',
      'OP_FAILED',
      'CANCELLED',
      'INVALID_PAYLOAD'
    ] as const
    for (const code of codes) {
      const error = toolError(code)
      expect(error.code).toBe(code)
      expect(error.message.length).toBeGreaterThan(0)
      expect(error.code).toMatch(/^[A-Z][A-Z0-9_]*$/)
    }
  })
})

describe('isRetryable（spec §5 操作入口）', () => {
  it('可重试码为占用/超时/写失败/处理失败', () => {
    for (const code of ['PDF_LOCKED', 'OP_TIMEOUT', 'OUTPUT_WRITE_FAILED', 'OP_FAILED']) {
      expect(isRetryable(code)).toBe(true)
    }
  })

  it('其余不可重试', () => {
    for (const code of ['PDF_NOT_FOUND', 'PDF_ENCRYPTED', 'RANGE_INVALID', 'CANCELLED']) {
      expect(isRetryable(code)).toBe(false)
    }
    expect(isRetryable('UNKNOWN')).toBe(false)
  })
})
