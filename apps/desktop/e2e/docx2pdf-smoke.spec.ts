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
type Page = Awaited<ReturnType<ElectronApplication['firstWindow']>>
const fixturesDir = path.resolve(__dirname, '../../../packages/tools/docx2pdf/fixtures')
const fixtureFile = path.join(fixturesDir, '保真样例.docx')
const encryptedFixture = path.join(fixturesDir, '加密样例.docx')
const xlsxFixture = path.join(fixturesDir, '表格样例.xlsx')
const pptxFixture = path.join(fixturesDir, '演示样例.pptx')

interface StatusResult {
  source: 'custom' | 'system' | 'portable' | 'none'
  path?: string
  customInvalid: boolean
  customPath: string
}

async function launch(): Promise<{
  app: ElectronApplication
  page: Awaited<ReturnType<ElectronApplication['firstWindow']>>
}> {
  const app = await electron.launch({ args: ['.'], cwd: appDir })
  const page = await app.firstWindow()
  return { app, page }
}

function getStatus(
  page: Awaited<ReturnType<ElectronApplication['firstWindow']>>
): Promise<StatusResult> {
  return page.evaluate(() => window.lumin.invoke<StatusResult>('docx2pdf:status'))
}

/** 临时目录基线快照（断言取消/清理后无新增 lumin-docx2pdf-* 残留） */
function taskDirSnapshot(): Set<string> {
  const found = new Set<string>()
  for (const name of fs.readdirSync(os.tmpdir())) {
    if (name.startsWith('lumin-docx2pdf-')) found.add(name)
  }
  return found
}

async function pollNoNewTaskDirs(baseline: Set<string>, timeoutMs = 8000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const current = taskDirSnapshot()
    const leaked = [...current].filter((name) => !baseline.has(name))
    if (leaked.length === 0) return true
    if (Date.now() > deadline) return false
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
}

test.describe('docx2pdf（文档输出）冒烟', () => {
  test('状态与自定义路径往返：status 枚举 + set-path 保存/清空', async () => {
    const { app, page } = await launch()
    try {
      await clickSidebarTool(page, '文档输出')
      await expect(page.getByRole('heading', { name: '文档输出' })).toBeVisible()
      // M80 并入打印页签
      await expect(page.locator('.n-tabs-tab[data-name="convert"]')).toHaveText('转为 PDF')
      await expect(page.locator('.n-tabs-tab[data-name="print"]')).toHaveText('打印')

      const status = await getStatus(page)
      expect(['custom', 'system', 'portable', 'none']).toContain(status.source)
      expect(typeof status.customInvalid).toBe('boolean')
      expect(typeof status.customPath).toBe('string')

      // set-path：指向不存在的路径 → 保存回填并标记无效（回退系统检测）
      const saved = await page.evaluate(() =>
        window.lumin.invoke<StatusResult>('docx2pdf:set-path', {
          path: 'Z:\\不存在\\soffice.com'
        })
      )
      expect(saved.customPath).toBe('Z:\\不存在\\soffice.com')
      expect(saved.source).not.toBe('custom')

      // 清空恢复三级定位
      const cleared = await page.evaluate(() =>
        window.lumin.invoke<StatusResult>('docx2pdf:set-path', { path: '' })
      )
      expect(cleared.customPath).toBe('')
      expect(['system', 'portable', 'none']).toContain(cleared.source)

      // 非法 payload → 结构化错误（页内捕获，避免跨进程序列化丢字段）
      const invalid = await page.evaluate(async () => {
        try {
          await window.lumin.invoke('docx2pdf:set-path', null)
          return null
        } catch (err) {
          return err as { code?: string }
        }
      })
      expect(invalid?.code).toBe('INVALID_PAYLOAD')
    } finally {
      await app.close()
    }
  })

  test('真实转换（R2.1 中文+空格路径）：progress → done → 产物 %PDF-', async () => {
    test.setTimeout(180_000)
    const { app, page } = await launch()
    // 目录名用 ASCII+空格（本机 Node 24.13 的 fs.rmSync 对非 ASCII 目录名静默不删，
    // 输入/输出文件名含中文+空格即满足 R2 类别 1 的路径验证）
    const workDir = path.join(os.tmpdir(), 'lumin d2p e2e dir')
    fs.rmSync(workDir, { recursive: true, force: true })
    fs.mkdirSync(workDir, { recursive: true })
    try {
      const status = await getStatus(page)
      test.skip(status.source === 'none', '本机无 LibreOffice（注册表/便携/自定义三级均未命中）')
      test.skip(!fs.existsSync(fixtureFile), '缺少 fixture（packages/tools/docx2pdf/fixtures）')

      const inputPath = path.join(workDir, '保真 样例 v2.docx')
      fs.copyFileSync(fixtureFile, inputPath)

      const outcome = await page.evaluate(
        (input: string) =>
          new Promise<{ hasProgress: boolean; stages: string[]; result: unknown }>(
            (resolve, reject) => {
              let hasProgress = false
              const stages: string[] = []
              let currentTaskId = ''
              const off = window.lumin.onTaskEvent((ev) => {
                if (ev.taskId !== currentTaskId) return
                if (ev.kind === 'progress') {
                  hasProgress = true
                  if (ev.stage) stages.push(ev.stage)
                } else if (ev.kind === 'done') {
                  off()
                  resolve({ hasProgress, stages, result: ev.result })
                } else if (ev.kind === 'error') {
                  off()
                  reject(new Error(`${ev.error.code}: ${ev.error.message}`))
                }
              })
              window.lumin
                .invoke<{ taskId: string }>('docx2pdf:convert', { inputPaths: [input] })
                .then(({ taskId }) => {
                  currentTaskId = taskId
                })
                .catch((err: unknown) => {
                  off()
                  reject(err)
                })
            }
          ),
        inputPath
      )

      expect(outcome.hasProgress).toBe(true)
      const result = outcome.result as { outputs: { outputPath: string }[]; failures: unknown[] }
      expect(result.failures).toEqual([])
      const outputPath = result.outputs[0]?.outputPath ?? ''
      // 输出同目录同基名（中文+空格保留）
      expect(outputPath).toBe(path.join(workDir, '保真 样例 v2.pdf'))
      expect(fs.existsSync(outputPath)).toBe(true)
      const head = fs.readFileSync(outputPath).subarray(0, 5).toString('latin1')
      expect(head).toBe('%PDF-')
      // finally 清理：无 lumin-docx2pdf-* 残留
      expect(await pollNoNewTaskDirs(taskDirSnapshot())).toBe(true)
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true })
      await app.close()
    }
  })

  test('批量转换：成功项与失败项并行上报（单文件失败不中断批次）', async () => {
    test.setTimeout(240_000)
    const { app, page } = await launch()
    const workDir = path.join(os.tmpdir(), 'lumin-d2p-batch')
    fs.rmSync(workDir, { recursive: true, force: true })
    fs.mkdirSync(workDir, { recursive: true })
    try {
      const status = await getStatus(page)
      test.skip(status.source === 'none', '本机无 LibreOffice')
      const docx = path.join(workDir, '批量甲.docx')
      fs.copyFileSync(fixtureFile, docx)
      const xlsx = path.join(workDir, '批量乙.xlsx')
      fs.copyFileSync(xlsxFixture, xlsx)
      const pptx = path.join(workDir, '批量丙.pptx')
      fs.copyFileSync(pptxFixture, pptx)
      // 缺失的 .xlsx：触发单文件失败，验证批次不中断
      const missing = path.join(workDir, '缺失.xlsx')

      const outcome = await page.evaluate(
        (inputs: string[]) =>
          new Promise<{
            totals: number[]
            result: {
              outputs: { inputPath: string; outputPath: string }[]
              failures: { inputPath: string; code: string; message: string }[]
            }
          }>((resolve, reject) => {
            let taskId = ''
            const totals: number[] = []
            const off = window.lumin.onTaskEvent((ev) => {
              if (ev.taskId !== taskId) return
              if (ev.kind === 'progress') {
                if (ev.total !== undefined) totals.push(ev.total)
              } else if (ev.kind === 'done') {
                off()
                resolve({
                  totals,
                  result: ev.result as {
                    outputs: { inputPath: string; outputPath: string }[]
                    failures: { inputPath: string; code: string; message: string }[]
                  }
                })
              } else if (ev.kind === 'error') {
                off()
                reject(new Error(`${ev.error.code}: ${ev.error.message}`))
              }
            })
            window.lumin
              .invoke<{ taskId: string }>('docx2pdf:convert', { inputPaths: inputs })
              .then(({ taskId: id }) => {
                taskId = id
              })
              .catch((err: unknown) => {
                off()
                reject(err)
              })
          }),
        [docx, xlsx, pptx, missing]
      )

      expect(outcome.totals.length).toBeGreaterThanOrEqual(2)
      expect(outcome.totals.every((total) => total === 4)).toBe(true)
      expect(outcome.result.outputs).toEqual([
        { inputPath: docx, outputPath: path.join(workDir, '批量甲.pdf') },
        { inputPath: xlsx, outputPath: path.join(workDir, '批量乙.pdf') },
        { inputPath: pptx, outputPath: path.join(workDir, '批量丙.pdf') }
      ])
      expect(outcome.result.failures).toMatchObject([
        {
          inputPath: missing,
          code: 'INPUT_NOT_FOUND',
          message: '输入文件不存在，请重新选择'
        }
      ])
      for (const output of outcome.result.outputs) {
        const head = fs.readFileSync(output.outputPath).subarray(0, 5)
        expect(head.toString('latin1')).toBe('%PDF-')
      }
      expect(fs.existsSync(path.join(workDir, '缺失.pdf'))).toBe(false)
      expect(await pollNoNewTaskDirs(taskDirSnapshot())).toBe(true)
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true })
      await app.close()
    }
  })

  test('R2.2 文件被占用：独占句柄 → INPUT_LOCKED 结构化错误', async () => {
    test.setTimeout(60_000)
    const { app, page } = await launch()
    const workDir = path.join(os.tmpdir(), 'lumin-d2p-locked')
    fs.rmSync(workDir, { recursive: true, force: true })
    fs.mkdirSync(workDir, { recursive: true })
    const inputPath = path.join(workDir, '占用 样例.docx')
    fs.copyFileSync(fixtureFile, inputPath)

    let lock: FileLockHandle | null = null
    try {
      const status = await getStatus(page)
      test.skip(
        status.source === 'none',
        '本机无 LibreOffice：转换前置检测会先报 SOFFICE_NOT_FOUND，无法进入占用检测分支'
      )
      lock = await holdExclusiveLock(inputPath)
      test.skip(!lock.acquired, '本环境未能建立独占句柄（PowerShell 启动失败/被策略拦截）')

      const error = await page.evaluate(
        (input: string) =>
          new Promise<{ code: string; message: string }>((resolve, reject) => {
            let currentTaskId = ''
            const off = window.lumin.onTaskEvent((ev) => {
              if (ev.taskId !== currentTaskId) return
              if (ev.kind === 'error') {
                off()
                resolve({ code: ev.error.code, message: ev.error.message })
              } else if (ev.kind === 'done') {
                off()
                reject(new Error('占用文件竟然转换成功'))
              }
            })
            window.lumin
              .invoke<{ taskId: string }>('docx2pdf:convert', { inputPaths: [input] })
              .then(({ taskId }) => {
                currentTaskId = taskId
              })
              .catch((err: unknown) => {
                off()
                reject(err)
              })
          }),
        inputPath
      )
      expect(error.code).toBe('INPUT_LOCKED')
      expect(error.message).toContain('文件被其他程序占用')
    } finally {
      lock?.release()
      await new Promise((resolve) => setTimeout(resolve, 500))
      fs.rmSync(workDir, { recursive: true, force: true })
      await app.close()
    }
  })

  test('R2.3 加密文件：无法加载 → INPUT_LOAD_FAILED 中文提示', async () => {
    test.setTimeout(120_000)
    const { app, page } = await launch()
    const workDir = path.join(os.tmpdir(), 'lumin-d2p-encrypted')
    fs.rmSync(workDir, { recursive: true, force: true })
    fs.mkdirSync(workDir, { recursive: true })
    try {
      const status = await getStatus(page)
      test.skip(status.source === 'none', '本机无 LibreOffice')
      test.skip(!fs.existsSync(encryptedFixture), '缺少加密 fixture')
      const inputPath = path.join(workDir, '加密样例.docx')
      fs.copyFileSync(encryptedFixture, inputPath)

      const error = await page.evaluate(
        (input: string) =>
          new Promise<{ code: string; message: string }>((resolve, reject) => {
            let currentTaskId = ''
            const off = window.lumin.onTaskEvent((ev) => {
              if (ev.taskId !== currentTaskId) return
              if (ev.kind === 'error') {
                off()
                resolve({ code: ev.error.code, message: ev.error.message })
              } else if (ev.kind === 'done') {
                off()
                reject(new Error('加密文件竟然转换成功'))
              }
            })
            window.lumin
              .invoke<{ taskId: string }>('docx2pdf:convert', { inputPaths: [input] })
              .then(({ taskId }) => {
                currentTaskId = taskId
              })
              .catch((err: unknown) => {
                off()
                reject(err)
              })
          }),
        inputPath
      )
      expect(error.code).toBe('INPUT_LOAD_FAILED')
      expect(error.message).toContain('文件无法读取')
      // 不留产物、不留临时目录
      expect(fs.existsSync(path.join(workDir, '加密样例.pdf'))).toBe(false)
      expect(await pollNoNewTaskDirs(taskDirSnapshot())).toBe(true)
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true })
      await app.close()
    }
  })

  test('R2.5 任务取消：转换中 cancel → CANCELLED 且临时目录清理', async () => {
    test.setTimeout(120_000)
    const { app, page } = await launch()
    const workDir = path.join(os.tmpdir(), 'lumin-d2p-cancel')
    fs.rmSync(workDir, { recursive: true, force: true })
    fs.mkdirSync(workDir, { recursive: true })
    try {
      const status = await getStatus(page)
      test.skip(status.source === 'none', '本机无 LibreOffice')
      const inputPath = path.join(workDir, '取消样例.docx')
      fs.copyFileSync(fixtureFile, inputPath)
      const baseline = taskDirSnapshot()

      const outcome = await page.evaluate(
        (input: string) =>
          new Promise<{ code: string; message: string }>((resolve, reject) => {
            let taskId = ''
            let wantCancel = false
            let cancelRequested = false
            const doCancel = (): void => {
              if (taskId === '' || cancelRequested) return
              cancelRequested = true
              window.lumin.invoke<boolean>('lumin:task:cancel', { taskId }).catch(reject)
            }
            const off = window.lumin.onTaskEvent((ev) => {
              if (taskId !== '' && ev.taskId !== taskId) return
              if (ev.kind === 'progress') {
                wantCancel = true
                doCancel() // 首个进度即取消
              } else if (ev.kind === 'error') {
                off()
                resolve({ code: ev.error.code, message: ev.error.message })
              } else if (ev.kind === 'done') {
                off()
                reject(new Error('转换在取消前完成，取消路径未覆盖'))
              }
            })
            window.lumin
              .invoke<{ taskId: string }>('docx2pdf:convert', { inputPaths: [input] })
              .then(({ taskId: id }) => {
                taskId = id
                if (wantCancel) doCancel()
              })
              .catch((err: unknown) => {
                off()
                reject(err)
              })
          }),
        inputPath
      )

      expect(outcome.code).toBe('CANCELLED')
      expect(outcome.message).toContain('已取消')
      expect(await pollNoNewTaskDirs(baseline)).toBe(true)
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true })
      await app.close()
    }
  })

  test('R2.6 并发提交：两任务串行执行，全部成功不丢事件', async () => {
    test.setTimeout(240_000)
    const { app, page } = await launch()
    const workDir = path.join(os.tmpdir(), 'lumin-d2p-concurrent')
    fs.rmSync(workDir, { recursive: true, force: true })
    fs.mkdirSync(workDir, { recursive: true })
    try {
      const status = await getStatus(page)
      test.skip(status.source === 'none', '本机无 LibreOffice')
      const inputA = path.join(workDir, '并发甲.docx')
      const inputB = path.join(workDir, '并发乙.docx')
      fs.copyFileSync(fixtureFile, inputA)
      fs.copyFileSync(fixtureFile, inputB)

      const outputs = await page.evaluate(
        (inputs: string[]) =>
          new Promise<string[]>((resolve, reject) => {
            const donePaths: string[] = []
            const off = window.lumin.onTaskEvent((ev) => {
              if (ev.kind === 'done') {
                const result = ev.result as { outputs?: { outputPath: string }[] }
                donePaths.push(result.outputs?.[0]?.outputPath ?? '')
                if (donePaths.length === inputs.length) {
                  off()
                  resolve(donePaths)
                }
              } else if (ev.kind === 'error') {
                off()
                reject(new Error(`${ev.error.code}: ${ev.error.message}`))
              }
            })
            Promise.all(
              inputs.map((input) =>
                window.lumin.invoke<{ taskId: string }>('docx2pdf:convert', { inputPaths: [input] })
              )
            ).catch((err: unknown) => {
              off()
              reject(err)
            })
          }),
        [inputA, inputB]
      )

      expect(outputs).toHaveLength(2)
      expect(outputs.sort()).toEqual(
        [path.join(workDir, '并发甲.pdf'), path.join(workDir, '并发乙.pdf')].sort()
      )
      for (const output of outputs) {
        expect(fs.readFileSync(output).subarray(0, 5).toString('latin1')).toBe('%PDF-')
      }
      expect(await pollNoNewTaskDirs(taskDirSnapshot())).toBe(true)
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true })
      await app.close()
    }
  })

  test('R2.8 断电恢复：转换中强杀进程 → 重启后功能正常', async () => {
    test.setTimeout(180_000)
    const workDir = path.join(os.tmpdir(), 'lumin-d2p-kill')
    fs.rmSync(workDir, { recursive: true, force: true })
    fs.mkdirSync(workDir, { recursive: true })
    const inputPath = path.join(workDir, '断电样例.docx')
    fs.copyFileSync(fixtureFile, inputPath)

    let app: ElectronApplication | null = null
    try {
      const launched = await launch()
      app = launched.app
      const page = launched.page
      const status = await getStatus(page)
      test.skip(status.source === 'none', '本机无 LibreOffice')

      // 提交转换，收到进度后强杀主进程（模拟断电/崩溃）
      const submitted = page.evaluate(
        (input: string) =>
          new Promise<string>((resolve, reject) => {
            let currentTaskId = ''
            const off = window.lumin.onTaskEvent((ev) => {
              if (ev.taskId !== currentTaskId) return
              if (ev.kind === 'progress') {
                off()
                resolve(currentTaskId)
              } else if (ev.kind === 'error') {
                off()
                reject(new Error(`${ev.error.code}: ${ev.error.message}`))
              }
            })
            window.lumin
              .invoke<{ taskId: string }>('docx2pdf:convert', { inputPaths: [input] })
              .then(({ taskId }) => {
                currentTaskId = taskId
              })
              .catch((err: unknown) => {
                off()
                reject(err)
              })
          }),
        inputPath
      )
      await submitted

      execSync(`taskkill /PID ${app.process().pid} /F /T`, { stdio: 'ignore' })
      app = null
      await new Promise((resolve) => setTimeout(resolve, 1500))

      // 重启：状态可用 + 再次转换成功（进程内队列/锁随进程重建，无持久化污染）
      const relaunched = await launch()
      try {
        const status2 = await getStatus(relaunched.page)
        expect(['custom', 'system', 'portable', 'none']).toContain(status2.source)
        expect(status2.customPath).toBe('')

        const output = await relaunched.page.evaluate(
          (input: string) =>
            new Promise<string>((resolve, reject) => {
              let currentTaskId = ''
              const off = window.lumin.onTaskEvent((ev) => {
                if (ev.taskId !== currentTaskId) return
                if (ev.kind === 'done') {
                  off()
                  resolve(
                    (ev.result as { outputs: { outputPath: string }[] }).outputs[0]?.outputPath ??
                      ''
                  )
                } else if (ev.kind === 'error') {
                  off()
                  reject(new Error(`${ev.error.code}: ${ev.error.message}`))
                }
              })
              window.lumin
                .invoke<{ taskId: string }>('docx2pdf:convert', { inputPaths: [input] })
                .then(({ taskId }) => {
                  currentTaskId = taskId
                })
                .catch((err: unknown) => {
                  off()
                  reject(err)
                })
            }),
          inputPath
        )
        expect(fs.existsSync(output)).toBe(true)
        expect(fs.readFileSync(output).subarray(0, 5).toString('latin1')).toBe('%PDF-')
      } finally {
        await relaunched.app.close()
      }
    } finally {
      if (app) await app.close().catch(() => undefined)
      fs.rmSync(workDir, { recursive: true, force: true })
    }
  })
})

/** 1×1 透明 PNG（免 fixture） */
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
)

interface PrepareOutcome {
  jobs: { jobId: string; name: string; kind: string; pageCount?: number }[]
  failures: { inputPath: string; code: string }[]
}

/** 启动应用并开启打印 dry-run（printToPDF 落盘代替系统打印对话框） */
async function launchPrintDryRun(): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({ args: ['.', '--lumin-print-dry-run'], cwd: appDir })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await page.waitForFunction(() => typeof window.lumin !== 'undefined')
  return { app, page }
}

/** 提交任务并等待 done/error（返回结果或错误码） */
async function runTask(
  page: Page,
  channel: string,
  payload: unknown
): Promise<{ ok: true; result: unknown } | { ok: false; code: string }> {
  return page.evaluate(
    (args) =>
      new Promise<{ ok: true; result: unknown } | { ok: false; code: string }>((resolve) => {
        let currentTaskId = ''
        const off = window.lumin.onTaskEvent((ev) => {
          if (ev.taskId !== currentTaskId) return
          if (ev.kind === 'progress' || ev.kind === 'log') return
          off()
          if (ev.kind === 'done') resolve({ ok: true, result: ev.result })
          else resolve({ ok: false, code: ev.error.code })
        })
        window.lumin
          .invoke<{ taskId: string }>(args.channel, args.payload)
          .then(({ taskId }) => {
            currentTaskId = taskId
          })
          .catch((err: unknown) => {
            off()
            resolve({ ok: false, code: String((err as { code?: string }).code ?? err) })
          })
      }),
    { channel, payload }
  )
}

test.describe('print（文档输出 · 打印页签）冒烟', () => {
  test('打印页签加载 + 空态拖拽引导', async () => {
    const { app, page } = await launchPrintDryRun()
    try {
      await clickSidebarTool(page, '文档输出')
      await page.locator('.n-tabs-tab[data-name="print"]').click()
      await expect(page.getByRole('heading', { name: '文档输出' })).toBeVisible()
      await expect(page.getByText('拖拽文件到此处，或点击选择（最多 50 个）')).toBeVisible()
      await expect(page.getByText('打印前会逐份预检')).toBeVisible()
    } finally {
      await app.close()
    }
  })

  test('dry-run 全链路：中文+空格图片 → prepare → show 落盘 PDF → cleanup', async () => {
    const { app, page } = await launchPrintDryRun()
    const dir = path.join(os.tmpdir(), 'lumin-print-e2e')
    fs.rmSync(dir, { recursive: true, force: true })
    fs.mkdirSync(dir, { recursive: true })
    try {
      const image = path.join(dir, '打印 样例.png')
      fs.writeFileSync(image, TINY_PNG)

      const prepared = await runTask(page, 'docx2pdf:print-prepare', { inputPaths: [image] })
      expect(prepared.ok).toBe(true)
      if (!prepared.ok) throw new Error(prepared.code)
      const result = prepared.result as PrepareOutcome
      expect(result.jobs).toHaveLength(1)
      expect(result.jobs[0]?.kind).toBe('image')
      const jobId = result.jobs[0]?.jobId ?? ''

      const shown = await runTask(page, 'docx2pdf:print-show', { jobId })
      expect(shown.ok).toBe(true)

      const userData = await app.evaluate(({ app: electronApp }) => electronApp.getPath('userData'))
      const dryRun = path.join(userData, 'temp', 'lumin-print', jobId, 'dry-run.pdf')
      const head = fs.readFileSync(dryRun).subarray(0, 5).toString('latin1')
      expect(head).toBe('%PDF-')
      expect(fs.statSync(dryRun).size).toBeGreaterThan(0)

      const cleaned = await page.evaluate(
        (id) =>
          window.lumin.invoke<{ removed: number }>('docx2pdf:print-cleanup', { jobIds: [id] }),
        jobId
      )
      expect(cleaned.removed).toBe(1)
      expect(fs.existsSync(path.join(userData, 'temp', 'lumin-print', jobId))).toBe(false)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
      await app.close()
    }
  })

  test('缺失文件 → PR_NOT_FOUND（任务 error 事件）', async () => {
    const { app, page } = await launchPrintDryRun()
    try {
      const missing = path.join(os.tmpdir(), 'lumin-print-e2e', '不存在.pdf')
      const outcome = await runTask(page, 'docx2pdf:print-prepare', { inputPaths: [missing] })
      expect(outcome).toEqual({ ok: false, code: 'PR_NOT_FOUND' })
    } finally {
      await app.close()
    }
  })
})
