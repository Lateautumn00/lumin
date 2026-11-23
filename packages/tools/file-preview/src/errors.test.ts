import { describe, expect, it } from 'vitest'
import {
  FILE_PREVIEW_ERROR_CODES,
  errorMessage,
  isRetryable,
  toolError
} from './errors'

describe('错误码与文案', () => {
  it('全部错误码都有中文文案且无 detail', () => {
    for (const code of FILE_PREVIEW_ERROR_CODES) {
      const error = toolError(code)
      expect(error.code).toBe(code)
      expect(error.message.length).toBeGreaterThan(0)
      expect(error.detail).toBeUndefined()
    }
  })

  it('detail 透传与空串省略', () => {
    expect(toolError('FP_READ_FAILED', 'EACCES').detail).toBe('EACCES')
    expect(toolError('FP_READ_FAILED', '').detail).toBeUndefined()
  })

  it('未知码回退原码', () => {
    expect(errorMessage('SOMETHING_ELSE')).toBe('SOMETHING_ELSE')
    expect(errorMessage('FP_PDF_PASSWORD')).toBe('PDF 已加密，暂不支持预览')
  })

  it('可重试判定', () => {
    expect(isRetryable('FP_CONVERT_FAILED')).toBe(true)
    expect(isRetryable('FP_CONVERT_TIMEOUT')).toBe(true)
    expect(isRetryable('FP_PDF_RENDER_FAILED')).toBe(true)
    expect(isRetryable('FP_SOFFICE_MISSING')).toBe(false)
    expect(isRetryable('FP_UNSUPPORTED')).toBe(false)
  })
})
