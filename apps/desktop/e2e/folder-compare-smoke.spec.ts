/**
 * @file folder-compare（文件夹对比）e2e 冒烟：真实 Electron + 真实磁盘目录
 * @author cuilanchao
 * @date 2026-11-20
 * @description 覆盖：页面加载/空态、UI 对比/汇总/四类结果/关键字筛选、IPC 配对口径与计数、
 *              根目录非法（FC_ROOT_INVALID）。
 *              注意：临时目录名必须 ASCII（非 ASCII 目录名会导致本机 Node fs 硬崩），文件名保留中文。
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
const BASE_MS = Date.UTC(2026, 0, 1)

interface CompareEntry {
  path: string
  status: 'only-left' | 'only-right' | 'different' | 'same'
  sizeLeft: number | null
  sizeRight: number | null
  mtimeLeft: number | null
  mtimeRight: number | null
  sizeChanged: boolean
  mtimeChanged: boolean
  contentChanged: boolean
}

interface CompareResult {
  leftRoot: string
  rightRoot: string
  entries: CompareEntry[]
  onlyLeft: number
  onlyRight: number
  different: number
  same: number
  leftFiles: number
  rightFiles: number
  skipped: number
  truncated: number
  compareMtime: boolean
  compareContent: boolean
  contentDifferent: number
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

/** 提交对比任务并等待终态（done 返回结果；error 拒绝） */
async function runCompare(
  page: Page,
  payload: {
    leftRoot: string
    rightRoot: string
    compareMtime: boolean
    compareContent: boolean
  }
): Promise<{ hasProgress: boolean; result: CompareResult }> {
  return page.evaluate(
    (args: {
      leftRoot: string
      rightRoot: string
      compareMtime: boolean
      compareContent: boolean
    }) =>
      new Promise<{ hasProgress: boolean; result: CompareResult }>((resolve, reject) => {
        let hasProgress = false
        let taskId = ''
        const off = window.lumin.onTaskEvent((event) => {
          if (event.taskId !== taskId) return
          if (event.kind === 'progress') {
            hasProgress = true
          } else if (event.kind === 'done') {
            off()
            resolve({ hasProgress, result: event.result as CompareResult })
          } else if (event.kind === 'error') {
            off()
            reject(new Error(`${event.error.code}: ${event.error.message}`))
          }
        })
        window.lumin
          .invoke<{ taskId: string }>('folder-compare:compare', args)
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

test.describe('folder-compare（文件夹对比）冒烟', () => {
  test('UI：空态 → 预置左右目录对比 → 汇总/四类结果 → 关键字筛选', async () => {
    const { app, page } = await launch()
    await ensureReady(page)
    const left = freshDir('lumin-fc-e2e-ui-left')
    const right = freshDir('lumin-fc-e2e-ui-right')
    try {
      writeFile(left, 'same.txt', 'abcd')
      writeFile(left, 'size.txt', 'abcd')
      writeFile(left, 'only-left.txt', 'x')
      writeFile(left, 'nested/deep/x.txt', '11')
      writeFile(right, 'same.txt', 'wxyz')
      writeFile(right, 'size.txt', 'abcdef')
      writeFile(right, 'only-right.txt', 'y')
      writeFile(right, 'nested/deep/x.txt', '22')
      for (const rel of ['same.txt', 'size.txt', 'only-left.txt', 'nested/deep/x.txt']) {
        touch(left, rel, BASE_MS)
      }
      for (const rel of ['same.txt', 'size.txt', 'only-right.txt', 'nested/deep/x.txt']) {
        touch(right, rel, BASE_MS)
      }

      // 清空上次记忆目录，保证空态断言与历史运行隔离
      await page.evaluate(() =>
        window.lumin.invoke('folder-compare:set-config', {
          leftRoot: '',
          rightRoot: '',
          compareMtime: true,
          compareContent: false
        })
      )
      await clickSidebarTool(page, '文件夹对比')
      await expect(page.getByRole('heading', { name: '文件夹对比' })).toBeVisible()
      await expect(
        page.getByText(
          '先选择左右两个目录，再点击「开始对比」；默认只比较元数据，勾选「比较文件内容」后对同名同大小文件做 SHA-256'
        )
      ).toBeVisible()
      await expect(page.getByRole('button', { name: '开始对比' })).toBeDisabled()

      // 预置记忆目录后重新进入页面触达 mounted 读取
      await page.evaluate(
        (args: { left: string; right: string }) =>
          window.lumin.invoke('folder-compare:set-config', {
            leftRoot: args.left,
            rightRoot: args.right,
            compareMtime: true,
            compareContent: false
          }),
        { left, right }
      )
      await clickSidebarTool(page, '计算器')
      await clickSidebarTool(page, '文件夹对比')
      await expect(page.locator('input').first()).toHaveValue(left)

      await page.getByRole('button', { name: '开始对比' }).click()
      // 仅左侧 1 · 仅右侧 1 · 有差异 1（大小）· 相同 2（same.txt / nested/deep/x.txt）
      await expect(
        page.getByText('仅左侧 1 · 仅右侧 1 · 有差异 1 · 相同 2', { exact: false })
      ).toBeVisible({ timeout: 30_000 })
      await expect(page.getByText('左侧 4 个文件 · 右侧 4 个文件')).toBeVisible()
      await expect(page.getByText('only-left.txt', { exact: true })).toBeVisible()
      await expect(page.getByText('only-right.txt', { exact: true })).toBeVisible()
      await expect(page.getByText('size.txt', { exact: true })).toBeVisible()
      await expect(page.getByText('nested/deep/x.txt', { exact: true })).toBeVisible()
      await expect(page.getByText('仅左侧', { exact: true })).toBeVisible()
      await expect(page.getByText('仅右侧', { exact: true })).toBeVisible()
      await expect(page.getByText('大小不同', { exact: true })).toBeVisible()
      await expect(page.getByText('相同', { exact: true }).first()).toBeVisible()

      // 关键字筛选：仅 size.txt 命中
      await page.getByPlaceholder('按相对路径筛选').fill('size')
      await expect(page.getByText('共 1 条 · 展示 1 条')).toBeVisible()
      await expect(page.getByText('only-left.txt', { exact: true })).toHaveCount(0)
      await expect(page.getByText('size.txt', { exact: true })).toBeVisible()

      await page.getByPlaceholder('按相对路径筛选').fill('')
      await expect(page.getByText('共 5 条 · 展示 5 条')).toBeVisible()
    } finally {
      fs.rmSync(left, { recursive: true, force: true })
      fs.rmSync(right, { recursive: true, force: true })
      await app.close()
    }
  })

  test('IPC：配对口径/计数正确 + 关闭时间比较 + 根目录非法 → FC_ROOT_INVALID', async () => {
    const { app, page } = await launch()
    await ensureReady(page)
    const left = freshDir('lumin-fc-e2e-ipc-left')
    const right = freshDir('lumin-fc-e2e-ipc-right')
    try {
      writeFile(left, 'same.txt', 'abcd')
      writeFile(left, 'mtime.txt', 'abcd')
      writeFile(left, 'only-left.txt', 'x')
      writeFile(left, 'sub/x.txt', '11')
      writeFile(right, 'same.txt', 'wxyz')
      writeFile(right, 'mtime.txt', 'abcd')
      writeFile(right, 'only-right.txt', 'y')
      writeFile(right, 'sub/x.txt', '22')
      for (const rel of ['same.txt', 'only-left.txt', 'sub/x.txt']) touch(left, rel, BASE_MS)
      for (const rel of ['same.txt', 'only-right.txt', 'sub/x.txt']) touch(right, rel, BASE_MS)
      touch(left, 'mtime.txt', BASE_MS)
      touch(right, 'mtime.txt', BASE_MS + 5000)

      const outcome = await runCompare(page, {
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
        leftFiles: 4,
        rightFiles: 4,
        skipped: 0,
        truncated: 0,
        compareMtime: true
      })
      const byPath = new Map(outcome.result.entries.map((entry) => [entry.path, entry]))
      expect(byPath.get('only-left.txt')).toMatchObject({ status: 'only-left', sizeLeft: 1 })
      expect(byPath.get('only-right.txt')).toMatchObject({ status: 'only-right', sizeRight: 1 })
      expect(byPath.get('mtime.txt')).toMatchObject({
        status: 'different',
        sizeChanged: false,
        mtimeChanged: true,
        contentChanged: false
      })
      expect(byPath.get('sub/x.txt')).toMatchObject({ status: 'same' })

      // 关闭修改时间比较：mtime.txt 归为相同
      const ignored = await runCompare(page, {
        leftRoot: left,
        rightRoot: right,
        compareMtime: false,
        compareContent: false
      })
      expect(ignored.result).toMatchObject({ different: 0, same: 3 })

      const missing = path.join(os.tmpdir(), 'lumin-fc-not-exist-2026')
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
              .invoke<{ taskId: string }>('folder-compare:compare', {
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
        { leftRoot: missing, rightRoot: right }
      )
      expect(code).toBe('FC_ROOT_INVALID')
    } finally {
      fs.rmSync(left, { recursive: true, force: true })
      fs.rmSync(right, { recursive: true, force: true })
      await app.close()
    }
  })

  test('内容比较：同名同大小内容不同 → 内容不同（IPC + UI）', async () => {
    const { app, page } = await launch()
    await ensureReady(page)
    const left = freshDir('lumin-fc-e2e-content-left')
    const right = freshDir('lumin-fc-e2e-content-right')
    try {
      const bigHead = 'a'.repeat(70 * 1024 - 1)
      writeFile(left, 'diff.txt', 'abcd')
      writeFile(right, 'diff.txt', 'wxyz')
      writeFile(left, 'same.txt', 'hello')
      writeFile(right, 'same.txt', 'hello')
      writeFile(left, 'big.txt', `${bigHead}b`)
      writeFile(right, 'big.txt', `${bigHead}c`)
      for (const rel of ['diff.txt', 'same.txt', 'big.txt']) {
        touch(left, rel, BASE_MS)
        touch(right, rel, BASE_MS)
      }

      const outcome = await runCompare(page, {
        leftRoot: left,
        rightRoot: right,
        compareMtime: true,
        compareContent: true
      })
      expect(outcome.result).toMatchObject({
        compareContent: true,
        contentDifferent: 2,
        different: 2,
        same: 1
      })
      const byPath = new Map(outcome.result.entries.map((entry) => [entry.path, entry]))
      expect(byPath.get('diff.txt')).toMatchObject({ status: 'different', contentChanged: true })
      expect(byPath.get('same.txt')).toMatchObject({ status: 'same', contentChanged: false })
      expect(byPath.get('big.txt')).toMatchObject({ status: 'different', contentChanged: true })

      // UI：预置内容比较开关后重进页面，点击开始对比展示「内容不同」
      await page.evaluate(
        (args: { left: string; right: string }) =>
          window.lumin.invoke('folder-compare:set-config', {
            leftRoot: args.left,
            rightRoot: args.right,
            compareMtime: true,
            compareContent: true
          }),
        { left, right }
      )
      await clickSidebarTool(page, '计算器')
      await clickSidebarTool(page, '文件夹对比')
      await expect(page.getByText('比较文件内容（SHA-256，较慢）')).toBeVisible()
      await page.getByRole('button', { name: '开始对比' }).click()
      await expect(page.getByText('内容不同 2', { exact: false })).toBeVisible({ timeout: 30_000 })
      await expect(page.getByText('内容不同', { exact: true }).first()).toBeVisible()
    } finally {
      fs.rmSync(left, { recursive: true, force: true })
      fs.rmSync(right, { recursive: true, force: true })
      await app.close()
    }
  })
})
