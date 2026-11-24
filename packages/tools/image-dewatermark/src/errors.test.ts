/**
 * @file errors.test.ts 错误码文案与可重试判定单测
 * @author cuilanchao
 * @date 2026-11-24
 * @description 覆盖带/不带 detail、可重试集合、委托 shared 的结构化错误与 errno 判定
 */
import { describe, expect, it } from 'vitest'
import { errnoCode, isRetryable, isStructuredError, toolError } from './errors'

describe('toolError', () => {
  it('无 detail 时只带 code/message', () => {
    expect(toolError('IDW_NO_REGIONS')).toEqual({
      code: 'IDW_NO_REGIONS',
      message: '请先框选至少一个去水印区域'
    })
  })

  it('有 detail 时附加技术细节', () => {
    expect(toolError('IDW_WRITE_FAILED', 'ENOSPC')).toEqual({
      code: 'IDW_WRITE_FAILED',
      message: '写入失败，请检查磁盘空间与目录权限',
      detail: 'ENOSPC'
    })
    expect(toolError('IDW_WRITE_FAILED', '')).not.toHaveProperty('detail')
  })
})

describe('isRetryable', () => {
  it('IO/处理类可重试，参数与取消类不可重试', () => {
    expect(isRetryable('IDW_FILE_LOCKED')).toBe(true)
    expect(isRetryable('IDW_WRITE_FAILED')).toBe(true)
    expect(isRetryable('OP_TIMEOUT')).toBe(true)
    expect(isRetryable('IDW_NO_REGIONS')).toBe(false)
    expect(isRetryable('CANCELLED')).toBe(false)
    expect(isRetryable('WHATEVER')).toBe(false)
  })
})

describe('shared 委托', () => {
  it('识别结构化错误与 errno', () => {
    expect(isStructuredError(toolError('IDW_INPUT_INVALID'))).toBe(true)
    expect(isStructuredError(new Error('plain'))).toBe(false)
    expect(errnoCode(Object.assign(new Error('busy'), { code: 'EBUSY' }))).toBe('EBUSY')
    expect(errnoCode(new Error('plain'))).toBe('')
  })
})
