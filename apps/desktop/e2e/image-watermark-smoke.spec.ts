/**
 * @file image-watermark（图片批量水印）e2e 冒烟：真实 Electron + 真实 @napi-rs/canvas worker
 * @author cuilanchao
 * @date 2026-11-20
 * @description 覆盖：页面加载/空态、多选图片 → 文字水印正向处理（R2.1 中文+空格目录）、
 *              原图不被改写、重名递增、损坏图（R2.3）错误态、IPC 缺失入参错误、
 *              任务取消（R2.5）与无 .tmp 残留。
 *              前置：pnpm -F @lumin/desktop build。
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createCanvas } from '@napi-rs/canvas'
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

/** 合成纯色 PNG（白色底） */
function writePng(file: string, width: number, height: number, color = '#ffffff'): void {
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = color
  ctx.fillRect(0, 0, width, height)
  fs.writeFileSync(file, canvas.toBuffer('image/png'))
}

/** 文件 sha256（校验原图未被改写） */
function sha256(file: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

/** 指定输出目录（原生目录选择框不可自动化，走通道） */
async function setOutputDir(page: Page, outputDir: string): Promise<void> {
  await page.evaluate(
    (dir) => window.lumin.invoke('image-watermark:set-output-dir', { outputDir: dir }),
    outputDir
  )
}

test.describe('image-watermark（图片批量水印）冒烟', () => {
  test('空态 → 多选图片 → 文字水印 → 原图不变 + 重名递增', async () => {
    const { app, page } = await launch()
    const workDir = freshDir('lumin-iw-e2e-happy')
    const outDir = path.join(workDir, '输出 目录')
    try {
      const first = path.join(workDir, '照片 1.png')
      const second = path.join(workDir, 'b.png')
      writePng(first, 640, 400)
      writePng(second, 300, 200)
      const before = [sha256(first), sha256(second)]
      await setOutputDir(page, outDir)

      await clickSidebarTool(page, '图片批量水印')
      await expect(page.getByRole('heading', { name: '图片批量水印' })).toBeVisible()
      await expect(page.getByText('拖拽图片到此处，或点击选择（可多选）')).toBeVisible()

      await page.setInputFiles('input[type="file"]', [first, second])
      await expect(page.getByText('已选 2 张')).toBeVisible()
      await expect(page.locator('canvas')).toBeVisible()

      await page.getByRole('button', { name: '开始加水印' }).click()
      await expect(page.getByText('成功 2 张 · 失败 0 张')).toBeVisible({ timeout: 30_000 })

      const outputA = path.join(outDir, '照片 1_水印.png')
      const outputB = path.join(outDir, 'b_水印.png')
      expect(fs.existsSync(outputA)).toBe(true)
      expect(fs.existsSync(outputB)).toBe(true)
      expect([sha256(first), sha256(second)]).toEqual(before)

      // 再跑一次：同名冲突递增，原图仍不变
      await page.getByRole('button', { name: '再跑一次' }).click()
      await expect(page.getByText('成功 2 张 · 失败 0 张')).toBeVisible({ timeout: 30_000 })
      expect(fs.existsSync(path.join(outDir, '照片 1_水印 (1).png'))).toBe(true)
      expect([sha256(first), sha256(second)]).toEqual(before)
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true })
      await app.close()
    }
  })

  test('损坏图错误态 + IPC 入参错误 + 取消无残留', async () => {
    const { app, page } = await launch()
    const workDir = freshDir('lumin-iw-e2e-errors')
    const outDir = path.join(workDir, 'out')
    try {
      const broken = path.join(workDir, 'broken.png')
      fs.writeFileSync(broken, Buffer.from('not-an-image'))
      const valid = path.join(workDir, 'valid.png')
      writePng(valid, 1600, 1200)
      await setOutputDir(page, outDir)

      await clickSidebarTool(page, '图片批量水印')
      await page.setInputFiles('input[type="file"]', broken)
      await page.getByRole('button', { name: '开始加水印' }).click()
      await expect(page.getByText('图片无法解码，可能已损坏')).toBeVisible({ timeout: 30_000 })
      await expect(page.getByText(/IW_IMAGE_CORRUPT/)).toBeVisible()

      // 超大文件（R2.4）：renderer 预检直接跳过并提示，不进任务
      await page.getByRole('button', { name: '返回重新选择' }).click()
      const huge = path.join(workDir, 'huge.png')
      fs.writeFileSync(huge, Buffer.alloc(41 * 1024 * 1024))
      await page.setInputFiles('input[type="file"]', huge)
      await expect(page.getByText('图片超过 40MB，已跳过：huge.png')).toBeVisible()
      fs.rmSync(huge, { force: true })

      // 缺失输入 → 任务事件回结构化错误码（三段式任务异常走 error 事件）
      const missing = await page.evaluate(async () => {
        let code = ''
        const off = window.lumin.onTaskEvent((event) => {
          if (event.kind === 'error') code = event.error.code
        })
        await window.lumin.invoke('image-watermark:watermark', {
          inputPaths: ['C:\\not-exists\\ghost.png'],
          watermark: {
            type: 'text',
            text: '内部资料',
            color: '#ffffff',
            sizePct: 8,
            opacity: 30,
            rotation: 0,
            position: 'bottom-right',
            marginPct: 3,
            tile: false
          }
        })
        await new Promise((resolve) => setTimeout(resolve, 1500))
        off()
        return code
      })
      expect(missing).toBe('IW_INPUT_INVALID')

      // 提交后立即取消（R2.5），且不残留 .tmp
      const cancelled = await page.evaluate(async (inputPath: string) => {
        let sawCancel = false
        const off = window.lumin.onTaskEvent((event) => {
          if (event.kind === 'error' && event.error.code === 'CANCELLED') sawCancel = true
        })
        const { taskId } = await window.lumin.invoke<{ taskId: string }>(
          'image-watermark:watermark',
          {
            inputPaths: [inputPath],
            watermark: {
              type: 'text',
              text: '取消测试',
              color: '#ffffff',
              sizePct: 8,
              opacity: 30,
              rotation: 0,
              position: 'bottom-right',
              marginPct: 3,
              tile: false
            }
          }
        )
        await window.lumin.invoke('lumin:task:cancel', { taskId })
        await new Promise((resolve) => setTimeout(resolve, 1500))
        off()
        return sawCancel
      }, valid)
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
