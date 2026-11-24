/**
 * @file 错误码与中文文案单测
 * @author cuilanchao
 * @date 2026-11-24
 * @description 覆盖 toolError 的 detail 分支、errorMessage 未知码回退、isRetryable 可重试集合。
 */
import { describe, expect, it } from 'vitest'
import {
  MINDMAP_ERROR_CODES,
  errorMessage,
  isRetryable,
  toolError,
  type MindmapErrorCode
} from './errors'

describe('errors', () => {
  it('toolError 不给 detail 时只含 code 与文案', () => {
    expect(toolError('MM_NOT_FOUND')).toEqual({ code: 'MM_NOT_FOUND', message: '文件不存在' })
  })

  it('toolError 带 detail 时原样附加，空串视为未提供', () => {
    expect(toolError('MM_LOCKED', 'EBUSY')).toEqual({
      code: 'MM_LOCKED',
      message: '文件被其他程序占用，请关闭后重试',
      detail: 'EBUSY'
    })
    expect(toolError('MM_LOCKED', '')).toEqual({
      code: 'MM_LOCKED',
      message: '文件被其他程序占用，请关闭后重试'
    })
  })

  it('每个错误码都有中文文案', () => {
    for (const code of MINDMAP_ERROR_CODES) {
      expect(errorMessage(code)).not.toBe(code)
    }
  })

  it('未知错误码回退原码，避免空白提示', () => {
    expect(errorMessage('UNKNOWN_CODE')).toBe('UNKNOWN_CODE')
  })

  it('可重试集合与 spec §8 一致', () => {
    const retryable: MindmapErrorCode[] = [
      'MM_LOCKED',
      'MM_FILE_CHANGED',
      'MM_SAVE_FAILED',
      'MM_READ_FAILED',
      'MM_EXPORT_FAILED'
    ]
    for (const code of MINDMAP_ERROR_CODES) {
      expect(isRetryable(code)).toBe(retryable.includes(code))
    }
    expect(isRetryable('SOMETHING_ELSE')).toBe(false)
  })
})
