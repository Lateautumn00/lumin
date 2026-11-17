/**
 * PP-OCR 预处理（spec §10.4/§10.8）。
 * 全部为纯函数：输入 RGBA 位图 → 输出 NCHW Float32 张量，便于单测覆盖（R1 ≥80%）。
 *
 * spike 实证（2026-11-16，见 plan §4.4）：
 * - det 960 长边 + 32 对齐 → 5/5 行命中，609ms/页
 * - rec 只裁行前缀 3.5×行高 → 38ms/行（全宽 77ms），40 行 1.5s，12 种题号样式全识别
 */

/** det 输入长边上限（PP-OCRv4 mobile 默认口径） */
export const DET_LIMIT_SIDE = 960

/** det 输入宽高对齐粒度（32） */
export const DET_MULTIPLE = 32

/** rec 输入固定高度（PP-OCR 口径） */
export const REC_HEIGHT = 48

/** rec 输入宽度上限 */
export const REC_MAX_WIDTH = 320

/**
 * rec 前缀裁剪比例（相对行高）。题号识别只需行首，裁到 3.5×行高即可覆盖
 * `第1题`/`一、` 等最长内置题号样式，同时把单行成本从 77ms 降到 38ms（spec §10.8 ≤3s）。
 */
export const REC_PREFIX_RATIO = 3.5

const DET_MEAN = [0.485, 0.456, 0.406] as const
const DET_STD = [0.229, 0.224, 0.225] as const
const REC_MEAN = [0.5, 0.5, 0.5] as const
const REC_STD = [0.5, 0.5, 0.5] as const

/** RGBA 位图（渲染端 canvas 或 worker 解码产物） */
export interface RgbaImage {
  data: Uint8ClampedArray
  width: number
  height: number
}

/** det 张量与坐标换算基准 */
export interface DetTensor {
  data: Float32Array
  /** 模型输入尺寸（含 32 对齐 padding） */
  width: number
  height: number
  /** 内容尺寸（不含 padding；检测框归一化除以它） */
  contentWidth: number
  contentHeight: number
}

/** rec 张量（前缀裁剪后） */
export interface RecTensor {
  data: Float32Array
  width: number
  height: number
}

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * det 模型输入尺寸：长边缩到 `limit`，内容区对齐到 `multiple` 倍数（右/下补 0，不破坏比例）。
 * 纯函数，供单测锁定 960/32 口径。
 */
export function detInputSize(
  width: number,
  height: number,
  limit = DET_LIMIT_SIDE,
  multiple = DET_MULTIPLE
): { width: number; height: number; contentWidth: number; contentHeight: number } {
  const longest = Math.max(width, height)
  const scale = longest > limit ? limit / longest : 1
  const contentWidth = Math.max(1, Math.round(width * scale))
  const contentHeight = Math.max(1, Math.round(height * scale))
  return {
    width: Math.ceil(contentWidth / multiple) * multiple,
    height: Math.ceil(contentHeight / multiple) * multiple,
    contentWidth,
    contentHeight
  }
}

/** 双线性缩放 RGBA 位图（PaddleOCR 口径 = cv2.resize 双线性） */
export function resizeRgba(image: RgbaImage, dstWidth: number, dstHeight: number): RgbaImage {
  const src = image.data
  const srcWidth = image.width
  const srcHeight = image.height
  const out = new Uint8ClampedArray(dstWidth * dstHeight * 4)
  const ratioX = srcWidth / dstWidth
  const ratioY = srcHeight / dstHeight

  for (let y = 0; y < dstHeight; y++) {
    const sy = (y + 0.5) * ratioY - 0.5
    const y0 = Math.floor(sy)
    const fy = clampInt(sy - y0, 0, 1)
    const ay = clampInt(y0, 0, srcHeight - 1)
    const by = clampInt(y0 + 1, 0, srcHeight - 1)

    for (let x = 0; x < dstWidth; x++) {
      const sx = (x + 0.5) * ratioX - 0.5
      const x0 = Math.floor(sx)
      const fx = clampInt(sx - x0, 0, 1)
      const ax = clampInt(x0, 0, srcWidth - 1)
      const bx = clampInt(x0 + 1, 0, srcWidth - 1)

      const ia = (ay * srcWidth + ax) * 4
      const ib = (ay * srcWidth + bx) * 4
      const ic = (by * srcWidth + ax) * 4
      const id = (by * srcWidth + bx) * 4
      const di = (y * dstWidth + x) * 4

      for (let c = 0; c < 4; c++) {
        const top = (src[ia + c] ?? 0) * (1 - fx) + (src[ib + c] ?? 0) * fx
        const bottom = (src[ic + c] ?? 0) * (1 - fx) + (src[id + c] ?? 0) * fx
        out[di + c] = Math.round(top * (1 - fy) + bottom * fy)
      }
    }
  }
  return { data: out, width: dstWidth, height: dstHeight }
}

/** RGBA → NCHW Float32 归一化（`(v/255 - mean) / std`，R→C0、G→C1、B→C2） */
export function normalizeRgba(
  image: RgbaImage,
  mean: readonly number[],
  std: readonly number[]
): Float32Array {
  const { data, width, height } = image
  const plane = width * height
  const out = new Float32Array(3 * plane)
  for (let i = 0; i < plane; i++) {
    const si = i * 4
    out[i] = ((data[si] ?? 0) / 255 - (mean[0] ?? 0)) / (std[0] ?? 1)
    out[plane + i] = ((data[si + 1] ?? 0) / 255 - (mean[1] ?? 0)) / (std[1] ?? 1)
    out[2 * plane + i] = ((data[si + 2] ?? 0) / 255 - (mean[2] ?? 0)) / (std[2] ?? 1)
  }
  return out
}

/** det 预处理：缩放 → 归一化 → 右/下 0 填充到 32 对齐尺寸 */
export function prepDet(image: RgbaImage): DetTensor {
  const size = detInputSize(image.width, image.height)
  const content = resizeRgba(image, size.contentWidth, size.contentHeight)
  const normalized = normalizeRgba(content, DET_MEAN, DET_STD)
  const plane = size.width * size.height
  const contentPlane = size.contentWidth * size.contentHeight
  const out = new Float32Array(3 * plane)
  for (let c = 0; c < 3; c++) {
    for (let y = 0; y < size.contentHeight; y++) {
      const srcFrom = c * contentPlane + y * size.contentWidth
      const dstFrom = c * plane + y * size.width
      out.set(normalized.subarray(srcFrom, srcFrom + size.contentWidth), dstFrom)
    }
  }
  return {
    data: out,
    width: size.width,
    height: size.height,
    contentWidth: size.contentWidth,
    contentHeight: size.contentHeight
  }
}

/**
 * rec 前缀预处理：裁左侧 `REC_PREFIX_RATIO × 行高` → 双线性缩到 48 高（宽比保持，上限 320）→ 归一化。
 * 返回前缀在原图中的像素宽，供后续按需裁剪。
 */
export function prepRecPrefix(
  image: RgbaImage,
  prefixRatio = REC_PREFIX_RATIO
): RecTensor & { prefixWidth: number } {
  const prefixWidth = clampInt(Math.round(prefixRatio * image.height), 1, image.width)
  const cropped = cropRgbaLeft(image, prefixWidth)
  const ratio = prefixWidth / image.height
  const dstWidth = clampInt(Math.round(REC_HEIGHT * ratio), 8, REC_MAX_WIDTH)
  const resized = resizeRgba(cropped, dstWidth, REC_HEIGHT)
  return {
    data: normalizeRgba(resized, REC_MEAN, REC_STD),
    width: dstWidth,
    height: REC_HEIGHT,
    prefixWidth
  }
}

/** 按行拷贝左侧 `width` 列（RGBA 行跨距 = 源宽，不能连续切片） */
export function cropRgbaLeft(image: RgbaImage, width: number): RgbaImage {
  const keep = clampInt(width, 1, image.width)
  if (keep === image.width) return image
  const out = new Uint8ClampedArray(keep * image.height * 4)
  for (let y = 0; y < image.height; y++) {
    const from = y * image.width * 4
    out.set(image.data.subarray(from, from + keep * 4), y * keep * 4)
  }
  return { data: out, width: keep, height: image.height }
}

/**
 * 按像素矩形裁剪（导出每题 PNG 用；spec §10.7）。
 * 矩形先夹到图内，宽高至少 1px；坐标为整数像素（调用方由归一化边界换算）。
 */
export function cropRgbaRegion(
  image: RgbaImage,
  rect: { x: number; y: number; width: number; height: number }
): RgbaImage {
  const x0 = clampInt(Math.floor(rect.x), 0, image.width - 1)
  const y0 = clampInt(Math.floor(rect.y), 0, image.height - 1)
  const x1 = clampInt(Math.ceil(rect.x + rect.width), x0 + 1, image.width)
  const y1 = clampInt(Math.ceil(rect.y + rect.height), y0 + 1, image.height)
  const keepWidth = x1 - x0
  const keepHeight = y1 - y0
  const out = new Uint8ClampedArray(keepWidth * keepHeight * 4)
  for (let y = 0; y < keepHeight; y++) {
    const from = ((y0 + y) * image.width + x0) * 4
    out.set(image.data.subarray(from, from + keepWidth * 4), y * keepWidth * 4)
  }
  return { data: out, width: keepWidth, height: keepHeight }
}
