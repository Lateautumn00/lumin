/**
 * 题区聚类（spec §10.4）：页面级双栏列检测 + 按题号两级规则把文本行聚成题区。
 * 全部纯函数，供单测覆盖（R1 ≥80%）。
 *
 * 规则（2026-11-16 回写 spec §10.4；2026-11-18 P4 修订列检测）：
 * - 列检测：按 1% 页宽统计文本行框覆盖率，取页面中部（0.2–0.8）最宽且明显比栏内更空的
 *   覆盖率谷底作为栏缝/书脊（≥3% 页宽），且两侧各含题号行；跨缝的页脚/页码行由覆盖阈值容忍
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

/**
 * 栏缝/书脊最小宽度（归一化页宽；spec §10.4：谷底 ≥3% 才判分栏或跨页展开）。
 * P4 起不再用「相邻行框最大空隙」——跨页照书脊很窄且页脚跨缝，旧口径恒判单栏。
 */
export const COLUMN_GAP_MIN = 0.03

/** 覆盖率分桶数（1% 页宽一桶） */
const COLUMN_BINS = 100

/** 谷底覆盖阈值（占行数比例；容忍页脚/页码等少量跨缝行，下限 1 行） */
const VALLEY_LINE_RATIO = 0.03

/**
 * 谷底与页面中部典型密度的对比下限（谷底平均覆盖 ≤ 中位密度 × 该比例）。
 * 防稀疏页把「整页都只有 1 行覆盖」误判成栏缝（真实两栏/跨页的谷底明显更空）。
 */
const VALLEY_DENSITY_RATIO = 0.5

/** 谷底搜索范围（避开页边留白：书脊与栏缝都在页面中部） */
const VALLEY_MIN_X = 0.2
const VALLEY_MAX_X = 0.8

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

/**
 * 文本行框横向覆盖率曲线（每桶命中的行数；0–100 桶 = 0–1 页宽）。
 * 行框按 half-open 区间计入，宽度为 0 的行不会命中任何桶。
 */
function coverageProfile(lines: readonly OcrLine[]): number[] {
  const bins = new Array<number>(COLUMN_BINS).fill(0)
  for (const line of lines) {
    const start = Math.max(0, Math.floor(line.x * COLUMN_BINS))
    const end = Math.min(COLUMN_BINS, Math.ceil((line.x + line.width) * COLUMN_BINS))
    for (let bin = start; bin < end; bin++) bins[bin] = (bins[bin] ?? 0) + 1
  }
  return bins
}

/**
 * 页面中部（0.2–0.8）覆盖率中位数：作为「正常栏内密度」基准，
 * 用于要求谷底明显比两侧更空（防稀疏页误判）。
 */
function medianDensity(bins: readonly number[]): number {
  const from = Math.round(VALLEY_MIN_X * COLUMN_BINS)
  const to = Math.round(VALLEY_MAX_X * COLUMN_BINS)
  const slice = bins.slice(from, to).sort((a, b) => a - b)
  const mid = Math.floor(slice.length / 2)
  if (slice.length === 0) return 0
  const upper = slice[mid] ?? 0
  if (slice.length % 2 === 1) return upper
  return ((slice[mid - 1] ?? 0) + upper) / 2
}

/**
 * 页面中部最优覆盖率谷底（栏缝/书脊候选），无合格谷底 → null。
 *
 * 判据（2026-11-18 P4）：
 * - 谷底 = `[0.2, 0.8]` 内覆盖数 ≤ `max(1, ⌈行数×3%⌉)` 的连续桶（容忍页脚/页码跨缝）
 * - 宽度 ≥3% 页宽
 * - 谷底平均覆盖 ≤ 页面中部中位密度 × 0.5（稀疏页整体都只有 1 行覆盖时不判分栏）
 *
 * 排序：`score = 宽度 × (中位密度 − 谷底均值)` 降序（又宽又空优先）；同分比宽度，再比靠近页中。
 * 不能只按宽度：配对题内部留白常比真实书脊更宽，但覆盖更深，按宽度会裁掉整列内容（P4 样例 15）。
 */
function widestValley(lines: readonly OcrLine[]): { center: number; width: number } | null {
  const bins = coverageProfile(lines)
  const tolerance = Math.max(1, Math.ceil(lines.length * VALLEY_LINE_RATIO))
  const density = medianDensity(bins)
  let best: { center: number; width: number; score: number } | null = null
  let start = -1
  const consider = (from: number, to: number): void => {
    const width = (to - from) / COLUMN_BINS
    if (width < COLUMN_GAP_MIN) return
    const slice = bins.slice(from, to)
    const mean = slice.reduce((sum, value) => sum + value, 0) / slice.length
    if (mean > density * VALLEY_DENSITY_RATIO) return
    const center = (from + to) / 2 / COLUMN_BINS
    const score = width * (density - mean)
    const better =
      best === null ||
      score > best.score ||
      (score === best.score &&
        (width > best.width ||
          (width === best.width && Math.abs(center - 0.5) < Math.abs(best.center - 0.5))))
    if (better) best = { center, width, score }
  }
  for (let bin = 0; bin <= COLUMN_BINS; bin++) {
    const ratio = bin / COLUMN_BINS
    const low =
      bin < COLUMN_BINS &&
      (bins[bin] ?? 0) <= tolerance &&
      ratio >= VALLEY_MIN_X &&
      ratio <= VALLEY_MAX_X
    if (low) {
      if (start < 0) start = bin
      continue
    }
    if (start >= 0) {
      consider(start, bin)
      start = -1
    }
  }
  return best
}

/**
 * 页面级列边界检测（spec §10.4 P4 修订）：双栏页与整本摊开的跨页展开照共用同一通道。
 *
 * 候选 = 页面中部（0.2–0.8）按「宽度 × 深度」最优的覆盖率谷底（≥3% 页宽）；随后要求按谷底
 * 中点切分后左右两侧各含题号行 → 返回切分 x（0–1）；否则 null（单栏）。
 */
export function detectColumnSplit(lines: readonly OcrLine[]): number | null {
  if (lines.length < 2) return null

  const questionLines = pickQuestionLines(lines)
  if (questionLines.length < 2) return null

  const valley = widestValley(lines)
  if (valley === null) return null

  const splitX = valley.center
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
