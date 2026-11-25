/**
 * @file 媒体工具箱 - 播放页签 e2e 冒烟：真实 Electron + 真实主进程（M73 由 video-player 整包并入）
 * @author cuilanchao
 * @date 2026-11-25
 * @description 覆盖：mp4/webm 解析、mkv 拒绝、缺失/目录、中文/空格/# 路径的无损编码、
 *              UI 打开真实 WebM 并播放（原生 controls）、不支持格式错误态。
 *              前置：pnpm -F @lumin/desktop build。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
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
const ffmpeg = path.resolve(appDir, '../../binaries/download/ffmpeg.exe')

interface ResolveResult {
  url: string
  name: string
  size: number
  mime: string
}

async function launch(): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({ args: ['.'], cwd: appDir })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await page.waitForFunction(() => typeof window.lumin !== 'undefined')
  return { app, page }
}

/** 生成测试工作目录（ASCII 名称，内部可含中文/空格路径） */
function freshDir(name: string): string {
  const dir = path.join(os.tmpdir(), name)
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

/** 同步通道 invoke */
function invoke<T>(page: Page, channel: string, payload: unknown): Promise<T> {
  return page.evaluate(
    ({ channel, payload }) => window.lumin.invoke(channel, payload) as Promise<unknown>,
    { channel, payload }
  ) as Promise<T>
}

/** 同步通道错误码 */
async function invokeError(
  page: Page,
  channel: string,
  payload: unknown
): Promise<{ code: string; message: string; detail?: string }> {
  return page.evaluate(
    ({ channel, payload }) =>
      window.lumin
        .invoke(channel, payload)
        .then(() => ({ code: 'UNEXPECTED_SUCCESS', message: '' }))
        .catch((err: unknown) => {
          const structured = err as { code?: string; message?: string; detail?: string }
          return {
            code: structured.code ?? 'UNKNOWN',
            message: structured.message ?? String(err),
            detail: structured.detail
          }
        }),
    { channel, payload }
  )
}

/** lumin-media://local/<base64url(UTF-16LE)> → 本地路径（与 shared toMediaUrl 同口径） */
function decodeMediaUrl(url: string): string {
  const token = url.replace(/^lumin-media:\/\/local\//, '')
  return Buffer.from(token, 'base64url').toString('utf16le')
}

/**
 * 用仓库 ffmpeg（lavfi 合成）生成 1 秒 64x64 VP8 WebM（免入库 fixture）
 * @param target 输出绝对路径
 */
function makeWebm(target: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      ffmpeg,
      [
        '-y',
        '-v',
        'error',
        '-f',
        'lavfi',
        '-i',
        'testsrc=size=64x64:rate=10:duration=1',
        '-c:v',
        'libvpx',
        '-b:v',
        '200k',
        target
      ],
      { windowsHide: true }
    )
    let stderr = ''
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(stderr))))
  })
}

/** 进入媒体工具箱并切到「播放」页签（默认页签为格式转换） */
async function openPlayerTab(page: Page): Promise<void> {
  await clickSidebarTool(page, '媒体工具箱')
  await page.locator('.n-tabs-tab[data-name="player"]').click()
}

test.describe('媒体工具箱 - 播放页签冒烟', () => {
  test('IPC：mp4/webm 解析为媒体协议 URL 与元信息', async () => {
    const { app, page } = await launch()
    const workDir = freshDir('lumin-vp-e2e-resolve')
    try {
      const mp4 = path.join(workDir, '片段.mp4')
      fs.writeFileSync(mp4, Buffer.from('fake-mp4'))
      const result = await invoke<ResolveResult>(page, 'media-convert:player-resolve', {
        path: mp4
      })
      expect(result.url.startsWith('lumin-media://local/')).toBe(true)
      expect(decodeMediaUrl(result.url)).toBe(mp4)
      expect(result.name).toBe('片段.mp4')
      expect(result.size).toBe(8)
      expect(result.mime).toBe('video/mp4')

      const webm = path.join(workDir, 'b.webm')
      fs.writeFileSync(webm, Buffer.from('xx'))
      expect(
        (await invoke<ResolveResult>(page, 'media-convert:player-resolve', { path: webm })).mime
      ).toBe('video/webm')
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true })
      await app.close()
    }
  })

  test('IPC：mkv 拒绝、缺失、目录（.mp4 结尾）错误码', async () => {
    const { app, page } = await launch()
    const workDir = freshDir('lumin-vp-e2e-errors')
    try {
      const mkv = path.join(workDir, '视频.mkv')
      fs.writeFileSync(mkv, Buffer.from('x'))
      const unsupported = await invokeError(page, 'media-convert:player-resolve', { path: mkv })
      expect(unsupported.code).toBe('VP_UNSUPPORTED_FORMAT')

      expect(
        (
          await invokeError(page, 'media-convert:player-resolve', {
            path: path.join(workDir, '缺失.mp4')
          })
        ).code
      ).toBe('VP_NOT_FOUND')

      const fakeDir = path.join(workDir, '伪装.mp4')
      fs.mkdirSync(fakeDir)
      expect(
        (await invokeError(page, 'media-convert:player-resolve', { path: fakeDir })).code
      ).toBe('VP_RESOLVE_FAILED')
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true })
      await app.close()
    }
  })

  test('IPC：中文/空格/# 路径无损编码', async () => {
    const { app, page } = await launch()
    const workDir = freshDir('lumin-vp-e2e-encode')
    try {
      const dir = path.join(workDir, '中文 目录')
      fs.mkdirSync(dir, { recursive: true })
      const file = path.join(dir, '视频 #1.webm')
      fs.writeFileSync(file, Buffer.from('x'))
      const result = await invoke<ResolveResult>(page, 'media-convert:player-resolve', {
        path: file
      })
      expect(result.url.startsWith('lumin-media://local/')).toBe(true)
      expect(decodeMediaUrl(result.url)).toBe(file)
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true })
      await app.close()
    }
  })

  test('UI：打开真实 WebM 播放、换一个视频回到空态', async () => {
    test.skip(!fs.existsSync(ffmpeg), '需要 binaries/download/ffmpeg.exe（fetch-binaries）')
    const { app, page } = await launch()
    const workDir = freshDir('lumin-vp-e2e-play')
    try {
      const file = path.join(workDir, '演示 视频.webm')
      await makeWebm(file)

      await openPlayerTab(page)
      await expect(page.getByText('拖拽视频到此处，或点击选择', { exact: false })).toBeVisible()
      await page.locator('[data-testid="player-tab"] input[type="file"]').setInputFiles(file)

      await expect(page.getByRole('heading', { name: '演示 视频.webm' })).toBeVisible()
      const video = page.locator('video')
      await expect(video).toBeVisible()
      await expect(video).toHaveAttribute('src', /^lumin-media:\/\/local\/[A-Za-z0-9_-]+$/)
      const src = await video.getAttribute('src')
      expect(decodeMediaUrl(src ?? '')).toBe(file)
      // 倍速/全屏由原生控制栏提供，页面不再有自定义控件
      await expect(video).toHaveAttribute('controls', '')

      // 真实可解码：readyState >= 2（HAVE_CURRENT_DATA）且无 MediaError
      await page.waitForFunction(() => {
        const el = document.querySelector('video')
        return el !== null && el.readyState >= 2 && el.error === null
      })

      await page.getByRole('button', { name: '换一个视频' }).click()
      await expect(page.getByText('拖拽视频到此处，或点击选择', { exact: false })).toBeVisible()
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true })
      await app.close()
    }
  })

  test('UI：不支持格式（.mkv）→ 错误态与重选入口', async () => {
    const { app, page } = await launch()
    const workDir = freshDir('lumin-vp-e2e-unsupported')
    try {
      const mkv = path.join(workDir, '不支持.mkv')
      fs.writeFileSync(mkv, Buffer.from('x'))

      await openPlayerTab(page)
      await page.locator('[data-testid="player-tab"] input[type="file"]').setInputFiles(mkv)

      await expect(page.getByText('错误码：VP_UNSUPPORTED_FORMAT')).toBeVisible()
      await page.getByRole('button', { name: '重新选择' }).click()
      await expect(page.getByText('拖拽视频到此处，或点击选择', { exact: false })).toBeVisible()
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true })
      await app.close()
    }
  })
})
