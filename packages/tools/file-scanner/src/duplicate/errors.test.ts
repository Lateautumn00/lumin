/**
 * @file errors.test.ts 错误码/文案/可重试判定单测
 * @author cuilanchao
 * @date 2026-11-19
 */
import { describe, expect, it } from 'vitest'
import {
  DUPLICATE_FINDER_ERROR_CODES,
  errnoCode,
  errorMessage,
  isRetryable,
  isStructuredError,
  toolError
} from './errors'

describe('toolError', () => {
  it('缺省 detail 时不带字段（toEqual 精确）', () => {
    expect(toolError('DF_ROOT_INVALID')).toEqual({
      code: 'DF_ROOT_INVALID',
      message: '无法读取扫描目录（不存在、不是目录或无权限）'
    })
    expect(toolError('DF_SCAN_FAILED', '')).toEqual({
      code: 'DF_SCAN_FAILED',
      message: '扫描失败（任务超时或异常中断）'
    })
  })

  it('提供 detail 时附带', () => {
    expect(toolError('DF_TOO_MANY_FILES', '200001')).toMatchObject({
      code: 'DF_TOO_MANY_FILES',
      detail: '200001'
    })
  })
})

describe('isRetryable / errorMessage', () => {
  it('仅 ROOT_INVALID / SCAN_FAILED 可重试', () => {
    expect(DUPLICATE_FINDER_ERROR_CODES).toHaveLength(4)
    expect(isRetryable('DF_ROOT_INVALID')).toBe(true)
    expect(isRetryable('DF_SCAN_FAILED')).toBe(true)
    expect(isRetryable('DF_INVALID_PAYLOAD')).toBe(false)
    expect(isRetryable('DF_TOO_MANY_FILES')).toBe(false)
    expect(isRetryable('UNKNOWN')).toBe(false)
  })

  it('文案映射与未知码回退', () => {
    expect(errorMessage('DF_INVALID_PAYLOAD')).toBe('参数无效')
    expect(errorMessage('DF_TOO_MANY_FILES')).toBe('目录文件超过 20 万个，请缩小范围或提高大小阈值')
    expect(errorMessage('NOT_A_CODE')).toBe('操作失败')
  })
})

describe('委托 shared 判定', () => {
  it('结构化错误识别与 errno 提取', () => {
    expect(isStructuredError(toolError('DF_SCAN_FAILED'))).toBe(true)
    expect(isStructuredError(new Error('plain'))).toBe(false)
    expect(errnoCode(Object.assign(new Error('denied'), { code: 'EACCES' }))).toBe('EACCES')
    expect(errnoCode(new Error('plain'))).toBe('')
  })
})
