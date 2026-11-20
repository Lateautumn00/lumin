/**
 * @file contract.test.ts 占比/排序/汇总/过滤/折叠/面包屑单测
 * @author cuilanchao
 * @date 2026-11-20
 */
import { describe, expect, it } from 'vitest'
import {
  breadcrumbParts,
  breadcrumbPath,
  filterEntries,
  isInside,
  limitEntries,
  percentOf,
  sortEntries,
  summarize
} from './contract'
import type { DiskEntry } from './schema'

/** 构造条目（文件默认 fileCount=0） */
function entry(
  name: string,
  size: number,
  kind: 'dir' | 'file' = 'file',
  fileCount = kind === 'dir' ? 1 : 0
): DiskEntry {
  return { name, path: `C:\\root\\${name}`, kind, size, fileCount }
}

describe('percentOf', () => {
  it('常规比例保留 1 位小数', () => {
    expect(percentOf(50, 100)).toBe(50)
    expect(percentOf(1, 3)).toBe(33.3)
    expect(percentOf(2, 3)).toBe(66.7)
  })

  it('0 与非法总量安全返回 0；超出上限夹到 100', () => {
    expect(percentOf(0, 100)).toBe(0)
    expect(percentOf(10, 0)).toBe(0)
    expect(percentOf(-5, 100)).toBe(0)
    expect(percentOf(200, 100)).toBe(100)
  })
})

describe('sortEntries', () => {
  it('大小降序 → 同大小目录优先 → 名称升序', () => {
    const input = [entry('b.txt', 5), entry('big', 10, 'dir'), entry('a.txt', 5), entry('z', 5, 'dir')]
    const sorted = sortEntries(input)
    expect(sorted.map((item) => item.name)).toEqual(['big', 'z', 'a.txt', 'b.txt'])
  })

  it('不修改原数组', () => {
    const input = [entry('a', 1), entry('b', 2)]
    const snapshot = input.map((item) => item.name)
    sortEntries(input)
    expect(input.map((item) => item.name)).toEqual(snapshot)
  })
})

describe('summarize', () => {
  it('累计总字节与文件/目录条目数', () => {
    const summary = summarize([
      entry('a', 10),
      entry('b', 20),
      entry('sub', 30, 'dir', 4)
    ])
    expect(summary).toEqual({ totalBytes: 60, files: 2, dirs: 1 })
    expect(summarize([])).toEqual({ totalBytes: 0, files: 0, dirs: 0 })
  })
})

describe('filterEntries', () => {
  it('阈值仅过滤文件，目录始终保留', () => {
    const entries = [entry('a.txt', 10), entry('b.txt', 2000), entry('sub', 0, 'dir', 0)]
    expect(filterEntries(entries, 1024).map((item) => item.name)).toEqual(['b.txt', 'sub'])
  })

  it('阈值为 0 时等价于复制全部', () => {
    const entries = [entry('a', 0)]
    const filtered = filterEntries(entries, 0)
    expect(filtered).toEqual(entries)
    expect(filtered).not.toBe(entries)
  })
})

describe('limitEntries', () => {
  it('截取前 N 项并汇总隐藏项数与字节', () => {
    const entries = [entry('a', 10), entry('b', 20), entry('c', 30)]
    const limited = limitEntries(entries, 2)
    expect(limited.shown.map((item) => item.name)).toEqual(['a', 'b'])
    expect(limited.hiddenCount).toBe(1)
    expect(limited.hiddenBytes).toBe(30)
  })

  it('不足上限无隐藏；上限 ≤0 全部隐藏', () => {
    const entries = [entry('a', 10)]
    expect(limitEntries(entries, 5)).toMatchObject({ hiddenCount: 0, hiddenBytes: 0 })
    expect(limitEntries(entries, 0)).toMatchObject({
      shown: [],
      hiddenCount: 1,
      hiddenBytes: 10
    })
  })
})

describe('isInside', () => {
  it('同一路径与任意层级子路径为真，大小写不敏感', () => {
    expect(isInside('C:\\a', 'C:\\a')).toBe(true)
    expect(isInside('C:\\a', 'C:\\a\\b\\c.txt')).toBe(true)
    expect(isInside('C:\\a', 'c:\\A\\b')).toBe(true)
  })

  it('同名前缀但非整段、不同盘符、祖先方向均为假', () => {
    expect(isInside('C:\\a', 'C:\\ab')).toBe(false)
    expect(isInside('C:\\a', 'D:\\a\\b')).toBe(false)
    expect(isInside('C:\\a\\b', 'C:\\a')).toBe(false)
    expect(isInside('', 'C:\\a')).toBe(false)
  })
})

describe('breadcrumbParts', () => {
  it('返回相对段名且保留原始大小写', () => {
    expect(breadcrumbParts('C:\\', 'C:\\Users\\Me')).toEqual(['Users', 'Me'])
    expect(breadcrumbParts('C:\\Users', 'C:\\Users\\Me\\Docs')).toEqual(['Me', 'Docs'])
    expect(breadcrumbParts('C:\\Users', 'C:\\Users')).toEqual([])
  })

  it('不在根下返回空数组', () => {
    expect(breadcrumbParts('C:\\Users', 'C:\\Other')).toEqual([])
  })
})

describe('breadcrumbPath', () => {
  it('按深度拼出绝对路径（Windows 分隔符）', () => {
    expect(breadcrumbPath('C:\\', ['Users', 'Me'], -1)).toBe('C:\\')
    expect(breadcrumbPath('C:\\', ['Users', 'Me'], 0)).toBe('C:\\Users')
    expect(breadcrumbPath('C:\\Users', ['Me', 'Docs'], 1)).toBe('C:\\Users\\Me\\Docs')
  })

  it('POSIX 根路径保持 / 分隔符', () => {
    expect(breadcrumbPath('/home', ['me', 'docs'], 0)).toBe('/home/me')
    expect(breadcrumbPath('/', ['me'], 0)).toBe('/me')
  })
})
