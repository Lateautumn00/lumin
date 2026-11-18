/**
 * OCR 题区渲染端编辑模型（spec §10.2：边界微调为渲染端状态，导出时随 payload 提交）。
 * 全部纯函数、不触 DOM，供树区 overlay 与单测共用。
 *
 * 结构前提（`ocr-cluster.ts` 保证）：同列题区首尾相接（首题区 start=0、末题区 end=1），
 * 双栏页左右列各自独立 tiling；分界线 = 同列相邻题区的公共 y。
 */
import type { OcrLine, OcrPage, OcrRegion } from '../schema'

/** 相邻题区分界线最小间距（归一化页高；拖动/拆分时夹取，防退化题区） */
export const MIN_BOUNDARY_GAP = 0.01

/** 浮点比较容差（坐标均为 0–1 比例） */
const EPS = 1e-9

/** 分界线引用：页 + 列 + 列内「第 afterRegion 个题区之后」（0-based） */
export interface BoundaryRef {
  pageNumber: number
  columnIndex: number
  afterRegion: number
}

/** 同列题区分组（x 边界相同视为一列；顺序与 clusterPage 输出一致：左列在前） */
export interface OcrColumn {
  xStart: number
  xEnd: number
  /** 该列题区在 `page.regions` 中的下标 */
  regionIndexes: number[]
}

/** 一条可拖拽分界线的完整信息（overlay 直接渲染用） */
export interface BoundaryInfo {
  ref: BoundaryRef
  /** 页内归一化 y（0–1） */
  y: number
  xStart: number
  xEnd: number
  prevRegionIndex: number
  nextRegionIndex: number
}

/** 题目列表项（题号按页序 + 页内题序连续编号） */
export interface NumberedRegion {
  number: number
  pageNumber: number
  regionIndex: number
  lineCount: number
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

/** 题区横向范围（缺省 xStart/xEnd = 全宽） */
export function regionX(region: OcrRegion): { xStart: number; xEnd: number } {
  return { xStart: region.xStart ?? 0, xEnd: region.xEnd ?? 1 }
}

/** 按横向范围分组（连续同 x 视为同一列；编辑操作保持列内顺序不变） */
export function groupColumns(page: OcrPage): OcrColumn[] {
  const columns: OcrColumn[] = []
  page.regions.forEach((region, index) => {
    const { xStart, xEnd } = regionX(region)
    const last = columns.at(-1)
    if (
      last !== undefined &&
      Math.abs(last.xStart - xStart) < EPS &&
      Math.abs(last.xEnd - xEnd) < EPS
    ) {
      last.regionIndexes.push(index)
      return
    }
    columns.push({ xStart, xEnd, regionIndexes: [index] })
  })
  return columns
}

/** 页内全部分界线（每列除末题区外，每个题区贡献一条） */
export function boundaries(page: OcrPage): BoundaryInfo[] {
  const out: BoundaryInfo[] = []
  groupColumns(page).forEach((column, columnIndex) => {
    for (let afterRegion = 0; afterRegion < column.regionIndexes.length - 1; afterRegion++) {
      const prevRegionIndex = column.regionIndexes[afterRegion]
      const nextRegionIndex = column.regionIndexes[afterRegion + 1]
      if (prevRegionIndex === undefined || nextRegionIndex === undefined) continue
      const prev = page.regions[prevRegionIndex]
      if (prev === undefined) continue
      out.push({
        ref: { pageNumber: page.pageNumber, columnIndex, afterRegion },
        y: prev.end,
        xStart: column.xStart,
        xEnd: column.xEnd,
        prevRegionIndex,
        nextRegionIndex
      })
    }
  })
  return out
}

/** 引用 → 分界线信息（越界/失配返回 null） */
export function resolveBoundary(page: OcrPage, ref: BoundaryRef): BoundaryInfo | null {
  if (ref.pageNumber !== page.pageNumber) return null
  const column = groupColumns(page)[ref.columnIndex]
  if (column === undefined) return null
  const prevRegionIndex = column.regionIndexes[ref.afterRegion]
  const nextRegionIndex = column.regionIndexes[ref.afterRegion + 1]
  if (prevRegionIndex === undefined || nextRegionIndex === undefined) return null
  const prev = page.regions[prevRegionIndex]
  if (prev === undefined) return null
  return {
    ref,
    y: prev.end,
    xStart: column.xStart,
    xEnd: column.xEnd,
    prevRegionIndex,
    nextRegionIndex
  }
}

/** 拖动分界线：同列相邻两题区公共边移动（夹在邻居与最小间距内） */
export function moveBoundary(
  page: OcrPage,
  ref: BoundaryRef,
  y: number,
  gap = MIN_BOUNDARY_GAP
): OcrPage {
  const info = resolveBoundary(page, ref)
  if (info === null || !Number.isFinite(y)) return page
  const prev = page.regions[info.prevRegionIndex]
  const next = page.regions[info.nextRegionIndex]
  if (prev === undefined || next === undefined) return page
  const min = prev.start + gap
  const max = next.end - gap
  if (max < min) return page
  const value = Math.min(max, Math.max(min, clamp01(y)))
  if (Math.abs(prev.end - value) < EPS && Math.abs(next.start - value) < EPS) return page
  const regions = page.regions.map((region, index) => {
    if (index === info.prevRegionIndex) return { ...region, end: value }
    if (index === info.nextRegionIndex) return { ...region, start: value }
    return region
  })
  return { ...page, regions }
}

/** 点击插入分界线：按 x 命中列、y 命中题区后拆分为两题（行按中心 y 归边） */
export function addBoundary(page: OcrPage, x: number, y: number, gap = MIN_BOUNDARY_GAP): OcrPage {
  if (page.regions.length === 0 || !Number.isFinite(x) || !Number.isFinite(y)) return page
  const columns = groupColumns(page)
  const columnIndex = columns.findIndex(
    (column) => x >= column.xStart - EPS && x <= column.xEnd + EPS
  )
  const column = columns[columnIndex === -1 ? columns.length - 1 : columnIndex]
  if (column === undefined) return page
  const regionIndex = column.regionIndexes.find(
    (index) =>
      (page.regions[index]?.start ?? 1) - EPS <= y && y <= (page.regions[index]?.end ?? 0) + EPS
  )
  if (regionIndex === undefined) return page
  const region = page.regions[regionIndex]
  if (region === undefined || region.end - region.start < 2 * gap) return page
  const value = Math.min(region.end - gap, Math.max(region.start + gap, clamp01(y)))
  if (value <= region.start || value >= region.end) return page
  const isBefore = (line: OcrLine): boolean => line.y + line.height / 2 < value
  const before: OcrRegion = { ...region, end: value, lines: region.lines.filter(isBefore) }
  const after: OcrRegion = {
    ...region,
    start: value,
    lines: region.lines.filter((line) => !isBefore(line))
  }
  const regions = [
    ...page.regions.slice(0, regionIndex),
    before,
    after,
    ...page.regions.slice(regionIndex + 1)
  ]
  return { ...page, regions }
}

/** 删除分界线：合并同列相邻两题区（行集合并） */
export function deleteBoundary(page: OcrPage, ref: BoundaryRef): OcrPage {
  const info = resolveBoundary(page, ref)
  if (info === null) return page
  const prev = page.regions[info.prevRegionIndex]
  const next = page.regions[info.nextRegionIndex]
  if (prev === undefined || next === undefined) return page
  const regions: OcrRegion[] = []
  page.regions.forEach((region, index) => {
    if (index === info.prevRegionIndex) {
      regions.push({ ...region, end: next.end, lines: [...region.lines, ...next.lines] })
      return
    }
    if (index === info.nextRegionIndex) return
    regions.push(region)
  })
  return { ...page, regions }
}

/** 深拷贝（识别结果 → 可编辑状态；避免两条状态链共享引用） */
export function clonePage(page: OcrPage): OcrPage {
  return {
    ...page,
    regions: page.regions.map((region) => ({
      ...region,
      lines: region.lines.map((line) => ({ ...line }))
    }))
  }
}

export function clonePages(pages: readonly OcrPage[]): OcrPage[] {
  return pages.map(clonePage)
}

function byPageNumber(a: OcrPage, b: OcrPage): number {
  return a.pageNumber - b.pageNumber
}

/** 写入/替换单页（保持页号升序；供编辑操作回写状态） */
export function upsertPage(pages: readonly OcrPage[], page: OcrPage): OcrPage[] {
  const exists = pages.some((item) => item.pageNumber === page.pageNumber)
  const next = exists
    ? pages.map((item) => (item.pageNumber === page.pageNumber ? page : item))
    : [...pages, page]
  return [...next].sort(byPageNumber)
}

/**
 * 重置本页边界：有自动结果 → 恢复该页自动结果；手动页（无自动结果）→ 清空题区。
 * 其它页微调不受影响（2026-11-18 P3 拍板）。
 */
export function resetPage(
  pages: readonly OcrPage[],
  detected: readonly OcrPage[],
  pageNumber: number
): OcrPage[] {
  const source = detected.find((page) => page.pageNumber === pageNumber)
  const current = pages.find((page) => page.pageNumber === pageNumber)
  if (source !== undefined) return upsertPage(pages, clonePage(source))
  if (current === undefined) return [...pages]
  return pages.map((page) => (page.pageNumber === pageNumber ? { ...page, regions: [] } : page))
}

/** 空页建整页题区（NO_REGIONS 手动模式 / 多页空白页兜底；已有题区时幂等） */
export function ensureRegion(page: OcrPage): OcrPage {
  if (page.regions.length > 0) return page
  return { ...page, regions: [{ start: 0, end: 1, lines: [] }] }
}

export function hasRegions(pages: readonly OcrPage[]): boolean {
  return pages.some((page) => page.regions.length > 0)
}

/**
 * 导出载荷：按页号排序、剔除 0 题区页、清空 `lines`（导出不读行内容，降低 IPC 体积）。
 * 返回新对象，不修改编辑态。
 */
export function toExportPages(pages: readonly OcrPage[]): OcrPage[] {
  return [...pages]
    .filter((page) => page.regions.length > 0)
    .sort(byPageNumber)
    .map((page) => ({
      ...page,
      regions: page.regions.map((region) => ({ ...region, lines: [] }))
    }))
}

/** 题目列表编号：页序 + 页内题序连续，题号自 `startNumber` 起 */
export function numberRegions(pages: readonly OcrPage[], startNumber: number): NumberedRegion[] {
  const out: NumberedRegion[] = []
  let number = startNumber
  for (const page of [...pages].sort(byPageNumber)) {
    page.regions.forEach((region, regionIndex) => {
      out.push({
        number,
        pageNumber: page.pageNumber,
        regionIndex,
        lineCount: region.lines.length
      })
      number += 1
    })
  }
  return out
}
