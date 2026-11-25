import { baseName, rangeLabel } from '@lumin/shared'

/** 命名模板占位符白名单（spec §7.2） */
export const NAME_TOKENS = ['name', 'op', 'label', 'date'] as const

export interface NameVars {
  /** 原名（不含扩展名） */
  name: string
  /** 操作名（拆分/裁剪） */
  op: string
  /** 参数标签：拆分为页标签，裁剪为空串 */
  label: string
  /** 本地日期 YYYYMMDD */
  date: string
}

const TOKEN_RE = /\{(name|op|label|date)\}/g

/** 渲染命名模板：仅替换白名单占位符，其余 `{...}` 原样保留（spec §7.2） */
export function renderName(template: string, vars: NameVars): string {
  return template.replace(TOKEN_RE, (_, token: string) => vars[token as keyof NameVars])
}

/** 本地日期 YYYYMMDD */
export function formatDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}${month}${day}`
}

/** 区间组标签（组内页码连续，取首尾） */
function groupLabel(pages: readonly number[]): string {
  const first = pages[0]
  const last = pages[pages.length - 1]
  if (first === undefined || last === undefined) return ''
  return rangeLabel({ start: first, end: last })
}

/** 模板生效判定：空串 = 走默认命名 */
function activeTemplate(nameTemplate: string | undefined): string | null {
  const template = nameTemplate?.trim() ?? ''
  return template === '' ? null : template
}

/** 输入路径的目录前缀（保留原分隔符风格） */
function dirPrefix(base: string): string {
  const index = Math.max(base.lastIndexOf('/'), base.lastIndexOf('\\'))
  return index >= 0 ? base.slice(0, index + 1) : ''
}

/**
 * 按模板生成产物路径（与输入同目录；spec §7.2）：
 * 渲染后自动去掉尾部的 `.pdf`（大小写不敏感）再补 `.pdf`，避免重复扩展名。
 */
function templateOutputPath(
  inputPath: string,
  template: string,
  op: string,
  label: string
): string {
  const base = baseName(inputPath)
  const dir = dirPrefix(base)
  const name = dir === '' ? base : base.slice(dir.length)
  const rendered = renderName(template, {
    name,
    op,
    label,
    date: formatDate(new Date())
  })
    .trim()
    .replace(/\.pdf$/i, '')
  return `${dir}${rendered}.pdf`
}

/** 拆分：默认 `{原名}_p{标签}.pdf`；模板 label = 区间标签（spec §7.2） */
export function splitDesiredPaths(
  inputPath: string,
  groups: readonly number[][],
  nameTemplate?: string
): string[] {
  const base = baseName(inputPath)
  const template = activeTemplate(nameTemplate)
  return groups.map((pages) => {
    const label = groupLabel(pages)
    return template === null
      ? `${base}_p${label}.pdf`
      : templateOutputPath(inputPath, template, '拆分', label)
  })
}

/** 裁剪：默认 `{原名}_裁剪.pdf`；模板 label = 空串（spec §7.2） */
export function cropDesiredPath(inputPath: string, nameTemplate?: string): string {
  const template = activeTemplate(nameTemplate)
  return template === null
    ? `${baseName(inputPath)}_裁剪.pdf`
    : templateOutputPath(inputPath, template, '裁剪', '')
}

/** OCR 每题 PNG：`{原名}_题{n}.png`（按页序+题序连续编号，spec §10.7） */
export function ocrPngDesiredPath(inputPath: string, number: number): string {
  return `${baseName(inputPath)}_题${number}.png`
}

/** OCR 合成 PDF：`{原名}_切题.pdf`（spec §10.7） */
export function ocrPdfDesiredPath(inputPath: string): string {
  return `${baseName(inputPath)}_切题.pdf`
}

/** 输入文件扩展名（含点，小写；baseName 已去扩展名，差值即扩展名） */
function extensionOf(filePath: string): string {
  const base = baseName(filePath)
  return filePath.slice(base.length).toLowerCase()
}

/** 页面切分（PDF）：`{原名}_对半切.pdf`（spec §11） */
export function halveDesiredPath(inputPath: string): string {
  return `${baseName(inputPath)}_对半切.pdf`
}

/** 页面切分（图片）：`{原名}_左{ext}` / `{原名}_右{ext}`，保持原格式与像素分辨率（spec §11） */
export function halveImageDesiredPaths(inputPath: string): [string, string] {
  const base = baseName(inputPath)
  const ext = extensionOf(inputPath)
  return [`${base}_左${ext}`, `${base}_右${ext}`]
}

/** 在扩展名前插入冲突后缀 `(n)`（n ≤ 0 返回原路径；左右成对递增用同一 n） */
export function withConflictSuffix(filePath: string, index: number): string {
  if (index <= 0) return filePath
  const dot = filePath.lastIndexOf('.')
  return dot > 0
    ? `${filePath.slice(0, dot)}(${index})${filePath.slice(dot)}`
    : `${filePath}(${index})`
}
