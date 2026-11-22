/**
 * @file file-hasher（文件哈希校验）e2e 冒烟：真实 Electron + 真实磁盘文件
 * @author cuilanchao
 * @date 2026-11-19
 * @description 覆盖：页面加载/空态、UI 选文件 + 四算法计算 + 期望哈希比对、中文+空格路径、
 *              不可读项逐项失败不中断、任务取消终态、3 任务并发、断电恢复（强杀重启后可重算）。
 *              注意：临时目录名必须 ASCII（本机 Node fs 对非 ASCII 目录名会硬崩，见 docx2pdf 先例），
 *              文件名保留中文验证路径。
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

type Page = Awaited<ReturnType<ElectronApplication['firstWindow']>>

const appDir = path.resolve(__dirname, '..')

/** 'abc' 的标准摘要（RFC 测试向量） */
const ABC = {
  md5: '900150983cd24fb0d6963f7d28e17f72',
  sha1: 'a9993e364706816aba3e25717850c26c9cd0d89d',
  sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  sha512:
    'ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f'
}

interface HashFileResult {
  path: string
  size: number
  mtimeMs: number
  hashes: { md5?: string; sha1?: string; sha256?: string; sha512?: string }
  status: 'ok' | 'failed'
  code?: string
  message?: string
}

interface HashResult {
  results: HashFileResult[]
  failedCount: number
  totalBytes: number
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

/** 提交哈希任务并等待终态（done 返回结果；error 拒绝） */
async function runHash(
  page: Page,
  payload: { paths: string[]; algorithms: string[] }
): Promise<{ hasProgress: boolean; result: HashResult }> {
  return page.evaluate(
    (args: { paths: string[]; algorithms: string[] }) =>
      new Promise<{ hasProgress: boolean; result: HashResult }>((resolve, reject) => {
        let hasProgress = false
        let taskId = ''
        const off = window.lumin.onTaskEvent((event) => {
          if (event.taskId !== taskId) return
          if (event.kind === 'progress') {
            hasProgress = true
          } else if (event.kind === 'done') {
            off()
            resolve({ hasProgress, result: event.result as HashResult })
          } else if (event.kind === 'error') {
            off()
            reject(new Error(`${event.error.code}: ${event.error.message}`))
          }
        })
        window.lumin
          .invoke<{ taskId: string }>('file-hasher:hash', args)
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

test.describe('file-hasher（文件哈希校验）冒烟', () => {
  test('页面加载 + 空态引导（未添加文件）', async () => {
    const { app, page } = await launch()
    await ensureReady(page)
    try {
      await clickSidebarTool(page, '文件哈希校验')
      await expect(page.getByRole('heading', { name: '文件哈希校验' })).toBeVisible()
      await expect(page.getByText('添加文件后点击「开始校验」，即可获得哈希值')).toBeVisible()
    } finally {
      await app.close()
    }
  })

  test('UI 选文件 → 四算法计算 → 结果表 + 期望哈希比对命中', async () => {
    const { app, page } = await launch()
    await ensureReady(page)
    const dir = freshDir('lumin-fh-e2e-ui')
    try {
      const target = path.join(dir, '文件 一.txt')
      fs.writeFileSync(target, 'abc')

      await clickSidebarTool(page, '文件哈希校验')
      await expect(page.getByRole('heading', { name: '文件哈希校验' })).toBeVisible()

      // 通过设置通道预置四算法（页面 mounted 时读取记忆），再验证 UI 勾选态与切换
      await page.evaluate(() =>
        window.lumin.invoke('file-hasher:set-config', {
          algorithms: ['md5', 'sha1', 'sha256', 'sha512']
        })
      )
      await clickSidebarTool(page, '计算器')
      await clickSidebarTool(page, '文件哈希校验')
      const sha512Checkbox = page.locator('.n-checkbox', { hasText: 'SHA-512' }).first()
      await expect(sha512Checkbox).toHaveClass(/n-checkbox--checked/)
      await sha512Checkbox.click()
      await expect(sha512Checkbox).not.toHaveClass(/n-checkbox--checked/)
      await sha512Checkbox.click()
      await expect(sha512Checkbox).toHaveClass(/n-checkbox--checked/)

      // 隐藏 input 选择真实磁盘文件（DropZone → getPathForFile）
      await page.locator('input[type=file]').setInputFiles(target)
      await expect(page.getByText('已选 1 / 200 个文件')).toBeVisible()

      await page.getByRole('button', { name: '开始校验' }).click()

      // 结果表出现四种算法已知值
      await expect(page.getByText(ABC.md5)).toBeVisible({ timeout: 30_000 })
      await expect(page.getByText(ABC.sha1)).toBeVisible()
      await expect(page.getByText(ABC.sha256)).toBeVisible()
      await expect(page.getByText(ABC.sha512)).toBeVisible()

      // 粘贴期望哈希（带前缀、大写）→ 命中高亮 + 匹配标签
      await page
        .getByPlaceholder('粘贴 MD5 / SHA-1 / SHA-256 / SHA-512，可带 md5: 等前缀')
        .fill(`MD5:${ABC.md5.toUpperCase()}`)
      await expect(page.getByText('按 MD5 比对，命中 1 个文件')).toBeVisible()
      await expect(page.getByText('匹配', { exact: true })).toBeVisible()
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
      await app.close()
    }
  })

  test('中文+空格路径：四算法已知值且结果保持输入顺序', async () => {
    const { app, page } = await launch()
    await ensureReady(page)
    const dir = freshDir('lumin-fh-e2e-cn')
    try {
      const first = path.join(dir, '文件 一.txt')
      const second = path.join(dir, '文件 二.txt')
      fs.writeFileSync(first, 'abc')
      fs.writeFileSync(second, 'abc')

      const outcome = await runHash(page, {
        paths: [first, second],
        algorithms: ['md5', 'sha1', 'sha256', 'sha512']
      })

      expect(outcome.hasProgress).toBe(true)
      expect(outcome.result.results.map((item) => item.path)).toEqual([first, second])
      expect(outcome.result.failedCount).toBe(0)
      const hashes = firstOf(outcome.result.results).hashes
      expect(hashes).toMatchObject(ABC)
      expect(outcome.result.totalBytes).toBe(6)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
      await app.close()
    }
  })

  test('不可读项（缺失/目录）逐项失败，不中断其余文件', async () => {
    const { app, page } = await launch()
    await ensureReady(page)
    const dir = freshDir('lumin-fh-e2e-fail')
    try {
      const okPath = path.join(dir, 'ok.txt')
      fs.writeFileSync(okPath, 'abc')
      const missing = path.join(dir, 'missing.txt')
      const folder = path.join(dir, 'folder')
      fs.mkdirSync(folder)

      const outcome = await runHash(page, {
        paths: [missing, okPath, folder],
        algorithms: ['sha256']
      })

      expect(outcome.result.failedCount).toBe(2)
      expect(outcome.result.results).toHaveLength(3)
      expect(outcome.result.results[0]).toMatchObject({
        path: missing,
        status: 'failed',
        code: 'FH_FILE_INVALID',
        message: 'ENOENT'
      })
      expect(outcome.result.results[1]).toMatchObject({ path: okPath, status: 'ok' })
      expect(outcome.result.results[2]).toMatchObject({
        path: folder,
        status: 'failed',
        code: 'FH_FILE_INVALID'
      })
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
      await app.close()
    }
  })

  test('任务取消：终态为 done 或 CANCELLED（不残留任务）', async () => {
    const { app, page } = await launch()
    await ensureReady(page)
    const dir = freshDir('lumin-fh-e2e-cancel')
    try {
      const paths: string[] = []
      const payload = Buffer.alloc(256 * 1024 * 1024, 1)
      const big = path.join(dir, 'big.bin')
      fs.writeFileSync(big, payload)
      paths.push(big)
      for (let index = 0; index < 2; index++) {
        const target = path.join(dir, `small-${index}.bin`)
        fs.writeFileSync(target, 'abc')
        paths.push(target)
      }

      const terminal = await page.evaluate(
        (args: { paths: string[]; algorithms: string[] }) =>
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
              .invoke<{ taskId: string }>('file-hasher:hash', args)
              .then((value) => {
                taskId = value.taskId
                // 任务可能已瞬间完成：cancel 失败不影响终态断言
                window.lumin.invoke('lumin:task:cancel', { taskId }).catch(() => undefined)
              })
              .catch((err: unknown) => {
                off()
                reject(err)
              })
          }),
        { paths, algorithms: ['sha256'] }
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
    const dir = freshDir('lumin-fh-e2e-concurrent')
    try {
      const paths = [0, 1, 2].map((index) => {
        const target = path.join(dir, `f${index}.bin`)
        fs.writeFileSync(target, Buffer.alloc(1024 * 1024, index))
        return target
      })

      const outcome = await page.evaluate(
        (args: { paths: string[] }) =>
          new Promise<{ terminals: string[]; sizes: number[] }>((resolve, reject) => {
            /** 事件可能早于 invoke 返回：先缓冲，拿到全部 taskId 后再匹配 */
            const events: { taskId: string; kind: string; result?: HashResult; code?: string }[] = []
            const taskIds: string[] = []
            const off = window.lumin.onTaskEvent((event) => {
              events.push(event as unknown as (typeof events)[number])
              check()
            })
            const check = (): void => {
              if (taskIds.length !== args.paths.length) return
              const terminals = events.filter(
                (event) =>
                  taskIds.includes(event.taskId) &&
                  (event.kind === 'done' || event.kind === 'error')
              )
              if (terminals.length !== taskIds.length) return
              off()
              resolve({
                terminals: terminals.map((event) => (event.kind === 'done' ? 'done' : event.code ?? 'ERROR')),
                sizes: terminals.map((event) => (event.kind === 'done' ? (event.result?.totalBytes ?? 0) : 0))
              })
            }
            Promise.all(
              args.paths.map((target) =>
                window.lumin.invoke<{ taskId: string }>('file-hasher:hash', {
                  paths: [target],
                  algorithms: ['sha256']
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
        { paths }
      )

      expect(outcome.terminals).toEqual(['done', 'done', 'done'])
      expect(outcome.sizes.sort()).toEqual([1024 * 1024, 1024 * 1024, 1024 * 1024])
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
      await app.close()
    }
  })

  test('断电恢复：任务中途强杀主进程，重启后可重新计算同一文件', async () => {
    const dir = freshDir('lumin-fh-e2e-crash')
    const target = path.join(dir, 'big.bin')
    fs.writeFileSync(target, Buffer.alloc(256 * 1024 * 1024, 2))
    const first = await launch()
    try {
      await ensureReady(first.page)
      const pending = first.page
        .evaluate(
          (value: string) =>
            window.lumin
              .invoke('file-hasher:hash', { paths: [value], algorithms: ['sha256'] })
              .catch(() => undefined),
          target
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
      const outcome = await runHash(second.page, { paths: [target], algorithms: ['sha256'] })
      const item = firstOf(outcome.result.results)
      expect(item.status).toBe('ok')
      expect(item.hashes.sha256).toMatch(/^[0-9a-f]{64}$/)
      expect(outcome.result.totalBytes).toBe(256 * 1024 * 1024)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
      await second.app.close()
    }
  })
})
