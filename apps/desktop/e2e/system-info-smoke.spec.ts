/**
 * @file system-info（系统信息）e2e 冒烟：真实 Electron
 * @author cuilanchao
 * @date 2026-11-22
 * @description 覆盖：侧边栏进入、空态引导、采集后五区展示、复制全部内容、IPC 快照契约。
 */
import path from 'node:path'
import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import { clickSidebarTool } from './sidebar'
import type { LuminBridge } from '@lumin/plugin-api'

declare global {
  interface Window {
    lumin: LuminBridge
    __copied?: string
  }
}

type Page = Awaited<ReturnType<ElectronApplication['firstWindow']>>

interface SystemSnapshot {
  collectedAt: number
  cpu: { cores: number }
  memory: { totalBytes: number }
  disks: unknown[]
  networks: unknown[]
}

const appDir = path.resolve(__dirname, '..')

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

test.describe('system-info 系统信息', () => {
  test('空态 → 采集 → 五区展示 → 复制全部', async () => {
    const { app, page } = await launch()
    try {
      await ensureReady(page)
      await clickSidebarTool(page, '系统信息')
      await expect(page.getByRole('heading', { name: '系统信息' })).toBeVisible()
      await expect(
        page.getByText('点击「采集系统信息」查看本机 CPU、内存、磁盘与网络概览')
      ).toBeVisible()

      // 剪贴板桩：避免依赖系统剪贴板状态
      await page.evaluate(() => {
        Object.defineProperty(navigator, 'clipboard', {
          configurable: true,
          value: {
            writeText: async (text: string) => {
              window.__copied = text
            }
          }
        })
      })

      await page.getByRole('button', { name: '采集系统信息' }).click()
      for (const section of ['操作系统', '处理器', '内存', '磁盘', '网络']) {
        await expect(page.getByText(section, { exact: true })).toBeVisible()
      }
      await expect(page.getByText(/^采集时间：/)).toBeVisible()

      await page.getByRole('button', { name: '复制全部' }).click()
      await page.waitForFunction(() => {
        const text = window.__copied ?? ''
        return ['操作系统', '处理器', '内存', '磁盘', '网络'].every((label) => text.includes(label))
      })
      expect(await page.evaluate(() => window.__copied ?? '')).toContain('采集时间')
    } finally {
      await app.close()
    }
  })

  test('IPC 契约：snapshot 返回有效概览', async () => {
    const { app, page } = await launch()
    try {
      await ensureReady(page)
      const snapshot = await page.evaluate(() =>
        window.lumin.invoke<SystemSnapshot>('system-info:snapshot', {})
      )
      expect(snapshot.collectedAt).toBeGreaterThan(0)
      expect(snapshot.cpu.cores).toBeGreaterThan(0)
      expect(snapshot.memory.totalBytes).toBeGreaterThan(0)
      expect(Array.isArray(snapshot.disks)).toBe(true)
      expect(Array.isArray(snapshot.networks)).toBe(true)
    } finally {
      await app.close()
    }
  })
})
