import { z } from 'zod'

/** 侧边栏分组：壳只认这组键，标签文案由壳 i18n 提供（新增分类须同步 AGENTS/plan） */
export const TOOL_CATEGORIES = [
  'compute',
  'text',
  'image',
  'document',
  'media',
  'file',
  'misc'
] as const

export type ToolCategory = (typeof TOOL_CATEGORIES)[number]

/** 工具清单：壳侧唯一允许的工具知识载体（manifest 文件内引用） */
export const toolManifestSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/, 'id 须为 kebab-case'),
  name: z.string().min(1),
  description: z.string(),
  icon: z.string().min(1),
  category: z.enum(TOOL_CATEGORIES),
  order: z.number().int(),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, 'version 须为 x.y.z')
})

export type ToolManifest = z.infer<typeof toolManifestSchema>

/** 工具包内声明清单的类型辅助（校验由 plugin-host 在加载时执行） */
export function defineManifest<T extends ToolManifest>(manifest: T): T {
  return manifest
}
