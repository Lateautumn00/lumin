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
})

test('页签标签可见（naive-ui 自闭合 pane 渲染回归）', async () => {
  const { app, page } = await launch()
  await ensureReady(page)
  try {
    await clickSidebarTool(page, '图片工具箱')
    for (const [name, label] of [
      ['compress', '压缩'],
      ['convert', '转换'],
      ['resize', '缩放']
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
