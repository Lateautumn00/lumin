import { extname } from 'node:path'
import { rangeLabel, toRangeList } from './ranges'

/** 去扩展名基名（schema 已约束 .pdf；无扩展名时原样返回） */
function baseName(inputPath: string): string {
  const ext = extname(inputPath)
  return ext === '' ? inputPath : inputPath.slice(0, -ext.length)
}

/** 区间组标签（组内页码连续，取首尾） */
function groupLabel(pages: readonly number[]): string {
  const first = pages[0]
  const last = pages[pages.length - 1]
  if (first === undefined || last === undefined) return ''
  return rangeLabel({ start: first, end: last })
}

/** 拆分：`{原名}_p{标签}.pdf`，每区间一个产物（spec §7.2） */
export function splitDesiredPaths(inputPath: string, groups: readonly number[][]): string[] {
  const base = baseName(inputPath)
  return groups.map((pages) => `${base}_p${groupLabel(pages)}.pdf`)
}

/** 合并：`{首个原名}_合并.pdf`（spec §7.2） */
export function mergeDesiredPath(inputPaths: readonly string[]): string {
  const first = inputPaths[0]
  if (first === undefined) return '_合并.pdf'
  return `${baseName(first)}_合并.pdf`
}

/** 删页：`{原名}_删p{标签}.pdf`（多段以逗号连接，如 `2-3,7`；spec §7.2） */
export function deleteDesiredPath(inputPath: string, pages: readonly number[]): string {
  const label = toRangeList(pages).map(rangeLabel).join(',')
  return `${baseName(inputPath)}_删p${label}.pdf`
}

/** 旋转：`{原名}_旋转{90|180|270}.pdf`（spec §7.2） */
export function rotateDesiredPath(inputPath: string, degrees: number): string {
  return `${baseName(inputPath)}_旋转${degrees}.pdf`
}

/** 裁剪：`{原名}_裁剪.pdf`（spec §7.2） */
export function cropDesiredPath(inputPath: string): string {
  return `${baseName(inputPath)}_裁剪.pdf`
}
