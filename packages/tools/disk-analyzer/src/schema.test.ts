/**
 * @file schema.test.ts IPC schema 校验单测（边界/默认值/非法入参）
 * @author cuilanchao
 * @date 2026-11-20
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MIN_FILE_BYTES,
  MAX_SCAN_FILES,
  MAX_VISIBLE_ENTRIES,
  MIN_FILE_BYTES_OPTIONS,
  configResultSchema,
  diskEntrySchema,
  scanDoneSchema,
  scanPayloadSchema,
  setConfigPayloadSchema
} from './schema'

describe('常量', () => {
  it('默认不过滤、上限 20 万、单层 100 项、阈值 4 档递增', () => {
    expect(DEFAULT_MIN_FILE_BYTES).toBe(0)
    expect(MAX_SCAN_FILES).toBe(200_000)
    expect(MAX_VISIBLE_ENTRIES).toBe(100)
    expect([...MIN_FILE_BYTES_OPTIONS]).toEqual([0, 1024, 102400, 1048576])
  })
})

describe('scanPayloadSchema', () => {
  it('接受合法目录与阈值', () => {
    expect(scanPayloadSchema.safeParse({ root: 'C:\\卷', minFileBytes: 1024 }).success).toBe(true)
    expect(scanPayloadSchema.safeParse({ root: 'a', minFileBytes: 0 }).success).toBe(true)
  })

  it('空目录 / 负阈值 / 缺失字段 / 类型错误拒绝', () => {
    expect(scanPayloadSchema.safeParse({ root: '', minFileBytes: 0 }).success).toBe(false)
    expect(scanPayloadSchema.safeParse({ root: 'a', minFileBytes: -1 }).success).toBe(false)
    expect(scanPayloadSchema.safeParse({ root: 'a' }).success).toBe(false)
    expect(scanPayloadSchema.safeParse({ root: 'a', minFileBytes: '0' }).success).toBe(false)
  })
})

describe('diskEntrySchema / scanDoneSchema', () => {
  it('目录与文件条目合法；非法类型/负数拒绝', () => {
    const dir = { name: 'sub', path: 'C:\\a\\sub', kind: 'dir', size: 10, fileCount: 2 }
    const file = { name: 'a.txt', path: 'C:\\a\\a.txt', kind: 'file', size: 10, fileCount: 0 }
    expect(diskEntrySchema.safeParse(dir).success).toBe(true)
    expect(diskEntrySchema.safeParse(file).success).toBe(true)
    expect(diskEntrySchema.safeParse({ ...dir, kind: 'link' }).success).toBe(false)
    expect(diskEntrySchema.safeParse({ ...dir, size: -1 }).success).toBe(false)
    expect(diskEntrySchema.safeParse({ ...dir, name: '' }).success).toBe(false)
  })

  it('扫描结果汇总字段非负，耗时可为小数', () => {
    expect(
      scanDoneSchema.safeParse({
        root: 'C:\\a',
        entries: [],
        totalBytes: 0,
        fileCount: 0,
        dirCount: 0,
        skipped: 0,
        elapsedMs: 12.5
      }).success
    ).toBe(true)
    expect(
      scanDoneSchema.safeParse({
        root: 'C:\\a',
        entries: [],
        totalBytes: 0,
        fileCount: 0,
        dirCount: 0,
        skipped: -1,
        elapsedMs: 0
      }).success
    ).toBe(false)
  })
})

describe('config / set-config', () => {
  it('root 可空；minFileBytes 必填非负', () => {
    expect(configResultSchema.safeParse({ root: null, minFileBytes: 0 }).success).toBe(true)
    expect(configResultSchema.safeParse({ root: 'C:\\a', minFileBytes: 1024 }).success).toBe(true)
    expect(configResultSchema.safeParse({ root: null }).success).toBe(false)
  })

  it('set-config：root 可省略或空串（清空记忆），阈值必填且非负', () => {
    expect(setConfigPayloadSchema.safeParse({ minFileBytes: 0 }).success).toBe(true)
    expect(setConfigPayloadSchema.safeParse({ root: 'C:\\a', minFileBytes: 1024 }).success).toBe(true)
    expect(setConfigPayloadSchema.safeParse({ root: '', minFileBytes: 0 }).success).toBe(true)
    expect(setConfigPayloadSchema.safeParse({ minFileBytes: -1 }).success).toBe(false)
    expect(setConfigPayloadSchema.safeParse({}).success).toBe(false)
  })
})
