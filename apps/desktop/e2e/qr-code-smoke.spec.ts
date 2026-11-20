/**
 * @file qr-code（二维码工具）e2e 冒烟：真实 Electron + 真实 renderer 解码
 * @author cuilanchao
 * @date 2026-11-19
 * @description 覆盖：页面加载/空态/两 Tab（R2.1 中文+空格路径）、生成预览与 PNG/SVG 保存、
 *              重名递增与目录记忆、识别闭环（含损坏图 R2.3、空白图）、尺寸/颜色边界、
 *              超大图（R2.4）、输出目录不可写（R2.7）、并发保存（R2.6）。
 *              前置：pnpm -F @lumin/desktop build（playwright 启动 out/main/index.js）
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import QRCode from 'qrcode'
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

/** 1×1 透明 PNG（base64） */
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

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

/** 预置输出目录（工具页挂载时 config 回填） */
async function setOutputDir(page: Page, outputDir: string): Promise<void> {
  await page.evaluate(
    (dir: string) => window.lumin.invoke('qr-code:set-output-dir', { outputDir: dir }),
    outputDir
  )
}

/** 直接走 save 通道（绕过 UI，测写盘契约） */
function saveViaIpc(
  page: Page,
  payload: { outputDir: string; baseName: string; format: 'png' | 'svg'; data: string }
): Promise<{ output: string }> {
  return page.evaluate(
    (input: { outputDir: string; baseName: string; format: 'png' | 'svg'; data: string }) =>
      window.lumin.invoke<{ output: string }>('qr-code:save', input),
    payload
  )
}

/** 同步 invoke 的拒绝码 */
async function invokeError(
  page: Page,
  channel: string,
  payload: unknown
): Promise<{ code: string; message: string }> {
  return page.evaluate(
    ({ channel, payload }) =>
      window.lumin
        .invoke(channel, payload)
        .then(() => ({ code: 'UNEXPECTED_SUCCESS', message: '' }))
        .catch((err: unknown) => {
          const structured = err as { code?: string; message?: string }
          return {
            code: structured.code ?? 'UNKNOWN',
            message: structured.message ?? String(err)
          }
        }),
    { channel, payload }
  )
}

/** 断言 PNG 文件存在且签名正确 */
function expectPng(file: string): void {
  expect(fs.existsSync(file)).toBe(true)
  expect(fs.readFileSync(file).subarray(0, 8).toString('latin1')).toBe('\x89PNG\r\n\x1a\n')
}

/** 生成空白 PNG（用于「未识别到二维码」分支） */
function writeBlankPng(file: string): void {
  const canvas = createCanvas(300, 300)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, 300, 300)
  fs.writeFileSync(file, canvas.toBuffer('image/png'))
}

test.describe('qr-code（二维码工具）冒烟', () => {
  test('页面加载 + 空态 + 两 Tab + 生成预览与保存（R2.1 中文/空格路径）', async () => {
    const { app, page } = await launch()
    const workDir = freshDir('lumin-qr-e2e-happy')
    const outDir = path.join(workDir, '中文 目录')
    try {
      await setOutputDir(page, outDir)
      await clickSidebarTool(page, '二维码工具')
      await expect(page.getByRole('heading', { name: '二维码工具' })).toBeVisible()
      await expect(page.getByText('生成', { exact: true })).toBeVisible()
      await expect(page.getByText('识别', { exact: true })).toBeVisible()
      await expect(page.getByText('输入内容后自动预览')).toBeVisible()

      await page.getByPlaceholder('输入要生成二维码的文本（最多 2000 字）').fill('hello e2e')
      await expect(page.getByAltText('二维码预览')).toBeVisible()

      await page.getByPlaceholder('qrcode').fill('二维码 测试')
      await page.getByRole('button', { name: '保存到文件' }).click()

      const output = path.join(outDir, '二维码 测试.png')
      await expect(page.getByText(output)).toBeVisible()
      expectPng(output)
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true })
      await app.close()
    }
  })

  test('识别闭环：真实二维码 / 损坏图（R2.3）/ 空白图', async () => {
    const { app, page } = await launch()
    const workDir = freshDir('lumin-qr-e2e-decode')
    try {
      const qrPng = path.join(workDir, 'hello.png')
      await QRCode.toFile(qrPng, 'https://example.com/你好 世界', { width: 400, margin: 4 })
      const broken = path.join(workDir, 'broken.png')
      fs.writeFileSync(broken, Buffer.from('this is not an image'))
      const blank = path.join(workDir, 'blank.png')
      writeBlankPng(blank)

      await clickSidebarTool(page, '二维码工具')
      await page.getByText('识别', { exact: true }).click()
      await expect(page.getByText('拖拽或选择一张包含二维码的图片')).toBeVisible()

      await page.setInputFiles('input[type="file"]', qrPng)
      await expect(page.locator('textarea[readonly]')).toHaveValue(
        'https://example.com/你好 世界'
      )

      await page.setInputFiles('input[type="file"]', broken)
      await expect(page.getByText('图片无法读取，可能已损坏或格式不支持')).toBeVisible()

      await page.setInputFiles('input[type="file"]', blank)
      await expect(page.getByText('未识别到二维码，请换更清晰、完整的图片')).toBeVisible()
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true })
      await app.close()
    }
  })

  test('边界与参数：空内容禁用 / 尺寸钳制 / 非法颜色 / SVG 保存', async () => {
    const { app, page } = await launch()
    const workDir = freshDir('lumin-qr-e2e-bounds')
    try {
      await setOutputDir(page, workDir)
      await clickSidebarTool(page, '二维码工具')

      const saveButton = page.getByRole('button', { name: '保存到文件' })
      await expect(saveButton).toBeDisabled()

      const sizeInput = page.locator('.n-input-number input').first()
      await sizeInput.fill('100')
      await sizeInput.blur()
      await expect(sizeInput).toHaveValue('128')

      await page.getByPlaceholder('#000000').fill('#zzzzzz')
      await expect(page.getByText('颜色须为 #RRGGBB 格式')).toBeVisible()
      await page.getByPlaceholder('#000000').fill('#000000')

      await page.getByPlaceholder('输入要生成二维码的文本（最多 2000 字）').fill('svg case')
      await page.getByText('SVG', { exact: true }).click()
      await page.getByPlaceholder('qrcode').fill('vector')
      await saveButton.click()

      const svgPath = path.join(workDir, 'vector.svg')
      await expect(page.getByText(svgPath)).toBeVisible()
      expect(fs.readFileSync(svgPath, 'utf8')).toContain('<svg')
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true })
      await app.close()
    }
  })

  test('目录记忆 + 重名递增 + 并发保存（R2.6）', async () => {
    const { app, page } = await launch()
    const workDir = freshDir('lumin-qr-e2e-conflict')
    try {
      await setOutputDir(page, workDir)
      const payload = {
        outputDir: workDir,
        baseName: 'same',
        format: 'png' as const,
        data: PNG_BASE64
      }
      const first = await saveViaIpc(page, payload)
      const second = await saveViaIpc(page, payload)
      expect(first.output).toBe(path.join(workDir, 'same.png'))
      expect(second.output).toBe(path.join(workDir, 'same(1).png'))

      const parallel = await Promise.all(
        Array.from({ length: 5 }, () => saveViaIpc(page, { ...payload, baseName: 'batch' }))
      )
      expect(new Set(parallel.map((item) => item.output)).size).toBe(5)
      for (const item of parallel) expectPng(item.output)

      await page.reload()
      await page.waitForFunction(() => typeof window.lumin !== 'undefined')
      const remembered = await page.evaluate(() =>
        window.lumin.invoke<{ outputDir: string }>('qr-code:config', {})
      )
      expect(remembered.outputDir).toBe(workDir)
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true })
      await app.close()
    }
  })

  test('输出目录不可写（R2.7）+ 超大图（R2.4）', async () => {
    const { app, page } = await launch()
    const workDir = freshDir('lumin-qr-e2e-acl')
    const denied = path.join(workDir, 'denied')
    const user = process.env.USERNAME ?? ''
    let aclApplied = false
    try {
      fs.mkdirSync(denied, { recursive: true })
      execFileSync('icacls', [denied, '/deny', `${user}:(WD,AD)`], { windowsHide: true })
      aclApplied = true
      const writeError = await invokeError(page, 'qr-code:save', {
        outputDir: denied,
        baseName: 'x',
        format: 'png',
        data: PNG_BASE64
      })
      expect(writeError.code).toBe('QR_OUTPUT_WRITE_FAILED')
      execFileSync('icacls', [denied, '/remove:d', user], { windowsHide: true })
      aclApplied = false

      const big = path.join(workDir, 'big.png')
      fs.writeFileSync(big, Buffer.alloc(21 * 1024 * 1024))
      await clickSidebarTool(page, '二维码工具')
      await page.getByText('识别', { exact: true }).click()
      await page.setInputFiles('input[type="file"]', big)
      await expect(page.getByText('图片超过 20MB，请压缩后重试')).toBeVisible()
    } finally {
      if (aclApplied) {
        try {
          execFileSync('icacls', [denied, '/remove:d', user], { windowsHide: true })
        } catch {
          // 目录已删/ACL 已失效时忽略
        }
      }
      fs.rmSync(workDir, { recursive: true, force: true })
      await app.close()
    }
  })
})
