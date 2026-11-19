/**
 * @file schema.test.ts IPC schema 校验单测（边界/默认值/非法入参）
 * @author cuilanchao
 * @date 2026-11-19
 */
import { describe, expect, it } from 'vitest'
import {
  MAX_FILES,
  configResultSchema,
  hashDoneSchema,
  hashFileResultSchema,
  hashPayloadSchema,
  setConfigPayloadSchema
} from './schema'

describe('hashPayloadSchema', () => {
  it('接受 1–200 个路径与 1–3 种算法', () => {
    expect(hashPayloadSchema.safeParse({ paths: ['C:\\a'], algorithms: ['sha256'] }).success).toBe(
      true
    )
    expect(
      hashPayloadSchema.safeParse({ paths: ['a', 'b'], algorithms: ['md5', 'sha1', 'sha256'] })
        .success
    ).toBe(true)
  })

  it('空路径 / 超上限 / 空算法 / 未知算法均拒绝', () => {
    expect(hashPayloadSchema.safeParse({ paths: [], algorithms: ['sha256'] }).success).toBe(false)
    expect(
      hashPayloadSchema.safeParse({
        paths: Array.from({ length: MAX_FILES + 1 }, (_, index) => `f${index}`),
        algorithms: ['sha256']
      }).success
    ).toBe(false)
    expect(hashPayloadSchema.safeParse({ paths: ['a'], algorithms: [] }).success).toBe(false)
    expect(hashPayloadSchema.safeParse({ paths: ['a'], algorithms: ['sha512'] }).success).toBe(
      false
    )
    expect(hashPayloadSchema.safeParse({}).success).toBe(false)
  })
})

describe('hashFileResultSchema / hashDoneSchema', () => {
  it('成功行与失败行均可解析', () => {
    expect(
      hashFileResultSchema.safeParse({
        path: 'C:\\a.txt',
        size: 3,
        mtimeMs: 1,
        hashes: { md5: 'x' },
        status: 'ok'
      }).success
    ).toBe(true)
    expect(
      hashFileResultSchema.safeParse({
        path: 'C:\\a.txt',
        size: 0,
        mtimeMs: 0,
        hashes: {},
        status: 'failed',
        code: 'FH_FILE_INVALID',
        message: 'ENOENT'
      }).success
    ).toBe(true)
  })

  it('负尺寸/未知状态拒绝；汇总计数非负整数', () => {
    expect(
      hashFileResultSchema.safeParse({
        path: 'a',
        size: -1,
        mtimeMs: 0,
        hashes: {},
        status: 'ok'
      }).success
    ).toBe(false)
    expect(
      hashFileResultSchema.safeParse({
        path: 'a',
        size: 0,
        mtimeMs: 0,
        hashes: {},
        status: 'pending'
      }).success
    ).toBe(false)
    expect(
      hashDoneSchema.safeParse({ results: [], failedCount: 0, totalBytes: 0, elapsedMs: 0 }).success
    ).toBe(true)
    expect(
      hashDoneSchema.safeParse({ results: [], failedCount: -1, totalBytes: 0, elapsedMs: 0 }).success
    ).toBe(false)
  })
})

describe('config / set-config', () => {
  it('至少 1 种算法，未知算法拒绝', () => {
    expect(configResultSchema.safeParse({ algorithms: ['sha256'] }).success).toBe(true)
    expect(configResultSchema.safeParse({ algorithms: [] }).success).toBe(false)
    expect(setConfigPayloadSchema.safeParse({ algorithms: ['md5'] }).success).toBe(true)
    expect(setConfigPayloadSchema.safeParse({ algorithms: ['sha512'] }).success).toBe(false)
    expect(setConfigPayloadSchema.safeParse({}).success).toBe(false)
  })
})
