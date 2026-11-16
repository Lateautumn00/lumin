import { describe, expect, it } from 'vitest'
import { MAX_CONFLICT_SUFFIX, resolveConflictPath } from './output-path'

function existing(paths: readonly string[]): (path: string) => boolean {
  const set = new Set(paths)
  return (path) => set.has(path)
}

describe('resolveConflictPath', () => {
  it('目标未占用时原样返回', () => {
    expect(resolveConflictPath('C:/out/试卷.pdf', existing([]))).toBe('C:/out/试卷.pdf')
  })

  it('冲突时依次递增 (1)(2)', () => {
    const exists = existing(['C:/out/试卷.pdf', 'C:/out/试卷(1).pdf'])
    expect(resolveConflictPath('C:/out/试卷.pdf', exists)).toBe('C:/out/试卷(2).pdf')
  })

  it('上限 99 耗尽返回 null', () => {
    const paths = ['a.pdf']
    for (let index = 1; index <= MAX_CONFLICT_SUFFIX; index += 1) paths.push(`a(${index}).pdf`)
    expect(resolveConflictPath('a.pdf', existing(paths))).toBeNull()
    expect(MAX_CONFLICT_SUFFIX).toBe(99)
  })

  it('maxSuffix 参数生效', () => {
    const exists = existing(['a.pdf', 'a(1).pdf'])
    expect(resolveConflictPath('a.pdf', exists, 1)).toBeNull()
    expect(resolveConflictPath('a.pdf', exists, 2)).toBe('a(2).pdf')
  })

  it('无扩展名时直接接后缀', () => {
    const exists = existing(['output'])
    expect(resolveConflictPath('output', exists)).toBe('output(1)')
  })

  it('目录中的点不视为扩展名', () => {
    const exists = existing(['C:/dir.v2/output'])
    expect(resolveConflictPath('C:/dir.v2/output', exists)).toBe('C:/dir.v2/output(1)')
  })

  it('多段扩展名只替换最后一段', () => {
    const exists = existing(['archive.tar.pdf'])
    expect(resolveConflictPath('archive.tar.pdf', exists)).toBe('archive.tar(1).pdf')
  })
})
