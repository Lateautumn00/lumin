import { TOOL_CATEGORIES, type ToolCategory, type ToolManifest } from '@lumin/plugin-api'
import type { MessageKey } from '../i18n/zh-CN'

export interface ToolGroup {
  category: ToolCategory
  tools: ToolManifest[]
}

/** 分类展示名（侧栏分组标题与搜索分类命中共用，壳文案集中在 i18n） */
export const TOOL_CATEGORY_LABEL_KEY: Record<ToolCategory, MessageKey> = {
  compute: 'shell.sidebar.category.compute',
  text: 'shell.sidebar.category.text',
  image: 'shell.sidebar.category.image',
  document: 'shell.sidebar.category.document',
  media: 'shell.sidebar.category.media',
  file: 'shell.sidebar.category.file',
  misc: 'shell.sidebar.category.misc'
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
