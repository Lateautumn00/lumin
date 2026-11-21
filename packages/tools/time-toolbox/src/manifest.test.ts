import { describe, expect, it } from 'vitest'

import { manifest } from './manifest'

describe('manifest', () => {
  it('清单契约', () => {
    expect(manifest.id).toBe('time-toolbox')
    expect(manifest.name).toBe('时间工具箱')
    expect(manifest.icon).toBe('clock')
    expect(manifest.category).toBe('compute')
    expect(manifest.order).toBe(70)
    expect(manifest.version).toBe('0.2.0')
    expect(manifest.description.length).toBeGreaterThan(0)
  })
})
