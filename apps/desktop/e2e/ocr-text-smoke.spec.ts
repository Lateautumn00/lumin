/**
 * @file ocr-text（图片文字识别）e2e 冒烟：真实 Electron + 真实 PP-OCR
 * @author cuilanchao
 * @date 2026-11-19
 * @description 覆盖：页面加载/空态、损坏图（R2.3）、空白图（OCR_NO_TEXT）、超大图（R2.4）、
 *              正向识别（合成长文本图）→ 编辑后 IPC 导出 TXT（R2.1 中文+空格目录）、
 *              重名递增与并发导出（R2.6）。原生目录选择框不可自动化，导出走 IPC 契约。
 *              前置：pnpm -F @lumin/desktop build；binaries/ocr 模型齐全（缺失时正例自动 skip）。
 */
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
import type { LuminBridge } from '@lumin/plugin-api'

declare global {
  interface Window {
    lumin: LuminBridge
  }
}

const appDir = path.resolve(__dirname, '..')

/** 模型资产是否齐全（缺失则跳过依赖真实推理的正例） */
const modelsReady = ['det.onnx', 'rec.onnx', 'ppocr_keys_v1.txt'].every((file) =>
  fs.existsSync(path.resolve(appDir, '..', '..', 'binaries', 'ocr', file))
)

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

/** 合成白底黑字图片（大字号，保证 det/rec 可识别） */
function writeTextPng(file: string, text: string): void {
  const canvas = createCanvas(1000, 320)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, 1000, 320)
  ctx.fillStyle = '#000000'
  ctx.font = 'bold 96px Arial'
  ctx.fillText(text, 40, 190)
  fs.writeFileSync(file, canvas.toBuffer('image/png'))
}

/** 生成空白 PNG（OCR_NO_TEXT 分支） */
function writeBlankPng(file: string): void {
  const canvas = createCanvas(600, 300)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, 600, 300)
  fs.writeFileSync(file, canvas.toBuffer('image/png'))
}

/** 直达 save-txt 通道（绕过原生目录选择框） */
function saveTxtViaIpc(
  page: Page,
  payload: { outputDir: string; inputPath: string; text: string }
): Promise<{ output: string }> {
  return page.evaluate(
    (input: { outputDir: string; inputPath: string; text: string }) =>
      window.lumin.invoke<{ output: string }>('ocr-text:save-txt', input),
    payload
  )
}

test.describe('ocr-text（图片文字识别）冒烟', () => {
  test('页面加载 + 空态 + 损坏图/空白图/超大图错误态', async () => {
    const { app, page } = await launch()
    const workDir = freshDir('lumin-ocr-text-e2e-errors')
    try {
      const broken = path.join(workDir, 'broken.png')
      fs.writeFileSync(broken, Buffer.from('this is not an image'))
      const blank = path.join(workDir, 'blank.png')
      writeBlankPng(blank)
      const big = path.join(workDir, 'big.png')
      fs.writeFileSync(big, Buffer.alloc(21 * 1024 * 1024))

      await page.getByRole('link', { name: '图片文字识别' }).click()
      await expect(page.getByRole('heading', { name: '图片文字识别' })).toBeVisible()
      await expect(page.getByText('拖拽图片到此处，或点击选择')).toBeVisible()
      await expect(page.getByText(/支持 PNG \/ JPG \/ WebP/)).toBeVisible()

      await page.setInputFiles('input[type="file"]', broken)
      await expect(page.getByText('图片无法读取，请换一张清晰的图片')).toBeVisible()

      await page.getByRole('button', { name: '重新选择图片' }).click()
      await page.setInputFiles('input[type="file"]', blank)
      await expect(page.getByText('未识别到文字，请换更清晰的图片')).toBeVisible()

      await page.getByRole('button', { name: '重新选择图片' }).click()
      await page.setInputFiles('input[type="file"]', big)
      await expect(page.getByText('图片超过 20MB，请压缩后重试')).toBeVisible()
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true })
      await app.close()
    }
  })

  test('正向识别 → 可编辑文本 → 导出 TXT（R2.1 中文/空格目录 + 重名递增）', async () => {
    test.skip(!modelsReady, 'binaries/ocr 模型缺失，跳过真实推理用例')
    const { app, page } = await launch()
    const workDir = freshDir('lumin-ocr-text-e2e-happy')
    const outDir = path.join(workDir, '中文 目录')
    try {
      const png = path.join(workDir, 'sample 1.png')
      writeTextPng(png, 'OCR TEST 2026')

      await page.getByRole('link', { name: '图片文字识别' }).click()
      await page.setInputFiles('input[type="file"]', png)

      const textarea = page.locator('textarea')
      await expect(textarea).toBeVisible({ timeout: 30_000 })
      await expect(textarea).toHaveValue(/OCR/i)

      await textarea.fill('编辑后的第一行\n编辑后的第二行')
      const edited = await textarea.inputValue()

      const first = await saveTxtViaIpc(page, {
        outputDir: outDir,
        inputPath: png,
        text: edited
      })
      expect(first.output).toBe(path.join(outDir, 'sample 1-OCR.txt'))
      expect(fs.readFileSync(first.output, 'utf8')).toBe(edited)

      const second = await saveTxtViaIpc(page, {
        outputDir: outDir,
        inputPath: png,
        text: edited
      })
      expect(second.output).toBe(path.join(outDir, 'sample 1-OCR(1).txt'))
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true })
      await app.close()
    }
  })

  test('并发导出（R2.6）文件名互不冲突', async () => {
    const { app, page } = await launch()
    const workDir = freshDir('lumin-ocr-text-e2e-batch')
    try {
      const png = path.join(workDir, 'batch.png')
      writeTextPng(png, 'BATCH')
      const results = await Promise.all(
        Array.from({ length: 5 }, (_, index) =>
          saveTxtViaIpc(page, {
            outputDir: workDir,
            inputPath: png,
            text: `第 ${index + 1} 份`
          })
        )
      )
      expect(new Set(results.map((item) => item.output)).size).toBe(5)
      for (const item of results) expect(fs.existsSync(item.output)).toBe(true)
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true })
      await app.close()
    }
  })
})
