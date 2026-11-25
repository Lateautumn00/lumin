/**
 * @file errors.test.ts 错误码单测
 * @author cuilanchao
 * @date 2026-11-20
 */
import { describe, expect, it } from 'vitest'
import { errorMessage, errnoCode, isRetryable, isStructuredError, toolError } from './errors'

describe('toolError', () => {
  it('生成结构化错误（带/不带 detail）', () => {
    expect(toolError('ZP_SOURCE_INVALID')).toEqual({
      code: 'ZP_SOURCE_INVALID',
      message: '无法读取源文件或文件夹（不存在或无权限）'
    })
    expect(toolError('ZP_TARGET_INVALID', 'C:\\a\\b.zip')).toMatchObject({
      code: 'ZP_TARGET_INVALID',
      detail: 'C:\\a\\b.zip'
    })
    expect(toolError('ZP_TASK_FAILED', '')?.detail).toBeUndefined()
  })
})

describe('isRetryable', () => {
  it('四类可重试，其余不可', () => {
    expect(isRetryable('ZP_SOURCE_INVALID')).toBe(true)
    expect(isRetryable('ZP_ARCHIVE_INVALID')).toBe(true)
    expect(isRetryable('ZP_TARGET_INVALID')).toBe(true)
    expect(isRetryable('ZP_TASK_FAILED')).toBe(true)
    expect(isRetryable('ZP_TOO_MANY_ENTRIES')).toBe(false)
    expect(isRetryable('ZP_ARCHIVE_TOO_LARGE')).toBe(false)
    expect(isRetryable('ZP_INVALID_PAYLOAD')).toBe(false)
    expect(isRetryable('UNKNOWN')).toBe(false)
  })
})

describe('errorMessage', () => {
  it('已知码返回文案，未知码回退通用文案', () => {
    expect(errorMessage('ZP_ARCHIVE_INVALID')).toBe('压缩包无法读取或已损坏')
    expect(errorMessage('SOMETHING_ELSE')).toBe('操作失败')
  })
})

describe('共享工具透传', () => {
  it('isStructuredError 仅认非 Error 的合规对象', () => {
    expect(isStructuredError({ code: 'ZP_TARGET_INVALID', message: 'x' })).toBe(true)
    expect(isStructuredError(new Error('boom'))).toBe(false)
    expect(isStructuredError(null)).toBe(false)
  })

  it('errnoCode 取 E 码', () => {
    expect(errnoCode({ code: 'EPERM' })).toBe('EPERM')
    expect(errnoCode(new Error('x'))).toBe('')
  })
})
