/**
 * @file errors.test.ts 错误码构造与重试判定（spec §6）
 * @author cuilanchao
 * @date 2026-11-20
 */
import { describe, expect, it } from 'vitest'
import { IMAGE_STITCH_ERROR_CODES, isRetryable, toolError } from './errors'

describe('toolError', () => {
  it('无 detail 时不含该字段', () => {
    expect(toolError('IS_INPUT_INVALID')).toEqual({
      code: 'IS_INPUT_INVALID',
      message: '图片不存在或不受支持'
    })
    expect(toolError('OP_TIMEOUT', '')).not.toHaveProperty('detail')
  })

  it('有 detail 时透传', () => {
    expect(toolError('IS_WRITE_FAILED', 'ENOSPC')).toEqual({
      code: 'IS_WRITE_FAILED',
      message: '写入失败，请检查磁盘空间与目录权限',
      detail: 'ENOSPC'
    })
  })

  it('每个码都有中文文案', () => {
    for (const code of IMAGE_STITCH_ERROR_CODES) {
      expect(toolError(code).message.length).toBeGreaterThan(0)
    }
  })
})

describe('isRetryable', () => {
  it('占用/损坏/目录/写入/超时可重试', () => {
    for (const code of [
      'IS_FILE_LOCKED',
      'IS_IMAGE_CORRUPT',
      'IS_OUTPUT_DIR_INVALID',
      'IS_WRITE_FAILED',
      'IS_PROCESS_FAILED',
      'OP_TIMEOUT'
    ]) {
      expect(isRetryable(code)).toBe(true)
    }
  })

  it('参数/输入/上限/取消不可重试', () => {
    for (const code of [
      'IS_INVALID_PAYLOAD',
      'IS_INPUT_INVALID',
      'IS_IMAGE_TOO_LARGE',
      'IS_OUTPUT_TOO_LARGE',
      'CANCELLED'
    ]) {
      expect(isRetryable(code)).toBe(false)
    }
  })
})
