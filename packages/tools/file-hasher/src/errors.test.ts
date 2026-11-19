/**
 * @file errors.test.ts 错误码文案与重试判定单测
 * @author cuilanchao
 * @date 2026-11-19
 */
import { describe, expect, it } from 'vitest'
import { errorMessage, isRetryable, toolError } from './errors'

describe('toolError', () => {
  it('带 detail 时保留技术细节', () => {
    expect(toolError('FH_FILE_INVALID', 'ENOENT')).toEqual({
      code: 'FH_FILE_INVALID',
      message: '无法读取文件（不存在、非普通文件、超过 20 GB 或无权限）',
      detail: 'ENOENT'
    })
  })

  it('detail 为空/缺省时不带字段', () => {
    expect(toolError('FH_HASH_FAILED')).toEqual({
      code: 'FH_HASH_FAILED',
      message: '计算失败，文件可能被占用或读取中断'
    })
    expect(toolError('FH_HASH_FAILED', '')).not.toHaveProperty('detail')
  })
})

describe('isRetryable / errorMessage', () => {
  it('文件类错误可重试，入参错误不可重试', () => {
    expect(isRetryable('FH_FILE_INVALID')).toBe(true)
    expect(isRetryable('FH_HASH_FAILED')).toBe(true)
    expect(isRetryable('FH_INVALID_PAYLOAD')).toBe(false)
    expect(isRetryable('CANCELLED')).toBe(false)
  })

  it('未知码回退通用文案', () => {
    expect(errorMessage('FH_INVALID_PAYLOAD')).toBe('参数无效')
    expect(errorMessage('WHATEVER')).toBe('操作失败')
  })
})
