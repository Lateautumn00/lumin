import { describe, expect, it } from 'vitest'
import { manifest } from './manifest'

describe('pdf-toolkit manifest', () => {
  it('清单字段符合 spec §2', () => {
    expect(manifest.id).toBe('pdf-toolkit')
    expect(manifest.name).toBe('PDF 工具集')
    expect(manifest.icon).toBe('files')
    expect(manifest.order).toBe(75)
    expect(manifest.version).toBe('0.1.0')
    expect(manifest.description).toContain('PDF')
  })
})
