/**
 * @file IPC schema 单测（pick-file / compare-files 信封与回包类型，spec §4）
 * @author cuilanchao
 * @date 2026-11-24
 * @description 覆盖：空对象信封、左右路径非空、忽略选项缺省 false、未知键剥离、
 *              非法载荷拒绝、200MB 上限与 1MB 二进制块常量口径。
 */
import { describe, expect, it } from 'vitest'

import {
  BINARY_CHUNK_BYTES,
  FILE_COMPARE_MAX_BYTES,
  compareFilesPayloadSchema,
  pickFilePayloadSchema
} from './schema'

describe('pickFilePayloadSchema', () => {
  it('空对象信封通过', () => {
    expect(pickFilePayloadSchema.safeParse({}).success).toBe(true)
  })

  it('非法载荷（null / 非对象）失败', () => {
    expect(pickFilePayloadSchema.safeParse(null).success).toBe(false)
    expect(pickFilePayloadSchema.safeParse('pick').success).toBe(false)
  })
})

describe('compareFilesPayloadSchema', () => {
  it('左右路径非空通过且忽略选项缺省 false', () => {
    const parsed = compareFilesPayloadSchema.safeParse({ left: 'a.txt', right: 'b.txt' })
    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    expect(parsed.data).toEqual({
      left: 'a.txt',
      right: 'b.txt',
      ignoreWhitespace: false,
      ignoreCase: false
    })
  })

  it('缺失或空路径失败', () => {
    expect(compareFilesPayloadSchema.safeParse(null).success).toBe(false)
    expect(compareFilesPayloadSchema.safeParse({ left: 'a.txt' }).success).toBe(false)
    expect(compareFilesPayloadSchema.safeParse({ left: '', right: 'b.txt' }).success).toBe(false)
    expect(compareFilesPayloadSchema.safeParse({ left: 'a.txt', right: '' }).success).toBe(false)
  })

  it('显式忽略选项生效且未知键被剥离', () => {
    const parsed = compareFilesPayloadSchema.safeParse({
      left: 'a.txt',
      right: 'b.txt',
      ignoreWhitespace: true,
      unknown: 1
    })
    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    expect(parsed.data.ignoreWhitespace).toBe(true)
    expect(parsed.data.ignoreCase).toBe(false)
    expect('unknown' in parsed.data).toBe(false)
  })

  it('非布尔忽略选项失败', () => {
    expect(
      compareFilesPayloadSchema.safeParse({ left: 'a', right: 'b', ignoreCase: 'yes' }).success
    ).toBe(false)
  })
})

describe('常量口径（spec §4）', () => {
  it('单文件上限 200MB、二进制块 1MB', () => {
    expect(FILE_COMPARE_MAX_BYTES).toBe(200 * 1024 * 1024)
    expect(BINARY_CHUNK_BYTES).toBe(1024 * 1024)
  })
})
