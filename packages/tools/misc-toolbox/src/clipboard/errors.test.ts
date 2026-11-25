/**
 * @file errors.test.ts 结构化错误单测
 * @author cuilanchao
 * @date 2026-11-23
 */
import { describe, expect, it } from 'vitest'
import { errnoCode, isRetryable, isStructuredError, toolError } from './errors'

describe('toolError', () => {
  it('缺省不带 detail，传空串同样省略', () => {
    expect(toolError('CH_STORAGE_FAILED')).toEqual({
      code: 'CH_STORAGE_FAILED',
      message: '剪贴板历史读写失败'
    })
    expect(toolError('INVALID_INPUT', '')).toEqual({
      code: 'INVALID_INPUT',
      message: '请求格式无效'
    })
  })

  it('传入 detail 时保留技术细节', () => {
    expect(toolError('CH_STORAGE_FAILED', 'ENOSPC')).toEqual({
      code: 'CH_STORAGE_FAILED',
      message: '剪贴板历史读写失败',
      detail: 'ENOSPC'
    })
  })

  it('图片文件丢失中文文案', () => {
    expect(toolError('CH_IMAGE_MISSING')).toEqual({
      code: 'CH_IMAGE_MISSING',
      message: '图片文件已丢失'
    })
  })
})

describe('isRetryable', () => {
  it('存储读写失败与图片文件丢失可重试', () => {
    expect(isRetryable('CH_STORAGE_FAILED')).toBe(true)
    expect(isRetryable('CH_IMAGE_MISSING')).toBe(true)
    expect(isRetryable('INVALID_INPUT')).toBe(false)
    expect(isRetryable('UNKNOWN')).toBe(false)
  })
})

describe('isStructuredError / errnoCode', () => {
  it('形状匹配返回 true，普通 Error 返回 false', () => {
    expect(isStructuredError({ code: 'CH_STORAGE_FAILED', message: 'x' })).toBe(true)
    expect(isStructuredError(new Error('x'))).toBe(false)
  })

  it('errnoCode 取系统码，无码回退空串', () => {
    expect(errnoCode({ code: 'ENOSPC' })).toBe('ENOSPC')
    expect(errnoCode(new Error('x'))).toBe('')
  })
})
