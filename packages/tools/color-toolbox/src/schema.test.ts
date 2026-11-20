/**
 * @file schema.ts 单测（截图取色入参/回包契约）
 * @author cuilanchao
 * @date 2026-11-20
 */
import { describe, expect, it } from 'vitest'

import { captureDisplayPayloadSchema, captureDisplayResultSchema } from './schema'

const RESULT = {
  displayId: '1',
  displayName: '主显示器',
  width: 1920,
  height: 1080,
  dataUrl: 'data:image/png;base64,AAAA',
  displays: [{ id: '1', label: '主显示器' }]
}

describe('captureDisplayPayloadSchema', () => {
  it('displayId 可缺省', () => {
    expect(captureDisplayPayloadSchema.parse({})).toEqual({})
    expect(captureDisplayPayloadSchema.parse({ displayId: '1' })).toEqual({ displayId: '1' })
  })

  it('空/非字符串 displayId 被拒绝', () => {
    expect(captureDisplayPayloadSchema.safeParse({ displayId: '' }).success).toBe(false)
    expect(captureDisplayPayloadSchema.safeParse({ displayId: 1 }).success).toBe(false)
  })
})

describe('captureDisplayResultSchema', () => {
  it('合法回包通过', () => {
    expect(captureDisplayResultSchema.parse(RESULT)).toEqual(RESULT)
  })

  it('dataUrl 必须是 PNG base64', () => {
    expect(
      captureDisplayResultSchema.safeParse({ ...RESULT, dataUrl: 'data:image/jpeg;base64,AA' })
        .success
    ).toBe(false)
    expect(captureDisplayResultSchema.safeParse({ ...RESULT, dataUrl: 'http://x/a.png' }).success).toBe(
      false
    )
  })

  it('尺寸必须为正整数，显示器列表不可为空', () => {
    expect(captureDisplayResultSchema.safeParse({ ...RESULT, width: 0 }).success).toBe(false)
    expect(captureDisplayResultSchema.safeParse({ ...RESULT, height: 1.5 }).success).toBe(false)
    expect(captureDisplayResultSchema.safeParse({ ...RESULT, displays: [] }).success).toBe(false)
    expect(
      captureDisplayResultSchema.safeParse({ ...RESULT, displays: [{ id: '', label: 'x' }] }).success
    ).toBe(false)
  })
})
