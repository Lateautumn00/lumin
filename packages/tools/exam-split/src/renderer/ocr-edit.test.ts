import { describe, expect, it } from 'vitest'
import type { OcrLine, OcrPage, OcrRegion } from '../schema'
import {
  MIN_BOUNDARY_GAP,
  addBoundary,
  boundaries,
  clonePages,
  deleteBoundary,
  ensureRegion,
  groupColumns,
  hasRegions,
  moveBoundary,
  numberRegions,
  regionX,
  resetPage,
  resolveBoundary,
  toExportPages,
  upsertPage,
  type BoundaryRef
} from './ocr-edit'

function line(text: string, y: number, height = 0.04): OcrLine {
  return { text, x: 0.05, y, width: 0.4, height }
}

function region(
  start: number,
  end: number,
  lines: OcrLine[] = [],
  x?: [number, number]
): OcrRegion {
  const out: OcrRegion = { start, end, lines }
  if (x !== undefined) {
    out.xStart = x[0]
    out.xEnd = x[1]
  }
  return out
}

/** 单栏三题（0–0.4 / 0.4–0.7 / 0.7–1） */
function singleColumnPage(pageNumber = 1): OcrPage {
  return {
    pageNumber,
    width: 893,
    height: 1263,
    regions: [
      region(0, 0.4, [line('1、第一题', 0.1)]),
      region(0.4, 0.7, [line('2、第二题', 0.45), line('第二题第二行', 0.55)]),
      region(0.7, 1, [line('3、第三题', 0.75)])
    ]
  }
}

/** 双栏：左列 0.4 / 右列 0.45，各自首尾相接 */
function doubleColumnPage(pageNumber = 2): OcrPage {
  return {
    pageNumber,
    width: 893,
    height: 1263,
    regions: [
      region(0, 0.4, [line('1、左一', 0.1)], [0, 0.45]),
      region(0.4, 1, [line('3、左二', 0.5)], [0, 0.45]),
      region(0, 0.45, [line('2、右一', 0.15)], [0.45, 1]),
      region(0.45, 1, [line('4、右二', 0.55)], [0.45, 1])
    ]
  }
}

describe('groupColumns / regionX（spec §10.4 双栏）', () => {
  it('单栏缺省 xStart/xEnd = 0/1，全部题区同列', () => {
    expect(regionX(region(0, 0.5))).toEqual({ xStart: 0, xEnd: 1 })
    const columns = groupColumns(singleColumnPage())
    expect(columns).toHaveLength(1)
    expect(columns[0]).toEqual({ xStart: 0, xEnd: 1, regionIndexes: [0, 1, 2] })
  })

  it('双栏按连续相同 x 边界分组（左列在前、右列在后）', () => {
    const columns = groupColumns(doubleColumnPage())
    expect(columns).toEqual([
      { xStart: 0, xEnd: 0.45, regionIndexes: [0, 1] },
      { xStart: 0.45, xEnd: 1, regionIndexes: [2, 3] }
    ])
  })

  it('空页 → 无列', () => {
    expect(groupColumns({ pageNumber: 1, width: 10, height: 10, regions: [] })).toEqual([])
  })
})

describe('boundaries / resolveBoundary', () => {
  it('每列除末题区外各贡献一条分界线', () => {
    const single = boundaries(singleColumnPage())
    expect(single.map((item) => item.y)).toEqual([0.4, 0.7])
    expect(single.map((item) => item.ref)).toEqual([
      { pageNumber: 1, columnIndex: 0, afterRegion: 0 },
      { pageNumber: 1, columnIndex: 0, afterRegion: 1 }
    ])

    const double = boundaries(doubleColumnPage())
    expect(double.map((item) => [item.ref.columnIndex, item.ref.afterRegion, item.y])).toEqual([
      [0, 0, 0.4],
      [1, 0, 0.45]
    ])
    expect(double.map((item) => [item.xStart, item.xEnd])).toEqual([
      [0, 0.45],
      [0.45, 1]
    ])
  })

  it('引用失配（页号/列号/末题区之后）→ null', () => {
    const page = singleColumnPage()
    expect(resolveBoundary(page, { pageNumber: 2, columnIndex: 0, afterRegion: 0 })).toBeNull()
    expect(resolveBoundary(page, { pageNumber: 1, columnIndex: 4, afterRegion: 0 })).toBeNull()
    expect(resolveBoundary(page, { pageNumber: 1, columnIndex: 0, afterRegion: 2 })).toBeNull()
    expect(resolveBoundary(page, { pageNumber: 1, columnIndex: 0, afterRegion: 1 })?.y).toBe(0.7)
  })
})

describe('moveBoundary（拖拽微调）', () => {
  const ref: BoundaryRef = { pageNumber: 1, columnIndex: 0, afterRegion: 0 }

  it('拖动同时改写相邻题区公共边（保持首尾相接）', () => {
    const page = moveBoundary(singleColumnPage(), ref, 0.5)
    expect(page.regions[0]?.end).toBe(0.5)
    expect(page.regions[1]?.start).toBe(0.5)
    expect(page.regions[2]).toEqual(singleColumnPage().regions[2])
  })

  it('夹取到 min(邻居 end) / max(邻居 start) 与最小间距内', () => {
    const page = singleColumnPage()
    const down = moveBoundary(page, ref, 0.99)
    expect(down.regions[0]?.end).toBeCloseTo(0.7 - MIN_BOUNDARY_GAP, 9)
    const up = moveBoundary(page, ref, -1)
    expect(up.regions[0]?.end).toBeCloseTo(MIN_BOUNDARY_GAP, 9)
  })

  it('引用无效/坐标非有限值 → 原页返回（不产生改动）', () => {
    const page = singleColumnPage()
    expect(moveBoundary(page, { pageNumber: 9, columnIndex: 0, afterRegion: 0 }, 0.5)).toBe(page)
    expect(moveBoundary(page, ref, Number.NaN)).toBe(page)
  })

  it('坐标未变化 → 原页返回（避免无意义重渲染）', () => {
    const page = singleColumnPage()
    expect(moveBoundary(page, ref, 0.4)).toBe(page)
  })
})

describe('addBoundary（点击插入分界线）', () => {
  it('拆分命中题区并保持相邻 y 相接，行按中心归属', () => {
    const page = singleColumnPage()
    const next = addBoundary(page, 0.5, 0.55)
    expect(next.regions).toHaveLength(4)
    expect(next.regions[1]).toMatchObject({ start: 0.4, end: 0.55 })
    expect(next.regions[1]?.lines).toHaveLength(1)
    expect(next.regions[2]).toMatchObject({ start: 0.55, end: 0.7 })
    expect(next.regions[2]?.lines.map((item) => item.text)).toEqual(['第二题第二行'])
  })

  it('双栏按点击 x 命中列（右列插入不改左列）', () => {
    const next = addBoundary(doubleColumnPage(), 0.75, 0.6)
    expect(next.regions).toHaveLength(5)
    const right = next.regions.filter((item) => item.xStart === 0.45)
    expect(right.map((item) => [item.start, item.end])).toEqual([
      [0, 0.45],
      [0.45, 0.6],
      [0.6, 1]
    ])
    expect(next.regions.filter((item) => item.xStart === 0)).toEqual(
      doubleColumnPage().regions.filter((item) => item.xStart === 0)
    )
  })

  it('插入点夹到最小间距（贴边点击不产生退化题区）', () => {
    const next = addBoundary(singleColumnPage(), 0.5, 0)
    expect(next.regions[0]?.end).toBeCloseTo(MIN_BOUNDARY_GAP, 9)
    expect(next.regions[0]?.start).toBe(0)
    expect(next.regions[1]?.start).toBeCloseTo(MIN_BOUNDARY_GAP, 9)
  })

  it('空页/过小题区 → 原页返回', () => {
    const empty: OcrPage = { pageNumber: 1, width: 10, height: 10, regions: [] }
    expect(addBoundary(empty, 0.5, 0.5)).toBe(empty)
    const tiny: OcrPage = {
      pageNumber: 1,
      width: 10,
      height: 10,
      regions: [region(0.5, 0.5 + MIN_BOUNDARY_GAP, [], [0, 1])]
    }
    expect(addBoundary(tiny, 0.5, 0.505)).toBe(tiny)
  })
})

describe('deleteBoundary（删除分界线）', () => {
  it('合并相邻题区并合并行集', () => {
    const page = singleColumnPage()
    const next = deleteBoundary(page, { pageNumber: 1, columnIndex: 0, afterRegion: 0 })
    expect(next.regions).toHaveLength(2)
    expect(next.regions[0]).toMatchObject({ start: 0, end: 0.7 })
    expect(next.regions[0]?.lines.map((item) => item.text)).toEqual([
      '1、第一题',
      '2、第二题',
      '第二题第二行'
    ])
    // 合并后分界线只剩一条（原 0.7）
    expect(boundaries(next).map((item) => item.y)).toEqual([0.7])
  })

  it('末题区之后/引用无效 → 原页返回', () => {
    const page = singleColumnPage()
    expect(deleteBoundary(page, { pageNumber: 1, columnIndex: 0, afterRegion: 2 })).toBe(page)
    expect(deleteBoundary(page, { pageNumber: 3, columnIndex: 0, afterRegion: 0 })).toBe(page)
  })
})

describe('resetPage（仅当前页恢复自动结果）', () => {
  it('恢复当前页自动结果，不影响其他页微调', () => {
    const detected = [singleColumnPage(1), singleColumnPage(2)]
    const editedFirst = moveBoundary(
      detected[0] as OcrPage,
      { pageNumber: 1, columnIndex: 0, afterRegion: 0 },
      0.5
    )
    const editedSecond = moveBoundary(
      detected[1] as OcrPage,
      { pageNumber: 2, columnIndex: 0, afterRegion: 0 },
      0.5
    )
    const reset = resetPage([editedFirst, editedSecond], detected, 1)
    expect(reset[0]).toEqual(detected[0])
    expect(reset[1]).toEqual(editedSecond)
    // 返回新数组、不共享自动结果引用
    expect(reset[0]).not.toBe(detected[0])
  })

  it('手动页（无自动结果）→ 清空题区但保留页尺寸', () => {
    const manual: OcrPage = {
      pageNumber: 5,
      width: 800,
      height: 1200,
      regions: [region(0, 1, [line('手写', 0.2)])]
    }
    const reset = resetPage([manual], [], 5)
    expect(reset[0]).toEqual({ pageNumber: 5, width: 800, height: 1200, regions: [] })
  })

  it('页不存在 → 返回副本', () => {
    const pages = [singleColumnPage(1)]
    const reset = resetPage(pages, [], 9)
    expect(reset).toEqual(pages)
    expect(reset).not.toBe(pages)
  })
})

describe('ensureRegion / hasRegions', () => {
  it('空页补整页题区，已有题区幂等', () => {
    const empty: OcrPage = { pageNumber: 1, width: 10, height: 10, regions: [] }
    const filled = ensureRegion(empty)
    expect(filled.regions).toEqual([{ start: 0, end: 1, lines: [] }])
    expect(ensureRegion(filled)).toBe(filled)
  })

  it('hasRegions 任页有题区即真', () => {
    const empty: OcrPage = { pageNumber: 1, width: 10, height: 10, regions: [] }
    expect(hasRegions([])).toBe(false)
    expect(hasRegions([empty])).toBe(false)
    expect(hasRegions([empty, ensureRegion(empty)])).toBe(true)
  })
})

describe('toExportPages（spec §10.4 导出载荷）', () => {
  it('按页号排序、剔除空页、清空 lines，且不修改编辑态', () => {
    const page1 = singleColumnPage(1)
    const page2 = singleColumnPage(2)
    const empty: OcrPage = { pageNumber: 3, width: 10, height: 10, regions: [] }
    const pages = [empty, page2, page1]
    const exported = toExportPages(pages)
    expect(exported.map((page) => page.pageNumber)).toEqual([1, 2])
    expect(exported[0]?.regions.every((item) => item.lines.length === 0)).toBe(true)
    expect(exported[0]?.regions[0]).toMatchObject({ start: 0, end: 0.4 })
    // 原编辑态保留行内容
    expect(page1.regions[0]?.lines).toHaveLength(1)
  })
})

describe('numberRegions（题号 = startNumber + 连续序号）', () => {
  it('按页序 + 页内题序编号，行数随编辑结果', () => {
    const pages = [doubleColumnPage(2), singleColumnPage(1)]
    const numbered = numberRegions(pages, 3)
    expect(numbered.map((item) => [item.number, item.pageNumber, item.regionIndex])).toEqual([
      [3, 1, 0],
      [4, 1, 1],
      [5, 1, 2],
      [6, 2, 0],
      [7, 2, 1],
      [8, 2, 2],
      [9, 2, 3]
    ])
    expect(numbered.map((item) => item.lineCount)).toEqual([1, 2, 1, 1, 1, 1, 1])
  })
})

describe('clonePages / upsertPage', () => {
  it('深拷贝后修改副本不影响源（region/line 均独立）', () => {
    const source = [singleColumnPage(1)]
    const copy = clonePages(source)
    const first = copy[0] as OcrPage
    const firstRegion = first.regions[0] as OcrRegion
    firstRegion.end = 0.9
    firstRegion.lines[0] = line('改', 0.1)
    expect(source[0]?.regions[0]?.end).toBe(0.4)
    expect(source[0]?.regions[0]?.lines[0]?.text).toBe('1、第一题')
  })

  it('替换同页 / 追加新页后保持页号升序', () => {
    const page1 = singleColumnPage(1)
    const replaced = { ...page1, regions: [] }
    expect(upsertPage([page1], replaced)[0]).toBe(replaced)
    const added = upsertPage([page1], singleColumnPage(3))
    expect(added.map((page) => page.pageNumber)).toEqual([1, 3])
    const sorted = upsertPage([page1], singleColumnPage(0))
    expect(sorted.map((page) => page.pageNumber)).toEqual([0, 1])
  })
})
