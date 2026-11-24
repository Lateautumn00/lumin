/**
 * @file clipboard-history（剪贴板历史）e2e 冒烟：真实 Electron 驱动页面交互
 * @author cuilanchao
 * @date 2026-11-24
 * @description 覆盖：空态 → 写入 → 轮询入库 → 搜索过滤 → 复制回写 → 置顶排序 → 删除 → 清空、
 *              >100KB 跳过一次性提示、切页停轮询、关闭重开 list 持久化恢复；
 *              M61 图片扩展：图片轮询入库 → 类型筛选（全部/文本/图片）→ 预览原图 →
 *              copy 通道回写、PNG 文件丢失 → CH_IMAGE_MISSING 中文文案 + 重试入口。
 */
import fs from 'node:fs'
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

/** 清场：系统剪贴板彻底清空（含图片）+ 清空历史（每个用例开头执行，避免跨用例污染） */
async function resetState(app: ElectronApplication, page: Page): Promise<void> {
  await app.evaluate(({ clipboard }) => {
    clipboard.clear()
  })
  await page.evaluate(() => window.lumin.invoke('clipboard-history:clear', {}))
}

/** 类型分段筛选（全部 / 文本 / 图片）定位 */
function typeFilter(page: Page, name: string): Locator {
  return page.locator('label.n-radio-button').filter({ hasText: name })
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
      await expect(page.getByText('复制任意文本或图片后自动出现在这里')).toBeVisible()
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
      await expect(page.getByText('复制任意文本或图片后自动出现在这里')).toBeVisible()
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
      await expect(page.getByText('复制任意文本或图片后自动出现在这里')).toBeVisible()

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
      await expect(listItems(relaunched.page).filter({ hasText: '持久化样本 M59' })).toBeVisible()
      await expect(relaunched.page.getByText('共 1 条 · 置顶 0 条')).toBeVisible()
    } finally {
      await resetState(relaunched.app, relaunched.page)
      await relaunched.app.close()
    }
  })

  test('M61 图片：轮询入库 → 类型筛选 → 预览原图 → copy 通道回写', async () => {
    const { app, page } = await launch()
    await ensureReady(page)
    try {
      await resetState(app, page)
      await clickSidebarTool(page, '剪贴板历史')
      await expect(page.getByText('复制任意文本或图片后自动出现在这里')).toBeVisible()

      // 文本样本先入库，再写入 1×1 PNG（图片优先判定，read() 取 image/png）
      await app.evaluate(({ clipboard }) => {
        clipboard.writeText('图片用例文本样本')
      })
      await expect(listItems(page).filter({ hasText: '图片用例文本样本' })).toBeVisible()
      await app.evaluate(async ({ clipboard, nativeImage, ClipboardItem }) => {
        const png = nativeImage
          .createFromBitmap(Buffer.from([255, 0, 0, 255]), { width: 1, height: 1 })
          .toPNG()
        await clipboard.write([
          new ClipboardItem({ 'image/png': new Blob([new Uint8Array(png)], { type: 'image/png' }) })
        ])
      })
      const imageItem = listItems(page).filter({ has: page.locator('img[alt="剪贴板图片缩略图"]') })
      await expect(imageItem).toHaveCount(1)
      // 图片徽标：尺寸 + 字节（1×1 · NNB）
      await expect(imageItem).toContainText('1×1 ·')

      // 类型分段筛选：全部 / 文本 / 图片
      await typeFilter(page, '文本').click()
      await expect(listItems(page)).toHaveCount(1)
      await expect(listItems(page)).toContainText('图片用例文本样本')
      await typeFilter(page, '图片').click()
      await expect(listItems(page)).toHaveCount(1)
      await expect(imageItem).toBeVisible()
      await typeFilter(page, '全部').click()
      await expect(listItems(page)).toHaveCount(2)

      // 点缩略图开预览 Modal（打开时才调 image 通道取原图）
      await imageItem.locator('button[aria-label="打开图片预览"]').click()
      await expect(page.locator('img[alt="剪贴板图片预览"]')).toBeVisible()
      await page.keyboard.press('Escape')

      // 图片复制：先用文本覆盖剪贴板，再走 copy 通道回写系统剪贴板
      await app.evaluate(({ clipboard }) => {
        clipboard.writeText('图片复制前的覆盖样本')
      })
      await expect(listItems(page)).toHaveCount(3)
      await imageItem.getByRole('button', { name: '复制', exact: true }).click()
      await expect(imageItem.getByRole('button', { name: '已复制' })).toBeVisible()
      const hasImage = await app.evaluate(({ clipboard }) => clipboard.has('image/png'))
      expect(hasImage).toBe(true)
    } finally {
      await resetState(app, page)
      await app.close()
    }
  })

  test('M61 图片：PNG 文件丢失 → 预览提示 CH_IMAGE_MISSING（可重试）', async () => {
    const { app, page } = await launch()
    await ensureReady(page)
    try {
      await resetState(app, page)
      await clickSidebarTool(page, '剪贴板历史')
      await app.evaluate(async ({ clipboard, nativeImage, ClipboardItem }) => {
        const png = nativeImage
          .createFromBitmap(Buffer.from([0, 255, 0, 255]), { width: 1, height: 1 })
          .toPNG()
        await clipboard.write([
          new ClipboardItem({ 'image/png': new Blob([new Uint8Array(png)], { type: 'image/png' }) })
        ])
      })
      const imageItem = listItems(page).filter({ has: page.locator('img[alt="剪贴板图片缩略图"]') })
      await expect(imageItem).toHaveCount(1)

      // 经主进程路径删除全部图片 PNG（JSON 仍引用 → 预览必然失败）
      const userDataPath = await app.evaluate(({ app }) => app.getPath('userData'))
      const imagesDir = path.join(userDataPath, 'clipboard-history', 'images')
      const files = fs.readdirSync(imagesDir)
      expect(files.length).toBeGreaterThan(0)
      for (const file of files) fs.unlinkSync(path.join(imagesDir, file))

      // 打开预览 → 结构化错误码 → 中文文案 + 重试入口（R3）
      await imageItem.locator('button[aria-label="打开图片预览"]').click()
      await expect(page.getByText('图片文件已丢失')).toBeVisible()
      await expect(page.getByText('CH_IMAGE_MISSING')).toBeVisible()
      await expect(page.getByRole('button', { name: '重试' })).toBeVisible()
    } finally {
      await resetState(app, page)
      await app.close()
    }
  })
})
