import { describe, expect, it } from 'vitest'

import { manifest } from './manifest'

describe('unit-converter manifest', () => {
  it('符合清单契约', () => {
    expect(manifest.id).toBe('unit-converter')
    expect(manifest.name).toBe('单位换算')
    expect(manifest.icon).toBe('ruler')
    expect(manifest.order).toBe(20)
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/)
    expect(manifest.description.length).toBeGreaterThan(0)
  })
})
