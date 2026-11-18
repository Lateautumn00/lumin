/**
 * @file errors.ts 单测：错误码文案回退与 toolError 的 detail 缺省行为
 * @author cuilanchao
 * @date 2026-11-18
 * @description 覆盖 UI 按 code → 中文文案展示的两条分支
 */
import { describe, expect, it } from 'vitest'
import { errorMessage, toolError } from './errors'

describe('errorMessage', () => {
  it('已知码 → 中文文案', () => {
    expect(errorMessage('TT_JSON_INVALID')).toBe('JSON 格式不正确')
  })

  it('未知码回退原码（避免空白提示）', () => {
    expect(errorMessage('TT_UNKNOWN')).toBe('TT_UNKNOWN')
  })
})

describe('toolError', () => {
  it('未传 detail 时不带该字段', () => {
    expect(toolError('TT_URL_INVALID')).toEqual({
      code: 'TT_URL_INVALID',
      message: '不是有效的 URL 编码文本'
    })
  })

  it('空串 detail 同样不带该字段', () => {
    expect(toolError('TT_BASE64_INVALID', '')).toEqual({
      code: 'TT_BASE64_INVALID',
      message: '不是有效的 Base64 文本'
    })
  })

  it('有 detail 时附带', () => {
    expect(toolError('TT_REGEX_INVALID', 'Invalid regular expression')).toEqual({
      code: 'TT_REGEX_INVALID',
      message: '正则表达式不正确',
      detail: 'Invalid regular expression'
    })
  })
})
