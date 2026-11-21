/**
 * @file fs-cleaner（文件清理）e2e 冒烟：真实 Electron + 真实磁盘目录
 * @author cuilanchao
 * @date 2026-11-21
 * @description 覆盖：页面加载与四页签空态、目录树任务（深度/排除）、空文件夹扫描 UI、
 *              批量改时间（预演不改盘/应用生效）、临时文件匹配、根目录非法错误态。
 *              注意：临时目录名必须 ASCII（非 ASCII 目录名会导致本机 Node fs 硬崩），文件名保留中文。
 *              不真实调用回收站，避免污染系统回收站（R2 八类见 docs/smoke/fs-cleaner.md）。
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

type Page = Awaited<ReturnType<ElectronApplication['firstWindow']>>

const appDir = path.resolve(__dirname, '..')

interface TreeResult {
  text: string
  dirs: number
  files: number
  truncated: boolean
  elapsedMs: number
}

interface TouchResult {
  total: number
  updated: number
  sample: string[]
  failures: { path: string; code: string; message: string }[]
  elapsedMs: number
}

interface TempCleanResult {
  files: { path: string; size: number; mtimeMs: number }[]
  matchedBytes: number
  scannedFiles: number
  skipped: number
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

/** 提交任务并等待终态（done 返回结果；error 拒绝；同一页面内串行使用） */
async function runTask<T>(page: Page, channel: string, payload: unknown): Promise<T> {
  return page.evaluate(
    (args: { channel: string; payload: unknown }) =>
      new Promise<T>((resolve, reject) => {
        const off = window.lumin.onTaskEvent((event) => {
          if (event.kind === 'done') {
            off()
            resolve(event.result as T)
          } else if (event.kind === 'error') {
            off()
            reject(new Error(`${event.error.code}: ${event.error.message}`))
          }
        })
        window.lumin.invoke(args.channel, args.payload).catch((err: unknown) => {
          off()
          reject(err instanceof Error ? err : new Error(String(err)))
        })
      }),
    { channel, payload }
  )
}

/** Naive UI 页签无 aria role，按 data-name 定位（与 text-toolbox e2e 一致） */
function tab(page: Page, name: string): ReturnType<Page['locator']> {
  return page.locator(`.n-tabs-tab[data-name="${name}"]`)
}

test.describe('fs-cleaner（文件清理）冒烟', () => {
  test('页面加载：四页签与空态引导（未选目录）', async () => {
    const { app, page } = await launch()
    await ensureReady(page)
    try {
      // 清空记忆目录（设置跨进程持久化，避免依赖用例执行顺序）
      await page.evaluate(() =>
        window.lumin.invoke('fs-cleaner:set-config', {
          lastRoot: '',
          treeDepth: 3,
          treeExclude: [],
          tempExtensions: ['tmp', 'temp', 'log', 'bak', 'old', 'cache']
        })
      )
      await clickSidebarTool(page, '计算器')
      await clickSidebarTool(page, '文件清理')
      await expect(page.getByRole('heading', { name: '文件清理' })).toBeVisible()
      await expect(tab(page, 'tree')).toBeVisible()
      await expect(tab(page, 'empty-dirs')).toBeVisible()
      await expect(tab(page, 'touch')).toBeVisible()
      await expect(tab(page, 'temp-clean')).toBeVisible()
      await expect(tab(page, 'tree')).toContainText('目录树导出')
      await expect(tab(page, 'empty-dirs')).toContainText('空文件夹清理')
      await expect(tab(page, 'touch')).toContainText('批量改时间')
      await expect(tab(page, 'temp-clean')).toContainText('临时文件清理')
      await expect(page.getByText('选择目录后点击「生成目录树」，结果可一键复制。')).toBeVisible()
      await expect(page.getByRole('button', { name: '生成目录树' })).toBeDisabled()
    } finally {
      await app.close()
    }
  })

  test('目录树任务：深度限制与排除规则生效', async () => {
    const { app, page } = await launch()
    await ensureReady(page)
    const dir = freshDir('lumin-fc-e2e-tree')
    try {
      const nested = path.join(dir, '子目录 甲')
      fs.mkdirSync(nested, { recursive: true })
      fs.writeFileSync(path.join(dir, '根 文件.txt'), 'a')
      fs.writeFileSync(path.join(nested, '深 文件.md'), 'b')
      const ignored = path.join(dir, 'node_modules')
      fs.mkdirSync(ignored)
      fs.writeFileSync(path.join(ignored, 'x.js'), 'c')

      const full = await runTask<TreeResult>(page, 'fs-cleaner:tree', {
        root: dir,
        maxDepth: 3,
        exclude: ['node_modules']
      })
      expect(full.text).toContain('子目录 甲/')
      expect(full.text).toContain('深 文件.md')
      expect(full.text).not.toContain('node_modules')
      expect(full.dirs).toBe(1)
      expect(full.files).toBe(2)
      expect(full.truncated).toBe(false)

      const shallow = await runTask<TreeResult>(page, 'fs-cleaner:tree', {
        root: dir,
        maxDepth: 1,
        exclude: ['node_modules']
      })
      expect(shallow.text).not.toContain('深 文件.md')
      expect(shallow.truncated).toBe(true)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
      await app.close()
    }
  })

  test('UI：空文件夹扫描列出全空链路（深层在前）', async () => {
    const { app, page } = await launch()
    await ensureReady(page)
    const dir = freshDir('lumin-fc-e2e-empty')
    try {
      const chain = path.join(dir, 'empty', 'one', 'two')
      fs.mkdirSync(chain, { recursive: true })
      fs.writeFileSync(path.join(dir, 'keep.txt'), 'x')

      await clickSidebarTool(page, '文件清理')
      await page.evaluate(
        (root: string) =>
          window.lumin.invoke('fs-cleaner:set-config', {
            lastRoot: root,
            treeDepth: 3,
            treeExclude: [],
            tempExtensions: ['tmp', 'log']
          }),
        dir
      )
      // 重新进入页面触达 onMounted 读取记忆
      await clickSidebarTool(page, '计算器')
      await clickSidebarTool(page, '文件清理')
      await tab(page, 'empty-dirs').click()
      await expect(page.getByPlaceholder('选择要清理的目录')).toHaveValue(dir)

      await page.getByRole('button', { name: '扫描空文件夹' }).click()
      await expect(page.getByText('发现 3 个空文件夹')).toBeVisible({ timeout: 30_000 })
      await expect(page.getByText(path.join(dir, 'empty', 'one', 'two'))).toBeVisible()
      await expect(page.getByText(path.join(dir, 'empty'), { exact: true })).toBeVisible()
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
      await app.close()
    }
  })

  test('批量改时间：预演不改盘，应用后 mtime 生效', async () => {
    const { app, page } = await launch()
    await ensureReady(page)
    const dir = freshDir('lumin-fc-e2e-touch')
    try {
      const target = path.join(dir, 'a.txt')
      fs.writeFileSync(target, 'x')
      fs.writeFileSync(path.join(dir, 'b.log'), 'y')
      const before = fs.statSync(target).mtimeMs
      const payload = {
        root: dir,
        recursive: true,
        extensions: ['txt'],
        mtimeMs: 1_700_000_000_000,
        dryRun: true
      }

      const preview = await runTask<TouchResult>(page, 'fs-cleaner:touch', payload)
      expect(preview.total).toBe(1)
      expect(preview.updated).toBe(0)
      expect(preview.sample).toEqual([target])
      expect(fs.statSync(target).mtimeMs).toBe(before)

      const applied = await runTask<TouchResult>(page, 'fs-cleaner:touch', {
        ...payload,
        dryRun: false
      })
      expect(applied.updated).toBe(1)
      expect(applied.failures).toEqual([])
      expect(Math.abs(fs.statSync(target).mtimeMs - 1_700_000_000_000)).toBeLessThan(2000)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
      await app.close()
    }
  })

  test('临时文件清理：扩展名规则命中且不误伤', async () => {
    const { app, page } = await launch()
    await ensureReady(page)
    const dir = freshDir('lumin-fc-e2e-temp')
    try {
      const nested = path.join(dir, 'sub')
      fs.mkdirSync(nested)
      fs.writeFileSync(path.join(dir, 'debug.log'), '12345')
      fs.writeFileSync(path.join(nested, 'cache.tmp'), '1234567890')
      fs.writeFileSync(path.join(dir, 'note.txt'), 'ignored')

      const result = await runTask<TempCleanResult>(page, 'fs-cleaner:temp-clean', {
        root: dir,
        recursive: true,
        extensions: ['log', 'tmp']
      })
      expect(result.files.map((file) => file.path).sort()).toEqual(
        [path.join(dir, 'debug.log'), path.join(nested, 'cache.tmp')].sort()
      )
      expect(result.matchedBytes).toBe(15)
      expect(result.scannedFiles).toBe(3)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
      await app.close()
    }
  })

  test('错误态：根目录不存在 → FC_ROOT_INVALID 中文文案 + 重试', async () => {
    const { app, page } = await launch()
    await ensureReady(page)
    const missing = path.join(os.tmpdir(), 'lumin-fc-not-exist-2026')
    try {
      await clickSidebarTool(page, '文件清理')
      await page.evaluate(
        (root: string) =>
          window.lumin.invoke('fs-cleaner:set-config', {
            lastRoot: root,
            treeDepth: 3,
            treeExclude: [],
            tempExtensions: ['tmp', 'log']
          }),
        missing
      )
      await clickSidebarTool(page, '计算器')
      await clickSidebarTool(page, '文件清理')
      await tab(page, 'empty-dirs').click()

      await page.getByRole('button', { name: '扫描空文件夹' }).click()
      await expect(
        page.getByText('无法读取目录（不存在、不是目录或无权限）（FC_ROOT_INVALID）')
      ).toBeVisible({ timeout: 30_000 })
      await expect(page.getByRole('button', { name: '重试' })).toBeVisible()
    } finally {
      await app.close()
    }
  })
})
