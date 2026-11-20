/**
 * @file text-diff（文本对比）e2e 冒烟：真实 Electron 驱动页面交互
 * @author cuilanchao
 * @date 2026-11-20
 * @description 覆盖：页面加载与空态引导、示例与差异统计、忽略大小写/并排与统一视图、
 *              统一 diff 复制、交换/清空、超限报错与恢复。
 */
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

async function launch(): Promise<{
  app: ElectronApplication
  page: Awaited<ReturnType<ElectronApplication['firstWindow']>>
}> {
  const app = await electron.launch({ args: ['.'], cwd: appDir })
  const page = await app.firstWindow()
  return { app, page }
}

/** 等待壳渲染层就绪（window.lumin 暴露完成后才可安全操作） */
async function ensureReady(
  page: Awaited<ReturnType<ElectronApplication['firstWindow']>>
): Promise<void> {
  await page.waitForLoadState('domcontentloaded')
  await page.waitForFunction(() => typeof window.lumin !== 'undefined')
}

test.describe('text-diff（文本对比）冒烟', () => {
  test('页面加载 + 空态引导 + 示例差异统计与并排视图', async () => {
    const { app, page } = await launch()
    await ensureReady(page)
    try {
      await clickSidebarTool(page, '文本对比')
      await expect(page.getByRole('heading', { name: '文本对比' })).toBeVisible()
      await expect(page.locator('[data-empty-state]')).toContainText('粘贴或输入左右两段文本')

      await page.getByRole('button', { name: '示例' }).click()
      await expect(page.locator('[data-empty-state]')).toHaveCount(0)
      await expect(page.locator('[data-stat-added]')).toHaveText('+3')
      await expect(page.locator('[data-stat-removed]')).toHaveText('-2')
      await expect(page.locator('[data-stat-unchanged]')).toHaveText('2')

      await expect(page.locator('[data-diff-side-by-side]')).toBeVisible()
      await expect(page.locator('[data-diff-row]')).toHaveCount(5)
    } finally {
      await app.close()
    }
  })

  test('忽略大小写联动 + 并排/统一视图切换', async () => {
    const { app, page } = await launch()
    await ensureReady(page)
    try {
      await clickSidebarTool(page, '文本对比')
      await page.getByPlaceholder('粘贴左侧文本…').fill('Alpha\nBeta')
      await page.getByPlaceholder('粘贴右侧文本…').fill('alpha\nGamma')

      // 区分大小写：两行全部不同
      await expect(page.locator('[data-stat-added]')).toHaveText('+2')
      await expect(page.locator('[data-stat-removed]')).toHaveText('-2')
      await expect(page.locator('[data-stat-unchanged]')).toHaveText('0')

      // 忽略大小写：首行视为相同
      await page.getByText('忽略大小写', { exact: true }).click()
      await expect(page.locator('[data-stat-added]')).toHaveText('+1')
      await expect(page.locator('[data-stat-removed]')).toHaveText('-1')
      await expect(page.locator('[data-stat-unchanged]')).toHaveText('1')

      // 统一视图
      await page.getByText('统一', { exact: true }).click()
      await expect(page.locator('[data-unified-diff]')).toBeVisible()
      await expect(page.locator('[data-diff-side-by-side]')).toHaveCount(0)
      const unified = page.locator('[data-unified-diff]')
      await expect(page.locator('[data-unified-row]')).toHaveCount(3)
      await expect(unified).toContainText('-Beta')
      await expect(unified).toContainText('+Gamma')
    } finally {
      await app.close()
    }
  })

  test('复制统一 diff 到剪贴板 + 交换 + 清空恢复空态', async () => {
    const { app, page } = await launch()
    await ensureReady(page)
    try {
      await clickSidebarTool(page, '文本对比')
      await page.getByRole('button', { name: '示例' }).click()
      await page.getByText('统一', { exact: true }).click()
      await page.getByRole('button', { name: /复制统一 diff/ }).click()

      const clipboardText = await app.evaluate(({ clipboard }) => clipboard.readText())
      expect(clipboardText).toContain('+++ 右侧')
      expect(clipboardText).toContain('-香蕉')

      // 交换左右
      const leftInput = page.getByPlaceholder('粘贴左侧文本…')
      const rightInput = page.getByPlaceholder('粘贴右侧文本…')
      await leftInput.fill('A')
      await rightInput.fill('B')
      await page.getByRole('button', { name: '交换' }).click()
      await expect(leftInput).toHaveValue('B')
      await expect(rightInput).toHaveValue('A')

      // 清空 → 空态
      await page.getByRole('button', { name: '清空' }).click()
      await expect(leftInput).toHaveValue('')
      await expect(rightInput).toHaveValue('')
      await expect(page.locator('[data-empty-state]')).toBeVisible()
    } finally {
      await app.close()
    }
  })

  test('超限报错与清空恢复', async () => {
    const { app, page } = await launch()
    await ensureReady(page)
    try {
      await clickSidebarTool(page, '文本对比')
      const oversized = Array.from({ length: 20_001 }, () => 'a').join('\n')
      const leftInput = page.getByPlaceholder('粘贴左侧文本…')
      await leftInput.evaluate((element, value) => {
        const textarea = element as HTMLTextAreaElement
        textarea.value = value
        textarea.dispatchEvent(new Event('input', { bubbles: true }))
      }, oversized)

      await expect(page.getByRole('alert')).toContainText('TD_TOO_LARGE')
      await expect(page.locator('[data-stats]')).toHaveCount(0)
      await expect(page.locator('[data-diff-side-by-side]')).toHaveCount(0)

      await page.getByRole('button', { name: '清空' }).click()
      await expect(page.getByRole('alert')).toHaveCount(0)
      await expect(page.locator('[data-empty-state]')).toBeVisible()
    } finally {
      await app.close()
    }
  })
})
