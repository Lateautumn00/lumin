/**
 * @file images.worker.test.ts 图片→PDF worker 单测（真实 PNG/JPEG 编码 + 真实 PDF 落盘）
 * @author cuilanchao
 * @date 2026-11-19
 * @description 顺序/auto-A4 布局/直嵌与转码分支/失败汇总/冲突重命名/目录错误/ffmpeg 异常
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCanvas } from '@napi-rs/canvas'
import { PDFDocument } from 'pdf-lib'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SpawnError, type RunProcessResult } from '@lumin/node-kit'
import type { TaskUpdate } from '@lumin/shared'
import { runImagesToPdf, type ImagesWorkerDeps } from './images.worker'
import type { ImagesToPdfRequest } from './schema'

let root = ''

/** 生成指定尺寸的图片文件（png/jpeg） */
async function writeImage(
  file: string,
  width: number,
  height: number,
  format: 'png' | 'jpeg'
): Promise<void> {
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#3366ff'
  ctx.fillRect(0, 0, width, height)
  const bytes = format === 'png' ? canvas.toBuffer('image/png') : await canvas.encode('jpeg', 90)
  await writeFile(file, bytes)
}

/** 成功返回（可写入输出文件）的假 ffmpeg */
function fakeFfmpeg(onArgs?: (args: readonly string[]) => void): ImagesWorkerDeps['runProcess'] {
  return async (options) => {
    onArgs?.(options.args ?? [])
    const output = options.args?.[5]
    if (output !== undefined) await writeImage(output, 8, 6, 'png')
    return {
      code: 0,
      signal: null,
      stdout: '',
      stderr: '',
      timedOut: false,
      aborted: false,
      truncated: false
    } satisfies RunProcessResult
  }
}

function ctxUpdates(): { updates: TaskUpdate[]; ctx: { emit: (u: TaskUpdate) => void } } {
  const updates: TaskUpdate[] = []
  return { updates, ctx: { emit: (u) => updates.push(u) } }
}

function request(overrides: Partial<ImagesToPdfRequest> = {}): ImagesToPdfRequest {
  return {
    inputPaths: [],
    pageSize: 'auto',
    orientation: 'auto',
    marginMm: 0,
    outputDir: join(root, 'out'),
    ffmpegPath: join(root, 'binaries', 'ffmpeg.exe'),
    ...overrides
  }
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'lumin-pi-img-'))
  await mkdir(join(root, 'out'), { recursive: true })
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('runImagesToPdf', () => {
  it('auto：按顺序单页嵌入，页面尺寸跟随图片', async () => {
    const first = join(root, 'a.png')
    const second = join(root, 'b.jpg')
    await writeImage(first, 30, 20, 'png')
    await writeImage(second, 10, 10, 'jpeg')
    const { updates, ctx } = ctxUpdates()
    const result = await runImagesToPdf(request({ inputPaths: [first, second] }), ctx, {
      runProcess: fakeFfmpeg()
    })
    expect(result.pages).toBe(2)
    expect(result.failures).toEqual([])
    expect(result.output).toBe(join(root, 'out', 'a_合并.pdf'))
    const doc = await PDFDocument.load(await readFile(result.output))
    expect(doc.getPageCount()).toBe(2)
    expect(doc.getPage(0).getSize()).toMatchObject({ width: 30, height: 20 })
    expect(doc.getPage(1).getSize()).toMatchObject({ width: 10, height: 10 })
    expect(updates).toHaveLength(2)
    expect(updates[1]).toMatchObject({ kind: 'progress', current: 2, total: 2 })
  })

  it('a4：页面为 A4 且图片等比居中', async () => {
    const image = join(root, '横图.png')
    await writeImage(image, 200, 100, 'png')
    const result = await runImagesToPdf(
      request({ inputPaths: [image], pageSize: 'a4', orientation: 'portrait', marginMm: 10 }),
      ctxUpdates().ctx,
      { runProcess: fakeFfmpeg() }
    )
    const doc = await PDFDocument.load(await readFile(result.output))
    const size = doc.getPage(0).getSize()
    expect(size.width).toBeCloseTo(595.28, 1)
    expect(size.height).toBeCloseTo(841.89, 1)
  })

  it('letter 横版 + 边距：页面 792×612', async () => {
    const image = join(root, '高图.png')
    await writeImage(image, 100, 400, 'png')
    const result = await runImagesToPdf(
      request({
        inputPaths: [image],
        pageSize: 'letter',
        orientation: 'landscape',
        marginMm: 20
      }),
      ctxUpdates().ctx,
      { runProcess: fakeFfmpeg() }
    )
    const doc = await PDFDocument.load(await readFile(result.output))
    expect(doc.getPageCount()).toBe(1)
    expect(doc.getPage(0).getSize()).toMatchObject({ width: 792, height: 612 })
  })

  it('自定义输出文件名（.PDF 自动归一为 .pdf）', async () => {
    const image = join(root, 'a.png')
    await writeImage(image, 10, 10, 'png')
    const result = await runImagesToPdf(
      request({ inputPaths: [image], outputName: '自定义 名称.PDF' }),
      ctxUpdates().ctx,
      { runProcess: fakeFfmpeg() }
    )
    expect(result.output).toBe(join(root, 'out', '自定义 名称.pdf'))
  })

  it('自定义名冲突自动递增（自定义 名称 (1).pdf）', async () => {
    const image = join(root, 'a.png')
    await writeImage(image, 10, 10, 'png')
    await writeFile(join(root, 'out', '自定义 名称.pdf'), 'occupied')
    const result = await runImagesToPdf(
      request({ inputPaths: [image], outputName: '自定义 名称' }),
      ctxUpdates().ctx,
      { runProcess: fakeFfmpeg() }
    )
    expect(result.output).toBe(join(root, 'out', '自定义 名称 (1).pdf'))
  })

  it('非 png/jpg：经 ffmpeg 转码后嵌入', async () => {
    const webp = join(root, 'c.webp')
    await writeFile(webp, 'fake-webp')
    const seen: (readonly string[])[] = []
    const result = await runImagesToPdf(request({ inputPaths: [webp] }), ctxUpdates().ctx, {
      runProcess: fakeFfmpeg((args) => seen.push(args))
    })
    expect(result.pages).toBe(1)
    expect(seen[0]?.[0]).toBe('-y')
    expect(seen[0]?.[2]).toBe(webp)
    expect(seen[0]?.[5]?.endsWith('.png')).toBe(true)
  })

  it('ffmpeg 非零退出 → 该项失败；全部失败则抛 PI_IMAGE_CORRUPT', async () => {
    const webp = join(root, 'd.webp')
    await writeFile(webp, 'fake-webp')
    const failing: ImagesWorkerDeps['runProcess'] = () =>
      Promise.resolve({
        code: 1,
        signal: null,
        stdout: '',
        stderr: 'Invalid data found',
        timedOut: false,
        aborted: false,
        truncated: false
      })
    await expect(
      runImagesToPdf(request({ inputPaths: [webp] }), ctxUpdates().ctx, { runProcess: failing })
    ).rejects.toMatchObject({ code: 'PI_IMAGE_CORRUPT' })
  })

  it('ffmpeg 缺失（SpawnError）→ PI_ENGINE_MISSING', async () => {
    const webp = join(root, 'e.webp')
    await writeFile(webp, 'fake-webp')
    const spawnFail: ImagesWorkerDeps['runProcess'] = () =>
      Promise.reject(new SpawnError('spawn ENOENT', 'ffmpeg.exe'))
    await expect(
      runImagesToPdf(request({ inputPaths: [webp] }), ctxUpdates().ctx, {
        runProcess: spawnFail
      })
    ).rejects.toMatchObject({ code: 'PI_ENGINE_MISSING' })
  })

  it('部分失败：成功页照常产出，失败项进 failures', async () => {
    const good = join(root, 'good.png')
    await writeImage(good, 12, 12, 'png')
    const corrupt = join(root, 'bad.png')
    await writeFile(corrupt, 'not an image')
    const result = await runImagesToPdf(
      request({ inputPaths: [good, corrupt] }),
      ctxUpdates().ctx,
      { runProcess: fakeFfmpeg() }
    )
    expect(result.pages).toBe(1)
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0]).toMatchObject({ file: 'bad.png', code: 'PI_IMAGE_CORRUPT' })
  })

  it('文件不存在 → 全部失败时抛 PI_INPUT_INVALID', async () => {
    await expect(
      runImagesToPdf(request({ inputPaths: [join(root, 'nope.png')] }), ctxUpdates().ctx, {
        runProcess: fakeFfmpeg()
      })
    ).rejects.toMatchObject({ code: 'PI_INPUT_INVALID' })
  })

  it('输出重名自动递增（_合并 (1).pdf）', async () => {
    const image = join(root, 'a.png')
    await writeImage(image, 10, 10, 'png')
    await writeFile(join(root, 'out', 'a_合并.pdf'), 'occupied')
    const result = await runImagesToPdf(request({ inputPaths: [image] }), ctxUpdates().ctx, {
      runProcess: fakeFfmpeg()
    })
    expect(result.output).toBe(join(root, 'out', 'a_合并 (1).pdf'))
  })

  it('输出目录不可用 → PI_OUTPUT_DIR_INVALID', async () => {
    const block = join(root, 'blocked')
    await writeFile(block, 'file')
    await expect(
      runImagesToPdf(
        request({ inputPaths: [join(root, 'x.png')], outputDir: block }),
        ctxUpdates().ctx,
        {
          runProcess: fakeFfmpeg()
        }
      )
    ).rejects.toMatchObject({ code: 'PI_OUTPUT_DIR_INVALID' })
  })
})
