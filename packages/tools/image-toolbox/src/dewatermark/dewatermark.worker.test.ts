/**
 * @file dewatermark.worker.test.ts worker 主流程单测（真实 @napi-rs/canvas，临时目录）
 * @author cuilanchao
 * @date 2026-11-24
 * @description 三模式出图、原图不变、同名递增、超限降级、错误码映射与临时文件原子写
 */
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import type { Canvas, Image } from '@napi-rs/canvas'
import type { TaskRunContext } from '@lumin/node-kit'
import { inpaintRegion, runDewatermark, type DewatermarkWorkerDeps } from './dewatermark.worker'
import type { DewatermarkRequest, Encoder } from './schema'

const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'lumin-idw-worker-'))
  roots.push(root)
  return root
}

/** 真实解码/编码依赖 */
const realDeps: DewatermarkWorkerDeps = {
  loadImage: (source: Buffer) => loadImage(source),
  encode: async (canvas: Canvas, encoder: Encoder) =>
    encoder === 'png' ? canvas.toBuffer('image/png') : canvas.encode(encoder, 90)
}

/** 白底 + 居中红块（模拟水印） */
async function makeSource(path: string, size = 60): Promise<void> {
  const canvas = createCanvas(size, size)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, size, size)
  ctx.fillStyle = '#ff0000'
  ctx.fillRect(size / 3, size / 3, size / 3, size / 3)
  await writeFile(path, canvas.toBuffer('image/png'))
}

function makeCtx(): { ctx: TaskRunContext; updates: unknown[] } {
  const updates: unknown[] = []
  return {
    ctx: { emit: (update: unknown) => updates.push(update) } as unknown as TaskRunContext,
    updates
  }
}

function request(overrides: Partial<DewatermarkRequest>): DewatermarkRequest {
  return {
    inputPath: '',
    outputDir: '',
    regions: [{ x: 20, y: 20, width: 20, height: 20 }],
    mode: 'inpaint',
    blurRadius: 4,
    ...overrides
  }
}

/** 读取产物指定像素 */
async function readPixel(path: string, x: number, y: number): Promise<number[]> {
  const image = await loadImage(await readFile(path))
  const canvas = createCanvas(image.width, image.height)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(image, 0, 0)
  const data = ctx.getImageData(x, y, 1, 1).data
  return [data[0] ?? 0, data[1] ?? 0, data[2] ?? 0, data[3] ?? 0]
}

function sha(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex')
}

describe('runDewatermark 三模式', () => {
  it('快速修复去除红块且不改原图，进度上报', async () => {
    const root = await makeRoot()
    const input = join(root, 'sample.png')
    await makeSource(input)
    const before = sha(await readFile(input))
    const { ctx, updates } = makeCtx()
    const result = await runDewatermark(
      request({ inputPath: input, outputDir: join(root, 'out') }),
      ctx,
      realDeps
    )
    expect(result.output).toContain('_去水印')
    expect(result.warnings).toEqual([])
    expect(updates.length).toBeGreaterThan(0)
    expect(sha(await readFile(input))).toBe(before)
    const [r, g, b] = await readPixel(result.output, 30, 30)
    expect(r).toBeGreaterThan(200)
    expect(g).toBeGreaterThan(200)
    expect(b).toBeGreaterThan(200)
  })

  it('同名输出 (n) 递增', async () => {
    const root = await makeRoot()
    const input = join(root, 'sample.png')
    await makeSource(input)
    const first = await runDewatermark(
      request({ inputPath: input, outputDir: root }),
      makeCtx().ctx,
      realDeps
    )
    const second = await runDewatermark(
      request({ inputPath: input, outputDir: root }),
      makeCtx().ctx,
      realDeps
    )
    expect(first.output).not.toBe(second.output)
    expect(sha(await readFile(first.output))).toBeTruthy()
  })

  it('纯色模式用边缘均值填充', async () => {
    const root = await makeRoot()
    const input = join(root, 'sample.png')
    await makeSource(input)
    const result = await runDewatermark(
      request({ inputPath: input, outputDir: root, mode: 'solid' }),
      makeCtx().ctx,
      realDeps
    )
    const [r, g, b] = await readPixel(result.output, 30, 30)
    expect(r).toBeGreaterThan(200)
    expect(g).toBeGreaterThan(200)
    expect(b).toBeGreaterThan(200)
  })

  it('模糊模式在区域边缘混入周边颜色', async () => {
    const root = await makeRoot()
    const input = join(root, 'sample.png')
    await makeSource(input)
    const result = await runDewatermark(
      request({ inputPath: input, outputDir: root, mode: 'blur', blurRadius: 12 }),
      makeCtx().ctx,
      realDeps
    )
    const [edgeR, edgeG] = await readPixel(result.output, 20, 30)
    expect(edgeR).toBeGreaterThan(200)
    expect(edgeG).toBeGreaterThan(0)
  })

  it('超大区域快速修复降级为模糊并提示', async () => {
    const root = await makeRoot()
    const input = join(root, 'large.png')
    const canvas = createCanvas(1500, 1500)
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, 1500, 1500)
    ctx.fillStyle = '#ff0000'
    ctx.fillRect(700, 700, 100, 100)
    await writeFile(input, canvas.toBuffer('image/png'))
    const result = await runDewatermark(
      request({
        inputPath: input,
        outputDir: root,
        regions: [{ x: 10, y: 10, width: 1450, height: 1450 }],
        blurRadius: 4
      }),
      makeCtx().ctx,
      realDeps
    )
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain('模糊')
  })

  it('不注入依赖时默认解码/编码 PNG 与 JPEG', async () => {
    const root = await makeRoot()
    const png = join(root, 'default.png')
    await makeSource(png)
    const pngResult = await runDewatermark(
      request({ inputPath: png, outputDir: root }),
      makeCtx().ctx
    )
    expect(pngResult.output.endsWith('.png')).toBe(true)

    const jpg = join(root, 'default.jpg')
    const surface = createCanvas(60, 60)
    const surfaceCtx = surface.getContext('2d')
    surfaceCtx.fillStyle = '#ffffff'
    surfaceCtx.fillRect(0, 0, 60, 60)
    await writeFile(jpg, await surface.encode('jpeg', 90))
    const jpgResult = await runDewatermark(
      request({ inputPath: jpg, outputDir: root }),
      makeCtx().ctx
    )
    expect(jpgResult.output.endsWith('.jpg')).toBe(true)
  })
})

describe('runDewatermark 错误码', () => {
  it('扩展名不支持/文件不存在 → IDW_INPUT_INVALID', async () => {
    const root = await makeRoot()
    await expect(
      runDewatermark(
        request({ inputPath: join(root, 'a.gif'), outputDir: root }),
        makeCtx().ctx,
        realDeps
      )
    ).rejects.toMatchObject({ code: 'IDW_INPUT_INVALID' })
    await expect(
      runDewatermark(
        request({ inputPath: join(root, 'missing.png'), outputDir: root }),
        makeCtx().ctx,
        realDeps
      )
    ).rejects.toMatchObject({ code: 'IDW_INPUT_INVALID' })
  })

  it('损坏图片 → IDW_IMAGE_CORRUPT', async () => {
    const root = await makeRoot()
    const input = join(root, 'broken.png')
    await writeFile(input, 'not an image')
    await expect(
      runDewatermark(request({ inputPath: input, outputDir: root }), makeCtx().ctx, realDeps)
    ).rejects.toMatchObject({ code: 'IDW_IMAGE_CORRUPT' })
  })

  it('解码抛无 errno 错误 → IDW_IMAGE_CORRUPT 带文本详情', async () => {
    const root = await makeRoot()
    const input = join(root, 'sample.png')
    await makeSource(input)
    const decoder: DewatermarkWorkerDeps = {
      ...realDeps,
      loadImage: () => Promise.reject(new Error('decoder boom'))
    }
    await expect(
      runDewatermark(request({ inputPath: input, outputDir: root }), makeCtx().ctx, decoder)
    ).rejects.toMatchObject({ code: 'IDW_IMAGE_CORRUPT', detail: 'Error: decoder boom' })
  })

  it('尺寸超限 → IDW_IMAGE_TOO_LARGE；零尺寸 → IDW_IMAGE_CORRUPT', async () => {
    const root = await makeRoot()
    const input = join(root, 'sample.png')
    await makeSource(input)
    const tooLarge: DewatermarkWorkerDeps = {
      ...realDeps,
      loadImage: () => Promise.resolve({ width: 10001, height: 10 } as unknown as Image)
    }
    await expect(
      runDewatermark(request({ inputPath: input, outputDir: root }), makeCtx().ctx, tooLarge)
    ).rejects.toMatchObject({ code: 'IDW_IMAGE_TOO_LARGE' })
    const zero: DewatermarkWorkerDeps = {
      ...realDeps,
      loadImage: () => Promise.resolve({ width: 0, height: 0 } as unknown as Image)
    }
    await expect(
      runDewatermark(request({ inputPath: input, outputDir: root }), makeCtx().ctx, zero)
    ).rejects.toMatchObject({ code: 'IDW_IMAGE_CORRUPT' })
  })

  it('无有效区域 → IDW_NO_REGIONS', async () => {
    const root = await makeRoot()
    const input = join(root, 'sample.png')
    await makeSource(input)
    await expect(
      runDewatermark(
        request({ inputPath: input, outputDir: root, regions: [] }),
        makeCtx().ctx,
        realDeps
      )
    ).rejects.toMatchObject({ code: 'IDW_NO_REGIONS' })
    await expect(
      runDewatermark(
        request({
          inputPath: input,
          outputDir: root,
          regions: [{ x: 500, y: 500, width: 20, height: 20 }]
        }),
        makeCtx().ctx,
        realDeps
      )
    ).rejects.toMatchObject({ code: 'IDW_NO_REGIONS' })
  })

  it('输出目录不可用 → IDW_WRITE_FAILED', async () => {
    const root = await makeRoot()
    const input = join(root, 'sample.png')
    await makeSource(input)
    const blocked = join(root, 'blocked')
    await writeFile(blocked, 'file')
    await expect(
      runDewatermark(request({ inputPath: input, outputDir: blocked }), makeCtx().ctx, realDeps)
    ).rejects.toMatchObject({ code: 'IDW_WRITE_FAILED' })
  })

  it('编码后输出目录被移除 → IDW_WRITE_FAILED', async () => {
    const root = await makeRoot()
    const input = join(root, 'sample.png')
    await makeSource(input)
    const outDir = join(root, 'out')
    const removing: DewatermarkWorkerDeps = {
      ...realDeps,
      encode: async (canvas, encoder) => {
        await rm(outDir, { recursive: true, force: true })
        return realDeps.encode(canvas, encoder)
      }
    }
    await expect(
      runDewatermark(request({ inputPath: input, outputDir: outDir }), makeCtx().ctx, removing)
    ).rejects.toMatchObject({ code: 'IDW_WRITE_FAILED' })
  })

  it('编码失败 → IDW_INPAINT_FAILED', async () => {
    const root = await makeRoot()
    const input = join(root, 'sample.png')
    await makeSource(input)
    const failing: DewatermarkWorkerDeps = {
      ...realDeps,
      encode: () => Promise.reject(new Error('encode boom'))
    }
    await expect(
      runDewatermark(request({ inputPath: input, outputDir: root }), makeCtx().ctx, failing)
    ).rejects.toMatchObject({ code: 'IDW_INPAINT_FAILED', detail: 'encode boom' })
  })

  it('编码抛非 Error → IDW_INPAINT_FAILED 详情取字符串', async () => {
    const root = await makeRoot()
    const input = join(root, 'sample.png')
    await makeSource(input)
    const failing: DewatermarkWorkerDeps = {
      ...realDeps,
      encode: () => Promise.reject('plain boom')
    }
    await expect(
      runDewatermark(request({ inputPath: input, outputDir: root }), makeCtx().ctx, failing)
    ).rejects.toMatchObject({ code: 'IDW_INPAINT_FAILED', detail: 'plain boom' })
  })
})

describe('inpaintRegion', () => {
  it('只回写区域像素，整图掩码保持原样', () => {
    const width = 10
    const height = 10
    const buffer = new Uint8ClampedArray(width * height * 4).fill(50)
    inpaintRegion(buffer, width, height, { x: 2, y: 2, width: 3, height: 3 })
    expect(buffer[0]).toBe(50)
    const center = (4 * width + 4) * 4
    expect(buffer[center]).toBe(50)
    inpaintRegion(buffer, width, height, { x: 0, y: 0, width: 10, height: 10 })
    expect(buffer[0]).toBe(50)
  })
})
