/**
 * @file schema.test.ts IPC 契约单测
 * @author cuilanchao
 * @date 2026-11-20
 */
import { describe, expect, it } from 'vitest'
import {
  MAX_SOURCES,
  configResultSchema,
  packDoneSchema,
  packPayloadSchema,
  setConfigPayloadSchema,
  unpackDoneSchema,
  unpackPayloadSchema
} from './schema'

describe('packPayloadSchema', () => {
  it('合法入参通过', () => {
    expect(
      packPayloadSchema.parse({ sources: ['C:\\a'], outputDir: 'C:\\out', outputName: 'a.zip' })
    ).toEqual({ sources: ['C:\\a'], outputDir: 'C:\\out', outputName: 'a.zip' })
  })

  it('拒绝空源 / 空目录 / 含分隔符文件名 / 超上限', () => {
    expect(packPayloadSchema.safeParse({ sources: [], outputDir: 'C:\\o', outputName: 'a.zip' }).success).toBe(false)
    expect(packPayloadSchema.safeParse({ sources: ['a'], outputDir: '', outputName: 'a.zip' }).success).toBe(false)
    expect(packPayloadSchema.safeParse({ sources: ['a'], outputDir: 'C:\\o', outputName: 'x/a.zip' }).success).toBe(false)
    expect(packPayloadSchema.safeParse({ sources: ['a'], outputDir: 'C:\\o', outputName: 'x\\a.zip' }).success).toBe(false)
    const tooMany = Array.from({ length: MAX_SOURCES + 1 }, (_, index) => `p${index}`)
    expect(packPayloadSchema.safeParse({ sources: tooMany, outputDir: 'C:\\o', outputName: 'a.zip' }).success).toBe(false)
  })
})

describe('unpackPayloadSchema', () => {
  it('仅接受 rename / skip', () => {
    expect(unpackPayloadSchema.safeParse({ archive: 'a.zip', targetDir: 'C:\\t', conflict: 'rename' }).success).toBe(true)
    expect(unpackPayloadSchema.safeParse({ archive: 'a.zip', targetDir: 'C:\\t', conflict: 'overwrite' }).success).toBe(false)
    expect(unpackPayloadSchema.safeParse({ archive: '', targetDir: 'C:\\t', conflict: 'skip' }).success).toBe(false)
  })
})

describe('结果 schema', () => {
  it('packDone / unpackDone 接受非负整数', () => {
    expect(
      packDoneSchema.parse({ outputZip: 'C:\\a.zip', files: 1, dirs: 0, bytes: 10, elapsedMs: 1 })
    ).toBeTruthy()
    expect(
      unpackDoneSchema.parse({
        targetDir: 'C:\\t',
        files: 1,
        dirs: 1,
        bytes: 10,
        skipped: 0,
        renamed: 1,
        elapsedMs: 2
      })
    ).toBeTruthy()
    expect(
      packDoneSchema.safeParse({ outputZip: '', files: -1, dirs: 0, bytes: 0, elapsedMs: 0 }).success
    ).toBe(false)
  })
})

describe('config schema', () => {
  it('configResult 接受 null 目录', () => {
    expect(
      configResultSchema.parse({
        mode: 'pack',
        packSources: [],
        outputDir: null,
        outputName: null,
        archive: null,
        targetDir: null,
        conflict: 'rename'
      })
    ).toBeTruthy()
  })

  it('setConfigPayload 源超上限 / 模式非法拒绝', () => {
    const tooMany = Array.from({ length: MAX_SOURCES + 1 }, (_, index) => `p${index}`)
    expect(
      setConfigPayloadSchema.safeParse({
        mode: 'pack',
        packSources: tooMany,
        outputDir: null,
        outputName: null,
        archive: null,
        targetDir: null,
        conflict: 'rename'
      }).success
    ).toBe(false)
    expect(
      setConfigPayloadSchema.safeParse({
        mode: 'zip',
        packSources: [],
        outputDir: null,
        outputName: null,
        archive: null,
        targetDir: null,
        conflict: 'rename'
      }).success
    ).toBe(false)
  })
})
