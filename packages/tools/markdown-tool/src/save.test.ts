/**
 * @file 文件名清洗与扩展名白名单单测
 * @author cuilanchao
 * @date 2026-11-21
 */
import { describe, expect, it } from 'vitest'
import { EXTENSIONS, isSaveExtension, MAX_BASE_NAME, sanitizeBaseName } from './save'

describe('sanitizeBaseName', () => {
  it('合法中文/空格名保留', () => {
    expect(sanitizeBaseName('  我的 文档  ')).toBe('我的 文档')
  })

  it('非法字符替换为下划线', () => {
    expect(sanitizeBaseName('a/b\\c:d*e?f"g<h>i|j')).toBe('a_b_c_d_e_f_g_h_i_j')
    expect(sanitizeBaseName('a\tb\nc')).toBe('a_b_c')
  })

  it('去掉末尾点与空格；空回退 document', () => {
    expect(sanitizeBaseName('name...')).toBe('name')
    expect(sanitizeBaseName('   ')).toBe('document')
    expect(sanitizeBaseName('...')).toBe('document')
  })

  it('超长截断到 80 字符', () => {
    const result = sanitizeBaseName('a'.repeat(120))
    expect(result).toHaveLength(MAX_BASE_NAME)
  })
})

describe('isSaveExtension', () => {
  it('仅放行 html/ts/json/yaml', () => {
    for (const ext of EXTENSIONS) expect(isSaveExtension(ext)).toBe(true)
    expect(isSaveExtension('md')).toBe(false)
    expect(isSaveExtension('')).toBe(false)
  })
})
