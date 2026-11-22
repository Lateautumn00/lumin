/**
 * @file manifest 单测（清单字段与侧边栏图标约定）
 * @author cuilanchao
 * @date 2026-11-20
 */
import { describe, expect, it } from 'vitest'
import { manifest } from './manifest'

describe('ocr-text manifest', () => {
  it('字段完整且与侧边栏图标约定一致', () => {
    expect(manifest.id).toBe('ocr-text')
    expect(manifest.name).toBe('图片文字识别')
    expect(manifest.icon).toBe('scan-text')
    expect(manifest.category).toBe('image')
    expect(manifest.order).toBe(90)
    expect(manifest.version).toBe('0.1.0')
    expect(manifest.description.length).toBeGreaterThan(0)
  })
})
