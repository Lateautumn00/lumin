/**
 * @file print-smoke.spec.ts
 * @author cuilanchao
 * @date 2026-11-25
 * @description 文件打印工具 e2e 冒烟：页面空态、dry-run 全链路（prepare → show → printToPDF 落盘 → cleanup）、
 *              缺失文件错误码。dry-run 由启动参数 `--lumin-print-dry-run` 打开（不弹系统打印对话框）。
 *              前置：pnpm build
 */
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

/** 1×1 透明 PNG（免 fixture） */
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
)

type Page = Awaited<ReturnType<ElectronApplication['firstWindow']>>

interface PrepareOutcome {
  jobs: { jobId: string; name: string; kind: string; pageCount?: number }[]
  failures: { inputPath: string; code: string }[]
}

/** 启动应用并开启打印 dry-run（printToPDF 落盘代替系统对话框） */
async function launch(): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({ args: ['.', '--lumin-print-dry-run'], cwd: appDir })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await page.waitForFunction(() => typeof window.lumin !== 'undefined')
  return { app, page }
}

/** 提交任务并等待 done/error（返回结果或错误码） */
async function runTask(
  page: Page,
  channel: string,
  payload: unknown
): Promise<{ ok: true; result: unknown } | { ok: false; code: string }> {
  return page.evaluate(
    (args) =>
      new Promise<{ ok: true; result: unknown } | { ok: false; code: string }>((resolve) => {
        let currentTaskId = ''
        const off = window.lumin.onTaskEvent((ev) => {
          if (ev.taskId !== currentTaskId) return
          if (ev.kind === 'progress' || ev.kind === 'log') return
          off()
          if (ev.kind === 'done') resolve({ ok: true, result: ev.result })
          else resolve({ ok: false, code: ev.error.code })
        })
        window.lumin
          .invoke<{ taskId: string }>(args.channel, args.payload)
          .then(({ taskId }) => {
            currentTaskId = taskId
          })
          .catch((err: unknown) => {
            off()
            resolve({ ok: false, code: String((err as { code?: string }).code ?? err) })
          })
      }),
    { channel, payload }
  )
}

test.describe('print（文件打印）冒烟', () => {
  test('页面加载 + 空态拖拽引导', async () => {
    const { app, page } = await launch()
    try {
      await clickSidebarTool(page, '文件打印')
      await expect(page.getByRole('heading', { name: '文件打印' })).toBeVisible()
      await expect(page.getByText('拖拽文件到此处，或点击选择（最多 50 个）')).toBeVisible()
      await expect(page.getByText('打印前会逐份预检')).toBeVisible()
    } finally {
      await app.close()
    }
  })

  test('dry-run 全链路：中文+空格图片 → prepare → show 落盘 PDF → cleanup', async () => {
    const { app, page } = await launch()
    const dir = path.join(os.tmpdir(), 'lumin-print-e2e')
    fs.rmSync(dir, { recursive: true, force: true })
    fs.mkdirSync(dir, { recursive: true })
    try {
      const image = path.join(dir, '打印 样例.png')
      fs.writeFileSync(image, TINY_PNG)

      const prepared = await runTask(page, 'print:prepare', { inputPaths: [image] })
      expect(prepared.ok).toBe(true)
      if (!prepared.ok) throw new Error(prepared.code)
      const result = prepared.result as PrepareOutcome
      expect(result.jobs).toHaveLength(1)
      expect(result.jobs[0]?.kind).toBe('image')
      const jobId = result.jobs[0]?.jobId ?? ''

      const shown = await runTask(page, 'print:show', { jobId })
      expect(shown.ok).toBe(true)

      const userData = await app.evaluate(({ app: electronApp }) => electronApp.getPath('userData'))
      const dryRun = path.join(userData, 'temp', 'lumin-print', jobId, 'dry-run.pdf')
      const head = fs.readFileSync(dryRun).subarray(0, 5).toString('latin1')
      expect(head).toBe('%PDF-')
      expect(fs.statSync(dryRun).size).toBeGreaterThan(0)

      const cleaned = await page.evaluate(
        (id) => window.lumin.invoke<{ removed: number }>('print:cleanup', { jobIds: [id] }),
        jobId
      )
      expect(cleaned.removed).toBe(1)
      expect(fs.existsSync(path.join(userData, 'temp', 'lumin-print', jobId))).toBe(false)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
      await app.close()
    }
  })

  test('缺失文件 → PR_NOT_FOUND（任务 error 事件）', async () => {
    const { app, page } = await launch()
    try {
      const missing = path.join(os.tmpdir(), 'lumin-print-e2e', '不存在.pdf')
      const outcome = await runTask(page, 'print:prepare', { inputPaths: [missing] })
      expect(outcome).toEqual({ ok: false, code: 'PR_NOT_FOUND' })
    } finally {
      await app.close()
    }
  })
})
