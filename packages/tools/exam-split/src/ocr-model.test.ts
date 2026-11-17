import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createCanvas } from '@napi-rs/canvas'
import { createOcrEngine, cropLines, decodeBatch, detOutputBoxes, stackRecBatch } from './ocr-model'
import { REC_HEIGHT, type DetTensor, type RecTensor, type RgbaImage } from './ocr-preproc'
import { ensureCjkFont } from './ocr-render'

const REAL_DIR = join(fileURLToPath(new URL('../../../../', import.meta.url)), 'binaries', 'ocr')
const HAS_MODELS = existsSync(join(REAL_DIR, 'det.onnx'))

function blank(width: number, height: number): RgbaImage {
  return {
    data: new Uint8ClampedArray(width * height * 4).fill(255),
    width,
    height
  }
}

function recTensor(width: number, fill: number): RecTensor {
  return { data: new Float32Array(3 * REC_HEIGHT * width).fill(fill), width, height: REC_HEIGHT }
}

describe('detOutputBoxes', () => {
  it('全零概率图 → 无行框（纯函数直通 detBoxes）', () => {
    const input: DetTensor = {
      data: new Float32Array(0),
      width: 64,
      height: 64,
      contentWidth: 60,
      contentHeight: 60
    }
    expect(detOutputBoxes(new Float32Array(8 * 8), 8, 8, input)).toEqual([])
  })
})

describe('cropLines', () => {
  it('归一化框 → 像素子图（右下夹取）', () => {
    const image = blank(100, 100)
    const crops = cropLines(image, [
      { x: 0.1, y: 0.1, width: 0.2, height: 0.2, score: 0.9 },
      { x: 0.9, y: 0.9, width: 0.5, height: 0.5, score: 0.9 }
    ])
    expect(crops[0]).toMatchObject({ width: 20, height: 20 })
    // 越界框夹到图内，至少 1px
    expect(crops[1]?.width).toBeGreaterThanOrEqual(1)
    expect(crops[1]?.height).toBeGreaterThanOrEqual(1)
  })
})

describe('stackRecBatch', () => {
  it('同宽张量按 NCHW 堆叠，token 0/1 各占独立 batch 段', () => {
    const width = 2
    const plane = REC_HEIGHT * width
    const out = stackRecBatch([recTensor(width, 0.5), recTensor(width, 0.25)], width)
    expect(out).toHaveLength(2 * 3 * plane)
    expect(out[0]).toBeCloseTo(0.5)
    expect(out[plane - 1]).toBeCloseTo(0.5)
    // batch 1 起点 = 3 * plane
    expect(out[3 * plane]).toBeCloseTo(0.25)
    expect(out[6 * plane - 1]).toBeCloseTo(0.25)
  })

  it('宽度不符的脏张量被跳过（不越界写入）', () => {
    const out = stackRecBatch([recTensor(3, 0.5)], 2)
    expect(out.every((value) => value === 0)).toBe(true)
  })
})

describe('decodeBatch', () => {
  it('CTC 去重 + 去 blank，按 batch 分段解码', () => {
    // C = 3（blank + 'a' + 'b'）
    const dict = ['a', 'b']
    const logits = new Float32Array([
      // batch 0：a a b → 'ab'
      0, 5, 0, 0, 5, 0, 0, 0, 5,
      // batch 1：blank b blank → 'b'
      5, 0, 0, 0, 0, 5, 5, 0, 0
    ])
    expect(decodeBatch(logits, 3, 3, 2, dict)).toEqual(['ab', 'b'])
  })
})

describe('createOcrEngine（spec §10.5 MODEL_MISSING）', () => {
  it('模型目录为空 → MODEL_MISSING', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lumin-exam-nomodel-'))
    try {
      await expect(createOcrEngine(dir)).rejects.toMatchObject({ code: 'MODEL_MISSING' })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it.skipIf(!HAS_MODELS)(
    '真实模型：合成中文题号图 → 完成 det+rec 流水线并返回合法行框',
    async () => {
      const engine = await createOcrEngine(REAL_DIR)
      ensureCjkFont()
      const width = 900
      const height = 300
      const canvas = createCanvas(width, height)
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, width, height)
      ctx.fillStyle = '#000000'
      ctx.font = '72px YaHei'
      ctx.fillText('1. 第一题', 60, 160)
      const rgba = ctx.getImageData(0, 0, width, height)
      const lines = await engine.detectLines({
        data: rgba.data,
        width,
        height
      })
      expect(Array.isArray(lines)).toBe(true)
      for (const line of lines) {
        expect(line.x).toBeGreaterThanOrEqual(0)
        expect(line.y).toBeGreaterThanOrEqual(0)
        expect(line.x + line.width).toBeLessThanOrEqual(1 + 1e-6)
        expect(line.y + line.height).toBeLessThanOrEqual(1 + 1e-6)
        expect(line.text.length).toBeGreaterThan(0)
      }
    },
    60_000
  )
})

describe('ensureCjkFont', () => {
  it('缺字体目录时不抛（非 Windows 环境容错）', () => {
    expect(() => ensureCjkFont()).not.toThrow()
  })
})
