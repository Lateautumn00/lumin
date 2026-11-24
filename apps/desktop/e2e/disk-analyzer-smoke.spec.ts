/**
 * @file disk-analyzer（磁盘空间分析）e2e 冒烟：真实 Electron + 真实磁盘目录
 * @author cuilanchao
 * @date 2026-11-20
 * @description 覆盖：页面加载/空态、UI 扫描/占比/下钻/面包屑返回、IPC 递归聚合口径、
 *              根目录非法（DA_ROOT_INVALID）。
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

interface DiskEntry {
  name: string
  path: string
  kind: 'dir' | 'file'
  size: number
  fileCount: number
}

interface TypeStat {
  ext: string
  files: number
  bytes: number
}

interface ScanResult {
  root: string
  entries: DiskEntry[]
  totalBytes: number
  fileCount: number
  dirCount: number
  skipped: number
  typeStats: TypeStat[]
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

/** 提交扫描任务并等待终态（done 返回结果；error 拒绝） */
async function runScan(
  page: Page,
  payload: { root: string; minFileBytes: number }
): Promise<{ hasProgress: boolean; result: ScanResult }> {
  return page.evaluate(
    (args: { root: string; minFileBytes: number }) =>
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
          .invoke<{ taskId: string }>('disk-analyzer:scan', args)
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

test.describe('disk-analyzer（磁盘空间分析）冒烟', () => {
  test('UI：空态 → 预置目录扫描 → 占比/汇总 → 下钻 → 面包屑返回', async () => {
    const { app, page } = await launch()
    await ensureReady(page)
    const dir = freshDir('lumin-da-e2e-ui')
    try {
      fs.mkdirSync(path.join(dir, 'sub'), { recursive: true })
      fs.writeFileSync(path.join(dir, 'a.txt'), 'hello')
      fs.writeFileSync(path.join(dir, 'small.txt'), '0123456789')
      fs.writeFileSync(path.join(dir, 'sub', 'b.txt'), Buffer.alloc(2048, 1))
      fs.writeFileSync(path.join(dir, 'sub', 'c.txt'), Buffer.alloc(1024, 2))

      // 清空上次记忆目录，保证空态断言与历史运行隔离
      await page.evaluate(() =>
        window.lumin.invoke('disk-analyzer:set-config', { root: '', minFileBytes: 0 })
      )
      await clickSidebarTool(page, '磁盘空间分析')
      await expect(page.getByRole('heading', { name: '磁盘空间分析' })).toBeVisible()
      // 空态：未选目录时开始扫描禁用
      await expect(
        page.getByText('先选择要分析的目录，再点击「开始扫描」')
      ).toBeVisible()
      await expect(page.getByRole('button', { name: '开始扫描' })).toBeDisabled()

      // 预置记忆目录后重新进入页面触达 mounted 读取
      await page.evaluate(
        (root: string) =>
          window.lumin.invoke('disk-analyzer:set-config', { root, minFileBytes: 0 }),
        dir
      )
      await clickSidebarTool(page, '计算器')
      await clickSidebarTool(page, '磁盘空间分析')
      await expect(page.locator('input').first()).toHaveValue(dir)

      await page.getByRole('button', { name: '开始扫描' }).click()
      // 汇总：3072 + 10 + 5 = 3087 B；4 个文件（含子目录内 2 个）、1 个子目录
      await expect(
        page.getByText('共 3.0 KB · 4 个文件 · 1 个目录 · 耗时', { exact: false })
      ).toBeVisible({ timeout: 30_000 })
      await expect(page.getByText('本层 1 个目录 · 2 个文件')).toBeVisible()
      await expect(page.getByRole('button', { name: 'sub', exact: true })).toBeVisible()
      await expect(page.getByText('99.5%', { exact: true })).toBeVisible()
      await expect(page.getByText('10 B', { exact: true })).toBeVisible()
      await expect(page.getByText('5 B', { exact: true })).toBeVisible()

      // 下钻：子目录 → 展示两个文件（2048 B / 1024 B）
      await page.getByRole('button', { name: 'sub', exact: true }).click()
      await expect(page.getByText('66.7%', { exact: true })).toBeVisible({ timeout: 30_000 })
      await expect(page.getByText('2.0 KB', { exact: true })).toBeVisible()
      await expect(page.getByText('1.0 KB', { exact: true })).toBeVisible()
      await expect(page.getByRole('button', { name: 'b.txt', exact: true })).toHaveCount(0)
      await expect(page.getByText('b.txt', { exact: true })).toBeVisible()

      // 面包屑返回起始目录
      await page.getByRole('button', { name: 'lumin-da-e2e-ui', exact: true }).click()
      await expect(page.getByText('99.5%', { exact: true })).toBeVisible({ timeout: 30_000 })
      await expect(page.getByRole('button', { name: 'sub', exact: true })).toBeVisible()
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
      await app.close()
    }
  })

  test('IPC：递归聚合口径正确 + 根目录非法 → DA_ROOT_INVALID', async () => {
    const { app, page } = await launch()
    await ensureReady(page)
    const dir = freshDir('lumin-da-e2e-ipc')
    try {
      fs.mkdirSync(path.join(dir, 'sub', 'deep'), { recursive: true })
      fs.mkdirSync(path.join(dir, 'sub2'), { recursive: true })
      fs.writeFileSync(path.join(dir, 'a.txt'), 'hello')
      fs.writeFileSync(path.join(dir, 'sub', 'b.txt'), Buffer.alloc(2048, 1))
      fs.writeFileSync(path.join(dir, 'sub', 'deep', 'c.txt'), Buffer.alloc(1024, 2))
      fs.writeFileSync(path.join(dir, 'sub2', 'd.bin'), Buffer.alloc(100, 3))

      const outcome = await runScan(page, { root: dir, minFileBytes: 0 })
      expect(outcome.hasProgress).toBe(true)
      expect(outcome.result.entries.map((entry) => entry.name)).toEqual(['sub', 'sub2', 'a.txt'])
      expect(outcome.result.entries[0]).toMatchObject({
        kind: 'dir',
        size: 3072,
        fileCount: 2
      })
      expect(outcome.result.entries[1]).toMatchObject({ kind: 'dir', size: 100, fileCount: 1 })
      expect(outcome.result.entries[2]).toMatchObject({ kind: 'file', size: 5, fileCount: 0 })
      expect(outcome.result).toMatchObject({
        totalBytes: 3177,
        fileCount: 4,
        dirCount: 3,
        skipped: 0
      })
      expect(outcome.result.typeStats).toEqual([
        { ext: 'txt', files: 3, bytes: 3077 },
        { ext: 'bin', files: 1, bytes: 100 }
      ])

      const missing = path.join(os.tmpdir(), 'lumin-da-not-exist-2026')
      const code = await page.evaluate(
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
              .invoke<{ taskId: string }>('disk-analyzer:scan', { root, minFileBytes: 0 })
              .then((value) => {
                taskId = value.taskId
              })
              .catch((err: unknown) => {
                off()
                reject(err)
              })
          }),
        missing
      )
      expect(code).toBe('DA_ROOT_INVALID')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
      await app.close()
    }
  })

  test('类型统计区可见 + 导出 CSV 落盘（BOM/表头/两张表）', async () => {
    const { app, page } = await launch()
    await ensureReady(page)
    const dir = freshDir('lumin-da-e2e-csv')
    const csvPath = path.join(os.tmpdir(), 'lumin-da-e2e-out.csv')
    try {
      fs.mkdirSync(path.join(dir, 'sub'), { recursive: true })
      fs.writeFileSync(path.join(dir, 'a.txt'), 'hello')
      fs.writeFileSync(path.join(dir, 'sub', 'b.txt'), Buffer.alloc(2048, 1))
      fs.writeFileSync(path.join(dir, 'sub', 'c.bin'), Buffer.alloc(100, 2))
      fs.rmSync(csvPath, { force: true })

      // 主进程内替换保存对话框，避免原生弹窗阻塞 e2e
      await app.evaluate(({ dialog }, target) => {
        dialog.showSaveDialog = async () => ({ canceled: false, filePath: target })
      }, csvPath)

      await page.evaluate(
        (root: string) =>
          window.lumin.invoke('disk-analyzer:set-config', { root, minFileBytes: 0 }),
        dir
      )
      await clickSidebarTool(page, '磁盘空间分析')
      await page.getByRole('button', { name: '开始扫描' }).click()
      await expect(page.getByText('文件类型统计（Top 20）')).toBeVisible({ timeout: 30_000 })
      // 统计区默认折叠，展开后断言扩展名行
      await page.getByText('文件类型统计（Top 20）').click()
      await expect(page.getByText('txt', { exact: true })).toBeVisible()
      await expect(page.getByText('bin', { exact: true })).toBeVisible()

      await page.getByRole('button', { name: '导出 CSV' }).click()
      await expect(page.getByText(`已导出 CSV：${csvPath}`)).toBeVisible({ timeout: 30_000 })

      expect(fs.existsSync(csvPath)).toBe(true)
      const content = fs.readFileSync(csvPath, 'utf8')
      expect(content.startsWith('\uFEFF# 磁盘空间分析')).toBe(true)
      expect(content).toContain('类型,名称,相对路径,大小(字节),大小(可读),文件数')
      expect(content).toContain('扩展名,文件数,大小(字节),大小(可读)')
      expect(content).toContain('txt,2,')
      expect(content).toContain('bin,1,')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
      fs.rmSync(csvPath, { force: true })
      await app.close()
    }
  })
})
