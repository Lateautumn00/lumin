/**
 * @file contract.test.ts 纯函数契约单测（算法归一 / 期望哈希解析 / 比对 / TSV）
 * @author cuilanchao
 * @date 2026-11-19
 */
import { describe, expect, it } from 'vitest'
import {
  algorithmLabel,
  fileNameOf,
  formatTime,
  matchesExpected,
  normalizeAlgorithms,
  normalizeExpected,
  toTsv
} from './contract'
import type { HashFileResult } from './schema'

/** 单条成功结果 */
function okResult(path: string, sha256: string): HashFileResult {
  return {
    path,
    size: 3,
    mtimeMs: 0,
    hashes: { sha256 },
    status: 'ok'
  }
}

describe('normalizeAlgorithms', () => {
  it('过滤未知值、去重、按固定顺序', () => {
    expect(normalizeAlgorithms(['sha256', 'md5', 'md5', 'sha512'])).toEqual([
      'md5',
      'sha256',
      'sha512'
    ])
    expect(normalizeAlgorithms(['sha512', 'sha1'])).toEqual(['sha1', 'sha512'])
    expect(normalizeAlgorithms([])).toEqual([])
    expect(normalizeAlgorithms(['sha1'])).toEqual(['sha1'])
    expect(normalizeAlgorithms(['sha384'])).toEqual([])
  })
})

describe('algorithmLabel', () => {
  it('展示名固定', () => {
    expect(algorithmLabel('md5')).toBe('MD5')
    expect(algorithmLabel('sha1')).toBe('SHA-1')
    expect(algorithmLabel('sha256')).toBe('SHA-256')
    expect(algorithmLabel('sha512')).toBe('SHA-512')
  })
})

describe('normalizeExpected', () => {
  it('按长度识别算法（32/40/64/128）', () => {
    expect(normalizeExpected('9dd4e461268c8034f5c8564e155c67a6')).toMatchObject({
      algorithm: 'md5'
    })
    expect(normalizeExpected('a9993e364706816aba3e25717850c26c9cd0d89d')).toMatchObject({
      algorithm: 'sha1'
    })
    expect(
      normalizeExpected(
        'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
      )
    ).toMatchObject({ algorithm: 'sha256' })
    expect(normalizeExpected('a'.repeat(128))).toMatchObject({ algorithm: 'sha512' })
  })

  it('前缀优先（md5:/sha1:/sha256:/sha512:/sha-512:）并去 0x', () => {
    expect(normalizeExpected('MD5:0X9DD4E461268C8034F5C8564E155C67A6')).toEqual({
      value: '9dd4e461268c8034f5c8564e155c67a6',
      algorithm: 'md5'
    })
    expect(
      normalizeExpected('sha-256: ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    ).toMatchObject({ algorithm: 'sha256' })
    expect(normalizeExpected('SHA-512:' + 'b'.repeat(128))).toEqual({
      value: 'b'.repeat(128),
      algorithm: 'sha512'
    })
  })

  it('去空白并小写', () => {
    expect(normalizeExpected(' 9DD4E461 268C8034 F5C8564E 155C67A6 ')).toMatchObject({
      value: '9dd4e461268c8034f5c8564e155c67a6',
      algorithm: 'md5'
    })
  })

  it('非法输入返回 null（空串/未知前缀/长度不符/非十六进制）', () => {
    expect(normalizeExpected('')).toBeNull()
    expect(normalizeExpected('   ')).toBeNull()
    expect(normalizeExpected('sha512:abc')).toBeNull()
    expect(normalizeExpected('abc')).toBeNull()
    expect(normalizeExpected('z'.repeat(32))).toBeNull()
    expect(normalizeExpected(`md5:${'a'.repeat(64)}`)).toBeNull()
  })
})

describe('matchesExpected', () => {
  const expected = normalizeExpected('sha256:' + 'a'.repeat(64))

  it('仅状态成功且对应算法摘要一致时命中', () => {
    if (expected === null) throw new Error('fixture 非法')
    expect(matchesExpected(okResult('C:\\a.txt', 'a'.repeat(64)), expected)).toBe(true)
    expect(matchesExpected(okResult('C:\\a.txt', 'b'.repeat(64)), expected)).toBe(false)
    expect(
      matchesExpected(
        { path: 'C:\\a.txt', size: 0, mtimeMs: 0, hashes: {}, status: 'failed', code: 'FH_HASH_FAILED' },
        expected
      )
    ).toBe(false)
  })
})

describe('formatTime / fileNameOf', () => {
  it('时间补零到秒', () => {
    const ms = new Date(2026, 0, 2, 3, 4, 5).getTime()
    expect(formatTime(ms)).toBe('2026-01-02 03:04:05')
  })

  it('取路径最后一段（兼容 / 与 \\）', () => {
    expect(fileNameOf('C:\\a\\b\\c.txt')).toBe('c.txt')
    expect(fileNameOf('C:/a/b/c.txt')).toBe('c.txt')
    expect(fileNameOf('plain.txt')).toBe('plain.txt')
  })
})

describe('toTsv', () => {
  it('表头含所选算法列，失败行带错误码', () => {
    const tsv = toTsv(
      [
        okResult('C:\\a.txt', 'a'.repeat(64)),
        {
          path: 'C:\\b.txt',
          size: 0,
          mtimeMs: new Date(2026, 0, 1).getTime(),
          hashes: {},
          status: 'failed',
          code: 'FH_FILE_INVALID'
        }
      ],
      ['md5', 'sha256']
    )
    const rows = tsv.split('\n').map((line) => line.split('\t'))
    expect(rows[0]).toEqual(['文件路径', '大小', '修改时间', 'MD5', 'SHA-256', '状态'])
    expect(rows[1]?.[0]).toBe('C:\\a.txt')
    expect(rows[1]?.[1]).toBe('3 B')
    expect(rows[1]?.[3]).toBe('')
    expect(rows[1]?.[4]).toBe('a'.repeat(64))
    expect(rows[1]?.[5]).toBe('成功')
    expect(rows[2]?.[5]).toBe('失败（FH_FILE_INVALID）')
  })

  it('SHA-512 列按已选算法序追加', () => {
    const full = 'c'.repeat(128)
    const tsv = toTsv([{ ...okResult('C:\\a.txt', 'a'.repeat(64)), hashes: { sha512: full } }], [
      'sha256',
      'sha512'
    ])
    const rows = tsv.split('\n').map((line) => line.split('\t'))
    expect(rows[0]).toEqual(['文件路径', '大小', '修改时间', 'SHA-256', 'SHA-512', '状态'])
    expect(rows[1]?.[3]).toBe('')
    expect(rows[1]?.[4]).toBe(full)
  })
})
