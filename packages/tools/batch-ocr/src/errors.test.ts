/**
 * @file errors 单测（文案、detail 透传、重试判定）
 * @author cuilanchao
 * @date 2026-11-20
 */
import { describe, expect, it } from 'vitest'
import { errnoCode, isRetryable, isStructuredError, toolError } from './errors'

describe('toolError', () => {
  it('无 detail 时不带字段', () => {
    expect(toolError('BO_NO_TEXT')).toEqual({
      code: 'BO_NO_TEXT',
      message: '未识别到文字，请换更清晰的图片'
    })
  })

  it('有 detail 时透传技术细节', () => {
    expect(toolError('OUTPUT_WRITE_FAILED', 'ENOSPC')).toEqual({
      code: 'OUTPUT_WRITE_FAILED',
      message: '无法写出 TXT，请检查目录权限与剩余空间',
      detail: 'ENOSPC'
    })
  })
})

describe('isRetryable', () => {
  it('占用/无文字/模型缺失/超时/写盘失败可重试', () => {
    for (const code of [
      'BO_FILE_LOCKED',
      'BO_NO_TEXT',
      'MODEL_MISSING',
      'BO_OCR_FAILED',
      'OP_TIMEOUT',
      'OUTPUT_WRITE_FAILED'
    ]) {
      expect(isRetryable(code)).toBe(true)
    }
  })

  it('参数/不存在/过大/取消不可重试', () => {
    for (const code of [
      'BO_INVALID_PAYLOAD',
      'BO_FILE_NOT_FOUND',
      'BO_IMAGE_TOO_LARGE',
      'BO_TOO_MANY_FILES',
      'CANCELLED'
    ]) {
      expect(isRetryable(code)).toBe(false)
    }
  })
})

describe('shared 委托', () => {
  it('isStructuredError / errnoCode', () => {
    expect(isStructuredError({ code: 'BO_NO_TEXT', message: 'x' })).toBe(true)
    expect(isStructuredError(new Error('x'))).toBe(false)
    expect(errnoCode(Object.assign(new Error('x'), { code: 'ENOENT' }))).toBe('ENOENT')
    expect(errnoCode(new Error('x'))).toBe('')
  })
})
