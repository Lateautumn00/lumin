/**
 * @file text-diff（文本对比）e2e 冒烟：真实 Electron 驱动页面交互
 * @author cuilanchao
 * @date 2026-11-20
 * @description 覆盖：页面加载与空态引导、示例与差异统计、忽略大小写/并排与统一视图、
 *              统一 diff 复制、交换/清空、超限报错与恢复；
 *              M62：词级/字符级行内粒度开关对照、文件比较文本模式 diff /
 *              二进制首差异偏移 / 不存在路径结构化错误（page.evaluate 直连通道，免 dialog）。
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
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

/**
 * 主进程侧回填文件选择对话框（免真实原生 dialog）：
 * 按顺序返回 picks，取尽后返回 undefined（等价用户取消）
 */
async function stubDialogPicks(
  app: ElectronApplication,
  picks: string[]
): Promise<void> {
  await app.evaluate(({ dialog }, orderedPicks: string[]) => {
    let cursor = 0
    dialog.showOpenDialogSync = () => {
      const next = orderedPicks[cursor]
      cursor += 1
      return next === undefined ? undefined : [next]
    }
  }, picks)
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

  test('M62 词级/字符级粒度开关：行内高亮分段对照', async () => {
    const { app, page } = await launch()
    await ensureReady(page)
    try {
      await clickSidebarTool(page, '文本对比')
      await page.getByPlaceholder('粘贴左侧文本…').fill('hello brave world')
      await page.getByPlaceholder('粘贴右侧文本…').fill('hello new world')

      const leftCell = page.locator('[data-diff-cell="left"][data-change="delete"]')

      // 默认词级：整词作为一个删除分段（brave → new）
      await expect(leftCell.locator('[data-segment]')).toHaveText(['hello ', 'brave', ' world'])

      // 切字符级：退化为字符 LCS（brav 被删、e 保留为相同分段）
      await page.getByText('字符级', { exact: true }).click()
      await expect(leftCell.locator('[data-segment]')).toHaveText([
        'hello ',
        'brav',
        'e',
        ' world'
      ])

      // 切回词级恢复整词分段
      await page.getByText('词级', { exact: true }).click()
      await expect(leftCell.locator('[data-segment]')).toHaveText(['hello ', 'brave', ' world'])
    } finally {
      await app.close()
    }
  })

  test('M62 文件比较：文本模式 diff / 二进制偏移信息卡 / 不存在路径错误态', async () => {
    const { app, page } = await launch()
    await ensureReady(page)
    const dir = mkdtempSync(path.join(tmpdir(), 'lumin-td-e2e-'))
    const leftText = path.join(dir, 'left file.txt')
    const rightText = path.join(dir, 'right file.txt')
    const leftBin = path.join(dir, 'left.bin')
    const rightBin = path.join(dir, 'right.bin')
    const missing = path.join(dir, 'missing.txt')
    writeFileSync(leftText, 'alpha\nbeta\n')
    writeFileSync(rightText, 'alpha\ngamma\n')
    writeFileSync(leftBin, Buffer.from('AB\0CD'))
    writeFileSync(rightBin, Buffer.from('AB\0XD'))
    try {
      await clickSidebarTool(page, '文本对比')
      await page.getByText('文件比较', { exact: true }).click()
      await expect(page.locator('[data-empty-state]')).toContainText('选择两个文件开始比较')

      // 主进程侧回填文件选择对话框（免真实原生 dialog），驱动完整 UI 流程
      await stubDialogPicks(app, [leftText, rightText])

      await page.locator('[data-file-pick-left]').click()
      await page.locator('[data-file-pick-right]').click()
      await expect(page.locator('[data-file-left] input')).toHaveValue(leftText)
      await page.locator('[data-file-compare]').click()

      // 文本模式：复用 DiffResultPanel 出行级 diff
      await expect(page.locator('[data-stats]')).toBeVisible()
      await expect(page.locator('[data-stat-added]')).toHaveText('+1')
      await expect(page.locator('[data-stat-removed]')).toHaveText('-1')
      await expect(page.locator('[data-stat-unchanged]')).toHaveText('1')

      // 二进制模式：首差异偏移信息卡（AB\0CD vs AB\0XD → 偏移 3，单块）
      await stubDialogPicks(app, [leftBin, rightBin])
      await page.locator('[data-file-pick-left]').click()
      await page.locator('[data-file-pick-right]').click()
      await page.locator('[data-file-compare]').click()
      await expect(page.locator('[data-binary-card]')).toContainText(
        '二进制不同，首个差异位于偏移 3（块 1/1）'
      )
      await expect(page.locator('[data-diff-side-by-side]')).toHaveCount(0)

      // 错误态：不存在路径 → TD_FILE_READ_FAILED 中文文案 + 重试入口
      await stubDialogPicks(app, [missing, rightText])
      await page.locator('[data-file-pick-left]').click()
      await page.locator('[data-file-pick-right]').click()
      await page.locator('[data-file-compare]').click()
      await expect(page.getByRole('alert')).toContainText('文件读取失败')
      await expect(page.getByRole('alert')).toContainText('TD_FILE_READ_FAILED')
      await expect(page.locator('[data-file-retry]')).toBeVisible()

      // 直连通道回包形状（spec §5 用例 6：page.evaluate 免 dialog 断言载荷）
      const textResult = await page.evaluate(
        ([left, right]) =>
          window.lumin.invoke<{ mode: string; stats: { added: number } }>(
            'text-diff:compare-files',
            { left, right }
          ),
        [leftText, rightText]
      )
      expect(textResult.mode).toBe('text')
      expect(textResult.stats.added).toBe(1)

      const binaryResult = await page.evaluate(
        ([left, right]) =>
          window.lumin.invoke<{ mode: string; firstDiffOffset?: number }>(
            'text-diff:compare-files',
            { left, right }
          ),
        [leftBin, rightBin]
      )
      expect(binaryResult.mode).toBe('binary')
      expect(binaryResult.firstDiffOffset).toBe(3)

      const errorResult = await page
        .evaluate(
          ([left, right]) =>
            window.lumin
              .invoke('text-diff:compare-files', { left, right })
              .then(() => null)
              .catch((err: unknown) => err as { code: string; message: string }),
          [missing, rightText]
        )
      expect(errorResult?.code).toBe('TD_FILE_READ_FAILED')
      expect(errorResult?.message).toContain('文件读取失败')
    } finally {
      await app.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
