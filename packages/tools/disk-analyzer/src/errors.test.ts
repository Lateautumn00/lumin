/**
 * @file errors.test.ts 错误码文案/可重试判定单测
 * @author cuilanchao
 * @date 2026-11-20
 */
import { describe, expect, it } from 'vitest'
import {
  DISK_ANALYZER_ERROR_CODES,
  errnoCode,
  errorMessage,
  isRetryable,
  isStructuredError,
  toolError
} from './errors'

describe('toolError', () => {
  it('按码给出中文文案，detail 可省略', () => {
    expect(toolError('DA_ROOT_INVALID')).toEqual({
      code: 'DA_ROOT_INVALID',
      message: '无法读取扫描目录（不存在、不是目录或无权限）'
    })
    expect(toolError('DA_SCAN_FAILED', 'EACCES')).toEqual({
      code: 'DA_SCAN_FAILED',
      message: '扫描失败（任务超时或异常中断）',
      detail: 'EACCES'
    })
    expect(toolError('DA_SCAN_FAILED', '')).not.toHaveProperty('detail')
  })

  it('每个错误码都有文案', () => {
    for (const code of DISK_ANALYZER_ERROR_CODES) {
      expect(toolError(code).message.length).toBeGreaterThan(0)
    }
  })
})

describe('isRetryable / errorMessage', () => {
  it('根目录非法与扫描失败可重试，其余不可', () => {
    expect(isRetryable('DA_ROOT_INVALID')).toBe(true)
    expect(isRetryable('DA_SCAN_FAILED')).toBe(true)
    expect(isRetryable('DA_TOO_MANY_FILES')).toBe(false)
    expect(isRetryable('DA_INVALID_PAYLOAD')).toBe(false)
  })

  it('未知码回退通用文案', () => {
    expect(errorMessage('DA_ROOT_INVALID')).toBe('无法读取扫描目录（不存在、不是目录或无权限）')
    expect(errorMessage('UNKNOWN_CODE')).toBe('操作失败')
  })
})

describe('委托 shared', () => {
  it('isStructuredError 拒绝 Error 实例，errnoCode 取 code', () => {
    expect(isStructuredError(toolError('DA_SCAN_FAILED'))).toBe(true)
    expect(isStructuredError(new Error('x'))).toBe(false)
    expect(errnoCode({ code: 'EACCES' })).toBe('EACCES')
    expect(errnoCode(null)).toBe('')
  })
})
