/**
 * @file image-crop（图片裁剪）e2e 冒烟：真实 Electron + 真实 ffmpeg 二进制
 * @author cuilanchao
 * @date 2026-11-21
 * @description 覆盖：页面空态/开始禁用、比例 1:1 居中（progress）、16:9 左下锚点、
 *              自由区域百分比 + 冲突命名递增、R2.3 损坏 + 不支持扩展名混合批次。
 *              注意：临时目录名必须 ASCII（本机 Node fs 对非 ASCII 目录名会硬崩），
 *              文件名保留中文验证路径。前置：node scripts/fetch-binaries.mjs
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import { clickSidebarTool } from './sidebar'
import type { LuminBridge } from '@lumin/plugin-api'

declare global {
  interface Window {
    lumin: LuminBridge
  }
}

const appDir = path.resolve(__dirname, '..')
const ffmpeg = path.resolve(appDir, '../../binaries/download/ffmpeg.exe')

type Page = Awaited<ReturnType<ElectronApplication['firstWindow']>>

interface CropOptions {
  mode: 'ratio' | 'free'
  ratioW?: number
  ratioH?: number
  anchor?: string
  x?: number
  y?: number
  width?: number
  height?: number
}

interface CropOutcome {
  outputs: { input: string; output: string }[]
  failures: { input: string; code: string }[]
}

async function launch(): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({ args: ['.'], cwd: appDir })
  const page = await app.firstWindow()
  return { app, page }
}

/** noUncheckedIndexedAccess 收窄：取首元素，空数组抛错 */
function firstOf<T>(items: T[]): T {
  const item = items[0]
  if (item === undefined) throw new Error('数组为空')
  return item
}

/** 等待壳渲染层就绪（firstWindow 可能早于加载完成） */
async function ensureReady(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded')
  await page.waitForFunction(() => typeof window.lumin !== 'undefined')
}

/** 用仓库 ffmpeg 生成测试图片（lavfi 合成，免入库 fixture） */
function makeImage(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, ['-y', '-v', 'error', ...args], { windowsHide: true })
    let stderr = ''
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(stderr))))
  })
}

/** PNG IHDR 宽高（偏移 16/20 大端） */
function pngSize(file: string): { width: number; height: number } {
  const buf = fs.readFileSync(file)
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

/** 提交裁剪任务并等待 done（返回进度标记与 result） */
async function runCrop(
  page: Page,
  payload: { files: string[]; outputDir: string; options: CropOptions }
): Promise<{ hasProgress: boolean; result: CropOutcome }> {
  return page.evaluate(
    (args: typeof payload) =>
      new Promise<{ hasProgress: boolean; result: CropOutcome }>((resolve, reject) => {
        let hasProgress = false
        let currentTaskId = ''
        const off = window.lumin.onTaskEvent((ev) => {
          if (ev.taskId !== currentTaskId) return
          if (ev.kind === 'progress') {
            hasProgress = true
          } else if (ev.kind === 'done') {
            off()
            resolve({ hasProgress, result: ev.result as CropOutcome })
          } else if (ev.kind === 'error') {
            off()
            reject(new Error(`${ev.error.code}: ${ev.error.message}`))
          }
        })
        window.lumin
          .invoke<{ taskId: string }>('image-crop:process', args)
          .then(({ taskId }) => {
            currentTaskId = taskId
          })
          .catch((err: unknown) => {
            off()
            reject(err)
          })
      }),
    payload
  )
}

test.describe('image-crop（图片裁剪）冒烟', () => {
  test('页面加载 + 空态引导 + 未选文件时开始禁用', async () => {
    const { app, page } = await launch()
    await ensureReady(page)
    try {
      await clickSidebarTool(page, '图片裁剪')
      await expect(page.getByRole('heading', { name: '图片裁剪' })).toBeVisible()
      await expect(page.getByText('添加图片开始裁剪')).toBeVisible()
      const start = page.getByRole('button', { name: '开始裁剪' })
      await expect(start).toBeVisible()
      await expect(start).toBeDisabled()
      await expect(page.getByRole('radio', { name: '比例裁剪' })).toBeChecked()
    } finally {
      await app.close()
    }
  })

  test('比例 1:1 居中：400x300 → 300x300，progress → done', async () => {
    test.skip(
      !fs.existsSync(ffmpeg),
      '缺少 ffmpeg（先跑 node scripts/fetch-binaries.mjs --group download）'
    )
    const { app, page } = await launch()
    await ensureReady(page)
    const inDir = path.join(os.tmpdir(), 'lumin-ic-e2e-square')
    const outDir = path.join(inDir, 'out')
    fs.rmSync(inDir, { recursive: true, force: true })
    fs.mkdirSync(inDir, { recursive: true })
    try {
      const input = path.join(inDir, '正方形 样例.png')
      await makeImage(['-f', 'lavfi', '-i', 'color=c=red:s=400x300', '-frames:v', '1', input])

      const outcome = await runCrop(page, {
        files: [input],
        outputDir: outDir,
        options: { mode: 'ratio', ratioW: 1, ratioH: 1, anchor: 'center' }
      })

      expect(outcome.hasProgress).toBe(true)
      const output = firstOf(outcome.result.outputs).output
      expect(output).toBe(path.join(outDir, '正方形 样例_裁剪1x1.png'))
      expect(fs.existsSync(output)).toBe(true)
      expect(pngSize(output)).toEqual({ width: 300, height: 300 })
    } finally {
      fs.rmSync(inDir, { recursive: true, force: true })
      await app.close()
    }
  })

  test('比例 16:9 + 左下锚点：400x300 → 400x225', async () => {
    test.skip(
      !fs.existsSync(ffmpeg),
      '缺少 ffmpeg（先跑 node scripts/fetch-binaries.mjs --group download）'
    )
    const { app, page } = await launch()
    await ensureReady(page)
    const inDir = path.join(os.tmpdir(), 'lumin-ic-e2e-wide')
    const outDir = path.join(inDir, 'out')
    fs.rmSync(inDir, { recursive: true, force: true })
    fs.mkdirSync(inDir, { recursive: true })
    try {
      const input = path.join(inDir, '宽幅 样例.png')
      await makeImage(['-f', 'lavfi', '-i', 'color=c=blue:s=400x300', '-frames:v', '1', input])

      const outcome = await runCrop(page, {
        files: [input],
        outputDir: outDir,
        options: { mode: 'ratio', ratioW: 16, ratioH: 9, anchor: 'bottom-left' }
      })

      const output = firstOf(outcome.result.outputs).output
      expect(output).toBe(path.join(outDir, '宽幅 样例_裁剪16x9.png'))
      expect(pngSize(output)).toEqual({ width: 400, height: 225 })
    } finally {
      fs.rmSync(inDir, { recursive: true, force: true })
      await app.close()
    }
  })

  test('自由区域 25/25/50/50：400x300 → 200x150，重复执行冲突命名 (1)', async () => {
    test.skip(
      !fs.existsSync(ffmpeg),
      '缺少 ffmpeg（先跑 node scripts/fetch-binaries.mjs --group download）'
    )
    const { app, page } = await launch()
    await ensureReady(page)
    const inDir = path.join(os.tmpdir(), 'lumin-ic-e2e-free')
    const outDir = path.join(inDir, 'out')
    fs.rmSync(inDir, { recursive: true, force: true })
    fs.mkdirSync(inDir, { recursive: true })
    try {
      const input = path.join(inDir, '自由 样例.png')
      await makeImage(['-f', 'lavfi', '-i', 'color=c=green:s=400x300', '-frames:v', '1', input])
      const payload = {
        files: [input],
        outputDir: outDir,
        options: { mode: 'free' as const, x: 25, y: 25, width: 50, height: 50 }
      }

      const first = await runCrop(page, payload)
      const firstOutput = firstOf(first.result.outputs).output
      expect(firstOutput).toBe(path.join(outDir, '自由 样例_裁剪自由.png'))
      expect(pngSize(firstOutput)).toEqual({ width: 200, height: 150 })

      const second = await runCrop(page, payload)
      const secondOutput = firstOf(second.result.outputs).output
      expect(secondOutput).toBe(path.join(outDir, '自由 样例_裁剪自由 (1).png'))
      expect(fs.existsSync(secondOutput)).toBe(true)
    } finally {
      fs.rmSync(inDir, { recursive: true, force: true })
      await app.close()
    }
  })

  test('R2.3 损坏 + 不支持扩展名混合批次：好图照常产出，失败码逐张', async () => {
    test.skip(
      !fs.existsSync(ffmpeg),
      '缺少 ffmpeg（先跑 node scripts/fetch-binaries.mjs --group download）'
    )
    const { app, page } = await launch()
    await ensureReady(page)
    const inDir = path.join(os.tmpdir(), 'lumin-ic-e2e-mixed')
    const outDir = path.join(inDir, 'out')
    fs.rmSync(inDir, { recursive: true, force: true })
    fs.mkdirSync(inDir, { recursive: true })
    try {
      const good = path.join(inDir, '好图.png')
      const corrupt = path.join(inDir, '损坏 图.jpg')
      const unsupported = path.join(inDir, '说明.txt')
      await makeImage(['-f', 'lavfi', '-i', 'color=c=yellow:s=400x300', '-frames:v', '1', good])
      fs.writeFileSync(corrupt, Buffer.from('not an image at all'))
      fs.writeFileSync(unsupported, Buffer.from('text'))

      const outcome = await runCrop(page, {
        files: [good, corrupt, unsupported],
        outputDir: outDir,
        options: { mode: 'ratio', ratioW: 1, ratioH: 1, anchor: 'top-left' }
      })

      expect(outcome.result.outputs).toHaveLength(1)
      const output = firstOf(outcome.result.outputs).output
      expect(output).toBe(path.join(outDir, '好图_裁剪1x1.png'))
      expect(pngSize(output)).toEqual({ width: 300, height: 300 })
      expect(outcome.result.failures.map((f) => f.code)).toEqual([
        'IC_FILE_CORRUPT',
        'IC_FILE_UNSUPPORTED'
      ])
    } finally {
      fs.rmSync(inDir, { recursive: true, force: true })
      await app.close()
    }
  })
})
