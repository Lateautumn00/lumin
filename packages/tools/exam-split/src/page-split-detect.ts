/**
 * @file 试卷页面切分检测（A3 横向双页）：纸张物理边界 + 中间分割线 + 旋转半页矩形。
 * @author cuilanchao
 * @date 2026-11-25
 * @description 纯像素分析，不依赖 OCR 模型：灰度 → Otsu 阈值 → 纸张亮区包围盒 →
 *              竖向墨迹投影 → 中央空白带（装订沟）检测；无有效沟时回退纸面几何中线。
 *              供 page-split-ops 与单测使用，所有函数无副作用。
 */
import type { RgbaImage } from '@lumin/ocr-kit'

/** 像素矩形（左上原点，单位 px） */
export interface PixelRect {
  x: number
  y: number
  width: number
  height: number
}

/** PDF 页面矩形（左下原点，单位 pt；MediaBox/CropBox 口径） */
export interface MediaRect {
  x: number
  y: number
  width: number
  height: number
}

/** PDF 页面固有旋转（顺时针） */
export type QuarterRotation = 0 | 90 | 180 | 270

/** 单页检测结果（splitRatio 为整页视觉宽度比例，0–1） */
export interface PageSplitDetection {
  /** 纸张物理边界（图片输入据此裁除扫描黑边；PDF 仅用于定位） */
  paper: PixelRect
  /** 分割线绝对像素 x（图片裁剪用） */
  splitX: number
  /** 分割线相对整页宽度的比例（PDF 半页矩形换算用） */
  splitRatio: number
  /** true = 命中装订沟；false = 回退纸面几何中线 */
  usedGutter: boolean
}

/** 采样步长（检测精度与耗时折中；800 万像素级页面约 4 倍提速） */
const SAMPLE_STRIDE = 2

/** 边带深色判定阈值（低于该亮度视为扫描黑边/深色背景） */
const DARK_BORDER = 140

/** 纸面判定：列/行亮像素覆盖率下限（容忍密集文字区） */
const MIN_BRIGHT_COVERAGE = 0.2

/** 纸面判定：包围盒面积/边长下限（低于则视为误检，回退整图） */
const MIN_PAPER_AREA_RATIO = 0.45
const MIN_PAPER_SIDE_RATIO = 0.4

/** 装订沟搜索区间（纸面宽度比例） */
const GUTTER_MIN_RATIO = 0.33
const GUTTER_MAX_RATIO = 0.67

/** 沟底判定：低于全页平均墨迹的该比例视为空白 */
const GUTTER_VALLEY_RATIO = 0.35

/** 沟最小宽度（纸面宽度比例） */
const GUTTER_MIN_WIDTH_RATIO = 0.008

/** 沟最大宽度（超过视为半页空白而非装订沟，仅作择优偏好） */
const GUTTER_MAX_WIDTH_RATIO = 0.15

/** 墨迹投影纵向裁边（忽略页边阴影/装订孔） */
const INK_VERTICAL_TRIM = 0.02

/** 横向双页判定：宽 ≥ 高 × 1.15（竖版 A3/A4 不适用垂直对半切） */
const SPREAD_ASPECT_RATIO = 1.15

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? 0
}

/** RGBA → 灰度（亮度加权，避免彩色扫描偏色影响墨迹判定） */
export function toGray(image: RgbaImage): Uint8Array {
  const { width, height, data } = image
  const gray = new Uint8Array(width * height)
  for (let index = 0, offset = 0; index < gray.length; index++, offset += 4) {
    const red = data[offset] ?? 255
    const green = data[offset + 1] ?? 255
    const blue = data[offset + 2] ?? 255
    gray[index] = (red * 299 + green * 587 + blue * 114) / 1000
  }
  return gray
}

/** Otsu 类间方差阈值（步进采样；纯色图无有效分割时返回 127） */
export function otsuThreshold(gray: Uint8Array, width: number, height: number): number {
  const histogram = new Array<number>(256).fill(0)
  let count = 0
  for (let y = 0; y < height; y += SAMPLE_STRIDE) {
    const row = y * width
    for (let x = 0; x < width; x += SAMPLE_STRIDE) {
      const value = gray[row + x] ?? 255
      histogram[value] = (histogram[value] ?? 0) + 1
      count += 1
    }
  }
  if (count === 0) return 127
  let sum = 0
  for (let value = 0; value < 256; value++) sum += value * (histogram[value] ?? 0)
  let sumBack = 0
  let weightBack = 0
  let best = 0
  let threshold = 127
  for (let value = 0; value < 256; value++) {
    const weight = histogram[value] ?? 0
    if (weight === 0) continue
    weightBack += weight
    const weightFore = count - weightBack
    if (weightFore === 0) break
    sumBack += value * weight
    const meanBack = sumBack / weightBack
    const meanFore = (sum - sumBack) / weightFore
    const between = weightBack * weightFore * (meanBack - meanFore) ** 2
    if (between > best) {
      best = between
      threshold = value
    }
  }
  return threshold
}

/** 四条边带（各 1% 厚度）的平均亮度中位数；用于判断是否存在深色扫描背景 */
function borderBrightness(gray: Uint8Array, width: number, height: number): number {
  const band = Math.max(1, Math.round(Math.min(width, height) * 0.01))
  const left: number[] = []
  const right: number[] = []
  const top: number[] = []
  const bottom: number[] = []
  for (let y = 0; y < height; y += SAMPLE_STRIDE) {
    const row = y * width
    for (let x = 0; x < band; x += SAMPLE_STRIDE) {
      left.push(gray[row + x] ?? 255)
      right.push(gray[row + width - 1 - x] ?? 255)
    }
  }
  for (let x = 0; x < width; x += SAMPLE_STRIDE) {
    for (let y = 0; y < band; y += SAMPLE_STRIDE) {
      top.push(gray[y * width + x] ?? 255)
      bottom.push(gray[(height - 1 - y) * width + x] ?? 255)
    }
  }
  return median([median(left), median(right), median(top), median(bottom)])
}

/** 亮区覆盖率投影：返回逐列/逐行的“亮像素占比” */
function brightCoverage(
  gray: Uint8Array,
  width: number,
  height: number,
  threshold: number
): { columns: Float32Array; rows: Float32Array } {
  const columns = new Float32Array(width)
  const rows = new Float32Array(height)
  for (let y = 0; y < height; y += SAMPLE_STRIDE) {
    const row = y * width
    for (let x = 0; x < width; x += SAMPLE_STRIDE) {
      // Otsu 阈值 t 属于背景类；> t 为亮区（纸张），≤ t 为墨迹
      if ((gray[row + x] ?? 255) > threshold) {
        columns[x] = (columns[x] ?? 0) + 1
        rows[y] = (rows[y] ?? 0) + 1
      }
    }
  }
  const columnSamples = Math.ceil(height / SAMPLE_STRIDE)
  const rowSamples = Math.ceil(width / SAMPLE_STRIDE)
  for (let x = 0; x < width; x++) columns[x] = (columns[x] ?? 0) / columnSamples
  for (let y = 0; y < height; y++) rows[y] = (rows[y] ?? 0) / rowSamples
  return { columns, rows }
}

/** 亮区区间 [start,end]；无满足覆盖率的行列时返回 null */
function spanOf(
  coverage: Float32Array,
  minCoverage: number
): { start: number; end: number } | null {
  let start = -1
  let end = -1
  for (let index = 0; index < coverage.length; index++) {
    if ((coverage[index] ?? 0) >= minCoverage) {
      if (start === -1) start = index
      end = index
    }
  }
  return start === -1 ? null : { start, end }
}

/**
 * 纸张物理边界：仅当存在深色边带（扫描仪黑边/深色背景）时裁边；
 * 白底扫描或 PDF 渲染页直接返回整图；包围盒异常时安全回退整图。
 */
export function detectPaperRect(
  gray: Uint8Array,
  width: number,
  height: number,
  threshold: number
): PixelRect {
  const full: PixelRect = { x: 0, y: 0, width, height }
  if (width < 2 || height < 2) return full
  if (borderBrightness(gray, width, height) >= DARK_BORDER) return full

  const { columns, rows } = brightCoverage(gray, width, height, threshold)
  const horizontal = spanOf(columns, MIN_BRIGHT_COVERAGE)
  const vertical = spanOf(rows, MIN_BRIGHT_COVERAGE)
  if (horizontal === null || vertical === null) return full

  const rect: PixelRect = {
    x: horizontal.start,
    y: vertical.start,
    width: horizontal.end - horizontal.start + 1,
    height: vertical.end - vertical.start + 1
  }
  const areaRatio = (rect.width * rect.height) / (width * height)
  const sideOk =
    rect.width >= width * MIN_PAPER_SIDE_RATIO && rect.height >= height * MIN_PAPER_SIDE_RATIO
  if (areaRatio < MIN_PAPER_AREA_RATIO || !sideOk) return full
  return rect
}

/** 纸面内逐列墨迹占比（灰度高 < threshold 视为墨迹；纵向裁掉页边 2%） */
export function buildInkProfile(
  gray: Uint8Array,
  width: number,
  paper: PixelRect,
  threshold: number
): Float32Array {
  const trim = Math.floor(paper.height * INK_VERTICAL_TRIM)
  const y0 = paper.y + trim
  const y1 = paper.y + paper.height - trim
  const profile = new Float32Array(paper.width)
  const rows = Math.max(1, Math.ceil((y1 - y0) / SAMPLE_STRIDE))
  for (let x = 0; x < paper.width; x++) {
    let ink = 0
    for (let y = y0; y < y1; y += SAMPLE_STRIDE) {
      if ((gray[y * width + paper.x + x] ?? 255) <= threshold) ink += 1
    }
    profile[x] = ink / rows
  }
  return profile
}

function smoothProfile(profile: Float32Array): Float32Array {
  const radius = Math.max(1, Math.round(profile.length * 0.0025))
  const smoothed = new Float32Array(profile.length)
  for (let index = 0; index < profile.length; index++) {
    const from = Math.max(0, index - radius)
    const to = Math.min(profile.length - 1, index + radius)
    let sum = 0
    for (let cursor = from; cursor <= to; cursor++) sum += profile[cursor] ?? 0
    smoothed[index] = sum / (to - from + 1)
  }
  return smoothed
}

/**
 * 装订沟检测：在纸面 33%–67% 区间找连续空白带。
 * 多条候选取「宽度合格且最靠近中线」的一条；无有效空白带 → 回退 0.5。
 */
export function findGutter(profile: Float32Array): { ratio: number; usedGutter: boolean } {
  const total = profile.length
  if (total < 8) return { ratio: 0.5, usedGutter: false }
  const smoothed = smoothProfile(profile)

  let sum = 0
  let samples = 0
  for (let index = Math.floor(total * 0.05); index < Math.ceil(total * 0.95); index++) {
    sum += smoothed[index] ?? 0
    samples += 1
  }
  const average = samples === 0 ? 0 : sum / samples
  if (average < 0.01) return { ratio: 0.5, usedGutter: false }

  const limit = Math.max(0.005, average * GUTTER_VALLEY_RATIO)
  const from = Math.floor(total * GUTTER_MIN_RATIO)
  const to = Math.ceil(total * GUTTER_MAX_RATIO)
  const minWidth = Math.max(3, Math.round(total * GUTTER_MIN_WIDTH_RATIO))
  const maxWidth = Math.max(minWidth, Math.round(total * GUTTER_MAX_WIDTH_RATIO))

  const runs: { start: number; end: number }[] = []
  let cursor = from
  while (cursor <= to) {
    if ((smoothed[cursor] ?? 0) > limit) {
      cursor += 1
      continue
    }
    const start = cursor
    while (cursor <= to && (smoothed[cursor] ?? 0) <= limit) cursor += 1
    if (cursor - start >= minWidth) runs.push({ start, end: cursor - 1 })
  }
  if (runs.length === 0) return { ratio: 0.5, usedGutter: false }

  const narrow = runs.filter((run) => run.end - run.start + 1 <= maxWidth)
  const candidates = narrow.length > 0 ? narrow : runs
  const [first] = candidates
  if (!first) return { ratio: 0.5, usedGutter: false }
  let best = first
  let bestDistance = Number.POSITIVE_INFINITY
  for (const run of candidates) {
    const center = (run.start + run.end + 1) / 2 / total
    const distance = Math.abs(center - 0.5)
    const wider = run.end - run.start > best.end - best.start
    if (distance < bestDistance || (distance === bestDistance && wider)) {
      best = run
      bestDistance = distance
    }
  }
  const ratio = clamp((best.start + best.end + 1) / 2 / total, GUTTER_MIN_RATIO, GUTTER_MAX_RATIO)
  return { ratio, usedGutter: true }
}

/** 单页检测入口：纸张边界 + 装订沟/中线（splitRatio 为整页视觉宽度比例） */
export function detectPageSplit(image: RgbaImage): PageSplitDetection {
  const { width, height } = image
  if (width < 2 || height < 2) {
    return {
      paper: { x: 0, y: 0, width, height },
      splitX: Math.max(0, Math.floor(width / 2)),
      splitRatio: 0.5,
      usedGutter: false
    }
  }
  const gray = toGray(image)
  const threshold = otsuThreshold(gray, width, height)
  const paper = detectPaperRect(gray, width, height, threshold)
  const profile = buildInkProfile(gray, width, paper, threshold)
  const gutter = findGutter(profile)
  const splitX = clamp(
    paper.x + Math.round(gutter.ratio * paper.width),
    paper.x + 1,
    paper.x + paper.width - 1
  )
  return { paper, splitX, splitRatio: splitX / width, usedGutter: gutter.usedGutter }
}

/** 横向双页判定（竖版 A3/A4 明确不支持垂直对半切） */
export function isSpreadPage(paper: { width: number; height: number }): boolean {
  return paper.width >= paper.height * SPREAD_ASPECT_RATIO
}

/** `/Rotate` 角度归一化为 0/90/180/270 */
export function normalizeRotation(angle: number): QuarterRotation {
  const normalized = (((Math.round(angle / 90) * 90) % 360) + 360) % 360
  return normalized === 90 || normalized === 180 || normalized === 270 ? normalized : 0
}

/**
 * PDF 视觉左/右半页矩形（左下原点，保留页面旋转属性）。
 * 视觉方向来自渲染位图（页面 /Rotate 已烘焙），故 90/270 时沿 y 轴切分。
 */
export function halfRects(
  media: MediaRect,
  rotation: QuarterRotation,
  splitRatio: number
): { left: MediaRect; right: MediaRect } {
  const ratio = clamp(splitRatio, 0.05, 0.95)
  const { x, y, width, height } = media
  switch (rotation) {
    case 90:
      // 顺时针 90°：视觉左半 = 页面下半（y ∈ [0, s·H]）
      return {
        left: { x, y, width, height: ratio * height },
        right: { x, y: y + ratio * height, width, height: (1 - ratio) * height }
      }
    case 180:
      // 180°：视觉左半 = 页面右半
      return {
        left: { x: x + (1 - ratio) * width, y, width: ratio * width, height },
        right: { x, y, width: (1 - ratio) * width, height }
      }
    case 270:
      // 顺时针 270°（逆时针 90°）：视觉左半 = 页面上半
      return {
        left: { x, y: y + (1 - ratio) * height, width, height: ratio * height },
        right: { x, y, width, height: (1 - ratio) * height }
      }
    default:
      return {
        left: { x, y, width: ratio * width, height },
        right: { x: x + ratio * width, y, width: (1 - ratio) * width, height }
      }
  }
}
