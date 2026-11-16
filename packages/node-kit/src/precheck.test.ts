import { describe, expect, it } from 'vitest'
import { classifyPrecheckError, LOCK_ERRNOS } from './precheck'

function errno(code: string): Error {
  return Object.assign(new Error(`${code}: failed`), { code })
}

describe('classifyPrecheckError', () => {
  it('独占失败 errno → locked', () => {
    for (const code of ['EBUSY', 'EPERM', 'EACCES']) {
      expect(classifyPrecheckError(errno(code))).toBe('locked')
    }
    expect(LOCK_ERRNOS.has('EBUSY')).toBe(true)
  })

  it('ENOENT → not-found', () => {
    expect(classifyPrecheckError(errno('ENOENT'))).toBe('not-found')
  })

  it('其它 errno / 无 code / 非对象 → other', () => {
    expect(classifyPrecheckError(errno('EISDIR'))).toBe('other')
    expect(classifyPrecheckError(new Error('x'))).toBe('other')
    expect(classifyPrecheckError({ code: 42 })).toBe('other')
    expect(classifyPrecheckError(null)).toBe('other')
    expect(classifyPrecheckError('ENOENT')).toBe('other')
  })
})
