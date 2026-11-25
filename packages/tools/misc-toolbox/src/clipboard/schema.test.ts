/**
 * @file schema.test.ts IPC schema 单测（M61 Entry 扩展、旧 JSON 兼容、新通道回包）
 * @author cuilanchao
 * @date 2026-11-24
 */
import { describe, expect, it } from 'vitest'
import {
  MAX_ENTRIES,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_ENTRIES,
  THUMB_WIDTH,
  entrySchema,
  entriesFileSchema,
  idPayloadSchema,
  imageResultSchema,
  okResultSchema,
  pollResultSchema
} from './schema'

describe('M61 上限常量', () => {
  it('图片 100 条 / 5MB / 缩略图 160px，与 spec §1.3 一致', () => {
    expect(MAX_IMAGE_ENTRIES).toBe(100)
    expect(MAX_IMAGE_BYTES).toBe(5 * 1024 * 1024)
    expect(THUMB_WIDTH).toBe(160)
    expect(MAX_ENTRIES).toBe(500)
  })
})

describe('entrySchema', () => {
  it('旧条目无 type 字段 → default 解析为文本条目（M59 数据兼容）', () => {
    const parsed = entrySchema.parse({ id: 'a', text: '旧文本', createdAt: 1, pinned: false })
    expect(parsed.type).toBe('text')
    expect(parsed.width).toBeUndefined()
    expect(parsed.sha1).toBeUndefined()
  })

  it('图片条目附加 width/height/bytes/sha1/thumb 全部保留', () => {
    const parsed = entrySchema.parse({
      id: 'img',
      text: '',
      createdAt: 1,
      pinned: false,
      type: 'image',
      width: 1920,
      height: 1080,
      bytes: 2_202_009,
      sha1: 'deadbeef',
      thumb: 'data:image/png;base64,AAAA'
    })
    expect(parsed).toMatchObject({
      type: 'image',
      width: 1920,
      height: 1080,
      bytes: 2_202_009,
      sha1: 'deadbeef',
      thumb: 'data:image/png;base64,AAAA'
    })
  })

  it('非法 type 与负数字节被拒绝', () => {
    const base = { id: 'a', text: '', createdAt: 1, pinned: false }
    expect(entrySchema.safeParse({ ...base, type: 'gif' }).success).toBe(false)
    expect(entrySchema.safeParse({ ...base, type: 'image', bytes: -1 }).success).toBe(false)
    expect(entrySchema.safeParse({ ...base, type: 'image', width: 0 }).success).toBe(false)
  })
})

describe('entriesFileSchema', () => {
  const text = Array.from({ length: MAX_ENTRIES }, (_, i) => ({
    id: `t${i}`,
    text: 'x',
    createdAt: i,
    pinned: false
  }))
  const image = Array.from({ length: MAX_IMAGE_ENTRIES }, (_, i) => ({
    id: `i${i}`,
    text: '',
    createdAt: i,
    pinned: false,
    type: 'image' as const
  }))

  it('文本 500 + 图片 100 = 600 条通过，601 条视为损坏', () => {
    expect(entriesFileSchema.safeParse([...text, ...image]).success).toBe(true)
    expect(
      entriesFileSchema.safeParse([
        ...text,
        ...image,
        { id: 'extra', text: '', createdAt: 0, pinned: false, type: 'image' as const }
      ]).success
    ).toBe(false)
  })
})

describe('通道回包 schema', () => {
  it('poll 回包：entry 可空、skipped 仅允许 TOO_LARGE', () => {
    expect(pollResultSchema.safeParse({ entry: null }).success).toBe(true)
    expect(pollResultSchema.safeParse({ entry: null, skipped: 'TOO_LARGE' }).success).toBe(true)
    expect(pollResultSchema.safeParse({ entry: null, skipped: 'OTHER' }).success).toBe(false)
  })

  it('image 回包要求非空 dataUrl', () => {
    expect(imageResultSchema.safeParse({ dataUrl: 'data:image/png;base64,AA' }).success).toBe(true)
    expect(imageResultSchema.safeParse({ dataUrl: '' }).success).toBe(false)
    expect(imageResultSchema.safeParse({}).success).toBe(false)
  })

  it('id 载荷（image/copy 复用）与 ok 回包', () => {
    expect(idPayloadSchema.safeParse({ id: 'img-1' }).success).toBe(true)
    expect(idPayloadSchema.safeParse({ id: '' }).success).toBe(false)
    expect(okResultSchema.safeParse({ ok: true }).success).toBe(true)
    expect(okResultSchema.safeParse({ ok: false }).success).toBe(false)
  })
})
