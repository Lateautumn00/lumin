/**
 * @file contract.ts 纯函数契约（默认勾选 / 回收后结果归一 / 汇总）
 * @author cuilanchao
 * @date 2026-11-19
 * @description 无副作用，renderer 直接使用；排序口径与 worker 输出一致。
 */
import type { DuplicateGroup } from './schema'

/** 组内文件排序：修改时间升序，同时间按路径升序 */
function byOldest(a: { path: string; mtimeMs: number }, b: { path: string; mtimeMs: number }): number {
  return a.mtimeMs - b.mtimeMs || a.path.localeCompare(b.path)
}

/**
 * 默认勾选：每组保留最早一份，其余文件进入待删除集合
 * @param groups 重复组
 */
export function autoSelect(groups: readonly DuplicateGroup[]): Set<string> {
  const selected = new Set<string>()
  for (const group of groups) {
    const sorted = [...group.files].sort(byOldest)
    for (const file of sorted.slice(1)) selected.add(file.path)
  }
  return selected
}

/**
 * 回收后结果归一：移除已删除路径，丢弃不足 2 项的组并重算可释放空间
 * @param groups 当前重复组
 * @param removed 已成功移入回收站的路径集合
 */
export function removePaths(
  groups: readonly DuplicateGroup[],
  removed: ReadonlySet<string>
): DuplicateGroup[] {
  const next: DuplicateGroup[] = []
  for (const group of groups) {
    const files = group.files.filter((file) => !removed.has(file.path))
    if (files.length < 2) continue
    next.push({ ...group, files, wastedBytes: group.size * (files.length - 1) })
  }
  return next.sort((a, b) => b.wastedBytes - a.wastedBytes || b.size - a.size)
}

/** 结果汇总（组数 / 文件数 / 可释放字节） */
export interface GroupSummary {
  groups: number
  files: number
  wastedBytes: number
}

/**
 * 汇总重复组
 * @param groups 重复组
 */
export function summarize(groups: readonly DuplicateGroup[]): GroupSummary {
  let files = 0
  let wastedBytes = 0
  for (const group of groups) {
    files += group.files.length
    wastedBytes += group.wastedBytes
  }
  return { groups: groups.length, files, wastedBytes }
}
