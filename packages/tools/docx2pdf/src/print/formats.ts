/**
 * @file formats.ts
 * @author cuilanchao
 * @date 2026-11-25
 * @description 打印输入格式白名单与类型识别纯函数（renderer 与主进程共用）。
 */

/** Office 扩展名（需经 soffice 转 PDF 后打印） */
export const OFFICE_EXTENSIONS = ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'] as const

/** 图片扩展名（经本地 HTML 包装后打印） */
export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'] as const

/** 所有可打印扩展名 */
export const PRINT_EXTENSIONS = [...OFFICE_EXTENSIONS, 'pdf', ...IMAGE_EXTENSIONS] as const

/** 文件选择器 accept（同时用于拖拽校验） */
export const PRINT_ACCEPT = PRINT_EXTENSIONS.map((ext) => `.${ext}`).join(',')

/** 单批上限（spec §1） */
export const MAX_PRINT_FILES = 50

/** 单文件体积上限 500 MiB（spec §1） */
export const MAX_INPUT_BYTES = 500 * 1024 * 1024

/** 输入类型：Office 转换 / PDF 视图 / 图片包装 */
export type PrintKind = 'office' | 'pdf' | 'image'

/** 取小写扩展名（不含点），无扩展名返回空串 */
export function extensionOf(path: string): string {
  const base = fileNameOf(path)
  const index = base.lastIndexOf('.')
  return index <= 0 ? '' : base.slice(index + 1).toLowerCase()
}

/** 按扩展名判定打印类型，不支持返回 null */
export function classifyPrintFile(path: string): PrintKind | null {
  const ext = extensionOf(path)
  if (ext === 'pdf') return 'pdf'
  if ((OFFICE_EXTENSIONS as readonly string[]).includes(ext)) return 'office'
  if ((IMAGE_EXTENSIONS as readonly string[]).includes(ext)) return 'image'
  return null
}

/** 路径去重（保留首次出现，大小写不敏感以适配 Windows） */
export function dedupePaths(paths: readonly string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const path of paths) {
    const key = path.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(path)
  }
  return result
}

/** Windows/Unix 绝对路径判定（不引 node:path，renderer 可复用） */
export function isAbsolutePath(path: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(path) || path.startsWith('\\\\') || path.startsWith('/')
}

/** 取文件名（最后一段，兼容两种分隔符） */
export function fileNameOf(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  return normalized.slice(normalized.lastIndexOf('/') + 1)
}
