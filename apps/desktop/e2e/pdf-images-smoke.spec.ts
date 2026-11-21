/**
 * @file pdf-images（PDF 图片转换）e2e 冒烟：真实 Electron + 真实 worker
 * @author cuilanchao
 * @date 2026-11-19
 * @description 覆盖：页面加载/空态、图片→PDF（中文+空格路径 R2.1）、PDF→图片（jpeg 魔数）、
 *              损坏/加密 PDF（R2.3）、越界页码、文件不存在、占用 PDF（R2.2）、长任务取消（R2.5）、
 *              100 页大文件（R2.4）、并发排队（R2.6）、输出目录不可写（R2.7）、强杀恢复（R2.8）。
 *              临时目录名必须 ASCII（本机 fs 对非 ASCII 目录名有硬崩先例），文件名保留中文。
 *              前置：pnpm -F @lumin/desktop build（playwright 启动 out/main/index.js）
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { inflateSync } from 'node:zlib'
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

/** 工具任务终态（done 值或结构化错误） */
interface TaskOutcome {
  done?: {
    outputs?: string[]
    output?: string
    pages?: number
    failures?: { file: string; code: string }[]
  }
  error?: { code: string; message: string }
}

const appDir = path.resolve(__dirname, '..')

async function launch(): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({ args: ['.'], cwd: appDir })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await page.waitForFunction(() => typeof window.lumin !== 'undefined')
  return { app, page }
}

/** 生成纯色 PNG（免入库 fixture） */
function writePng(file: string, width: number, height: number, color: string): void {
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = color
  ctx.fillRect(0, 0, width, height)
  fs.writeFileSync(file, canvas.toBuffer('image/png'))
}

/**
 * 提取 PDF 全部 MediaBox（pdf-lib 默认对象流压缩，需先解压 Flate 流再匹配）
 * @param buffer PDF 字节
 */
function mediaBoxes(buffer: Buffer): { width: number; height: number }[] {
  const texts: string[] = [buffer.toString('latin1')]
  const latin = buffer.toString('latin1')
  const streamRe = /(?<!d)stream\r?\n/g
  let match = streamRe.exec(latin)
  while (match !== null) {
    const start = match.index + match[0].length
    const end = latin.indexOf('endstream', start)
    if (end < 0) break
    try {
      texts.push(inflateSync(buffer.subarray(start, end)).toString('latin1'))
    } catch {
      // 非 Flate 流（图片/字体）忽略
    }
    streamRe.lastIndex = end + 9
    match = streamRe.exec(latin)
  }

  const boxRe = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/g
  const boxes: { width: number; height: number }[] = []
  for (const text of texts) {
    for (const box of text.matchAll(boxRe)) {
      boxes.push({ width: Number(box[1]), height: Number(box[2]) })
    }
  }
  return boxes
}

/** 提交三段式任务并等待终态（done / error），失败仅 reject 传输层错误 */
function runTask(page: Page, channel: string, payload: unknown): Promise<TaskOutcome> {
  return page.evaluate(
    ({ channel, payload }) =>
      new Promise<TaskOutcome>((resolve, reject) => {
        let taskId = ''
        const off = window.lumin.onTaskEvent((event) => {
          if (taskId !== '' && event.taskId !== taskId) return
          if (event.kind === 'progress') {
            return
          }
          if (event.kind === 'log') return
          off()
          if (event.kind === 'done') resolve({ done: event.result as TaskOutcome['done'] })
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

/** 单次同步 invoke 的拒绝码（断言结构化错误） */
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

/** 生成测试工作目录（ASCII 目录名） */
function freshDir(name: string): string {
  const dir = path.join(os.tmpdir(), name)
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

/** 用工具自身把一张 PNG 合成为单页 PDF（避免依赖 pdf-lib） */
async function makePdf(page: Page, dir: string, pngName: string): Promise<string> {
  const png = path.join(dir, pngName)
  writePng(png, 300, 200, '#22aa55')
  const outcome = await runTask(page, 'pdf-images:images-to-pdf', {
    inputPaths: [png],
    pageSize: 'auto',
    marginMm: 0,
    outputDir: dir
  })
  const output = outcome.done?.output
  if (output === undefined) throw new Error(`生成 PDF 失败：${JSON.stringify(outcome.error)}`)
  return output
}

/** PDF 标准密码填充串（ISO 32000-1 算法 2） */
const PDF_PAD = Buffer.from(
  '28bf4e5e4e758a4164004e56fffa01082e2e00b6d0683e802f0ca9fe6453697a',
  'hex'
)

/** RC4（PDF 40-bit 标准安全处理器用） */
function rc4(key: Buffer, data: Buffer): Buffer {
  const state = Array.from({ length: 256 }, (_, index) => index)
  let j = 0
  for (let i = 0; i < 256; i++) {
    const si = state[i] ?? 0
    j = (j + si + (key[i % key.length] ?? 0)) & 0xff
    const sj = state[j] ?? 0
    state[i] = sj
    state[j] = si
  }
  const output = Buffer.alloc(data.length)
  let i = 0
  j = 0
  for (let index = 0; index < data.length; index++) {
    i = (i + 1) & 0xff
    const si = state[i] ?? 0
    j = (j + si) & 0xff
    const sj = state[j] ?? 0
    state[i] = sj
    state[j] = si
    output[index] = (data[index] ?? 0) ^ (state[(si + sj) & 0xff] ?? 0)
  }
  return output
}

/** 密码补齐到 32 字节 */
function padPassword(password: Buffer): Buffer {
  return Buffer.concat([password, PDF_PAD]).subarray(0, 32)
}

/** 生成 RC4 40-bit 加密的单页 PDF（打开密码 = secret，用于 R2.3） */
function encryptedPdf(): Buffer {
  const user = padPassword(Buffer.from('secret'))
  const owner = padPassword(Buffer.from('owner'))
  const fileId = Buffer.from('00112233445566778899aabbccddeeff', 'hex')
  const permissions = Buffer.alloc(4)
  permissions.writeInt32LE(-4)

  const ownerKey = createHash('md5').update(owner).digest().subarray(0, 5)
  const ownerEntry = rc4(ownerKey, user)
  const encryptionKey = createHash('md5')
    .update(Buffer.concat([user, ownerEntry, permissions, fileId]))
    .digest()
    .subarray(0, 5)
  const userEntry = rc4(encryptionKey, PDF_PAD)
  const objectKey = (num: number): Buffer => {
    const ext = Buffer.alloc(5)
    ext.writeUIntLE(num, 0, 3)
    ext.writeUIntLE(0, 3, 2)
    return createHash('md5')
      .update(Buffer.concat([encryptionKey, ext]))
      .digest()
      .subarray(0, 10)
  }

  const content = rc4(objectKey(4), Buffer.from('0 0 200 200 re f\n', 'latin1'))
  const objects = [
    Buffer.from('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n', 'latin1'),
    Buffer.from('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n', 'latin1'),
    Buffer.from(
      '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >>\nendobj\n',
      'latin1'
    ),
    Buffer.concat([
      Buffer.from(`4 0 obj\n<< /Length ${content.length} >>\nstream\n`, 'latin1'),
      content,
      Buffer.from('\nendstream\nendobj\n', 'latin1')
    ]),
    Buffer.from(
      `5 0 obj\n<< /Filter /Standard /V 1 /R 2 /O <${ownerEntry.toString('hex')}> /U <${userEntry.toString('hex')}> /P -4 >>\nendobj\n`,
      'latin1'
    )
  ]

  const header = Buffer.from('%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n', 'latin1')
  const chunks: Buffer[] = [header]
  const offsets: number[] = []
  let cursor = header.length
  for (const [index, object] of objects.entries()) {
    offsets[index] = cursor
    chunks.push(object)
    cursor += object.length
  }
  const idHex = fileId.toString('hex')
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) xref += `${String(offset).padStart(10, '0')} 00000 n \n`
  xref +=
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Encrypt 5 0 R /ID [<${idHex}> <${idHex}>] >>\n` +
    `startxref\n${cursor}\n%%EOF\n`
  chunks.push(Buffer.from(xref, 'latin1'))
  return Buffer.concat(chunks)
}

test.describe('pdf-images（PDF 图片转换）冒烟', () => {
  test('页面加载 + 空态 + 默认输出目录 + 图片→PDF（R2.1 中文/空格路径）', async () => {
    const { app, page } = await launch()
    const workDir = freshDir('lumin-pi-e2e-happy')
    try {
      await clickSidebarTool(page, 'PDF 图片转换')
      await expect(page.getByRole('heading', { name: 'PDF 图片转换' })).toBeVisible()
      await expect(page.getByText('PDF 转图片', { exact: true })).toBeVisible()
      await expect(page.getByText('图片转 PDF', { exact: true })).toBeVisible()

      const config = await page.evaluate(() =>
        window.lumin.invoke<{ outputDir: string }>('pdf-images:config', {})
      )
      expect(config.outputDir.endsWith('pdf-images-output')).toBe(true)

      const first = path.join(workDir, '第一张 图.png')
      const second = path.join(workDir, '第二张.png')
      writePng(first, 400, 300, '#cc3333')
      writePng(second, 300, 400, '#3333cc')

      const outcome = await runTask(page, 'pdf-images:images-to-pdf', {
        inputPaths: [first, second],
        pageSize: 'a4',
        marginMm: 10,
        outputDir: workDir
      })
      const done = outcome.done
      expect(done).toBeDefined()
      expect(done?.pages).toBe(2)
      expect(done?.failures).toEqual([])
      expect(done?.output).toBe(path.join(workDir, '第一张 图_合并.pdf'))
      const output = done?.output ?? ''
      expect(fs.existsSync(output)).toBe(true)
      expect(fs.readFileSync(output).subarray(0, 5).toString('latin1')).toBe('%PDF-')

      const info = await page.evaluate(
        (inputPath: string) =>
          window.lumin.invoke<{ pageCount: number; fileName: string }>('pdf-images:pdf-info', {
            inputPath
          }),
        output
      )
      expect(info).toEqual({ pageCount: 2, fileName: '第一张 图_合并.pdf' })
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true })
      await app.close()
    }
  })

  test('PDF→图片（jpeg 魔数）+ 损坏 PDF + 越界页码 + 文件不存在（R2.3）', async () => {
    const { app, page } = await launch()
    const workDir = freshDir('lumin-pi-e2e-pdf')
    try {
      const pdf = await makePdf(page, workDir, '单页.png')
      const outDir = path.join(workDir, 'out')
      fs.mkdirSync(outDir, { recursive: true })

      const outcome = await runTask(page, 'pdf-images:pdf-to-images', {
        inputPath: pdf,
        ranges: '1',
        format: 'jpeg',
        dpi: 150,
        outputDir: outDir
      })
      expect(outcome.done?.pages).toBe(1)
      expect(outcome.done?.outputs).toEqual([path.join(outDir, '单页_合并_p1.jpg')])
      const image = fs.readFileSync(outcome.done?.outputs?.[0] ?? '')
      expect(image.subarray(0, 3).toString('hex')).toBe('ffd8ff')
      expect(image.length).toBeGreaterThan(1024)

      const corrupt = path.join(workDir, '损坏.pdf')
      fs.writeFileSync(corrupt, Buffer.from('not a pdf at all'))
      const corruptError = await invokeError(page, 'pdf-images:pdf-info', { inputPath: corrupt })
      expect(corruptError.code).toBe('PI_PDF_CORRUPT')

      const rangeError = await runTask(page, 'pdf-images:pdf-to-images', {
        inputPath: pdf,
        ranges: '9',
        format: 'png',
        dpi: 72,
        outputDir: outDir
      })
      expect(rangeError.error?.code).toBe('PI_RANGE_INVALID')

      const missingError = await invokeError(page, 'pdf-images:pdf-info', {
        inputPath: path.join(workDir, '不存在.pdf')
      })
      expect(missingError.code).toBe('PI_INPUT_INVALID')
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true })
      await app.close()
    }
  })

  test('占用 PDF（R2.2）+ 长任务取消（R2.5）', async () => {
    test.setTimeout(120_000)
    const { app, page } = await launch()
    const workDir = freshDir('lumin-pi-e2e-lock')
    let holder: ReturnType<typeof spawn> | null = null
    try {
      const pdf = await makePdf(page, workDir, '锁定源.png')
      const locked = path.join(workDir, '锁定.pdf')
      fs.copyFileSync(pdf, locked)

      const scriptPath = path.join(workDir, 'hold.ps1')
      fs.writeFileSync(
        scriptPath,
        "$fs = [System.IO.File]::Open($args[0], 'Open', 'ReadWrite', 'None')\n" +
          'Start-Sleep -Seconds 60\n' +
          '$fs.Close()\n'
      )
      holder = spawn('powershell.exe', ['-NoProfile', '-File', scriptPath, locked], {
        windowsHide: true
      })
      await new Promise((resolve) => setTimeout(resolve, 1500))

      const lockedError = await invokeError(page, 'pdf-images:pdf-info', { inputPath: locked })
      expect(lockedError.code).toBe('PI_PDF_LOCKED')

      // 取消：批量 120 张，首个 progress 后立即 cancel → CANCELLED
      const images: string[] = []
      for (let index = 0; index < 120; index++) {
        const file = path.join(workDir, `批量-${index}.png`)
        writePng(file, 1000, 1000, '#778899')
        images.push(file)
      }
      const cancelled = await page.evaluate(
        ({ inputPaths, outputDir }: { inputPaths: string[]; outputDir: string }) =>
          new Promise<{ code: string; progress: number; done: boolean }>((resolve, reject) => {
            let taskId = ''
            let cancelRequested = false
            let progress = 0
            const off = window.lumin.onTaskEvent((event) => {
              if (taskId !== '' && event.taskId !== taskId) return
              if (event.kind === 'progress') {
                progress += 1
                if (!cancelRequested) {
                  cancelRequested = true
                  void window.lumin.invoke<boolean>('lumin:task:cancel', { taskId })
                }
                return
              }
              if (event.kind === 'log') return
              off()
              if (event.kind === 'done') resolve({ code: 'DONE', progress, done: true })
              else resolve({ code: event.error.code, progress, done: false })
            })
            window.lumin
              .invoke<{ taskId: string }>('pdf-images:images-to-pdf', {
                inputPaths,
                pageSize: 'auto',
                marginMm: 0,
                outputDir
              })
              .then((result) => {
                taskId = result.taskId
              })
              .catch((err: unknown) => {
                off()
                reject(err instanceof Error ? err : new Error(String(err)))
              })
          }),
        { inputPaths: images, outputDir: workDir }
      )
      expect(cancelled.code).toBe('CANCELLED')
    } finally {
      holder?.kill()
      await new Promise((resolve) => setTimeout(resolve, 500))
      fs.rmSync(workDir, { recursive: true, force: true })
      await app.close()
    }
  })

  test('加密 PDF（R2.3）+ 100 页大文件（R2.4）+ 输出目录不可写（R2.7）', async () => {
    test.setTimeout(180_000)
    const { app, page } = await launch()
    const workDir = freshDir('lumin-pi-e2e-big')
    const denied = path.join(workDir, 'denied')
    const user = process.env.USERNAME ?? ''
    let aclApplied = false
    try {
      // R2.3 加密 PDF：RC4 40-bit，打开密码 secret → pdfjs PasswordException
      const encrypted = path.join(workDir, '加密.pdf')
      fs.writeFileSync(encrypted, encryptedPdf())
      const encryptedError = await invokeError(page, 'pdf-images:pdf-info', {
        inputPath: encrypted
      })
      expect(encryptedError.code).toBe('PI_PDF_ENCRYPTED')

      // R2.4 100 页 PDF：同一张 PNG 重复 100 页 → 全量渲染 100 张
      const png = path.join(workDir, '百页源.png')
      writePng(png, 600, 400, '#996633')
      const big = await runTask(page, 'pdf-images:images-to-pdf', {
        inputPaths: Array.from({ length: 100 }, () => png),
        pageSize: 'auto',
        marginMm: 0,
        outputDir: workDir
      })
      expect(big.done?.pages).toBe(100)
      const bigPdf = big.done?.output ?? ''
      expect(fs.statSync(bigPdf).size).toBeGreaterThan(0)
      const info = await page.evaluate(
        (inputPath: string) =>
          window.lumin.invoke<{ pageCount: number }>('pdf-images:pdf-info', { inputPath }),
        bigPdf
      )
      expect(info.pageCount).toBe(100)

      const outDir = path.join(workDir, '百页输出')
      const rendered = await runTask(page, 'pdf-images:pdf-to-images', {
        inputPath: bigPdf,
        ranges: '1-100',
        format: 'png',
        dpi: 72,
        outputDir: outDir
      })
      expect(rendered.done?.pages).toBe(100)
      expect(rendered.done?.outputs).toHaveLength(100)
      expect(rendered.done?.failures).toEqual([])
      for (const file of rendered.done?.outputs ?? []) expect(fs.existsSync(file)).toBe(true)

      // R2.7 输出目录 deny 写/删 ACL → 写盘 EACCES 归 PI_OUTPUT_DIR_INVALID
      fs.mkdirSync(denied, { recursive: true })
      execFileSync('icacls', [denied, '/deny', `${user}:(WD,AD)`], { windowsHide: true })
      aclApplied = true
      const writeError = await runTask(page, 'pdf-images:images-to-pdf', {
        inputPaths: [png],
        pageSize: 'auto',
        marginMm: 0,
        outputDir: denied
      })
      expect(writeError.error?.code).toBe('PI_OUTPUT_DIR_INVALID')
      expect(fs.readdirSync(denied)).toEqual([])
    } finally {
      if (aclApplied && user !== '') {
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

  test('并发排队（R2.6）+ 强杀恢复（R2.8）', async () => {
    test.setTimeout(180_000)
    const first = await launch()
    const workDir = freshDir('lumin-pi-e2e-crash')
    try {
      const png = path.join(workDir, '并发源.png')
      writePng(png, 400, 300, '#335577')
      const dirs = ['out-a', 'out-b', 'out-c'].map((name) => path.join(workDir, name))
      for (const dir of dirs) fs.mkdirSync(dir, { recursive: true })

      // R2.6 并发提交 3 个任务：超出并发上限的排队，全部完成
      const outcomes = await first.page.evaluate(
        ({ input, targets }: { input: string; targets: string[] }) =>
          new Promise<string[]>((resolve, reject) => {
            const state = new Map<number, string>()
            const indexByTask = new Map<string, number>()
            const off = window.lumin.onTaskEvent((event) => {
              const index = indexByTask.get(event.taskId)
              if (index === undefined) return
              if (event.kind === 'progress' || event.kind === 'log') return
              state.set(index, event.kind === 'done' ? 'done' : event.error.code)
              if (state.size === targets.length) {
                off()
                resolve([...state.values()])
              }
            })
            Promise.all(
              targets.map((outputDir, index) =>
                window.lumin
                  .invoke<{ taskId: string }>('pdf-images:images-to-pdf', {
                    inputPaths: [input],
                    pageSize: 'auto',
                    marginMm: 0,
                    outputDir
                  })
                  .then((result) => {
                    indexByTask.set(result.taskId, index)
                  })
              )
            ).catch((err: unknown) => {
              off()
              reject(err instanceof Error ? err : new Error(String(err)))
            })
          }),
        { input: png, targets: dirs }
      )
      expect(outcomes).toEqual(['done', 'done', 'done'])

      // R2.8 断电恢复：长任务执行中强杀进程树，重启后再次转换成功
      const many: string[] = []
      for (let index = 0; index < 100; index++) {
        const file = path.join(workDir, `崩溃-${index}.png`)
        writePng(file, 1000, 1000, '#445566')
        many.push(file)
      }
      const crashPid = first.app.process().pid
      const background = first.page.evaluate(
        ({ inputPaths, outputDir }: { inputPaths: string[]; outputDir: string }) =>
          new Promise<string>((resolve, reject) => {
            let taskId = ''
            const off = window.lumin.onTaskEvent((event) => {
              if (taskId !== '' && event.taskId !== taskId) return
              if (event.kind === 'progress') {
                if (taskId !== '') off()
                return
              }
              if (event.kind === 'log') return
              off()
              resolve(event.kind === 'done' ? 'done' : event.error.code)
            })
            window.lumin
              .invoke<{ taskId: string }>('pdf-images:images-to-pdf', {
                inputPaths,
                pageSize: 'auto',
                marginMm: 0,
                outputDir
              })
              .then((result) => {
                taskId = result.taskId
              })
              .catch((err: unknown) => {
                off()
                reject(err instanceof Error ? err : new Error(String(err)))
              })
          }),
        { inputPaths: many, outputDir: path.join(workDir, 'crash-out') }
      )
      // 等待首个 progress（worker 已在写盘）后强杀整棵进程树
      await new Promise((resolve) => setTimeout(resolve, 2000))
      if (crashPid !== undefined) {
        spawn('taskkill', ['/PID', String(crashPid), '/F', '/T'], { windowsHide: true })
      }
      // 页面已销毁：事件 Promise 不会再有终态，避免等待挂起
      void background.catch(() => undefined)
      await new Promise((resolve) => setTimeout(resolve, 1000))
      await first.app.close().catch(() => undefined)

      const second = await launch()
      try {
        const after = await runTask(second.page, 'pdf-images:images-to-pdf', {
          inputPaths: [png],
          pageSize: 'auto',
          marginMm: 0,
          outputDir: path.join(workDir, 'crash-out')
        })
        expect(after.done?.pages).toBe(1)
        const output = after.done?.output ?? ''
        expect(fs.existsSync(output)).toBe(true)
        expect(fs.readFileSync(output).subarray(0, 5).toString('latin1')).toBe('%PDF-')
        // 半成品不影响再次转换：最终目录只有完整结果（允许残留 .tmp，写入时覆盖）
        const leftovers = fs.readdirSync(path.join(workDir, 'crash-out'))
        expect(leftovers.some((name) => name.endsWith('.pdf'))).toBe(true)
      } finally {
        await second.app.close()
      }
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true })
      await first.app.close().catch(() => undefined)
    }
  })

  test('Letter 横版 + 边距预设 + 自定义文件名与冲突递增（M34）', async () => {
    const { app, page } = await launch()
    const workDir = freshDir('lumin-pi-e2e-layout')
    try {
      const first = path.join(workDir, '横图 一.png')
      const second = path.join(workDir, '竖图二.png')
      writePng(first, 800, 300, '#114477')
      writePng(second, 300, 800, '#774411')

      const payload = {
        inputPaths: [first, second],
        pageSize: 'letter',
        orientation: 'landscape',
        marginMm: 20,
        outputName: '自定义 名称',
        outputDir: workDir
      }
      const outcome = await runTask(page, 'pdf-images:images-to-pdf', payload)
      expect(outcome.done?.pages).toBe(2)
      expect(outcome.done?.failures).toEqual([])
      expect(outcome.done?.output).toBe(path.join(workDir, '自定义 名称.pdf'))

      const bytes = fs.readFileSync(outcome.done?.output ?? '')
      const boxes = mediaBoxes(bytes)
      expect(boxes).toHaveLength(2)
      for (const box of boxes) {
        expect(box.width).toBeCloseTo(792, 0)
        expect(box.height).toBeCloseTo(612, 0)
      }

      // 同名冲突自动递增，不覆盖既有产物
      const again = await runTask(page, 'pdf-images:images-to-pdf', payload)
      expect(again.done?.output).toBe(path.join(workDir, '自定义 名称 (1).pdf'))
      expect(fs.existsSync(path.join(workDir, '自定义 名称.pdf'))).toBe(true)
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true })
      await app.close()
    }
  })
})
