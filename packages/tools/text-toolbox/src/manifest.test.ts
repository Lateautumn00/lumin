/**
 * @file manifest.ts 单测：清单契约字段与版本号格式
 * @author cuilanchao
 * @date 2026-11-18
 * @description 壳按清单生成路由与侧边栏，字段缺失会在启动时报错
 */
import { describe, expect, it } from 'vitest'
import { manifest } from './manifest'

describe('text-toolbox manifest', () => {
  it('符合清单契约', () => {
    expect(manifest.id).toBe('text-toolbox')
    expect(manifest.name).toBe('文本工具箱')
    expect(manifest.icon).toBe('braces')
    expect(manifest.order).toBe(60)
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/)
    expect(manifest.description.length).toBeGreaterThan(0)
  })
})
