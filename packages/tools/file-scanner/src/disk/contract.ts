/**
 * @file contract.ts 纯函数契约（占比 / 排序 / 汇总 / 过滤 / 折叠 / 面包屑）
 * @author cuilanchao
 * @date 2026-11-20
 * @description 无副作用、不依赖 node:path，renderer 与 worker 共用；口径见 spec §4。
 */
import { formatBytes } from '@lumin/shared'
import { MAX_TYPE_ROWS, type DiskEntry, type TypeStat } from './schema'

/** 当前层直接子项汇总（文件/目录按条目数计，不含后代） */
export interface EntrySummary {
  totalBytes: number
  files: number
  dirs: number
}

/**
 * 占比百分比（0–100，保留 1 位小数）
 * @param size 子项大小
 * @param total 当前层总大小（≤0 时安全返回 0）
 */
export function percentOf(size: number, total: number): number {
  if (!(total > 0) || !(size > 0)) return 0
  return Math.min(100, Math.round((size / total) * 1000) / 10)
}

/**
 * 条目排序：大小降序 → 目录优先 → 名称升序（不修改原数组）
 * @param entries 当前层条目
 */
export function sortEntries(entries: readonly DiskEntry[]): DiskEntry[] {
  return [...entries].sort((a, b) => {
    if (b.size !== a.size) return b.size - a.size
    if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

/**
 * 汇总当前层直接子项
 * @param entries 当前层条目
 */
export function summarize(entries: readonly DiskEntry[]): EntrySummary {
  let totalBytes = 0
  let files = 0
  let dirs = 0
  for (const entry of entries) {
    totalBytes += entry.size
    if (entry.kind === 'dir') dirs += 1
    else files += 1
  }
  return { totalBytes, files, dirs }
}

/**
 * 按最小文件阈值过滤：仅过滤文件行，目录行始终保留
 * @param entries 当前层条目
 * @param minBytes 最小文件字节数（≤0 时不过滤）
 */
export function filterEntries(entries: readonly DiskEntry[], minBytes: number): DiskEntry[] {
  if (!(minBytes > 0)) return [...entries]
  return entries.filter((entry) => entry.kind === 'dir' || entry.size >= minBytes)
}

/** 折叠结果（前 N 项 + 其余统计） */
export interface LimitedEntries {
  shown: DiskEntry[]
  hiddenCount: number
  hiddenBytes: number
}

/**
 * 单层展示上限：截取前 limit 项，其余汇总为隐藏统计
 * @param entries 已排序条目
 * @param limit 展示条数（≤0 时全部隐藏）
 */
export function limitEntries(entries: readonly DiskEntry[], limit: number): LimitedEntries {
  const shown = limit > 0 ? entries.slice(0, limit) : []
  let hiddenCount = 0
  let hiddenBytes = 0
  for (const entry of entries.slice(shown.length)) {
    hiddenCount += 1
    hiddenBytes += entry.size
  }
  return { shown: [...shown], hiddenCount, hiddenBytes }
}

/** 路径分段（兼容 `\` 与 `/`，忽略空段） */
function splitPath(input: string): string[] {
  return input.split(/[\\/]+/).filter((part) => part !== '')
}

/**
 * 判断 root 是否为 target 的祖先或同一路径（大小写不敏感，按整段前缀比较）
 * @param root 根目录
 * @param target 待判断路径
 */
export function isInside(root: string, target: string): boolean {
  const rootParts = splitPath(root)
  const targetParts = splitPath(target)
  if (rootParts.length === 0 || targetParts.length < rootParts.length) return false
  for (let index = 0; index < rootParts.length; index += 1) {
    const left = rootParts[index]
    const right = targetParts[index]
    if (left === undefined || right === undefined) return false
    if (left.toLowerCase() !== right.toLowerCase()) return false
  }
  return true
}

/**
 * 面包屑段名：root → current 的相对段（不在 root 下时返回空数组）
 * @param root 起始根目录（用户选择的目录）
 * @param current 当前层目录
 */
export function breadcrumbParts(root: string, current: string): string[] {
  if (!isInside(root, current)) return []
  return splitPath(current).slice(splitPath(root).length)
}

/**
 * 按面包屑深度拼出绝对路径（depth < 0 返回 root）
 * @param root 起始根目录
 * @param parts 面包屑段名
 * @param depth 目标段下标（0 = 第一级子目录）
 */
export function breadcrumbPath(root: string, parts: readonly string[], depth: number): string {
  const segments = parts.slice(0, Math.max(0, depth + 1))
  if (segments.length === 0) return root
  const separator = root.includes('/') && !root.includes('\\') ? '/' : '\\'
  const base = root.replace(/[\\/]+$/, '')
  return `${base}${separator}${segments.join(separator)}`
}

/** 相对 root 的路径（不在 root 下时原样返回；`\` 分隔） */
export function relativeTo(root: string, target: string): string {
  if (!isInside(root, target)) return target
  return splitPath(target).slice(splitPath(root).length).join('\\')
}

/**
 * 取文件名扩展名（小写、不含点；无扩展名返回 `(无扩展名)`）
 * @param name 文件名（不含目录）
 */
export function extensionOf(name: string): string {
  const index = name.lastIndexOf('.')
  if (index <= 0 || index === name.length - 1) return '(无扩展名)'
  return name.slice(index + 1).toLowerCase()
}

/** 类型累计值（文件数 + 字节数） */
export interface TypeTotals {
  files: number
  bytes: number
}

/**
 * 汇总类型统计：字节降序 → 文件数降序 → 扩展名升序；超出 limit 的合并为「其他」
 * @param totals 扩展名 → 累计值
 * @param limit 展示行数上限（默认 spec 的 20）
 */
export function summarizeTypes(
  totals: ReadonlyMap<string, TypeTotals>,
  limit: number = MAX_TYPE_ROWS
): TypeStat[] {
  const rows: TypeStat[] = [...totals.entries()].map(([ext, value]) => ({
    ext,
    files: value.files,
    bytes: value.bytes
  }))
  rows.sort((a, b) => b.bytes - a.bytes || b.files - a.files || a.ext.localeCompare(b.ext))
  if (rows.length <= limit) return rows
  const head = rows.slice(0, limit)
  let files = 0
  let bytes = 0
  for (const row of rows.slice(limit)) {
    files += row.files
    bytes += row.bytes
  }
  head.push({ ext: '其他', files, bytes })
  return head
}

/**
 * CSV 单元格转义（RFC 4180：含逗号/引号/换行时加引号，内部引号翻倍）
 * @param value 原始值
 */
export function csvCell(value: string | number): string {
  const text = String(value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** CSV 导出所需数据 */
export interface CsvInput {
  root: string
  entries: readonly DiskEntry[]
  typeStats: readonly TypeStat[]
}

/**
 * 组装 CSV 文本（当前层条目表 + 类型统计表，CRLF 行尾，不含 BOM）
 * @param input 根目录、当前层条目与类型统计
 */
export function buildCsv(input: CsvInput): string {
  const lines: string[] = []
  lines.push(csvCell(`# 磁盘空间分析 - ${input.root}`))
  lines.push(['类型', '名称', '相对路径', '大小(字节)', '大小(可读)', '文件数'].join(','))
  for (const entry of input.entries) {
    lines.push(
      [
        entry.kind === 'dir' ? '目录' : '文件',
        csvCell(entry.name),
        csvCell(relativeTo(input.root, entry.path)),
        entry.size,
        csvCell(formatBytes(entry.size)),
        entry.fileCount
      ].join(',')
    )
  }
  if (input.typeStats.length > 0) {
    lines.push('')
    lines.push(['扩展名', '文件数', '大小(字节)', '大小(可读)'].join(','))
    for (const row of input.typeStats) {
      lines.push(
        [csvCell(row.ext), row.files, row.bytes, csvCell(formatBytes(row.bytes))].join(',')
      )
    }
  }
  return `${lines.join('\r\n')}\r\n`
}
