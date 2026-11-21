/**
 * @file split.worker.test.ts 长图分割 worker 单测（真实 PNG/JPEG 编解码与落盘，M40）
 * @author cuilanchao
 * @date 2026-11-21
 * @description 固定高度/按份数切段尺寸与像素、补零命名、冲突递增、中文空格路径、
 *              扩展名沿用、异常映射与进度阶段
 */
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import type { Canvas, Image } from '@napi-rs/canvas'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { TaskRunContext } from '@lumin/node-kit'
import type { TaskUpdate } from '@lumin/shared'
import type { SplitRequest } from './schema'
import { inputEncodingOf, runSplit, type SplitWorkerDeps } from './split.worker'

let root = ''

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'lumin-is-split-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

/** 生成三色横条长图（0–1/3 红、1/3–2/3 绿、2/3–1 蓝） */
async function writeStrip(name: string, width: number, height: number): Promise<string> {
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')
  const third = Math.floor(height / 3)
  ctx.fillStyle = '#ff0000'
  ctx.fillRect(0, 0, width, third)
  ctx.fillStyle = '#00ff00'
  ctx.fillRect(0, third, width, third)
  ctx.fillStyle = '#0000ff'
  ctx.fillRect(0, third * 2, width, height - third * 2)
  const file = join(root, name)
  await writeFile(file, canvas.toBuffer('image/png'))
  return file
}

/** 读取输出图片尺寸与指定像素 RGB */
async function sample(file: string, y: number): Promise<{ width: number; height: number; rgb: number[] }> {
  const image = await loadImage(await readFile(file))
  const canvas = createCanvas(image.width, image.height)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(image, 0, 0)
  return {
    width: image.width,
    height: image.height,
    rgb: Array.from(ctx.getImageData(0, Math.min(y, image.height - 1), 1, 1).data).slice(0, 3)
  }
}

function collect(): { updates: TaskUpdate[]; ctx: TaskRunContext } {
  const updates: TaskUpdate[] = []
  return { updates, ctx: { emit: (update) => updates.push(update) } }
}

function deps(overrides: Partial<SplitWorkerDeps> = {}): SplitWorkerDeps {
  return {
    loadImage: (source) => loadImage(source),
    encode: async (canvas: Canvas, encoder: 'png' | 'jpeg' | 'webp', quality: number) =>
      encoder === 'png' ? canvas.toBuffer('image/png') : canvas.encode(encoder, quality),
    ...overrides
  }
}

function request(overrides: Partial<SplitRequest> = {}): SplitRequest {
  return {
    inputPath: '',
    mode: 'height',
    height: 300,
    parts: 3,
    quality: 90,
    outputDir: join(root, 'out'),
    ...overrides
  }
}

describe('inputEncodingOf', () => {
  it('沿用输入扩展名并映射编码器', () => {
    expect(inputEncodingOf('C:\\a\\x.PNG')).toEqual({ ext: 'png', encoder: 'png', lossless: true })
    expect(inputEncodingOf('C:\\a\\x.jpeg')).toEqual({
      ext: 'jpeg',
      encoder: 'jpeg',
      lossless: false
    })
    expect(inputEncodingOf('C:\\a\\x.webp')).toEqual({ ext: 'webp', encoder: 'webp', lossless: false })
    expect(inputEncodingOf('C:\\a\\x.jpg')).toEqual({ ext: 'jpg', encoder: 'jpeg', lossless: false })
    expect(inputEncodingOf('C:\\a\\noext')).toEqual({ ext: 'jpg', encoder: 'jpeg', lossless: false })
  })
})

describe('runSplit 固定高度', () => {
  it('900 高按 300 切 → 3 段等分且像素对应', async () => {
    const input = await writeStrip('long.png', 20, 900)
    const { ctx, updates } = collect()
    const result = await runSplit(request({ inputPath: input }), ctx, deps())
    expect(result.sourceWidth).toBe(20)
    expect(result.sourceHeight).toBe(900)
    expect(result.outputs).toHaveLength(3)
    expect(result.outputs.map((item) => basename(item.path))).toEqual([
      'long_part01.png',
      'long_part02.png',
      'long_part03.png'
    ])
    expect(result.outputs.map((item) => item.height)).toEqual([300, 300, 300])
    const first = await sample(result.outputs[0]?.path ?? '', 0)
    const last = await sample(result.outputs[2]?.path ?? '', 299)
    expect(first.rgb).toEqual([255, 0, 0])
    expect(last.rgb).toEqual([0, 0, 255])
    expect(updates.map((update) => update.kind === 'progress' && update.stage)).toEqual([
      'read',
      'split',
      'split',
      'split'
    ])
  })

  it('末段保留实际高度（1000 / 300 → 1000/300/300/100）', async () => {
    const input = await writeStrip('tail.png', 10, 1000)
    const { ctx } = collect()
    const result = await runSplit(request({ inputPath: input }), ctx, deps())
    expect(result.outputs.map((item) => item.height)).toEqual([300, 300, 300, 100])
  })
})

describe('runSplit 按份数', () => {
  it('余数摊到前几段（91 / 3 → 31/30/30）', async () => {
    const input = await writeStrip('odd.png', 8, 91)
    const { ctx } = collect()
    const result = await runSplit(
      request({ inputPath: input, mode: 'parts', parts: 3 }),
      ctx,
      deps()
    )
    expect(result.outputs.map((item) => item.height)).toEqual([31, 30, 30])
  })

  it('100 段 → 序号补零 3 位', async () => {
    const input = await writeStrip('many.png', 4, 100)
    const { ctx } = collect()
    const result = await runSplit(
      request({ inputPath: input, mode: 'parts', parts: 100 }),
      ctx,
      deps()
    )
    expect(result.outputs).toHaveLength(100)
    expect(basename(result.outputs[0]?.path ?? '')).toBe('many_part001.png')
    expect(basename(result.outputs[99]?.path ?? '')).toBe('many_part100.png')
  })
})

describe('runSplit 命名与路径', () => {
  it('中文+空格文件名、冲突递增 (1)', async () => {
    const input = await writeStrip('长 图.png', 6, 60)
    await mkdir(join(root, 'out'), { recursive: true })
    await writeFile(join(root, 'out', '长 图_part01.png'), 'keep')
    const { ctx } = collect()
    const result = await runSplit(
      request({ inputPath: input, mode: 'height', height: 30 }),
      ctx,
      deps()
    )
    expect(result.outputs.map((item) => basename(item.path))).toEqual([
      '长 图_part01 (1).png',
      '长 图_part02.png'
    ])
    expect(await readFile(join(root, 'out', '长 图_part01.png'), 'utf8')).toBe('keep')
  })

  it('jpeg 输入 → .jpeg 输出；webp 输入 → .webp 输出', async () => {
    const jpeg = join(root, 'photo.jpeg')
    const canvas = createCanvas(8, 40)
    canvas.getContext('2d').fillRect(0, 0, 8, 40)
    await writeFile(jpeg, await canvas.encode('jpeg', 90))
    const { ctx } = collect()
    const jpegResult = await runSplit(
      request({ inputPath: jpeg, mode: 'height', height: 20 }),
      ctx,
      deps()
    )
    expect(jpegResult.outputs.map((item) => basename(item.path))).toEqual([
      'photo_part01.jpeg',
      'photo_part02.jpeg'
    ])

    const webp = join(root, 'photo.webp')
    await writeFile(webp, await canvas.encode('webp', 90))
    const result = await runSplit(
      request({ inputPath: webp, mode: 'height', height: 20 }),
      ctx,
      deps()
    )
    expect(basename(result.outputs[0]?.path ?? '')).toBe('photo_part01.webp')
    expect(existsSync(result.outputs[0]?.path ?? '')).toBe(true)
  })
})

describe('runSplit 异常', () => {
  it('份数超图高 / 段数超 100 → IS_SPLIT_INVALID', async () => {
    const input = await writeStrip('small.png', 4, 50)
    const { ctx } = collect()
    await expect(
      runSplit(request({ inputPath: input, mode: 'parts', parts: 51 }), ctx, deps())
    ).rejects.toMatchObject({ code: 'IS_SPLIT_INVALID' })
    const tall = await writeStrip('tall.png', 4, 5000)
    await expect(
      runSplit(request({ inputPath: tall, mode: 'height', height: 40 }), ctx, deps())
    ).rejects.toMatchObject({ code: 'IS_SPLIT_INVALID' })
  })

  it('尺寸超 30000px → IS_SPLIT_INVALID', async () => {
    const input = await writeStrip('x.png', 4, 50)
    const huge = { width: 40_000, height: 40_000 } as unknown as Image
    const { ctx } = collect()
    await expect(
      runSplit(request({ inputPath: input }), ctx, deps({ loadImage: () => Promise.resolve(huge) }))
    ).rejects.toMatchObject({ code: 'IS_SPLIT_INVALID' })
  })

  it('缺失输入 → IS_INPUT_INVALID；损坏图片 → IS_IMAGE_CORRUPT', async () => {
    const { ctx } = collect()
    await expect(
      runSplit(request({ inputPath: join(root, 'nope.png') }), ctx, deps())
    ).rejects.toMatchObject({ code: 'IS_INPUT_INVALID' })
    const broken = join(root, 'broken.png')
    await writeFile(broken, 'not an image')
    await expect(
      runSplit(request({ inputPath: broken }), ctx, deps())
    ).rejects.toMatchObject({ code: 'IS_IMAGE_CORRUPT' })
  })

  it('零尺寸图片 → IS_IMAGE_CORRUPT', async () => {
    const input = await writeStrip('zero.png', 4, 40)
    const fake = { width: 0, height: 0 } as unknown as Image
    const { ctx } = collect()
    await expect(
      runSplit(request({ inputPath: input }), ctx, deps({ loadImage: () => Promise.resolve(fake) }))
    ).rejects.toMatchObject({ code: 'IS_IMAGE_CORRUPT' })
  })

  it('输出目录不可建 → IS_WRITE_FAILED', async () => {
    const blocker = join(root, 'blocker')
    await writeFile(blocker, 'file')
    const input = await writeStrip('a.png', 4, 40)
    const { ctx } = collect()
    await expect(
      runSplit(request({ inputPath: input, outputDir: join(blocker, 'sub') }), ctx, deps())
    ).rejects.toMatchObject({ code: 'IS_WRITE_FAILED' })
  })

  it('编码失败 → IS_PROCESS_FAILED', async () => {
    const input = await writeStrip('a.png', 4, 40)
    const { ctx } = collect()
    await expect(
      runSplit(
        request({ inputPath: input }),
        ctx,
        deps({ encode: () => Promise.reject(new Error('encode boom')) })
      )
    ).rejects.toMatchObject({ code: 'IS_PROCESS_FAILED' })
  })
})

describe('runSplit 默认依赖', () => {
  it('真实解码/编码可出图且无 .tmp 残留', async () => {
    const input = await writeStrip('real.png', 10, 60)
    const { ctx } = collect()
    const result = await runSplit(request({ inputPath: input, mode: 'height', height: 30 }), ctx)
    expect(result.outputs).toHaveLength(2)
    for (const item of result.outputs) expect(existsSync(item.path)).toBe(true)
    const names = await readdir(join(root, 'out'))
    expect(names.some((name) => name.endsWith('.tmp'))).toBe(false)
  })
})
