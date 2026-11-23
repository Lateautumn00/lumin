import { describe, expect, it } from 'vitest'
import { manifest } from './manifest'

describe('manifest', () => {
  it('id/名称/分类/图标/排序符合 M56 I2', () => {
    expect(manifest.id).toBe('text-editor')
    expect(manifest.name).toBe('文本编辑器')
    expect(manifest.category).toBe('text')
    expect(manifest.icon).toBe('pencil-line')
    expect(manifest.order).toBe(55)
  })

  it('描述非空且版本已钉', () => {
    expect(manifest.description.length).toBeGreaterThan(0)
    expect(manifest.version).toBe('0.1.0')
  })
})
