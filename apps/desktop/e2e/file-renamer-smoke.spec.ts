/**
 * @file file-renamer（批量重命名）e2e 冒烟：真实 Electron + 真实磁盘目录
 * @author cuilanchao
 * @date 2026-11-18
 * @description 覆盖：页面加载/空态、scan→apply（中文+空格文件名、R2.1 路径）落盘核对、
 *              目标占用冲突（单条失败不中断）、任务取消（无文件丢失）。
 *              注意：临时目录名必须 ASCII（本机 Node fs 对非 ASCII 目录名会硬崩，
 *              见 docx2pdf-smoke 先例），文件名保留中文验证路径。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import { clickSidebarTool } from './sidebar'
import type { LuminBridge } from '@lumin/plugin-api'

declare global {
  interface Window {
    lumin: LuminBridge
  }
}

const appDir = path.resolve(__dirname, '..')

async function launch(): Promise<{
  app: ElectronApplication
  page: Awaited<ReturnType<ElectronApplication['firstWindow']>>
}> {
  const app = await electron.launch({ args: ['.'], cwd: appDir })
  const page = await app.firstWindow()
  return { app, page }
}

/** noUncheckedIndexedAccess 收窄：取首元素，空数组抛错 */
function firstOf<T>(items: T[]): T {
  const item = items[0]
  if (item === undefined) throw new Error('数组为空')
  return item
}

/**
 * 等待壳渲染层就绪：firstWindow 可能在初始加载完成前返回，直接 evaluate 会随
 * 路由 hash 跳转丢失执行上下文（实测表现为 evaluate 永不返回直至超时）
 */
async function ensureReady(
  page: Awaited<ReturnType<ElectronApplication['firstWindow']>>
): Promise<void> {
  await page.waitForLoadState('domcontentloaded')
  await page.waitForFunction(() => typeof window.lumin !== 'undefined')
}

/** 造目录并清空 */
function freshDir(name: string): string {
  const dir = path.join(os.tmpdir(), name)
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

interface ScanOutcome {
  files: { name: string; size: number; mtimeMs: number }[]
  truncated: boolean
}

interface RenameOutcome {
  renamed: { from: string; to: string }[]
  failures: { from: string; code: string; message: string }[]
}

test.describe('file-renamer（批量重命名）冒烟', () => {
  test('页面加载 + 空态引导（未选目录）', async () => {
    const { app, page } = await launch()
    await ensureReady(page)
    try {
      await clickSidebarTool(page, '批量重命名')
      await expect(page.getByRole('heading', { name: '批量重命名' })).toBeVisible()
      await expect(page.getByText('选择一个文件夹开始批量重命名')).toBeVisible()
    } finally {
      await app.close()
    }
  })

  test('scan → apply（中文+空格文件名）：progress → done 且磁盘实际改名', async () => {
    const { app, page } = await launch()
    await ensureReady(page)
    const dir = freshDir('lumin-fr-e2e-apply')
    try {
      fs.writeFileSync(path.join(dir, '照片 一.txt'), 'a')
      fs.writeFileSync(path.join(dir, '照片 二.txt'), 'b')

      const scan = await page.evaluate(
        (target: string) => window.lumin.invoke<ScanOutcome>('file-renamer:scan', { dir: target }),
        dir
      )
      // 扫描顺序按 localeCompare（中文按拼音），此处只断言集合完整
      expect(scan.files.map((file) => file.name).sort()).toEqual(
        ['照片 一.txt', '照片 二.txt'].sort()
      )

      const outcome = await page.evaluate(
        (args: { dir: string; pairs: { from: string; to: string }[] }) =>
          new Promise<{ hasProgress: boolean; result: RenameOutcome }>((resolve, reject) => {
            let hasProgress = false
            let currentTaskId = ''
            const off = window.lumin.onTaskEvent((ev) => {
              if (ev.taskId !== currentTaskId) return
              if (ev.kind === 'progress') {
                hasProgress = true
              } else if (ev.kind === 'done') {
                off()
                resolve({ hasProgress, result: ev.result as RenameOutcome })
              } else if (ev.kind === 'error') {
                off()
                reject(new Error(`${ev.error.code}: ${ev.error.message}`))
              }
            })
            window.lumin
              .invoke<{ taskId: string }>('file-renamer:apply', args)
              .then(({ taskId }) => {
                currentTaskId = taskId
              })
              .catch((err: unknown) => {
                off()
                reject(err)
              })
          }),
        {
          dir,
          pairs: [
            { from: '照片 一.txt', to: '001-照片 一.txt' },
            { from: '照片 二.txt', to: '002-照片 二.txt' }
          ]
        }
      )

      expect(outcome.hasProgress).toBe(true)
      expect(outcome.result.renamed).toHaveLength(2)
      expect(outcome.result.failures).toHaveLength(0)
      expect(fs.readdirSync(dir).sort()).toEqual(['001-照片 一.txt', '002-照片 二.txt'])
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
      await app.close()
    }
  })

  test('目标占用冲突：冲突条目不执行，其余照常完成', async () => {
    const { app, page } = await launch()
    await ensureReady(page)
    const dir = freshDir('lumin-fr-e2e-conflict')
    try {
      fs.writeFileSync(path.join(dir, 'a.txt'), 'a')
      fs.writeFileSync(path.join(dir, 'b.txt'), 'b')
      fs.writeFileSync(path.join(dir, 'taken.txt'), 't')

      const outcome = await page.evaluate(
        (args: { dir: string; pairs: { from: string; to: string }[] }) =>
          new Promise<RenameOutcome>((resolve, reject) => {
            let currentTaskId = ''
            const off = window.lumin.onTaskEvent((ev) => {
              if (ev.taskId !== currentTaskId) return
              if (ev.kind === 'done') {
                off()
                resolve(ev.result as RenameOutcome)
              } else if (ev.kind === 'error') {
                off()
                reject(new Error(`${ev.error.code}: ${ev.error.message}`))
              }
            })
            window.lumin
              .invoke<{ taskId: string }>('file-renamer:apply', args)
              .then(({ taskId }) => {
                currentTaskId = taskId
              })
              .catch((err: unknown) => {
                off()
                reject(err)
              })
          }),
        {
          dir,
          pairs: [
            { from: 'a.txt', to: 'taken.txt' },
            { from: 'b.txt', to: 'new-b.txt' }
          ]
        }
      )

      expect(outcome.renamed).toEqual([{ from: 'b.txt', to: 'new-b.txt' }])
      expect(firstOf(outcome.failures)).toMatchObject({ from: 'a.txt', code: 'FR_CONFLICT' })
      expect(fs.readdirSync(dir).sort()).toEqual(['a.txt', 'new-b.txt', 'taken.txt'])
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
      await app.close()
    }
  })

  test('任务取消：终态 CANCELLED/done，文件不丢失（无临时中转残留）', async () => {
    const { app, page } = await launch()
    await ensureReady(page)
    const dir = freshDir('lumin-fr-e2e-cancel')
    const total = 300
    try {
      const pairs: { from: string; to: string }[] = []
      for (let index = 0; index < total; index++) {
        const from = `f${String(index).padStart(3, '0')}.txt`
        fs.writeFileSync(path.join(dir, from), 'x')
        pairs.push({ from, to: `renamed-${from}` })
      }

      const terminal = await page.evaluate(
        (args: { dir: string; pairs: { from: string; to: string }[] }) =>
          new Promise<string>((resolve, reject) => {
            let currentTaskId = ''
            const off = window.lumin.onTaskEvent((ev) => {
              if (ev.taskId !== currentTaskId) return
              if (ev.kind === 'done' || ev.kind === 'error') {
                off()
                resolve(ev.kind === 'done' ? 'done' : ev.error.code)
              }
            })
            window.lumin
              .invoke<{ taskId: string }>('file-renamer:apply', args)
              .then(({ taskId }) => {
                currentTaskId = taskId
                // 任务可能已瞬间完成：cancel 失败不影响终态断言
                window.lumin.invoke('lumin:task:cancel', { taskId }).catch(() => undefined)
              })
              .catch((err: unknown) => {
                off()
                reject(err)
              })
          }),
        { dir, pairs }
      )

      expect(['done', 'CANCELLED']).toContain(terminal)
      const names = fs.readdirSync(dir)
      expect(names).toHaveLength(total)
      for (const name of names) {
        expect(name.startsWith('f') || name.startsWith('renamed-')).toBe(true)
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
      await app.close()
    }
  })

  test('断电恢复：任务中途强杀主进程，重启后文件完整（无临时残留）', async () => {
    const dir = freshDir('lumin-fr-e2e-crash')
    const total = 1000
    const first = await launch()
    try {
      await ensureReady(first.page)
      const pairs: { from: string; to: string }[] = []
      for (let index = 0; index < total; index++) {
        const from = `f${String(index).padStart(4, '0')}.txt`
        fs.writeFileSync(path.join(dir, from), 'x')
        pairs.push({ from, to: `renamed-${from}` })
      }
      // 提交后不等待终态，稍候强杀主进程（模拟断电）
      const pending = first.page
        .evaluate(
          (args: { dir: string; pairs: { from: string; to: string }[] }) =>
            window.lumin.invoke('file-renamer:apply', args).catch(() => undefined),
          { dir, pairs }
        )
        .catch(() => undefined)
      await first.page.waitForTimeout(120)
      const pid = first.app.process().pid
      if (pid !== undefined) {
        spawnSync('taskkill', ['/PID', String(pid), '/F', '/T'], { windowsHide: true })
      }
      await first.app.close().catch(() => undefined)
      await pending
    } finally {
      await first.app.close().catch(() => undefined)
    }

    const second = await launch()
    try {
      await ensureReady(second.page)
      const scan = await second.page.evaluate(
        (target: string) => window.lumin.invoke<ScanOutcome>('file-renamer:scan', { dir: target }),
        dir
      )
      expect(scan.files).toHaveLength(total)
      for (const file of scan.files) {
        expect(file.name).toMatch(/^(renamed-)?f\d{4}\.txt$/)
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
      await second.app.close()
    }
  })
})
