import { describe, expect, it } from 'vitest'

import { TEXT_DIFF_ERROR_CODES, errorMessage, toolError } from './errors'

describe('TEXT_DIFF_ERROR_CODES', () => {
  it('码集合固定为 6 个（M62 扩展文件比较三码 + 信封 INVALID_INPUT）', () => {
    expect(TEXT_DIFF_ERROR_CODES).toEqual([
      'TD_TOO_LARGE',
      'TD_CLIPBOARD_FAILED',
      'TD_FILE_READ_FAILED',
      'TD_FILE_TOO_LARGE',
      'TD_UNSUPPORTED_ENCODING',
      'INVALID_INPUT'
    ])
  })
})

describe('toolError', () => {
  it('构造状态化错误并带中文文案', () => {
    expect(toolError('TD_TOO_LARGE')).toEqual({
      code: 'TD_TOO_LARGE',
      message: '文本过大，单侧最多 20,000 行或 1,000,000 字符'
    })
  })

  it('detail 非空时附加', () => {
    expect(toolError('TD_CLIPBOARD_FAILED', 'clipboard unavailable')).toEqual({
      code: 'TD_CLIPBOARD_FAILED',
      message: '复制失败，请手动选择文本复制',
      detail: 'clipboard unavailable'
    })
  })

  it('detail 为空串时省略', () => {
    expect(toolError('TD_TOO_LARGE', '')).not.toHaveProperty('detail')
  })
})

describe('errorMessage', () => {
  it('已知码返回中文文案，未知码回退原码', () => {
    expect(errorMessage('TD_CLIPBOARD_FAILED')).toBe('复制失败，请手动选择文本复制')
    expect(errorMessage('TD_UNKNOWN')).toBe('TD_UNKNOWN')
  })

  it('文件比较三码与 INVALID_INPUT 中文文案（spec §5）', () => {
    expect(errorMessage('TD_FILE_READ_FAILED')).toBe('文件读取失败，请检查路径是否存在及读取权限')
    expect(errorMessage('TD_FILE_TOO_LARGE')).toBe('文件过大，单文件最大 200MB')
    expect(errorMessage('TD_UNSUPPORTED_ENCODING')).toBe('不支持的文件编码，请另存为 UTF-8 后重试')
    expect(errorMessage('INVALID_INPUT')).toBe('请求格式无效')
  })
})
