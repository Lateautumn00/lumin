/**
 * @file color-toolbox（颜色工具箱）e2e 冒烟：真实 Electron 驱动页面交互
 * @author cuilanchao
 * @date 2026-11-20
 * @description 覆盖：页面加载与默认色三格式展示、非法输入结构化报错与恢复、
 *              示例色/色阶联动与 WCAG 对比度判定（纯 renderer 工具，零 IPC）。
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

test.describe('color-toolbox（颜色工具箱）冒烟', () => {
  test('页面加载 + 默认色 HEX/RGB/HSL 三格式展示', async () => {
    const { app, page } = await launch()
    await ensureReady(page)
    try {
      await clickSidebarTool(page, '颜色工具箱')
      await expect(page.getByRole('heading', { name: '颜色工具箱' })).toBeVisible()
      await expect(page.getByText('#3B82F6', { exact: true }).first()).toBeVisible()
      await expect(page.getByText('rgb(59, 130, 246)', { exact: true })).toBeVisible()
      await expect(page.getByText('hsl(217, 91%, 60%)', { exact: true })).toBeVisible()
      await expect(page.getByText('3.68 : 1', { exact: true })).toBeVisible()
      await expect(page.getByRole('button', { name: '吸管取色' })).toBeVisible()
    } finally {
      await app.close()
    }
  })

  test('非法颜色显示结构化错误（码 → 中文文案），改回合法值后恢复', async () => {
    const { app, page } = await launch()
    await ensureReady(page)
    try {
      await clickSidebarTool(page, '颜色工具箱')
      const input = page.getByPlaceholder('#3B82F6')
      await input.fill('#12')
      await expect(page.getByRole('alert')).toContainText('颜色格式不正确')
      await expect(page.getByRole('alert')).toContainText('CT_INVALID_COLOR')

      await input.fill('#EF4444')
      await expect(page.getByRole('alert')).toHaveCount(0)
      await expect(page.getByText('rgb(239, 68, 68)', { exact: true })).toBeVisible()
      await expect(page.getByText('hsl(0, 84%, 60%)', { exact: true })).toBeVisible()
    } finally {
      await app.close()
    }
  })

  test('示例色与色阶联动主色，对比度数值与 AA/AAA 徽标随之更新', async () => {
    const { app, page } = await launch()
    await ensureReady(page)
    try {
      await clickSidebarTool(page, '颜色工具箱')
      await expect(page.getByText('正文 AA ≥4.5 未通过')).toBeVisible()
      await expect(page.getByText('大字 AA ≥3 通过')).toBeVisible()

      await page.getByRole('button', { name: '示例颜色 红' }).click()
      await expect(page.getByText('rgb(239, 68, 68)', { exact: true })).toBeVisible()
      await expect(page.getByText('3.76 : 1', { exact: true })).toBeVisible()

      await page.getByRole('button', { name: '色阶 #FDECEC' }).click()
      await expect(page.getByText('rgb(253, 236, 236)', { exact: true })).toBeVisible()
    } finally {
      await app.close()
    }
  })
})
