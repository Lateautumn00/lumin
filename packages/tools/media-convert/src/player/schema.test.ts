import { describe, expect, it } from 'vitest'
import { resolvePayloadSchema, resolveResultSchema } from './schema'

describe('resolvePayloadSchema', () => {
  it('接受非空路径', () => {
    expect(resolvePayloadSchema.parse({ path: 'C:\\a.mp4' })).toEqual({ path: 'C:\\a.mp4' })
  })

  it('拒绝空路径/超长/缺字段', () => {
    expect(resolvePayloadSchema.safeParse({ path: '' }).success).toBe(false)
    expect(resolvePayloadSchema.safeParse({ path: 'a'.repeat(4097) }).success).toBe(false)
    expect(resolvePayloadSchema.safeParse({}).success).toBe(false)
  })
})

describe('resolveResultSchema', () => {
  it('接受合法结果', () => {
    const result = { url: 'file:///C:/a.mp4', name: 'a.mp4', size: 10, mime: 'video/mp4' }
    expect(resolveResultSchema.parse(result)).toEqual(result)
  })

  it('拒绝空 url/mime、负体积', () => {
    expect(
      resolveResultSchema.safeParse({ url: '', name: 'a', size: 1, mime: 'video/mp4' }).success
    ).toBe(false)
    expect(
      resolveResultSchema.safeParse({ url: 'file:///a', name: 'a', size: 1, mime: '' }).success
    ).toBe(false)
    expect(
      resolveResultSchema.safeParse({ url: 'file:///a', name: 'a', size: -1, mime: 'video/mp4' })
        .success
    ).toBe(false)
  })
})
