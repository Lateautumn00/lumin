/**
 * @file clipboard-history（剪贴板历史）e2e 冒烟：真实 Electron 驱动页面交互
 * @author cuilanchao
 * @date 2026-11-23
 * @description 覆盖：空态 → 写入 → 轮询入库 → 搜索过滤 → 复制回写 → 置顶排序 → 删除 → 清空、
 *              >100KB 跳过一次性提示、切页停轮询、关闭重开 list 持久化恢复。
 */
import path from 'node:path'
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Locator,
  type Page
} from '@playwright/test'
import { clickSidebarTool } from './sidebar'
import type { LuminBridge } from '@lumin/plugin-api'

declare global {
  interface Window {
    lumin: LuminBridge
  }
}

interface EntryLike {
  id: string
  text: string
  createdAt: number
  pinned: boolean
}

interface ListResult {
  items: EntryLike[]
}

const appDir = path.resolve(__dirname, '..')

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

/** 清场：系统剪贴板置空 + 清空历史（每个用例开头执行，避免跨用例污染） */
async function resetState(app: ElectronApplication, page: Page): Promise<void> {
  await app.evaluate(({ clipboard }) => {
    clipboard.writeText('')
  })
  await page.evaluate(() => window.lumin.invoke('clipboard-history:clear', {}))
}

/** 直接读主进程存储（不经轮询，用于切页停轮询与持久化断言） */
async function listTexts(page: Page): Promise<string[]> {
  const result = await page.evaluate(() =>
    window.lumin.invoke<ListResult>('clipboard-history:list', {})
  )
  return result.items.map((item) => item.text)
}

/** 条目列表定位（工具页 aria-label 列表，排除壳内其他列表） */
function listItems(page: Page): Locator {
  return page.locator('ul[aria-label="历史条目列表"] > li')
}

test.describe('clipboard-history（剪贴板历史）冒烟', () => {
  test('空态 → 轮询入库 → 搜索过滤 → 复制回写 → 置顶 → 删除 → 清空', async () => {
    const { app, page } = await launch()
    await ensureReady(page)
    try {
      await resetState(app, page)
      await clickSidebarTool(page, '剪贴板历史')

      // 空态（R4）
      await expect(page.getByRole('heading', { name: '剪贴板历史' })).toBeVisible()
      await expect(page.getByText('复制任意文本后自动出现在这里')).toBeVisible()
      await expect(page.getByText('共 0 条 · 置顶 0 条')).toBeVisible()

      // 写入剪贴板 → 1s 轮询入库
      await app.evaluate(({ clipboard }) => {
        clipboard.writeText('lumin 轮询入库样本 e2e')
      })
      await expect(listItems(page).filter({ hasText: 'lumin 轮询入库样本 e2e' })).toBeVisible()

      await app.evaluate(({ clipboard }) => {
        clipboard.writeText('另一条搜索样本 alpha')
      })
      await expect(listItems(page).filter({ hasText: '另一条搜索样本 alpha' })).toBeVisible()
      await expect(listItems(page)).toHaveCount(2)

      // 搜索过滤（子串、忽略大小写）+ 无命中空态
      const search = page.getByPlaceholder('搜索剪贴板内容')
      await search.fill('alpha')
      await expect(listItems(page)).toHaveCount(1)
      await expect(page.getByText('lumin 轮询入库样本 e2e')).toHaveCount(0)
      await search.fill('zzz没有这个条目')
      await expect(page.getByText('没有匹配的条目')).toBeVisible()
      await search.fill('')
      await expect(listItems(page)).toHaveCount(2)

      // 复制回写：renderer 写系统剪贴板 + 该条本地前移
      const alphaItem = listItems(page).filter({ hasText: '另一条搜索样本 alpha' })
      await alphaItem.getByRole('button', { name: '复制', exact: true }).click()
      const copied = await app.evaluate(({ clipboard }) => clipboard.readText())
      expect(copied).toBe('另一条搜索样本 alpha')
      await expect(alphaItem.getByRole('button', { name: '已复制' })).toBeVisible()

      // 置空剪贴板防轮询回灌，等待一个轮询周期消化在途读取
      await app.evaluate(({ clipboard }) => {
        clipboard.writeText('')
      })
      await page.waitForTimeout(1300)

      // 置顶：置顶组恒在最前
      const sampleItem = listItems(page).filter({ hasText: 'lumin 轮询入库样本 e2e' })
      await sampleItem.getByRole('button', { name: '置顶', exact: true }).click()
      await expect(listItems(page).first()).toContainText('lumin 轮询入库样本 e2e')
      await expect(listItems(page).first().getByText('已置顶')).toBeVisible()
      await expect(page.getByText('共 2 条 · 置顶 1 条')).toBeVisible()

      // 删除单条
      await listItems(page)
        .filter({ hasText: '另一条搜索样本 alpha' })
        .getByRole('button', { name: '删除', exact: true })
        .click()
      await expect(listItems(page)).toHaveCount(1)
      await expect(page.getByText('共 1 条 · 置顶 1 条')).toBeVisible()

      // 清空（NPopconfirm 二次确认）
      await page.getByRole('button', { name: '清空', exact: true }).click()
      await expect(page.getByText('清空全部历史（含置顶）？')).toBeVisible()
      await page.getByRole('button', { name: '确认', exact: true }).click()
      await expect(page.getByText('复制任意文本后自动出现在这里')).toBeVisible()
      await expect(page.getByText('共 0 条 · 置顶 0 条')).toBeVisible()
      await expect(listItems(page)).toHaveCount(0)
    } finally {
      await app.close()
    }
  })

  test('>100KB 跳过：一次性提示且不入库', async () => {
    const { app, page } = await launch()
    await ensureReady(page)
    try {
      await resetState(app, page)
      await clickSidebarTool(page, '剪贴板历史')
      await expect(page.getByText('复制任意文本后自动出现在这里')).toBeVisible()

      await app.evaluate(({ clipboard }) => {
        clipboard.writeText('x'.repeat(1024 * 1024))
      })
      const warning = page.getByRole('alert').filter({ hasText: '剪贴板内容过大' })
      await expect(warning).toBeVisible()
      await expect(page.getByText('共 0 条 · 置顶 0 条')).toBeVisible()

      // 一次性提示：后续轮询保持单条告警，不刷屏
      await page.waitForTimeout(1500)
      await expect(warning).toHaveCount(1)

      // 恢复正常剪贴板后提示复位
      await app.evaluate(({ clipboard }) => {
        clipboard.writeText('')
      })
      await expect(warning).toHaveCount(0)
    } finally {
      await app.close()
    }
  })

  test('切页停轮询：离开工具页后剪贴板变化不入库', async () => {
    const { app, page } = await launch()
    await ensureReady(page)
    try {
      await resetState(app, page)
      await clickSidebarTool(page, '剪贴板历史')
      await app.evaluate(({ clipboard }) => {
        clipboard.writeText('切页样本 A')
      })
      await expect(listItems(page).filter({ hasText: '切页样本 A' })).toBeVisible()

      // 切到日历页：onUnmounted 清定时器（轮询即任务取消口径）
      await clickSidebarTool(page, '日历')
      await app.evaluate(({ clipboard }) => {
        clipboard.writeText('切页样本 B（不应入库）')
      })
      await page.waitForTimeout(1500)

      const texts = await listTexts(page)
      expect(texts).toContain('切页样本 A')
      expect(texts).not.toContain('切页样本 B（不应入库）')
    } finally {
      await resetState(app, page)
      await app.close()
    }
  })

  test('关闭重开：list 持久化恢复（磁盘直读）', async () => {
    const { app, page } = await launch()
    await ensureReady(page)
    await resetState(app, page)
    await clickSidebarTool(page, '剪贴板历史')
    await app.evaluate(({ clipboard }) => {
      clipboard.writeText('持久化样本 M59')
    })
    await expect(listItems(page).filter({ hasText: '持久化样本 M59' })).toBeVisible()
    // 等待 500ms 防抖原子落盘完成
    await page.waitForTimeout(800)
    await app.close()

    // 重开应用：先不开工具页（未启动轮询），直接读主进程存储证明来自磁盘
    const relaunched = await launch()
    try {
      await ensureReady(relaunched.page)
      const texts = await listTexts(relaunched.page)
      expect(texts).toContain('持久化样本 M59')

      await clickSidebarTool(relaunched.page, '剪贴板历史')
      await expect(
        listItems(relaunched.page).filter({ hasText: '持久化样本 M59' })
      ).toBeVisible()
      await expect(relaunched.page.getByText('共 1 条 · 置顶 0 条')).toBeVisible()
    } finally {
      await resetState(relaunched.app, relaunched.page)
      await relaunched.app.close()
    }
  })
})
