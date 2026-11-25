/**
 * 媒体工具箱 - 下载页签 e2e（假引擎，不依赖外网；M73 由 video-download 整包并入）
 * 作者：cuilanchao · 修改时间：2026-11-25
 * 覆盖：免责弹窗三态流、probe 信息卡、下载进度 → 历史完成态、probe 报错态、清空历史。
 * 引擎：csc.exe 编译 fake-engine.cs 为真实 PE 临时替换 binaries/download/yt-dlp.exe（afterEach 还原）。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import path from 'node:path'
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { clickSidebarTool } from './sidebar'
import type { LuminBridge } from '@lumin/plugin-api'

declare global {
  interface Window {
    lumin: LuminBridge
  }
}

const appDir = path.resolve(__dirname, '..')
const repoRoot = path.resolve(appDir, '..', '..')
const engineDir = path.join(repoRoot, 'binaries', 'download')
const enginePath = path.join(engineDir, 'yt-dlp.exe')
const engineBackupPath = path.join(engineDir, 'yt-dlp.exe.e2e-bak')
const fakeSource = path.join(__dirname, 'fake-engine.cs')
const CSC = 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe'

/** 编译假引擎并临时替换真实 yt-dlp.exe（真实引擎备份为 .e2e-bak，afterEach 还原） */
function installFakeEngine(): void {
  test.skip(!existsSync(CSC), 'csc.exe 不可用，跳过假引擎 e2e')
  mkdirSync(engineDir, { recursive: true })
  if (existsSync(enginePath) && !existsSync(engineBackupPath)) {
    renameSync(enginePath, engineBackupPath)
  }
  const result = spawnSync(CSC, ['/nologo', '/target:exe', `/out:${enginePath}`, fakeSource], {
    encoding: 'utf8'
  })
  if (result.status !== 0 || !existsSync(enginePath)) {
    throw new Error(`假引擎编译失败：${result.stderr ?? result.stdout ?? '未知错误'}`)
  }
}

function restoreEngine(): void {
  rmSync(enginePath, { force: true })
  if (existsSync(engineBackupPath)) renameSync(engineBackupPath, enginePath)
}

/** 进入媒体工具箱并切到「下载」页签（默认页签为格式转换） */
async function openDownloadTab(page: Page): Promise<void> {
  await clickSidebarTool(page, '媒体工具箱')
  await page.locator('.n-tabs-tab[data-name="download"]').click()
}

test.describe('媒体工具箱 - 下载页签（假引擎）', () => {
  let app: ElectronApplication

  test.beforeEach(async () => {
    installFakeEngine()
    app = await electron.launch({ args: ['.'], cwd: appDir })
    const page = await app.firstWindow()
    // 测试隔离：清空工具历史、免责状态与三平台 Cookie（残留会让「未配置」断言失效）
    await page.evaluate(() => {
      void window.lumin.settings.set('tools.media-convert.download.history', [])
      void window.lumin.settings.set('tools.media-convert.download.disclaimerAccepted', false)
      void window.lumin.settings.set('tools.media-convert.download.cookies.douyin', null)
      void window.lumin.settings.set('tools.media-convert.download.cookies.bilibili', null)
      void window.lumin.settings.set('tools.media-convert.download.cookies.youtube', null)
    })
  })

  test.afterEach(async () => {
    await app.close()
    restoreEngine()
  })

  test('免责弹窗 → 同意后解锁主功能区（持久化）', async () => {
    const page = await app.firstWindow()
    await openDownloadTab(page)
    await expect(page.getByText('使用前须知')).toBeVisible()
    // 未同意时主功能区置灰（下载按钮禁用）
    await expect(page.getByRole('button', { name: '下载' })).toBeDisabled()
    // 「不再提示」默认勾选，直接同意 → 持久化
    await page.getByRole('button', { name: '同意并继续' }).click()
    await expect(page.getByText('使用前须知')).toBeHidden()
    await expect(page.getByText('仅供个人学习与研究使用，请遵守平台条款与著作权法')).toBeVisible()
    // 填入合法 URL 后主操作解锁
    await page.getByPlaceholder('https://…').fill('https://example.com/watch/1')
    await expect(page.getByRole('button', { name: '下载' })).toBeEnabled()

    // 持久化：重新进入不再弹窗
    await page.reload()
    await openDownloadTab(page)
    await expect(page.getByText('使用前须知')).toBeHidden()
  })

  test('probe 信息卡 + 下载进度 → 历史 DONE + 打开文件夹入口', async () => {
    const page = await app.firstWindow()
    await openDownloadTab(page)
    // 免责预置为已同意（本用例专注下载主链路）
    await page.evaluate(() =>
      window.lumin.settings.set('tools.media-convert.download.disclaimerAccepted', true)
    )
    await page.reload()
    await openDownloadTab(page)

    const urlInput = page.getByPlaceholder('https://…')
    await urlInput.fill('https://example.com/watch/1')
    await page.getByRole('button', { name: '获取信息' }).click()
    await expect(page.getByText('e2e 假视频')).toBeVisible()
    await expect(page.getByText('bilibili.com')).toBeVisible()

    await page.getByRole('button', { name: '下载', exact: true }).click()
    await expect(page.getByText('下载历史')).toBeVisible()
    await expect(page.getByText('https://example.com/watch/1').first()).toBeVisible()
    await expect(page.getByText('已完成').first()).toBeVisible()
    await expect(page.getByText('e2e-fake-video.mp4')).toBeVisible()
    await expect(page.getByRole('button', { name: '打开文件夹' })).toBeVisible()
  })

  test('probe 报错态：结构化错误 + 详情 + 重试', async () => {
    const page = await app.firstWindow()
    await openDownloadTab(page)
    await page.evaluate(() =>
      window.lumin.settings.set('tools.media-convert.download.disclaimerAccepted', true)
    )
    await page.reload()
    await openDownloadTab(page)

    await page.getByPlaceholder('https://…').fill('https://example.com/fail/1')
    await page.getByRole('button', { name: '获取信息' }).click()
    await expect(page.getByText('无法获取视频信息，请确认链接可公开访问')).toBeVisible()
    await page.getByText('详情').click()
    await expect(page.getByText('e2e fake engine failure')).toBeVisible()
    await expect(page.getByRole('button', { name: '重试' })).toBeVisible()
  })

  test('清空历史（二次确认）', async () => {
    const page = await app.firstWindow()
    await openDownloadTab(page)
    await page.evaluate(() =>
      window.lumin.settings.set('tools.media-convert.download.disclaimerAccepted', true)
    )
    await page.evaluate(() =>
      window.lumin.settings.set('tools.media-convert.download.history', [
        {
          id: 'e2e-task',
          url: 'https://example.com/watch/2',
          title: '历史样例',
          preset: 'best',
          outputDir: 'E:\\out',
          status: 'DONE',
          startedAt: 1
        }
      ])
    )
    await page.reload()
    await openDownloadTab(page)
    await expect(page.getByText('历史样例')).toBeVisible()

    await page.getByRole('button', { name: '清空历史' }).click()
    await page.getByRole('button', { name: '确认' }).click()
    await expect(page.getByText('历史样例')).toBeHidden()
    await expect(page.getByText('粘贴视频链接开始下载')).toBeVisible()
  })

  test('Cookie 管理：粘贴保存 → 平台独立 → 删除（spec §9.5）', async () => {
    const page = await app.firstWindow()
    await openDownloadTab(page)
    await page.getByRole('button', { name: '同意并继续' }).click()
    await page.getByRole('button', { name: 'Cookie 管理' }).click()
    await expect(page.getByText(/配置浏览器 Cookie 后可下载登录可见内容/)).toBeVisible()
    await expect(page.getByText('未配置').first()).toBeVisible()

    // B站 Tab：粘贴保存（Header 行形态，两对键值）
    // 切到 B站：粘贴保存（Header 行形态，两对键值）
    await page.getByRole('button', { name: 'B站' }).click()
    await page.getByPlaceholder(/粘贴浏览器导出的 Cookie/).fill('SESSDATA=xyz; buvid3=abc-def')
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await expect(page.getByText('已保存 2 条', { exact: true })).toBeVisible()
    await expect(page.getByText(/^已存 2 条/)).toBeVisible()

    // 平台独立：切回抖音按钮，仍为未配置
    await page.getByRole('button', { name: '抖音' }).click()
    await expect(page.getByText('未配置').first()).toBeVisible()

    // 删除 B站（二次确认）→ 回到未配置
    await page.getByRole('button', { name: 'B站' }).click()
    await page.getByRole('button', { name: '删除' }).click()
    await page.getByRole('button', { name: '确认' }).click()
    await expect(page.getByText('未配置').first()).toBeVisible()

    // 非法输入 → 结构化报错态
    await page.getByPlaceholder(/粘贴浏览器导出的 Cookie/).fill('没有等号的垃圾内容')
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await expect(page.getByText('Cookie 格式无法识别，请粘贴浏览器导出的 Cookie')).toBeVisible()
  })
})
