/**
 * @file theme-dark（深色主题切换）e2e 冒烟：真实 Electron + 真实 settings 持久化
 * @author cuilanchao
 * @date 2026-11-19
 * @description 覆盖：默认跟随系统与 matchMedia 一致、切深色/浅色（data-theme + token 计算值）、
 *              重启后持久化、结束恢复 system 避免污染后续用例。
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

type Page = Awaited<ReturnType<ElectronApplication['firstWindow']>>

const appDir = path.resolve(__dirname, '..')
const THEME_KEY = 'shell.theme.mode'

async function launch(): Promise<ElectronApplication> {
  return electron.launch({ args: ['.'], cwd: appDir })
}

async function openSettings(page: Page): Promise<void> {
  await clickSidebarTool(page, '设置')
  await expect(page.getByText('主题模式')).toBeVisible()
}

/** 预置持久化模式并重载，保证用例顺序无关 */
async function resetMode(page: Page, mode: string): Promise<void> {
  await page.evaluate(
    ([key, value]) => window.lumin.settings.set(key as string, value),
    [THEME_KEY, mode]
  )
  await page.reload()
}

function currentTheme(page: Page): Promise<string | undefined> {
  return page.evaluate(() => document.documentElement.dataset.theme)
}

function tokenValue(page: Page, name: string): Promise<string> {
  return page.evaluate(
    (cssVar) => getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim(),
    name
  )
}

test.describe('深色主题切换（M19）', () => {
  test('默认跟随系统且 data-theme 与系统偏好一致', async () => {
    const app = await launch()
    try {
      const page = await app.firstWindow()
      await resetMode(page, 'system')
      await openSettings(page)
      await expect(page.getByRole('radio', { name: '跟随系统' })).toBeChecked()

      const state = await page.evaluate(() => ({
        theme: document.documentElement.dataset.theme,
        systemDark: window.matchMedia('(prefers-color-scheme: dark)').matches
      }))
      expect(state.theme).toBe(state.systemDark ? 'dark' : 'light')
      await expect.poll(() => currentTheme(page)).toBe(state.systemDark ? 'dark' : 'light')
    } finally {
      await app.close()
    }
  })

  test('切深色/浅色：data-theme、tokens 与持久化同步', async () => {
    const app = await launch()
    try {
      const page = await app.firstWindow()
      await resetMode(page, 'system')
      await openSettings(page)

      await page.getByText('深色', { exact: true }).click()
      await expect(page.getByRole('radio', { name: '深色' })).toBeChecked()
      await expect.poll(() => currentTheme(page)).toBe('dark')
      expect(await tokenValue(page, '--lumin-color-bg')).toBe('#0b1220')
      expect(await tokenValue(page, '--lumin-color-text')).toBe('#e2e8f0')

      // 工具页复用 tokens：深色下壳背景应为暗色（无白底）
      await clickSidebarTool(page, '计算器')
      await expect.poll(() => currentTheme(page)).toBe('dark')
      const shellBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
      expect(shellBg).toBe('rgb(11, 18, 32)')
      await clickSidebarTool(page, '设置')

      await expect
        .poll(() =>
          page.evaluate(() => window.lumin.settings.get<string>('shell.theme.mode', 'system'))
        )
        .toBe('dark')

      await page.getByText('浅色', { exact: true }).click()
      await expect(page.getByRole('radio', { name: '浅色' })).toBeChecked()
      await expect.poll(() => currentTheme(page)).toBe('light')
      expect(await tokenValue(page, '--lumin-color-bg')).toBe('#f8fafc')
      await expect
        .poll(() =>
          page.evaluate(() => window.lumin.settings.get<string>('shell.theme.mode', 'system'))
        )
        .toBe('light')
    } finally {
      await app.close()
    }
  })

  test('重启应用后仍保持深色', async () => {
    let app = await launch()
    try {
      let page = await app.firstWindow()
      await resetMode(page, 'system')
      await openSettings(page)
      await page.getByText('深色', { exact: true }).click()
      await expect.poll(() => currentTheme(page)).toBe('dark')
      await expect
        .poll(() =>
          page.evaluate(() => window.lumin.settings.get<string>('shell.theme.mode', 'system'))
        )
        .toBe('dark')
      await app.close()

      app = await launch()
      page = await app.firstWindow()
      await openSettings(page)
      await expect(page.getByRole('radio', { name: '深色' })).toBeChecked()
      await expect.poll(() => currentTheme(page)).toBe('dark')
      expect(await tokenValue(page, '--lumin-color-bg')).toBe('#0b1220')

      // 清场：恢复跟随系统，避免污染后续 e2e 套件
      await page.evaluate((key) => window.lumin.settings.set(key, 'system'), THEME_KEY)
    } finally {
      await app.close()
    }
  })
})
