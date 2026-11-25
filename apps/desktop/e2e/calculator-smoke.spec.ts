/**
 * @file calculator（计算器）e2e 冒烟：真实 Electron 驱动页面交互
 * @author cuilanchao
 * @date 2026-11-25
 * @description M79 三工具合并后的单入口冒烟：四页签加载、默认房贷月供/还款计划、
 *              等额本息↔等额本金切换、房贷参数越界报错与恢复、工资个税口径、百分比/折扣联动。
 *              计算与进制页签的求值/历史用例见 ipc-smoke.spec.ts。
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

type Page = Awaited<ReturnType<ElectronApplication['firstWindow']>>

async function launch(): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({ args: ['.'], cwd: appDir })
  const page = await app.firstWindow()
  return { app, page }
}

/** 等待壳渲染层就绪（window.lumin 暴露完成后才可安全操作） */
async function ensureReady(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded')
  await page.waitForFunction(() => typeof window.lumin !== 'undefined')
}

/** 切换页签（Naive UI 的 tab 节点没有 role=tab，按 .n-tabs-tab 文本定位） */
async function switchTab(page: Page, name: string): Promise<void> {
  await page.locator('.n-tabs-tab', { hasText: name }).first().click()
}

/** 打开计算器并进入「生活计算」页签 */
async function openLife(page: Page): Promise<void> {
  await clickSidebarTool(page, '计算器')
  await switchTab(page, '生活计算')
}

test.describe('calculator（计算器）冒烟', () => {
  test('页面加载 + 四页签 + 默认房贷结果', async () => {
    const { app, page } = await launch()
    await ensureReady(page)
    try {
      await clickSidebarTool(page, '计算器')
      await expect(page.getByRole('heading', { name: '计算器' })).toBeVisible()
      await expect(page.locator('.n-tabs-tab[data-name="calc"]')).toHaveText('计算')
      await expect(page.locator('.n-tabs-tab[data-name="base"]')).toHaveText('进制')
      await expect(page.locator('.n-tabs-tab[data-name="units"]')).toHaveText('单位换算')
      await expect(page.locator('.n-tabs-tab[data-name="life"]')).toHaveText('生活计算')

      await switchTab(page, '生活计算')
      await expect(page.getByText('房贷', { exact: true })).toBeVisible()
      await expect(page.getByText('个税', { exact: true })).toBeVisible()
      await expect(page.getByText('百分比', { exact: true })).toBeVisible()

      await expect(page.locator('[data-mortgage-metric="payment"]')).toContainText('元')
      await expect(page.locator('[data-mortgage-metric="months"]')).toContainText('360 期')
      await expect(page.locator('[data-mortgage-row]')).toHaveCount(12)
    } finally {
      await app.close()
    }
  })

  test('还款方式切换 + 本金越界报错与恢复', async () => {
    const { app, page } = await launch()
    await ensureReady(page)
    try {
      await openLife(page)
      const payment = page.locator('[data-mortgage-metric="payment"]')

      await page.getByText('等额本金', { exact: true }).click()
      await expect(payment).toContainText('首月还款')
      await expect(payment).toContainText('元')

      // 本金清零 → 结构化报错，结果区消失
      const principalInput = page.getByPlaceholder('贷款本金（元）')
      await principalInput.fill('0')
      await principalInput.press('Tab')
      await expect(page.getByRole('alert')).toContainText('LC_MORTGAGE_INVALID')
      await expect(payment).toHaveCount(0)

      // 恢复合法本金
      await principalInput.fill('1200000')
      await principalInput.press('Tab')
      await expect(page.getByRole('alert')).toHaveCount(0)
      await expect(payment).toContainText('元')
    } finally {
      await app.close()
    }
  })

  test('工资个税：10000 元 / 五险一金 0 → 个税 290、税后 9710', async () => {
    const { app, page } = await launch()
    await ensureReady(page)
    try {
      await openLife(page)
      await page.getByText('个税', { exact: true }).click()

      const salaryInput = page.getByPlaceholder('税前月薪（元）')
      const insuranceInput = page.getByPlaceholder('五险一金（元）')
      await salaryInput.fill('10000')
      await salaryInput.press('Tab')
      await insuranceInput.fill('0')
      await insuranceInput.press('Tab')

      await expect(page.locator('[data-tax-metric="tax"]')).toContainText('290.00')
      await expect(page.locator('[data-tax-metric="net"]')).toContainText('9,710.00')

      // 五险一金大于税前工资 → 结构化报错
      await insuranceInput.fill('20000')
      await insuranceInput.press('Tab')
      await expect(page.getByRole('alert')).toContainText('LC_TAX_INVALID')
    } finally {
      await app.close()
    }
  })

  test('百分比与折扣：增减 / 变化率 / 折扣价实时联动', async () => {
    const { app, page } = await launch()
    await ensureReady(page)
    try {
      await openLife(page)
      await page.getByText('百分比', { exact: true }).click()

      await expect(page.locator('[data-percent-apply]')).toHaveText('120.00')
      await expect(page.locator('[data-percent-rate]')).toHaveText('20.00%')
      await expect(page.locator('[data-percent-discount]')).toHaveText('159.20')

      const deltaInput = page.getByPlaceholder('百分比（%）')
      await deltaInput.fill('-10')
      await deltaInput.press('Tab')
      await expect(page.locator('[data-percent-apply]')).toHaveText('90.00')

      // 原值为 0 → 变化率无意义，报错
      const fromInput = page.getByPlaceholder('原值')
      await fromInput.fill('0')
      await fromInput.press('Tab')
      await expect(page.getByRole('alert')).toContainText('LC_PERCENT_INVALID')
    } finally {
      await app.close()
    }
  })
})
