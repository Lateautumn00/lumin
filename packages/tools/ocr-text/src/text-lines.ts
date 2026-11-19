/**
 * @file 识别行阅读顺序（纯函数，spec §1.2/§5.3）
 * @author cuilanchao
 * @date 2026-11-19
 * @description det 输出按发现顺序而非阅读顺序；按纵向重叠聚类成行，行内按 x 排序，
 *              再以换行拼接。不依赖 node API，renderer/worker 均可复用。
 */
import type { OcrTextLine } from './schema'

/** 纵向重叠占较矮行高的比例（>0.5 视为同一行） */
const SAME_ROW_OVERLAP = 0.5

function centerY(line: OcrTextLine): number {
  return line.y + line.height / 2
}

/** 两行纵向重叠比例 = 重叠高度 / 较矮行高（行高为 0 时视为不重叠） */
export function verticalOverlapRatio(a: OcrTextLine, b: OcrTextLine): number {
  const top = Math.max(a.y, b.y)
  const bottom = Math.min(a.y + a.height, b.y + b.height)
  const minHeight = Math.min(a.height, b.height)
  if (minHeight <= 0) return 0
  return (bottom - top) / minHeight
}

/**
 * 按「先行后列」重排识别行。
 * @param lines 原始识别行（任意顺序）
 * @returns 新数组（不修改入参）；跨行按中心 y 升序，行内按 x 升序
 */
export function sortReadingOrder(lines: readonly OcrTextLine[]): OcrTextLine[] {
  const sorted = [...lines].sort((a, b) => centerY(a) - centerY(b) || a.x - b.x)
  const rows: OcrTextLine[][] = []
  for (const line of sorted) {
    const row = rows[rows.length - 1]
    const reference = row?.[0]
    if (row !== undefined && reference !== undefined && verticalOverlapRatio(reference, line) > SAME_ROW_OVERLAP) {
      row.push(line)
    } else {
      rows.push([line])
    }
  }
  return rows.flatMap((row) => [...row].sort((a, b) => a.x - b.x || a.y - b.y))
}

/** 以换行拼接文本（行序即 sortReadingOrder 输出顺序） */
export function composeText(lines: readonly OcrTextLine[]): string {
  return lines.map((line) => line.text).join('\n')
}
