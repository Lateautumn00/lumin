import { describe, expect, it } from 'vitest'
import { toolManifestSchema } from '@lumin/plugin-api'

import { manifest } from './manifest'

describe('password-generator manifest', () => {
  it('符合 ToolManifest 契约', () => {
    const parsed = toolManifestSchema.safeParse(manifest)
    expect(parsed.success).toBe(true)
  })

  it('固定字段值', () => {
    expect(manifest.id).toBe('password-generator')
    expect(manifest.name).toBe('密码生成器')
    expect(manifest.icon).toBe('key-round')
    expect(manifest.category).toBe('misc')
    expect(manifest.order).toBe(90)
    expect(manifest.version).toBe('0.1.0')
  })
})
