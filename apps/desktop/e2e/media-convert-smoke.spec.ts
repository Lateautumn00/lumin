/**
 * @file media-convert（音视频处理）e2e 冒烟：真实 Electron + 真实 ffmpeg 二进制
 * @author cuilanchao
 * @date 2026-11-19
 * @description 覆盖 spec §8：probe（中文+空格路径/音频-only/损坏）、转码 webm、截取（精确/快速）、
 *              提取音频（无视频流断言）、音频互转（wav → mp3/flac）、压缩 720p（只缩不放）、
 *              批量部分失败、任务取消。
 *              注意：临时目录名必须 ASCII（本机 Node fs 非 ASCII 目录名会硬崩/静默不删），
 *              文件名保留中文验证路径。前置：node scripts/fetch-binaries.mjs（ffmpeg.exe）
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
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

/** 生成指定尺寸的测试视频（H.264 + AAC） */
function makeSizedVideo(file: string, size: string, seconds = 3): Promise<void> {
  return makeMedia([
    '-f',
    'lavfi',
    '-i',
    `testsrc=size=${size}:rate=25:duration=${String(seconds)}`,
    '-f',
    'lavfi',
    '-i',
    `sine=frequency=440:duration=${String(seconds)}`,
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-shortest',
    file
  ])
}

/** 格式转换完整参数（默认 mp4 重编码；e2e 只覆盖必要项） */
function transcodeOptions(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    format: 'mp4',
    mode: 'encode',
    quality: 'medium',
    codec: 'h264',
    resolution: { kind: 'original' },
    fps: 0,
    videoBitrateKbps: 0,
    audioBitrateKbps: 192,
    removeAudio: false,
    ...overrides
  }
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
      await clickSidebarTool(page, '音视频处理')
      await expect(page.getByRole('heading', { name: '音视频处理' })).toBeVisible()
      // 五 Tab 标签可见（naive-ui 自闭合 pane 渲染回归）
      for (const [name, label] of [
        ['transcode', '格式转换'],
        ['trim', '截取'],
        ['extract-audio', '提取音频'],
        ['audio-convert', '音频互转'],
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
        (files: string[]) => window.lumin.invoke<ProbeOutcome>('media-convert:probe', { files }),
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
        options: transcodeOptions({ format: 'webm', quality: 'low' })
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

  test('音频互转 wav → mp3 / flac：产物存在且无视频流（spec §8.3）', async () => {
    test.setTimeout(180_000)
    const { app, page } = await launch()
    await ensureReady(page)
    const inDir = path.join(os.tmpdir(), 'lumin-mc-e2e-audioconv')
    const outDir = path.join(inDir, 'out')
    fs.rmSync(inDir, { recursive: true, force: true })
    fs.mkdirSync(inDir, { recursive: true })
    try {
      const input = path.join(inDir, '转换 样例.wav')
      await makeMedia(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', input])

      const mp3 = await runProcess(page, {
        mode: 'audio-convert',
        files: [input],
        outputDir: outDir,
        options: { format: 'mp3', bitrate: 192, sampleRate: 0, channels: 0 }
      })
      expect(mp3.failures).toEqual([])
      const mp3Out = firstOf(mp3.outputs).output
      expect(mp3Out).toBe(path.join(outDir, '转换 样例.mp3'))
      const stderr = await readMedia(mp3Out)
      expect(stderr).toContain(': Audio:')
      expect(stderr).not.toContain(': Video:')

      const flac = await runProcess(page, {
        mode: 'audio-convert',
        files: [input],
        outputDir: outDir,
        options: { format: 'flac', bitrate: 320, sampleRate: 0, channels: 0 }
      })
      expect(flac.failures).toEqual([])
      const flacOut = firstOf(flac.outputs).output
      expect(flacOut).toBe(path.join(outDir, '转换 样例.flac'))
      expect(fs.existsSync(flacOut)).toBe(true)
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
        options: transcodeOptions({ format: 'mkv', quality: 'low' })
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
          options: transcodeOptions({ format: 'webm', quality: 'high' })
        }
      )
      expect(code).toBe('CANCELLED')
    } finally {
      fs.rmSync(inDir, { recursive: true, force: true })
      await app.close()
    }
  })

  test('格式矩阵：8 容器各出一条可复读产物（spec §5.1）', async () => {
    test.setTimeout(420_000)
    const { app, page } = await launch()
    await ensureReady(page)
    const inDir = path.join(os.tmpdir(), 'lumin-mc-e2e-matrix')
    const outDir = path.join(inDir, 'out')
    fs.rmSync(inDir, { recursive: true, force: true })
    fs.mkdirSync(inDir, { recursive: true })
    try {
      const input = path.join(inDir, '矩阵 样例.mp4')
      await makeSampleVideo(input)
      const containers = ['mp4', 'mkv', 'webm', 'mov', 'avi', 'flv', 'ts', 'm4v'] as const
      for (const format of containers) {
        const result = await runProcess(page, {
          mode: 'transcode',
          files: [input],
          outputDir: outDir,
          options: transcodeOptions({ format, quality: 'low' })
        })
        expect(result.failures).toEqual([])
        const output = firstOf(result.outputs).output
        expect(output).toBe(path.join(outDir, `矩阵 样例.${format}`))
        expect(fs.existsSync(output)).toBe(true)
        const duration = durationOf(await readMedia(output))
        expect(duration).toBeGreaterThan(2.4)
        expect(duration).toBeLessThan(3.8)
      }
    } finally {
      fs.rmSync(inDir, { recursive: true, force: true })
      await app.close()
    }
  })

  test('remux：mp4 → mkv/mov/ts/mp4 直通；不兼容 avi → MC_CONTAINER_INCOMPATIBLE（spec §5.2）', async () => {
    test.setTimeout(240_000)
    const { app, page } = await launch()
    await ensureReady(page)
    const inDir = path.join(os.tmpdir(), 'lumin-mc-e2e-remux')
    const outDir = path.join(inDir, 'out')
    fs.rmSync(inDir, { recursive: true, force: true })
    fs.mkdirSync(inDir, { recursive: true })
    try {
      const input = path.join(inDir, '换封装 样例.mp4')
      await makeSampleVideo(input)
      for (const format of ['mkv', 'mov', 'ts', 'mp4'] as const) {
        const result = await runProcess(page, {
          mode: 'transcode',
          files: [input],
          outputDir: outDir,
          options: transcodeOptions({ format, mode: 'remux' })
        })
        expect(result.failures).toEqual([])
        const output = firstOf(result.outputs).output
        expect(output).toBe(path.join(outDir, `换封装 样例.remux.${format}`))
        // 流复制：源 h264 视频流保持原编码
        expect(await readMedia(output)).toContain('Video: h264')
      }
      // AVI 不支持 AAC 音频轨 → 单文件不兼容失败
      const incompatible = await runProcess(page, {
        mode: 'transcode',
        files: [input],
        outputDir: outDir,
        options: transcodeOptions({ format: 'avi', mode: 'remux' })
      })
      expect(incompatible.outputs).toHaveLength(0)
      expect(firstOf(incompatible.failures).code).toBe('MC_CONTAINER_INCOMPATIBLE')
    } finally {
      fs.rmSync(inDir, { recursive: true, force: true })
      await app.close()
    }
  })

  test('H.265 / 自定义分辨率 / 帧率 / 码率 / 去音轨（spec §5.2）', async () => {
    test.setTimeout(420_000)
    const { app, page } = await launch()
    await ensureReady(page)
    const inDir = path.join(os.tmpdir(), 'lumin-mc-e2e-advanced')
    const outDir = path.join(inDir, 'out')
    fs.rmSync(inDir, { recursive: true, force: true })
    fs.mkdirSync(inDir, { recursive: true })
    try {
      const hd = path.join(inDir, '高清 样例.mp4')
      await makeSizedVideo(hd, '1280x720')

      const h265 = await runProcess(page, {
        mode: 'transcode',
        files: [hd],
        outputDir: outDir,
        options: transcodeOptions({ format: 'mp4', codec: 'h265', quality: 'low' })
      })
      expect(h265.failures).toEqual([])
      expect(await readMedia(firstOf(h265.outputs).output)).toContain('Video: hevc')

      const custom = await runProcess(page, {
        mode: 'transcode',
        files: [hd],
        outputDir: outDir,
        options: transcodeOptions({
          quality: 'low',
          resolution: { kind: 'custom', width: 640, height: 360 },
          fps: 30
        })
      })
      expect(custom.failures).toEqual([])
      const customStderr = await readMedia(firstOf(custom.outputs).output)
      expect(customStderr).toContain('640x360')
      expect(customStderr).toContain('30 fps')

      // 小分辨率选 720p 上限不得放大
      const small = path.join(inDir, '小图 样例.mp4')
      await makeSizedVideo(small, '320x180')
      const noUpscale = await runProcess(page, {
        mode: 'transcode',
        files: [small],
        outputDir: outDir,
        options: transcodeOptions({
          quality: 'low',
          resolution: { kind: 'maxHeight', height: 720 }
        })
      })
      expect(noUpscale.failures).toEqual([])
      expect(await readMedia(firstOf(noUpscale.outputs).output)).toContain('320x180')

      // 码率 2000k 产物应显著大于纯 CRF 产物
      const crf = await runProcess(page, {
        mode: 'transcode',
        files: [hd],
        outputDir: outDir,
        options: transcodeOptions({ quality: 'low' })
      })
      const bitrate = await runProcess(page, {
        mode: 'transcode',
        files: [hd],
        outputDir: outDir,
        options: transcodeOptions({ quality: 'low', videoBitrateKbps: 2000 })
      })
      expect(crf.failures).toEqual([])
      expect(bitrate.failures).toEqual([])
      const crfSize = fs.statSync(firstOf(crf.outputs).output).size
      const bitrateSize = fs.statSync(firstOf(bitrate.outputs).output).size
      expect(bitrateSize).toBeGreaterThan(crfSize)

      // 去音轨
      const muted = await runProcess(page, {
        mode: 'transcode',
        files: [hd],
        outputDir: outDir,
        options: transcodeOptions({ quality: 'low', removeAudio: true })
      })
      expect(muted.failures).toEqual([])
      expect(await readMedia(firstOf(muted.outputs).output)).not.toContain(': Audio:')
    } finally {
      fs.rmSync(inDir, { recursive: true, force: true })
      await app.close()
    }
  })

  test('音频扩展：aac / opus + 采样率 / 声道（spec §5.3）', async () => {
    test.setTimeout(180_000)
    const { app, page } = await launch()
    await ensureReady(page)
    const inDir = path.join(os.tmpdir(), 'lumin-mc-e2e-audioext')
    const outDir = path.join(inDir, 'out')
    fs.rmSync(inDir, { recursive: true, force: true })
    fs.mkdirSync(inDir, { recursive: true })
    try {
      const input = path.join(inDir, '音频 扩展.wav')
      await makeMedia(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', input])

      const aac = await runProcess(page, {
        mode: 'audio-convert',
        files: [input],
        outputDir: outDir,
        options: { format: 'aac', bitrate: 192, sampleRate: 44100, channels: 1 }
      })
      expect(aac.failures).toEqual([])
      const aacStderr = await readMedia(firstOf(aac.outputs).output)
      expect(aacStderr).toContain(': Audio: aac')
      expect(aacStderr).toContain('44100 Hz')
      expect(aacStderr).toContain('mono')
      expect(aacStderr).not.toContain(': Video:')

      const opus = await runProcess(page, {
        mode: 'audio-convert',
        files: [input],
        outputDir: outDir,
        options: { format: 'opus', bitrate: 128, sampleRate: 48000, channels: 2 }
      })
      expect(opus.failures).toEqual([])
      const opusStderr = await readMedia(firstOf(opus.outputs).output)
      expect(opusStderr).toContain(': Audio: opus')
      expect(opusStderr).toContain('48000 Hz')
      expect(opusStderr).toContain('stereo')
    } finally {
      fs.rmSync(inDir, { recursive: true, force: true })
      await app.close()
    }
  })
})
