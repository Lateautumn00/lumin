import { describe, expect, it } from 'vitest'
import {
  TEXT_EDITOR_ERROR_CODES,
  errorMessage,
  isRetryable,
  toolError,
  type TextEditorErrorCode
} from './errors'

describe('errors', () => {
  it('每个错误码都有中文文案', () => {
    for (const code of TEXT_EDITOR_ERROR_CODES) {
      expect(errorMessage(code)).not.toBe('')
      expect(errorMessage(code)).not.toBe(code)
    }
  })

  it('错误码全集与 spec 一致', () => {
    expect([...TEXT_EDITOR_ERROR_CODES]).toEqual([
      'TE_NOT_FOUND',
      'TE_LOCKED',
      'TE_TOO_LARGE',
      'TE_DECODE_FAILED',
      'TE_SAVE_FAILED',
      'TE_FILE_CHANGED',
      'TE_FILE_EXISTS',
      'TE_INVALID_PATH'
    ])
  })

  it('toolError 无 detail 时不带字段', () => {
    expect(toolError('TE_NOT_FOUND')).toEqual({
      code: 'TE_NOT_FOUND',
      message: '文件不存在或无法访问'
    })
    expect(toolError('TE_NOT_FOUND', '')).not.toHaveProperty('detail')
  })

  it('toolError 带 detail', () => {
    expect(toolError('TE_TOO_LARGE', '5242881')).toEqual({
      code: 'TE_TOO_LARGE',
      message: '文件超过 5 MiB，无法在编辑器中打开',
      detail: '5242881'
    })
  })

  it('未知错误码回退原码，避免空白提示', () => {
    expect(errorMessage('TE_UNKNOWN')).toBe('TE_UNKNOWN')
  })

  it('可重试错误码', () => {
    const retryable = TEXT_EDITOR_ERROR_CODES.filter((code) => isRetryable(code))
    expect(retryable).toEqual<TextEditorErrorCode[]>(['TE_LOCKED', 'TE_SAVE_FAILED'])
  })
})
