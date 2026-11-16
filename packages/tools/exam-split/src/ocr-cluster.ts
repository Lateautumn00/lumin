/**
 * 题区聚类（spec §10.4）：页面级双栏列检测 + 按题号两级规则把文本行聚成题区。
 * 全部纯函数，供单测覆盖（R1 ≥80%）。
 *
 * 规则（2026-11-16 回写 spec §10.4）：
 * - 列检测：列间空隙 ≥3% 页宽且两列均含题号行；全宽标题行不参与检测、按中心归属
 * - 题号两级：一级 `1.` `1、` `一、` `第1题`；仅当该列无一级题号时才启用二级 `(1)`
 * - 两者皆无 → 整列/整页一个 region；首 region start=0、末 region end=1，边界取两题号行间空隙中点
 */
import type { OcrLine, OcrRegion } from './schema'

/**
 * 一级题号（spec §10.4）：`1.` `1、` `一、` `第1题`。
 * `．` 为 OCR 常见全角变体；`.` 后接数字视为小数（如 `1.5`）不匹配。
 */
export const PRIMARY_QNUM_RE =
  /^\s*(?:第\s*\d+\s*题|\d+\s*(?:、|[.．](?!\d))|[一二三四五六七八九十]{1,2}\s*[、.．])/

/** 二级题号（spec §10.4）：`(1)` / `（1）`，仅当所在列/页无一级题号时启用 */
export const SECONDARY_QNUM_RE = /^\s*[（(]\s*\d+\s*[）)]/

/** 列间空隙下限（归一化页宽；spec §10.4：≥3% 才判分栏） */
export const COLUMN_GAP_MIN = 0.03

/** 视为全宽（不参与列检测）的行宽下限 */
export const FULL_WIDTH_LINE = 0.55

/** 相邻边界最小间隔（防退化输入产出 start≥end 的无效题区） */
const MIN_BOUNDARY_GAP = 1e-6

export function isPrimaryQNum(text: string): boolean {
  return PRIMARY_QNUM_RE.test(text)
}

export function isSecondaryQNum(text: string): boolean {
  return SECONDARY_QNUM_RE.test(text)
}

function centerX(line: OcrLine): number {
  return line.x + line.width / 2
}

function centerY(line: OcrLine): number {
  return line.y + line.height / 2
}

/** 题号行选取：优先一级；整批无一级才用二级（spec §10.4 两级规则） */
function pickQuestionLines(lines: readonly OcrLine[]): OcrLine[] {
  const primary = lines.filter((line) => isPrimaryQNum(line.text))
  if (primary.length > 0) return primary
  return lines.filter((line) => isSecondaryQNum(line.text))
}

/** 题号行去重：中心 y 严格递增（抑制 det 重叠框导致的退化边界） */
function dedupeStarts(lines: readonly OcrLine[]): OcrLine[] {
  const out: OcrLine[] = []
  let prevCenter = -Infinity
  for (const line of lines) {
    const center = centerY(line)
    if (center <= prevCenter) continue
    out.push(line)
    prevCenter = center
  }
  return out
}

function maxRight(lines: readonly OcrLine[]): number {
  let max = 0
  for (const line of lines) {
    const right = line.x + line.width
    if (right > max) max = right
  }
  return max
}

function minLeft(lines: readonly OcrLine[]): number {
  let min = 1
  for (const line of lines) {
    if (line.x < min) min = line.x
  }
  return min
}

/**
 * 页面级双栏列边界检测（spec §10.4）。
 *
 * 候选 = 非全宽行；按中心 x 排序后取相邻分组间最大空隙；空隙 ≥3% 页宽、
 * 且按中点切分后左右两列均含题号行 → 返回切分 x（0–1）；否则 null（单栏）。
 */
export function detectColumnSplit(lines: readonly OcrLine[]): number | null {
  const candidates = lines.filter((line) => line.width < FULL_WIDTH_LINE)
  if (candidates.length < 2) return null

  const questionLines = pickQuestionLines(lines)
  if (questionLines.length < 2) return null

  const ordered = [...candidates].sort((a, b) => centerX(a) - centerX(b))
  let bestGap = 0
  let bestLeftMax = 0
  let bestRightMin = 1
  for (let i = 0; i < ordered.length - 1; i++) {
    const left = ordered.slice(0, i + 1)
    const right = ordered.slice(i + 1)
    const gap = minLeft(right) - maxRight(left)
    if (gap > bestGap) {
      bestGap = gap
      bestLeftMax = maxRight(left)
      bestRightMin = minLeft(right)
    }
  }
  if (bestGap < COLUMN_GAP_MIN) return null

  const splitX = (bestLeftMax + bestRightMin) / 2
  if (splitX <= 0 || splitX >= 1) return null

  const leftQuestions = questionLines.filter((line) => centerX(line) < splitX)
  const rightQuestions = questionLines.filter((line) => centerX(line) >= splitX)
  if (leftQuestions.length === 0 || rightQuestions.length === 0) return null
  return splitX
}

function makeRegion(
  start: number,
  end: number,
  lines: readonly OcrLine[],
  xStart?: number,
  xEnd?: number
): OcrRegion {
  const regionLines = lines.filter((line) => {
    const center = centerY(line)
    return center >= start && center < end
  })
  const region: OcrRegion = { start, end, lines: regionLines }
  if (xStart !== undefined) region.xStart = xStart
  if (xEnd !== undefined) region.xEnd = xEnd
  return region
}

/**
 * 单列（或整页单栏）聚类：题号行切分 region。
 * 边界 = 相邻题号行间空隙中点（重叠时退化为下题号行顶）；首 region start=0、末 region end=1。
 */
function clusterColumn(lines: readonly OcrLine[], xStart?: number, xEnd?: number): OcrRegion[] {
  if (lines.length === 0) return []
  const ordered = [...lines].sort((a, b) => a.y - b.y || a.x - b.x)
  const starts = dedupeStarts(pickQuestionLines(ordered))
  if (starts.length === 0) return [makeRegion(0, 1, ordered, xStart, xEnd)]

  const regions: OcrRegion[] = []
  let start = 0
  for (let i = 0; i < starts.length; i++) {
    const current = starts[i]
    if (current === undefined) continue
    const next = starts[i + 1]
    let end = 1
    if (next !== undefined) {
      const prevBottom = current.y + current.height
      const mid = (prevBottom + next.y) / 2
      end = Math.min(Math.max(mid, start + MIN_BOUNDARY_GAP), 1 - MIN_BOUNDARY_GAP)
      if (end <= start) break
    }
    regions.push(makeRegion(start, end, ordered, xStart, xEnd))
    start = end
  }
  return regions
}

/**
 * 整页聚类（spec §10.4）：检测到分栏 → 左右列独立聚类（左列前、右列后，符合阅读顺序），
 * region 附 `xStart`/`xEnd`；否则整页单栏、不附 x 边界（缺省 = 全宽）。
 */
export function clusterPage(lines: readonly OcrLine[]): OcrRegion[] {
  if (lines.length === 0) return []
  const splitX = detectColumnSplit(lines)
  if (splitX === null) return clusterColumn(lines)
  const left = lines.filter((line) => centerX(line) < splitX)
  const right = lines.filter((line) => centerX(line) >= splitX)
  return [...clusterColumn(left, 0, splitX), ...clusterColumn(right, splitX, 1)]
}
