/**
 * @file image-dewatermark-smoke.spec.ts 图片去水印 e2e 冒烟（真实 Electron + worker）
 * @author cuilanchao
 * @date 2026-11-24
 * @description 覆盖：空态、框选出图（快速修复）、原图不变、重名递增、纯色/模糊通道、
 *              损坏图与缺失输入错误码、超大文件跳过、取消无 .tmp 残留。
 *              前置：pnpm -F @lumin/desktop build。
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { clickSidebarTool } from './sidebar'
import type { LuminBridge } from '@lumin/plugin-api'

declare global {
  interface Window {
    lumin: LuminBridge
  }
}

const appDir = path.resolve(__dirname, '..')

async function launch(): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({ args: ['.'], cwd: appDir })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await page.waitForFunction(() => typeof window.lumin !== 'undefined')
  return { app, page }
}

/** 生成测试工作目录（先清空） */
function freshDir(name: string): string {
  const dir = path.join(os.tmpdir(), name)
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

/** 白底 + 居中红块（模拟水印） */
function writePngWithRedBlock(file: string, size = 400): void {
  const canvas = createCanvas(size, size)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, size, size)
  ctx.fillStyle = '#ff0000'
  ctx.fillRect(size * 0.35, size * 0.35, size * 0.3, size * 0.3)
  fs.writeFileSync(file, canvas.toBuffer('image/png'))
}

/** 纯色 PNG（取消用大图） */
function writeSolidPng(file: string, width: number, height: number): void {
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  fs.writeFileSync(file, canvas.toBuffer('image/png'))
}

function sha256(file: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

/** 读取产物中心像素 */
async function readPixel(file: string, x: number, y: number): Promise<number[]> {
  const image = await loadImage(fs.readFileSync(file))
  const canvas = createCanvas(image.width, image.height)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(image, 0, 0)
  const data = ctx.getImageData(x, y, 1, 1).data
  return [data[0] ?? 0, data[1] ?? 0, data[2] ?? 0]
}

/** 指定输出目录（原生目录选择框不可自动化，走通道） */
async function setOutputDir(page: Page, outputDir: string): Promise<void> {
  await page.evaluate(
    (dir) => window.lumin.invoke('image-dewatermark:set-output-dir', { outputDir: dir }),
    outputDir
  )
}

test.describe('image-dewatermark（图片去水印）冒烟', () => {
  test('空态 → 框选 → 快速修复出图 → 原图不变 + 重名递增', async () => {
    const { app, page } = await launch()
    const workDir = freshDir('lumin-idw-e2e-happy')
    const outDir = path.join(workDir, '输出 目录')
    try {
      const input = path.join(workDir, '照片 1.png')
      writePngWithRedBlock(input, 400)
      const before = sha256(input)
      await setOutputDir(page, outDir)

      await clickSidebarTool(page, '图片去水印')
      await expect(page.getByRole('heading', { name: '图片去水印' })).toBeVisible()
      await expect(page.getByText('拖拽图片到此处，或点击选择')).toBeVisible()
      await expect(page.getByTestId('dewatermark-start')).toHaveCount(0)

      await page.setInputFiles('input[type="file"]', input)
      const stage = page.getByTestId('dewatermark-stage')
      await expect(stage).toBeVisible()
      await expect(page.getByTestId('dewatermark-start')).toBeDisabled()

      const box = await stage.boundingBox()
      expect(box).not.toBeNull()
      if (box === null) return
      await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3)
      await page.mouse.down()
      await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.7, { steps: 8 })
      await page.mouse.up()
      await expect(page.getByText('已框选 1/20 个区域')).toBeVisible()
      await expect(page.getByTestId('dewatermark-start')).toBeEnabled()

      await page.getByTestId('dewatermark-start').click()
      await expect(page.getByText('已生成：')).toBeVisible({ timeout: 30_000 })

      const output = path.join(outDir, '照片 1_去水印.png')
      expect(fs.existsSync(output)).toBe(true)
      expect(sha256(input)).toBe(before)
      const [r, g, b] = await readPixel(output, 200, 200)
      expect(g).toBeGreaterThan(200)
      expect(b).toBeGreaterThan(200)
      expect(r).toBeGreaterThan(200)

      // 再跑一次：同名冲突递增，原图仍不变
      await page.getByTestId('dewatermark-start').click()
      await expect(page.getByText('已生成：')).toBeVisible({ timeout: 30_000 })
      expect(fs.existsSync(path.join(outDir, '照片 1_去水印 (1).png'))).toBe(true)
      expect(sha256(input)).toBe(before)
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true })
      await app.close()
    }
  })

  test('纯色/模糊通道 + 损坏图/缺失输入错误码 + 超大文件跳过 + 取消无残留', async () => {
    const { app, page } = await launch()
    const workDir = freshDir('lumin-idw-e2e-errors')
    const outDir = path.join(workDir, 'out')
    try {
      const input = path.join(workDir, 'valid.png')
      writeSolidPng(input, 2000, 2000)
      const broken = path.join(workDir, 'broken.png')
      fs.writeFileSync(broken, Buffer.from('not-an-image'))
      await setOutputDir(page, outDir)

      await clickSidebarTool(page, '图片去水印')

      // 损坏图在 renderer 预览阶段即被拦截
      await page.setInputFiles('input[type="file"]', broken)
      await expect(page.getByText('图片无法读取，请更换文件')).toBeVisible()

      // 超大文件（R2.4）：renderer 预检直接跳过
      const huge = path.join(workDir, 'huge.png')
      fs.writeFileSync(huge, Buffer.alloc(41 * 1024 * 1024))
      await page.setInputFiles('input[type="file"]', huge)
      await expect(page.getByText('图片超过 40MB，已跳过：huge.png')).toBeVisible()
      fs.rmSync(huge, { force: true })

      // 缺失输入 → 任务错误事件 IDW_INPUT_INVALID
      const missing = await page.evaluate(async () => {
        let code = ''
        const off = window.lumin.onTaskEvent((event) => {
          if (event.kind === 'error') code = event.error.code
        })
        await window.lumin.invoke('image-dewatermark:dewatermark', {
          inputPath: 'C:\\not-exists\\ghost.png',
          regions: [{ x: 10, y: 10, width: 40, height: 40 }],
          mode: 'inpaint',
          blurRadius: 12
        })
        await new Promise((resolve) => setTimeout(resolve, 1500))
        off()
        return code
      })
      expect(missing).toBe('IDW_INPUT_INVALID')

      // 损坏图直达 worker → IDW_IMAGE_CORRUPT
      const corrupt = await page.evaluate(async (inputPath: string) => {
        let code = ''
        const off = window.lumin.onTaskEvent((event) => {
          if (event.kind === 'error') code = event.error.code
        })
        await window.lumin.invoke('image-dewatermark:dewatermark', {
          inputPath,
          regions: [{ x: 10, y: 10, width: 40, height: 40 }],
          mode: 'inpaint',
          blurRadius: 12
        })
        await new Promise((resolve) => setTimeout(resolve, 1500))
        off()
        return code
      }, broken)
      expect(corrupt).toBe('IDW_IMAGE_CORRUPT')

      // 纯色与模糊通道出图（直接走通道，避免框选依赖）
      for (const mode of ['solid', 'blur'] as const) {
        const output = await page.evaluate(
          async ({ inputPath, mode }) => {
            let file = ''
            const off = window.lumin.onTaskEvent((event) => {
              if (event.kind === 'done') file = (event.result as { output: string }).output
            })
            await window.lumin.invoke('image-dewatermark:dewatermark', {
              inputPath,
              regions: [{ x: 400, y: 400, width: 300, height: 300 }],
              mode,
              blurRadius: 12
            })
            await new Promise((resolve) => setTimeout(resolve, 5000))
            off()
            return file
          },
          { inputPath: input, mode }
        )
        expect(output).not.toBe('')
        expect(fs.existsSync(output)).toBe(true)
      }

      // 提交后立即取消（R2.5），且不残留 .tmp
      const cancelled = await page.evaluate(async (inputPath: string) => {
        let sawCancel = false
        const off = window.lumin.onTaskEvent((event) => {
          if (event.kind === 'error' && event.error.code === 'CANCELLED') sawCancel = true
        })
        const { taskId } = await window.lumin.invoke<{ taskId: string }>(
          'image-dewatermark:dewatermark',
          {
            inputPath,
            regions: [{ x: 100, y: 100, width: 1400, height: 1400 }],
            mode: 'inpaint',
            blurRadius: 12
          }
        )
        await window.lumin.invoke('lumin:task:cancel', { taskId })
        await new Promise((resolve) => setTimeout(resolve, 1500))
        off()
        return sawCancel
      }, input)
      expect(cancelled).toBe(true)
      const leftovers = fs.existsSync(outDir)
        ? fs.readdirSync(outDir).filter((name) => name.endsWith('.tmp'))
        : []
      expect(leftovers).toEqual([])
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true })
      await app.close()
    }
  })
})
