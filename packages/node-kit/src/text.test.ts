import { describe, expect, it } from 'vitest'
import { tail } from './text'

describe('tail', () => {
  it('不超上限时仅去首尾空白', () => {
    expect(tail('  abc  ')).toBe('abc')
    expect(tail('x'.repeat(2000))).toHaveLength(2000)
  })

  it('超上限时保尾部并以省略号起头', () => {
    const result = tail('x'.repeat(2001))
    expect(result).toHaveLength(2001)
    expect(result.startsWith('…')).toBe(true)
    expect(result.endsWith('x'.repeat(10))).toBe(true)
  })

  it('自定义上限生效', () => {
    expect(tail('abcdef', 3)).toBe('…def')
  })
})
