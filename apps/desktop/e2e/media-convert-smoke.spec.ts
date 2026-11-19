/**
 * @file media-convert（音视频处理）e2e 冒烟：真实 Electron + 真实 ffmpeg 二进制
 * @author cuilanchao
 * @date 2026-11-19
 * @description 覆盖 spec §8：probe（中文+空格路径/音频-only/损坏）、转码 webm、截取（精确/快速）、
 *              提取音频（无视频流断言）、压缩 720p（只缩不放）、批量部分失败、任务取消。
 *              注意：临时目录名必须 ASCII（本机 Node fs 非 ASCII 目录名会硬崩/静默不删），
 *              文件名保留中文验证路径。前置：node scripts/fetch-binaries.mjs（ffmpeg.exe）
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import type { LuminBridge } from '@lumin/plugin-api'

declare global {
  interface Window {
    lumin: LuminBridge
  }
}

const appDir = path.resolve(__dirname, '..')
const ffmpeg = path.resolve(appDir, '../../binaries/download/ffmpeg.exe')

interface ProbeOutcome {
  items: {
    file: string
    durationSec: number
    video: { codec: string; width: number; height: number } | null
    audio: { codec: string } | null
  }[]
  failures: { file: string; code: string }[]
}

interface ProcessOutcome {
  outputs: { input: string; output: string; durationSec: number }[]
  failures: { input: string; code: string }[]
}

async function launch(): Promise<{
  app: ElectronApplication
  page: Awaited<ReturnType<ElectronApplication['firstWindow']>>
}> {
  const app = await electron.launch({ args: ['.'], cwd: appDir })
  const page = await app.firstWindow()
  return { app, page }
}

/** noUncheckedIndexedAccess 收窄：取首元素，空数组抛错 */
function firstOf<T>(items: T[]): T {
  const item = items[0]
  if (item === undefined) throw new Error('数组为空')
  return item
}

/** 等待壳渲染层就绪（同 image-toolbox 冒烟：避免 hash 跳转丢失 evaluate 上下文） */
async function ensureReady(
  page: Awaited<ReturnType<ElectronApplication['firstWindow']>>
): Promise<void> {
  await page.waitForLoadState('domcontentloaded')
  await page.waitForFunction(() => typeof window.lumin !== 'undefined')
}

/** 用仓库 ffmpeg 生成测试素材（lavfi 合成，免入库 fixture） */
function makeMedia(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, ['-y', '-v', 'error', ...args], { windowsHide: true })
    let stderr = ''
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(stderr))))
  })
}

/** `ffmpeg -i` 复读 stderr（无 ffprobe，同 tools 口径） */
function readMedia(file: string): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn(ffmpeg, ['-hide_banner', '-i', file], { windowsHide: true })
    let stderr = ''
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.on('close', () => resolve(stderr))
  })
}

/** 从 `ffmpeg -i` stderr 取时长（秒）；无 Duration → 0 */
function durationOf(stderr: string): number {
  const match = /Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(stderr)
  if (match === null) return 0
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])
}

/**
 * 提交处理任务并在页面内等待 done/error（先订阅后提交，防事件丢失）
 * @param page Electron 窗口
 * @param payload media-convert:process 入参
 */
async function runProcess(
  page: Awaited<ReturnType<ElectronApplication['firstWindow']>>,
  payload: unknown
): Promise<ProcessOutcome> {
  return page.evaluate(
    (args: unknown) =>
      new Promise<ProcessOutcome>((resolve, reject) => {
        let currentTaskId = ''
        const off = window.lumin.onTaskEvent((ev) => {
          if (ev.taskId !== currentTaskId) return
          if (ev.kind === 'done') {
            off()
            resolve(ev.result as ProcessOutcome)
          } else if (ev.kind === 'error') {
            off()
            reject(new Error(`${ev.error.code}: ${ev.error.message}`))
          }
        })
        window.lumin
          .invoke<{ taskId: string }>('media-convert:process', args)
          .then(({ taskId }) => {
            currentTaskId = taskId
          })
          .catch((err: unknown) => {
            off()
            reject(err)
          })
      }),
    payload
  )
}

/** 生成 3s 640x360 测试视频（H.264 + AAC） */
function makeSampleVideo(file: string): Promise<void> {
  return makeMedia([
    '-f',
    'lavfi',
    '-i',
    'testsrc=size=640x360:rate=25:duration=3',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=3',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-shortest',
    file
  ])
}

test.describe('media-convert（音视频处理）冒烟', () => {
  test.beforeAll(async () => {
    test.skip(!fs.existsSync(ffmpeg), '缺少 ffmpeg（先跑 node scripts/fetch-binaries.mjs）')
  })

  test('页面加载 + probe（中文+空格路径 / 音频-only / 损坏）', async () => {
    test.setTimeout(120_000)
    const { app, page } = await launch()
    await ensureReady(page)
    const workDir = path.join(os.tmpdir(), 'lumin-mc-e2e-probe')
    fs.rmSync(workDir, { recursive: true, force: true })
    fs.mkdirSync(workDir, { recursive: true })
    try {
      await page.getByRole('link', { name: '音视频处理' }).click()
      await expect(page.getByRole('heading', { name: '音视频处理' })).toBeVisible()
      // 四 Tab 标签可见（naive-ui 自闭合 pane 渲染回归）
      for (const [name, label] of [
        ['transcode', '转码'],
        ['trim', '截取'],
        ['extract-audio', '提取音频'],
        ['compress', '压缩']
      ] as const) {
        const tab = page.locator(`.n-tabs-tab[data-name="${name}"]`)
        await expect(tab).toBeVisible()
        await expect(tab).toHaveText(label)
      }

      const video = path.join(workDir, '样例 视频.mp4')
      const audio = path.join(workDir, '样例.mp3')
      const corrupt = path.join(workDir, '损坏.mp4')
      await makeSampleVideo(video)
      await makeMedia(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', audio])
      fs.writeFileSync(corrupt, Buffer.from('not a media file'))

      const outcome = await page.evaluate(
        (files: string[]) =>
          window.lumin.invoke<ProbeOutcome>('media-convert:probe', { files }),
        [video, audio, corrupt]
      )
      expect(outcome.items).toHaveLength(2)
      const videoItem = firstOf(outcome.items)
      expect(videoItem.durationSec).toBeGreaterThan(2.5)
      expect(videoItem.video).toMatchObject({ width: 640, height: 360 })
      expect(videoItem.audio).not.toBeNull()
      expect(outcome.items[1]?.video).toBeNull()
      expect(outcome.items[1]?.audio).not.toBeNull()
      expect(outcome.failures).toHaveLength(1)
      expect(firstOf(outcome.failures).code).toBe('MC_FILE_CORRUPT')
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true })
      await app.close()
    }
  })

  test('转码 mp4 → webm：输出存在且时长≈源（spec §8.1）', async () => {
    test.setTimeout(180_000)
    const { app, page } = await launch()
    await ensureReady(page)
    const inDir = path.join(os.tmpdir(), 'lumin-mc-e2e-transcode')
    const outDir = path.join(inDir, 'out')
    fs.rmSync(inDir, { recursive: true, force: true })
    fs.mkdirSync(inDir, { recursive: true })
    try {
      const input = path.join(inDir, '转码 样例.mp4')
      await makeSampleVideo(input)
      const result = await runProcess(page, {
        mode: 'transcode',
        files: [input],
        outputDir: outDir,
        options: { format: 'webm', quality: 'low' }
      })
      expect(result.failures).toEqual([])
      const output = firstOf(result.outputs).output
      expect(output).toBe(path.join(outDir, '转码 样例.webm'))
      expect(fs.existsSync(output)).toBe(true)
      const duration = durationOf(await readMedia(output))
      expect(duration).toBeGreaterThan(2.4)
      expect(duration).toBeLessThan(3.8)
    } finally {
      fs.rmSync(inDir, { recursive: true, force: true })
      await app.close()
    }
  })

  test('截取 1s→2s：精确输出时长≈1s；快速模式产物存在（spec §8.2）', async () => {
    test.setTimeout(180_000)
    const { app, page } = await launch()
    await ensureReady(page)
    const inDir = path.join(os.tmpdir(), 'lumin-mc-e2e-trim')
    const outDir = path.join(inDir, 'out')
    fs.rmSync(inDir, { recursive: true, force: true })
    fs.mkdirSync(inDir, { recursive: true })
    try {
      const input = path.join(inDir, '截取 样例.mp4')
      await makeSampleVideo(input)

      const precise = await runProcess(page, {
        mode: 'trim',
        files: [input],
        outputDir: outDir,
        options: { startSec: 1, endSec: 2, fastCopy: false }
      })
      expect(precise.failures).toEqual([])
      const preciseOut = firstOf(precise.outputs).output
      expect(preciseOut).toBe(path.join(outDir, '截取 样例.cut_000001-000002.mp4'))
      const preciseDuration = durationOf(await readMedia(preciseOut))
      expect(preciseDuration).toBeGreaterThan(0.65)
      expect(preciseDuration).toBeLessThan(1.35)

      const fast = await runProcess(page, {
        mode: 'trim',
        files: [input],
        outputDir: outDir,
        options: { startSec: 0, endSec: 2, fastCopy: true }
      })
      expect(fast.failures).toEqual([])
      const fastOut = firstOf(fast.outputs).output
      expect(fastOut).toBe(path.join(outDir, '截取 样例.cut_000000-000002.mp4'))
      expect(fs.existsSync(fastOut)).toBe(true)
    } finally {
      fs.rmSync(inDir, { recursive: true, force: true })
      await app.close()
    }
  })

  test('提取音频 wav + mp3：产物无视频流（spec §8.3）', async () => {
    test.setTimeout(180_000)
    const { app, page } = await launch()
    await ensureReady(page)
    const inDir = path.join(os.tmpdir(), 'lumin-mc-e2e-audio')
    const outDir = path.join(inDir, 'out')
    fs.rmSync(inDir, { recursive: true, force: true })
    fs.mkdirSync(inDir, { recursive: true })
    try {
      const input = path.join(inDir, '提取 样例.mp4')
      await makeSampleVideo(input)

      const wav = await runProcess(page, {
        mode: 'extract-audio',
        files: [input],
        outputDir: outDir,
        options: { format: 'wav', bitrate: 192 }
      })
      expect(wav.failures).toEqual([])
      const wavOut = firstOf(wav.outputs).output
      expect(wavOut).toBe(path.join(outDir, '提取 样例.audio.wav'))
      expect(await readMedia(wavOut)).not.toContain(': Video:')

      const mp3 = await runProcess(page, {
        mode: 'extract-audio',
        files: [input],
        outputDir: outDir,
        options: { format: 'mp3', bitrate: 320 }
      })
      expect(mp3.failures).toEqual([])
      const mp3Out = firstOf(mp3.outputs).output
      expect(mp3Out).toBe(path.join(outDir, '提取 样例.audio.mp3'))
      expect(await readMedia(mp3Out)).not.toContain(': Video:')
    } finally {
      fs.rmSync(inDir, { recursive: true, force: true })
      await app.close()
    }
  })

  test('压缩 1080p → 720p 上限：输出 1280x720（只缩不放，spec §8.4）', async () => {
    test.setTimeout(240_000)
    const { app, page } = await launch()
    await ensureReady(page)
    const inDir = path.join(os.tmpdir(), 'lumin-mc-e2e-compress')
    const outDir = path.join(inDir, 'out')
    fs.rmSync(inDir, { recursive: true, force: true })
    fs.mkdirSync(inDir, { recursive: true })
    try {
      const input = path.join(inDir, '压缩 样例.mp4')
      await makeMedia([
        '-f',
        'lavfi',
        '-i',
        'testsrc=size=1920x1080:rate=25:duration=3',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:duration=3',
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-shortest',
        input
      ])
      const result = await runProcess(page, {
        mode: 'compress',
        files: [input],
        outputDir: outDir,
        options: { level: 'low', maxHeight: 720 }
      })
      expect(result.failures).toEqual([])
      const output = firstOf(result.outputs).output
      expect(output).toBe(path.join(outDir, '压缩 样例.clow.mp4'))
      const stderr = await readMedia(output)
      expect(stderr).toContain('1280x720')
    } finally {
      fs.rmSync(inDir, { recursive: true, force: true })
      await app.close()
    }
  })

  test('批量部分失败：正常项产出 + 损坏项 failures（spec §8 批量语义）', async () => {
    test.setTimeout(180_000)
    const { app, page } = await launch()
    await ensureReady(page)
    const inDir = path.join(os.tmpdir(), 'lumin-mc-e2e-mixed')
    const outDir = path.join(inDir, 'out')
    fs.rmSync(inDir, { recursive: true, force: true })
    fs.mkdirSync(inDir, { recursive: true })
    try {
      const good = path.join(inDir, '好片.mp4')
      const corrupt = path.join(inDir, '损坏 片.mp4')
      await makeSampleVideo(good)
      fs.writeFileSync(corrupt, Buffer.from('garbage media'))
      const result = await runProcess(page, {
        mode: 'transcode',
        files: [good, corrupt],
        outputDir: outDir,
        options: { format: 'mkv', quality: 'low' }
      })
      expect(result.outputs).toHaveLength(1)
      expect(fs.existsSync(firstOf(result.outputs).output)).toBe(true)
      expect(result.failures).toHaveLength(1)
      expect(firstOf(result.failures)).toMatchObject({ input: corrupt, code: 'MC_FILE_CORRUPT' })
    } finally {
      fs.rmSync(inDir, { recursive: true, force: true })
      await app.close()
    }
  })

  test('任务取消：首个进度后 cancel → error CANCELLED（spec §8.6）', async () => {
    test.setTimeout(240_000)
    const { app, page } = await launch()
    await ensureReady(page)
    const inDir = path.join(os.tmpdir(), 'lumin-mc-e2e-cancel')
    const outDir = path.join(inDir, 'out')
    fs.rmSync(inDir, { recursive: true, force: true })
    fs.mkdirSync(inDir, { recursive: true })
    try {
      const input = path.join(inDir, '取消 样例.mp4')
      await makeMedia([
        '-f',
        'lavfi',
        '-i',
        'testsrc=size=1280x720:rate=25:duration=10',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:duration=10',
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-shortest',
        input
      ])
      const code = await page.evaluate(
        (args: unknown) =>
          new Promise<string>((resolve, reject) => {
            let taskId = ''
            let cancelRequested = false
            const off = window.lumin.onTaskEvent((ev) => {
              if (taskId !== '' && ev.taskId !== taskId) return
              if (ev.kind === 'progress') {
                if (!cancelRequested) {
                  cancelRequested = true
                  void window.lumin.invoke<boolean>('lumin:task:cancel', { taskId })
                }
                return
              }
              if (ev.kind === 'log') return
              off()
              if (ev.kind === 'done') {
                reject(new Error('任务在取消前完成'))
                return
              }
              resolve(ev.error.code)
            })
            window.lumin
              .invoke<{ taskId: string }>('media-convert:process', args)
              .then((r) => {
                taskId = r.taskId
              })
              .catch((err: unknown) => {
                off()
                reject(err)
              })
          }),
        {
          mode: 'transcode',
          files: [input],
          outputDir: outDir,
          options: { format: 'webm', quality: 'high' }
        }
      )
      expect(code).toBe('CANCELLED')
    } finally {
      fs.rmSync(inDir, { recursive: true, force: true })
      await app.close()
    }
  })
})
