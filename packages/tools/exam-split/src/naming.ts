import { baseName, rangeLabel, toRangeList } from '@lumin/shared'

/** 命名模板占位符白名单（spec §7.2） */
export const NAME_TOKENS = ['name', 'op', 'label', 'date'] as const

export interface NameVars {
  /** 原名（不含扩展名；合并取首个输入） */
  name: string
  /** 操作名（拆分/合并/删页/旋转/裁剪） */
  op: string
  /** 参数标签：拆分/删页为页标签，旋转为角度，合并/裁剪为空串 */
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

/** 合并：默认 `{首个原名}_合并.pdf`；模板取首个文件原名（spec §7.2） */
export function mergeDesiredPath(inputPaths: readonly string[], nameTemplate?: string): string {
  const template = activeTemplate(nameTemplate)
  const first = inputPaths[0]
  if (template === null) {
    if (first === undefined) return '_合并.pdf'
    return `${baseName(first)}_合并.pdf`
  }
  if (first === undefined) return '_合并.pdf'
  return templateOutputPath(first, template, '合并', '')
}

/** 删页：默认 `{原名}_删p{标签}.pdf`（多段以逗号连接）；模板 label 同默认标签（spec §7.2） */
export function deleteDesiredPath(
  inputPath: string,
  pages: readonly number[],
  nameTemplate?: string
): string {
  const label = toRangeList(pages).map(rangeLabel).join(',')
  const template = activeTemplate(nameTemplate)
  return template === null
    ? `${baseName(inputPath)}_删p${label}.pdf`
    : templateOutputPath(inputPath, template, '删页', label)
}

/** 旋转：默认 `{原名}_旋转{90|180|270}.pdf`；模板 label = 角度（spec §7.2） */
export function rotateDesiredPath(
  inputPath: string,
  degrees: number,
  nameTemplate?: string
): string {
  const template = activeTemplate(nameTemplate)
  return template === null
    ? `${baseName(inputPath)}_旋转${degrees}.pdf`
    : templateOutputPath(inputPath, template, '旋转', String(degrees))
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
