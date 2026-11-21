/**
 * @file errors.ts 单测：文案/可重试判定/detail 缺省与 shared 委托
 * @author cuilanchao
 * @date 2026-11-21
 */
import { describe, expect, it } from 'vitest'
import { errnoCode, errorMessage, isRetryable, isStructuredError, toolError } from './errors'

describe('errorMessage', () => {
  it('已知错误码返回 spec 中文文案', () => {
    expect(errorMessage('DT_INVALID_PORT')).toBe('端口号须为 1–65535 的整数')
    expect(errorMessage('DT_PORT_IN_USE')).toBe('端口已被占用')
    expect(errorMessage('DT_JWT_INVALID')).toBe('JWT 格式无效')
  })

  it('未知错误码回退通用文案', () => {
    expect(errorMessage('DT_UNKNOWN')).toBe('操作失败')
  })
})

describe('toolError', () => {
  it('不带 detail 时不产生该字段', () => {
    expect(toolError('DT_KILL_SELF_FORBIDDEN')).toEqual({
      code: 'DT_KILL_SELF_FORBIDDEN',
      message: '不能结束本程序进程'
    })
  })

  it('detail 非空时写入', () => {
    expect(toolError('DT_NETSTAT_FAILED', 'EPERM')).toEqual({
      code: 'DT_NETSTAT_FAILED',
      message: '查询端口占用失败',
      detail: 'EPERM'
    })
  })

  it('detail 为空串时视为缺省', () => {
    expect('detail' in toolError('DT_ROOT_INVALID', '')).toBe(false)
  })
})

describe('isRetryable', () => {
  it('外部命令/服务器错误可重试', () => {
    expect(isRetryable('DT_NETSTAT_FAILED')).toBe(true)
    expect(isRetryable('DT_PORT_IN_USE')).toBe(true)
    expect(isRetryable('DT_SERVER_FAILED')).toBe(true)
  })

  it('参数与自我保护错误不可重试', () => {
    expect(isRetryable('DT_INVALID_PORT')).toBe(false)
    expect(isRetryable('DT_KILL_SELF_FORBIDDEN')).toBe(false)
    expect(isRetryable('DT_JWT_INVALID')).toBe(false)
    expect(isRetryable('UNKNOWN')).toBe(false)
  })
})

describe('shared 委托', () => {
  it('isStructuredError 透传 shared 判定（Error 实例不算）', () => {
    expect(isStructuredError({ code: 'DT_INVALID_PORT', message: 'x' })).toBe(true)
    expect(isStructuredError(new Error('boom'))).toBe(false)
  })

  it('errnoCode 读取 code 字段', () => {
    expect(errnoCode({ code: 'ENOENT' })).toBe('ENOENT')
    expect(errnoCode(new Error('x'))).toBe('')
  })
})
