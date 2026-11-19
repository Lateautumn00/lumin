/**
 * @file manifest 单测（清单字段与 settings 命名空间约束）
 * @author cuilanchao
 * @date 2026-11-19
 */
import { describe, expect, it } from 'vitest'
import { manifest } from './manifest'

describe('qr-code manifest', () => {
  it('字段完整且与侧边栏图标约定一致', () => {
    expect(manifest.id).toBe('qr-code')
    expect(manifest.name).toBe('二维码工具')
    expect(manifest.icon).toBe('qr-code')
    expect(manifest.order).toBe(80)
    expect(manifest.version).toBe('0.1.0')
    expect(manifest.description.length).toBeGreaterThan(0)
  })
})
