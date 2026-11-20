import { TOOL_CATEGORIES, type ToolCategory, type ToolManifest } from '@lumin/plugin-api'

export interface ToolGroup {
  category: ToolCategory
  tools: ToolManifest[]
}

/**
 * 侧边栏分组：组序固定为 TOOL_CATEGORIES，组内按 order 升序，空分类不输出。
 * 分类知识只存在于各工具 manifest（壳零工具知识，AGENTS §2.1）。
 */
export function groupToolsByCategory(tools: readonly ToolManifest[]): ToolGroup[] {
  const buckets = new Map<ToolCategory, ToolManifest[]>()
  for (const tool of tools) {
    const bucket = buckets.get(tool.category)
    if (bucket) {
      bucket.push(tool)
    } else {
      buckets.set(tool.category, [tool])
    }
  }

  const groups: ToolGroup[] = []
  for (const category of TOOL_CATEGORIES) {
    const bucket = buckets.get(category)
    if (bucket && bucket.length > 0) {
      groups.push({ category, tools: [...bucket].sort((a, b) => a.order - b.order) })
    }
  }
  return groups
}
