/**
 * @file errors.ts 单测（错误码集合 / 文案 / 可重试 / detail 省略）
 * @author cuilanchao
 * @date 2026-11-20
 * @description spec §6：码与中文文案同源，renderer 依赖 isRetryable 决定是否保留文件列表
 */
import { describe, expect, it } from 'vitest'
import {
  IMAGE_ROTATE_ERROR_CODES,
  errnoCode,
  isRetryable,
  isStructuredError,
  toolError
} from './errors'

describe('IMAGE_ROTATE_ERROR_CODES', () => {
  it('码集合固定（spec §6）', () => {
    expect([...IMAGE_ROTATE_ERROR_CODES]).toEqual([
      'IR_ENGINE_MISSING',
      'IR_FILE_UNSUPPORTED',
      'IR_FILE_CORRUPT',
      'IR_OUTPUT_WRITE_FAILED',
      'IR_CANCELLED'
    ])
  })
})

describe('toolError', () => {
  it('生成结构化错误与中文文案', () => {
    expect(toolError('IR_FILE_CORRUPT')).toEqual({
      code: 'IR_FILE_CORRUPT',
      message: '文件无法解析，可能已损坏或加密'
    })
    expect(toolError('IR_ENGINE_MISSING').message).toContain('ffmpeg')
  })

  it('空 detail 不写入字段，非空则透传', () => {
    expect(toolError('IR_OUTPUT_WRITE_FAILED', '')).not.toHaveProperty('detail')
    expect(toolError('IR_OUTPUT_WRITE_FAILED', 'ENOSPC')).toEqual({
      code: 'IR_OUTPUT_WRITE_FAILED',
      message: '输出目录不可写或磁盘空间不足',
      detail: 'ENOSPC'
    })
  })
})

describe('isRetryable', () => {
  it('仅输入损坏与输出写盘失败可重试', () => {
    expect(isRetryable('IR_FILE_CORRUPT')).toBe(true)
    expect(isRetryable('IR_OUTPUT_WRITE_FAILED')).toBe(true)
    expect(isRetryable('IR_ENGINE_MISSING')).toBe(false)
    expect(isRetryable('IR_CANCELLED')).toBe(false)
    expect(isRetryable('UNKNOWN')).toBe(false)
  })
})

describe('共享工具委托', () => {
  it('isStructuredError 与 errnoCode 行为一致', () => {
    expect(isStructuredError({ code: 'IR_FILE_CORRUPT', message: 'x' })).toBe(true)
    expect(isStructuredError(new Error('x'))).toBe(false)
    expect(errnoCode({ code: 'ENOSPC' })).toBe('ENOSPC')
    expect(errnoCode(null)).toBe('')
  })
})
