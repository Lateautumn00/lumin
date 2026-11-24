/**
 * @file storage.test.ts 存储读写与损坏重建单测（断电恢复口径，不触真实磁盘）
 * @author cuilanchao
 * @date 2026-11-23
 */
import { describe, expect, it, vi } from 'vitest'
import { loadEntries, saveEntries, type StorageFs } from './storage'
import type { Entry } from './schema'

const FILE = 'C:/fake/userData/clipboard-history.json'

function makeFs(files: Record<string, string> = {}): StorageFs & { removed: string[] } {
  const map = new Map(Object.entries(files))
  const removed: string[] = []
  return {
    removed,
    readFile: (path) => {
      const value = map.get(path)
      if (value === undefined) {
        const err = new Error(`ENOENT: no such file, open '${path}'`) as NodeJS.ErrnoException
        err.code = 'ENOENT'
        throw err
      }
      return value
    },
    remove: (path) => {
      removed.push(path)
      map.delete(path)
    },
    writeFile: (path, data) => {
      map.set(path, data)
    }
  }
}

const sample: Entry[] = [{ id: 'a', text: '第一条', createdAt: 10, pinned: false }]

describe('loadEntries', () => {
  it('ENOENT（首次运行）返回空表且不视为损坏', () => {
    const fs = makeFs()
    expect(loadEntries(FILE, fs)).toEqual({ entries: [], corrupted: '' })
    expect(fs.removed).toHaveLength(0)
  })

  it('合法 JSON 返回条目', () => {
    const fs = makeFs({ [FILE]: JSON.stringify(sample) })
    expect(loadEntries(FILE, fs)).toEqual({ entries: sample, corrupted: '' })
    expect(fs.removed).toHaveLength(0)
  })

  it('损坏 JSON（半写）删除重建空表并回传原因', () => {
    const fs = makeFs({ [FILE]: '[{"id":"a","te' })
    const result = loadEntries(FILE, fs)
    expect(result.entries).toEqual([])
    expect(result.corrupted).not.toBe('')
    expect(fs.removed).toEqual([FILE])
  })

  it('结构不符（缺字段）同样按损坏重建', () => {
    const fs = makeFs({ [FILE]: JSON.stringify([{ id: 'a' }]) })
    const result = loadEntries(FILE, fs)
    expect(result.entries).toEqual([])
    expect(result.corrupted).not.toBe('')
    expect(fs.removed).toEqual([FILE])
  })

  it('损坏重建时删除失败不阻断（仍返回空表）', () => {
    const fs = makeFs({ [FILE]: 'not-json' })
    vi.spyOn(fs, 'remove').mockImplementation(() => {
      throw new Error('EPERM')
    })
    const result = loadEntries(FILE, fs)
    expect(result.entries).toEqual([])
    expect(result.corrupted).not.toBe('')
  })

  it('非 ENOENT 读失败原样抛出（调用方转 CH_STORAGE_FAILED）', () => {
    const fs = makeFs()
    vi.spyOn(fs, 'readFile').mockImplementation(() => {
      const err = new Error('permission denied, open') as NodeJS.ErrnoException
      err.code = 'EACCES'
      throw err
    })
    expect(() => loadEntries(FILE, fs)).toThrow(/permission denied/)
  })
})

describe('saveEntries', () => {
  it('序列化为 JSON 写入', () => {
    const fs = makeFs()
    saveEntries(FILE, sample, fs)
    expect(fs.readFile(FILE)).toBe(JSON.stringify(sample))
  })
})
