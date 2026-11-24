/**
 * @file storage.test.ts 存储读写、损坏重建与孤儿 PNG 清理单测（断电恢复口径，不触真实磁盘）
 * @author cuilanchao
 * @date 2026-11-24
 */
import { describe, expect, it, vi } from 'vitest'
import {
  cleanupOrphanImages,
  loadEntries,
  saveEntries,
  type ImageFs,
  type StorageFs
} from './storage'
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

const sample: Entry[] = [{ id: 'a', text: '第一条', createdAt: 10, pinned: false, type: 'text' }]

/** 图片条目样本（M61） */
const IMAGE: Entry = {
  id: 'img',
  text: '',
  createdAt: 20,
  pinned: false,
  type: 'image',
  width: 100,
  height: 80,
  bytes: 64,
  sha1: 'sha',
  thumb: 'data:image/png;base64,x'
}

function makeImageFs(
  files: string[],
  listError?: NodeJS.ErrnoException
): ImageFs & { removed: string[] } {
  const removed: string[] = []
  return {
    removed,
    listFiles: () => {
      if (listError !== undefined) throw listError
      return files
    },
    removeImage: (id) => {
      removed.push(id)
    }
  }
}

function errno(code: string): NodeJS.ErrnoException {
  const err = new Error(`${code}: boom`) as NodeJS.ErrnoException
  err.code = code
  return err
}

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

describe('cleanupOrphanImages（M61 孤儿 PNG 清理）', () => {
  it('删除 JSON 未引用的孤儿 PNG（保留引用，非 png 文件忽略）', () => {
    const imageFs = makeImageFs(['img.png', 'orphan.png', 'note.txt'])
    expect(cleanupOrphanImages([IMAGE, ...sample], imageFs)).toEqual(['orphan.png'])
    expect(imageFs.removed).toEqual(['orphan'])
  })

  it('全部被引用时零删除', () => {
    const imageFs = makeImageFs(['img.png', 'note.txt'])
    expect(cleanupOrphanImages([IMAGE], imageFs)).toEqual([])
    expect(imageFs.removed).toEqual([])
  })

  it('文本条目 id 不受保护（仅 type=image 的 PNG 免删）', () => {
    const imageFs = makeImageFs(['a.png'])
    expect(cleanupOrphanImages(sample, imageFs)).toEqual(['a.png'])
    expect(imageFs.removed).toEqual(['a'])
  })

  it('目录不存在（ENOENT）静默返回空', () => {
    const imageFs = makeImageFs([], errno('ENOENT'))
    expect(cleanupOrphanImages([IMAGE], imageFs)).toEqual([])
    expect(imageFs.removed).toEqual([])
  })

  it('其他目录错误原样抛出（调用方 warn）', () => {
    const imageFs = makeImageFs([], errno('EACCES'))
    expect(() => cleanupOrphanImages([], imageFs)).toThrow('EACCES')
  })
})
