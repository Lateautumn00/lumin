/**
 * @file password-generator（密码生成器）e2e 冒烟：真实 Electron 驱动页面交互
 * @author cuilanchao
 * @date 2026-11-20
 * @description 覆盖：页面加载与四页签、默认密码与强度/熵展示、长度与字符集联动、
 *              UUID v4 形状与数量、随机字符串/整数与非法范围报错恢复、口令短语词数与分隔符。
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

test.describe('password-generator（密码生成器）冒烟', () => {
  test('页面加载 + 四页签与默认密码结果展示', async () => {
    const { app, page } = await launch()
    await ensureReady(page)
    try {
      await clickSidebarTool(page, '密码生成器')
      await expect(page.getByRole('heading', { name: '密码生成器' })).toBeVisible()
      await expect(page.getByText('密码', { exact: true }).first()).toBeVisible()
      await expect(page.getByText('UUID', { exact: true })).toBeVisible()
      await expect(page.getByText('随机', { exact: true })).toBeVisible()
      await expect(page.getByText('口令短语', { exact: true })).toBeVisible()

      await expect(page.locator('[data-password]')).toHaveText(/^.{16}$/)
      await expect(page.locator('[data-strength]')).toContainText('强度：')
      await expect(page.getByText(/熵 .* bits/)).toBeVisible()
    } finally {
      await app.close()
    }
  })

  test('长度与字符集联动 + 空字符集报错与恢复', async () => {
    const { app, page } = await launch()
    await ensureReady(page)
    try {
      await clickSidebarTool(page, '密码生成器')
      const lengthInput = page.getByPlaceholder('密码长度')
      await lengthInput.fill('24')
      await lengthInput.press('Tab')
      await expect(page.locator('[data-password]')).toHaveText(/^.{24}$/)

      // 仅保留大写字母
      await page.getByText('小写 a-z', { exact: true }).click()
      await page.getByText('数字 0-9', { exact: true }).click()
      await expect(page.locator('[data-password]')).toHaveText(/^[A-Z]{24}$/)

      // 全部取消 → 结构化报错，结果区消失
      await page.getByText('大写 A-Z', { exact: true }).click()
      await expect(page.getByRole('alert')).toContainText('PG_INVALID_OPTIONS')
      await expect(page.locator('[data-password]')).toHaveCount(0)

      // 恢复小写
      await page.getByText('小写 a-z', { exact: true }).click()
      await expect(page.getByRole('alert')).toHaveCount(0)
      await expect(page.locator('[data-password]')).toHaveText(/^[a-z]{24}$/)
    } finally {
      await app.close()
    }
  })

  test('UUID v4 形状与数量联动', async () => {
    const { app, page } = await launch()
    await ensureReady(page)
    try {
      await clickSidebarTool(page, '密码生成器')
      await page.getByText('UUID', { exact: true }).click()

      const items = page.locator('[data-uuid-item]')
      await expect(items).toHaveCount(1)
      const first = await items.first().locator('span').first().textContent()
      expect(first ?? '').toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
      )

      const countInput = page.getByPlaceholder('数量（1–50）')
      await countInput.fill('3')
      await countInput.press('Tab')
      await expect(items).toHaveCount(3)
    } finally {
      await app.close()
    }
  })

  test('口令短语：默认 4 词连字符 → 6 词空格分隔', async () => {
    const { app, page } = await launch()
    await ensureReady(page)
    try {
      await clickSidebarTool(page, '密码生成器')
      await page.getByText('口令短语', { exact: true }).click()

      const items = page.locator('[data-passphrase-item]')
      await expect(items).toHaveCount(1)
      const first = await items.first().locator('span').first().textContent()
      expect((first ?? '').trim().split('-')).toHaveLength(4)
      await expect(page.locator('[data-passphrase-strength]')).toContainText('强度：')

      const wordInput = page.getByPlaceholder('词数（3–10）')
      await wordInput.fill('6')
      await wordInput.press('Tab')
      await page.getByLabel('口令分隔符').selectOption('space')
      await expect
        .poll(async () => {
          const text = await items.first().locator('span').first().textContent()
          return (text ?? '').trim().split(' ').length
        })
        .toBe(6)

      const countInput = page.getByPlaceholder('数量（1–20）')
      await countInput.fill('2')
      await countInput.press('Tab')
      await expect(items).toHaveCount(2)
    } finally {
      await app.close()
    }
  })

  test('随机字符串默认结果 + 随机整数非法范围报错与恢复', async () => {
    const { app, page } = await launch()
    await ensureReady(page)
    try {
      await clickSidebarTool(page, '密码生成器')
      await page.getByText('随机', { exact: true }).click()

      await expect(page.locator('[data-random-string]')).toHaveCount(5)
      const firstString = await page.locator('[data-random-string] span').first().textContent()
      expect(firstString ?? '').toHaveLength(32)
      await expect(page.locator('[data-random-int]')).toBeVisible()

      // 下界大于上界 → 结构化报错
      const minInput = page.getByPlaceholder('最小值')
      const maxInput = page.getByPlaceholder('最大值')
      await minInput.fill('50')
      await minInput.press('Tab')
      await maxInput.fill('10')
      await maxInput.press('Tab')
      await expect(page.getByRole('alert')).toContainText('PG_INVALID_OPTIONS')

      // 恢复合法范围
      await maxInput.fill('100')
      await maxInput.press('Tab')
      await expect(page.getByRole('alert')).toHaveCount(0)
      await expect(page.locator('[data-random-int]')).toBeVisible()
    } finally {
      await app.close()
    }
  })
})
