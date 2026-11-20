/**
 * @file stitch.worker.test.ts 拼接 worker 单测（真实 PNG/JPEG 编解码与落盘）
 * @author cuilanchao
 * @date 2026-11-20
 * @description 纵向/网格像素校验、编码参数、冲突递增、体积上限、失败容错、进度阶段
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import type { Canvas, Image } from '@napi-rs/canvas'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { TaskRunContext } from '@lumin/node-kit'
import type { TaskUpdate } from '@lumin/shared'
import type { ImageEncoder, StitchRequest } from './schema'
import { runStitch, type StitchWorkerDeps } from './stitch.worker'

let root = ''
const FIXED_NOW = new Date(2026, 10, 20, 9, 5, 3)

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'lumin-is-worker-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

/** 生成纯色图片文件，返回路径 */
async function writeImage(
  name: string,
  width: number,
  height: number,
  color: string,
  format: 'png' | 'jpeg' = 'png'
): Promise<string> {
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = color
  ctx.fillRect(0, 0, width, height)
  const bytes = format === 'png' ? canvas.toBuffer('image/png') : await canvas.encode('jpeg', 95)
  const file = join(root, name)
  await writeFile(file, bytes)
  return file
}

/** 读取输出图片指定像素 RGBA */
async function pixelAt(file: string, x: number, y: number): Promise<number[]> {
  const image = await loadImage(await readFile(file))
  const canvas = createCanvas(image.width, image.height)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(image, 0, 0)
  return Array.from(ctx.getImageData(x, y, 1, 1).data)
}

function collect(): { updates: TaskUpdate[]; ctx: TaskRunContext } {
  const updates: TaskUpdate[] = []
  return { updates, ctx: { emit: (update) => updates.push(update) } }
}

function deps(overrides: Partial<StitchWorkerDeps> = {}): StitchWorkerDeps {
  return {
    loadImage: (source) => loadImage(source),
    encode: async (canvas: Canvas, encoder: ImageEncoder, quality: number) =>
      encoder === 'png' ? canvas.toBuffer('image/png') : canvas.encode(encoder, quality),
    now: () => FIXED_NOW,
    ...overrides
  }
}

function request(overrides: Partial<StitchRequest> = {}): StitchRequest {
  return {
    inputPaths: [],
    layout: {
      mode: 'vertical',
      sizeMode: 'first',
      fixedSize: 2000,
      columns: 2,
      gutter: 0,
      padding: 0
    },
    encoder: 'png',
    quality: 90,
    bgColor: '#ffffff',
    outputDir: join(root, 'out'),
    ...overrides
  }
}

describe('runStitch 布局出图', () => {
  it('纵向：统一宽度、自上而下拼接', async () => {
    const first = await writeImage('a.png', 40, 20, '#ff0000')
    const second = await writeImage('b.png', 20, 40, '#0000ff')
    const { ctx, updates } = collect()
    const result = await runStitch(
      request({ inputPaths: [first, second] }),
      ctx,
      deps()
    )
    expect(result).toMatchObject({ width: 40, height: 100, count: 2 })
    expect(basename(result.outputPath)).toBe('拼接_20261120-090503.png')
    expect(existsSync(result.outputPath)).toBe(true)
    expect((await pixelAt(result.outputPath, 20, 5)).slice(0, 3)).toEqual([255, 0, 0])
    expect((await pixelAt(result.outputPath, 20, 95)).slice(0, 3)).toEqual([0, 0, 255])
    expect(updates.map((update) => update.kind === 'progress' && update.stage)).toEqual([
      'measure',
      'measure',
      'draw',
      'draw'
    ])
  })

  it('网格：等宽单元格，超出部分填背景色', async () => {
    const first = await writeImage('a.png', 100, 50, '#ff0000')
    const second = await writeImage('b.png', 50, 100, '#00ff00')
    const third = await writeImage('c.png', 80, 80, '#0000ff')
    const { ctx } = collect()
    const result = await runStitch(
      request({ inputPaths: [first, second, third], layout: { ...request().layout, mode: 'grid', columns: 2 } }),
      ctx,
      deps()
    )
    expect(result).toMatchObject({ width: 100, height: 100 })
    // 单元格 50×50：首图 100×50 → 50×25，垂直居中（y=12），左上角保留背景白
    expect((await pixelAt(result.outputPath, 0, 0)).slice(0, 3)).toEqual([255, 255, 255])
    expect((await pixelAt(result.outputPath, 5, 20)).slice(0, 3)).toEqual([255, 0, 0])
  })

  it('JPG 编码透传质量并输出 .jpg', async () => {
    const first = await writeImage('a.png', 30, 30, '#123456')
    const seen: Array<{ encoder: ImageEncoder; quality: number }> = []
    const { ctx } = collect()
    const result = await runStitch(
      request({ inputPaths: [first], encoder: 'jpeg', quality: 75, bgColor: '#000000' }),
      ctx,
      deps({
        encode: async (canvas, encoder, quality) => {
          seen.push({ encoder, quality })
          return canvas.encode('jpeg', quality)
        }
      })
    )
    expect(seen).toEqual([{ encoder: 'jpeg', quality: 75 }])
    expect(result.outputPath.endsWith('.jpg')).toBe(true)
    expect(existsSync(result.outputPath)).toBe(true)
  })

  it('同名冲突递增 (1)，原文件不被覆盖', async () => {
    const input = await writeImage('a.png', 10, 10, '#ff0000')
    await mkdir(join(root, 'out'), { recursive: true })
    const existing = join(root, 'out', '拼接_20261120-090503.png')
    await writeFile(existing, 'keep')
    const { ctx } = collect()
    const result = await runStitch(request({ inputPaths: [input] }), ctx, deps())
    expect(basename(result.outputPath)).toBe('拼接_20261120-090503 (1).png')
    expect(await readFile(existing, 'utf8')).toBe('keep')
  })

  it('缺省依赖（真实解码/编码/当前时间）可出图', async () => {
    const input = await writeImage('real.png', 20, 10, '#00ff00')
    const { ctx } = collect()
    const result = await runStitch(request({ inputPaths: [input] }), ctx)
    expect(basename(result.outputPath)).toMatch(/^拼接_\d{8}-\d{6}\.png$/)
    expect(existsSync(result.outputPath)).toBe(true)
  })
})

describe('runStitch 异常', () => {
  it('缺失输入 → IS_INPUT_INVALID', async () => {
    const { ctx } = collect()
    await expect(
      runStitch(request({ inputPaths: [join(root, 'nope.png')] }), ctx, deps())
    ).rejects.toMatchObject({ code: 'IS_INPUT_INVALID' })
  })

  it('损坏图片 → IS_IMAGE_CORRUPT', async () => {
    const broken = join(root, 'broken.png')
    await writeFile(broken, 'not an image')
    const { ctx } = collect()
    await expect(runStitch(request({ inputPaths: [broken] }), ctx, deps())).rejects.toMatchObject({
      code: 'IS_IMAGE_CORRUPT'
    })
  })

  it('零尺寸图片 → IS_IMAGE_CORRUPT', async () => {
    const input = await writeImage('zero.png', 10, 10, '#ff0000')
    const fake = { width: 0, height: 0 } as unknown as Image
    const { ctx } = collect()
    await expect(
      runStitch(
        request({ inputPaths: [input] }),
        ctx,
        deps({ loadImage: () => Promise.resolve(fake) })
      )
    ).rejects.toMatchObject({ code: 'IS_IMAGE_CORRUPT' })
  })

  it('超出画布上限 → IS_OUTPUT_TOO_LARGE（不进入绘制）', async () => {
    const first = await writeImage('x1.png', 10, 10, '#ff0000')
    const second = await writeImage('x2.png', 10, 10, '#00ff00')
    const huge = { width: 20_000, height: 20_000 } as unknown as Image
    let drawCalls = 0
    const { ctx } = collect()
    await expect(
      runStitch(
        request({ inputPaths: [first, second] }),
        ctx,
        deps({
          loadImage: () => {
            drawCalls += 1
            return Promise.resolve(huge)
          }
        })
      )
    ).rejects.toMatchObject({ code: 'IS_OUTPUT_TOO_LARGE' })
    expect(drawCalls).toBe(2)
  })

  it('输出目录不可建 → IS_WRITE_FAILED', async () => {
    const blocker = join(root, 'blocker')
    await writeFile(blocker, 'file')
    const input = await writeImage('a.png', 10, 10, '#ff0000')
    const { ctx } = collect()
    await expect(
      runStitch(request({ inputPaths: [input], outputDir: join(blocker, 'sub') }), ctx, deps())
    ).rejects.toMatchObject({ code: 'IS_WRITE_FAILED' })
  })

  it('编码失败 → IS_PROCESS_FAILED', async () => {
    const input = await writeImage('a.png', 10, 10, '#ff0000')
    const { ctx } = collect()
    await expect(
      runStitch(
        request({ inputPaths: [input] }),
        ctx,
        deps({ encode: () => Promise.reject(new Error('encode boom')) })
      )
    ).rejects.toMatchObject({ code: 'IS_PROCESS_FAILED' })
  })
})
