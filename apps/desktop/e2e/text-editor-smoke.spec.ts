/**
 * @file text-editor（文本编辑器）e2e 冒烟：真实 Electron + 真实主进程
 * @author cuilanchao
 * @date 2026-11-22
 * @description 覆盖：UI 打开→编辑→未保存离开确认；UTF-8/CRLF 保存、GBK 往返、
 *              只读保存失败、超限、mtime 冲突与 force、save-as 已存在成功/失败、
 *              二进制拒绝、中文/空格路径。前置：pnpm -F @lumin/desktop build。
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
const MAX_BYTES = 5 * 1024 * 1024

interface OpenResult {
  path: string
  name: string
  size: number
  mtimeMs: number
  content: string
  encoding: string
  eol: string
  readOnly: boolean
}

interface SaveResult {
  mtimeMs: number
}

interface SaveAsResult {
  path: string
  mtimeMs: number
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
    ({ channel, payload }) =>
      window.lumin.invoke(channel, payload) as Promise<unknown>,
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

test.describe('text-editor（文本编辑器）冒烟', () => {
  test('UI：打开文件 → 编辑 → 侧栏切换触发未保存确认 → 放弃更改', async () => {
    const { app, page } = await launch()
    const workDir = freshDir('lumin-te-e2e-ui')
    try {
      const file = path.join(workDir, '说明 文档.txt')
      fs.writeFileSync(file, '第一行\n第二行\n', 'utf8')

      await clickSidebarTool(page, '文本编辑器')
      await expect(page.getByText('拖拽文本文件到此处，或点击选择')).toBeVisible()

      // Electron webUtils 解析 input 的 File 路径
      await page.locator('input[type="file"]').setInputFiles(file)
      const content = page.locator('.cm-content')
      await expect(content).toBeVisible()
      await expect(content).toContainText('第一行')

      await content.click()
      await page.keyboard.type('XYZ')

      // 切换侧栏其他工具 → 路由守卫弹确认框
      await clickSidebarTool(page, '计算器')
      await expect(page.getByText('有未保存的更改', { exact: true })).toBeVisible()
      await page.getByRole('button', { name: '放弃更改', exact: true }).click()
      await expect(page).toHaveURL(/tools\/calculator/)

      // 放弃后磁盘内容未变
      expect(fs.readFileSync(file, 'utf8')).toBe('第一行\n第二行\n')
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true })
      await app.close()
    }
  })

  test('IPC：UTF-8 默认 LF，保存为 CRLF 后磁盘字节与重新打开一致', async () => {
    const { app, page } = await launch()
    const workDir = freshDir('lumin-te-e2e-crlf')
    try {
      const file = path.join(workDir, '换行.txt')
      fs.writeFileSync(file, 'a\nb', 'utf8')
      const opened = await invoke<OpenResult>(page, 'text-editor:open', { path: file })
      expect(opened.encoding).toBe('utf8')
      expect(opened.eol).toBe('lf')
      expect(opened.readOnly).toBe(false)

      const saved = await invoke<SaveResult>(page, 'text-editor:save', {
        path: file,
        content: 'a\nb',
        encoding: 'utf8',
        eol: 'crlf',
        expectedMtimeMs: opened.mtimeMs
      })
      expect(typeof saved.mtimeMs).toBe('number')
      expect(fs.readFileSync(file).equals(Buffer.from('a\r\nb', 'utf8'))).toBe(true)

      const reopened = await invoke<OpenResult>(page, 'text-editor:open', { path: file })
      expect(reopened.eol).toBe('crlf')
      expect(reopened.content).toBe('a\r\nb')
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true })
      await app.close()
    }
  })

  test('IPC：GBK 打开后按原编码保存，字节完全一致', async () => {
    const { app, page } = await launch()
    const workDir = freshDir('lumin-te-e2e-gbk')
    try {
      const gbk = Buffer.from([0xd6, 0xd0, 0xce, 0xc4, 0x0a])
      const file = path.join(workDir, '国标.txt')
      fs.writeFileSync(file, gbk)

      const opened = await invoke<OpenResult>(page, 'text-editor:open', { path: file })
      expect(opened.encoding).toBe('gbk')
      expect(opened.content).toBe('中文\n')

      await invoke<SaveResult>(page, 'text-editor:save', {
        path: file,
        content: opened.content,
        encoding: 'gbk',
        eol: 'lf'
      })
      expect(fs.readFileSync(file).equals(gbk)).toBe(true)
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true })
      await app.close()
    }
  })

  test('IPC：只读文件（chmod 0444）保存失败 TE_SAVE_FAILED', async () => {
    const { app, page } = await launch()
    const workDir = freshDir('lumin-te-e2e-readonly')
    try {
      const file = path.join(workDir, '只读.txt')
      fs.writeFileSync(file, 'locked', 'utf8')
      fs.chmodSync(file, 0o444)

      const opened = await invoke<OpenResult>(page, 'text-editor:open', { path: file })
      expect(opened.content).toBe('locked')

      const error = await invokeError(page, 'text-editor:save', {
        path: file,
        content: 'next',
        encoding: 'utf8',
        eol: 'lf'
      })
      expect(error.code).toBe('TE_SAVE_FAILED')

      fs.chmodSync(file, 0o666)
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true })
      await app.close()
    }
  })

  test('IPC：超过 5 MiB → TE_TOO_LARGE（detail 为字节数）', async () => {
    const { app, page } = await launch()
    const workDir = freshDir('lumin-te-e2e-large')
    try {
      const file = path.join(workDir, '大文件.txt')
      fs.writeFileSync(file, Buffer.alloc(MAX_BYTES + 1, 0x61))
      const error = await invokeError(page, 'text-editor:open', { path: file })
      expect(error.code).toBe('TE_TOO_LARGE')
      expect(error.detail).toBe(String(MAX_BYTES + 1))
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true })
      await app.close()
    }
  })

  test('IPC：mtime 冲突 → TE_FILE_CHANGED，force 覆盖成功', async () => {
    const { app, page } = await launch()
    const workDir = freshDir('lumin-te-e2e-mtime')
    try {
      const file = path.join(workDir, '冲突.txt')
      fs.writeFileSync(file, 'old', 'utf8')
      const opened = await invoke<OpenResult>(page, 'text-editor:open', { path: file })
      const future = new Date(Date.now() + 60_000)
      fs.utimesSync(file, future, future)

      const conflict = await invokeError(page, 'text-editor:save', {
        path: file,
        content: 'next',
        encoding: 'utf8',
        eol: 'lf',
        expectedMtimeMs: opened.mtimeMs
      })
      expect(conflict.code).toBe('TE_FILE_CHANGED')

      const forced = await invoke<SaveResult>(page, 'text-editor:save', {
        path: file,
        content: 'next',
        encoding: 'utf8',
        eol: 'lf',
        expectedMtimeMs: opened.mtimeMs,
        force: true
      })
      expect(typeof forced.mtimeMs).toBe('number')
      expect(fs.readFileSync(file, 'utf8')).toBe('next')
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true })
      await app.close()
    }
  })

  test('IPC：save-as 已存在 → TE_FILE_EXISTS；新文件成功写入', async () => {
    const { app, page } = await launch()
    const workDir = freshDir('lumin-te-e2e-saveas')
    try {
      const existing = path.join(workDir, 'same.txt')
      fs.writeFileSync(existing, 'old', 'utf8')
      const conflict = await invokeError(page, 'text-editor:save-as', {
        dir: workDir,
        name: 'same.txt',
        content: 'new',
        encoding: 'utf8',
        eol: 'lf'
      })
      expect(conflict.code).toBe('TE_FILE_EXISTS')

      const created = await invoke<SaveAsResult>(page, 'text-editor:save-as', {
        dir: workDir,
        name: '新 文件.txt',
        content: 'x\ny',
        encoding: 'utf8',
        eol: 'crlf'
      })
      expect(created.path).toBe(path.join(workDir, '新 文件.txt'))
      expect(fs.readFileSync(created.path, 'utf8')).toBe('x\r\ny')
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true })
      await app.close()
    }
  })

  test('IPC：二进制/缺失/目录/非法 name 的错误码', async () => {
    const { app, page } = await launch()
    const workDir = freshDir('lumin-te-e2e-errors')
    try {
      const bin = path.join(workDir, '二进制.bin')
      fs.writeFileSync(bin, Buffer.from([0x41, 0x00, 0x42]))
      expect((await invokeError(page, 'text-editor:open', { path: bin })).code).toBe(
        'TE_DECODE_FAILED'
      )

      expect(
        (await invokeError(page, 'text-editor:open', { path: path.join(workDir, '缺失.txt') }))
          .code
      ).toBe('TE_NOT_FOUND')

      const dir = path.join(workDir, '目录')
      fs.mkdirSync(dir)
      expect((await invokeError(page, 'text-editor:open', { path: dir })).code).toBe(
        'TE_INVALID_PATH'
      )

      expect(
        (
          await invokeError(page, 'text-editor:save-as', {
            dir: 'relative',
            name: 'a.txt',
            content: 'x',
            encoding: 'utf8',
            eol: 'lf'
          })
        ).code
      ).toBe('TE_INVALID_PATH')

      expect(
        (
          await invokeError(page, 'text-editor:save-as', {
            dir: workDir,
            name: 'a/b.txt',
            content: 'x',
            encoding: 'utf8',
            eol: 'lf'
          })
        ).code
      ).toBe('TE_INVALID_PATH')
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true })
      await app.close()
    }
  })

  test('IPC：中文/空格路径 + UTF-8 BOM 往返', async () => {
    const { app, page } = await launch()
    const workDir = freshDir('lumin-te-e2e-cn-path')
    try {
      const dir = path.join(workDir, '中文 目录')
      fs.mkdirSync(dir, { recursive: true })
      const file = path.join(dir, '说明 文档.txt')
      fs.writeFileSync(
        file,
        Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('标题\r\n正文', 'utf8')])
      )

      const opened = await invoke<OpenResult>(page, 'text-editor:open', { path: file })
      expect(opened.encoding).toBe('utf8-bom')
      expect(opened.eol).toBe('crlf')
      expect(opened.content).toBe('标题\r\n正文')
      expect(opened.name).toBe('说明 文档.txt')

      await invoke<SaveResult>(page, 'text-editor:save', {
        path: file,
        content: opened.content,
        encoding: 'utf8-bom',
        eol: 'crlf',
        expectedMtimeMs: opened.mtimeMs
      })
      const bytes = fs.readFileSync(file)
      expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
      expect(bytes.equals(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('标题\r\n正文', 'utf8')]))).toBe(
        true
      )
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true })
      await app.close()
    }
  })
})
