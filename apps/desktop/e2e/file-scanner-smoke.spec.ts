/**
 * @file file-scanner（文件扫描：校验 / 重复 / 对比）e2e 冒烟：真实 Electron + 真实磁盘
 * @author cuilanchao
 * @date 2026-11-25
 * @description M71 三工具合并后的单入口冒烟：页面/三页签加载、哈希四算法与期望值比对、
 *              重复文件递归分组与 UI 勾选、目录对比配对/内容比较/筛选、结构化错误码、
 *              任务取消、3 任务并发、断电恢复（强杀重启）。
 *              注意：临时目录名必须 ASCII（本机 Node fs 对非 ASCII 目录名会硬崩），文件名保留中文。
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
const BASE_MS = Date.UTC(2026, 0, 1)

/** 'abc' 的标准摘要（RFC 测试向量） */
const ABC = {
  md5: '900150983cd24fb0d6963f7d28e17f72',
  sha1: 'a9993e364706816aba3e25717850c26c9cd0d89d',
  sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  sha512:
    'ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f'
}

interface HashResult {
  results: {
    path: string
    size: number
    hashes: { md5?: string; sha1?: string; sha256?: string; sha512?: string }
    status: 'ok' | 'failed'
    code?: string
  }[]
  failedCount: number
  totalBytes: number
}

interface ScanResult {
  groups: { size: number; hash: string; files: { path: string }[]; wastedBytes: number }[]
  scannedFiles: number
  totalWastedBytes: number
}

interface CompareResult {
  entries: { path: string; status: string }[]
  onlyLeft: number
  onlyRight: number
  different: number
  same: number
  truncated: number
  contentDifferent: number
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

/** 写文件（自动建父目录） */
function writeFile(root: string, rel: string, content: string): void {
  const target = path.join(root, rel)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, content)
}

/** 设置修改时间（毫秒） */
function touch(root: string, rel: string, mtimeMs: number): void {
  const seconds = mtimeMs / 1000
  fs.utimesSync(path.join(root, rel), seconds, seconds)
}

/** 切换页签（Naive UI 的 tab 节点没有 role=tab，按 .n-tabs-tab 文本定位） */
async function switchTab(page: Page, name: '文件校验' | '重复文件' | '目录对比'): Promise<void> {
  await page.locator('.n-tabs-tab', { hasText: name }).first().click()
}

/** 打开工具并可指定页签（侧边栏两次切换以触达 mounted 读取记忆） */
async function openTool(page: Page, tab?: '文件校验' | '重复文件' | '目录对比'): Promise<void> {
  await clickSidebarTool(page, '文件扫描')
  if (tab !== undefined) await switchTab(page, tab)
}

/** 记忆配置后重进页面并切到指定页签 */
async function reopenTool(page: Page, tab: '文件校验' | '重复文件' | '目录对比'): Promise<void> {
  await clickSidebarTool(page, '计算器')
  await openTool(page, tab)
}

/** 提交任务并等待终态（done 返回结果；error 拒绝） */
async function runTask<T>(
  page: Page,
  channel: string,
  payload: unknown
): Promise<{ hasProgress: boolean; result: T }> {
  return page.evaluate(
    (args: { channel: string; payload: unknown }) =>
      new Promise<{ hasProgress: boolean; result: T }>((resolve, reject) => {
        let hasProgress = false
        let taskId = ''
        const off = window.lumin.onTaskEvent((event) => {
          if (event.taskId !== taskId) return
          if (event.kind === 'progress') {
            hasProgress = true
          } else if (event.kind === 'done') {
            off()
            resolve({ hasProgress, result: event.result as T })
          } else if (event.kind === 'error') {
            off()
            reject(new Error(`${event.error.code}: ${event.error.message}`))
          }
        })
        window.lumin
          .invoke<{ taskId: string }>(args.channel, args.payload)
          .then((value) => {
            taskId = value.taskId
          })
          .catch((err: unknown) => {
            off()
            reject(err)
          })
      }),
    { channel, payload }
  )
}

/** 提交任务后立即取消，返回终态（done 或错误码） */
async function runAndCancel(page: Page, channel: string, payload: unknown): Promise<string> {
  return page.evaluate(
    (args: { channel: string; payload: unknown }) =>
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
          .invoke<{ taskId: string }>(args.channel, args.payload)
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
    { channel, payload }
  )
}

test.describe('file-scanner（文件扫描）冒烟', () => {
  test('页面加载 + 三页签 + 各页签空态引导', async () => {
    const { app, page } = await launch()
    await ensureReady(page)
    try {
      // 清空历史记忆（同一 userData 跨用例复用），保证三页签都是未选择状态
      await page.evaluate(async () => {
        await window.lumin.invoke('file-scanner:dup-set-config', {
          root: '',
          recursive: true,
          minBytes: 1024 * 1024
        })
        await window.lumin.invoke('file-scanner:compare-set-config', {
          leftRoot: '',
          rightRoot: '',
          compareMtime: true,
          compareContent: false
        })
      })
      await openTool(page)
      await expect(page.getByRole('heading', { name: '文件扫描' })).toBeVisible()
      await expect(page.locator('.n-tabs-tab', { hasText: '文件校验' })).toBeVisible()
      await expect(page.locator('.n-tabs-tab', { hasText: '重复文件' })).toBeVisible()
      await expect(page.locator('.n-tabs-tab', { hasText: '目录对比' })).toBeVisible()
      await expect(page.getByText('添加文件后点击「开始校验」，即可获得哈希值')).toBeVisible()

      await switchTab(page, '重复文件')
      await expect(page.getByText('先选择要扫描的目录，再点击「开始扫描」')).toBeVisible()
      await expect(page.getByRole('button', { name: '开始扫描' })).toBeDisabled()

      await switchTab(page, '目录对比')
      await expect(
        page.getByText(
          '先选择左右两个目录，再点击「开始对比」；默认只比较元数据，勾选「比较文件内容」后对同名同大小文件做 SHA-256'
        )
      ).toBeVisible()
      await expect(page.getByRole('button', { name: '开始对比' })).toBeDisabled()
    } finally {
      await app.close()
    }
  })

  test('文件校验：中文+空格路径四算法已知值 + 不可读项逐项失败', async () => {
    const { app, page } = await launch()
    await ensureReady(page)
    const dir = freshDir('lumin-fs-e2e-hash')
    try {
      const first = path.join(dir, '文件 一.txt')
      const second = path.join(dir, '文件 二.txt')
      fs.writeFileSync(first, 'abc')
      fs.writeFileSync(second, 'abc')

      const outcome = await runTask<HashResult>(page, 'file-scanner:hash', {
        paths: [first, second],
        algorithms: ['md5', 'sha1', 'sha256', 'sha512']
      })
      expect(outcome.hasProgress).toBe(true)
      expect(outcome.result.results.map((item) => item.path)).toEqual([first, second])
      expect(firstOf(outcome.result.results).hashes).toMatchObject(ABC)
      expect(outcome.result.failedCount).toBe(0)
      expect(outcome.result.totalBytes).toBe(6)

      const missing = path.join(dir, 'missing.txt')
      const folder = path.join(dir, 'folder')
      fs.mkdirSync(folder)
      const failed = await runTask<HashResult>(page, 'file-scanner:hash', {
        paths: [missing, first, folder],
        algorithms: ['sha256']
      })
      expect(failed.result.failedCount).toBe(2)
      expect(failed.result.results[0]).toMatchObject({
        path: missing,
        status: 'failed',
        code: 'FH_FILE_INVALID'
      })
      expect(failed.result.results[1]).toMatchObject({ path: first, status: 'ok' })
      expect(failed.result.results[2]).toMatchObject({ path: folder, status: 'failed' })
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
      await app.close()
    }
  })

  test('文件校验 UI：四算法记忆 + 选文件计算 + 期望哈希比对命中', async () => {
    const { app, page } = await launch()
    await ensureReady(page)
    const dir = freshDir('lumin-fs-e2e-hash-ui')
    try {
      const target = path.join(dir, '文件 一.txt')
      fs.writeFileSync(target, 'abc')

      await page.evaluate(() =>
        window.lumin.invoke('file-scanner:hash-set-config', {
          algorithms: ['md5', 'sha1', 'sha256', 'sha512']
        })
      )
      await reopenTool(page, '文件校验')
      const sha512Checkbox = page.locator('.n-checkbox', { hasText: 'SHA-512' }).first()
      await expect(sha512Checkbox).toHaveClass(/n-checkbox--checked/)

      await page.locator('input[type=file]').setInputFiles(target)
      await expect(page.getByText('已选 1 / 200 个文件')).toBeVisible()
      await page.getByRole('button', { name: '开始校验' }).click()

      await expect(page.getByText(ABC.md5)).toBeVisible({ timeout: 30_000 })
      await expect(page.getByText(ABC.sha512)).toBeVisible()

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

  test('重复文件：递归分组/非递归阈值/根目录非法', async () => {
    const { app, page } = await launch()
    await ensureReady(page)
    const dir = freshDir('lumin-fs-e2e-dup')
    try {
      const first = path.join(dir, '文件 一.txt')
      const second = path.join(dir, '文件 二.txt')
      const third = path.join(dir, '子目录 甲', '文件 三.txt')
      writeFile(dir, '文件 一.txt', 'abcdef')
      writeFile(dir, '文件 二.txt', 'abcdef')
      writeFile(dir, '子目录 甲/文件 三.txt', 'abcdef')
      writeFile(dir, '不同.txt', 'xyz')

      const recursive = await runTask<ScanResult>(page, 'file-scanner:dup-scan', {
        root: dir,
        recursive: true,
        minBytes: 1
      })
      expect(recursive.result.groups).toHaveLength(1)
      const group = firstOf(recursive.result.groups)
      expect(group.hash).toBe(createHash('sha256').update('abcdef').digest('hex'))
      expect(group.files.map((file) => file.path).sort()).toEqual([first, second, third].sort())
      expect(recursive.result.totalWastedBytes).toBe(12)

      const flat = await runTask<ScanResult>(page, 'file-scanner:dup-scan', {
        root: dir,
        recursive: false,
        minBytes: 1
      })
      expect(firstOf(flat.result.groups).files).toHaveLength(2)

      const filtered = await runTask<ScanResult>(page, 'file-scanner:dup-scan', {
        root: dir,
        recursive: true,
        minBytes: 100
      })
      expect(filtered.result.groups).toEqual([])

      const invalid = await page.evaluate(
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
              .invoke<{ taskId: string }>('file-scanner:dup-scan', {
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
        path.join(os.tmpdir(), 'lumin-fs-not-exist-2026')
      )
      expect(invalid).toBe('DF_ROOT_INVALID')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
      await app.close()
    }
  })

  test('重复文件 UI：预置目录扫描 + 默认保留最早一份 + 全选/全不选', async () => {
    const { app, page } = await launch()
    await ensureReady(page)
    const dir = freshDir('lumin-fs-e2e-dup-ui')
    try {
      writeFile(dir, '最早 文件.txt', 'abcdef')
      writeFile(dir, '较新 文件.txt', 'abcdef')
      const old = new Date('2026-01-01T00:00:00Z')
      fs.utimesSync(path.join(dir, '最早 文件.txt'), old, old)

      await page.evaluate(
        (root: string) =>
          window.lumin.invoke('file-scanner:dup-set-config', {
            root,
            recursive: true,
            minBytes: 1
          }),
        dir
      )
      await reopenTool(page, '重复文件')
      await expect(page.getByPlaceholder('选择要扫描的目录')).toHaveValue(dir)

      await page.getByRole('button', { name: '开始扫描' }).click()
      await expect(page.getByText('第 1 组 · 6 B × 2')).toBeVisible({ timeout: 30_000 })
      await expect(page.getByRole('button', { name: '移入回收站（1）' })).toBeEnabled()

      await page.getByRole('button', { name: '全选' }).click()
      await expect(page.getByRole('button', { name: '移入回收站（2）' })).toBeEnabled()
      await page.getByRole('button', { name: '全不选' }).click()
      await expect(page.getByRole('button', { name: '移入回收站（0）' })).toBeDisabled()

      await page.getByRole('button', { name: '保留每组最早一份' }).click()
      const earliestRow = page.locator('.df-file').filter({ hasText: '最早 文件.txt' }).first()
      const newerRow = page.locator('.df-file').filter({ hasText: '较新 文件.txt' }).first()
      await expect(earliestRow.locator('.n-checkbox')).not.toHaveClass(/n-checkbox--checked/)
      await expect(newerRow.locator('.n-checkbox')).toHaveClass(/n-checkbox--checked/)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
      await app.close()
    }
  })

  test('目录对比：配对计数/关闭时间比较/内容比较/根目录非法', async () => {
    const { app, page } = await launch()
    await ensureReady(page)
    const left = freshDir('lumin-fs-e2e-cmp-left')
    const right = freshDir('lumin-fs-e2e-cmp-right')
    try {
      writeFile(left, 'same.txt', 'abcd')
      writeFile(left, 'mtime.txt', 'abcd')
      writeFile(left, 'only-left.txt', 'x')
      writeFile(left, 'content.txt', 'abcd')
      writeFile(right, 'same.txt', 'wxyz')
      writeFile(right, 'mtime.txt', 'abcd')
      writeFile(right, 'only-right.txt', 'y')
      writeFile(right, 'content.txt', 'wxyz')
      for (const rel of ['same.txt', 'only-left.txt', 'content.txt']) touch(left, rel, BASE_MS)
      for (const rel of ['same.txt', 'only-right.txt', 'content.txt']) touch(right, rel, BASE_MS)
      touch(left, 'mtime.txt', BASE_MS)
      touch(right, 'mtime.txt', BASE_MS + 5000)

      const outcome = await runTask<CompareResult>(page, 'file-scanner:compare', {
        leftRoot: left,
        rightRoot: right,
        compareMtime: true,
        compareContent: false
      })
      expect(outcome.hasProgress).toBe(true)
      expect(outcome.result).toMatchObject({
        onlyLeft: 1,
        onlyRight: 1,
        different: 1,
        same: 2,
        truncated: 0
      })

      const ignored = await runTask<CompareResult>(page, 'file-scanner:compare', {
        leftRoot: left,
        rightRoot: right,
        compareMtime: false,
        compareContent: false
      })
      expect(ignored.result).toMatchObject({ different: 0, same: 3 })

      const content = await runTask<CompareResult>(page, 'file-scanner:compare', {
        leftRoot: left,
        rightRoot: right,
        compareMtime: true,
        compareContent: true
      })
      expect(content.result).toMatchObject({ compareContent: true, contentDifferent: 2 })

      const code = await page.evaluate(
        (args: { leftRoot: string; rightRoot: string }) =>
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
              .invoke<{ taskId: string }>('file-scanner:compare', {
                leftRoot: args.leftRoot,
                rightRoot: args.rightRoot,
                compareMtime: true,
                compareContent: false
              })
              .then((value) => {
                taskId = value.taskId
              })
              .catch((err: unknown) => {
                off()
                reject(err)
              })
          }),
        { leftRoot: path.join(os.tmpdir(), 'lumin-fs-cmp-not-exist-2026'), rightRoot: right }
      )
      expect(code).toBe('FC_ROOT_INVALID')
    } finally {
      fs.rmSync(left, { recursive: true, force: true })
      fs.rmSync(right, { recursive: true, force: true })
      await app.close()
    }
  })

  test('目录对比 UI：预置左右目录 → 汇总 + 关键字筛选', async () => {
    const { app, page } = await launch()
    await ensureReady(page)
    const left = freshDir('lumin-fs-e2e-cmp-ui-left')
    const right = freshDir('lumin-fs-e2e-cmp-ui-right')
    try {
      writeFile(left, 'same.txt', 'abcd')
      writeFile(left, 'size.txt', 'abcd')
      writeFile(left, 'only-left.txt', 'x')
      writeFile(left, 'nested/deep/x.txt', '11')
      writeFile(right, 'same.txt', 'wxyz')
      writeFile(right, 'size.txt', 'abcdef')
      writeFile(right, 'only-right.txt', 'y')
      writeFile(right, 'nested/deep/x.txt', '11')
      for (const rel of ['same.txt', 'size.txt', 'only-left.txt', 'nested/deep/x.txt']) {
        touch(left, rel, BASE_MS)
      }
      for (const rel of ['same.txt', 'size.txt', 'only-right.txt', 'nested/deep/x.txt']) {
        touch(right, rel, BASE_MS)
      }

      await page.evaluate(
        (args: { left: string; right: string }) =>
          window.lumin.invoke('file-scanner:compare-set-config', {
            leftRoot: args.left,
            rightRoot: args.right,
            compareMtime: true,
            compareContent: false
          }),
        { left, right }
      )
      await reopenTool(page, '目录对比')
      await expect(page.getByPlaceholder('选择左侧目录')).toHaveValue(left)

      await page.getByRole('button', { name: '开始对比' }).click()
      await expect(
        page.getByText('仅左侧 1 · 仅右侧 1 · 有差异 1 · 相同 2', { exact: false })
      ).toBeVisible({ timeout: 30_000 })
      await expect(page.getByText('左侧 4 个文件 · 右侧 4 个文件')).toBeVisible()

      await page.getByPlaceholder('按相对路径筛选').fill('size')
      await expect(page.getByText('共 1 条 · 展示 1 条')).toBeVisible()
      await expect(page.getByText('only-left.txt', { exact: true })).toHaveCount(0)
      await page.getByPlaceholder('按相对路径筛选').fill('')
      await expect(page.getByText('共 5 条 · 展示 5 条')).toBeVisible()
    } finally {
      fs.rmSync(left, { recursive: true, force: true })
      fs.rmSync(right, { recursive: true, force: true })
      await app.close()
    }
  })

  test('取消 + 3 任务并发：终态正确且互不干扰', async () => {
    const { app, page } = await launch()
    await ensureReady(page)
    const dir = freshDir('lumin-fs-e2e-task')
    try {
      const big = path.join(dir, 'big.bin')
      fs.writeFileSync(big, Buffer.alloc(128 * 1024 * 1024, 3))
      const cancelTarget = path.join(dir, 'cancel.bin')
      fs.writeFileSync(cancelTarget, Buffer.alloc(64 * 1024 * 1024, 4))

      const terminal = await runAndCancel(page, 'file-scanner:hash', {
        paths: [cancelTarget],
        algorithms: ['sha256']
      })
      expect(['done', 'CANCELLED']).toContain(terminal)

      const roots = [0, 1, 2].map((index) => {
        const sub = path.join(dir, `root${index}`)
        writeFile(sub, 'a.txt', `payload-${index}`)
        writeFile(sub, 'b.txt', `payload-${index}`)
        return sub
      })
      const outcome = await page.evaluate(
        (args: string[]) =>
          new Promise<{ terminals: string[]; wasted: number[] }>((resolve, reject) => {
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
                window.lumin.invoke<{ taskId: string }>('file-scanner:dup-scan', {
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

  test('断电恢复：哈希中途强杀主进程，重启后可重新计算', async () => {
    const dir = freshDir('lumin-fs-e2e-crash')
    const target = path.join(dir, 'big.bin')
    fs.writeFileSync(target, Buffer.alloc(128 * 1024 * 1024, 2))
    const first = await launch()
    try {
      await ensureReady(first.page)
      const pending = first.page
        .evaluate(
          (value: string) =>
            window.lumin
              .invoke('file-scanner:hash', { paths: [value], algorithms: ['sha256'] })
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
      const outcome = await runTask<HashResult>(second.page, 'file-scanner:hash', {
        paths: [target],
        algorithms: ['sha256']
      })
      const item = firstOf(outcome.result.results)
      expect(item.status).toBe('ok')
      expect(item.hashes.sha256).toMatch(/^[0-9a-f]{64}$/)
      expect(outcome.result.totalBytes).toBe(128 * 1024 * 1024)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
      await second.app.close()
    }
  })
})
