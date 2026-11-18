/**
 * 视频下载 e2e（假引擎，不依赖外网）
 * 作者：cuilanchao · 修改时间：2026-11-18
 * 覆盖：免责弹窗三态流、probe 信息卡、下载进度 → 历史完成态、probe 报错态、清空历史。
 * 引擎：csc.exe 编译 fake-engine.cs 为真实 PE 临时替换 binaries/download/yt-dlp.exe（afterEach 还原）。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import path from 'node:path'
import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
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

test.describe('视频下载（假引擎）', () => {
  let app: ElectronApplication

  test.beforeEach(async () => {
    installFakeEngine()
    app = await electron.launch({ args: ['.'], cwd: appDir })
    const page = await app.firstWindow()
    // 测试隔离：清空工具历史与免责状态
    await page.evaluate(() => {
      void window.lumin.settings.set('tools.video-download.history', [])
      void window.lumin.settings.set('tools.video-download.disclaimerAccepted', false)
    })
  })

  test.afterEach(async () => {
    await app.close()
    restoreEngine()
  })

  test('免责弹窗 → 同意后解锁主功能区（持久化）', async () => {
    const page = await app.firstWindow()
    await page.getByRole('link', { name: '视频下载' }).click()
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
    await page.getByRole('link', { name: '视频下载' }).click()
    await expect(page.getByText('使用前须知')).toBeHidden()
  })

  test('probe 信息卡 + 下载进度 → 历史 DONE + 打开文件夹入口', async () => {
    const page = await app.firstWindow()
    await page.getByRole('link', { name: '视频下载' }).click()
    // 免责预置为已同意（本用例专注下载主链路）
    await page.evaluate(() =>
      window.lumin.settings.set('tools.video-download.disclaimerAccepted', true)
    )
    await page.reload()
    await page.getByRole('link', { name: '视频下载' }).click()

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
    await page.getByRole('link', { name: '视频下载' }).click()
    await page.evaluate(() =>
      window.lumin.settings.set('tools.video-download.disclaimerAccepted', true)
    )
    await page.reload()
    await page.getByRole('link', { name: '视频下载' }).click()

    await page.getByPlaceholder('https://…').fill('https://example.com/fail/1')
    await page.getByRole('button', { name: '获取信息' }).click()
    await expect(page.getByText('无法获取视频信息，请确认链接可公开访问')).toBeVisible()
    await page.getByText('详情').click()
    await expect(page.getByText('e2e fake engine failure')).toBeVisible()
    await expect(page.getByRole('button', { name: '重试' })).toBeVisible()
  })

  test('清空历史（二次确认）', async () => {
    const page = await app.firstWindow()
    await page.getByRole('link', { name: '视频下载' }).click()
    await page.evaluate(() =>
      window.lumin.settings.set('tools.video-download.disclaimerAccepted', true)
    )
    await page.evaluate(() =>
      window.lumin.settings.set('tools.video-download.history', [
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
    await page.getByRole('link', { name: '视频下载' }).click()
    await expect(page.getByText('历史样例')).toBeVisible()

    await page.getByRole('button', { name: '清空历史' }).click()
    await page.getByRole('button', { name: '确认' }).click()
    await expect(page.getByText('历史样例')).toBeHidden()
    await expect(page.getByText('粘贴视频链接开始下载')).toBeVisible()
  })
})
