/**
 * @file schema.test.ts IPC schema 校验单测（边界/默认值/非法入参）
 * @author cuilanchao
 * @date 2026-11-19
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MIN_BYTES,
  MAX_SCAN_FILES,
  MIN_BYTES_OPTIONS,
  configResultSchema,
  duplicateGroupSchema,
  scanDoneSchema,
  scanPayloadSchema,
  setConfigPayloadSchema
} from './schema'

describe('常量', () => {
  it('默认 1MB、上限 20 万、预设 4 档且递增', () => {
    expect(DEFAULT_MIN_BYTES).toBe(1024 ** 2)
    expect(MAX_SCAN_FILES).toBe(200_000)
    expect(MIN_BYTES_OPTIONS).toHaveLength(4)
    expect([...MIN_BYTES_OPTIONS]).toEqual([...MIN_BYTES_OPTIONS].sort((a, b) => a - b))
  })
})

describe('scanPayloadSchema', () => {
  it('接受合法目录与选项', () => {
    expect(
      scanPayloadSchema.safeParse({ root: 'C:\\卷', recursive: true, minBytes: 1024 }).success
    ).toBe(true)
    expect(scanPayloadSchema.safeParse({ root: 'a', recursive: false, minBytes: 0 }).success).toBe(
      true
    )
  })

  it('空目录 / 负阈值 / 缺失字段拒绝', () => {
    expect(scanPayloadSchema.safeParse({ root: '', recursive: true, minBytes: 0 }).success).toBe(
      false
    )
    expect(
      scanPayloadSchema.safeParse({ root: 'a', recursive: true, minBytes: -1 }).success
    ).toBe(false)
    expect(scanPayloadSchema.safeParse({ root: 'a', recursive: true }).success).toBe(false)
    expect(scanPayloadSchema.safeParse({ root: 'a', recursive: 'yes', minBytes: 0 }).success).toBe(
      false
    )
  })
})

describe('duplicateGroupSchema / scanDoneSchema', () => {
  it('重复组至少 2 个文件', () => {
    const file = { path: 'C:\\a.txt', size: 5, mtimeMs: 1 }
    expect(
      duplicateGroupSchema.safeParse({ size: 5, hash: 'abc', files: [file, file], wastedBytes: 5 })
        .success
    ).toBe(true)
    expect(
      duplicateGroupSchema.safeParse({ size: 5, hash: 'abc', files: [file], wastedBytes: 0 }).success
    ).toBe(false)
    expect(
      duplicateGroupSchema.safeParse({ size: 5, hash: '', files: [file, file], wastedBytes: 5 })
        .success
    ).toBe(false)
  })

  it('负尺寸/负可释放空间/负计数拒绝', () => {
    expect(
      duplicateGroupSchema.safeParse({
        size: -1,
        hash: 'abc',
        files: [
          { path: 'a', size: -1, mtimeMs: 0 },
          { path: 'b', size: -1, mtimeMs: 0 }
        ],
        wastedBytes: -1
      }).success
    ).toBe(false)
    expect(
      scanDoneSchema.safeParse({
        groups: [],
        scannedFiles: 0,
        skipped: 0,
        totalWastedBytes: 0,
        elapsedMs: 0
      }).success
    ).toBe(true)
    expect(
      scanDoneSchema.safeParse({
        groups: [],
        scannedFiles: -1,
        skipped: 0,
        totalWastedBytes: 0,
        elapsedMs: 0
      }).success
    ).toBe(false)
    expect(
      scanDoneSchema.safeParse({
        groups: [],
        scannedFiles: 0,
        skipped: 0,
        totalWastedBytes: 0,
        elapsedMs: -1
      }).success
    ).toBe(false)
  })
})

describe('config / set-config', () => {
  it('root 可空；recursive/minBytes 必填', () => {
    expect(configResultSchema.safeParse({ root: null, recursive: true, minBytes: 1024 }).success).toBe(
      true
    )
    expect(
      configResultSchema.safeParse({ root: 'C:\\a', recursive: false, minBytes: 0 }).success
    ).toBe(true)
    expect(configResultSchema.safeParse({ root: null, recursive: true }).success).toBe(false)
  })

  it('set-config：root 可省略或空串（清空记忆），recursive/minBytes 必填且非负', () => {
    expect(setConfigPayloadSchema.safeParse({ recursive: true, minBytes: 1024 }).success).toBe(true)
    expect(
      setConfigPayloadSchema.safeParse({ root: 'C:\\a', recursive: true, minBytes: 0 }).success
    ).toBe(true)
    expect(setConfigPayloadSchema.safeParse({ root: '', recursive: true, minBytes: 0 }).success).toBe(
      true
    )
    expect(setConfigPayloadSchema.safeParse({ recursive: true, minBytes: -1 }).success).toBe(false)
    expect(setConfigPayloadSchema.safeParse({ minBytes: 0 }).success).toBe(false)
  })
})
