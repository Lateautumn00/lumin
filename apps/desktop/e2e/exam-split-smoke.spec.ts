import { execSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import { holdExclusiveLock, type FileLockHandle } from './file-lock'
import { clickSidebarTool } from './sidebar'
import type { LuminBridge } from '@lumin/plugin-api'

declare global {
  interface Window {
    lumin: LuminBridge
  }
}

const appDir = path.resolve(__dirname, '..')
const fixturesDir = path.resolve(__dirname, '../../../packages/tools/exam-split/fixtures')
const threePageFixture = path.join(fixturesDir, '三页卷.pdf')
const hundredPageFixture = path.join(fixturesDir, '百页卷.pdf')
const encryptedFixture = path.join(fixturesDir, 'encrypted.pdf')

async function launch(): Promise<{
  app: ElectronApplication
  page: Awaited<ReturnType<ElectronApplication['firstWindow']>>
}> {
  const app = await electron.launch({ args: ['.'], cwd: appDir })
  const page = await app.firstWindow()
  return { app, page }
}

function pdfHead(filePath: string): string {
  return fs.readFileSync(filePath).subarray(0, 5).toString('latin1')
}

/** 建临时工作目录（目录名 ASCII+空格：Node 24 对非 ASCII 目录名 rmSync 静默不删） */
function makeWorkDir(name: string): string {
  const dir = path.join(os.tmpdir(), name)
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

test.describe('exam-split（试卷切割 · PDF 操作）冒烟', () => {
  test('两算子真实执行（R2.1 中文+空格路径）：拆分/裁剪产物 %PDF-', async () => {
    test.setTimeout(180_000)
    const { app, page } = await launch()
    const workDir = makeWorkDir('lumin exam split e2e')
    try {
      test.skip(!fs.existsSync(threePageFixture), '缺少 fixtures（exam-split/fixtures）')
      const inputA = path.join(workDir, '期中 卷甲.pdf')
      fs.copyFileSync(threePageFixture, inputA)

      const outcome = await page.evaluate(
        (a) =>
          new Promise<Record<string, { result: unknown; error: { code: string } | null }>>(
            (resolve, reject) => {
              const collected: Record<string, { result: unknown; error: { code: string } | null }> =
                {}
              const runOne = (key: string, channel: string, payload: unknown): Promise<void> =>
                new Promise((done) => {
                  let taskId = ''
                  const off = window.lumin.onTaskEvent((ev) => {
                    if (taskId !== '' && ev.taskId !== taskId) return
                    if (ev.kind === 'done') {
                      off()
                      collected[key] = { result: ev.result, error: null }
                      done()
                    } else if (ev.kind === 'error') {
                      off()
                      collected[key] = { result: null, error: ev.error }
                      done()
                    }
                  })
                  window.lumin
                    .invoke<{ taskId: string }>(channel, payload)
                    .then(({ taskId: id }) => {
                      taskId = id
                    })
                    .catch((err: unknown) => {
                      off()
                      collected[key] = { result: null, error: err as { code: string } }
                      done()
                    })
                })
              void (async () => {
                await runOne('split', 'exam-split:split', { inputPath: a, ranges: '1-2,3' })
                await runOne('splitNamed', 'exam-split:split', {
                  inputPath: a,
                  ranges: '1',
                  nameTemplate: '{name}-{op}-{label}'
                })
                await runOne('crop', 'exam-split:crop', {
                  inputPath: a,
                  box: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 }
                })
                resolve(collected)
              })().catch(reject)
            }
          ),
        inputA
      )

      for (const [key, entry] of Object.entries(outcome)) {
        expect(entry.error, `${key} 不应失败`).toBeNull()
      }

      const pathsOf = (key: string): string[] =>
        (outcome[key]?.result as { outputPaths: string[] }).outputPaths

      // 拆分：每区间一文件（1-2,3 → 2 个），命名 spec §7.2
      expect(pathsOf('split')).toEqual([
        path.join(workDir, '期中 卷甲_p1-2.pdf'),
        path.join(workDir, '期中 卷甲_p3.pdf')
      ])
      // 自定义命名模板（spec §7.2）：{name}-{op}-{label}
      expect(pathsOf('splitNamed')).toEqual([path.join(workDir, '期中 卷甲-拆分-1.pdf')])
      expect(pathsOf('crop')).toEqual([path.join(workDir, '期中 卷甲_裁剪.pdf')])

      for (const key of ['split', 'splitNamed', 'crop']) {
        for (const output of pathsOf(key)) {
          expect(fs.existsSync(output), output).toBe(true)
          expect(pdfHead(output), output).toBe('%PDF-')
        }
      }
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true })
      await app.close()
    }
  })

  test('R2.3 加密文件：PDF_ENCRYPTED 中文提示，无产物', async () => {
    test.setTimeout(60_000)
    const { app, page } = await launch()
    const workDir = makeWorkDir('lumin-exam-encrypted')
    try {
      test.skip(!fs.existsSync(encryptedFixture), '缺少加密 fixture')
      const input = path.join(workDir, '加密卷.pdf')
      fs.copyFileSync(encryptedFixture, input)

      const error = await page.evaluate(
        (file: string) =>
          new Promise<{ code: string; message: string }>((resolve, reject) => {
            let taskId = ''
            const off = window.lumin.onTaskEvent((ev) => {
              if (taskId !== '' && ev.taskId !== taskId) return
              if (ev.kind === 'error') {
                off()
                resolve({ code: ev.error.code, message: ev.error.message })
              } else if (ev.kind === 'done') {
                off()
                reject(new Error('加密文件竟然处理成功'))
              }
            })
            window.lumin
              .invoke<{ taskId: string }>('exam-split:split', { inputPath: file, ranges: '1' })
              .then(({ taskId: id }) => {
                taskId = id
              })
              .catch((err: unknown) => {
                off()
                reject(err)
              })
          }),
        input
      )
      expect(error.code).toBe('PDF_ENCRYPTED')
      expect(error.message).toContain('加密')
      expect(fs.existsSync(path.join(workDir, '加密卷_p1.pdf'))).toBe(false)
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true })
      await app.close()
    }
  })

  test('R2.2 文件被占用：独占句柄 → PDF_LOCKED 结构化错误', async () => {
    test.setTimeout(60_000)
    const { app, page } = await launch()
    const workDir = makeWorkDir('lumin-exam-locked')
    const input = path.join(workDir, '占用卷.pdf')
    fs.copyFileSync(threePageFixture, input)
    let lock: FileLockHandle | null = null
    try {
      lock = await holdExclusiveLock(input)
      test.skip(!lock.acquired, '本环境未能建立独占句柄（PowerShell 启动失败/被策略拦截）')

      const error = await page.evaluate(
        (file: string) =>
          new Promise<{ code: string; message: string }>((resolve, reject) => {
            let taskId = ''
            const off = window.lumin.onTaskEvent((ev) => {
              if (taskId !== '' && ev.taskId !== taskId) return
              if (ev.kind === 'error') {
                off()
                resolve({ code: ev.error.code, message: ev.error.message })
              } else if (ev.kind === 'done') {
                off()
                reject(new Error('占用文件竟然处理成功'))
              }
            })
            window.lumin
              .invoke<{ taskId: string }>('exam-split:split', { inputPath: file, ranges: '1' })
              .then(({ taskId: id }) => {
                taskId = id
              })
              .catch((err: unknown) => {
                off()
                reject(err)
              })
          }),
        input
      )
      expect(error.code).toBe('PDF_LOCKED')
      expect(error.message).toContain('占用')
      expect(fs.existsSync(path.join(workDir, '占用卷_p1.pdf'))).toBe(false)
    } finally {
      lock?.release()
      await new Promise((resolve) => setTimeout(resolve, 500))
      fs.rmSync(workDir, { recursive: true, force: true })
      await app.close()
    }
  })

  test('R2.5/R2.6 取消 + 并发：排队任务 cancel → CANCELLED，其余并发任务全部成功', async () => {
    test.setTimeout(240_000)
    const { app, page } = await launch()
    const workDir = makeWorkDir('lumin-exam-cancel')
    try {
      test.skip(!fs.existsSync(hundredPageFixture), '缺少百页 fixture')
      const inputA = path.join(workDir, '百页 甲.pdf')
      const inputB = path.join(workDir, '百页 乙.pdf')
      fs.copyFileSync(hundredPageFixture, inputA)
      fs.copyFileSync(hundredPageFixture, inputB)
      // 100 个单页区间 → 每任务约 1–3s，保证取消窗口
      const ranges100 = Array.from({ length: 100 }, (_, i) => `${i + 1}`).join(',')

      const outcome = await page.evaluate(
        ({ a, b, ranges }) =>
          new Promise<{ cancelled: boolean; doneCount: number; failed: string[] }>(
            (resolve, reject) => {
              const state = { cancelled: false, doneCount: 0, failed: [] as string[] }
              let remaining = 3
              const off = window.lumin.onTaskEvent((ev) => {
                if (ev.kind === 'progress' || ev.kind === 'log') return
                remaining -= 1
                if (ev.kind === 'done') {
                  state.doneCount += 1
                } else if (ev.error.code === 'CANCELLED') {
                  state.cancelled = true
                } else {
                  state.failed.push(`${ev.taskId}:${ev.error.code}`)
                }
                if (remaining === 0) {
                  off()
                  resolve(state)
                }
              })
              const submit = (input: string): Promise<string> =>
                window.lumin
                  .invoke<{ taskId: string }>('exam-split:split', {
                    inputPath: input,
                    ranges
                  })
                  .then((r) => r.taskId)
              void (async () => {
                try {
                  await submit(a) // running #1
                  await submit(b) // running #2
                  const queued = await submit(a) // 排队（并发=2 时）
                  const cancelled = await window.lumin.invoke<boolean>('lumin:task:cancel', {
                    taskId: queued
                  })
                  if (!cancelled) state.failed.push('cancel 返回 false（任务已终态）')
                } catch (err) {
                  off()
                  reject(err)
                }
              })()
            }
          ),
        { a: inputA, b: inputB, ranges: ranges100 }
      )

      expect(outcome.failed).toEqual([])
      expect(outcome.cancelled).toBe(true)
      expect(outcome.doneCount).toBe(2)
      // 并发成功的两任务各产出 100 个文件（抽查首尾 %PDF-）
      const first = path.join(workDir, '百页 甲_p1.pdf')
      const last = path.join(workDir, '百页 甲_p100.pdf')
      expect(fs.existsSync(first)).toBe(true)
      expect(pdfHead(first)).toBe('%PDF-')
      expect(fs.existsSync(last)).toBe(true)
      expect(pdfHead(last)).toBe('%PDF-')
      expect(fs.existsSync(path.join(workDir, '百页 乙_p100.pdf'))).toBe(true)
      expect(
        fs.readdirSync(workDir).filter((name) => name.endsWith('.pdf')).length
      ).toBeGreaterThanOrEqual(200)
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true })
      await app.close()
    }
  })

  test('R2.8 断电恢复：处理中强杀进程 → 重启后同输入再处理成功（冲突递增兜底）', async () => {
    test.setTimeout(180_000)
    const workDir = makeWorkDir('lumin-exam-kill')
    const input = path.join(workDir, '断电卷.pdf')
    fs.copyFileSync(hundredPageFixture, input)
    const ranges100 = Array.from({ length: 100 }, (_, i) => `${i + 1}`).join(',')

    let app: ElectronApplication | null = null
    try {
      const launched = await launch()
      app = launched.app
      const page = launched.page

      // 提交长任务，收到首个进度后强杀（模拟断电）
      await page.evaluate(
        ({ file, ranges }) =>
          new Promise<void>((resolve, reject) => {
            let taskId = ''
            const off = window.lumin.onTaskEvent((ev) => {
              if (taskId !== '' && ev.taskId !== taskId) return
              if (ev.kind === 'progress') {
                off()
                resolve()
              } else if (ev.kind === 'error') {
                off()
                reject(new Error(`${ev.error.code}: ${ev.error.message}`))
              }
            })
            window.lumin
              .invoke<{ taskId: string }>('exam-split:split', {
                inputPath: file,
                ranges
              })
              .then(({ taskId: id }) => {
                taskId = id
              })
              .catch((err: unknown) => {
                off()
                reject(err)
              })
          }),
        { file: input, ranges: ranges100 }
      )
      execSync(`taskkill /PID ${app.process().pid} /F /T`, { stdio: 'ignore' })
      app = null
      await new Promise((resolve) => setTimeout(resolve, 1500))

      // 重启：同输入再次拆分 → 成功（残留半成品由冲突递增 (1) 兜底）
      const relaunched = await launch()
      try {
        const output = await relaunched.page.evaluate(
          ({ file, ranges }) =>
            new Promise<string[]>((resolve, reject) => {
              let taskId = ''
              const off = window.lumin.onTaskEvent((ev) => {
                if (taskId !== '' && ev.taskId !== taskId) return
                if (ev.kind === 'done') {
                  off()
                  resolve((ev.result as { outputPaths: string[] }).outputPaths)
                } else if (ev.kind === 'error') {
                  off()
                  reject(new Error(`${ev.error.code}: ${ev.error.message}`))
                }
              })
              window.lumin
                .invoke<{ taskId: string }>('exam-split:split', {
                  inputPath: file,
                  ranges
                })
                .then(({ taskId: id }) => {
                  taskId = id
                })
                .catch((err: unknown) => {
                  off()
                  reject(err)
                })
            }),
          { file: input, ranges: ranges100 }
        )
        expect(output).toHaveLength(100)
        expect(pdfHead(output[0]!)).toBe('%PDF-')
        expect(pdfHead(output[99]!)).toBe('%PDF-')
      } finally {
        await relaunched.app.close()
      }
    } finally {
      if (app) await app.close().catch(() => undefined)
      fs.rmSync(workDir, { recursive: true, force: true })
    }
  })

  test('预览渲染：DropZone 选文件 → pdfjs 缩略图出图（file:// worker 兜底，spike §3）', async () => {
    test.setTimeout(60_000)
    const { app, page } = await launch()
    try {
      test.skip(!fs.existsSync(threePageFixture), '缺少三页 fixture')
      await clickSidebarTool(page, '试卷切割')
      await expect(page.getByRole('tab', { name: 'PDF 操作' })).toBeVisible()

      // PDF 页签收敛（M49）：仅拆分/裁剪；合并/删页/旋转下线并引导到 PDF 工具集
      await expect(page.getByRole('radio', { name: '拆分' })).toBeVisible()
      await expect(page.getByRole('radio', { name: '裁剪' })).toBeVisible()
      await expect(page.getByRole('radio', { name: '合并' })).toHaveCount(0)
      await expect(page.getByRole('radio', { name: '删页' })).toHaveCount(0)
      await expect(page.getByRole('radio', { name: '旋转' })).toHaveCount(0)
      await expect(
        page.getByText('合并、删页、旋转、重排等请使用「PDF 工具集」。')
      ).toBeVisible()

      await page.locator('input[type="file"]').setInputFiles(threePageFixture)

      // 三页缩略图挂载 + 至少一页完成渲染（worker 加载成功）
      await expect(page.locator('canvas')).toHaveCount(3, { timeout: 20_000 })
      await expect(page.locator('canvas[data-rendered="1"]').first()).toBeVisible({
        timeout: 20_000
      })
      await expect(page.getByText('共 3 页')).toBeVisible()

      // 点选第 2 页 → 区间文本框回写（spec §2 双向同步）
      await page.getByRole('button', { name: '第 2 页' }).click()
      await expect(page.getByPlaceholder('如 1-3,5,7-9')).toHaveValue('2')
    } finally {
      await app.close()
    }
  })
})

/* ─── M3b OCR 切题（真实模型；fixtures 缺失时跳过） ─── */

/** 1×1 PNG 头（导出校验：spec §10.7.3） */
function pngHead(filePath: string): string {
  return fs.readFileSync(filePath).subarray(0, 4).toString('latin1')
}

/** 合成样卷图片（1200×1600，印刷体 3 题；R2.4 用大图尺寸） */
async function makeSampleImage(filePath: string): Promise<void> {
  const { createCanvas, GlobalFonts } = await import('@napi-rs/canvas')
  if (fs.existsSync('C:\\Windows\\Fonts\\msyh.ttc')) {
    GlobalFonts.registerFromPath('C:\\Windows\\Fonts\\msyh.ttc', 'Microsoft YaHei')
  }
  const canvas = createCanvas(1200, 1600)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, 1200, 1600)
  ctx.fillStyle = '#111111'
  const font = (size: number): string => `${size}px "Microsoft YaHei", sans-serif`
  ctx.font = font(46)
  ctx.fillText('一、选择题（每题 5 分）', 80, 150)
  const lines = [
    '1、下列各数中，最小的数是（  ）',
    'A．-2    B．-1    C．0    D．1',
    '2、计算 3+5 的结果是（  ）',
    'A．6    B．7    C．8    D．9',
    '3、下列图形中，是轴对称图形的是（  ）',
    'A．圆    B．平行四边形    C．三角形    D．梯形'
  ]
  lines.forEach((text, index) => {
    ctx.font = font(index % 2 === 0 ? 44 : 40)
    ctx.fillText(text, 80, 280 + index * 170)
  })
  fs.writeFileSync(filePath, await canvas.encode('png'))
}

/** 顺时针 90° 旋转 PNG（模拟手机侧拍；spec §10.12） */
async function makeSidewaysImage(sourcePath: string, targetPath: string): Promise<void> {
  const { createCanvas, loadImage } = await import('@napi-rs/canvas')
  const image = await loadImage(fs.readFileSync(sourcePath))
  const canvas = createCanvas(image.height, image.width)
  const ctx = canvas.getContext('2d')
  ctx.translate(canvas.width / 2, canvas.height / 2)
  ctx.rotate(Math.PI / 2)
  ctx.drawImage(image, -image.width / 2, -image.height / 2)
  fs.writeFileSync(targetPath, await canvas.encode('png'))
}

/** 整本摊开的跨页照（2000×1400：左 3 题、右 2 题、页脚跨书脊；spec §10.12） */
async function makeSpreadImage(filePath: string): Promise<void> {
  const { createCanvas, GlobalFonts } = await import('@napi-rs/canvas')
  if (fs.existsSync('C:\\Windows\\Fonts\\msyh.ttc')) {
    GlobalFonts.registerFromPath('C:\\Windows\\Fonts\\msyh.ttc', 'Microsoft YaHei')
  }
  const canvas = createCanvas(2000, 1400)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, 2000, 1400)
  ctx.fillStyle = '#111111'
  ctx.font = '52px "Microsoft YaHei", sans-serif'
  const left = [
    '1、下列各数中最小的是（  ）',
    '2、计算三加五的结果（  ）',
    '3、轴对称图形是哪一个（  ）'
  ]
  const right = ['1、看拼音写词语（  ）', '2、给加点字注音（  ）']
  left.forEach((text, index) => ctx.fillText(text, 110, 300 + index * 300))
  right.forEach((text, index) => ctx.fillText(text, 1120, 300 + index * 300))
  ctx.font = '40px "Microsoft YaHei", sans-serif'
  ctx.fillText('一年级语文 第 1 页', 820, 1300)
  fs.writeFileSync(filePath, await canvas.encode('png'))
}

/** PNG 像素宽（IHDR 偏移 16；验证导出与识别同一旋转变换） */
function pngWidth(filePath: string): number {
  return fs.readFileSync(filePath).readUInt32BE(16)
}

/** IPC 单任务（done/error 二选一） */ async function runTask(
  page: Awaited<ReturnType<ElectronApplication['firstWindow']>>,
  channel: string,
  payload: unknown
): Promise<{ result?: unknown; error?: { code: string; message: string } }> {
  return page.evaluate(
    ([ch, data]) =>
      new Promise<{ result?: unknown; error?: { code: string; message: string } }>(
        (resolve, reject) => {
          let taskId = ''
          const off = window.lumin.onTaskEvent((ev) => {
            if (taskId !== '' && ev.taskId !== taskId) return
            if (ev.kind === 'done') {
              off()
              resolve({ result: ev.result })
            } else if (ev.kind === 'error') {
              off()
              resolve({ error: ev.error })
            }
          })
          window.lumin
            .invoke<{ taskId: string }>(ch, data)
            .then(({ taskId: id }) => {
              taskId = id
            })
            .catch((err: unknown) => {
              off()
              reject(err)
            })
        }
      ),
    [channel, payload] as const
  )
}

test.describe('exam-split（OCR 切题 · M3b）冒烟', () => {
  test('图片识别 → 键盘微调 → 导出 PNG+PDF（真实模型，R2.4 大图）', async () => {
    test.setTimeout(240_000)
    const { app, page } = await launch()
    const workDir = makeWorkDir('lumin ocr image')
    try {
      const input = path.join(workDir, '样卷 图片.png')
      await makeSampleImage(input)

      await clickSidebarTool(page, '试卷切割')
      await page.getByRole('tab', { name: 'OCR 切题' }).click()
      const panel = page.locator('section[aria-label="OCR 切题"]')
      await panel.locator('input[type="file"]').setInputFiles(input)

      // 预览出图（renderer 直读 File，不经 IPC）
      await expect(page.locator('img[alt="当前页预览"]')).toBeVisible({ timeout: 20_000 })
      await expect(panel.getByRole('button', { name: '开始识别' })).toBeEnabled()

      await panel.getByRole('button', { name: '开始识别' }).click()
      // 阶段进度可见（加载识别模型… / 识别第 1/1 页…）
      await expect(panel.getByText(/识别|渲染|切分|加载/).first()).toBeVisible({ timeout: 30_000 })
      await expect(panel.getByText(/共 \d+ 题/)).toBeVisible({ timeout: 120_000 })

      // 键盘微调：选中首条分界线 → ↓ 下移，aria-valuenow 变化（spec §10.2）
      const slider = page.getByRole('slider', { name: /题下边界/ }).first()
      await expect(slider).toBeVisible()
      const before = Number(await slider.getAttribute('aria-valuenow'))
      await slider.focus()
      for (let index = 0; index < 4; index++) await page.keyboard.press('ArrowDown')
      await expect
        .poll(async () => Number(await slider.getAttribute('aria-valuenow')))
        .toBeGreaterThan(before)

      await panel.getByRole('button', { name: /^导出/ }).click()
      await expect(panel.getByText(/导出完成/)).toBeVisible({ timeout: 120_000 })

      const files = fs.readdirSync(workDir)
      const pngs = files.filter((name) => name.includes('_题') && name.endsWith('.png'))
      expect(pngs.length).toBeGreaterThanOrEqual(2)
      expect(pngHead(path.join(workDir, pngs[0] as string))).toBe('\x89PNG')
      expect(pngs).toContain('样卷 图片_题1.png')
      const pdf = path.join(workDir, '样卷 图片_切题.pdf')
      expect(fs.existsSync(pdf)).toBe(true)
      expect(pdfHead(pdf)).toBe('%PDF-')
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true })
      await app.close()
    }
  })

  test('PDF 识别（三页卷）：每页 ≥1 题区且题号连续（真实模型）', async () => {
    test.setTimeout(180_000)
    const { app, page } = await launch()
    try {
      test.skip(!fs.existsSync(threePageFixture), '缺少三页 fixture')
      const outcome = await runTask(page, 'exam-split:ocr-detect', {
        inputPath: threePageFixture
      })
      expect(outcome.error).toBeUndefined()
      const result = outcome.result as {
        pages: { pageNumber: number; regions: { start: number; end: number }[] }[]
      }
      expect(result.pages.map((item) => item.pageNumber)).toEqual([1, 2, 3])
      for (const item of result.pages) {
        expect(item.regions.length).toBeGreaterThanOrEqual(1)
        for (const region of item.regions) expect(region.start).toBeLessThan(region.end)
      }
    } finally {
      await app.close()
    }
  })

  test('OCR 输入异常：损坏图片 → OCR_INPUT_INVALID；加密 PDF → PDF_ENCRYPTED', async () => {
    test.setTimeout(120_000)
    const { app, page } = await launch()
    const workDir = makeWorkDir('lumin ocr bad input')
    try {
      const broken = path.join(workDir, '坏图.png')
      fs.writeFileSync(broken, Buffer.from('not a png', 'utf8'))
      const imageOutcome = await runTask(page, 'exam-split:ocr-detect', { inputPath: broken })
      expect(imageOutcome.error?.code).toBe('OCR_INPUT_INVALID')
      expect(imageOutcome.error?.message).toContain('图片')

      test.skip(!fs.existsSync(encryptedFixture), '缺少加密 fixture')
      const pdfOutcome = await runTask(page, 'exam-split:ocr-detect', {
        inputPath: encryptedFixture
      })
      expect(pdfOutcome.error?.code).toBe('PDF_ENCRYPTED')
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true })
      await app.close()
    }
  })

  test('R2.7 模型缺失：临时移走 det.onnx → MODEL_MISSING（真实模型文件原位恢复）', async () => {
    test.setTimeout(120_000)
    const { app, page } = await launch()
    const workDir = makeWorkDir('lumin ocr model')
    const model = path.resolve(fixturesDir, '../../../../binaries/ocr/det.onnx')
    const backup = `${model}.bak`
    try {
      test.skip(!fs.existsSync(model), '缺少 OCR 模型（先跑 scripts/fetch-binaries.mjs）')
      const input = path.join(workDir, '模型卷.png')
      await makeSampleImage(input)
      fs.renameSync(model, backup)
      const outcome = await runTask(page, 'exam-split:ocr-detect', { inputPath: input })
      expect(outcome.error?.code).toBe('MODEL_MISSING')
      expect(outcome.error?.message).toContain('模型')
    } finally {
      if (fs.existsSync(backup)) fs.renameSync(backup, model)
      fs.rmSync(workDir, { recursive: true, force: true })
      await app.close()
    }
  })

  test('R2.5 取消：百页 PDF detect 中断 → CANCELLED', async () => {
    test.setTimeout(180_000)
    const { app, page } = await launch()
    try {
      test.skip(!fs.existsSync(hundredPageFixture), '缺少百页 fixture')
      const error = await page.evaluate(
        (file: string) =>
          new Promise<{ code: string }>((resolve, reject) => {
            let taskId = ''
            let cancelRequested = false
            const off = window.lumin.onTaskEvent((ev) => {
              if (taskId !== '' && ev.taskId !== taskId) return
              if (ev.kind === 'progress') {
                // 首个进度即取消（渲染阶段先到）；保持监听等待 CANCELLED
                if (!cancelRequested) {
                  cancelRequested = true
                  void window.lumin.invoke<boolean>('lumin:task:cancel', { taskId })
                }
                return
              }
              if (ev.kind === 'done') {
                off()
                reject(new Error('百页 OCR 竟然在取消前完成'))
              } else if (ev.kind === 'error') {
                off()
                resolve({ code: ev.error.code })
              }
            })
            window.lumin
              .invoke<{ taskId: string }>('exam-split:ocr-detect', { inputPath: file })
              .then(({ taskId: id }) => {
                taskId = id
              })
              .catch((err: unknown) => {
                off()
                reject(err)
              })
          }),
        hundredPageFixture
      )
      expect(error.code).toBe('CANCELLED')
    } finally {
      await app.close()
    }
  })

  test('页面旋转（spec §10.12）：[左转] 复原侧拍图 → 识别与导出同一旋转', async () => {
    test.setTimeout(240_000)
    const { app, page } = await launch()
    const workDir = makeWorkDir('lumin ocr rotate')
    try {
      const upright = path.join(workDir, '卷.png')
      await makeSampleImage(upright)
      const sideways = path.join(workDir, '侧拍.png')
      await makeSidewaysImage(upright, sideways)

      await clickSidebarTool(page, '试卷切割')
      await page.getByRole('tab', { name: 'OCR 切题' }).click()
      const panel = page.locator('section[aria-label="OCR 切题"]')
      await panel.locator('input[type="file"]').setInputFiles(sideways)
      await expect(page.locator('img[alt="当前页预览"]')).toBeVisible({ timeout: 20_000 })

      // 侧拍（顺时针 90°）→ [左转] 270° 复原
      await page.getByRole('button', { name: '向左旋转 90°' }).click()
      await expect(page.getByText('旋转 270°')).toBeVisible()
      await panel.getByRole('button', { name: '开始识别' }).click()
      await expect(panel.getByText(/共 \d+ 题/)).toBeVisible({ timeout: 120_000 })

      // 同一 rotation：detect 回包尺寸 = 复原后原图尺寸（1600×1200 侧拍 → 1200×1600）
      const detected = await runTask(page, 'exam-split:ocr-detect', {
        inputPath: sideways,
        rotation: 270
      })
      expect(detected.error).toBeUndefined()
      const pages = (detected.result as { pages: { width: number; height: number }[] }).pages
      expect(pages[0]?.width).toBe(1200)
      expect(pages[0]?.height).toBe(1600)

      // 导出按旋转后尺寸裁剪：270° 全页宽 1200（未旋转则 1600）
      const fullPage = (startNumber: number) => ({
        inputPath: sideways,
        rotation: 270,
        startNumber,
        exportPdf: false,
        pages: [
          {
            pageNumber: 1,
            width: 1200,
            height: 1600,
            regions: [{ start: 0, end: 0.5, lines: [] }]
          }
        ]
      })
      const rotatedExport = await runTask(page, 'exam-split:ocr-export', fullPage(1))
      expect(rotatedExport.error).toBeUndefined()
      expect(pngWidth(path.join(workDir, '侧拍_题1.png'))).toBe(1200)

      const rawExport = await runTask(page, 'exam-split:ocr-export', {
        ...fullPage(2),
        rotation: 0
      })
      expect(rawExport.error).toBeUndefined()
      expect(pngWidth(path.join(workDir, '侧拍_题2.png'))).toBe(1600)
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true })
      await app.close()
    }
  })

  test('跨页展开照（spec §10.12）：书脊=列缝 → 左右两页各自切题、左页在前', async () => {
    test.setTimeout(180_000)
    const { app, page } = await launch()
    const workDir = makeWorkDir('lumin ocr spread')
    try {
      const input = path.join(workDir, '跨页.png')
      await makeSpreadImage(input)
      const outcome = await runTask(page, 'exam-split:ocr-detect', { inputPath: input })
      expect(outcome.error).toBeUndefined()
      const result = outcome.result as {
        pages: {
          width: number
          height: number
          regions: { start: number; end: number; xStart?: number; xEnd?: number }[]
        }[]
      }
      const first = result.pages[0]
      expect(first?.width).toBe(2000)
      const regions = first?.regions ?? []
      expect(regions.length).toBeGreaterThanOrEqual(4)

      // 所有题区均带列边界（书脊被识别为栏缝）
      for (const region of regions) expect(region.xStart).toBeDefined()

      const leftRegions = regions.filter((region) => (region.xStart ?? 1) < 0.4)
      const rightRegions = regions.filter((region) => (region.xStart ?? 0) >= 0.4)
      expect(leftRegions.length).toBeGreaterThanOrEqual(2)
      expect(rightRegions.length).toBeGreaterThanOrEqual(2)

      // 编号/列表按页序 → 列序：左页题区全部排在右页之前
      const lastLeft = regions.lastIndexOf(leftRegions[leftRegions.length - 1]!)
      const firstRight = regions.indexOf(rightRegions[0]!)
      expect(lastLeft).toBeLessThan(firstRight)
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true })
      await app.close()
    }
  })
})
