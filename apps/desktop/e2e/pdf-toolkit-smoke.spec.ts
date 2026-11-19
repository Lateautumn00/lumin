/**
 * @file pdf-toolkit（PDF 工具集）e2e 冒烟：真实 Electron + 真实 worker
 * @author cuilanchao
 * @date 2026-11-19
 * @description 覆盖：页面加载/空态/六 Tab、合并（中文+空格路径 R2.1）、拆分/删页/越界、
 *              旋转/重排/元数据、损坏/不存在、占用（R2.2）、取消（R2.5）、并发（R2.6）、
 *              源目录不可写（R2.7）、强杀恢复（R2.8）。
 *              样本 PDF 由同仓 pdf-images 工具生成（e2e 专用，不引入运行期依赖）。
 *              前置：pnpm -F @lumin/desktop build（playwright 启动 out/main/index.js）
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, execFileSync } from 'node:child_process'
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

/** 工具任务终态 */
interface TaskOutcome {
  done?: { outputPaths?: string[]; output?: string }
  error?: { code: string; message: string }
}

/** info 回包（与 schema.ts InfoResult 对齐） */
interface InfoOutcome {
  pageCount: number
  fileName: string
  metadata: {
    title: string
    author: string
    subject: string
    keywords: string
    creator: string
    producer: string
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

/** 生成纯色 PNG（免入库 fixture） */
function writePng(file: string, width: number, height: number, color: string): void {
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = color
  ctx.fillRect(0, 0, width, height)
  fs.writeFileSync(file, canvas.toBuffer('image/png'))
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

/** 读取 info（页数/元数据） */
function infoOf(page: Page, inputPath: string): Promise<InfoOutcome> {
  return page.evaluate(
    (path: string) => window.lumin.invoke<InfoOutcome>('pdf-toolkit:info', { inputPath: path }),
    inputPath
  )
}

/** 生成测试工作目录（ASCII 目录名） */
function freshDir(name: string): string {
  const dir = path.join(os.tmpdir(), name)
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  return dir
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
  const output = outcome.done?.outputPaths?.[0] ?? outcome.done?.output
  if (output === undefined) throw new Error(`生成 PDF 失败：${JSON.stringify(outcome.error)}`)
  // pdf-images 产物名为 `{png 基名}_合并.pdf`，改回期望基名，避免与后续操作命名叠加
  const renamed = path.join(dir, `${name}.pdf`)
  if (output !== renamed) fs.renameSync(output, renamed)
  return renamed
}

/** 断言产物存在且为 PDF */
function expectPdf(file: string): void {
  expect(fs.existsSync(file)).toBe(true)
  expect(fs.readFileSync(file).subarray(0, 5).toString('latin1')).toBe('%PDF-')
}

test.describe('pdf-toolkit（PDF 工具集）冒烟', () => {
  test('页面加载 + 空态 + 六 Tab + 合并（R2.1 中文/空格路径）', async () => {
    const { app, page } = await launch()
    const workDir = freshDir('lumin-pt-e2e-happy')
    try {
      await page.getByRole('link', { name: 'PDF 工具集' }).click()
      await expect(page.getByRole('heading', { name: 'PDF 工具集' })).toBeVisible()
      for (const tab of ['合并', '拆分', '删页', '旋转', '重排', '元数据']) {
        await expect(page.getByText(tab, { exact: true }).first()).toBeVisible()
      }
      await expect(page.getByText('添加至少 2 个 PDF 开始合并')).toBeVisible()

      const first = await makePdf(page, workDir, '第一份 卷', 2)
      const second = await makePdf(page, workDir, '第二份', 1)
      const third = await makePdf(page, workDir, '第三份', 3)

      const outcome = await runTask(page, 'pdf-toolkit:merge', {
        inputPaths: [first, second, third]
      })
      const output = outcome.done?.outputPaths?.[0] ?? ''
      expect(output).toBe(path.join(workDir, '第一份 卷_合并.pdf'))
      expectPdf(output)
      expect((await infoOf(page, output)).pageCount).toBe(6)
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true })
      await app.close()
    }
  })

  test('拆分 / 删页 / 越界与删光（R2.3 边界）', async () => {
    const { app, page } = await launch()
    const workDir = freshDir('lumin-pt-e2e-split')
    try {
      const input = await makePdf(page, workDir, '五页卷', 5)

      const split = await runTask(page, 'pdf-toolkit:split', {
        inputPath: input,
        ranges: '1-2,4-5'
      })
      expect(split.done?.outputPaths).toEqual([
        path.join(workDir, '五页卷_p1-2.pdf'),
        path.join(workDir, '五页卷_p4-5.pdf')
      ])
      for (const file of split.done?.outputPaths ?? []) expectPdf(file)
      expect((await infoOf(page, split.done?.outputPaths?.[0] ?? '')).pageCount).toBe(2)

      const overflow = await runTask(page, 'pdf-toolkit:split', {
        inputPath: input,
        ranges: '1-9'
      })
      expect(overflow.error?.code).toBe('PT_RANGE_INVALID')

      const removed = await runTask(page, 'pdf-toolkit:delete', { inputPath: input, ranges: '2,4' })
      const removedFile = removed.done?.outputPaths?.[0] ?? ''
      expect(removedFile).toBe(path.join(workDir, '五页卷_删p2,4.pdf'))
      expect((await infoOf(page, removedFile)).pageCount).toBe(3)

      const all = await runTask(page, 'pdf-toolkit:delete', { inputPath: input, ranges: '1-5' })
      expect(all.error?.code).toBe('PT_NO_PAGES_LEFT')
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true })
      await app.close()
    }
  })

  test('旋转 / 重排 / 元数据 / 损坏与不存在（R2.3）', async () => {
    const { app, page } = await launch()
    const workDir = freshDir('lumin-pt-e2e-ops')
    try {
      const input = await makePdf(page, workDir, '三页卷', 3)

      const rotated = await runTask(page, 'pdf-toolkit:rotate', {
        inputPath: input,
        ranges: '2',
        degrees: 90
      })
      const rotatedFile = rotated.done?.outputPaths?.[0] ?? ''
      expect(rotatedFile).toBe(path.join(workDir, '三页卷_旋转90.pdf'))
      expectPdf(rotatedFile)
      expect((await infoOf(page, rotatedFile)).pageCount).toBe(3)

      const reordered = await runTask(page, 'pdf-toolkit:reorder', {
        inputPath: input,
        order: [3, 1, 2]
      })
      const reorderedFile = reordered.done?.outputPaths?.[0] ?? ''
      expect(reorderedFile).toBe(path.join(workDir, '三页卷_重排.pdf'))
      expect((await infoOf(page, reorderedFile)).pageCount).toBe(3)

      const badOrder = await runTask(page, 'pdf-toolkit:reorder', {
        inputPath: input,
        order: [1, 1, 2]
      })
      expect(badOrder.error?.code).toBe('PT_ORDER_INVALID')

      const meta = await runTask(page, 'pdf-toolkit:metadata', {
        inputPath: input,
        metadata: { title: '期末 试卷', author: '教研组', subject: '数学', keywords: '期末,数学' }
      })
      const metaFile = meta.done?.outputPaths?.[0] ?? ''
      expect(metaFile).toBe(path.join(workDir, '三页卷_元数据.pdf'))
      const metaInfo = await infoOf(page, metaFile)
      expect(metaInfo.metadata.title).toBe('期末 试卷')
      expect(metaInfo.metadata.author).toBe('教研组')
      expect(metaInfo.metadata.keywords).toBe('期末,数学')

      const emptyMeta = await runTask(page, 'pdf-toolkit:metadata', {
        inputPath: input,
        metadata: {}
      })
      expect(emptyMeta.error?.code).toBe('INVALID_PAYLOAD')

      const corrupt = path.join(workDir, '损坏.pdf')
      fs.writeFileSync(corrupt, Buffer.from('not a pdf'))
      expect((await invokeError(page, 'pdf-toolkit:info', { inputPath: corrupt })).code).toBe(
        'PT_PDF_CORRUPT'
      )
      expect(
        (await invokeError(page, 'pdf-toolkit:info', { inputPath: path.join(workDir, '缺失.pdf') }))
          .code
      ).toBe('PT_INPUT_INVALID')
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true })
      await app.close()
    }
  })

  test('占用 PDF（R2.2）', async () => {
    test.setTimeout(120_000)
    const { app, page } = await launch()
    const workDir = freshDir('lumin-pt-e2e-lock')
    let holder: ReturnType<typeof spawn> | null = null
    try {
      const input = await makePdf(page, workDir, '待锁卷', 1)
      const locked = path.join(workDir, '锁定.pdf')
      fs.copyFileSync(input, locked)

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

      expect((await invokeError(page, 'pdf-toolkit:info', { inputPath: locked })).code).toBe(
        'PT_PDF_LOCKED'
      )
    } finally {
      holder?.kill()
      await new Promise((resolve) => setTimeout(resolve, 500))
      fs.rmSync(workDir, { recursive: true, force: true })
      await app.close()
    }
  })

  test('取消（R2.5）+ 并发排队（R2.6）', async () => {
    test.setTimeout(180_000)
    const { app, page } = await launch()
    const workDir = freshDir('lumin-pt-e2e-cancel')
    try {
      // 60 页卷 → 拆成 60 个单页文件，作为合并取消与并发的输入
      const input = await makePdf(page, workDir, '大批卷', 60)
      const allRange = Array.from({ length: 60 }, (_, index) => String(index + 1)).join(',')
      const split = await runTask(page, 'pdf-toolkit:split', { inputPath: input, ranges: allRange })
      const pages = split.done?.outputPaths ?? []
      expect(pages).toHaveLength(60)

      // 取消：合并首个 progress 后 cancel → CANCELLED
      const cancelled = await page.evaluate(
        (inputPaths: string[]) =>
          new Promise<{ code: string; progress: number }>((resolve, reject) => {
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
              resolve({ code: event.kind === 'done' ? 'DONE' : event.error.code, progress })
            })
            window.lumin
              .invoke<{ taskId: string }>('pdf-toolkit:merge', { inputPaths })
              .then((result) => {
                taskId = result.taskId
              })
              .catch((err: unknown) => {
                off()
                reject(err instanceof Error ? err : new Error(String(err)))
              })
          }),
        pages
      )
      expect(cancelled.code).toBe('CANCELLED')

      // 并发：3 个不同源文件同时重排，排队后全部完成
      const singles = pages.slice(0, 3)
      const outcomes = await page.evaluate(
        (inputs: string[]) =>
          new Promise<string[]>((resolve, reject) => {
            const state = new Map<number, string>()
            const indexByTask = new Map<string, number>()
            const off = window.lumin.onTaskEvent((event) => {
              const index = indexByTask.get(event.taskId)
              if (index === undefined) return
              if (event.kind === 'progress' || event.kind === 'log') return
              state.set(index, event.kind === 'done' ? 'done' : event.error.code)
              if (state.size === inputs.length) {
                off()
                resolve([...state.values()])
              }
            })
            Promise.all(
              inputs.map((inputPath, index) =>
                window.lumin
                  .invoke<{ taskId: string }>('pdf-toolkit:reorder', {
                    inputPath,
                    order: [1]
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
        singles
      )
      expect(outcomes).toEqual(['done', 'done', 'done'])
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true })
      await app.close()
    }
  })

  test('源目录不可写（R2.7）+ 强杀恢复（R2.8）', async () => {
    test.setTimeout(180_000)
    const first = await launch()
    const workDir = freshDir('lumin-pt-e2e-crash')
    const denied = path.join(workDir, 'denied')
    const user = process.env.USERNAME ?? ''
    let aclApplied = false
    try {
      const input = await makePdf(first.page, workDir, '崩溃卷', 2)

      // R2.7：源目录 deny 写/删 ACL → 写盘失败归 PT_OUTPUT_WRITE_FAILED
      fs.mkdirSync(denied, { recursive: true })
      const deniedInput = path.join(denied, '受限卷.pdf')
      fs.copyFileSync(input, deniedInput)
      execFileSync('icacls', [denied, '/deny', `${user}:(WD,AD)`], { windowsHide: true })
      aclApplied = true
      const writeError = await runTask(first.page, 'pdf-toolkit:reorder', {
        inputPath: deniedInput,
        order: [2, 1]
      })
      expect(writeError.error?.code).toBe('PT_OUTPUT_WRITE_FAILED')
      execFileSync('icacls', [denied, '/remove:d', user], { windowsHide: true })
      aclApplied = false

      // R2.8：合并执行中强杀进程树，重启后再次合并成功
      await first.page.evaluate(
        ({ inputPath }: { inputPath: string }) =>
          window.lumin.invoke('pdf-toolkit:merge', {
            inputPaths: Array.from({ length: 60 }, () => inputPath)
          }),
        { inputPath: input }
      )
      await new Promise((resolve) => setTimeout(resolve, 1200))
      const crashPid = first.app.process().pid
      if (crashPid !== undefined) {
        spawn('taskkill', ['/PID', String(crashPid), '/F', '/T'], { windowsHide: true })
      }
      await new Promise((resolve) => setTimeout(resolve, 1000))
      await first.app.close().catch(() => undefined)

      const second = await launch()
      try {
        const again = await runTask(second.page, 'pdf-toolkit:reorder', {
          inputPath: input,
          order: [2, 1]
        })
        const output = again.done?.outputPaths?.[0] ?? ''
        expectPdf(output)
        expect((await infoOf(second.page, output)).pageCount).toBe(2)
      } finally {
        await second.app.close()
      }
    } finally {
      if (aclApplied && user !== '') {
        try {
          execFileSync('icacls', [denied, '/remove:d', user], { windowsHide: true })
        } catch {
          // 目录已删/ACL 已失效时忽略
        }
      }
      fs.rmSync(workDir, { recursive: true, force: true })
      await first.app.close().catch(() => undefined)
    }
  })
})
