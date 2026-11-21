/**
 * @file dev-toolbox（开发工具）e2e 冒烟：真实 Electron + 真实 netstat/tasklist/静态服务器
 * @author cuilanchao
 * @date 2026-11-21
 * @description 覆盖 spec §6 五条：三页签空态、CURL 转代码、端口查询与非法端口、
 *              静态服务器启停与真实 HTTP 访问、非法根目录错误态。
 *              注意：临时目录名必须 ASCII（非 ASCII 目录名会导致本机 Node fs 硬崩），文件名保留中文。
 *              本文件不执行破坏性操作（端口结束进程用例仅验证非法端口，不杀进程）。
 */
import fs from 'node:fs'
import { request as httpRequest } from 'node:http'
import net from 'node:net'
import os from 'node:os'
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

async function launch(): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({ args: ['.'], cwd: appDir })
  const page = await app.firstWindow()
  return { app, page }
}

/** 等待壳渲染层就绪（firstWindow 早于 bridge 注入时 evaluate 会丢失上下文） */
async function ensureReady(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded')
  await page.waitForFunction(() => typeof window.lumin !== 'undefined')
}

/** 造 ASCII 临时目录并清空 */
function freshDir(name: string): string {
  const dir = path.join(os.tmpdir(), name)
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

/** 取一个本机空闲端口 */
function freePort(): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    const probe = net.createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      probe.close(() => resolvePromise(port))
    })
  })
}

/** 真实 HTTP GET（绕过渲染层，断言静态服务器返回） */
function httpGet(port: number, urlPath: string): Promise<{ status: number; body: string }> {
  return new Promise((resolvePromise, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, path: urlPath }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () =>
        resolvePromise({
          status: res.statusCode ?? 0,
          body: Buffer.concat(chunks).toString('utf8')
        })
      )
    })
    req.on('error', reject)
    req.end()
  })
}

/** Naive UI 页签无 aria role，按 data-name 定位 */
function tab(page: Page, name: string): ReturnType<Page['locator']> {
  return page.locator(`.n-tabs-tab[data-name="${name}"]`)
}

test.describe('dev-toolbox（开发工具）冒烟', () => {
  test('页面加载：三页签与空态引导', async () => {
    const { app, page } = await launch()
    await ensureReady(page)
    try {
      // 清空记忆目录，避免跨用例/跨进程残留影响空态
      await page.evaluate(() =>
        window.lumin.invoke('dev-toolbox:set-config', { root: null, port: 8080 })
      )
      await clickSidebarTool(page, '计算器')
      await clickSidebarTool(page, '开发工具')
      await expect(page.getByRole('heading', { name: '开发工具' })).toBeVisible()

      await expect(tab(page, 'ports')).toContainText('端口占用')
      await expect(tab(page, 'curl')).toContainText('CURL 转代码')
      await expect(tab(page, 'server')).toContainText('静态服务器')

      await expect(page.getByText(/留空点击「查询」列出全部监听端口/)).toBeVisible()
      await expect(page.getByRole('button', { name: '查询' })).toBeVisible()

      await tab(page, 'curl').click()
      await expect(page.getByText(/粘贴 curl 命令后自动生成代码/)).toBeVisible()

      await tab(page, 'server').click()
      await expect(page.getByText(/选择根目录并点击「启动」/)).toBeVisible()
    } finally {
      await app.close()
    }
  })

  test('CURL 转代码：默认 fetch 与切换 python', async () => {
    const { app, page } = await launch()
    await ensureReady(page)
    try {
      await clickSidebarTool(page, '计算器')
      await clickSidebarTool(page, '开发工具')
      await tab(page, 'curl').click()

      const input = page.getByPlaceholder(/粘贴 curl 命令/)
      await input.fill(`curl 'https://api.example.com/x' -H 'X-A: 1'`)

      const output = page.locator('pre').first()
      await expect(output).toContainText('fetch(', { timeout: 10_000 })
      await expect(output).toContainText("'X-A': '1'")

      await page.getByText('python', { exact: true }).click()
      await expect(output).toContainText('requests.request', { timeout: 10_000 })

      await page.getByText('axios', { exact: true }).click()
      await expect(output).toContainText('axios(', { timeout: 10_000 })
    } finally {
      await app.close()
    }
  })

  test('端口查询：真实 netstat 返回行；非法端口显示 DT_INVALID_PORT', async () => {
    const { app, page } = await launch()
    await ensureReady(page)
    try {
      await clickSidebarTool(page, '计算器')
      await clickSidebarTool(page, '开发工具')
      await tab(page, 'ports').click()

      await page.getByRole('button', { name: '查询' }).click()
      const rows = page.locator('table tbody tr')
      await expect(rows.first()).toBeVisible({ timeout: 20_000 })
      expect(await rows.count()).toBeGreaterThan(0)

      await page.getByPlaceholder('端口（留空 = 全部）').fill('70000')
      await page.getByRole('button', { name: '查询' }).click()
      await expect(page.getByText(/DT_INVALID_PORT/)).toBeVisible()
    } finally {
      await app.close()
    }
  })

  test('静态服务器：启动后真实可访问，停止后回到空态', async () => {
    const { app, page } = await launch()
    await ensureReady(page)
    const dir = freshDir('lumin-dt-e2e-site')
    const port = await freePort()
    try {
      fs.writeFileSync(path.join(dir, 'index.html'), '<h1>dev toolbox e2e</h1>', 'utf8')
      fs.mkdirSync(path.join(dir, 'assets'))
      fs.writeFileSync(path.join(dir, 'assets', 'a.txt'), 'hello', 'utf8')

      await page.evaluate((payload) => window.lumin.invoke('dev-toolbox:set-config', payload), {
        root: dir,
        port
      })

      await clickSidebarTool(page, '计算器')
      await clickSidebarTool(page, '开发工具')
      await tab(page, 'server').click()
      await expect(page.getByPlaceholder('根目录（点击右侧选择）')).toHaveValue(dir)

      await page.getByRole('button', { name: '启动' }).click()
      await expect(page.getByText('服务运行中', { exact: true })).toBeVisible({ timeout: 15_000 })
      await expect(page.getByText(`http://127.0.0.1:${port}/`).first()).toBeVisible()

      const index = await httpGet(port, '/')
      expect(index.status).toBe(200)
      expect(index.body).toContain('dev toolbox e2e')

      const file = await httpGet(port, '/assets/a.txt')
      expect(file.status).toBe(200)
      expect(file.body).toBe('hello')

      await page.getByRole('button', { name: '停止' }).click()
      await expect(page.getByText(/选择根目录并点击「启动」/)).toBeVisible({ timeout: 15_000 })
      await expect(page.getByText('服务运行中', { exact: true })).toHaveCount(0)
    } finally {
      await app.close()
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  test('静态服务器：根目录不存在显示 DT_ROOT_INVALID 与重试入口', async () => {
    const { app, page } = await launch()
    await ensureReady(page)
    const missing = path.join(os.tmpdir(), 'lumin-dt-e2e-missing', 'no-such-dir')
    try {
      await page.evaluate((payload) => window.lumin.invoke('dev-toolbox:set-config', payload), {
        root: missing,
        port: await freePort()
      })

      await clickSidebarTool(page, '计算器')
      await clickSidebarTool(page, '开发工具')
      await tab(page, 'server').click()
      await expect(page.getByPlaceholder('根目录（点击右侧选择）')).toHaveValue(missing)

      await page.getByRole('button', { name: '启动' }).click()
      await expect(page.getByText(/DT_ROOT_INVALID/)).toBeVisible({ timeout: 15_000 })
      await expect(page.getByRole('button', { name: '重试' })).toBeVisible()
      await expect(page.getByText('服务运行中', { exact: true })).toHaveCount(0)
    } finally {
      await app.close()
    }
  })
})
