import { describe, expect, it } from 'vitest'
import { toolManifestSchema } from '@lumin/plugin-api'

import { manifest } from './manifest'

describe('text-diff manifest', () => {
  it('符合 ToolManifest 契约', () => {
    const parsed = toolManifestSchema.safeParse(manifest)
    expect(parsed.success).toBe(true)
  })

  it('固定字段值', () => {
    expect(manifest.id).toBe('text-diff')
    expect(manifest.name).toBe('文本对比')
    expect(manifest.icon).toBe('file-diff')
    expect(manifest.category).toBe('text')
    expect(manifest.order).toBe(100)
    expect(manifest.version).toBe('0.1.0')
  })
})
