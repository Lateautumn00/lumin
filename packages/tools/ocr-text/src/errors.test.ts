/**
 * @file errors 单测（文案、detail 透传、重试判定）
 * @author cuilanchao
 * @date 2026-11-19
 */
import { describe, expect, it } from 'vitest'
import { errnoCode, isRetryable, isStructuredError, toolError } from './errors'

describe('toolError', () => {
  it('无 detail 时不带字段', () => {
    expect(toolError('OCR_NO_TEXT')).toEqual({
      code: 'OCR_NO_TEXT',
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
      'OCR_FILE_LOCKED',
      'OCR_NO_TEXT',
      'MODEL_MISSING',
      'OCR_FAILED',
      'OP_TIMEOUT',
      'OUTPUT_WRITE_FAILED'
    ]) {
      expect(isRetryable(code)).toBe(true)
    }
  })

  it('参数/不存在/过大/取消不可重试', () => {
    for (const code of [
      'OCR_INVALID_PAYLOAD',
      'OCR_FILE_NOT_FOUND',
      'OCR_IMAGE_TOO_LARGE',
      'OCR_INPUT_INVALID',
      'CANCELLED'
    ]) {
      expect(isRetryable(code)).toBe(false)
    }
  })
})

describe('shared 委托', () => {
  it('isStructuredError / errnoCode 行为一致', () => {
    expect(isStructuredError(toolError('OCR_FAILED'))).toBe(true)
    expect(isStructuredError(new Error('x'))).toBe(false)
    expect(errnoCode(Object.assign(new Error('x'), { code: 'ENOENT' }))).toBe('ENOENT')
    expect(errnoCode(new Error('x'))).toBe('')
  })
})
