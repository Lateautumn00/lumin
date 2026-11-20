/**
 * @file watermark.worker.test.ts 批量水印 worker 单测（真实 PNG/JPEG/WebP 编解码与落盘）
 * @author cuilanchao
 * @date 2026-11-20
 * @description 文字/图片水印像素校验、平铺、冲突递增、失败不中断、全失败抛出、目录创建
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { TaskRunContext } from '@lumin/node-kit'
import type { TaskUpdate } from '@lumin/shared'
import type { Watermark, WatermarkRequest } from './schema'
import { runWatermark } from './watermark.worker'

let root = ''

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'lumin-iw-worker-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

/** 生成纯色图片文件 */
async function writeImage(
  file: string,
  width: number,
  height: number,
  format: 'png' | 'jpeg' | 'webp',
  color = '#ffffff'
): Promise<void> {
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = color
  ctx.fillRect(0, 0, width, height)
  const bytes =
    format === 'png' ? canvas.toBuffer('image/png') : await canvas.encode(format, 90)
  await writeFile(file, bytes)
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

function textWatermark(overrides: Partial<Extract<Watermark, { type: 'text' }>> = {}): Watermark {
  return {
    type: 'text',
    text: '内部资料',
    color: '#ffffff',
    sizePct: 10,
    opacity: 100,
    rotation: 0,
    position: 'center',
    marginPct: 3,
    tile: false,
    ...overrides
  }
}

function request(overrides: Partial<WatermarkRequest> = {}): WatermarkRequest {
  return {
    inputPaths: [],
    watermark: textWatermark(),
    outputDir: join(root, 'out'),
    ...overrides
  }
}

describe('runWatermark 基础流程', () => {
  it('文字水印：输出落盘并逐张上报进度', async () => {
    const input = join(root, 'a.png')
    await writeImage(input, 400, 300, 'png')
    const { updates, ctx } = collect()
    const result = await runWatermark(request({ inputPaths: [input] }), ctx)
    expect(result.outputs).toEqual([join(root, 'out', 'a_水印.png')])
    expect(result.failures).toEqual([])
    expect(existsSync(result.outputs[0] ?? '')).toBe(true)
    expect(updates).toEqual([
      { kind: 'progress', current: 1, total: 1, stage: 'watermark', message: 'a.png' }
    ])
  })

  it('图片水印：中心像素被红色覆盖（九宫格 + 不透明）', async () => {
    const input = join(root, 'photo.png')
    const mark = join(root, 'red.png')
    await writeImage(input, 600, 400, 'png')
    await writeImage(mark, 60, 60, 'png', '#ff0000')
    const result = await runWatermark(
      request({
        inputPaths: [input],
        watermark: {
          type: 'image',
          watermarkPath: mark,
          sizePct: 20,
          opacity: 100,
          rotation: 0,
          position: 'center',
          marginPct: 0,
          tile: false
        }
      }),
      collect().ctx
    )
    const [r, g, b] = await pixelAt(result.outputs[0] ?? '', 300, 200)
    expect(r).toBeGreaterThan(200)
    expect(g).toBeLessThan(60)
    expect(b).toBeLessThan(60)
  })

  it('平铺：多处出现水印（非单点）', async () => {
    const input = join(root, 'tile.png')
    const mark = join(root, 'dot.png')
    await writeImage(input, 400, 400, 'png')
    await writeImage(mark, 20, 20, 'png', '#ff0000')
    const result = await runWatermark(
      request({
        inputPaths: [input],
        watermark: {
          type: 'image',
          watermarkPath: mark,
          sizePct: 10,
          opacity: 100,
          rotation: -30,
          position: 'bottom-right',
          marginPct: 3,
          tile: true
        }
      }),
      collect().ctx
    )
    const image = await loadImage(await readFile(result.outputs[0] ?? ''))
    const canvas = createCanvas(image.width, image.height)
    const ctx = canvas.getContext('2d')
    ctx.drawImage(image, 0, 0)
    const data = ctx.getImageData(0, 0, image.width, image.height).data
    let redPoints = 0
    for (let index = 0; index < data.length; index += 4) {
      if ((data[index] ?? 0) > 200 && (data[index + 1] ?? 255) < 80) redPoints += 1
    }
    expect(redPoints).toBeGreaterThan(20)
  })

  it('输出格式跟随原扩展名（png/jpeg/webp）', async () => {
    const files = [
      join(root, 'x.png'),
      join(root, 'x.jpg'),
      join(root, 'x.webp')
    ]
    await writeImage(files[0] ?? '', 120, 90, 'png')
    await writeImage(files[1] ?? '', 120, 90, 'jpeg')
    await writeImage(files[2] ?? '', 120, 90, 'webp')
    const result = await runWatermark(request({ inputPaths: files }), collect().ctx)
    expect(result.outputs).toEqual([
      join(root, 'out', 'x_水印.png'),
      join(root, 'out', 'x_水印.jpg'),
      join(root, 'out', 'x_水印.webp')
    ])
    for (const output of result.outputs) {
      await expect(loadImage(await readFile(output))).resolves.toBeTruthy()
    }
  })
})

describe('命名与失败容错', () => {
  it('目标已存在时冲突递增 (1)', async () => {
    const input = join(root, 'dup.png')
    await writeImage(input, 100, 100, 'png')
    await mkdir(join(root, 'out'), { recursive: true })
    await writeFile(join(root, 'out', 'dup_水印.png'), 'occupied')
    const result = await runWatermark(request({ inputPaths: [input] }), collect().ctx)
    expect(result.outputs).toEqual([join(root, 'out', 'dup_水印 (1).png')])
  })

  it('单张损坏不中断整批，失败项带结构化码', async () => {
    const good = join(root, 'good.png')
    const bad = join(root, 'bad.png')
    await writeImage(good, 80, 60, 'png')
    await writeFile(bad, 'not-an-image')
    const result = await runWatermark(request({ inputPaths: [bad, good] }), collect().ctx)
    expect(result.outputs).toEqual([join(root, 'out', 'good_水印.png')])
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0]).toMatchObject({ file: 'bad.png', code: 'IW_IMAGE_CORRUPT' })
  })

  it('白名单外扩展名 → IW_INPUT_INVALID（全部失败时抛出）', async () => {
    const input = join(root, 'anim.gif')
    await writeFile(input, 'gif')
    await expect(
      runWatermark(request({ inputPaths: [input] }), collect().ctx)
    ).rejects.toMatchObject({ code: 'IW_INPUT_INVALID' })
  })

  it('全部失败时抛出首个错误', async () => {
    const bad = join(root, 'broken.png')
    await writeFile(bad, 'x')
    await expect(
      runWatermark(request({ inputPaths: [bad] }), collect().ctx)
    ).rejects.toMatchObject({ code: 'IW_IMAGE_CORRUPT' })
  })

  it('输出目录不可建（同名文件占位）→ IW_WRITE_FAILED', async () => {
    const input = join(root, 'a.png')
    await writeImage(input, 80, 60, 'png')
    const blocked = join(root, 'blocked')
    await writeFile(blocked, 'file-not-dir')
    await expect(
      runWatermark(request({ inputPaths: [input], outputDir: blocked }), collect().ctx)
    ).rejects.toMatchObject({ code: 'IW_WRITE_FAILED' })
  })

  it('编码失败 → IW_PROCESS_FAILED（依赖注入）', async () => {
    const input = join(root, 'enc.png')
    await writeImage(input, 80, 60, 'png')
    const deps = {
      loadImage,
      encode: () => Promise.reject(new Error('encoder exploded'))
    }
    await expect(
      runWatermark(request({ inputPaths: [input] }), collect().ctx, deps)
    ).rejects.toMatchObject({ code: 'IW_PROCESS_FAILED', detail: 'encoder exploded' })
  })

  it('水印图片缺失 → IW_INPUT_INVALID（读图失败）', async () => {
    const input = join(root, 'a.png')
    await writeImage(input, 100, 100, 'png')
    await expect(
      runWatermark(
        request({
          inputPaths: [input],
          watermark: {
            type: 'image',
            watermarkPath: join(root, 'missing.png'),
            sizePct: 20,
            opacity: 50,
            rotation: 0,
            position: 'center',
            marginPct: 0,
            tile: false
          }
        }),
        collect().ctx
      )
    ).rejects.toMatchObject({ code: 'IW_INPUT_INVALID' })
  })
})
