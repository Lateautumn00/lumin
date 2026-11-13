import { describe, expect, it } from 'vitest'
import { manifest } from './manifest'

describe('calculator manifest', () => {
  it('符合清单契约', () => {
    expect(manifest.id).toBe('calculator')
    expect(manifest.name).toBe('计算器')
    expect(manifest.icon).toBe('calculator')
    expect(manifest.order).toBe(10)
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/)
    expect(manifest.description.length).toBeGreaterThan(0)
  })
})
