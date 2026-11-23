import { describe, expect, it } from 'vitest'
import { MEDIA_CONVERT_ERROR_CODES, errorMessage, isRetryable, toolError } from './errors'

describe('错误码与文案', () => {
  it('全部错误码都有中文文案', () => {
    for (const code of MEDIA_CONVERT_ERROR_CODES) {
      const error = toolError(code)
      expect(error.code).toBe(code)
      expect(error.message.length).toBeGreaterThan(0)
      expect(error.detail).toBeUndefined()
    }
  })

  it('detail 透传', () => {
    expect(toolError('MC_FILE_CORRUPT', 'Invalid data').detail).toBe('Invalid data')
    expect(toolError('MC_FILE_CORRUPT', '').detail).toBeUndefined()
  })

  it('未知码回退通用文案', () => {
    expect(errorMessage('SOMETHING_ELSE')).toBe('处理失败，请重试')
    expect(errorMessage('MC_NO_FILES')).toBe('请先添加音视频文件')
  })

  it('可重试判定', () => {
    expect(isRetryable('MC_PROBE_FAILED')).toBe(true)
    expect(isRetryable('MC_OUTPUT_WRITE_FAILED')).toBe(true)
    expect(isRetryable('MC_FILE_CORRUPT')).toBe(true)
    expect(isRetryable('MC_TIMEOUT')).toBe(true)
    expect(isRetryable('MC_FILE_UNSUPPORTED')).toBe(false)
    expect(isRetryable('MC_CONTAINER_INCOMPATIBLE')).toBe(false)
    expect(isRetryable('MC_CANCELLED')).toBe(false)
  })
})
