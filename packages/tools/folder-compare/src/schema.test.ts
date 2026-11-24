/**
 * @file schema.test.ts IPC 契约 zod 校验与常量单测
 * @author cuilanchao
 * @date 2026-11-20
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_COMPARE_CONTENT,
  DEFAULT_COMPARE_MTIME,
  MAX_FILES_PER_SIDE,
  MAX_RESULT_ENTRIES,
  MAX_VISIBLE_ENTRIES,
  MTIME_TOLERANCE_MS,
  compareDoneSchema,
  compareEntrySchema,
  comparePayloadSchema,
  configResultSchema,
  setConfigPayloadSchema
} from './schema'

describe('常量', () => {
  it('与 spec §5.1 一致', () => {
    expect(MTIME_TOLERANCE_MS).toBe(2000)
    expect(MAX_FILES_PER_SIDE).toBe(200_000)
    expect(MAX_RESULT_ENTRIES).toBe(20_000)
    expect(MAX_VISIBLE_ENTRIES).toBe(500)
    expect(DEFAULT_COMPARE_MTIME).toBe(true)
    expect(DEFAULT_COMPARE_CONTENT).toBe(false)
  })
})

describe('comparePayloadSchema', () => {
  it('合法入参通过', () => {
    expect(
      comparePayloadSchema.parse({
        leftRoot: 'C:\\a',
        rightRoot: 'D:\\b',
        compareMtime: true,
        compareContent: false
      })
    ).toEqual({
      leftRoot: 'C:\\a',
      rightRoot: 'D:\\b',
      compareMtime: true,
      compareContent: false
    })
  })

  it('空目录/缺字段/非布尔开关拒绝', () => {
    expect(
      comparePayloadSchema.safeParse({
        leftRoot: '',
        rightRoot: 'D:\\b',
        compareMtime: true,
        compareContent: false
      }).success
    ).toBe(false)
    expect(
      comparePayloadSchema.safeParse({ leftRoot: 'C:\\a', compareMtime: true, compareContent: false })
        .success
    ).toBe(false)
    expect(
      comparePayloadSchema.safeParse({
        leftRoot: 'C:\\a',
        rightRoot: 'D:\\b',
        compareMtime: 'yes',
        compareContent: false
      }).success
    ).toBe(false)
    expect(
      comparePayloadSchema.safeParse({
        leftRoot: 'C:\\a',
        rightRoot: 'D:\\b',
        compareMtime: true,
        compareContent: 'no'
      }).success
    ).toBe(false)
  })
})

describe('setConfigPayloadSchema / configResultSchema', () => {
  it('目录可省略（保留上次），比较开关必填', () => {
    expect(setConfigPayloadSchema.parse({ compareMtime: false, compareContent: true })).toEqual({
      compareMtime: false,
      compareContent: true
    })
    expect(setConfigPayloadSchema.safeParse({}).success).toBe(false)
  })

  it('config 结果允许目录为 null', () => {
    expect(
      configResultSchema.parse({
        leftRoot: null,
        rightRoot: null,
        compareMtime: true,
        compareContent: false
      })
    ).toEqual({ leftRoot: null, rightRoot: null, compareMtime: true, compareContent: false })
  })
})

describe('compareEntrySchema / compareDoneSchema', () => {
  const entry = {
    path: 'a/b.txt',
    status: 'different' as const,
    sizeLeft: 1,
    sizeRight: 2,
    mtimeLeft: 100,
    mtimeRight: 200,
    sizeChanged: true,
    mtimeChanged: true,
    contentChanged: false
  }

  it('条目允许缺失侧 null', () => {
    expect(
      compareEntrySchema.parse({
        ...entry,
        status: 'only-left' as const,
        sizeRight: null,
        mtimeRight: null
      })
    ).toMatchObject({ status: 'only-left', sizeRight: null })
  })

  it('条目拒绝负大小', () => {
    expect(compareEntrySchema.safeParse({ ...entry, sizeLeft: -1 }).success).toBe(false)
  })

  it('结果汇总解析', () => {
    expect(
      compareDoneSchema.parse({
        leftRoot: 'C:\\a',
        rightRoot: 'D:\\b',
        entries: [entry],
        onlyLeft: 1,
        onlyRight: 2,
        different: 3,
        same: 4,
        leftFiles: 5,
        rightFiles: 6,
        skipped: 0,
        truncated: 0,
        compareMtime: true,
        compareContent: true,
        contentDifferent: 1,
        elapsedMs: 12
      })
    ).toMatchObject({ different: 3, same: 4, contentDifferent: 1, elapsedMs: 12 })
  })
})
