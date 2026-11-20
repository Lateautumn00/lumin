/**
 * @file contract.ts 纯函数契约（相对路径归一/拼接 / 配对分类 / 汇总 / 排序 / 筛选 / 折叠）
 * @author cuilanchao
 * @date 2026-11-20
 * @description 无副作用、不依赖 node:path，renderer 与 worker 共用；口径见 spec §4。
 */
import { MTIME_TOLERANCE_MS, type CompareEntry, type DiffStatus } from './schema'

/** 单侧文件元数据（worker 扫描产物；renderer 不直接构造） */
export interface FileMeta {
  size: number
  mtimeMs: number
}

/**
 * 相对路径归一：`\` → `/`、合并重复分隔符、去首尾分隔符与 `.` 段
 * @param input 原始相对路径
 */
export function normalizeRelPath(input: string): string {
  return input
    .split(/[\\/]+/)
    .filter((part) => part !== '' && part !== '.')
    .join('/')
}

/**
 * 配对键：小写相对路径（Windows 文件名大小写不敏感）
 * @param rel 相对路径
 */
export function pathKey(rel: string): string {
  return normalizeRelPath(rel).toLowerCase()
}

/**
 * 拼接相对路径（`/` 分隔；空段安全）
 * @param parent 父相对路径
 * @param name 子段名
 */
export function joinRelPath(parent: string, name: string): string {
  const base = normalizeRelPath(parent)
  const child = normalizeRelPath(name)
  if (base === '') return child
  if (child === '') return base
  return `${base}/${child}`
}

/**
 * 拼接绝对路径（按 root 的分隔符风格转换相对路径）
 * @param root 根目录绝对路径
 * @param rel 相对路径（`/` 或 `\` 均可）
 */
export function joinRootPath(root: string, rel: string): string {
  const separator = root.includes('\\') || !root.includes('/') ? '\\' : '/'
  const base = root.replace(/[\\/]+$/, '')
  const normalized = normalizeRelPath(rel)
  if (normalized === '') return base
  if (base === '') return normalized
  return `${base}${separator}${normalized.split('/').join(separator)}`
}

/**
 * 单条配对分类：缺失侧 → only-*；两侧均有 → 比较大小与修改时间
 * @param rel 相对路径（展示保留原样）
 * @param left 左侧元数据（缺失为 null）
 * @param right 右侧元数据（缺失为 null）
 * @param compareMtime 是否比较修改时间
 * @param toleranceMs 修改时间容差（毫秒，差 ≤ 容差视为相同）
 */
export function classifyPair(
  rel: string,
  left: FileMeta | null,
  right: FileMeta | null,
  compareMtime: boolean,
  toleranceMs: number = MTIME_TOLERANCE_MS
): CompareEntry | null {
  if (left === null && right === null) return null
  const path = normalizeRelPath(rel)
  if (left !== null && right === null) {
    return {
      path,
      status: 'only-left',
      sizeLeft: left.size,
      sizeRight: null,
      mtimeLeft: left.mtimeMs,
      mtimeRight: null,
      sizeChanged: false,
      mtimeChanged: false
    }
  }
  if (left === null && right !== null) {
    return {
      path,
      status: 'only-right',
      sizeLeft: null,
      sizeRight: right.size,
      mtimeLeft: null,
      mtimeRight: right.mtimeMs,
      sizeChanged: false,
      mtimeChanged: false
    }
  }
  if (left === null || right === null) return null
  const tolerance = Math.max(0, toleranceMs)
  const sizeChanged = left.size !== right.size
  const mtimeChanged = compareMtime && Math.abs(left.mtimeMs - right.mtimeMs) > tolerance
  return {
    path,
    status: sizeChanged || mtimeChanged ? 'different' : 'same',
    sizeLeft: left.size,
    sizeRight: right.size,
    mtimeLeft: left.mtimeMs,
    mtimeRight: right.mtimeMs,
    sizeChanged,
    mtimeChanged
  }
}

/** 四类计数 */
export interface DiffSummary {
  onlyLeft: number
  onlyRight: number
  different: number
  same: number
}

/**
 * 汇总四类计数
 * @param entries 配对结果
 */
export function summarize(entries: readonly CompareEntry[]): DiffSummary {
  const summary: DiffSummary = { onlyLeft: 0, onlyRight: 0, different: 0, same: 0 }
  for (const entry of entries) {
    if (entry.status === 'only-left') summary.onlyLeft += 1
    else if (entry.status === 'only-right') summary.onlyRight += 1
    else if (entry.status === 'different') summary.different += 1
    else summary.same += 1
  }
  return summary
}

/** 状态排序优先级（仅左 → 仅右 → 有差异 → 相同） */
const STATUS_RANK: Record<DiffStatus, number> = {
  'only-left': 0,
  'only-right': 1,
  different: 2,
  same: 3
}

/**
 * 排序：状态优先级 → 相对路径升序（大小写不敏感；不修改原数组）
 * @param entries 配对结果
 */
export function sortEntries(entries: readonly CompareEntry[]): CompareEntry[] {
  return [...entries].sort((a, b) => {
    const rankDiff = STATUS_RANK[a.status] - STATUS_RANK[b.status]
    if (rankDiff !== 0) return rankDiff
    const left = a.path.toLowerCase()
    const right = b.path.toLowerCase()
    if (left < right) return -1
    if (left > right) return 1
    return a.path.localeCompare(b.path)
  })
}

/** 筛选状态：全部 / 仅差异（非相同）/ 四类之一 */
export type DiffFilterStatus = 'all' | 'changed' | DiffStatus

export interface DiffFilter {
  status: DiffFilterStatus
  keyword: string
}

/**
 * 筛选：状态 + 相对路径关键字（去首尾空白、大小写不敏感包含）
 * @param entries 配对结果
 * @param filter 状态与关键字
 */
export function filterEntries(entries: readonly CompareEntry[], filter: DiffFilter): CompareEntry[] {
  const keyword = filter.keyword.trim().toLowerCase()
  return entries.filter((entry) => {
    if (filter.status === 'changed') {
      if (entry.status === 'same') return false
    } else if (filter.status !== 'all' && entry.status !== filter.status) {
      return false
    }
    return keyword === '' || entry.path.toLowerCase().includes(keyword)
  })
}

/** 折叠结果（前 N 条 + 其余数量） */
export interface LimitedEntries {
  shown: CompareEntry[]
  hiddenCount: number
}

/**
 * 展示上限：截取前 limit 条，其余只计数
 * @param entries 已排序结果
 * @param limit 展示条数（≤0 时全部隐藏）
 */
export function limitEntries(entries: readonly CompareEntry[], limit: number): LimitedEntries {
  const shown = limit > 0 ? entries.slice(0, limit) : []
  return { shown: [...shown], hiddenCount: entries.length - shown.length }
}
