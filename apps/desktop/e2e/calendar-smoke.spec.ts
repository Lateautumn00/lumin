/**
 * @file calendar（日历）e2e 冒烟：真实 Electron 驱动页面交互
 * @author cuilanchao
 * @date 2026-11-23
 * @description 覆盖：当月月格渲染（42 格 + 农历详情 + 黄历宜忌）、切月与「今天」复位、
 *              点选日期更新详情、纪念日增删与倒数出现/消失、720×520 下详情面板可见。
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

test.describe('calendar（日历）冒烟', () => {
  test('打开即渲染当月月格（42 格 + 农历详情 + 黄历宜忌）', async () => {
    const { app, page } = await launch()
    await ensureReady(page)
    try {
      await clickSidebarTool(page, '日历')
      await expect(page.getByRole('heading', { name: '日历', exact: true })).toBeVisible()

      await expect(page.locator('button[role="gridcell"]')).toHaveCount(42)

      const title = await page.evaluate(() => {
        const d = new Date()
        return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月`
      })
      await expect(page.getByText(title, { exact: true })).toBeVisible()

      // 详情面板：公历/农历/黄历宜忌
      const detail = page.getByRole('region', { name: '当日详情' })
      await expect(detail).toBeVisible()
      await expect(detail.locator('dt', { hasText: '农历' }).locator('+ dd')).toHaveText(/.+/)
      await expect(detail.getByText('黄历', { exact: true })).toBeVisible()
      await expect(detail.getByText('宜', { exact: true })).toBeVisible()
      await expect(detail.getByText('忌', { exact: true })).toBeVisible()
      await expect(detail.getByText('吉神：', { exact: false })).toBeVisible()
    } finally {
      await app.close()
    }
  })

  test('切月标题变化 + 「今天」回到当月', async () => {
    const { app, page } = await launch()
    await ensureReady(page)
    try {
      await clickSidebarTool(page, '日历')
      await expect(page.locator('button[role="gridcell"]')).toHaveCount(42)

      const title = page.getByText(/\d+ 年 \d+ 月/).first()
      const before = (await title.textContent()) ?? ''

      await page.getByRole('button', { name: '下个月' }).click()
      await expect(title).not.toHaveText(before)

      await page.getByRole('button', { name: '今天', exact: true }).click()
      await expect(title).toHaveText(before)
    } finally {
      await app.close()
    }
  })

  test('点选日期 → 详情更新公历/干支', async () => {
    const { app, page } = await launch()
    await ensureReady(page)
    try {
      await clickSidebarTool(page, '日历')
      await expect(page.locator('button[role="gridcell"]')).toHaveCount(42)

      const ymd = await page.evaluate(() => {
        const d = new Date()
        const m = d.getMonth() + 1
        const day = d.getDate()
        return `${d.getFullYear()}-${m < 10 ? '0' + m : m}-${day < 10 ? '0' + day : day}`
      })
      await page.locator(`button[role="gridcell"][aria-label="${ymd}"]`).click()

      const detail = page.getByRole('region', { name: '当日详情' })
      await expect(detail.locator('h2')).toHaveText(ymd)
      await expect(detail.locator('dt', { hasText: '干支' }).locator('+ dd')).toHaveText(/日$/)
    } finally {
      await app.close()
    }
  })

  test('纪念日新增 → 详情倒数出现 → 删除 → 消失', async () => {
    const { app, page } = await launch()
    await ensureReady(page)
    try {
      // 每次测试从空列表开始（localStorage 跨启动持久）
      await page.evaluate(() => localStorage.removeItem('lumin.tool.calendar.anniversaries'))
      await clickSidebarTool(page, '日历')
      await expect(page.locator('button[role="gridcell"]')).toHaveCount(42)

      await page.getByRole('button', { name: '纪念日管理' }).click()
      await expect(page.getByText('还没有纪念日', { exact: false })).toBeVisible()

      // 月份/日期默认即今天，直接填名称添加
      await page.getByPlaceholder('名称，如：结婚纪念日').fill('测试纪念日')
      await page.getByRole('button', { name: '添加', exact: true }).click()
      await expect(page.getByRole('list', { name: '纪念日列表' })).toContainText('测试纪念日')
      await page.getByRole('button', { name: '完成', exact: true }).click()

      // 详情面板出现当日纪念日 + 倒数
      const detail = page.getByRole('region', { name: '当日详情' })
      await expect(detail).toContainText('测试纪念日')
      await expect(detail.getByText('今天', { exact: true })).toBeVisible()

      // 重开弹窗删除
      await page.getByRole('button', { name: '纪念日管理' }).click()
      await page.getByRole('button', { name: '删除 测试纪念日' }).click()
      await expect(page.getByText('还没有纪念日', { exact: false })).toBeVisible()
      await page.getByRole('button', { name: '完成', exact: true }).click()
      await expect(detail).toContainText('这一天没有纪念日')
    } finally {
      await app.close()
    }
  })

  test('720×520 下月格与详情面板仍可见', async () => {
    const { app, page } = await launch()
    await ensureReady(page)
    try {
      await clickSidebarTool(page, '日历')
      await expect(page.locator('button[role="gridcell"]')).toHaveCount(42)

      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.setSize(720, 520)
      })
      await page.waitForTimeout(300)

      await expect(page.locator('button[role="gridcell"]')).toHaveCount(42)
      await expect(page.getByRole('region', { name: '当日详情' })).toBeVisible()
      await expect(page.getByRole('button', { name: '纪念日管理' })).toBeVisible()
    } finally {
      await app.close()
    }
  })

  test('极端分辨率：无横向溢出且详情末块可达（720×520 / 1920×520 / 2560×1440）', async () => {
    const { app, page } = await launch()
    await ensureReady(page)
    try {
      await clickSidebarTool(page, '日历')
      await expect(page.locator('button[role="gridcell"]')).toHaveCount(42)

      for (const size of [
        [720, 520],
        [1920, 520],
        [2560, 1440]
      ] as [number, number][]) {
        const [w, h] = size
        await app.evaluate(({ BrowserWindow }, [sw, sh]: [number, number]) => {
          BrowserWindow.getAllWindows()[0]?.setSize(sw, sh)
        }, size)
        await page.waitForTimeout(300)

        // 横向不溢出（窗口内无水平滚动条）
        const overflowX = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth
        )
        expect(overflowX, `${w}x${h} 横向溢出`).toBe(0)

        // 42 格齐全，且末格可滚入视口（存在可达的滚动链；被 overflow-hidden 裁剪则此步失败）
        await expect(page.locator('button[role="gridcell"]')).toHaveCount(42)
        const cells = page.locator('button[role="gridcell"]')
        await cells.last().scrollIntoViewIfNeeded()
        await expect(cells.last()).toBeInViewport()

        // 详情末块（当日纪念日）可达：滚入视口（竖排靠外层容器、xl 横排靠详情列自身滚动）
        const lastBlock = page
          .getByRole('region', { name: '当日详情' })
          .locator(':scope > *')
          .last()
        await lastBlock.scrollIntoViewIfNeeded()
        await expect(lastBlock).toBeInViewport()

        // 头部操作按钮在视口内
        await expect(page.getByRole('button', { name: '纪念日管理' })).toBeInViewport()
        await expect(page.getByRole('button', { name: '今天', exact: true })).toBeInViewport()
      }
    } finally {
      await app.close()
    }
  })
})
