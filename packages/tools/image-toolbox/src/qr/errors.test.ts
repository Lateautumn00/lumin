/**
 * @file errors 单测（错误码文案与重试判定）
 * @author cuilanchao
 * @date 2026-11-19
 */
import { describe, expect, it } from 'vitest'
import { isRetryable, toolError } from './errors'

describe('toolError', () => {
  it('无 detail 时不带字段', () => {
    expect(toolError('QR_DECODE_FAILED')).toEqual({
      code: 'QR_DECODE_FAILED',
      message: '未识别到二维码，请换更清晰、完整的图片'
    })
  })

  it('有 detail 时透传技术细节', () => {
    expect(toolError('QR_OUTPUT_WRITE_FAILED', 'EPERM')).toEqual({
      code: 'QR_OUTPUT_WRITE_FAILED',
      message: '输出目录不可写或磁盘空间不足',
      detail: 'EPERM'
    })
  })
})

describe('isRetryable', () => {
  it('仅输出写盘失败可重试', () => {
    expect(isRetryable('QR_OUTPUT_WRITE_FAILED')).toBe(true)
    expect(isRetryable('QR_DECODE_FAILED')).toBe(false)
    expect(isRetryable('CANCELLED')).toBe(false)
  })
})
