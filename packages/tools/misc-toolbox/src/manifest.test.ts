import { describe, expect, it } from 'vitest'

import { manifest } from './manifest'

describe('manifest', () => {
  it('清单契约', () => {
    expect(manifest.id).toBe('misc-toolbox')
    expect(manifest.name).toBe('实用工具')
    expect(manifest.icon).toBe('timer')
    expect(manifest.category).toBe('misc')
    expect(manifest.order).toBe(71)
    expect(manifest.version).toBe('0.4.0')
    expect(manifest.description.length).toBeGreaterThan(0)
  })
})
