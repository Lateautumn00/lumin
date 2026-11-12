import { z } from 'zod'

/** 工具清单：壳侧唯一允许的工具知识载体（manifest 文件内引用） */
export const toolManifestSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/, 'id 须为 kebab-case'),
  name: z.string().min(1),
  description: z.string(),
  icon: z.string().min(1),
  order: z.number().int(),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, 'version 须为 x.y.z')
})

export type ToolManifest = z.infer<typeof toolManifestSchema>

/** 工具包内声明清单的类型辅助（校验由 plugin-host 在加载时执行） */
export function defineManifest<T extends ToolManifest>(manifest: T): T {
  return manifest
}
