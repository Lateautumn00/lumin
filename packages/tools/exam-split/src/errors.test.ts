import { describe, expect, it } from 'vitest'
import { EXAM_SPLIT_ERROR_CODES, isRetryable, toolError } from './errors'

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

  it('每个错误码都有非空中文文案（spec §5/§10.5）', () => {
    for (const code of EXAM_SPLIT_ERROR_CODES) {
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

  it('OCR 错误码文案非空（spec §10.5）', () => {
    const codes = ['OCR_INPUT_INVALID', 'MODEL_MISSING', 'NO_REGIONS', 'OCR_FAILED'] as const
    for (const code of codes) {
      const error = toolError(code)
      expect(error.code).toBe(code)
      expect(error.message.length).toBeGreaterThan(0)
    }
  })

  it('OCR 可重试：MODEL_MISSING/NO_REGIONS/OCR_FAILED；OCR_INPUT_INVALID 不可重试', () => {
    for (const code of ['MODEL_MISSING', 'NO_REGIONS', 'OCR_FAILED']) {
      expect(isRetryable(code)).toBe(true)
    }
    expect(isRetryable('OCR_INPUT_INVALID')).toBe(false)
  })

  it('OCR 错误码带 detail', () => {
    expect(toolError('OCR_FAILED', 'session run failed')).toEqual({
      code: 'OCR_FAILED',
      message: '识别失败，请重试或查看详情',
      detail: 'session run failed'
    })
  })
})
