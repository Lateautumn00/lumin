import { describe, expect, it } from 'vitest'

import { manifest } from './manifest'

describe('color-toolbox manifest', () => {
  it('符合清单契约', () => {
    expect(manifest.id).toBe('color-toolbox')
    expect(manifest.name).toBe('颜色工具箱')
    expect(manifest.icon).toBe('palette')
    expect(manifest.category).toBe('misc')
    expect(manifest.order).toBe(80)
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/)
    expect(manifest.description.length).toBeGreaterThan(0)
  })
})
