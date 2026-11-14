import { describe, expect, it } from 'vitest'
import { matchesAccept } from './accept'

describe('matchesAccept', () => {
  it('空 accept 放行', () => {
    expect(matchesAccept('anything.xyz', '')).toBe(true)
  })

  it('不含扩展名项的 accept 放行（MIME 由选择器过滤）', () => {
    expect(matchesAccept('a.txt', 'application/pdf')).toBe(true)
  })

  it('扩展名匹配（大小写不敏感）', () => {
    expect(matchesAccept('报告.docx', '.doc,.docx')).toBe(true)
    expect(matchesAccept('REPORT.DOC', '.doc,.docx')).toBe(true)
    expect(matchesAccept('a.docx', '.doc,.docx')).toBe(true)
  })

  it('扩展名不匹配拒绝', () => {
    expect(matchesAccept('report.pdf', '.doc,.docx')).toBe(false)
    expect(matchesAccept('docx', '.doc,.docx')).toBe(false)
  })

  it('容忍空格与空项', () => {
    expect(matchesAccept('a.docx', ' , .doc , .docx ,')).toBe(true)
    expect(matchesAccept('a.txt', ' , .doc , .docx ,')).toBe(false)
  })

  it('多段文件名按结尾扩展名判定', () => {
    expect(matchesAccept('v1.2.docx', '.docx')).toBe(true)
    expect(matchesAccept('v1.2.txt', '.docx')).toBe(false)
  })
})
