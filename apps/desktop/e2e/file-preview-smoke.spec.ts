/**
 * @file file-preview（文件预览）e2e 冒烟：真实 Electron + 真实主进程渲染
 * @author cuilanchao
 * @date 2026-11-22
 * @description 覆盖：空态、文本/Markdown/HTML/JSON/CSV、GBK/BOM/截断、图片 file://、
 *              PDF 翻页与释放、不支持/缺失/目录/损坏 PDF、占用（R2.2）、
 *              Office 类型判定与缺失预检；真实转换以 `LUMIN_E2E_SOFFICE=1` 门控。
 *              前置：pnpm -F @lumin/desktop build（playwright 启动 out/main/index.js）
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
import { holdExclusiveLock, type FileLockHandle } from './file-lock'
import { clickSidebarTool } from './sidebar'
import type { LuminBridge } from '@lumin/plugin-api'

declare global {
  interface Window {
    lumin: LuminBridge
  }
}

const appDir = path.resolve(__dirname, '..')
const officeFixture = path.resolve(
  __dirname,
  '../../../packages/tools/docx2pdf/fixtures/保真样例.docx'
)
/** Office 真实转换门控（CI 默认不装 LibreOffice） */
const SOFFICE_GATED = process.env.LUMIN_E2E_SOFFICE === '1'
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

interface InspectResult {
  previewId: string
  kind: string
  ext: string
  name: string
  size: number
  pageCount?: number
}

interface ReadTextResult {
  text: string
  encoding: string
  eol: string
  truncated: boolean
}

interface StatusResult {
  found: boolean
  path?: string
}

interface TaskOutcome {
  done?: unknown
  error?: { code: string; message: string }
}

async function launch(): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({ args: ['.'], cwd: appDir })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await page.waitForFunction(() => typeof window.lumin !== 'undefined')
  return { app, page }
}

/** 生成测试工作目录（ASCII 目录名） */
function freshDir(name: string): string {
  const dir = path.join(os.tmpdir(), name)
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

/** 生成纯色 PNG（免入库 fixture） */
function writePng(file: string, width: number, height: number, color: string): void {
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = color
  ctx.fillRect(0, 0, width, height)
  fs.writeFileSync(file, canvas.toBuffer('image/png'))
}

/** 同步通道 invoke */
function invoke<T>(page: Page, channel: string, payload: unknown): Promise<T> {
  return page.evaluate(
    ({ channel, payload }) =>
      window.lumin.invoke(channel, payload) as Promise<unknown>,
    { channel, payload }
  ) as Promise<T>
}

/** 同步通道错误码 */
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

/** 提交三段式任务并等待终态（done / error） */
function runTask(page: Page, channel: string, payload: unknown): Promise<TaskOutcome> {
  return page.evaluate(
    ({ channel, payload }) =>
      new Promise<TaskOutcome>((resolve, reject) => {
        let taskId = ''
        const off = window.lumin.onTaskEvent((event) => {
          if (taskId !== '' && event.taskId !== taskId) return
          if (event.kind === 'progress' || event.kind === 'log') return
          off()
          if (event.kind === 'done') resolve({ done: event.result })
          else resolve({ error: { code: event.error.code, message: event.error.message } })
        })
        window.lumin
          .invoke<{ taskId: string }>(channel, payload)
          .then((result) => {
            taskId = result.taskId
          })
          .catch((err: unknown) => {
            off()
            reject(err instanceof Error ? err : new Error(String(err)))
          })
      }),
    { channel, payload }
  )
}

/** 断言 PNG base64 合法 */
function expectPngBase64(png: string): void {
  const bytes = Buffer.from(png, 'base64')
  expect(bytes.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true)
}

/** 用 pdf-images 生成 N 页 PDF（返回产物绝对路径） */
async function makePdf(page: Page, dir: string, name: string, pages = 1): Promise<string> {
  const png = path.join(dir, `${name}.png`)
  writePng(png, 300, 200, '#22aa55')
  const outcome = await runTask(page, 'pdf-images:images-to-pdf', {
    inputPaths: Array.from({ length: pages }, () => png),
    pageSize: 'auto',
    marginMm: 0,
    outputDir: dir
  })
  const result = outcome.done as { outputPaths?: string[]; output?: string } | undefined
  const output = result?.outputPaths?.[0] ?? result?.output
  if (output === undefined) throw new Error(`生成 PDF 失败：${JSON.stringify(outcome.error)}`)
  const renamed = path.join(dir, `${name}.pdf`)
  if (output !== renamed) fs.renameSync(output, renamed)
  return renamed
}

test.describe('file-preview（文件预览）冒烟', () => {
  test('页面加载 + 空态 + 拖拽提示', async () => {
    const { app, page } = await launch()
    try {
      await clickSidebarTool(page, '文件预览')
      await expect(page.getByText('拖拽文件到此处，或点击选择')).toBeVisible()
      // 空态主操作：文件选择器 accept 覆盖文本与 Office
      const accept = await page
        .locator('input[type="file"]')
        .first()
        .getAttribute('accept')
      expect(accept ?? '').toContain('.md')
      expect(accept ?? '').toContain('.docx')
    } finally {
      await app.close()
    }
  })

  test('文本类：五格式 + GBK/BOM/截断（R2.1 中文/空格路径 + R2.2 占用）', async () => {
    const { app, page } = await launch()
    const workDir = freshDir('lumin-fp-e2e-text')
    const dir = path.join(workDir, '中文 目录')
    fs.mkdirSync(dir, { recursive: true })
    let lock: FileLockHandle | null = null
    try {
      const cases = [
        { name: '说明 文档.txt', kind: 'text', content: '第一行\r\n第二行\r\n', eol: '\r\n' },
        { name: '说明.md', kind: 'markdown', content: '# 标题\n\n正文\n', eol: '\n' },
        { name: '页面.html', kind: 'html', content: '<h1>你好</h1>\n', eol: '\n' },
        { name: '数据.json', kind: 'json', content: '{"a":1}\n', eol: '\n' },
        { name: '表格.csv', kind: 'csv', content: '名称,数量\n苹果,3\n', eol: '\n' }
      ] as const

      for (const item of cases) {
        const filePath = path.join(dir, item.name)
        fs.writeFileSync(filePath, item.content, 'utf8')
        const inspected = await invoke<InspectResult>(page, 'file-preview:inspect', {
          path: filePath
        })
        expect(inspected.kind).toBe(item.kind)
        expect(inspected.name).toBe(item.name)
        expect(inspected.size).toBe(Buffer.byteLength(item.content, 'utf8'))
        const read = await invoke<ReadTextResult>(page, 'file-preview:read-text', {
          path: filePath
        })
        expect(read.text).toBe(item.content)
        expect(read.encoding).toBe('utf8')
        expect(read.eol).toBe(item.eol)
        expect(read.truncated).toBe(false)
      }

      // GBK：非法 UTF-8 字节 → gbk 解码
      const gbkPath = path.join(dir, '国标.txt')
      fs.writeFileSync(gbkPath, Buffer.from([0xd6, 0xd0, 0xce, 0xc4, 0x0a]))
      const gbk = await invoke<ReadTextResult>(page, 'file-preview:read-text', { path: gbkPath })
      expect(gbk.encoding).toBe('gbk')
      expect(gbk.text).toBe('中文\n')

      // UTF-8 BOM：识别并剥离
      const bomPath = path.join(dir, '带BOM.txt')
      fs.writeFileSync(
        bomPath,
        Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('BOM 内容', 'utf8')])
      )
      const bom = await invoke<ReadTextResult>(page, 'file-preview:read-text', { path: bomPath })
      expect(bom.encoding).toBe('utf8-bom')
      expect(bom.text).toBe('BOM 内容')

      // 截断：maxBytes 上限生效
      const cutPath = path.join(dir, '截断.txt')
      fs.writeFileSync(cutPath, 'abcdefgh')
      const cut = await invoke<ReadTextResult>(page, 'file-preview:read-text', {
        path: cutPath,
        maxBytes: 4
      })
      expect(cut.text).toBe('abcd')
      expect(cut.truncated).toBe(true)

      // 不支持 / 缺失 / 目录
      const binPath = path.join(dir, '未知.bin')
      fs.writeFileSync(binPath, 'x')
      expect((await invokeError(page, 'file-preview:inspect', { path: binPath })).code).toBe(
        'FP_UNSUPPORTED'
      )
      expect(
        (await invokeError(page, 'file-preview:inspect', { path: path.join(dir, '缺失.txt') }))
          .code
      ).toBe('FP_NOT_FOUND')
      const fakeDir = path.join(dir, '伪装目录.txt')
      fs.mkdirSync(fakeDir)
      expect((await invokeError(page, 'file-preview:inspect', { path: fakeDir })).code).toBe(
        'FP_INVALID_PATH'
      )
      // 无扩展名目录：类型判定先于 stat → FP_UNSUPPORTED
      expect((await invokeError(page, 'file-preview:inspect', { path: dir })).code).toBe(
        'FP_UNSUPPORTED'
      )

      // R2.2 占用：独占句柄 → FP_LOCKED
      const lockedPath = path.join(dir, '占用.txt')
      fs.writeFileSync(lockedPath, '被占用')
      lock = await holdExclusiveLock(lockedPath)
      if (lock.acquired) {
        expect(
          (await invokeError(page, 'file-preview:read-text', { path: lockedPath })).code
        ).toBe('FP_LOCKED')
      }
    } finally {
      lock?.release()
      await new Promise((resolve) => setTimeout(resolve, 300))
      fs.rmSync(workDir, { recursive: true, force: true })
      await app.close()
    }
  })

  test('图片：inspect + asset-url（file://）', async () => {
    const { app, page } = await launch()
    const workDir = freshDir('lumin-fp-e2e-image')
    try {
      const png = path.join(workDir, '图片 样张.png')
      writePng(png, 120, 80, '#3377cc')
      const inspected = await invoke<InspectResult>(page, 'file-preview:inspect', { path: png })
      expect(inspected.kind).toBe('image')
      expect(inspected.name).toBe('图片 样张.png')
      const asset = await invoke<{ url: string }>(page, 'file-preview:asset-url', { path: png })
      expect(asset.url.startsWith('file:///')).toBe(true)
      expect(decodeURIComponent(asset.url).endsWith('图片 样张.png')).toBe(true)
      // 非图片 → FP_UNSUPPORTED
      const txt = path.join(workDir, '说明.txt')
      fs.writeFileSync(txt, 'x')
      expect((await invokeError(page, 'file-preview:asset-url', { path: txt })).code).toBe(
        'FP_UNSUPPORTED'
      )
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true })
      await app.close()
    }
  })

  test('PDF：页数/翻页渲染/越界/释放/损坏', async () => {
    const { app, page } = await launch()
    const workDir = freshDir('lumin-fp-e2e-pdf')
    try {
      const pdfPath = await makePdf(page, workDir, '两页 文档', 2)
      const inspected = await invoke<InspectResult>(page, 'file-preview:inspect', { path: pdfPath })
      expect(inspected.kind).toBe('pdf')
      expect(inspected.pageCount).toBe(2)

      const first = await invoke<{ png: string; width: number; height: number }>(
        page,
        'file-preview:render-pdf-page',
        { previewId: inspected.previewId, page: 1, scale: 1 }
      )
      expect(first.width).toBeGreaterThan(0)
      expect(first.height).toBeGreaterThan(0)
      expectPngBase64(first.png)

      const second = await invoke<{ png: string }>(page, 'file-preview:render-pdf-page', {
        previewId: inspected.previewId,
        page: 2
      })
      expectPngBase64(second.png)

      expect(
        (
          await invokeError(page, 'file-preview:render-pdf-page', {
            previewId: inspected.previewId,
            page: 3
          })
        ).code
      ).toBe('FP_PDF_RENDER_FAILED')

      const released = await invoke<{ released: boolean }>(page, 'file-preview:release-preview', {
        previewId: inspected.previewId
      })
      expect(released.released).toBe(true)
      const again = await invoke<{ released: boolean }>(page, 'file-preview:release-preview', {
        previewId: inspected.previewId
      })
      expect(again.released).toBe(false)
      expect(
        (
          await invokeError(page, 'file-preview:render-pdf-page', {
            previewId: inspected.previewId,
            page: 1
          })
        ).code
      ).toBe('FP_PDF_RENDER_FAILED')

      // 损坏 PDF → FP_READ_FAILED
      const broken = path.join(workDir, '损坏.pdf')
      fs.writeFileSync(broken, Buffer.from('not a pdf'))
      expect((await invokeError(page, 'file-preview:inspect', { path: broken })).code).toBe(
        'FP_READ_FAILED'
      )
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true })
      await app.close()
    }
  })

  test('Office：类型判定 + 缺失预检 + 非 Office 拒绝', async () => {
    test.setTimeout(180_000)
    const { app, page } = await launch()
    const workDir = freshDir('lumin-fp-e2e-office')
    try {
      const docx = path.join(workDir, '演示 文档.docx')
      fs.copyFileSync(officeFixture, docx)
      const inspected = await invoke<InspectResult>(page, 'file-preview:inspect', { path: docx })
      expect(inspected.kind).toBe('office')
      expect(inspected.pageCount).toBeUndefined()

      // 缺失文件：预检先于 soffice 检测 → FP_NOT_FOUND
      const missing = await runTask(page, 'file-preview:convert-office', {
        path: path.join(workDir, '缺失.docx')
      })
      expect(missing.error?.code).toBe('FP_NOT_FOUND')

      // 非 Office：任务入参即拒绝
      const txt = path.join(workDir, '说明.txt')
      fs.writeFileSync(txt, 'x')
      const notOffice = await runTask(page, 'file-preview:convert-office', { path: txt })
      expect(notOffice.error?.code).toBe('FP_UNSUPPORTED')

      // 状态形状始终可用
      const status = await invoke<StatusResult>(page, 'file-preview:soffice-status', {})
      expect(typeof status.found).toBe('boolean')
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true })
      await app.close()
    }
  })

  test('Office 真实转换（LUMIN_E2E_SOFFICE=1 门控）', async () => {
    test.setTimeout(180_000)
    test.skip(!SOFFICE_GATED, '未设置 LUMIN_E2E_SOFFICE=1（Office 真实转换门控）')
    const { app, page } = await launch()
    const workDir = freshDir('lumin-fp-e2e-office-convert')
    try {
      const status = await invoke<StatusResult>(page, 'file-preview:soffice-status', {})
      test.skip(!status.found, '本机无 LibreOffice（注册表/便携/自定义三级均未命中）')

      const docx = path.join(workDir, '演示 文档.docx')
      fs.copyFileSync(officeFixture, docx)
      const converted = await runTask(page, 'file-preview:convert-office', { path: docx })
      const result = converted.done as { previewId?: string; pageCount?: number } | undefined
      expect(result?.pageCount ?? 0).toBeGreaterThan(0)
      const previewId = result?.previewId ?? ''
      expect(previewId).not.toBe('')
      const rendered = await invoke<{ png: string }>(page, 'file-preview:render-pdf-page', {
        previewId,
        page: 1
      })
      expectPngBase64(rendered.png)
      const released = await invoke<{ released: boolean }>(page, 'file-preview:release-preview', {
        previewId
      })
      expect(released.released).toBe(true)
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true })
      await app.close()
    }
  })
})
