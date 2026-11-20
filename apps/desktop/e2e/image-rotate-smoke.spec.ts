/**
 * @file image-rotate（图片旋转）e2e 冒烟：真实 Electron + 真实 ffmpeg 二进制
 * @author cuilanchao
 * @date 2026-11-20
 * @description 覆盖：页面空态/开始禁用、R2.1 中文+空格路径旋转 90° 尺寸变化（progress）、
 *              水平翻转保持尺寸 + 冲突命名递增、R2.3 损坏 + 不支持扩展名混合批次。
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

interface RotateOutcome {
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

/** 提交旋转任务并等待 done（返回进度标记与 result） */
async function runRotate(
  page: Page,
  payload: {
    files: string[]
    outputDir: string
    options: { rotation: 'none' | '90' | '180' | '270'; flip: 'none' | 'horizontal' | 'vertical' }
  }
): Promise<{ hasProgress: boolean; result: RotateOutcome }> {
  return page.evaluate(
    (args: typeof payload) =>
      new Promise<{ hasProgress: boolean; result: RotateOutcome }>((resolve, reject) => {
        let hasProgress = false
        let currentTaskId = ''
        const off = window.lumin.onTaskEvent((ev) => {
          if (ev.taskId !== currentTaskId) return
          if (ev.kind === 'progress') {
            hasProgress = true
          } else if (ev.kind === 'done') {
            off()
            resolve({ hasProgress, result: ev.result as RotateOutcome })
          } else if (ev.kind === 'error') {
            off()
            reject(new Error(`${ev.error.code}: ${ev.error.message}`))
          }
        })
        window.lumin
          .invoke<{ taskId: string }>('image-rotate:process', args)
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

test.describe('image-rotate（图片旋转）冒烟', () => {
  test('页面加载 + 空态引导 + 未选操作时开始禁用', async () => {
    const { app, page } = await launch()
    await ensureReady(page)
    try {
      await clickSidebarTool(page, '图片旋转')
      await expect(page.getByRole('heading', { name: '图片旋转' })).toBeVisible()
      await expect(page.getByText('添加图片开始处理')).toBeVisible()
      const start = page.getByRole('button', { name: '开始处理' })
      await expect(start).toBeVisible()
      await expect(start).toBeDisabled()
    } finally {
      await app.close()
    }
  })

  test('R2.1 中文+空格路径旋转 90°：progress → done，产物 320x240 → 240x320', async () => {
    test.skip(
      !fs.existsSync(ffmpeg),
      '缺少 ffmpeg（先跑 node scripts/fetch-binaries.mjs --group download）'
    )
    const { app, page } = await launch()
    await ensureReady(page)
    const inDir = path.join(os.tmpdir(), 'lumin-ir-e2e-rot')
    const outDir = path.join(inDir, 'out')
    fs.rmSync(inDir, { recursive: true, force: true })
    fs.mkdirSync(inDir, { recursive: true })
    try {
      const input = path.join(inDir, '旋转 样例.png')
      await makeImage(['-f', 'lavfi', '-i', 'color=c=red:s=320x240', '-frames:v', '1', input])

      const outcome = await runRotate(page, {
        files: [input],
        outputDir: outDir,
        options: { rotation: '90', flip: 'none' }
      })

      expect(outcome.hasProgress).toBe(true)
      expect(outcome.result.outputs).toHaveLength(1)
      const output = firstOf(outcome.result.outputs).output
      expect(output).toBe(path.join(outDir, '旋转 样例_旋转90.png'))
      expect(fs.existsSync(output)).toBe(true)
      expect(pngSize(output)).toEqual({ width: 240, height: 320 })
    } finally {
      fs.rmSync(inDir, { recursive: true, force: true })
      await app.close()
    }
  })

  test('水平翻转保持尺寸 + 重复执行冲突命名 (1)', async () => {
    test.skip(
      !fs.existsSync(ffmpeg),
      '缺少 ffmpeg（先跑 node scripts/fetch-binaries.mjs --group download）'
    )
    const { app, page } = await launch()
    await ensureReady(page)
    const inDir = path.join(os.tmpdir(), 'lumin-ir-e2e-flip')
    const outDir = path.join(inDir, 'out')
    fs.rmSync(inDir, { recursive: true, force: true })
    fs.mkdirSync(inDir, { recursive: true })
    try {
      const input = path.join(inDir, '横向 样例.png')
      await makeImage(['-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=1:duration=1', input])
      const payload = {
        files: [input],
        outputDir: outDir,
        options: { rotation: 'none' as const, flip: 'horizontal' as const }
      }

      const first = await runRotate(page, payload)
      const firstOutput = firstOf(first.result.outputs).output
      expect(firstOutput).toBe(path.join(outDir, '横向 样例_水平翻转.png'))
      expect(pngSize(firstOutput)).toEqual({ width: 320, height: 240 })

      const second = await runRotate(page, payload)
      const secondOutput = firstOf(second.result.outputs).output
      expect(secondOutput).toBe(path.join(outDir, '横向 样例_水平翻转 (1).png'))
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
    const inDir = path.join(os.tmpdir(), 'lumin-ir-e2e-mixed')
    const outDir = path.join(inDir, 'out')
    fs.rmSync(inDir, { recursive: true, force: true })
    fs.mkdirSync(inDir, { recursive: true })
    try {
      const good = path.join(inDir, '好图.png')
      const corrupt = path.join(inDir, '损坏 图.jpg')
      const unsupported = path.join(inDir, '说明.txt')
      await makeImage(['-f', 'lavfi', '-i', 'color=c=green:s=400x300', '-frames:v', '1', good])
      fs.writeFileSync(corrupt, Buffer.from('not an image at all'))
      fs.writeFileSync(unsupported, Buffer.from('text'))

      const outcome = await runRotate(page, {
        files: [good, corrupt, unsupported],
        outputDir: outDir,
        options: { rotation: '180', flip: 'vertical' }
      })

      expect(outcome.result.outputs).toHaveLength(1)
      const output = firstOf(outcome.result.outputs).output
      expect(output).toBe(path.join(outDir, '好图_旋转180_垂直翻转.png'))
      expect(fs.existsSync(output)).toBe(true)
      expect(pngSize(output)).toEqual({ width: 400, height: 300 })
      expect(outcome.result.failures.map((f) => f.code)).toEqual([
        'IR_FILE_CORRUPT',
        'IR_FILE_UNSUPPORTED'
      ])
    } finally {
      fs.rmSync(inDir, { recursive: true, force: true })
      await app.close()
    }
  })
})
