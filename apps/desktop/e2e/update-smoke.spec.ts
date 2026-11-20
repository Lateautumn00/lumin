import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { test, expect, _electron as electron } from '@playwright/test'
import { clickSidebarTool } from './sidebar'

const appDir = path.resolve(__dirname, '..')
const oldExe = path.join(appDir, 'release', 'win-unpacked-old', 'Lumin.exe')
const installedExe = path.join(process.env['LOCALAPPDATA'] ?? '', 'Programs', 'Lumin', 'Lumin.exe')
// 新版版本号取仓库当前 package.json，避免版本升级后断言失配（M5）
const currentVersion = (
  JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8')) as { version: string }
).version

function killLumin(): void {
  try {
    execSync('taskkill /IM Lumin.exe /F', { stdio: 'ignore' })
  } catch {
    // 进程不存在时忽略
  }
}

test('更新冒烟：检测新版本 → 下载 → 静默安装 → 新版本运行', async () => {
  test.setTimeout(240_000)

  test.skip(
    !fs.existsSync(oldExe) || !fs.existsSync(path.join(appDir, 'release', 'latest.yml')),
    '需按 docs/smoke/shell.md §5 更新冒烟 准备新旧两版本产物'
  )
  let serverUp = false
  try {
    const res = await fetch('http://127.0.0.1:8787/latest.yml')
    serverUp = res.ok
  } catch {
    serverUp = false
  }
  test.skip(!serverUp, '需先启动本地更新源（pnpm update:serve，见 docs/smoke/shell.md §5）')

  const app = await electron.launch({ executablePath: oldExe })
  try {
    const page = await app.firstWindow()
    await clickSidebarTool(page, '关于')
    await page.getByRole('button', { name: '检查更新' }).click()
    await expect(page.getByText('已下载新版本')).toBeVisible({ timeout: 120_000 })
    await page.getByRole('button', { name: '安装并重启' }).click()
  } finally {
    await app.close().catch(() => undefined)
  }

  await expect.poll(() => fs.existsSync(installedExe), { timeout: 90_000 }).toBe(true)
  await new Promise((resolve) => setTimeout(resolve, 8000))
  killLumin()
  await new Promise((resolve) => setTimeout(resolve, 2000))

  const fresh = await electron.launch({ executablePath: installedExe })
  try {
    const page = await fresh.firstWindow()
    const info = await page.evaluate(() => window.lumin.getAppInfo())
    expect(info.appVersion).toBe(currentVersion)
  } finally {
    await fresh.close()
    killLumin()
  }
})
