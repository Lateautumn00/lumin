import { describe, expect, it } from 'vitest'
import { defineManifest, toolManifestSchema } from './manifest'

const valid = {
  id: 'example',
  name: '示例工具',
  description: 'M0 插拔链路验证占位工具',
  icon: 'flask-conical',
  category: 'misc',
  order: 99,
  version: '0.1.0'
} as const

describe('toolManifestSchema', () => {
  it('接受合法清单', () => {
    expect(toolManifestSchema.safeParse(valid).success).toBe(true)
  })

  it('拒绝非 kebab-case id', () => {
    expect(toolManifestSchema.safeParse({ ...valid, id: 'Example' }).success).toBe(false)
    expect(toolManifestSchema.safeParse({ ...valid, id: 'example_tool' }).success).toBe(false)
    expect(toolManifestSchema.safeParse({ ...valid, id: '' }).success).toBe(false)
  })

  it('拒绝非 x.y.z 版本', () => {
    expect(toolManifestSchema.safeParse({ ...valid, version: '0.1' }).success).toBe(false)
    expect(toolManifestSchema.safeParse({ ...valid, version: 'v0.1.0' }).success).toBe(false)
  })

  it('拒绝空名称与非整数 order', () => {
    expect(toolManifestSchema.safeParse({ ...valid, name: '' }).success).toBe(false)
    expect(toolManifestSchema.safeParse({ ...valid, order: 1.5 }).success).toBe(false)
  })

  it('拒绝缺字段', () => {
    const { icon: _icon, ...rest } = valid
    expect(toolManifestSchema.safeParse(rest).success).toBe(false)
  })

  it('拒绝未知分类', () => {
    expect(toolManifestSchema.safeParse({ ...valid, category: 'video' }).success).toBe(false)
    expect(toolManifestSchema.safeParse({ ...valid, category: undefined }).success).toBe(false)
  })
})

describe('defineManifest', () => {
  it('原样返回以保留字面量类型', () => {
    const m = defineManifest(valid)
    expect(m).toBe(valid)
    expect(m.id).toBe('example')
  })
})
