/**
 * @file ocr-text（图片文字识别）e2e 冒烟：真实 Electron + 真实 PP-OCR
 * @author cuilanchao
 * @date 2026-11-21
 * @description M49 双模式：单张自动识别 / 批量识别；M64 增 PDF 多页输入。覆盖页面加载与空态、类型不符、
 *              损坏图（R2.3）、空白图（OCR_NO_TEXT）、超大图（R2.4）、批量中单张失败不中断、编辑后逐张/合并导出
 *              （R2.1 中文+空格目录）、重名递增与并发（R2.6）、PDF 多页分段识别。原生目录选择框不可自动化，
 *              导出走 IPC 契约。前置：pnpm -F @lumin/desktop build；binaries/ocr 模型齐全（缺失时真实推理用例 skip）。
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

/**
 * 合成多页 PDF（每页为一张白底黑字 JPEG，DCTDecode 内嵌），用于 PDF 输入用例。
 * @param file 输出 PDF 路径
 * @param texts 每页文字
 */
function writeTextPdf(file: string, texts: string[]): void {
  const images = texts.map((text) => {
    const canvas = createCanvas(1000, 320)
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, 1000, 320)
    ctx.fillStyle = '#000000'
    ctx.font = 'bold 96px Arial'
    ctx.fillText(text, 40, 190)
    return canvas.toBuffer('image/jpeg', 90)
  })

  const chunks: Buffer[] = []
  const offsets: number[] = []
  let length = 0
  const push = (part: Buffer | string): void => {
    const buf = typeof part === 'string' ? Buffer.from(part, 'latin1') : part
    chunks.push(buf)
    length += buf.length
  }
  const beginObject = (num: number): void => {
    offsets[num] = length
    push(`${num} 0 obj\n`)
  }

  push('%PDF-1.4\n')
  beginObject(1)
  push('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n')
  const kids = texts.map((_, index) => `${3 + 3 * index} 0 R`).join(' ')
  beginObject(2)
  push(`<< /Type /Pages /Kids [${kids}] /Count ${texts.length} >>\nendobj\n`)
  for (let index = 0; index < texts.length; index += 1) {
    const pageNum = 3 + 3 * index
    const contentNum = pageNum + 1
    const imageNum = pageNum + 2
    const image = images[index]!
    beginObject(pageNum)
    push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im0 ${imageNum} 0 R >> >> /Contents ${contentNum} 0 R >>\nendobj\n`
    )
    beginObject(contentNum)
    push('<< >>\nstream\nq 595 0 0 842 0 0 cm /Im0 Do Q\nendstream\nendobj\n')
    beginObject(imageNum)
    push(
      `<< /Type /XObject /Subtype /Image /Width 1000 /Height 320 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.length} >>\nstream\n`
    )
    push(image)
    push('\nendstream\nendobj\n')
  }

  const xrefStart = length
  const count = 2 + 3 * texts.length
  let xref = `xref\n0 ${count + 1}\n0000000000 65535 f \n`
  for (let num = 1; num <= count; num += 1) {
    xref += `${String(offsets[num]!).padStart(10, '0')} 00000 n \n`
  }
  push(xref)
  push(`trailer\n<< /Size ${count + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`)
  fs.writeFileSync(file, Buffer.concat(chunks))
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
      const txt = path.join(workDir, 'not-image.txt')
      fs.writeFileSync(txt, 'x')
      const broken = path.join(workDir, 'broken.png')
      fs.writeFileSync(broken, Buffer.from('this is not an image'))
      const big = path.join(workDir, 'big.png')
      fs.writeFileSync(big, Buffer.alloc(21 * 1024 * 1024))

      await clickSidebarTool(page, '图片文字识别')
      await expect(page.getByRole('heading', { name: '图片文字识别' })).toBeVisible()
      await expect(page.getByRole('radio', { name: '单张识别' })).toBeVisible()
      await expect(page.getByRole('radio', { name: '批量识别' })).toBeVisible()
      await expect(page.getByText('拖拽或点击选择一个文件（图片 / PDF）')).toBeVisible()

      await page.setInputFiles('input[type="file"]', txt)
      await expect(page.getByText('不支持的文件类型：not-image.txt')).toBeVisible()

      // 单张模式：选择后自动识别，损坏图 → OCR_INPUT_INVALID
      await page.setInputFiles('input[type="file"]', broken)
      await expect(page.getByText('文件无法读取，请换一张清晰的图片')).toBeVisible({
        timeout: 30_000
      })
      await expect(page.getByText('OCR_INPUT_INVALID')).toBeVisible()

      // 单张模式：超大图预检失败
      await page.getByRole('button', { name: '重新选择' }).click()
      await page.setInputFiles('input[type="file"]', big)
      await expect(page.getByText('文件超过 20MB，请压缩后重试')).toBeVisible({ timeout: 15_000 })

      // 批量模式空态
      await page.locator('.n-radio__label', { hasText: '批量识别' }).click()
      await expect(page.getByText('拖拽或点击添加文件（可多选）')).toBeVisible()
      await expect(page.getByText('列表为空：添加文件后点击「开始识别」。')).toBeVisible()
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
      await expect(page.getByText('识别完成：1 个文件全部成功')).toBeVisible({ timeout: 60_000 })
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
      await expect(page.getByText('识别完成：1 个文件成功，1 个失败')).toBeVisible({
        timeout: 90_000
      })

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

  test('PDF 多页输入 → 逐页分段识别与页数展示（M64）', async () => {
    test.skip(!modelsReady, 'binaries/ocr 模型缺失，跳过真实推理用例')
    const { app, page } = await launch()
    const workDir = freshDir('lumin-ocr-text-e2e-pdf')
    try {
      const pdf = path.join(workDir, 'two pages.pdf')
      writeTextPdf(pdf, ['PDF PAGE ONE', 'PDF PAGE TWO'])

      await clickSidebarTool(page, '图片文字识别')
      await page.setInputFiles('input[type="file"]', pdf)

      const textarea = page.locator('textarea')
      await expect(textarea).toBeVisible({ timeout: 120_000 })
      await expect(page.getByText('识别完成：1 个文件全部成功')).toBeVisible({ timeout: 120_000 })

      const value = await textarea.inputValue()
      expect(value).toContain('===== 第 1 页 =====')
      expect(value).toContain('===== 第 2 页 =====')
      expect(value).toMatch(/PDF/i)
      await expect(page.getByText(/2 页 ·\s*\d+×\d+ 像素/)).toBeVisible()
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
