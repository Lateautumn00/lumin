/**
 * @file contract.test.ts 路径/命名纯函数单测（≥80% 包覆盖门禁）
 * @author cuilanchao
 * @date 2026-11-20
 */
import { describe, expect, it } from 'vitest'
import {
  defaultArchiveName,
  defaultTargetDir,
  entryKey,
  isZipFileName,
  joinArchivePath,
  joinFsPath,
  normalizeArchivePath,
  parentDirectory,
  partitionSourcePaths,
  progressPercent,
  uniqueArchiveEntryName
} from './contract'

describe('normalizeArchivePath（zip slip 防护核心）', () => {
  it('反斜杠归一、重复分隔符折叠、去掉 ./ 段', () => {
    expect(normalizeArchivePath('a\\b\\\\c.txt')).toBe('a/b/c.txt')
    expect(normalizeArchivePath('./a/./b.txt')).toBe('a/b.txt')
    expect(normalizeArchivePath('/a/b/')).toBeNull()
    expect(normalizeArchivePath('a/b/')).toBe('a/b')
  })

  it('拒绝绝对路径 / 盘符 / UNC / 任意 .. / 控制字符 / 空', () => {
    expect(normalizeArchivePath('../evil.txt')).toBeNull()
    expect(normalizeArchivePath('a/../../evil.txt')).toBeNull()
    expect(normalizeArchivePath('/etc/passwd')).toBeNull()
    expect(normalizeArchivePath('\\\\server\\share\\x')).toBeNull()
    expect(normalizeArchivePath('C:/Windows/x')).toBeNull()
    expect(normalizeArchivePath('c:x')).toBeNull()
    expect(normalizeArchivePath('a:b.txt')).toBeNull()
    expect(normalizeArchivePath('a\u0000b')).toBeNull()
    expect(normalizeArchivePath('')).toBeNull()
    expect(normalizeArchivePath('././')).toBeNull()
  })
})

describe('entryKey', () => {
  it('大小写不敏感', () => {
    expect(entryKey('A/B.TXT')).toBe('a/b.txt')
  })
})

describe('joinArchivePath', () => {
  it('忽略空段与多余分隔符', () => {
    expect(joinArchivePath('', 'a')).toBe('a')
    expect(joinArchivePath('/', 'a')).toBe('a')
    expect(joinArchivePath('dir', 'a.txt')).toBe('dir/a.txt')
    expect(joinArchivePath('dir/', '/a.txt')).toBe('dir/a.txt')
    expect(joinArchivePath('dir', '')).toBe('dir')
    expect(joinArchivePath('', '')).toBe('')
  })
})

describe('isZipFileName', () => {
  it('仅 .zip（大小写不敏感）且基名非空', () => {
    expect(isZipFileName('a.zip')).toBe(true)
    expect(isZipFileName('A.ZIP')).toBe(true)
    expect(isZipFileName('.zip')).toBe(false)
    expect(isZipFileName('a.zi')).toBe(false)
    expect(isZipFileName('zip')).toBe(false)
  })
})

describe('defaultArchiveName', () => {
  it('取首个源的基名', () => {
    expect(defaultArchiveName(['C:\\资料\\照片'])).toBe('照片.zip')
    expect(defaultArchiveName(['/home/a.txt'])).toBe('a.txt.zip')
    expect(defaultArchiveName(['C:\\a\\'])).toBe('a.zip')
    expect(defaultArchiveName([])).toBe('打包.zip')
    expect(defaultArchiveName([''])).toBe('打包.zip')
  })
})

describe('defaultTargetDir', () => {
  it('同目录同名文件夹', () => {
    expect(defaultTargetDir('C:\\a\\b.zip')).toBe('C:\\a\\b')
    expect(defaultTargetDir('/home/b.ZIP')).toBe('/home/b')
  })

  it('无 .zip 扩展名追加 -解压；无目录时返回裸名', () => {
    expect(defaultTargetDir('C:\\a\\b.rar')).toBe('C:\\a\\b.rar-解压')
    expect(defaultTargetDir('b.zip')).toBe('b')
  })
})

describe('joinFsPath / parentDirectory', () => {
  it('按目录风格拼接', () => {
    expect(joinFsPath('C:\\a\\', 'b.zip')).toBe('C:\\a\\b.zip')
    expect(joinFsPath('/a/', '/b.zip')).toBe('/a/b.zip')
    expect(joinFsPath('', 'b.zip')).toBe('b.zip')
  })

  it('取父目录（根路径空串）', () => {
    expect(parentDirectory('C:\\a\\b.txt')).toBe('C:\\a')
    expect(parentDirectory('/a/b.txt')).toBe('/a')
    expect(parentDirectory('C:\\')).toBe('')
    expect(parentDirectory('/a')).toBe('')
    expect(parentDirectory('')).toBe('')
  })
})

describe('partitionSourcePaths', () => {
  it('去空、大小写不敏感去重、保持顺序', () => {
    expect(partitionSourcePaths(['C:\\A', '', 'c:\\a', 'D:\\b', 'D:\\b\\'])).toEqual([
      'C:\\A',
      'D:\\b'
    ])
  })
})

describe('progressPercent', () => {
  it('边界与取整', () => {
    expect(progressPercent(0, 0)).toBe(0)
    expect(progressPercent(5, 0)).toBe(0)
    expect(progressPercent(1, 3)).toBe(33)
    expect(progressPercent(9, 3)).toBe(100)
    expect(progressPercent(-2, 10)).toBe(0)
  })
})

describe('uniqueArchiveEntryName', () => {
  it('无冲突原样返回', () => {
    expect(uniqueArchiveEntryName(new Set(), 'a.txt')).toBe('a.txt')
  })

  it('冲突时对文件名递增且保留目录前缀', () => {
    const occupied = new Set(['a.txt', 'dir/b.txt'])
    expect(uniqueArchiveEntryName(occupied, 'A.TXT')).toBe('A (1).TXT')
    expect(uniqueArchiveEntryName(occupied, 'dir/b.txt')).toBe('dir/b (1).txt')
    expect(uniqueArchiveEntryName(new Set(['dir/b (1).txt']), 'dir/b.txt')).toBe('dir/b.txt')
  })

  it('无扩展名时追加序号', () => {
    expect(uniqueArchiveEntryName(new Set(['readme']), 'readme')).toBe('readme (1)')
  })
})
