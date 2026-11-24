/**
 * @file time-toolbox（时间工具箱）e2e 冒烟：真实 Electron 驱动页面交互
 * @author cuilanchao
 * @date 2026-11-20
 * @description 覆盖：页面加载与四页签展示、时间戳双向转换与非法输入结构化报错、
 *              Cron 默认描述与未来 5 次触发、非法表达式报错与恢复。
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

test.describe('time-toolbox（时间工具箱）冒烟', () => {
  test('页面加载 + 四页签与默认时间戳结果展示', async () => {
    const { app, page } = await launch()
    await ensureReady(page)
    try {
      await clickSidebarTool(page, '时间工具箱')
      await expect(page.getByRole('heading', { name: '时间工具箱' })).toBeVisible()
      await expect(page.getByText('时间戳', { exact: true }).first()).toBeVisible()
      await expect(page.getByText('时区', { exact: true })).toBeVisible()
      await expect(page.getByText('时长', { exact: true })).toBeVisible()
      await expect(page.getByText('Cron', { exact: true })).toBeVisible()

      await expect(page.getByText('本地时间', { exact: true })).toBeVisible()
      await expect(page.getByText('UTC 时间', { exact: true })).toBeVisible()
      await expect(page.getByText('ISO 8601', { exact: true })).toBeVisible()
      await expect(page.getByText('时区偏移', { exact: true })).toBeVisible()
      await expect(page.getByText('日期时间 → 时间戳')).toBeVisible()
    } finally {
      await app.close()
    }
  })

  test('时间戳双向转换 + 非法输入结构化报错与恢复', async () => {
    const { app, page } = await launch()
    await ensureReady(page)
    try {
      await clickSidebarTool(page, '时间工具箱')
      const input = page.getByPlaceholder('1700000000 或 1700000000000')
      await input.fill('1700000000')
      await expect(page.getByText('2023-11-14T22:13:20.000Z', { exact: true })).toBeVisible()
      await expect(page.getByText('2023-11-14 22:13:20', { exact: true }).first()).toBeVisible()

      await input.fill('abc')
      await expect(page.getByRole('alert')).toContainText('TT_INVALID_INPUT')

      await input.fill('1700000000')
      await expect(page.getByRole('alert')).toHaveCount(0)
      await expect(page.getByText('2023-11-14T22:13:20.000Z', { exact: true })).toBeVisible()
    } finally {
      await app.close()
    }
  })

  test('Cron 默认描述与未来 5 次触发 + 非法表达式报错与恢复', async () => {
    const { app, page } = await launch()
    await ensureReady(page)
    try {
      await clickSidebarTool(page, '时间工具箱')
      await page.getByText('Cron', { exact: true }).click()

      const input = page.getByPlaceholder('*/5 * * * *')
      await expect(page.getByText('描述：每 5 分钟', { exact: true })).toBeVisible()
      await expect(page.locator('[data-cron-run]')).toHaveCount(5)

      await input.fill('99 * * * *')
      await expect(page.getByRole('alert')).toContainText('TT_INVALID_INPUT')

      await input.fill('0 9 * * 1-5')
      await expect(page.getByRole('alert')).toHaveCount(0)
      await expect(page.getByText('描述：每周一至周五 09:00', { exact: true })).toBeVisible()
      await expect(page.locator('[data-cron-run]')).toHaveCount(5)
    } finally {
      await app.close()
    }
  })

  test('日期计算器：间隔总天数/工作日可见 + 加减月末钳制', async () => {
    const { app, page } = await launch()
    await ensureReady(page)
    try {
      await clickSidebarTool(page, '时间工具箱')
      await page.getByText('日期计算器', { exact: true }).first().click()

      // 间隔模式默认今/明天：总天数、自然周、工作日三行输出可见
      await expect(page.getByText('总天数', { exact: true })).toBeVisible()
      await expect(page.getByText('自然周', { exact: true })).toBeVisible()
      await expect(page.getByText('工作日', { exact: true })).toBeVisible()

      // 加减模式：2023-01-31 + 1 月 → 2023-02-28（日溢出钳制月末）
      await page.getByText('加减', { exact: true }).click()
      await page.getByPlaceholder('基准日期').fill('2023-01-31')
      await page.keyboard.press('Tab')
      await page.getByText('月', { exact: true }).click()

      await expect(page.getByText('2023-02-28', { exact: true })).toBeVisible()
      await expect(page.getByText('星期二', { exact: true })).toBeVisible()
    } finally {
      await app.close()
    }
  })
})
