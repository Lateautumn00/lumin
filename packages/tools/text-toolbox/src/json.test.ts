/**
 * @file json.ts 单测：格式化/压缩/校验、错误行列定位、超限与空输入
 * @author cuilanchao
 * @date 2026-11-18
 * @description 覆盖 spec §2 JSON Tab 的全部成功/失败分支
 */
import { describe, expect, it } from 'vitest'
import { formatJson, minifyJson, parseJson, validateJson } from './json'
import { MAX_TEXT_BYTES } from './errors'

describe('formatJson', () => {
  it('2 空格缩进', () => {
    const result = formatJson('{"a":1,"b":[1,2]}', 2)
    expect(result).toEqual({ ok: true, value: '{\n  "a": 1,\n  "b": [\n    1,\n    2\n  ]\n}' })
  })

  it('4 空格缩进', () => {
    const result = formatJson('{"a":1}', 4)
    expect(result.ok && result.value).toBe('{\n    "a": 1\n}')
  })

  it('顶层标量可格式化', () => {
    expect(formatJson('42', 2)).toEqual({ ok: true, value: '42' })
  })
})

describe('minifyJson', () => {
  it('去掉冗余空白', () => {
    const result = minifyJson('{\n  "a": 1,\n  "b": [1, 2]\n}')
    expect(result).toEqual({ ok: true, value: '{"a":1,"b":[1,2]}' })
  })
})

describe('validateJson', () => {
  it('合法时返回输入字节数', () => {
    expect(validateJson('{"a":1}')).toEqual({ ok: true, value: { bytes: 7 } })
  })
})

describe('parseJson 失败分支', () => {
  it('语法错误带行列（多行文本）', () => {
    const result = parseJson('{\n  "a": 1,\n}')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('TT_JSON_INVALID')
    expect(result.position?.line).toBe(3)
    expect(result.error.detail).toContain('第 3 行')
  })

  it('意外结束定位到末尾', () => {
    const result = parseJson('{"a":')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.position).toEqual({ line: 1, column: 6 })
  })

  it('空输入归 TT_JSON_INVALID', () => {
    const result = parseJson('')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('TT_JSON_INVALID')
  })

  it('超过 5MB → TT_TEXT_TOO_LARGE', () => {
    const result = parseJson('x'.repeat(MAX_TEXT_BYTES + 1))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('TT_TEXT_TOO_LARGE')
  })

  it('中文错误消息不外泄原始异常对象', () => {
    const result = parseJson('{')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.message).toBe('JSON 格式不正确')
    expect(result.error.detail?.length).toBeGreaterThan(0)
  })
})
