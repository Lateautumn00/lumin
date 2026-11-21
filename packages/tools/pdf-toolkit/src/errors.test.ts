import { describe, expect, it } from 'vitest'
import { isRetryable, PDF_TOOLKIT_ERROR_CODES, toolError } from './errors'

describe('pdf-toolkit errors（spec §7）', () => {
  it('每个错误码都有中文文案', () => {
    for (const code of PDF_TOOLKIT_ERROR_CODES) {
      const error = toolError(code)
      expect(error.code).toBe(code)
      expect(error.message.length).toBeGreaterThan(0)
      expect(error.detail).toBeUndefined()
    }
  })

  it('detail 为空串时不带字段', () => {
    expect(toolError('PT_OP_FAILED', '')).toEqual({
      code: 'PT_OP_FAILED',
      message: '处理失败，请重试或查看详情'
    })
    expect(toolError('PT_OP_FAILED', 'boom').detail).toBe('boom')
  })

  it('可重试判定与 spec 一致', () => {
    expect(isRetryable('PT_PDF_LOCKED')).toBe(true)
    expect(isRetryable('PT_RANGE_INVALID')).toBe(true)
    expect(isRetryable('PT_OUTPUT_WRITE_FAILED')).toBe(true)
    expect(isRetryable('PT_INPUT_INVALID')).toBe(false)
    expect(isRetryable('PT_NO_PAGES_LEFT')).toBe(false)
    expect(isRetryable('PT_PDF_ENCRYPTED')).toBe(false)
    expect(isRetryable('PT_WATERMARK_INVALID')).toBe(false)
    expect(isRetryable('PT_PAGE_NUMBER_INVALID')).toBe(false)
    expect(isRetryable('UNKNOWN')).toBe(false)
  })

  it('水印/页码错误码文案（M17）', () => {
    expect(toolError('PT_WATERMARK_INVALID').message).toBe('水印内容无效，请检查文字或图片')
    expect(toolError('PT_PAGE_NUMBER_INVALID').message).toBe(
      '页码参数无效，请检查格式、位置与起始页'
    )
  })
})

describe('M38 错误码', () => {
  it('提取/压缩错误码文案', () => {
    expect(toolError('PT_NO_TEXT_LAYER').message).toBe('未检测到文本层（可能为扫描件）')
    expect(toolError('PT_NO_IMAGES').message).toBe('未找到可提取的图片')
    expect(toolError('PT_TOO_MANY_IMAGES').message).toBe('图片数量超过 2000 张上限，请缩小页码范围')
  })

  it('提取/压缩错误码均不可重试', () => {
    expect(isRetryable('PT_NO_TEXT_LAYER')).toBe(false)
    expect(isRetryable('PT_NO_IMAGES')).toBe(false)
    expect(isRetryable('PT_TOO_MANY_IMAGES')).toBe(false)
  })
})
