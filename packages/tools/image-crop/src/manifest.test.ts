/**
 * @file manifest.ts 单测（壳路由/侧边栏依赖的契约字段）
 * @author cuilanchao
 * @date 2026-11-21
 * @description spec §8：id/name/icon/category/order/version 固定，变更须同步壳与 spec
 */
import { describe, expect, it } from 'vitest'
import { manifest } from './manifest'

describe('manifest', () => {
  it('契约固定字段', () => {
    expect(manifest.id).toBe('image-crop')
    expect(manifest.name).toBe('图片裁剪')
    expect(manifest.icon).toBe('crop')
    expect(manifest.category).toBe('image')
    expect(manifest.order).toBe(52)
    expect(manifest.version).toBe('0.1.0')
  })
})
