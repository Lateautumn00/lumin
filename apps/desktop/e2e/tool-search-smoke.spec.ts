/**
 * @file 工具搜索（Ctrl K）e2e 冒烟：真实 Electron 壳 + 清单驱动结果
 * @author cuilanchao
 * @date 2026-11-24
 * @description 覆盖：Ctrl K 唤起并聚焦输入框、子序列模糊匹配后 Enter 打开工具、
 *              无结果空态提示、Esc 关闭、侧栏搜索按钮入口。
 */
import path from 'node:path'
import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'

const appDir = path.resolve(__dirname, '..')

async function launch(): Promise<ElectronApplication> {
  return electron.launch({ args: ['.'], cwd: appDir })
}

test.describe('工具搜索（壳级）', () => {
  test('Ctrl K 唤起，模糊匹配并回车打开工具', async () => {
    const app = await launch()
    try {
      const page = await app.firstWindow()
      await page.waitForSelector('[data-testid="tool-search-open"]')

      await page.keyboard.press('Control+k')
      const overlay = page.getByTestId('tool-search-overlay')
      await expect(overlay).toBeVisible()

      const input = overlay.getByRole('textbox')
      await expect(input).toBeFocused()

      // 子序列模糊匹配：「计器」应命中「计算器」
      await input.fill('计器')
      await expect(page.getByTestId('tool-search-result').first()).toContainText('计算器')

      await input.press('Enter')
      await expect(overlay).toBeHidden()
      await expect(page).toHaveURL(/#\/tools\/calculator/)
    } finally {
      await app.close()
    }
  })

  test('侧栏入口、无结果提示与 Esc 关闭', async () => {
    const app = await launch()
    try {
      const page = await app.firstWindow()
      await page.getByTestId('tool-search-open').click()

      const overlay = page.getByTestId('tool-search-overlay')
      await expect(overlay).toBeVisible()

      const input = overlay.getByRole('textbox')
      await input.fill('不存在的工具zzz')
      await expect(page.getByTestId('tool-search-empty')).toBeVisible()

      await input.press('Escape')
      await expect(overlay).toBeHidden()
    } finally {
      await app.close()
    }
  })
})
