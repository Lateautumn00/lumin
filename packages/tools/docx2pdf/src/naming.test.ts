import { describe, expect, it } from 'vitest'
import { resolveOutputPath } from './naming'

describe('resolveOutputPath', () => {
  it('有扩展名：替换为 .pdf', () => {
    expect(resolveOutputPath('C:\\in\\报告.docx', () => false)).toBe('C:\\in\\报告.pdf')
  })

  it('无扩展名 / 点开头：直接追加 .pdf', () => {
    expect(resolveOutputPath('C:\\in\\FILE', () => false)).toBe('C:\\in\\FILE.pdf')
    expect(resolveOutputPath('.hidden', () => false)).toBe('.hidden.pdf')
  })

  it('冲突依次递增 (1)(2)…', () => {
    const taken = new Set(['C:\\in\\a.pdf', 'C:\\in\\a(1).pdf'])
    expect(resolveOutputPath('C:\\in\\a.docx', (path) => taken.has(path))).toBe('C:\\in\\a(2).pdf')
  })

  it('99 个后缀全占用 → null', () => {
    expect(resolveOutputPath('C:\\in\\a.docx', () => true)).toBeNull()
  })
})
