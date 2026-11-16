/**
 * PP-OCR 后处理（spec §10.4）：det 概率图 → 行框（归一化 0–1），rec logits → 文本。
 * 全部纯函数，供单测覆盖（R1 ≥80%）。
 *
 * spike 实证（2026-11-16，plan §4.4）：
 * - det 输出 `[1,1,H,W]` 概率图，阈值 0.3 → 行投影 5/5 命中
 * - rec 输出 `[1,T,6625]`，CTC blank=0、字典索引 = 输出索引 − 1（6623 字符）
 */

/** det 二值化阈值（PP-OCRv4 DB 默认） */
export const DET_THRESH = 0.3

/** det 框分数阈值（框内概率均值下限） */
export const DET_BOX_THRESH = 0.6

/** det unclip 系数（框外扩，DB 默认） */
export const DET_UNCLIP_RATIO = 1.5

/** det 最小框边长（px，抑制噪声碎点） */
export const DET_MIN_SIZE = 4

/** CTC blank 索引（实测 rec 输出 0 为 blank） */
export const CTC_BLANK = 0

/** 检测出的行框（归一化 0–1，左上原点；x/width 与 y/height 同 M3a cropBox 口径） */
export interface TextBox {
  x: number
  y: number
  width: number
  height: number
  score: number
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

/**
 * det 概率图 → 归一化行框。
 *
 * 流程：阈值二值化 → 8 邻域连通域 → 每域取外接框 + 框内概率均值过滤 → unclip 外扩 → 归一化。
 * `mapWidth`/`mapHeight` 为概率图尺寸；`contentWidth`/`contentHeight` 为缩放后内容尺寸（归一化基准）。
 */
export function detBoxes(
  prob: Float32Array,
  mapWidth: number,
  mapHeight: number,
  contentWidth: number,
  contentHeight: number,
  options: {
    thresh?: number
    boxThresh?: number
    unclipRatio?: number
    minSize?: number
  } = {}
): TextBox[] {
  const thresh = options.thresh ?? DET_THRESH
  const boxThresh = options.boxThresh ?? DET_BOX_THRESH
  const unclipRatio = options.unclipRatio ?? DET_UNCLIP_RATIO
  const minSize = options.minSize ?? DET_MIN_SIZE

  const total = mapWidth * mapHeight
  if (prob.length < total || contentWidth <= 0 || contentHeight <= 0) return []

  const visited = new Uint8Array(total)
  const stack = new Int32Array(total)
  const boxes: TextBox[] = []

  for (let seed = 0; seed < total; seed++) {
    if (visited[seed] === 1 || (prob[seed] ?? 0) <= thresh) continue

    let top = 0
    stack[top++] = seed
    visited[seed] = 1
    let minX = seed % mapWidth
    let maxX = minX
    let minY = Math.floor(seed / mapWidth)
    let maxY = minY
    let sum = 0
    let count = 0

    while (top > 0) {
      const index = stack[--top] ?? 0
      sum += prob[index] ?? 0
      count += 1
      const x = index % mapWidth
      const y = Math.floor(index / mapWidth)
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y

      // 8 邻域扩展
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || nx >= mapWidth || ny < 0 || ny >= mapHeight) continue
          const neighbor = ny * mapWidth + nx
          if (visited[neighbor] === 1) continue
          if ((prob[neighbor] ?? 0) <= thresh) continue
          visited[neighbor] = 1
          stack[top++] = neighbor
        }
      }
    }

    const boxWidth = maxX - minX + 1
    const boxHeight = maxY - minY + 1
    if (boxWidth < minSize || boxHeight < minSize) continue
    const score = count === 0 ? 0 : sum / count
    if (score < boxThresh) continue

    // unclip：框外扩 distance = 面积 × ratio / 周长（DB 论文口径）
    const distance = (boxWidth * boxHeight * unclipRatio) / (2 * (boxWidth + boxHeight))
    const x0 = minX - distance
    const y0 = minY - distance
    const x1 = maxX + 1 + distance
    const y1 = maxY + 1 + distance

    const x = clamp01(x0 / contentWidth)
    const y = clamp01(y0 / contentHeight)
    const right = clamp01(x1 / contentWidth)
    const bottom = clamp01(y1 / contentHeight)
    if (right <= x || bottom <= y) continue

    boxes.push({ x, y, width: right - x, height: bottom - y, score })
  }

  return boxes
}

/** 解析 rec 字典（6623 字符，一行一字；空行忽略） */
export function parseDict(text: string): string[] {
  return text.split(/\r?\n/).filter((line) => line.length > 0)
}

/**
 * rec logits → 文本。
 *
 * `logits` 为 `[T, C]` 行主序（模型输出去掉 batch 维）；逐帧取 argmax → 合并连续重复 →
 * 去 blank(0) → 字典索引 `i - 1`（spike 实证：输出 0=blank，1..6623 = 字典 0..6622）。
 */
export function ctcDecode(
  logits: Float32Array,
  timeSteps: number,
  classes: number,
  dict: readonly string[]
): string {
  if (timeSteps <= 0 || classes <= 0) return ''
  let previous = -1
  const chars: string[] = []
  for (let t = 0; t < timeSteps; t++) {
    const base = t * classes
    let best = 0
    let bestValue = -Infinity
    for (let c = 0; c < classes; c++) {
      const value = logits[base + c] ?? -Infinity
      if (value > bestValue) {
        bestValue = value
        best = c
      }
    }
    if (best === CTC_BLANK) {
      previous = CTC_BLANK
      continue
    }
    if (best === previous) continue
    previous = best
    const char = dict[best - 1]
    if (char !== undefined) chars.push(char)
  }
  return chars.join('')
}
