import { describe, expect, it } from 'vitest'
import { manifest } from './manifest'

describe('file-preview manifest', () => {
  it('id/名称/分类/顺序/图标/版本符合 spec', () => {
    expect(manifest.id).toBe('file-preview')
    expect(manifest.name).toBe('文件预览')
    expect(manifest.category).toBe('document')
    expect(manifest.order).toBe(25)
    expect(manifest.icon).toBe('eye')
    expect(manifest.version).toBe('0.1.0')
  })
})
