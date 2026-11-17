import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { createCanvas } from '@napi-rs/canvas'
import type { TaskUpdate } from '@lumin/shared'
import { handleOcrTask } from './ocr.worker'
import { encodePng, ensureCjkFont } from './ocr-render'
import type { OcrWorkerRequest } from './ocr-ops'

const REAL_DIR = join(fileURLToPath(new URL('../../../../', import.meta.url)), 'binaries', 'ocr')
const HAS_MODELS = existsSync(join(REAL_DIR, 'det.onnx'))

let root = ''

function tempDir(): string {
  if (root === '') root = mkdtempSync(join(tmpdir(), 'lumin-exam-ocr-worker-'))
  return root
}

afterAll(() => {
  if (root !== '') rmSync(root, { recursive: true, force: true })
})

/** 合成白底黑块的图片文件（export 不需要模型） */
function makeImage(name = '卷.png', width = 200, height = 400): string {
  const data = new Uint8ClampedArray(width * height * 4).fill(255)
  // 画一个黑块，保证 PNG 内容非纯白（便于人工排查）
  for (let y = 20; y < 60; y++) {
    for (let x = 20; x < 120; x++) {
      const i = (y * width + x) * 4
      data[i] = 0
      data[i + 1] = 0
      data[i + 2] = 0
    }
  }
  const path = join(tempDir(), name)
  writeFileSync(path, encodePng({ data, width, height }))
  return path
}

/** 合成带中文题号的图片（真实模型 detect 用） */
function makeTextImage(name = '题号卷.png'): string {
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
  const path = join(tempDir(), name)
  writeFileSync(path, canvas.toBuffer('image/png'))
  return path
}

function ctxOf(): { updates: TaskUpdate[]; ctx: { emit: (update: TaskUpdate) => void } } {
  const updates: TaskUpdate[] = []
  return { updates, ctx: { emit: (update) => updates.push(update) } }
}

describe('handleOcrTask · export（不依赖模型）', () => {
  it('真实渲染 + 裁剪 + PNG 落盘，进度只走 write 阶段', async () => {
    const input = makeImage()
    const request: OcrWorkerRequest = {
      op: 'export',
      payload: {
        inputPath: input,
        startNumber: 1,
        exportPdf: false,
        pages: [
          {
            pageNumber: 1,
            width: 200,
            height: 400,
            regions: [{ start: 0, end: 0.5, lines: [] }]
          }
        ]
      }
    }
    const { updates, ctx } = ctxOf()
    const result = await handleOcrTask(request, ctx)
    expect(result).toEqual({ outputPaths: [join(tempDir(), '卷_题1.png')] })
    const bytes = readFileSync(join(tempDir(), '卷_题1.png'))
    expect(bytes.subarray(0, 4).toString('hex')).toBe('89504e47')
    expect(updates).toHaveLength(2)
    expect(updates[0]).toMatchObject({ kind: 'progress', stage: 'write', current: 0, total: 1 })
    expect(updates[1]).toMatchObject({ kind: 'progress', stage: 'write', current: 1, total: 1 })
  })
})

describe('handleOcrTask · detect（模型缺失/真实模型）', () => {
  it('模型目录为空 → MODEL_MISSING（结构化错误原样返回）', async () => {
    const input = makeImage()
    const empty = join(tempDir(), 'empty-binaries')
    mkdirSync(empty, { recursive: true })
    const request: OcrWorkerRequest = {
      op: 'detect',
      payload: { inputPath: input },
      binariesDir: empty
    }
    const { ctx } = ctxOf()
    await expect(handleOcrTask(request, ctx)).rejects.toMatchObject({ code: 'MODEL_MISSING' })
  })

  it.skipIf(!HAS_MODELS)(
    '真实模型：单页图片 → 至少一个题区',
    async () => {
      const input = makeTextImage()
      const request: OcrWorkerRequest = {
        op: 'detect',
        payload: { inputPath: input },
        binariesDir: REAL_DIR
      }
      const { updates, ctx } = ctxOf()
      const result = await handleOcrTask(request, ctx)
      expect(result).toMatchObject({ pages: [{ pageNumber: 1 }] })
      const pages = (result as { pages: { regions: unknown[] }[] }).pages
      expect(pages[0]?.regions.length).toBeGreaterThan(0)
      // 进度含 render/detect/cluster 三阶段
      const stages = new Set(updates.map((update) => (update as { stage?: string }).stage))
      expect(stages).toContain('render')
      expect(stages).toContain('detect')
    },
    60_000
  )
})
