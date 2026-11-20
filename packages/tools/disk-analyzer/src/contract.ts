/**
 * @file contract.ts 纯函数契约（占比 / 排序 / 汇总 / 过滤 / 折叠 / 面包屑）
 * @author cuilanchao
 * @date 2026-11-20
 * @description 无副作用、不依赖 node:path，renderer 与 worker 共用；口径见 spec §4。
 */
import type { DiskEntry } from './schema'

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
