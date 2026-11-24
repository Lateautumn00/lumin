/**
 * @file mindmap（思维导图）e2e 冒烟：真实 Electron + 真实主进程
 * @author cuilanchao
 * @date 2026-11-24
 * @description 覆盖：空态新建→双击编辑→保存落盘；导入 Markdown→导出 MD/JSON；
 *              PNG 导出；草稿恢复与损坏提示；IPC 错误码与 mtime 冲突/force。
 *              前置：pnpm -F @lumin/desktop build。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
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

interface ErrorShape {
  code: string
  message: string
  detail?: string
}

interface SaveResult {
  path: string
  mtimeMs: number
  warnings: string[]
}

async function launch(): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({ args: ['.'], cwd: appDir })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await page.waitForFunction(() => typeof window.lumin !== 'undefined')
  return { app, page }
}

/** 新建测试工作目录 */
function freshDir(name: string): string {
  const dir = path.join(os.tmpdir(), name)
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

/** userData 下的草稿目录 */
async function draftDir(app: ElectronApplication): Promise<string> {
  const userData = await app.evaluate(({ app: electronApp }) => electronApp.getPath('userData'))
  return path.join(userData, 'mindmap')
}

/** 清理草稿，避免跨用例串扰 */
async function clearDrafts(app: ElectronApplication): Promise<void> {
  fs.rmSync(await draftDir(app), { recursive: true, force: true })
}

/** 同步通道 invoke */
function invoke<T>(page: Page, channel: string, payload: unknown): Promise<T> {
  return page.evaluate(
    ({ channel, payload }) => window.lumin.invoke(channel, payload) as Promise<unknown>,
    { channel, payload }
  ) as Promise<T>
}

/** 期望通道报错并返回结构化错误 */
async function invokeError(page: Page, channel: string, payload: unknown): Promise<ErrorShape> {
  return page.evaluate(
    ({ channel, payload }) =>
      window.lumin
        .invoke(channel, payload)
        .then(() => ({ code: 'UNEXPECTED_SUCCESS', message: '' }))
        .catch((err: unknown) => {
          const structured = err as Partial<ErrorShape>
          return {
            code: structured.code ?? 'UNKNOWN',
            message: structured.message ?? String(err),
            detail: structured.detail
          }
        }),
    { channel, payload }
  )
}

/** 主进程侧回填保存对话框 */
async function stubSavePath(app: ElectronApplication, filePath: string): Promise<void> {
  await app.evaluate(({ dialog }, target: string) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: target })
  }, filePath)
}

/** 等待文件出现并返回内容 */
async function readEventually(filePath: string): Promise<string> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (fs.existsSync(filePath)) return fs.readFileSync(filePath, 'utf8')
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`file not created: ${filePath}`)
}

test.describe('mindmap（思维导图）冒烟', () => {
  test('UI：空态新建 → 编辑节点 → 保存 JSON 落盘', async () => {
    const { app, page } = await launch()
    const workDir = freshDir('lumin-mm-e2e-ui')
    try {
      await clearDrafts(app)
      await clickSidebarTool(page, '思维导图')
      await expect(page.getByTestId('mindmap-topic-input')).toBeVisible()
      await page.getByTestId('mindmap-topic-input').locator('input').fill('项目计划')
      await page.getByTestId('mindmap-create').click()

      const topics = page.locator('.me-tpc')
      await expect(topics.first()).toBeVisible()
      await expect(topics.first()).toContainText('项目计划')

      // mind-elixir 双击判定为 0 < Δt < 300ms 且两次 pointerup 命中同一元素；
      // 加上 delay 避免两次点击落在同一毫秒（Δt=0 会被判定为非双击）
      const editor = page.locator('#input-box')
      for (let attempt = 0; attempt < 3 && (await editor.count()) === 0; attempt += 1) {
        await topics.first().dblclick({ delay: 60 })
        if ((await editor.count()) === 0) await page.waitForTimeout(300)
      }
      await expect(editor).toBeVisible()
      await editor.fill('v2')
      await editor.press('Enter')
      await expect(page.locator('.me-tpc').filter({ hasText: 'v2' }).first()).toBeVisible()

      const target = path.join(workDir, '项目 计划.json')
      await stubSavePath(app, target)
      await page.getByTestId('mindmap-save').click()

      const raw = await readEventually(target)
      const doc = JSON.parse(raw) as { nodeData: { topic: string } }
      expect(raw).toContain('v2')
      expect(doc.nodeData.topic.length).toBeGreaterThan(0)
    } finally {
      // 脏状态会触发 beforeunload 拦截关闭：先导航离开工具页
      await clickSidebarTool(page, '计算器').catch(() => undefined)
      await expect(page.getByTestId('mindmap-stage')).toHaveCount(0)
      fs.rmSync(workDir, { recursive: true, force: true })
      await clearDrafts(app)
      await app.close()
    }
  })

  test('UI：导入 Markdown → 导出 Markdown 与 JSON', async () => {
    const { app, page } = await launch()
    const workDir = freshDir('lumin-mm-e2e-import')
    try {
      await clearDrafts(app)
      await clickSidebarTool(page, '思维导图')
      await expect(page.getByTestId('mindmap-topic-input')).toBeVisible()

      const source = path.join(workDir, '大纲 文件.md')
      fs.writeFileSync(source, '# 根主题\n## 子主题A\n- 细节\n', 'utf8')

      // 绕过 Electron 原生选择框：拦截 input.click，再由 Playwright 注入文件并触发 change
      await page.evaluate(() => {
        HTMLInputElement.prototype.click = function noopClick(): void {
          // 测试注入：阻止原生文件选择框
        }
      })
      await page.getByRole('button', { name: '导入 Markdown' }).click()
      await page.locator('input[type="file"]').setInputFiles(source)
      await expect(page.locator('.me-tpc').filter({ hasText: '根主题' }).first()).toBeVisible()

      const mdOut = path.join(workDir, '导出.md')
      await stubSavePath(app, mdOut)
      await page.getByTestId('mindmap-export-md').click()
      const md = await readEventually(mdOut)
      expect(md).toContain('# 根主题')
      expect(md).toContain('## 子主题A')

      const jsonOut = path.join(workDir, '导出.json')
      await stubSavePath(app, jsonOut)
      await page.getByTestId('mindmap-export-json').click()
      const json = await readEventually(jsonOut)
      expect(JSON.parse(json)).toMatchObject({ nodeData: { topic: '根主题' } })
    } finally {
      await clickSidebarTool(page, '计算器').catch(() => undefined)
      await expect(page.getByTestId('mindmap-stage')).toHaveCount(0)
      fs.rmSync(workDir, { recursive: true, force: true })
      await clearDrafts(app)
      await app.close()
    }
  })

  test('UI：PNG 导出生成合法文件头', async () => {
    test.setTimeout(120_000)
    const { app, page } = await launch()
    const workDir = freshDir('lumin-mm-e2e-png')
    try {
      await clearDrafts(app)
      await clickSidebarTool(page, '思维导图')
      await page.getByTestId('mindmap-topic-input').locator('input').fill('图片导出')
      await page.getByTestId('mindmap-create').click()
      await expect(page.locator('.me-tpc').first()).toBeVisible()

      const target = path.join(workDir, '导图.png')
      await stubSavePath(app, target)
      await page.getByTestId('mindmap-export-image').click()
      await expect(page.getByTestId('mindmap-image-modal')).toBeVisible()
      await page.getByTestId('mindmap-image-confirm').click()

      let outcome = 'waiting'
      const deadline = Date.now() + 60_000
      while (Date.now() < deadline) {
        if (fs.existsSync(target)) {
          outcome = 'file'
          break
        }
        const error = page.getByTestId('mindmap-error')
        if ((await error.count()) > 0) {
          outcome = `error:${await error.innerText()}`
          break
        }
        const notice = page.getByTestId('mindmap-notice')
        if ((await notice.count()) > 0) {
          outcome = `notice:${await notice.innerText()}`
          break
        }
        await page.waitForTimeout(200)
      }
      expect(outcome, 'PNG 导出结果').toBe('file')
      const bytes = fs.readFileSync(target)
      expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true })
      await clickSidebarTool(page, '计算器').catch(() => undefined)
      await clearDrafts(app)
      await app.close()
    }
  })

  test('UI：草稿恢复提示与损坏提示', async () => {
    const first = await launch()
    try {
      const dir = await draftDir(first.app)
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(
        path.join(dir, 'draft.json'),
        JSON.stringify({
          savedAt: '2026-11-24T00:00:00.000Z',
          data: { nodeData: { id: 'draft-root', topic: '草稿主题' } }
        }),
        'utf8'
      )

      await clickSidebarTool(first.page, '思维导图')
      await expect(first.page.getByTestId('mindmap-draft-alert')).toBeVisible()
      await first.page.getByTestId('mindmap-draft-recover').click()
      await expect(
        first.page.locator('.me-tpc').filter({ hasText: '草稿主题' }).first()
      ).toBeVisible()

      // 离开页面卸载组件（移除 beforeunload），再清理草稿
      await clickSidebarTool(first.page, '计算器')
      await expect(first.page.getByTestId('mindmap-stage')).toHaveCount(0)
    } finally {
      await clearDrafts(first.app)
      await first.app.close()
    }

    // 全新启动并写入损坏草稿，验证损坏提示
    const second = await launch()
    try {
      const dir = await draftDir(second.app)
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(path.join(dir, 'draft.json'), '{oops', 'utf8')
      await clickSidebarTool(second.page, '思维导图')
      await expect(second.page.getByTestId('mindmap-draft-corrupt')).toBeVisible()
    } finally {
      await clearDrafts(second.app)
      await second.app.close()
    }
  })

  test('IPC：错误码、mtime 冲突/force 与草稿三通道', async () => {
    const { app, page } = await launch()
    const workDir = freshDir('lumin-mm-e2e-ipc')
    try {
      await clearDrafts(app)
      const doc = { nodeData: { id: 'root', topic: '根' } }

      expect(
        (
          await invokeError(page, 'mindmap:open-document', {
            path: path.join(workDir, '缺失.json')
          })
        ).code
      ).toBe('MM_NOT_FOUND')

      const broken = path.join(workDir, '损坏.json')
      fs.writeFileSync(broken, '{oops', 'utf8')
      expect((await invokeError(page, 'mindmap:open-document', { path: broken })).code).toBe(
        'MM_INVALID_DOCUMENT'
      )

      const target = path.join(workDir, '导图 文件.json')
      const saved = await invoke<SaveResult>(page, 'mindmap:save-document', {
        path: target,
        data: doc
      })
      expect(saved.path).toBe(target)
      expect(typeof saved.mtimeMs).toBe('number')

      const future = new Date(Date.now() + 60_000)
      fs.utimesSync(target, future, future)
      expect(
        (
          await invokeError(page, 'mindmap:save-document', {
            path: target,
            data: doc,
            expectedMtimeMs: saved.mtimeMs
          })
        ).code
      ).toBe('MM_FILE_CHANGED')
      await expect(
        invoke<SaveResult>(page, 'mindmap:save-document', {
          path: target,
          data: doc,
          expectedMtimeMs: saved.mtimeMs,
          force: true
        })
      ).resolves.toMatchObject({ path: target })

      expect(
        (
          await invokeError(page, 'mindmap:write-export', {
            path: path.join(workDir, 'bad.exe'),
            text: 'x'
          })
        ).code
      ).toBe('MM_INVALID_PATH')

      await invoke(page, 'mindmap:save-draft', { data: doc, documentPath: target })
      await expect(
        invoke<{ status: string }>(page, 'mindmap:load-draft', {})
      ).resolves.toMatchObject({
        status: 'ok',
        data: doc
      })
      await expect(invoke<Record<string, never>>(page, 'mindmap:clear-draft', {})).resolves.toEqual(
        {}
      )
      await expect(invoke<{ status: string }>(page, 'mindmap:load-draft', {})).resolves.toEqual({
        status: 'empty'
      })
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true })
      await clearDrafts(app)
      await app.close()
    }
  })
})
