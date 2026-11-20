/**
 * @file contract.test.ts 纯函数单测（相对路径 / 配对分类 / 汇总 / 排序 / 筛选 / 折叠）
 * @author cuilanchao
 * @date 2026-11-20
 */
import { describe, expect, it } from 'vitest'
import {
  classifyPair,
  filterEntries,
  joinRelPath,
  joinRootPath,
  limitEntries,
  normalizeRelPath,
  pathKey,
  sortEntries,
  summarize
} from './contract'
import type { CompareEntry } from './schema'

/** 构造配对结果（测试默认字段） */
function entry(overrides: Partial<CompareEntry>): CompareEntry {
  return {
    path: 'a.txt',
    status: 'same',
    sizeLeft: 1,
    sizeRight: 1,
    mtimeLeft: 0,
    mtimeRight: 0,
    sizeChanged: false,
    mtimeChanged: false,
    ...overrides
  }
}

describe('normalizeRelPath / pathKey', () => {
  it('统一分隔符、压缩重复与 ./、去首尾分隔符', () => {
    expect(normalizeRelPath('a\\b//c/')).toBe('a/b/c')
    expect(normalizeRelPath('./a/b')).toBe('a/b')
    expect(normalizeRelPath('/a/./b/')).toBe('a/b')
    expect(normalizeRelPath('')).toBe('')
  })

  it('pathKey 小写化用于大小写不敏感配对', () => {
    expect(pathKey('Docs\\A.TXT')).toBe('docs/a.txt')
  })
})

describe('joinRelPath / joinRootPath', () => {
  it('相对路径拼接处理空段', () => {
    expect(joinRelPath('', 'a')).toBe('a')
    expect(joinRelPath('a\\b', 'c.txt')).toBe('a/b/c.txt')
    expect(joinRelPath('a', '')).toBe('a')
    expect(joinRelPath('', '')).toBe('')
  })

  it('按 root 分隔符风格拼绝对路径', () => {
    expect(joinRootPath('C:\\data', 'a\\b.txt')).toBe('C:\\data\\a\\b.txt')
    expect(joinRootPath('C:\\data\\', 'a/b.txt')).toBe('C:\\data\\a\\b.txt')
    expect(joinRootPath('D:/data', 'a/b.txt')).toBe('D:/data/a/b.txt')
    expect(joinRootPath('C:\\data', '')).toBe('C:\\data')
    expect(joinRootPath('', 'a/b.txt')).toBe('a/b.txt')
  })
})

describe('classifyPair', () => {
  it('仅左侧 / 仅右侧', () => {
    expect(classifyPair('x\\y.txt', { size: 3, mtimeMs: 100 }, null, true)).toMatchObject({
      path: 'x/y.txt',
      status: 'only-left',
      sizeLeft: 3,
      sizeRight: null,
      mtimeLeft: 100,
      mtimeRight: null,
      sizeChanged: false,
      mtimeChanged: false
    })
    expect(classifyPair('r.txt', null, { size: 5, mtimeMs: 200 }, true)).toMatchObject({
      status: 'only-right',
      sizeLeft: null,
      sizeRight: 5,
      mtimeLeft: null,
      mtimeRight: 200
    })
    expect(classifyPair('none.txt', null, null, true)).toBeNull()
  })

  it('大小不同 / 时间差超容差 / 相同', () => {
    expect(
      classifyPair('s.txt', { size: 1, mtimeMs: 0 }, { size: 2, mtimeMs: 0 }, true)
    ).toMatchObject({ status: 'different', sizeChanged: true, mtimeChanged: false })
    expect(
      classifyPair('t.txt', { size: 2, mtimeMs: 0 }, { size: 2, mtimeMs: 2001 }, true)
    ).toMatchObject({ status: 'different', sizeChanged: false, mtimeChanged: true })
    expect(
      classifyPair('b.txt', { size: 1, mtimeMs: 0 }, { size: 2, mtimeMs: 3000 }, true)
    ).toMatchObject({ status: 'different', sizeChanged: true, mtimeChanged: true })
    expect(
      classifyPair('same.txt', { size: 2, mtimeMs: 0 }, { size: 2, mtimeMs: 2000 }, true)
    ).toMatchObject({ status: 'same', sizeChanged: false, mtimeChanged: false })
  })

  it('关闭修改时间比较后时间差不算差异', () => {
    expect(
      classifyPair('t.txt', { size: 2, mtimeMs: 0 }, { size: 2, mtimeMs: 9999 }, false)
    ).toMatchObject({ status: 'same', mtimeChanged: false })
  })

  it('容差可注入且负数按 0 处理', () => {
    expect(
      classifyPair('t.txt', { size: 2, mtimeMs: 0 }, { size: 2, mtimeMs: 5 }, true, -1)
    ).toMatchObject({ status: 'different', mtimeChanged: true })
    expect(
      classifyPair('t.txt', { size: 2, mtimeMs: 0 }, { size: 2, mtimeMs: 5 }, true, 10)
    ).toMatchObject({ status: 'same' })
  })
})

describe('summarize', () => {
  it('四类计数', () => {
    const entries = [
      entry({ status: 'only-left' }),
      entry({ status: 'only-left' }),
      entry({ status: 'only-right' }),
      entry({ status: 'different' }),
      entry({ status: 'same' })
    ]
    expect(summarize(entries)).toEqual({ onlyLeft: 2, onlyRight: 1, different: 1, same: 1 })
  })
})

describe('sortEntries / filterEntries / limitEntries', () => {
  const entries: CompareEntry[] = [
    entry({ path: 'z\\same.txt', status: 'same' }),
    entry({ path: 'm.txt', status: 'different' }),
    entry({ path: 'b.txt', status: 'only-right' }),
    entry({ path: 'a.txt', status: 'only-left' }),
    entry({ path: 'A2.txt', status: 'only-left' })
  ]

  it('状态优先级 → 路径升序，且不改原数组', () => {
    const sorted = sortEntries(entries)
    expect(sorted.map((item) => item.path)).toEqual([
      'a.txt',
      'A2.txt',
      'b.txt',
      'm.txt',
      'z\\same.txt'
    ])
    expect(entries[0]?.path).toBe('z\\same.txt')
  })

  it('状态筛选：all / changed / 具体状态', () => {
    expect(filterEntries(entries, { status: 'all', keyword: '' })).toHaveLength(5)
    expect(filterEntries(entries, { status: 'changed', keyword: '' })).toHaveLength(4)
    expect(
      filterEntries(entries, { status: 'only-left', keyword: '' }).map((item) => item.path)
    ).toEqual(['a.txt', 'A2.txt'])
    expect(filterEntries(entries, { status: 'same', keyword: '' })).toHaveLength(1)
  })

  it('关键字去空白、大小写不敏感包含', () => {
    expect(filterEntries(entries, { status: 'all', keyword: '  A.TXT ' })).toHaveLength(1)
    expect(filterEntries(entries, { status: 'all', keyword: '  ' })).toHaveLength(5)
    expect(filterEntries(entries, { status: 'all', keyword: 'zzz' })).toHaveLength(0)
  })

  it('折叠：前 N 条 + 其余计数，limit ≤ 0 全部隐藏', () => {
    expect(limitEntries(entries, 2)).toMatchObject({
      shown: [entries[0], entries[1]],
      hiddenCount: 3
    })
    expect(limitEntries(entries, 0)).toEqual({ shown: [], hiddenCount: 5 })
    expect(limitEntries([], 10)).toEqual({ shown: [], hiddenCount: 0 })
  })
})
