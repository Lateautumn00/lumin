/**
 * @file 错误码单测
 * @author cuilanchao
 * @date 2026-11-21
 */
import { describe, expect, it } from 'vitest'
import { errorMessage, errnoCode, failure, toolError } from './errors'

describe('toolError', () => {
  it('无 detail 时只带 code 与中文文案', () => {
    expect(toolError('MD_JSON_INVALID')).toEqual({
      code: 'MD_JSON_INVALID',
      message: 'JSON 格式不合法，请检查语法'
    })
  })

  it('有 detail 时保留技术细节', () => {
    expect(toolError('MD_SAVE_FAILED', 'EPERM')).toEqual({
      code: 'MD_SAVE_FAILED',
      message: '导出失败，请检查输出目录',
      detail: 'EPERM'
    })
  })
})

describe('errorMessage', () => {
  it('已知码返回中文文案', () => {
    expect(errorMessage('MD_YAML_INVALID')).toBe('YAML 格式不合法，请检查语法')
  })

  it('未知码回退原码，避免空白提示', () => {
    expect(errorMessage('UNKNOWN_CODE')).toBe('UNKNOWN_CODE')
  })
})

describe('failure', () => {
  it('构造纯函数失败结果（带/不带 detail）', () => {
    expect(failure('MD_TS_NAME_INVALID')).toEqual({
      ok: false,
      code: 'MD_TS_NAME_INVALID',
      message: '根类型名不合法，需为合法 TypeScript 标识符'
    })
    expect(failure('MD_INPUT_TOO_LONG', '2000001')).toMatchObject({
      ok: false,
      code: 'MD_INPUT_TOO_LONG',
      detail: '2000001'
    })
  })
})

describe('errnoCode', () => {
  it('优先取 errno code，其次 Error.message，最后 UNKNOWN', () => {
    expect(errnoCode(Object.assign(new Error('x'), { code: 'EPERM' }))).toBe('EPERM')
    expect(errnoCode(new Error('boom'))).toBe('boom')
    expect(errnoCode(null)).toBe('UNKNOWN')
    expect(errnoCode({ code: 42 })).toBe('UNKNOWN')
  })
})
