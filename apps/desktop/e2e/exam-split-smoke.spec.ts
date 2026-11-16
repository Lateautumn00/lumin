import { execSync, spawn, type ChildProcess } from 'node:child_process'
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
const fixturesDir = path.resolve(__dirname, '../../../packages/tools/exam-split/fixtures')
const threePageFixture = path.join(fixturesDir, '三页卷.pdf')
const twoPageFixture = path.join(fixturesDir, '两页卷.pdf')
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
  test('五算子真实执行（R2.1 中文+空格路径）：拆分/合并/删页/旋转/裁剪产物 %PDF-', async () => {
    test.setTimeout(180_000)
    const { app, page } = await launch()
    const workDir = makeWorkDir('lumin exam split e2e')
    try {
      test.skip(!fs.existsSync(threePageFixture), '缺少 fixtures（exam-split/fixtures）')
      const inputA = path.join(workDir, '期中 卷甲.pdf')
      const inputB = path.join(workDir, '乙 卷.pdf')
      fs.copyFileSync(threePageFixture, inputA)
      fs.copyFileSync(twoPageFixture, inputB)

      const outcome = await page.evaluate(
        ([a, b]) =>
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
                await runOne('merge', 'exam-split:merge', { inputPaths: [a, b] })
                await runOne('delete', 'exam-split:delete', { inputPath: a, ranges: '2' })
                await runOne('rotate', 'exam-split:rotate', { inputPath: a, degrees: 180 })
                await runOne('crop', 'exam-split:crop', {
                  inputPath: a,
                  box: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 }
                })
                resolve(collected)
              })().catch(reject)
            }
          ),
        [inputA, inputB]
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
      expect(pathsOf('merge')).toEqual([path.join(workDir, '期中 卷甲_合并.pdf')])
      expect(pathsOf('delete')).toEqual([path.join(workDir, '期中 卷甲_删p2.pdf')])
      expect(pathsOf('rotate')).toEqual([path.join(workDir, '期中 卷甲_旋转180.pdf')])
      expect(pathsOf('crop')).toEqual([path.join(workDir, '期中 卷甲_裁剪.pdf')])

      for (const key of ['split', 'merge', 'delete', 'rotate', 'crop']) {
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
    const scriptPath = path.join(workDir, 'hold.ps1')
    fs.writeFileSync(
      scriptPath,
      "$fs = [System.IO.File]::Open($args[0], 'Open', 'ReadWrite', 'None')\n" +
        'Start-Sleep -Seconds 60\n' +
        '$fs.Close()\n'
    )
    let holder: ChildProcess | null = null
    try {
      holder = spawn('powershell.exe', ['-NoProfile', '-File', scriptPath, input], {
        windowsHide: true
      })
      await new Promise((resolve) => setTimeout(resolve, 1500))

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
      holder?.kill()
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
      await page.getByRole('link', { name: '试卷切割' }).click()
      await expect(page.getByRole('tab', { name: 'PDF 操作' })).toBeVisible()

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
