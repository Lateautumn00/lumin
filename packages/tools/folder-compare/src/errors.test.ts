/**
 * @file errors.test.ts 结构化错误单测
 * @author cuilanchao
 * @date 2026-11-20
 */
import { describe, expect, it } from 'vitest'
import { errorMessage, isRetryable, isStructuredError, toolError } from './errors'

describe('toolError', () => {
  it('无 detail 时不带字段', () => {
    expect(toolError('FC_INVALID_PAYLOAD')).toEqual({
      code: 'FC_INVALID_PAYLOAD',
      message: '参数无效'
    })
    expect(toolError('FC_COMPARE_FAILED', '')).toEqual({
      code: 'FC_COMPARE_FAILED',
      message: '对比失败（任务超时或异常中断）'
    })
  })

  it('带 detail 时透传', () => {
    expect(toolError('FC_ROOT_INVALID', '左侧目录无法读取')).toMatchObject({
      code: 'FC_ROOT_INVALID',
      detail: '左侧目录无法读取'
    })
  })
})

describe('isRetryable / errorMessage / isStructuredError', () => {
  it('可重试集合为 ROOT_INVALID / COMPARE_FAILED', () => {
    expect(isRetryable('FC_ROOT_INVALID')).toBe(true)
    expect(isRetryable('FC_COMPARE_FAILED')).toBe(true)
    expect(isRetryable('FC_INVALID_PAYLOAD')).toBe(false)
    expect(isRetryable('FC_TOO_MANY_FILES')).toBe(false)
    expect(isRetryable('UNKNOWN')).toBe(false)
  })

  it('文案查表与未知码回退', () => {
    expect(errorMessage('FC_TOO_MANY_FILES')).toContain('20 万')
    expect(errorMessage('UNKNOWN')).toBe('操作失败')
  })

  it('isStructuredError 识别结构化错误', () => {
    expect(isStructuredError(toolError('FC_INVALID_PAYLOAD'))).toBe(true)
    expect(isStructuredError(new Error('boom'))).toBe(false)
  })
})
