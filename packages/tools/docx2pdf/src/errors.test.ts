import { describe, expect, it } from 'vitest'
import {
  DOCX2PDF_ERROR_CODES,
  errnoCode,
  isRetryable,
  isStructuredError,
  tail,
  toolError
} from './errors'

describe('toolError', () => {
  it('无 detail 不带 detail 字段，有 detail 则附带', () => {
    expect(toolError('CONVERT_TIMEOUT')).toEqual({
      code: 'CONVERT_TIMEOUT',
      message: '转换超时（60 秒），已终止'
    })
    expect(toolError('OUTPUT_WRITE_FAILED', 'ENOSPC')).toMatchObject({
      code: 'OUTPUT_WRITE_FAILED',
      detail: 'ENOSPC'
    })
  })

  it('全部错误码都有中文文案（spec §5 同步）', () => {
    for (const code of DOCX2PDF_ERROR_CODES) {
      const err = toolError(code)
      expect(err.message).toMatch(/[一-龥]/)
      expect(err.code).toBe(code)
    }
  })
})

describe('isRetryable', () => {
  it('可重试集合含锁/超时/产物/组件下载类，不含定位与参数类', () => {
    for (const code of [
      'INPUT_LOCKED',
      'CONVERT_TIMEOUT',
      'OUTPUT_MISSING',
      'OUTPUT_WRITE_FAILED',
      'CONVERT_FAILED',
      'DOWNLOAD_FAILED',
      'CHECKSUM_MISMATCH',
      'INSTALL_FAILED'
    ]) {
      expect(isRetryable(code)).toBe(true)
    }
    for (const code of [
      'SOFFICE_NOT_FOUND',
      'INPUT_NOT_FOUND',
      'INPUT_LOAD_FAILED',
      'SPAWN_FAILED'
    ]) {
      expect(isRetryable(code)).toBe(false)
    }
    expect(isRetryable('INTERNAL')).toBe(false)
  })
})

describe('isStructuredError', () => {
  it('工具结构化错误与共享结构化错误放行', () => {
    expect(isStructuredError(toolError('SPAWN_FAILED'))).toBe(true)
    expect(isStructuredError({ code: 'INTERNAL', message: 'x' })).toBe(true)
    expect(isStructuredError(new Error('x'))).toBe(false)
    expect(isStructuredError({ code: 42 })).toBe(false)
    // errno 码也是 UPPER_SNAKE，Error 实例必须一票否决（否则原始 fs 错误泄漏）
    expect(
      isStructuredError(Object.assign(new Error('EPERM: rename 失败'), { code: 'EPERM' }))
    ).toBe(false)
  })
})

describe('errnoCode / tail', () => {
  it('取 errno 字符串，无则空串', () => {
    expect(errnoCode({ code: 'ENOSPC' })).toBe('ENOSPC')
    expect(errnoCode(new Error('x'))).toBe('')
    expect(errnoCode(null)).toBe('')
    expect(errnoCode({ code: 7 })).toBe('')
  })

  it('tail 截尾到上限并加省略号', () => {
    expect(tail('  ok  ')).toBe('ok')
    expect(tail('a'.repeat(2010))).toHaveLength(2001)
    expect(tail('a'.repeat(2010)).startsWith('…')).toBe(true)
  })
})
