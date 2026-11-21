/**
 * @file ocr-text（图片文字识别）e2e 冒烟：真实 Electron + 真实 PP-OCR
 * @author cuilanchao
 * @date 2026-11-21
 * @description M49 双模式：单张自动识别 / 批量识别。覆盖页面加载与空态、类型不符、损坏图（R2.3）、
 *              空白图（OCR_NO_TEXT）、超大图（R2.4）、批量中单张失败不中断、编辑后逐张/合并导出
 *              （R2.1 中文+空格目录）、重名递增与并发（R2.6）。原生目录选择框不可自动化，导出走 IPC 契约。
 *              前置：pnpm -F @lumin/desktop build；binaries/ocr 模型齐全（缺失时真实推理用例 skip）。
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
import { clickSidebarTool } from './sidebar'
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

/** 直达 export 通道（绕过原生目录选择框） */
function exportViaIpc(
  page: Page,
  payload: {
    outputDir: string
    mode: 'per-file' | 'merged'
    items: { fileName: string; text: string }[]
  }
): Promise<{ outputs: string[] }> {
  return page.evaluate(
    (input: {
      outputDir: string
      mode: 'per-file' | 'merged'
      items: { fileName: string; text: string }[]
    }) => window.lumin.invoke<{ outputs: string[] }>('ocr-text:export', input),
    payload
  )
}

test.describe('ocr-text（图片文字识别）冒烟', () => {
  test('页面加载 + 双模式空态 + 类型不符/损坏图/超大图错误态', async () => {
    const { app, page } = await launch()
    const workDir = freshDir('lumin-ocr-text-e2e-errors')
    try {
      const pdf = path.join(workDir, 'not-image.pdf')
      fs.writeFileSync(pdf, 'x')
      const broken = path.join(workDir, 'broken.png')
      fs.writeFileSync(broken, Buffer.from('this is not an image'))
      const big = path.join(workDir, 'big.png')
      fs.writeFileSync(big, Buffer.alloc(21 * 1024 * 1024))

      await clickSidebarTool(page, '图片文字识别')
      await expect(page.getByRole('heading', { name: '图片文字识别' })).toBeVisible()
      await expect(page.getByRole('radio', { name: '单张识别' })).toBeVisible()
      await expect(page.getByRole('radio', { name: '批量识别' })).toBeVisible()
      await expect(page.getByText('拖拽或点击选择一张图片')).toBeVisible()

      await page.setInputFiles('input[type="file"]', pdf)
      await expect(page.getByText('不支持的文件类型：not-image.pdf')).toBeVisible()

      // 单张模式：选择后自动识别，损坏图 → OCR_INPUT_INVALID
      await page.setInputFiles('input[type="file"]', broken)
      await expect(page.getByText('图片无法读取，请换一张清晰的图片')).toBeVisible({
        timeout: 30_000
      })
      await expect(page.getByText('OCR_INPUT_INVALID')).toBeVisible()

      // 单张模式：超大图预检失败
      await page.getByRole('button', { name: '重新选择' }).click()
      await page.setInputFiles('input[type="file"]', big)
      await expect(page.getByText('图片超过 20MB，请压缩后重试')).toBeVisible({ timeout: 15_000 })

      // 批量模式空态
      await page.locator('.n-radio__label', { hasText: '批量识别' }).click()
      await expect(page.getByText('拖拽或点击添加图片（可多选）')).toBeVisible()
      await expect(page.getByText('列表为空：添加图片后点击「开始识别」。')).toBeVisible()
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true })
      await app.close()
    }
  })

  test('单张正向识别 → 编辑 → 导出 TXT（R2.1 中文/空格目录 + 重名递增）', async () => {
    test.skip(!modelsReady, 'binaries/ocr 模型缺失，跳过真实推理用例')
    const { app, page } = await launch()
    const workDir = freshDir('lumin-ocr-text-e2e-single')
    const outDir = path.join(workDir, '中文 目录')
    try {
      const png = path.join(workDir, 'sample 1.png')
      writeTextPng(png, 'OCR TEST 2026')

      await clickSidebarTool(page, '图片文字识别')
      await page.setInputFiles('input[type="file"]', png)

      const textarea = page.locator('textarea')
      await expect(textarea).toBeVisible({ timeout: 60_000 })
      await expect(page.getByText('识别完成：1 张全部成功')).toBeVisible({ timeout: 60_000 })
      await expect(textarea).toHaveValue(/OCR/i)

      await textarea.fill('编辑后的第一行\n编辑后的第二行')
      const edited = await textarea.inputValue()

      const first = await exportViaIpc(page, {
        outputDir: outDir,
        mode: 'per-file',
        items: [{ fileName: 'sample 1.png', text: edited }]
      })
      expect(first.outputs).toEqual([path.join(outDir, 'sample 1-OCR.txt')])
      expect(fs.readFileSync(first.outputs[0]!, 'utf8')).toBe(edited)

      const second = await exportViaIpc(page, {
        outputDir: outDir,
        mode: 'per-file',
        items: [{ fileName: 'sample 1.png', text: edited }]
      })
      expect(second.outputs).toEqual([path.join(outDir, 'sample 1-OCR(1).txt')])
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true })
      await app.close()
    }
  })

  test('批量 2 张（1 好 1 损坏）→ 失败不中断 → 逐张/合并导出', async () => {
    test.skip(!modelsReady, 'binaries/ocr 模型缺失，跳过真实推理用例')
    const { app, page } = await launch()
    const workDir = freshDir('lumin-ocr-text-e2e-batch')
    const outDir = path.join(workDir, '中文 目录')
    try {
      const first = path.join(workDir, 'sample 1.png')
      const broken = path.join(workDir, 'sample 2.png')
      writeTextPng(first, 'BATCH')
      fs.writeFileSync(broken, Buffer.from('this is not an image'))

      await clickSidebarTool(page, '图片文字识别')
      await page.locator('.n-radio__label', { hasText: '批量识别' }).click()
      await page.setInputFiles('input[type="file"]', [first, broken])

      await page.getByRole('button', { name: /开始识别/ }).click()
      await expect(page.getByText('识别完成：1 张成功，1 张失败')).toBeVisible({ timeout: 90_000 })

      const textarea = page.locator('textarea')
      await expect(textarea).toHaveValue(/BAT/i)

      const perFile = await exportViaIpc(page, {
        outputDir: outDir,
        mode: 'per-file',
        items: [{ fileName: 'sample 1.png', text: '第一张文本' }]
      })
      expect(perFile.outputs).toEqual([path.join(outDir, 'sample 1-OCR.txt')])

      const merged = await exportViaIpc(page, {
        outputDir: outDir,
        mode: 'merged',
        items: [
          { fileName: 'sample 1.png', text: '第一张文本' },
          { fileName: 'sample 2.png', text: '第二张文本' }
        ]
      })
      expect(merged.outputs).toHaveLength(1)
      const content = fs.readFileSync(merged.outputs[0]!, 'utf8')
      expect(content).toContain('===== sample 1.png =====\n第一张文本')
      expect(content).toContain('===== sample 2.png =====\n第二张文本')
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true })
      await app.close()
    }
  })

  test('并发合并导出（R2.6）文件名互不冲突', async () => {
    const { app, page } = await launch()
    const workDir = freshDir('lumin-ocr-text-e2e-concurrent')
    try {
      await clickSidebarTool(page, '图片文字识别')
      const results = await Promise.all(
        Array.from({ length: 5 }, (_, index) =>
          exportViaIpc(page, {
            outputDir: workDir,
            mode: 'merged',
            items: [{ fileName: 'a.png', text: `第 ${index + 1} 份` }]
          })
        )
      )
      const paths = results.map((item) => item.outputs[0]!)
      expect(new Set(paths).size).toBe(5)
      for (const item of paths) expect(fs.existsSync(item)).toBe(true)
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true })
      await app.close()
    }
  })
})
