/**
 * @file misc-toolbox（实用工具）e2e 冒烟：真实 Electron 驱动页面交互（spec §5）
 * @author cuilanchao
 * @date 2026-11-21
 * @description 覆盖：两页签可见、CIDR /24 计算、/33 报错码 → 中文文案、秒表开始/重置、番茄钟默认 25:00 与递减。
 *              纯 renderer 工具，零 IPC。
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

/** 进入「实用工具」并切到「计时器」页签 */
async function openTimerTab(
  page: Awaited<ReturnType<ElectronApplication['firstWindow']>>
): Promise<void> {
  await clickSidebarTool(page, '实用工具')
  await page.locator('.n-tabs-tab[data-name="timer"]').click()
}

test.describe('misc-toolbox（实用工具）冒烟', () => {
  test('侧栏「实用工具」可进入，两页签均可见', async () => {
    const { app, page } = await launch()
    await ensureReady(page)
    try {
      await clickSidebarTool(page, '实用工具')
      await expect(page.getByRole('heading', { name: '实用工具' })).toBeVisible()
      await expect(page.locator('.n-tabs-tab[data-name="ip"]')).toBeVisible()
      await expect(page.locator('.n-tabs-tab[data-name="timer"]')).toBeVisible()
      await expect(page.getByText('输入 CIDR（如 192.168.1.0/24）', { exact: false })).toBeVisible()
    } finally {
      await app.close()
    }
  })

  test('CIDR 192.168.1.10/24 → 网络/广播/主机数正确', async () => {
    const { app, page } = await launch()
    await ensureReady(page)
    try {
      await clickSidebarTool(page, '实用工具')
      await page.getByPlaceholder('输入 CIDR，如 192.168.1.0/24').fill('192.168.1.10/24')
      await page.getByRole('button', { name: '计算', exact: true }).click()

      await expect(page.getByText('192.168.1.0', { exact: true }).first()).toBeVisible()
      await expect(page.getByText('192.168.1.255', { exact: true }).first()).toBeVisible()
      await expect(page.getByText('254', { exact: true }).first()).toBeVisible()
      await expect(page.getByText(/已按掩码归一化网络地址/)).toBeVisible()
    } finally {
      await app.close()
    }
  })

  test('CIDR /33 越界 → MT_CIDR_INVALID 中文文案可见', async () => {
    const { app, page } = await launch()
    await ensureReady(page)
    try {
      await clickSidebarTool(page, '实用工具')
      await page.getByPlaceholder('输入 CIDR，如 192.168.1.0/24').fill('192.168.1.0/33')
      await page.getByRole('button', { name: '计算', exact: true }).click()

      await expect(page.getByText(/子网 \/ IP 输入无效/)).toBeVisible()
      await expect(page.getByText(/MT_CIDR_INVALID/)).toBeVisible()
      await expect(page.getByText(/前缀长度 33 超出 0–32/)).toBeVisible()
    } finally {
      await app.close()
    }
  })

  test('秒表：开始后计时递增，重置回到 00:00.00', async () => {
    const { app, page } = await launch()
    await ensureReady(page)
    try {
      await openTimerTab(page)
      const display = page.getByTestId('stopwatch-display')
      await expect(display).toHaveText('00:00.00')

      await page.getByRole('button', { name: '开始', exact: true }).click()
      await page.waitForTimeout(1200)
      expect((await display.innerText()).trim()).not.toBe('00:00.00')

      await page.getByRole('button', { name: '重置', exact: true }).click()
      await expect(display).toHaveText('00:00.00')
    } finally {
      await app.close()
    }
  })

  test('番茄钟：默认 25:00，开始后剩余时间递减', async () => {
    const { app, page } = await launch()
    await ensureReady(page)
    try {
      await openTimerTab(page)
      await page.locator('.n-radio-group label').filter({ hasText: '番茄钟' }).click()

      const remaining = page.getByTestId('pomodoro-remaining')
      await expect(remaining).toHaveText('25:00')

      await page.getByRole('button', { name: '开始', exact: true }).click()
      await page.waitForTimeout(1500)
      expect((await remaining.innerText()).trim()).not.toBe('25:00')
    } finally {
      await app.close()
    }
  })
})
