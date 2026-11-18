/**
 * PP-OCR 推理引擎（spec §10.4/§10.8）：det 行检测 + rec 题号识别（前缀裁剪）。
 * 仅 worker 内执行（onnxruntime-node CPU EP，spawn per task，无跨任务缓存）。
 *
 * 引擎选型（2026-11-18 P4 R1 复评，plan §4.4/§1.1）：onnxruntime-web wasm 在真实样卷
 * （60–120 行文本）单页 3.3–4.7s，超 R1 ≤3s 基线；按 R1 规则切 onnxruntime-node 原生
 * CPU 推理。预调优沿用 spike 口径：det 长边 960 + 32 对齐、阈值 0.3；rec 前缀 3.5×行高、
 * 同宽分组 batch。输入名 `x`；det 输出 [1,1,H,W]、rec 输出 [1,T,6625]；CTC blank=0、
 * 字典索引 = 输出 −1。
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tail } from '@lumin/node-kit'
import { isStructuredError } from '@lumin/shared'
import { toolError } from './errors'
import { OCR_ASSETS } from './ocr-assets'
import { ctcDecode, detBoxes, parseDict, type TextBox } from './ocr-post'
import {
  REC_HEIGHT,
  cropRgbaRegion,
  prepDet,
  prepRecPrefix,
  type DetTensor,
  type RgbaImage,
  type RecTensor
} from './ocr-preproc'
import type { OcrLine } from './schema'

type OrtModule = typeof import('onnxruntime-node')

/** ort 模块单例（同一 worker 内 det/rec 共用；失败重置以便任务级重试） */
let ortPromise: Promise<OrtModule> | undefined

async function loadOrt(): Promise<OrtModule> {
  if (ortPromise === undefined) {
    ortPromise = import('onnxruntime-node').then((mod) => {
      // CJS 包经 ESM import 的 interop 兜底（与 web 版 node 条件构建同口径）
      const ort =
        'InferenceSession' in mod ? mod : (mod as unknown as { default: OrtModule }).default
      return ort
    })
    void ortPromise.catch(() => {
      ortPromise = undefined
    })
  }
  return ortPromise
}

/**
 * det 概率图 → 归一化行框。
 * 概率图尺寸与模型输入不一致时按比例修正归一化基准（内容基准 × map/输入）。
 */
export function detOutputBoxes(
  prob: Float32Array,
  mapWidth: number,
  mapHeight: number,
  input: DetTensor
): TextBox[] {
  const contentWidth = (input.contentWidth * mapWidth) / input.width
  const contentHeight = (input.contentHeight * mapHeight) / input.height
  return detBoxes(prob, mapWidth, mapHeight, contentWidth, contentHeight)
}

/** 行裁剪（归一化框 → 像素矩形 → RGBA 子图；越界由 cropRgbaRegion 夹取） */
export function cropLines(image: RgbaImage, boxes: readonly TextBox[]): RgbaImage[] {
  const out: RgbaImage[] = []
  for (const box of boxes) {
    out.push(
      cropRgbaRegion(image, {
        x: box.x * image.width,
        y: box.y * image.height,
        width: box.width * image.width,
        height: box.height * image.height
      })
    )
  }
  return out
}

/** 同宽 rec 张量 NCHW 堆叠 → `[B,3,48,W]`（分组内宽度一致，零 padding） */
export function stackRecBatch(tensors: readonly RecTensor[], width: number): Float32Array {
  const plane = REC_HEIGHT * width
  const out = new Float32Array(tensors.length * 3 * plane)
  for (let batch = 0; batch < tensors.length; batch++) {
    const tensor = tensors[batch]
    if (tensor === undefined || tensor.width !== width) continue
    for (let channel = 0; channel < 3; channel++) {
      const from = channel * plane
      out.set(tensor.data.subarray(from, from + plane), batch * 3 * plane + from)
    }
  }
  return out
}

/** rec 批量输出 `[B,T,C]` → 每行文本 */
export function decodeBatch(
  logits: Float32Array,
  timeSteps: number,
  classes: number,
  batch: number,
  dict: readonly string[]
): string[] {
  const out: string[] = []
  const size = timeSteps * classes
  for (let index = 0; index < batch; index++) {
    out.push(ctcDecode(logits.subarray(index * size, (index + 1) * size), timeSteps, classes, dict))
  }
  return out
}

export interface OcrEngine {
  /** 单页 RGBA → 识别文本行（归一化框；空文本行丢弃）；推理异常抛非结构化错误 */
  detectLines(image: RgbaImage): Promise<OcrLine[]>
}

/**
 * 创建推理引擎：det + rec session + 字典（cls 只校验不推理，spec §10.8）。
 * 加载失败（模型/native binding 缺失或损坏）→ `MODEL_MISSING`（spec §10.5）；
 * 推理期异常由编排层包 `OCR_FAILED`。
 */
export async function createOcrEngine(ocrDir: string): Promise<OcrEngine> {
  try {
    const ort = await loadOrt()
    const options = { executionProviders: ['cpu'] as const }
    const det = await ort.InferenceSession.create(join(ocrDir, OCR_ASSETS.det.file), options)
    const rec = await ort.InferenceSession.create(join(ocrDir, OCR_ASSETS.rec.file), options)
    const dict = parseDict(await readFile(join(ocrDir, OCR_ASSETS.dict.file), 'utf8'))

    async function detectLines(image: RgbaImage): Promise<OcrLine[]> {
      const detInput = prepDet(image)
      const detOut = await det.run({
        x: new ort.Tensor('float32', detInput.data, [1, 3, detInput.height, detInput.width])
      })
      const detName = det.outputNames[0]
      if (detName === undefined) throw new Error('det 模型无输出名')
      const detTensor = detOut[detName]
      const prob = detTensor?.data
      const dims = detTensor?.dims
      if (!(prob instanceof Float32Array) || dims === undefined || dims.length !== 4) {
        throw new Error('det 输出形状异常')
      }
      const mapHeight = dims[2]
      const mapWidth = dims[3]
      if (mapHeight === undefined || mapWidth === undefined) {
        throw new Error('det 输出尺寸缺失')
      }
      const boxes = detOutputBoxes(prob, mapWidth, mapHeight, detInput)

      // 逐行裁前缀 → 按宽度分组 batch（同宽同形零 padding，spike 口径）
      const crops = cropLines(image, boxes)
      const groups = new Map<number, { tensors: RecTensor[]; boxes: TextBox[] }>()
      for (let index = 0; index < crops.length; index++) {
        const crop = crops[index]
        const box = boxes[index]
        if (crop === undefined || box === undefined) continue
        const prep = prepRecPrefix(crop)
        const group = groups.get(prep.width)
        if (group === undefined) {
          groups.set(prep.width, { tensors: [prep], boxes: [box] })
        } else {
          group.tensors.push(prep)
          group.boxes.push(box)
        }
      }

      const lines: OcrLine[] = []
      for (const [width, group] of groups) {
        const batch = group.tensors.length
        const recOut = await rec.run({
          x: new ort.Tensor('float32', stackRecBatch(group.tensors, width), [
            batch,
            3,
            REC_HEIGHT,
            width
          ])
        })
        const recName = rec.outputNames[0]
        if (recName === undefined) throw new Error('rec 模型无输出名')
        const recTensor = recOut[recName]
        const logits = recTensor?.data
        const recDims = recTensor?.dims
        if (!(logits instanceof Float32Array) || recDims === undefined || recDims.length !== 3) {
          throw new Error('rec 输出形状异常')
        }
        const timeSteps = recDims[1]
        const classes = recDims[2]
        if (timeSteps === undefined || classes === undefined || recDims[0] !== batch) {
          throw new Error('rec 输出尺寸与批量不符')
        }
        const texts = decodeBatch(logits, timeSteps, classes, batch, dict)
        for (let index = 0; index < texts.length; index++) {
          const text = texts[index]
          const box = group.boxes[index]
          if (text === undefined || text === '' || box === undefined) continue
          lines.push({ text, x: box.x, y: box.y, width: box.width, height: box.height })
        }
      }
      return lines
    }

    return { detectLines }
  } catch (err) {
    if (isStructuredError(err)) throw err
    throw toolError('MODEL_MISSING', tail(err instanceof Error ? err.message : String(err)))
  }
}
