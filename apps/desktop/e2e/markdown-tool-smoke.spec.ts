/**
 * @file markdown-tool（Markdown 工具）e2e 冒烟：真实 Electron 驱动页面交互
 * @author cuilanchao
 * @date 2026-11-21
 * @description 覆盖：三页签与 Markdown 预览、JSON→TS 生成与报错恢复、JSON Schema 模式、YAML 三模式与报错、导出 HTML 与重名递增。
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
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

test.describe('markdown-tool（Markdown 工具）冒烟', () => {
  test('页面加载 + 三页签 + 示例预览与统计', async () => {
    const { app, page } = await launch()
    await ensureReady(page)
    try {
      await clickSidebarTool(page, 'Markdown 工具')
      await expect(page.getByRole('heading', { name: 'Markdown 工具' })).toBeVisible()
      await expect(page.getByText('Markdown', { exact: true })).toBeVisible()
      await expect(page.getByText('JSON→TS', { exact: true })).toBeVisible()
      await expect(page.getByText('YAML', { exact: true })).toBeVisible()

      // 空态引导
      await expect(page.getByText('在左侧输入 Markdown，或点击「载入示例」')).toBeVisible()

      await page.getByTestId('load-sample').click()
      const preview = page.frameLocator('[data-testid="md-preview"]')
      await expect(preview.locator('h1')).toHaveText('Lumin Markdown 示例')
      await expect(preview.locator('table')).toBeVisible()
      await expect(page.getByTestId('md-stats')).toContainText('字符')
      await expect(page.getByTestId('md-stats')).not.toContainText('字符 0')
    } finally {
      await app.close()
    }
  })

  test('JSON→TS：生成 interface → 非法 JSON 报错 → 恢复', async () => {
    const { app, page } = await launch()
    await ensureReady(page)
    try {
      await clickSidebarTool(page, 'Markdown 工具')
      await page.getByText('JSON→TS', { exact: true }).click()

      const input = page.locator('[data-testid="ts-input"] textarea')
      const output = page.locator('[data-testid="ts-output"] textarea')

      await input.fill('{"id":1,"name":"lumin"}')
      await expect(output).toHaveValue(/export interface Root/)
      await expect(output).toHaveValue(/name: string/)

      await input.fill('{')
      await expect(page.getByTestId('ts-error')).toContainText('MD_JSON_INVALID')
      await expect(output).toHaveValue('')

      await input.fill('{"ok":true}')
      await expect(page.getByTestId('ts-error')).toHaveCount(0)
      await expect(output).toHaveValue(/ok: boolean/)
    } finally {
      await app.close()
    }
  })

  test('JSON→TS：json-schema 输出 draft-07/$defs，切回 interface 恢复', async () => {
    const { app, page } = await launch()
    await ensureReady(page)
    try {
      await clickSidebarTool(page, 'Markdown 工具')
      await page.getByText('JSON→TS', { exact: true }).click()

      const input = page.locator('[data-testid="ts-input"] textarea')
      const output = page.locator('[data-testid="ts-output"] textarea')
      const style = page.getByTestId('ts-style')
      const fileName = page.getByTestId('ts-file-name').locator('input')

      await input.fill('{"id":1,"user":{"name":"a"}}')
      await expect(output).toHaveValue(/export interface Root/)
      await expect(fileName).toHaveValue('types')

      await style.getByText('json-schema', { exact: true }).click()
      await expect(output).toHaveValue(/"\$schema": "http:\/\/json-schema.org\/draft-07\/schema#"/)
      await expect(output).toHaveValue(/"type": "object"/)
      await expect(output).toHaveValue(/"\$ref": "#\/\$defs\/RootUser"/)
      await expect(output).toHaveValue(/"\$defs"/)
      await expect(page.getByText('导出 .json', { exact: false })).toBeVisible()
      await expect(fileName).toHaveValue('schema')

      await style.getByText('interface', { exact: true }).click()
      await expect(output).toHaveValue(/export interface Root/)
      await expect(fileName).toHaveValue('types')
    } finally {
      await app.close()
    }
  })

  test('YAML：YAML→JSON / JSON→YAML / 语法错误', async () => {
    const { app, page } = await launch()
    await ensureReady(page)
    try {
      await clickSidebarTool(page, 'Markdown 工具')
      await page.getByText('YAML', { exact: true }).click()

      const input = page.locator('[data-testid="yaml-input"] textarea')
      const output = page.locator('[data-testid="yaml-output"] textarea')

      await input.fill('a: 1\nb:\n  - x\n')
      await expect(output).toHaveValue(/"a": 1/)
      await expect(output).toHaveValue(/"x"/)

      await page.getByText('JSON→YAML', { exact: true }).click()
      await input.fill('{"a":1}')
      await expect(output).toHaveValue(/a: 1/)

      await page.getByText('YAML→JSON', { exact: true }).click()
      await input.fill('a: [')
      await expect(page.getByTestId('yaml-error')).toContainText('MD_YAML_INVALID')
    } finally {
      await app.close()
    }
  })

  test('导出 HTML：中文空格文件名 + 重名递增 (1)', async () => {
    const { app, page } = await launch()
    await ensureReady(page)
    const outputDir = mkdtempSync(path.join(tmpdir(), 'lumin-md-e2e-'))
    try {
      await clickSidebarTool(page, 'Markdown 工具')
      await page.evaluate(
        async (dir) => window.lumin.invoke('markdown-tool:set-output-dir', { outputDir: dir }),
        outputDir
      )
      await page.getByTestId('load-sample').click()
      await page.getByTestId('md-file-name').locator('input').fill('中文 空格')
      await page.getByTestId('export-html').click()

      const first = path.join(outputDir, '中文 空格.html')
      await expect.poll(() => existsSync(first)).toBe(true)
      await expect(page.getByTestId('export-notice')).toContainText('已导出')
      const content = readFileSync(first, 'utf8')
      expect(content).toContain('<!doctype html>')
      expect(content).toContain('Lumin Markdown 示例')

      await page.getByTestId('export-html').click()
      const second = path.join(outputDir, '中文 空格(1).html')
      await expect.poll(() => existsSync(second)).toBe(true)
    } finally {
      await app.close()
      rmSync(outputDir, { recursive: true, force: true })
    }
  })
})
