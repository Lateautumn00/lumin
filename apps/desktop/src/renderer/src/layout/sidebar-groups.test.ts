import { describe, expect, it } from 'vitest'
import type { ToolManifest } from '@lumin/plugin-api'
import { groupToolsByCategory } from './sidebar-groups'

function tool(id: string, category: ToolManifest['category'], order: number): ToolManifest {
  return { id, name: id, description: '', icon: 'wrench', category, order, version: '0.1.0' }
}

describe('groupToolsByCategory', () => {
  it('按固定分类顺序分组，组内按 order 升序', () => {
    const groups = groupToolsByCategory([
      tool('zip', 'file', 68),
      tool('video', 'media', 40),
      tool('calc', 'compute', 10),
      tool('hasher', 'file', 60)
    ])
    expect(groups.map((g) => g.category)).toEqual(['compute', 'media', 'file'])
    expect(groups[0]?.tools.map((t) => t.id)).toEqual(['calc'])
    expect(groups[2]?.tools.map((t) => t.id)).toEqual(['hasher', 'zip'])
  })

  it('空分类不输出，空输入返回空数组', () => {
    expect(groupToolsByCategory([])).toEqual([])
    const groups = groupToolsByCategory([tool('example', 'misc', 90)])
    expect(groups).toHaveLength(1)
    expect(groups[0]?.category).toBe('misc')
  })

  it('不修改入参数组', () => {
    const input = [tool('b', 'file', 2), tool('a', 'file', 1)]
    const snapshot = input.map((t) => t.id)
    groupToolsByCategory(input)
    expect(input.map((t) => t.id)).toEqual(snapshot)
  })
})
