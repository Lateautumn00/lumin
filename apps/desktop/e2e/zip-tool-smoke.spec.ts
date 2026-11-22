/**
 * @file zip-tool（压缩包工具）e2e 冒烟：真实 Electron + 真实磁盘目录
 * @author cuilanchao
 * @date 2026-11-20
 * @description 覆盖：页面加载/打包空态、UI 打包产物落盘、UI 解压回读、
 *              IPC zip slip 跳过与计数、GBK 条目名转码落盘、非法 zip（ZP_ARCHIVE_INVALID）。
 *              注意：临时目录名必须 ASCII（非 ASCII 目录名会导致本机 Node fs 硬崩），文件名保留中文。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import { clickSidebarTool } from './sidebar'
import type { LuminBridge } from '@lumin/plugin-api'

declare global {
  interface Window {
    lumin: LuminBridge
  }
}

type Page = Awaited<ReturnType<ElectronApplication['firstWindow']>>

const appDir = path.resolve(__dirname, '..')

interface PackResult {
  outputZip: string
  files: number
  dirs: number
  bytes: number
  elapsedMs: number
}

interface UnpackResult {
  targetDir: string
  files: number
  dirs: number
  bytes: number
  skipped: number
  renamed: number
  elapsedMs: number
}

async function launch(): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({ args: ['.'], cwd: appDir })
  const page = await app.firstWindow()
  return { app, page }
}

/** 等待壳渲染层就绪（firstWindow 早于 bridge 注入时 evaluate 会丢失上下文） */
async function ensureReady(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded')
  await page.waitForFunction(() => typeof window.lumin !== 'undefined')
}

/** 造目录并清空 */
function freshDir(name: string): string {
  const dir = path.join(os.tmpdir(), name)
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

/** 写文件（自动建父目录） */
function writeFile(root: string, rel: string, content: string): void {
  const target = path.join(root, rel)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, content)
}

/** 手工构造 stored（无压缩）zip，用于注入 zip slip 条目 */
function storedZip(entries: { name: string; content: string }[]): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8')
    const data = Buffer.from(entry.content, 'utf8')
    const crc = zlib.crc32(data)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6)
    local.writeUInt16LE(0, 8)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(name.length, 26)
    locals.push(local, name, data)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(0x031e, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(0, 10)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, name)

    offset += 30 + name.length + data.length
  }
  const cd = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(cd.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, cd, eocd])
}

/** 手工构造单条目 stored zip（原始名字节 + 指定通用标志位，用于 GBK 名） */
function storedZipRawName(name: Buffer, content: string, flags: number): Buffer {
  const data = Buffer.from(content, 'utf8')
  const crc = zlib.crc32(data)

  const local = Buffer.alloc(30)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(20, 4)
  local.writeUInt16LE(flags, 6)
  local.writeUInt16LE(0, 8)
  local.writeUInt32LE(crc, 14)
  local.writeUInt32LE(data.length, 18)
  local.writeUInt32LE(data.length, 22)
  local.writeUInt16LE(name.length, 26)

  const central = Buffer.alloc(46)
  central.writeUInt32LE(0x02014b50, 0)
  central.writeUInt16LE(0x031e, 4)
  central.writeUInt16LE(20, 6)
  central.writeUInt16LE(flags, 8)
  central.writeUInt16LE(0, 10)
  central.writeUInt32LE(crc, 16)
  central.writeUInt32LE(data.length, 20)
  central.writeUInt32LE(data.length, 24)
  central.writeUInt16LE(name.length, 28)
  central.writeUInt32LE((0o100644 << 16) >>> 0, 38)
  central.writeUInt32LE(0, 42)

  const centralOffset = local.length + name.length + data.length
  const centralSize = central.length + name.length
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(1, 8)
  eocd.writeUInt16LE(1, 10)
  eocd.writeUInt32LE(centralSize, 12)
  eocd.writeUInt32LE(centralOffset, 16)
  return Buffer.concat([local, name, data, central, name, eocd])
}

/** 通过 IPC 跑任务并等待终态（done 返回结果；error 返回错误码） */
async function runTask(
  page: Page,
  channel: string,
  payload: unknown
): Promise<{ hasProgress: boolean; result?: unknown; errorCode?: string }> {
  return page.evaluate(
    (args: { channel: string; payload: unknown }) =>
      new Promise<{ hasProgress: boolean; result?: unknown; errorCode?: string }>(
        (resolve, reject) => {
          let hasProgress = false
          let taskId = ''
          const off = window.lumin.onTaskEvent((event) => {
            if (event.taskId !== taskId) return
            if (event.kind === 'progress') {
              hasProgress = true
            } else if (event.kind === 'done') {
              off()
              resolve({ hasProgress, result: event.result })
            } else if (event.kind === 'error') {
              off()
              resolve({ hasProgress, errorCode: event.error.code })
            }
          })
          window.lumin
            .invoke<{ taskId: string }>(args.channel, args.payload as never)
            .then((value) => {
              taskId = value.taskId
            })
            .catch((err: unknown) => {
              off()
              reject(err)
            })
        }
      ),
    { channel, payload }
  )
}

test.describe('zip-tool（压缩包工具）冒烟', () => {
  test('UI：打包空态 → 打包产物落盘 → 解压回读', async () => {
    const { app, page } = await launch()
    await ensureReady(page)
    const root = freshDir('lumin-zip-e2e-ui')
    const outDir = path.join(root, 'out')
    const unpackDir = path.join(root, 'unpacked')
    const source = path.join(root, '素材.txt')
    try {
      writeFile(root, '素材.txt', '压缩包内容')
      fs.mkdirSync(outDir, { recursive: true })

      await page.evaluate(() =>
        window.lumin.invoke('zip-tool:set-config', {
          mode: 'pack',
          packSources: [],
          outputDir: null,
          outputName: null,
          archive: null,
          targetDir: null,
          conflict: 'rename'
        })
      )
      await clickSidebarTool(page, '压缩包工具')
      await expect(page.getByRole('heading', { name: '压缩包工具' })).toBeVisible()
      await expect(
        page.getByText('添加文件或文件夹后点击「开始打包」；目录会保留相对结构')
      ).toBeVisible()
      await expect(page.getByRole('button', { name: '开始打包' })).toBeDisabled()

      // 预置记忆后重新进入页面触达 mounted 读取
      await page.evaluate(
        (args: { source: string; outDir: string }) =>
          window.lumin.invoke('zip-tool:set-config', {
            mode: 'pack',
            packSources: [args.source],
            outputDir: args.outDir,
            outputName: 'UI产物.zip',
            archive: null,
            targetDir: null,
            conflict: 'rename'
          }),
        { source, outDir }
      )
      await clickSidebarTool(page, '计算器')
      await clickSidebarTool(page, '压缩包工具')
      await expect(page.getByText('素材.txt', { exact: true })).toBeVisible()

      await page.getByRole('button', { name: '开始打包' }).click()
      const zipPath = path.join(outDir, 'UI产物.zip')
      await expect(page.getByText(`已生成 ${zipPath}`)).toBeVisible({ timeout: 30_000 })
      expect(fs.existsSync(zipPath)).toBe(true)

      // 解压：记忆 archive/targetDir 后进入解压 Tab
      await page.evaluate(
        (args: { archive: string; targetDir: string }) =>
          window.lumin.invoke('zip-tool:set-config', {
            mode: 'unpack',
            packSources: [],
            outputDir: null,
            outputName: null,
            archive: args.archive,
            targetDir: args.targetDir,
            conflict: 'rename'
          }),
        { archive: zipPath, targetDir: unpackDir }
      )
      await clickSidebarTool(page, '计算器')
      await clickSidebarTool(page, '压缩包工具')
      await expect(page.getByText('已解压到', { exact: false })).toHaveCount(0)
      await page.getByRole('button', { name: '开始解压' }).click()
      await expect(page.getByText(`已解压到 ${unpackDir}`)).toBeVisible({ timeout: 30_000 })
      expect(fs.readFileSync(path.join(unpackDir, '素材.txt'), 'utf8')).toBe('压缩包内容')
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
      await app.close()
    }
  })

  test('IPC：GBK 条目名 zip 解压 → 中文名无乱码且落盘', async () => {
    const { app, page } = await launch()
    await ensureReady(page)
    const root = freshDir('lumin-zip-e2e-gbk')
    const targetDir = path.join(root, 'gbk-out')
    try {
      // GBK：测 B2E2、试 CAD4；bit11 未置位
      const gbkName = Buffer.from([0xb2, 0xe2, 0xca, 0xd4, 0x2e, 0x74, 0x78, 0x74])
      const archive = path.join(root, 'gbk.zip')
      fs.writeFileSync(archive, storedZipRawName(gbkName, 'GBK 内容', 0))

      const outcome = await runTask(page, 'zip-tool:unpack', {
        archive,
        targetDir,
        conflict: 'rename'
      })
      expect(outcome.errorCode).toBeUndefined()
      expect(outcome.result).toMatchObject({ files: 1, skipped: 0, renamed: 0 })
      expect(fs.readFileSync(path.join(targetDir, '测试.txt'), 'utf8')).toBe('GBK 内容')
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
      await app.close()
    }
  })

  test('IPC：zip slip 条目跳过计数 + 非法 zip → ZP_ARCHIVE_INVALID', async () => {
    const { app, page } = await launch()
    await ensureReady(page)
    const root = freshDir('lumin-zip-e2e-ipc')
    const targetDir = path.join(root, 'slip-target')
    try {
      const evilZip = path.join(root, 'evil.zip')
      fs.writeFileSync(
        evilZip,
        storedZip([
          { name: '../越界.txt', content: 'evil' },
          { name: '/绝对.txt', content: 'evil' },
          { name: 'C:/盘符.txt', content: 'evil' },
          { name: '正常.txt', content: 'ok' }
        ])
      )

      const slipped = await runTask(page, 'zip-tool:unpack', {
        archive: evilZip,
        targetDir,
        conflict: 'rename'
      })
      expect(slipped.errorCode).toBeUndefined()
      expect(slipped.result).toMatchObject({ files: 1, skipped: 3, renamed: 0 })
      expect(fs.readFileSync(path.join(targetDir, '正常.txt'), 'utf8')).toBe('ok')
      expect(fs.existsSync(path.join(root, '越界.txt'))).toBe(false)

      // 打包 → 解压闭环
      const source = path.join(root, '往返.txt')
      fs.writeFileSync(source, '往返内容')
      const packed = await runTask(page, 'zip-tool:pack', {
        sources: [source],
        outputDir: root,
        outputName: '往返.zip'
      })
      const packResult = packed.result as PackResult
      expect(packed.hasProgress).toBe(true)
      expect(packResult).toMatchObject({ files: 1, dirs: 0 })
      const unpacked = await runTask(page, 'zip-tool:unpack', {
        archive: packResult.outputZip,
        targetDir: path.join(root, '往返解压'),
        conflict: 'skip'
      })
      expect(unpacked.result as UnpackResult).toMatchObject({ files: 1, skipped: 0 })
      expect(fs.readFileSync(path.join(root, '往返解压', '往返.txt'), 'utf8')).toBe('往返内容')

      // 非法 zip：文本伪装 .zip
      const junk = path.join(root, 'junk.zip')
      fs.writeFileSync(junk, '这不是压缩包')
      const failed = await runTask(page, 'zip-tool:unpack', {
        archive: junk,
        targetDir: path.join(root, 'junk-out'),
        conflict: 'rename'
      })
      expect(failed.errorCode).toBe('ZP_ARCHIVE_INVALID')
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
      await app.close()
    }
  })
})
