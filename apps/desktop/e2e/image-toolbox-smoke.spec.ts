/**
 * @file image-toolbox（图片工具箱）e2e 冒烟：真实 Electron + 真实 ffmpeg 二进制
 * @author cuilanchao
 * @date 2026-11-18
 * @description 覆盖：probe 元信息/损坏文件、R2.1 中文+空格路径压缩、R2.2 占用 + R2.3 损坏
 *              混合批次（单张失败不中断）、gif→webp 动画（ANIM 块断言）。
 *              注意：临时目录名必须 ASCII（本机 Node fs 对非 ASCII 目录名会 0xC0000409
 *              硬崩或静默不删，见 docx2pdf-smoke 先例），文件名保留中文验证路径。
 *              前置：node scripts/fetch-binaries.mjs（binaries/download/ffmpeg.exe）
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
  items: { file: string; format: string; width: number; height: number; animated: boolean }[]
  failures: { file: string; code: string }[]
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

/**
 * 等待壳渲染层就绪：firstWindow 可能在初始加载完成前返回，直接 evaluate 会随
 * 路由 hash 跳转丢失执行上下文（实测表现为 evaluate 永不返回直至超时）
 */
async function ensureReady(
  page: Awaited<ReturnType<ElectronApplication['firstWindow']>>
): Promise<void> {
  await page.waitForLoadState('domcontentloaded')
  await page.waitForFunction(() => typeof window.lumin !== 'undefined')
}

/** 用仓库 ffmpeg 生成测试图片（lavfi 合成，免入库 fixture） */
function makeImage(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, ['-y', '-v', 'error', ...args], { windowsHide: true })
    let stderr = ''
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(stderr))))
  })
}

/** PNG IHDR 宽高（偏移 16/20 大端；旋转/裁剪断言尺寸用） */
function pngSize(file: string): { width: number; height: number } {
  const buf = fs.readFileSync(file)
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

/** 读取图片指定像素 RGB（ffmpeg rawvideo，免额外解码依赖） */
function readRgb(file: string, x = 0, y = 0): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      ffmpeg,
      [
        '-v',
        'error',
        '-i',
        file,
        '-vf',
        `crop=1:1:${x}:${y}`,
        '-frames:v',
        '1',
        '-f',
        'rawvideo',
        '-pix_fmt',
        'rgb24',
        '-'
      ],
      { windowsHide: true }
    )
    const chunks: Buffer[] = []
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.on('close', (code) => {
      const bytes = Buffer.concat(chunks)
      if (code === 0 && bytes.length >= 3) resolve(Array.from(bytes.subarray(0, 3)))
      else reject(new Error(stderr))
    })
  })
}

/** 提交任务并等待 done/error（e2e 直接走 IPC，覆盖主进程三段式） */
async function runTask(
  page: Awaited<ReturnType<ElectronApplication['firstWindow']>>,
  channel: string,
  payload: unknown
): Promise<unknown> {
  return page.evaluate(
    ({ channel, payload }) =>
      new Promise<unknown>((resolve, reject) => {
        let taskId = ''
        const off = window.lumin.onTaskEvent((event) => {
          if (event.taskId !== taskId) return
          if (event.kind === 'done') {
            off()
            resolve(event.result)
          } else if (event.kind === 'error') {
            off()
            reject(new Error(`${event.error.code}: ${event.error.message}`))
          }
        })
        window.lumin
          .invoke<{ taskId: string }>(channel, payload)
          .then((result) => {
            taskId = result.taskId
          })
          .catch((err: unknown) => {
            off()
            reject(err instanceof Error ? err : new Error(String(err)))
          })
      }),
    { channel, payload }
  )
}

test.describe('image-toolbox（图片工具箱）冒烟', () => {
  test.beforeAll(async () => {
    test.skip(!fs.existsSync(ffmpeg), '缺少 ffmpeg（先跑 node scripts/fetch-binaries.mjs）')
  })

  test('页面加载 + probe 元信息（R2.1 中文+空格路径）+ 损坏文件失败项', async () => {
    const { app, page } = await launch()
    await ensureReady(page)
    const workDir = path.join(os.tmpdir(), 'lumin-it-e2e-probe')
    fs.rmSync(workDir, { recursive: true, force: true })
    fs.mkdirSync(workDir, { recursive: true })
    try {
      await clickSidebarTool(page, '图片工具箱')
      await expect(page.getByRole('heading', { name: '图片工具箱' })).toBeVisible()

      await makeImage([
        '-f',
        'lavfi',
        '-i',
        'color=c=red:s=320x240',
        '-frames:v',
        '1',
        path.join(workDir, '红色 样例.png')
      ])
      await makeImage([
        '-f',
        'lavfi',
        '-i',
        'color=c=blue:s=640x480:rate=2:duration=1',
        path.join(workDir, '动画 样例.gif')
      ])
      const corrupt = path.join(workDir, '损坏.jpg')
      fs.writeFileSync(corrupt, Buffer.from('not an image at all'))

      const outcome = await page.evaluate(
        (files: string[]) => window.lumin.invoke<ProbeOutcome>('image-toolbox:probe', { files }),
        [path.join(workDir, '红色 样例.png'), path.join(workDir, '动画 样例.gif'), corrupt]
      )
      expect(outcome.items).toHaveLength(2)
      expect(outcome.items[0]).toMatchObject({
        format: 'png',
        width: 320,
        height: 240,
        animated: false
      })
      expect(outcome.items[1]).toMatchObject({ format: 'gif', animated: true })
      expect(outcome.failures).toHaveLength(1)
      expect(outcome.failures[0]).toMatchObject({ file: corrupt, code: 'IT_FILE_CORRUPT' })
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true })
      await app.close()
    }
  })

  test('压缩任务（R2.1 中文+空格路径）：progress → done → 产物存在且体积减小口径正确', async () => {
    const { app, page } = await launch()
    await ensureReady(page)
    const inDir = path.join(os.tmpdir(), 'lumin-it-e2e-comp-in')
    const outDir = path.join(os.tmpdir(), 'lumin-it-e2e-comp-out')
    fs.rmSync(inDir, { recursive: true, force: true })
    fs.rmSync(outDir, { recursive: true, force: true })
    fs.mkdirSync(inDir, { recursive: true })
    try {
      const input = path.join(inDir, '压缩 样例.jpg')
      await makeImage([
        '-f',
        'lavfi',
        '-i',
        'testsrc=size=1280x720:rate=1:duration=1',
        '-update',
        '1',
        input
      ])
      const beforeBytes = fs.statSync(input).size
      expect(beforeBytes).toBeGreaterThan(0)

      const outcome = await page.evaluate(
        (args: { input: string; outputDir: string; beforeBytes: number }) =>
          new Promise<{ hasProgress: boolean; result: unknown }>((resolve, reject) => {
            let hasProgress = false
            let currentTaskId = ''
            const off = window.lumin.onTaskEvent((ev) => {
              if (ev.taskId !== currentTaskId) return
              if (ev.kind === 'progress') {
                hasProgress = true
              } else if (ev.kind === 'done') {
                off()
                resolve({ hasProgress, result: ev.result })
              } else if (ev.kind === 'error') {
                off()
                reject(new Error(`${ev.error.code}: ${ev.error.message}`))
              }
            })
            window.lumin
              .invoke<{ taskId: string }>('image-toolbox:process', {
                mode: 'compress',
                files: [args.input],
                outputDir: args.outputDir,
                options: { quality: 75, target: 'original' }
              })
              .then(({ taskId }) => {
                currentTaskId = taskId
              })
              .catch((err: unknown) => {
                off()
                reject(err)
              })
          }),
        { input, outputDir: outDir, beforeBytes }
      )

      expect(outcome.hasProgress).toBe(true)
      const result = outcome.result as {
        outputs: { output: string; beforeBytes: number; afterBytes: number }[]
      }
      expect(result.outputs).toHaveLength(1)
      const item = firstOf(result.outputs)
      expect(item.output).toBe(path.join(outDir, '压缩 样例.q75.jpg'))
      expect(item.beforeBytes).toBe(beforeBytes)
      expect(fs.existsSync(item.output)).toBe(true)
      expect(item.afterBytes).toBe(fs.statSync(item.output).size)
    } finally {
      fs.rmSync(inDir, { recursive: true, force: true })
      fs.rmSync(outDir, { recursive: true, force: true })
      await app.close()
    }
  })

  test('R2.2 占用 + R2.3 损坏混合批次：单张失败不中断，好文件照常产出', async () => {
    test.setTimeout(120_000)
    const { app, page } = await launch()
    await ensureReady(page)
    const inDir = path.join(os.tmpdir(), 'lumin-it-e2e-mixed')
    const outDir = path.join(inDir, 'out')
    fs.rmSync(inDir, { recursive: true, force: true })
    fs.mkdirSync(inDir, { recursive: true })
    let holder: ReturnType<typeof spawn> | null = null
    try {
      const good = path.join(inDir, '好图.png')
      const locked = path.join(inDir, '占用 图.png')
      const corrupt = path.join(inDir, '损坏 图.jpg')
      await makeImage(['-f', 'lavfi', '-i', 'color=c=green:s=400x300', '-frames:v', '1', good])
      await makeImage(['-f', 'lavfi', '-i', 'color=c=yellow:s=400x300', '-frames:v', '1', locked])
      fs.writeFileSync(corrupt, Buffer.from('garbage image'))
      fs.copyFileSync(locked, path.join(inDir, 'keep-original.png'))

      const scriptPath = path.join(inDir, 'hold.ps1')
      fs.writeFileSync(
        scriptPath,
        "$fs = [System.IO.File]::Open($args[0], 'Open', 'ReadWrite', 'None')\n" +
          'Start-Sleep -Seconds 60\n' +
          '$fs.Close()\n'
      )
      holder = spawn('powershell.exe', ['-NoProfile', '-File', scriptPath, locked], {
        windowsHide: true
      })
      await new Promise((resolve) => setTimeout(resolve, 1500))

      const result = await page.evaluate(
        (args: { files: string[]; outputDir: string }) =>
          new Promise<{
            outputs: { output: string }[]
            failures: { input: string; code: string }[]
          }>((resolve, reject) => {
            let currentTaskId = ''
            const off = window.lumin.onTaskEvent((ev) => {
              if (ev.taskId !== currentTaskId) return
              if (ev.kind === 'done') {
                off()
                resolve(
                  ev.result as {
                    outputs: { output: string }[]
                    failures: { input: string; code: string }[]
                  }
                )
              } else if (ev.kind === 'error') {
                off()
                reject(new Error(`${ev.error.code}: ${ev.error.message}`))
              }
            })
            window.lumin
              .invoke<{ taskId: string }>('image-toolbox:process', {
                mode: 'compress',
                files: args.files,
                outputDir: args.outputDir,
                options: { quality: 75, target: 'original' }
              })
              .then(({ taskId }) => {
                currentTaskId = taskId
              })
              .catch((err: unknown) => {
                off()
                reject(err)
              })
          }),
        { files: [good, locked, corrupt], outputDir: outDir }
      )

      expect(result.outputs).toHaveLength(1)
      const output = firstOf(result.outputs).output
      expect(output).toBe(path.join(outDir, '好图.q75.png'))
      expect(fs.existsSync(output)).toBe(true)
      expect(result.failures).toHaveLength(2)
      const codes = result.failures.map((f) => f.code).sort()
      expect(codes).toEqual(['IT_FILE_CORRUPT', 'IT_FILE_CORRUPT'])
    } finally {
      holder?.kill()
      await new Promise((resolve) => setTimeout(resolve, 500))
      fs.rmSync(inDir, { recursive: true, force: true })
      await app.close()
    }
  })

  test('gif → webp 动画路径：ANIM/ANMF 块断言（拍板：动画保留）', async () => {
    const { app, page } = await launch()
    await ensureReady(page)
    const inDir = path.join(os.tmpdir(), 'lumin-it-e2e-anim')
    const outDir = path.join(inDir, 'out')
    fs.rmSync(inDir, { recursive: true, force: true })
    fs.mkdirSync(inDir, { recursive: true })
    try {
      const input = path.join(inDir, '动图.gif')
      await makeImage(['-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=2:duration=1.5', input])

      const result = await page.evaluate(
        (args: { input: string; outputDir: string }) =>
          new Promise<{ output: string; events: unknown[] }>((resolve, reject) => {
            const events: unknown[] = []
            let currentTaskId = ''
            const off = window.lumin.onTaskEvent((ev) => {
              events.push({ kind: ev.kind, cur: currentTaskId === '' ? '(unset)' : 'set' })
              if (ev.taskId !== currentTaskId) return
              if (ev.kind === 'done') {
                off()
                const r = ev.result as { outputs: { output: string }[] }
                const item = r.outputs[0]
                if (item === undefined) throw new Error('outputs 为空')
                resolve({ output: item.output, events })
              } else if (ev.kind === 'error') {
                off()
                reject(new Error(`${ev.error.code}: ${ev.error.message}`))
              }
            })
            window.lumin
              .invoke<{ taskId: string }>('image-toolbox:process', {
                mode: 'compress',
                files: [args.input],
                outputDir: args.outputDir,
                options: { quality: 75, target: 'original' }
              })
              .then(({ taskId }) => {
                currentTaskId = taskId
              })
              .catch((err: unknown) => {
                off()
                reject(err)
              })
            void events
          }),
        { input, outputDir: outDir }
      )
      expect(result.output).toBe(path.join(outDir, '动图.q75.webp'))
      const head = fs.readFileSync(result.output).subarray(0, 64).toString('latin1')
      expect(head).toContain('ANIM')
      expect(head).toContain('ANMF')
    } finally {
      fs.rmSync(inDir, { recursive: true, force: true })
      await app.close()
    }
  })

  test('M40 调整：灰度三通道近似 / 反色取反 / 黑白仅 0 或 255', async () => {
    const { app, page } = await launch()
    await ensureReady(page)
    const inDir = path.join(os.tmpdir(), 'lumin-it-e2e-effect')
    const outDir = path.join(inDir, 'out')
    fs.rmSync(inDir, { recursive: true, force: true })
    fs.mkdirSync(inDir, { recursive: true })
    try {
      const input = path.join(inDir, '红 色.png')
      await makeImage(['-f', 'lavfi', '-i', 'color=c=red:s=32x32', '-frames:v', '1', input])

      const effect = async (
        kind: 'grayscale' | 'invert' | 'binary',
        threshold: number
      ): Promise<string> => {
        const result = (await runTask(page, 'image-toolbox:process', {
          mode: 'effect',
          files: [input],
          outputDir: outDir,
          options: { effect: kind, threshold, quality: 75 }
        })) as { outputs: { output: string }[] }
        return firstOf(result.outputs).output
      }

      const gray = await effect('grayscale', 128)
      expect(gray).toBe(path.join(outDir, '红 色.gray.png'))
      const grayRgb = await readRgb(gray)
      expect(Math.max(...grayRgb) - Math.min(...grayRgb)).toBeLessThanOrEqual(2)

      const inverted = await effect('invert', 128)
      expect(inverted).toBe(path.join(outDir, '红 色.invert.png'))
      const invertRgb = await readRgb(inverted)
      expect(invertRgb[0]).toBeLessThan(8)
      expect(invertRgb[1]).toBeGreaterThan(247)
      expect(invertRgb[2]).toBeGreaterThan(247)

      // 红色 BT.601 亮度约 76：阈值 100 → 全黑；阈值 50 → 全白
      const dark = await effect('binary', 100)
      expect(dark).toBe(path.join(outDir, '红 色.bw100.png'))
      expect(await readRgb(dark)).toEqual([0, 0, 0])
      const light = await effect('binary', 50)
      expect(light).toBe(path.join(outDir, '红 色.bw50.png'))
      expect(await readRgb(light)).toEqual([255, 255, 255])
    } finally {
      fs.rmSync(inDir, { recursive: true, force: true })
      await app.close()
    }
  })

  test('M40 GIF：3 帧 → GIF89a + NETSCAPE2.0 + 尺寸/帧数', async () => {
    const { app, page } = await launch()
    await ensureReady(page)
    const inDir = path.join(os.tmpdir(), 'lumin-it-e2e-gif')
    const outDir = path.join(inDir, 'out')
    fs.rmSync(inDir, { recursive: true, force: true })
    fs.mkdirSync(inDir, { recursive: true })
    try {
      const frames = ['red', 'green', 'blue'].map((color, index) => ({
        color,
        file: path.join(inDir, `帧 ${index + 1}.png`)
      }))
      for (const frame of frames) {
        await makeImage([
          '-f',
          'lavfi',
          '-i',
          `color=c=${frame.color}:s=64x64`,
          '-frames:v',
          '1',
          frame.file
        ])
      }
      const result = (await runTask(page, 'image-toolbox:make-gif', {
        files: frames.map((frame) => frame.file),
        outputDir: outDir,
        options: { durationMs: 500, loop: 0, width: 0 }
      })) as {
        outputPath: string
        width: number
        height: number
        frames: number
        sizeBytes: number
      }
      expect(result.width).toBe(64)
      expect(result.height).toBe(64)
      expect(result.frames).toBe(3)
      expect(result.sizeBytes).toBe(fs.statSync(result.outputPath).size)
      const bytes = fs.readFileSync(result.outputPath)
      expect(bytes.subarray(0, 6).toString('latin1')).toBe('GIF89a')
      // Netscape 循环扩展位于全局色板之后（实测偏移 ~784），须全文检索
      expect(bytes.includes(Buffer.from('NETSCAPE2.0'))).toBe(true)
    } finally {
      fs.rmSync(inDir, { recursive: true, force: true })
      await app.close()
    }
  })

  test('M63 文件夹递归收集 + 处理历史（最近 20 条）', async () => {
    const { app, page } = await launch()
    await ensureReady(page)
    const workDir = path.join(os.tmpdir(), 'lumin-it-e2e-m63')
    fs.rmSync(workDir, { recursive: true, force: true })
    fs.mkdirSync(path.join(workDir, '子目录'), { recursive: true })
    try {
      const png = (out: string) => [
        '-f',
        'lavfi',
        '-i',
        'color=c=green:s=64x64',
        '-frames:v',
        '1',
        out
      ]
      await makeImage(png(path.join(workDir, 'a 图.png')))
      await makeImage(png(path.join(workDir, '子目录', 'b 图.png')))
      fs.writeFileSync(path.join(workDir, '说明.txt'), 'x')

      const collected = await page.evaluate(
        (dir: string) =>
          window.lumin.invoke<{ files: string[]; truncated: boolean }>(
            'image-toolbox:collect-folder',
            { dir }
          ),
        workDir
      )
      expect(collected.files).toHaveLength(2)
      expect(collected.files).toContain(path.join(workDir, 'a 图.png'))
      expect(collected.files).toContain(path.join(workDir, '子目录', 'b 图.png'))
      expect(collected.truncated).toBe(false)

      const emptyDir = path.join(workDir, '空目录')
      fs.mkdirSync(emptyDir)
      const message = await page.evaluate(async (dir: string) => {
        try {
          await window.lumin.invoke('image-toolbox:collect-folder', { dir })
          return 'ok'
        } catch (err) {
          // 同步通道错误以结构化对象（非 Error 实例）reject，需读 code/message
          const structured = err as { code?: string; message?: string }
          return `${structured.code ?? ''}|${structured.message ?? ''}`
        }
      }, emptyDir)
      expect(message).toContain('IT_FOLDER_EMPTY')

      // 21 次追加 → 最近 20 条，新 → 旧
      for (let index = 0; index < 21; index += 1) {
        await page.evaluate(
          (success: number) =>
            window.lumin.invoke('image-toolbox:append-history', {
              mode: 'compress',
              success,
              failed: 0,
              outputDir: 'E:\\out',
              firstOutput: null
            }),
          index
        )
      }
      const cfg = await page.evaluate(() =>
        window.lumin.invoke<{ history: { success: number }[] }>('image-toolbox:config', {})
      )
      expect(cfg.history).toHaveLength(20)
      expect(cfg.history[0]?.success).toBe(20)

      // UI：历史面板与「添加文件夹」按钮可见
      await clickSidebarTool(page, '图片工具箱')
      await clickSidebarTool(page, '计算器')
      await clickSidebarTool(page, '图片工具箱')
      await expect(page.getByTestId('history-panel')).toBeVisible()
      await expect(page.getByTestId('add-folder')).toBeVisible()
      await expect(page.getByText('处理历史（最近 20 条）')).toBeVisible()

      await page.getByRole('button', { name: '清空历史' }).click()
      await expect(page.getByTestId('history-panel')).toHaveCount(0)
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true })
      await app.close()
    }
  })
})

test('页签标签可见（naive-ui 自闭合 pane 渲染回归）', async () => {
  const { app, page } = await launch()
  await ensureReady(page)
  try {
    await clickSidebarTool(page, '图片工具箱')
    for (const [name, label] of [
      ['compress', '压缩'],
      ['convert', '转换'],
      ['resize', '缩放'],
      ['rotate', '旋转'],
      ['crop', '裁剪'],
      ['effect', '调整'],
      ['gif', 'GIF'],
      ['watermark', '水印'],
      ['dewatermark', '去水印'],
      ['stitch', '拼接']
    ] as const) {
      const tab = page.locator(`.n-tabs-tab[data-name="${name}"]`)
      await expect(tab).toBeVisible()
      await expect(tab).toHaveText(label)
      expect(await tab.evaluate((el) => el.getBoundingClientRect().width)).toBeGreaterThan(0)
    }
  } finally {
    await app.close()
  }
})

test.describe('image-toolbox 旋转/裁剪（M70 §4.48 合并 image-rotate/image-crop）', () => {
  test.beforeAll(async () => {
    test.skip(!fs.existsSync(ffmpeg), '缺少 ffmpeg（先跑 node scripts/fetch-binaries.mjs）')
  })

  test('R2.1 中文+空格路径旋转 90°：320x240 → 240x320', async () => {
    const { app, page } = await launch()
    await ensureReady(page)
    const inDir = path.join(os.tmpdir(), 'lumin-it-e2e-rot')
    const outDir = path.join(inDir, 'out')
    fs.rmSync(inDir, { recursive: true, force: true })
    fs.mkdirSync(inDir, { recursive: true })
    try {
      const input = path.join(inDir, '旋转 样例.png')
      await makeImage(['-f', 'lavfi', '-i', 'color=c=red:s=320x240', '-frames:v', '1', input])
      const result = (await runTask(page, 'image-toolbox:process', {
        mode: 'rotate',
        files: [input],
        outputDir: outDir,
        options: { rotation: '90', flip: 'none' }
      })) as { outputs: { output: string }[]; failures: unknown[] }
      expect(result.failures).toHaveLength(0)
      const output = firstOf(result.outputs).output
      expect(output).toBe(path.join(outDir, '旋转 样例_旋转90.png'))
      expect(pngSize(output)).toEqual({ width: 240, height: 320 })
    } finally {
      fs.rmSync(inDir, { recursive: true, force: true })
      await app.close()
    }
  })

  test('水平翻转保持尺寸 + 重复执行冲突命名 (1)', async () => {
    const { app, page } = await launch()
    await ensureReady(page)
    const inDir = path.join(os.tmpdir(), 'lumin-it-e2e-rot-flip')
    const outDir = path.join(inDir, 'out')
    fs.rmSync(inDir, { recursive: true, force: true })
    fs.mkdirSync(inDir, { recursive: true })
    try {
      const input = path.join(inDir, '横向 样例.png')
      await makeImage(['-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=1:duration=1', input])
      const payload = {
        mode: 'rotate',
        files: [input],
        outputDir: outDir,
        options: { rotation: 'none', flip: 'horizontal' }
      }
      const first = (await runTask(page, 'image-toolbox:process', payload)) as {
        outputs: { output: string }[]
      }
      const firstOutput = firstOf(first.outputs).output
      expect(firstOutput).toBe(path.join(outDir, '横向 样例_水平翻转.png'))
      expect(pngSize(firstOutput)).toEqual({ width: 320, height: 240 })

      const second = (await runTask(page, 'image-toolbox:process', payload)) as {
        outputs: { output: string }[]
      }
      expect(firstOf(second.outputs).output).toBe(path.join(outDir, '横向 样例_水平翻转 (1).png'))
    } finally {
      fs.rmSync(inDir, { recursive: true, force: true })
      await app.close()
    }
  })

  test('比例裁剪 1:1 居中 → 300x300；16:9 左下 → 400x225', async () => {
    const { app, page } = await launch()
    await ensureReady(page)
    const inDir = path.join(os.tmpdir(), 'lumin-it-e2e-crop-ratio')
    const outDir = path.join(inDir, 'out')
    fs.rmSync(inDir, { recursive: true, force: true })
    fs.mkdirSync(inDir, { recursive: true })
    try {
      const square = path.join(inDir, '正方形 样例.png')
      await makeImage(['-f', 'lavfi', '-i', 'color=c=red:s=400x300', '-frames:v', '1', square])
      const squareResult = (await runTask(page, 'image-toolbox:process', {
        mode: 'crop',
        files: [square],
        outputDir: outDir,
        options: {
          mode: 'ratio',
          ratioW: 1,
          ratioH: 1,
          anchor: 'center',
          x: 0,
          y: 0,
          width: 100,
          height: 100
        }
      })) as { outputs: { output: string }[] }
      const squareOut = firstOf(squareResult.outputs).output
      expect(squareOut).toBe(path.join(outDir, '正方形 样例_裁剪1x1.png'))
      expect(pngSize(squareOut)).toEqual({ width: 300, height: 300 })

      const wide = path.join(inDir, '宽幅 样例.png')
      await makeImage(['-f', 'lavfi', '-i', 'color=c=blue:s=400x300', '-frames:v', '1', wide])
      const wideResult = (await runTask(page, 'image-toolbox:process', {
        mode: 'crop',
        files: [wide],
        outputDir: outDir,
        options: {
          mode: 'ratio',
          ratioW: 16,
          ratioH: 9,
          anchor: 'bottom-left',
          x: 0,
          y: 0,
          width: 100,
          height: 100
        }
      })) as { outputs: { output: string }[] }
      const wideOut = firstOf(wideResult.outputs).output
      expect(wideOut).toBe(path.join(outDir, '宽幅 样例_裁剪16x9.png'))
      expect(pngSize(wideOut)).toEqual({ width: 400, height: 225 })
    } finally {
      fs.rmSync(inDir, { recursive: true, force: true })
      await app.close()
    }
  })

  test('自由区域 25/25/50/50：400x300 → 200x150', async () => {
    const { app, page } = await launch()
    await ensureReady(page)
    const inDir = path.join(os.tmpdir(), 'lumin-it-e2e-crop-free')
    const outDir = path.join(inDir, 'out')
    fs.rmSync(inDir, { recursive: true, force: true })
    fs.mkdirSync(inDir, { recursive: true })
    try {
      const input = path.join(inDir, '自由 样例.png')
      await makeImage(['-f', 'lavfi', '-i', 'color=c=green:s=400x300', '-frames:v', '1', input])
      const result = (await runTask(page, 'image-toolbox:process', {
        mode: 'crop',
        files: [input],
        outputDir: outDir,
        options: {
          mode: 'free',
          ratioW: 1,
          ratioH: 1,
          anchor: 'center',
          x: 25,
          y: 25,
          width: 50,
          height: 50
        }
      })) as { outputs: { output: string }[] }
      const output = firstOf(result.outputs).output
      expect(output).toBe(path.join(outDir, '自由 样例_裁剪自由.png'))
      expect(pngSize(output)).toEqual({ width: 200, height: 150 })
    } finally {
      fs.rmSync(inDir, { recursive: true, force: true })
      await app.close()
    }
  })

  test('R2.3 损坏 + 不支持扩展名混合批次：好图照常产出，失败码 IT_*', async () => {
    const { app, page } = await launch()
    await ensureReady(page)
    const inDir = path.join(os.tmpdir(), 'lumin-it-e2e-crop-mixed')
    const outDir = path.join(inDir, 'out')
    fs.rmSync(inDir, { recursive: true, force: true })
    fs.mkdirSync(inDir, { recursive: true })
    try {
      const good = path.join(inDir, '好图.png')
      const corrupt = path.join(inDir, '损坏 图.jpg')
      const unsupported = path.join(inDir, '说明.txt')
      await makeImage(['-f', 'lavfi', '-i', 'color=c=yellow:s=400x300', '-frames:v', '1', good])
      fs.writeFileSync(corrupt, Buffer.from('not an image at all'))
      fs.writeFileSync(unsupported, Buffer.from('text'))

      const result = (await runTask(page, 'image-toolbox:process', {
        mode: 'crop',
        files: [good, corrupt, unsupported],
        outputDir: outDir,
        options: {
          mode: 'ratio',
          ratioW: 1,
          ratioH: 1,
          anchor: 'top-left',
          x: 0,
          y: 0,
          width: 100,
          height: 100
        }
      })) as { outputs: { output: string }[]; failures: { code: string }[] }
      expect(result.outputs).toHaveLength(1)
      const output = firstOf(result.outputs).output
      expect(output).toBe(path.join(outDir, '好图_裁剪1x1.png'))
      expect(pngSize(output)).toEqual({ width: 300, height: 300 })
      expect(result.failures.map((f) => f.code).sort()).toEqual([
        'IT_FILE_CORRUPT',
        'IT_FILE_UNSUPPORTED'
      ])
    } finally {
      fs.rmSync(inDir, { recursive: true, force: true })
      await app.close()
    }
  })
})

test.describe('image-toolbox 水印/去水印/拼接（M72 §4.72 合并 image-watermark/image-dewatermark/image-stitch）', () => {
  test.beforeAll(async () => {
    test.skip(!fs.existsSync(ffmpeg), '缺少 ffmpeg（先跑 node scripts/fetch-binaries.mjs）')
  })

  test('M72.1 水印页签：两张 PNG 批量加水印，产物落盘且原图不变', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumin-e2e-wm-'))
    const out = path.join(dir, 'out')
    const a = path.join(dir, '图 一.png')
    const b = path.join(dir, '图二.png')
    await makeImage(['-f', 'lavfi', '-i', 'color=c=red:s=120x80:d=1', '-frames:v', '1', a])
    await makeImage(['-f', 'lavfi', '-i', 'color=c=blue:s=120x80:d=1', '-frames:v', '1', b])
    const beforeA = fs.readFileSync(a)
    const { app, page } = await launch()
    await ensureReady(page)
    try {
      // 页签挂载即读 config，先记忆输出目录再进工具页
      await page.evaluate(
        (target) =>
          window.lumin.invoke('image-toolbox:watermark-set-output-dir', { outputDir: target }),
        out
      )
      await clickSidebarTool(page, '图片工具箱')
      await page.locator('.n-tabs-tab[data-name="watermark"]').click()
      const tab = page.getByTestId('watermark-tab')
      await tab.locator('input[type="file"]').setInputFiles([a, b])
      await expect(tab.getByText('图 一.png')).toBeVisible()
      await tab.getByPlaceholder('输入水印文字（1–100 字）').fill('Lumin 水印')
      await tab.getByRole('button', { name: '开始加水印' }).click()
      await expect(tab.getByText('成功 2 张 · 失败 0 张')).toBeVisible({ timeout: 30000 })
      expect(fs.readdirSync(out)).toHaveLength(2)
      expect(fs.readFileSync(a).equals(beforeA)).toBe(true)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
      await app.close()
    }
  })

  test('M72.2 去水印页签：框选后快速修复出图，原图不变', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumin-e2e-dw-'))
    const out = path.join(dir, 'out')
    const image = path.join(dir, '待去水印 图.png')
    await makeImage(['-f', 'lavfi', '-i', 'color=c=green:s=240x160:d=1', '-frames:v', '1', image])
    const before = fs.readFileSync(image)
    const { app, page } = await launch()
    await ensureReady(page)
    try {
      await page.evaluate(
        (target) =>
          window.lumin.invoke('image-toolbox:dewatermark-set-output-dir', { outputDir: target }),
        out
      )
      await clickSidebarTool(page, '图片工具箱')
      await page.locator('.n-tabs-tab[data-name="dewatermark"]').click()
      const tab = page.getByTestId('dewatermark-tab')
      await tab.locator('input[type="file"]').setInputFiles(image)
      const stage = tab.getByTestId('dewatermark-stage')
      await expect(stage).toBeVisible()
      const box = await stage.boundingBox()
      if (box === null) throw new Error('画布不可见')
      await page.mouse.move(box.x + 20, box.y + 20)
      await page.mouse.down()
      await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5, { steps: 5 })
      await page.mouse.up()
      await expect(tab.getByText(/已框选 1\//)).toBeVisible()
      await tab.getByTestId('dewatermark-start').click()
      await expect(tab.getByText(/已生成：/)).toBeVisible({ timeout: 30000 })
      expect(fs.readdirSync(out).length).toBeGreaterThan(0)
      expect(fs.readFileSync(image).equals(before)).toBe(true)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
      await app.close()
    }
  })

  test('M72.3 拼接页签：两图拼接出图 + 长图按份数切 3 段', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumin-e2e-st-'))
    const out = path.join(dir, 'out')
    const a = path.join(dir, '左 图.png')
    const b = path.join(dir, '右图.png')
    const tall = path.join(dir, '长 图.png')
    await makeImage(['-f', 'lavfi', '-i', 'color=c=red:s=120x80:d=1', '-frames:v', '1', a])
    await makeImage(['-f', 'lavfi', '-i', 'color=c=blue:s=120x80:d=1', '-frames:v', '1', b])
    await makeImage(['-f', 'lavfi', '-i', 'color=c=yellow:s=300x300:d=1', '-frames:v', '1', tall])
    const { app, page } = await launch()
    await ensureReady(page)
    try {
      await page.evaluate(
        (target) =>
          window.lumin.invoke('image-toolbox:stitch-set-output-dir', { outputDir: target }),
        out
      )
      await clickSidebarTool(page, '图片工具箱')
      await page.locator('.n-tabs-tab[data-name="stitch"]').click()
      const tab = page.getByTestId('stitch-tab')
      // 拼接
      await tab.locator('input[type="file"]').setInputFiles([a, b])
      await expect(tab.getByText('左 图.png')).toBeVisible()
      await tab.getByRole('button', { name: '开始拼接' }).click()
      await expect(tab.getByText(/已生成 \d+ × \d+ · 2 张图/)).toBeVisible({ timeout: 30000 })
      expect(fs.readdirSync(out)).toHaveLength(1)
      // 长图分割
      await tab.locator('.n-tabs-tab[data-name="split"]').click()
      await tab.locator('input[type="file"]').setInputFiles(tall)
      await expect(tab.getByText('长 图.png')).toBeVisible()
      await tab.getByTestId('split-mode').getByText('按份数').click()
      await tab.locator('[data-testid="split-parts"] input').fill('3')
      await tab.getByTestId('split-run').click()
      await expect(tab.getByTestId('split-result')).toContainText('已切分 3 段', {
        timeout: 30000
      })
      expect(fs.readdirSync(out)).toHaveLength(4)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
      await app.close()
    }
  })
})
