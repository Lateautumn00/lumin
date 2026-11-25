/**
 * @file contract.test.ts 默认勾选/回收归一/汇总单测
 * @author cuilanchao
 * @date 2026-11-19
 */
import { describe, expect, it } from 'vitest'
import { autoSelect, removePaths, summarize } from './contract'
import type { DuplicateGroup } from './schema'

/** 构造重复组（size=100，mtime 与路径可指定） */
function group(files: { path: string; mtimeMs: number }[], size = 100): DuplicateGroup {
  return {
    size,
    hash: files.map((file) => file.path).join('|'),
    files: files.map((file) => ({ ...file, size })),
    wastedBytes: size * (files.length - 1)
  }
}

describe('autoSelect', () => {
  it('每组保留最早一份，其余勾选', () => {
    const groups = [
      group([
        { path: 'C:\\b.txt', mtimeMs: 200 },
        { path: 'C:\\a.txt', mtimeMs: 100 },
        { path: 'C:\\c.txt', mtimeMs: 300 }
      ])
    ]
    expect([...autoSelect(groups)]).toEqual(['C:\\b.txt', 'C:\\c.txt'])
  })

  it('同修改时间按路径升序保留第一项', () => {
    const groups = [
      group([
        { path: 'C:\\z.txt', mtimeMs: 100 },
        { path: 'C:\\a.txt', mtimeMs: 100 }
      ])
    ]
    expect([...autoSelect(groups)]).toEqual(['C:\\z.txt'])
  })

  it('空结果返回空集合', () => {
    expect(autoSelect([]).size).toBe(0)
  })
})

describe('removePaths', () => {
  it('移除已删除路径并按剩余数重算可释放空间', () => {
    const groups = [
      group([
        { path: 'a', mtimeMs: 1 },
        { path: 'b', mtimeMs: 2 },
        { path: 'c', mtimeMs: 3 },
        { path: 'd', mtimeMs: 4 }
      ])
    ]
    const next = removePaths(groups, new Set(['a', 'b']))
    expect(next).toHaveLength(1)
    expect(next[0]?.files.map((file) => file.path)).toEqual(['c', 'd'])
    expect(next[0]?.wastedBytes).toBe(100)
  })

  it('组内剩余不足 2 项时整组丢弃', () => {
    const groups = [
      group([
        { path: 'a', mtimeMs: 1 },
        { path: 'b', mtimeMs: 2 }
      ])
    ]
    expect(removePaths(groups, new Set(['a']))).toEqual([])
  })

  it('结果按可释放空间降序重排', () => {
    const small = group(
      [
        { path: 's1', mtimeMs: 1 },
        { path: 's2', mtimeMs: 2 }
      ],
      10
    )
    const large = group(
      [
        { path: 'l1', mtimeMs: 1 },
        { path: 'l2', mtimeMs: 2 },
        { path: 'l3', mtimeMs: 3 }
      ],
      1000
    )
    expect(removePaths([small, large], new Set()).map((item) => item.size)).toEqual([1000, 10])
  })
})

describe('summarize', () => {
  it('累计组数/文件数/可释放空间', () => {
    const groups = [
      group([
        { path: 'a', mtimeMs: 1 },
        { path: 'b', mtimeMs: 2 }
      ]),
      group(
        [
          { path: 'c', mtimeMs: 1 },
          { path: 'd', mtimeMs: 2 },
          { path: 'e', mtimeMs: 3 }
        ],
        50
      )
    ]
    expect(summarize(groups)).toEqual({ groups: 2, files: 5, wastedBytes: 100 + 100 })
    expect(summarize([])).toEqual({ groups: 0, files: 0, wastedBytes: 0 })
  })
})
