import { describe, expect, it } from 'vitest'

import { manifest } from './manifest'

describe('life-calculator manifest', () => {
  it('id / 名称 / 分类 / 图标 / 版本', () => {
    expect(manifest.id).toBe('life-calculator')
    expect(manifest.name).toBe('生活计算器')
    expect(manifest.category).toBe('compute')
    expect(manifest.icon).toBe('piggy-bank')
    expect(manifest.version).toBe('0.1.0')
    expect(manifest.description.length).toBeGreaterThan(0)
  })
})
