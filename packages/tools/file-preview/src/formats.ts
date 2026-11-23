/**
 * @file 扩展名 → 预览类型路由表（spec §2 支持格式）
 * @author cuilanchao
 * @date 2026-11-22
 * @description 纯函数：大小写不敏感扩展名归一、类型判定、文件选择器 accept 与图片 MIME。
 */

/** 可预览类型（不含 unsupported） */
export const PREVIEW_KINDS = [
  'text',
  'markdown',
  'html',
  'json',
  'csv',
  'pdf',
  'image',
  'office'
] as const

export type PreviewKind = (typeof PREVIEW_KINDS)[number]

/** 判定结果：兜底为 unsupported */
export type FileKind = PreviewKind | 'unsupported'

/** 纯文本扩展名（小写） */
export const TEXT_EXTENSIONS = [
  'txt',
  'log',
  'ini',
  'cfg',
  'conf',
  'toml',
  'yaml',
  'yml',
  'xml',
  'js',
  'mjs',
  'cjs',
  'ts',
  'mts',
  'cts',
  'tsx',
  'jsx',
  'vue',
  'css',
  'scss',
  'less',
  'sh',
  'bash',
  'bat',
  'cmd',
  'ps1',
  'py',
  'java',
  'kt',
  'c',
  'h',
  'cpp',
  'hpp',
  'cc',
  'go',
  'rs',
  'rb',
  'php',
  'sql',
  'properties',
  'env',
  'diff',
  'patch'
] as const

/** Markdown 扩展名 */
export const MARKDOWN_EXTENSIONS = ['md', 'markdown', 'mdown', 'mkd'] as const

/** HTML 扩展名 */
export const HTML_EXTENSIONS = ['html', 'htm', 'xhtml'] as const

/** JSON 扩展名 */
export const JSON_EXTENSIONS = ['json', 'jsonc', 'json5', 'geojson'] as const

/** CSV/TSV 扩展名 */
export const CSV_EXTENSIONS = ['csv', 'tsv'] as const

/** PDF 扩展名 */
export const PDF_EXTENSIONS = ['pdf'] as const

/** 图片扩展名 */
export const IMAGE_EXTENSIONS = [
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'bmp',
  'svg',
  'avif',
  'ico'
] as const

/** Office 扩展名（LibreOffice → PDF） */
export const OFFICE_EXTENSIONS = ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'] as const

/** 全部支持扩展名（文件选择器 accept 与展示共用） */
export const SUPPORTED_EXTENSIONS = [
  ...TEXT_EXTENSIONS,
  ...MARKDOWN_EXTENSIONS,
  ...HTML_EXTENSIONS,
  ...JSON_EXTENSIONS,
  ...CSV_EXTENSIONS,
  ...PDF_EXTENSIONS,
  ...IMAGE_EXTENSIONS,
  ...OFFICE_EXTENSIONS
] as const

/** 文件选择器 accept 字符串（`.txt,.md,...`） */
export const FILE_PREVIEW_ACCEPT = SUPPORTED_EXTENSIONS.map((ext) => `.${ext}`).join(',')

/** 扩展名 → 类型映射（单一来源：上方白名单） */
const KIND_BY_EXTENSION: ReadonlyMap<string, PreviewKind> = new Map(
  [
    ...TEXT_EXTENSIONS.map((ext) => [ext, 'text'] as const),
    ...MARKDOWN_EXTENSIONS.map((ext) => [ext, 'markdown'] as const),
    ...HTML_EXTENSIONS.map((ext) => [ext, 'html'] as const),
    ...JSON_EXTENSIONS.map((ext) => [ext, 'json'] as const),
    ...CSV_EXTENSIONS.map((ext) => [ext, 'csv'] as const),
    ...PDF_EXTENSIONS.map((ext) => [ext, 'pdf'] as const),
    ...IMAGE_EXTENSIONS.map((ext) => [ext, 'image'] as const),
    ...OFFICE_EXTENSIONS.map((ext) => [ext, 'office'] as const)
  ]
)

/** 图片扩展名 → MIME（asset-url 消费方按需使用） */
const IMAGE_MIME: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  avif: 'image/avif',
  ico: 'image/x-icon'
}

/**
 * 取扩展名（小写、无点）；无扩展名/隐藏文件（如 .gitignore）返回 null
 * @param path 文件路径（兼容 `\` 与 `/`）
 */
export function extensionOf(path: string): string | null {
  const name = path.split(/[\\/]/).pop() ?? ''
  const dot = name.lastIndexOf('.')
  if (dot <= 0 || dot === name.length - 1) return null
  return name.slice(dot + 1).toLowerCase()
}

/**
 * 路径 → 预览类型（大小写不敏感；未知类型返回 unsupported）
 * @param path 文件路径
 */
export function detectKind(path: string): FileKind {
  const ext = extensionOf(path)
  if (ext === null) return 'unsupported'
  return KIND_BY_EXTENSION.get(ext) ?? 'unsupported'
}

/**
 * 图片扩展名 → MIME；非图片返回 null
 * @param ext 扩展名（可带点，任意大小写）
 */
export function imageMimeOf(ext: string): string | null {
  return IMAGE_MIME[ext.replace(/^\./, '').toLowerCase()] ?? null
}
