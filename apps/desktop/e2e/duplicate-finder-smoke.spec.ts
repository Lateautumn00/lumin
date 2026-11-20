/**
 * @file duplicate-finder（重复文件查找）e2e 冒烟：真实 Electron + 真实磁盘目录
 * @author cuilanchao
 * @date 2026-11-19
 * @description 覆盖：页面加载/空态、扫描分组（中文+空格路径/递归）、非递归与阈值、
 *              默认勾选与全不选、根目录非法、取消、3 任务并发、断电恢复（强杀重启）、
 *              回收站通道失败项（不真实删除，避免污染系统回收站）。
 *              注意：临时目录名必须 ASCII（非 ASCII 目录名会导致本机 Node fs 硬崩），文件名保留中文。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import { clickSidebarTool } from './sidebar'
import type { LuminBridge } from '@lumin/plugin-api'

declare global {
  interface Window {
    lumin: LuminBridge
  }
}

type Page = Awaited<ReturnType<ElectronApplication['firstWindow']>>

const appDir = path.resolve(__dirname, '..')

interface DuplicateFile {
  path: string
  size: number
  mtimeMs: number
}

interface DuplicateGroup {
  size: number
  hash: string
  files: DuplicateFile[]
  wastedBytes: number
}

interface ScanResult {
  groups: DuplicateGroup[]
  scannedFiles: number
  skipped: number
  totalWastedBytes: number
  elapsedMs: number
}

async function launch(): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({ args: ['.'], cwd: appDir })
  const page = await app.firstWindow()
  return { app, page }
}

/** 等待壳渲染层就绪（firstWindow 早于 bridge 注入时 evaluate 会丢失上下文） */
async function ensureReady(page: Page): Promise<void> {
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

/** noUncheckedIndexedAccess 收窄：取首元素，空数组抛错 */
function firstOf<T>(items: T[]): T {
  const item = items[0]
  if (item === undefined) throw new Error('数组为空')
  return item
}

/** SHA-256（十六进制；与 worker 口径一致） */
function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

/** 提交扫描任务并等待终态（done 返回结果；error 拒绝） */
async function runScan(
  page: Page,
  payload: { root: string; recursive: boolean; minBytes: number }
): Promise<{ hasProgress: boolean; result: ScanResult }> {
  return page.evaluate(
    (args: { root: string; recursive: boolean; minBytes: number }) =>
      new Promise<{ hasProgress: boolean; result: ScanResult }>((resolve, reject) => {
        let hasProgress = false
        let taskId = ''
        const off = window.lumin.onTaskEvent((event) => {
          if (event.taskId !== taskId) return
          if (event.kind === 'progress') {
            hasProgress = true
          } else if (event.kind === 'done') {
            off()
            resolve({ hasProgress, result: event.result as ScanResult })
          } else if (event.kind === 'error') {
            off()
            reject(new Error(`${event.error.code}: ${event.error.message}`))
          }
        })
        window.lumin
          .invoke<{ taskId: string }>('duplicate-finder:scan', args)
          .then((value) => {
            taskId = value.taskId
          })
          .catch((err: unknown) => {
            off()
            reject(err)
          })
      }),
    payload
  )
}

test.describe('duplicate-finder（重复文件查找）冒烟', () => {
  test('页面加载 + 空态引导（未选目录）', async () => {
    const { app, page } = await launch()
    await ensureReady(page)
    try {
      // 清空记忆目录（设置跨进程持久化，避免依赖用例执行顺序）
      await page.evaluate(() =>
        window.lumin.invoke('duplicate-finder:set-config', {
          root: '',
          recursive: true,
          minBytes: 1048576
        })
      )
      await clickSidebarTool(page, '计算器')
      await clickSidebarTool(page, '重复文件查找')
      await expect(page.getByRole('heading', { name: '重复文件查找' })).toBeVisible()
      await expect(page.getByText('先选择要扫描的目录，再点击「开始扫描」')).toBeVisible()
      await expect(page.getByRole('button', { name: '开始扫描' })).toBeDisabled()
    } finally {
      await app.close()
    }
  })

  test('递归扫描：中文+空格路径跨子目录分组、完整哈希与统计', async () => {
    const { app, page } = await launch()
    await ensureReady(page)
    const dir = freshDir('lumin-df-e2e-scan')
    try {
      const first = path.join(dir, '文件 一.txt')
      const second = path.join(dir, '文件 二.txt')
      const nested = path.join(dir, '子目录 甲')
      const third = path.join(nested, '文件 三.txt')
      const other = path.join(dir, '不同.txt')
      fs.mkdirSync(nested, { recursive: true })
      fs.writeFileSync(first, 'abcdef')
      fs.writeFileSync(second, 'abcdef')
      fs.writeFileSync(third, 'abcdef')
      fs.writeFileSync(other, 'xyz')

      const outcome = await runScan(page, { root: dir, recursive: true, minBytes: 1 })

      expect(outcome.hasProgress).toBe(true)
      expect(outcome.result.groups).toHaveLength(1)
      const group = firstOf(outcome.result.groups)
      expect(group.size).toBe(6)
      expect(group.hash).toBe(sha256('abcdef'))
      expect(group.wastedBytes).toBe(12)
      expect(group.files.map((file) => file.path).sort()).toEqual(
        [first, second, third].sort()
      )
      expect(outcome.result.scannedFiles).toBe(4)
      expect(outcome.result.totalWastedBytes).toBe(12)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
      await app.close()
    }
  })

  test('非递归 + 最小文件大小阈值：子目录与过小文件不参与', async () => {
    const { app, page } = await launch()
    await ensureReady(page)
    const dir = freshDir('lumin-df-e2e-flags')
    try {
      const a = path.join(dir, 'a.txt')
      const b = path.join(dir, 'b.txt')
      const nested = path.join(dir, 'sub')
      fs.mkdirSync(nested)
      fs.writeFileSync(a, 'abcdef')
      fs.writeFileSync(b, 'abcdef')
      fs.writeFileSync(path.join(nested, 'c.txt'), 'abcdef')

      const flat = await runScan(page, { root: dir, recursive: false, minBytes: 1 })
      expect(flat.result.groups).toHaveLength(1)
      expect(flat.result.groups[0]?.files).toHaveLength(2)
      expect(flat.result.scannedFiles).toBe(2)

      const filtered = await runScan(page, { root: dir, recursive: true, minBytes: 100 })
      expect(filtered.result.groups).toEqual([])
      expect(filtered.result.scannedFiles).toBe(3)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
      await app.close()
    }
  })

  test('UI：预置目录 → 扫描 → 默认勾选每组最早一份 → 全不选/恢复', async () => {
    const { app, page } = await launch()
    await ensureReady(page)
    const dir = freshDir('lumin-df-e2e-ui')
    try {
      const first = path.join(dir, '最早 文件.txt')
      const second = path.join(dir, '较新 文件.txt')
      fs.writeFileSync(first, 'abcdef')
      fs.writeFileSync(second, 'abcdef')
      const old = new Date('2026-01-01T00:00:00Z')
      fs.utimesSync(first, old, old)

      await clickSidebarTool(page, '重复文件查找')
      await page.evaluate(
        (root: string) =>
          window.lumin.invoke('duplicate-finder:set-config', {
            root,
            recursive: true,
            minBytes: 1
          }),
        dir
      )
      // 重新进入页面触达 mounted 读取记忆
      await clickSidebarTool(page, '计算器')
      await clickSidebarTool(page, '重复文件查找')
      await expect(page.locator('input').first()).toHaveValue(dir)

      await page.getByRole('button', { name: '开始扫描' }).click()
      await expect(page.getByText('第 1 组 · 6 B × 2')).toBeVisible({ timeout: 30_000 })
      await expect(page.getByRole('button', { name: '移入回收站（1）' })).toBeEnabled()

      await page.getByRole('button', { name: '全选' }).click()
      await expect(page.getByRole('button', { name: '移入回收站（2）' })).toBeEnabled()
      await page.getByRole('button', { name: '全不选' }).click()
      await expect(page.getByRole('button', { name: '移入回收站（0）' })).toBeDisabled()

      await page.getByRole('button', { name: '保留每组最早一份' }).click()
      await expect(page.getByRole('button', { name: '移入回收站（1）' })).toBeEnabled()
      // 默认保留的是最早文件（不勾选）
      const rows = page.locator('.df-file .n-checkbox')
      await expect(rows.nth(0)).not.toHaveClass(/n-checkbox--checked/)
      await expect(rows.nth(1)).toHaveClass(/n-checkbox--checked/)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
      await app.close()
    }
  })

  test('根目录非法 → DF_ROOT_INVALID；回收站通道失败项不中断', async () => {
    const { app, page } = await launch()
    await ensureReady(page)
    const missingRoot = path.join(os.tmpdir(), 'lumin-df-not-exist-2026')
    try {
      const failureCode = await page.evaluate(
        (root: string) =>
          new Promise<string>((resolve, reject) => {
            let taskId = ''
            const off = window.lumin.onTaskEvent((event) => {
              if (event.taskId !== taskId) return
              if (event.kind === 'done') {
                off()
                resolve('done')
              } else if (event.kind === 'error') {
                off()
                resolve(event.error.code)
              }
            })
            window.lumin
              .invoke<{ taskId: string }>('duplicate-finder:scan', {
                root,
                recursive: true,
                minBytes: 0
              })
              .then((value) => {
                taskId = value.taskId
              })
              .catch((err: unknown) => {
                off()
                reject(err)
              })
          }),
        missingRoot
      )
      expect(failureCode).toBe('DF_ROOT_INVALID')

      const missing = path.join(os.tmpdir(), 'lumin-df-trash-missing-2026.txt')
      const outcome = await page.evaluate(
        (target: string) => window.lumin.trashPaths([target]),
        missing
      )
      expect(outcome.trashed).toEqual([])
      expect(outcome.failed).toHaveLength(1)
      expect(outcome.failed[0]?.path).toBe(missing)
      expect(outcome.failed[0]?.message.length).toBeGreaterThan(0)
    } finally {
      await app.close()
    }
  })

  test('任务取消：终态为 done 或 CANCELLED（不残留任务）', async () => {
    const { app, page } = await launch()
    await ensureReady(page)
    const dir = freshDir('lumin-df-e2e-cancel')
    try {
      const block = Buffer.alloc(128 * 1024 * 1024, 7)
      fs.writeFileSync(path.join(dir, 'a.bin'), block)
      fs.writeFileSync(path.join(dir, 'b.bin'), block)

      const terminal = await page.evaluate(
        (root: string) =>
          new Promise<string>((resolve, reject) => {
            let taskId = ''
            const off = window.lumin.onTaskEvent((event) => {
              if (event.taskId !== taskId) return
              if (event.kind === 'done') {
                off()
                resolve('done')
              } else if (event.kind === 'error') {
                off()
                resolve(event.error.code)
              }
            })
            window.lumin
              .invoke<{ taskId: string }>('duplicate-finder:scan', {
                root,
                recursive: true,
                minBytes: 1
              })
              .then((value) => {
                taskId = value.taskId
                window.lumin.invoke('lumin:task:cancel', { taskId }).catch(() => undefined)
              })
              .catch((err: unknown) => {
                off()
                reject(err)
              })
          }),
        dir
      )

      expect(['done', 'CANCELLED']).toContain(terminal)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
      await app.close()
    }
  })

  test('3 任务并发：互不干扰，全部正常完成', async () => {
    const { app, page } = await launch()
    await ensureReady(page)
    const dir = freshDir('lumin-df-e2e-concurrent')
    try {
      const roots = [0, 1, 2].map((index) => {
        const sub = path.join(dir, `root${index}`)
        fs.mkdirSync(sub)
        fs.writeFileSync(path.join(sub, 'a.txt'), `payload-${index}`)
        fs.writeFileSync(path.join(sub, 'b.txt'), `payload-${index}`)
        return sub
      })

      const outcome = await page.evaluate(
        (args: string[]) =>
          new Promise<{ terminals: string[]; wasted: number[] }>((resolve, reject) => {
            /** 事件可能早于 invoke 返回：先缓冲，拿到全部 taskId 后再匹配 */
            const events: { taskId: string; kind: string; result?: ScanResult; code?: string }[] = []
            const taskIds: string[] = []
            const off = window.lumin.onTaskEvent((event) => {
              events.push(event as unknown as (typeof events)[number])
              check()
            })
            const check = (): void => {
              if (taskIds.length !== args.length) return
              const terminals = events.filter(
                (event) =>
                  taskIds.includes(event.taskId) &&
                  (event.kind === 'done' || event.kind === 'error')
              )
              if (terminals.length !== taskIds.length) return
              off()
              resolve({
                terminals: terminals.map((event) =>
                  event.kind === 'done' ? 'done' : (event.code ?? 'ERROR')
                ),
                wasted: terminals.map((event) =>
                  event.kind === 'done' ? (event.result?.totalWastedBytes ?? 0) : 0
                )
              })
            }
            Promise.all(
              args.map((root) =>
                window.lumin.invoke<{ taskId: string }>('duplicate-finder:scan', {
                  root,
                  recursive: true,
                  minBytes: 1
                })
              )
            )
              .then((values) => {
                for (const value of values) taskIds.push(value.taskId)
                check()
              })
              .catch((err: unknown) => {
                off()
                reject(err)
              })
          }),
        roots
      )

      expect(outcome.terminals).toEqual(['done', 'done', 'done'])
      expect(outcome.wasted).toEqual([9, 9, 9])
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
      await app.close()
    }
  })

  test('断电恢复：扫描中途强杀主进程，重启后可重新扫描同一目录', async () => {
    const dir = freshDir('lumin-df-e2e-crash')
    const block = Buffer.alloc(128 * 1024 * 1024, 9)
    fs.writeFileSync(path.join(dir, 'a.bin'), block)
    fs.writeFileSync(path.join(dir, 'b.bin'), block)
    const first = await launch()
    try {
      await ensureReady(first.page)
      const pending = first.page
        .evaluate(
          (root: string) =>
            window.lumin
              .invoke('duplicate-finder:scan', { root, recursive: true, minBytes: 1 })
              .catch(() => undefined),
          dir
        )
        .catch(() => undefined)
      await first.page.waitForTimeout(150)
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
      const outcome = await runScan(second.page, { root: dir, recursive: true, minBytes: 1 })
      expect(outcome.result.groups).toHaveLength(1)
      expect(outcome.result.groups[0]?.files).toHaveLength(2)
      expect(outcome.result.totalWastedBytes).toBe(128 * 1024 * 1024)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
      await second.app.close()
    }
  })
})
