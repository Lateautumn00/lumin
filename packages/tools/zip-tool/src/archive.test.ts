/**
 * @file archive.test.ts 打包/解压核心单测（真实临时目录 + fflate）
 * @author cuilanchao
 * @date 2026-11-20
 * @description 覆盖源枚举/流式打包/产物冲突/解压回读/zip slip/同名策略/容量上限/中央目录篡改预检
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { afterEach, describe, expect, it } from 'vitest'
import {
  collectPackEntries,
  findEndOfCentralDirectory,
  parseCentralDirectory,
  runPack,
  runUnpack,
  type ArchiveProgress
} from './archive'
import type { PackRequest, UnpackRequest } from './schema'

const roots: string[] = []

/** 单条进度回调参数 */
type ProgressUpdate = Parameters<ArchiveProgress>[0]

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'lumin-zip-test-'))
  roots.push(root)
  return root
}

function writeText(filePath: string, content: string): string {
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, content, 'utf8')
  return filePath
}

function collect(): { updates: ProgressUpdate[]; emit: ArchiveProgress } {
  const updates: ProgressUpdate[] = []
  return { updates, emit: (progress) => updates.push(progress) }
}

/** 断言同步抛出指定结构化错误码 */
function expectToolError(run: () => unknown, code: string): void {
  try {
    run()
  } catch (error) {
    expect(error).toMatchObject({ code })
    return
  }
  throw new Error(`期望抛出 ${code}，但未抛出`)
}

function packRequest(overrides: Partial<PackRequest> = {}): PackRequest {
  return { sources: [], outputDir: tempRoot(), outputName: '输出.zip', ...overrides }
}

function unpackRequest(overrides: Partial<UnpackRequest> = {}): UnpackRequest {
  return {
    archive: join(tempRoot(), '缺失.zip'),
    targetDir: join(tempRoot(), '解压'),
    conflict: 'rename',
    ...overrides
  }
}

/** 中央目录条目位置（篡改用） */
interface CentralSlot {
  offset: number
  name: string
}

function centralSlots(buffer: Buffer): CentralSlot[] {
  const eocd = findEndOfCentralDirectory(buffer)
  if (eocd === null) throw new Error('测试数据缺少 EOCD')
  const slots: CentralSlot[] = []
  let offset = eocd.cdOffset
  const end = eocd.cdOffset + eocd.cdSize
  while (offset + 46 <= end) {
    const nameLength = buffer.readUInt16LE(offset + 28)
    const extraLength = buffer.readUInt16LE(offset + 30)
    const commentLength = buffer.readUInt16LE(offset + 32)
    slots.push({
      offset,
      name: buffer.toString('utf8', offset + 46, offset + 46 + nameLength)
    })
    offset += 46 + nameLength + extraLength + commentLength
  }
  return slots
}

/** 构造指定内容与条目名的 zip 文件 */
function writeZip(files: Record<string, string>): string {
  const entries: Record<string, Uint8Array> = {}
  for (const [name, content] of Object.entries(files)) entries[name] = strToU8(content)
  const archive = join(tempRoot(), '样例.zip')
  writeFileSync(archive, zipSync(entries))
  return archive
}

/** 构造仅含一个 0 字节文件的 stored zip（可指定原始名字节与通用标志位） */
function writeRawNameZip(nameBytes: Uint8Array, flags = 0): string {
  const name = Buffer.from(nameBytes)
  const local = Buffer.alloc(30)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(20, 4)
  local.writeUInt16LE(flags, 6)
  local.writeUInt16LE(0, 8)
  local.writeUInt32LE(0, 14)
  local.writeUInt32LE(0, 18)
  local.writeUInt32LE(0, 22)
  local.writeUInt16LE(name.length, 26)
  local.writeUInt16LE(0, 28)

  const central = Buffer.alloc(46)
  central.writeUInt32LE(0x02014b50, 0)
  central.writeUInt16LE(20, 4)
  central.writeUInt16LE(20, 6)
  central.writeUInt16LE(flags, 8)
  central.writeUInt16LE(0, 10)
  central.writeUInt32LE(0, 16)
  central.writeUInt32LE(0, 20)
  central.writeUInt32LE(0, 24)
  central.writeUInt16LE(name.length, 28)
  central.writeUInt32LE(0, 42)

  const centralOffset = local.length + name.length
  const centralSize = central.length + name.length
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(1, 8)
  eocd.writeUInt16LE(1, 10)
  eocd.writeUInt32LE(centralSize, 12)
  eocd.writeUInt32LE(centralOffset, 16)

  const archive = join(tempRoot(), 'gbk.zip')
  writeFileSync(
    archive,
    Buffer.concat([local, name, central, name, eocd])
  )
  return archive
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('collectPackEntries', () => {
  it('文件源取文件名；同名自动递增', () => {
    const root = tempRoot()
    const left = writeText(join(root, '甲', 'a.txt'), 'A')
    const right = writeText(join(root, '乙', 'a.txt'), 'B')
    const entries = collectPackEntries([left, right])
    expect(entries.map((entry) => entry.name)).toEqual(['a.txt', 'a (1).txt'])
    expect(entries.every((entry) => !entry.isDir)).toBe(true)
    expect(entries[0]?.size).toBe(1)
  })

  it('目录源保留相对结构；同名目录源自动递增', () => {
    const root = tempRoot()
    writeText(join(root, '甲', 'sub', 'x.txt'), 'x')
    writeText(join(root, '乙', 'sub', 'y.txt'), 'y')
    const entries = collectPackEntries([join(root, '甲', 'sub'), join(root, '乙', 'sub')])
    const names = entries.map((entry) => entry.name)
    expect(names).toContain('sub/')
    expect(names).toContain('sub/x.txt')
    expect(names).toContain('sub (1)/')
    expect(names).toContain('sub (1)/y.txt')
    expect(entries.filter((entry) => entry.isDir).length).toBe(2)

    const nested = collectPackEntries([join(root, '甲')]).map((entry) => entry.name)
    expect(nested).toEqual(['甲/', '甲/sub/', '甲/sub/x.txt'])
  })

  it('源不存在 → ZP_SOURCE_INVALID；空源返回空列表', () => {
    const root = tempRoot()
    expectToolError(() => collectPackEntries([join(root, '不存在')]), 'ZP_SOURCE_INVALID')
    expect(collectPackEntries([])).toEqual([])
  })

  it('符号链接不跟随（无法创建符号链接时跳过）', () => {
    const root = tempRoot()
    const file = writeText(join(root, 'dir', 'real.txt'), 'x')
    try {
      symlinkSync(file, join(root, 'dir', 'link.txt'))
    } catch {
      return
    }
    const names = collectPackEntries([join(root, 'dir')]).map((entry) => entry.name)
    expect(names).not.toContain('dir/link.txt')
  })

  it('条目数超上限 → ZP_TOO_MANY_ENTRIES', () => {
    const root = tempRoot()
    const files = [writeText(join(root, 'a.txt'), 'a'), writeText(join(root, 'b.txt'), 'b')]
    expectToolError(() => collectPackEntries(files, 1), 'ZP_TOO_MANY_ENTRIES')
  })
})

describe('runPack', () => {
  it('打包文件与目录 → 可回读且计数/进度正确', async () => {
    const root = tempRoot()
    const single = writeText(join(root, '单.txt'), '独立文件')
    writeText(join(root, '素材', 'a.txt'), '甲')
    writeText(join(root, '素材', 'nest', 'b.txt'), '乙')
    const { updates, emit } = collect()
    const result = await runPack(
      packRequest({ sources: [single, join(root, '素材')], outputDir: root }),
      emit
    )
    expect(result.outputZip).toBe(join(root, '输出.zip'))
    expect(result.files).toBe(3)
    expect(result.dirs).toBe(2)
    expect(result.bytes).toBe(
      Buffer.byteLength('独立文件') + Buffer.byteLength('甲') + Buffer.byteLength('乙')
    )
    expect(existsSync(result.outputZip)).toBe(true)

    const read = unzipSync(readFileSync(result.outputZip))
    expect(strFromU8(read['单.txt'] ?? new Uint8Array())).toBe('独立文件')
    expect(strFromU8(read['素材/a.txt'] ?? new Uint8Array())).toBe('甲')
    expect(strFromU8(read['素材/nest/b.txt'] ?? new Uint8Array())).toBe('乙')
    expect(updates.at(-1)).toMatchObject({ current: 5, total: 5, stage: 'pack' })
  })

  it('每 20 条目推送一次进度', async () => {
    const root = tempRoot()
    const sources = Array.from({ length: 21 }, (_item, index) =>
      writeText(join(root, '源', `${index}.txt`), `${index}`)
    )
    const { updates, emit } = collect()
    await runPack(packRequest({ sources, outputDir: root }), emit)
    expect(updates.map((update) => update.current)).toEqual([20, 21])
  })

  it('产物同名 → 自动追加序号不覆盖', async () => {
    const root = tempRoot()
    const source = writeText(join(root, 'a.txt'), 'a')
    writeText(join(root, '输出.zip'), '旧产物')
    const result = await runPack(packRequest({ sources: [source], outputDir: root }), () => undefined)
    expect(result.outputZip).toBe(join(root, '输出(1).zip'))
    expect(readFileSync(join(root, '输出.zip'), 'utf8')).toBe('旧产物')
  })

  it('非法输出名 / 源缺失 / 输出目录是文件 → 结构化错误', async () => {
    const root = tempRoot()
    const source = writeText(join(root, 'a.txt'), 'a')
    await expect(
      runPack(
        packRequest({ sources: [source], outputDir: root, outputName: 'x.rar' }),
        () => undefined
      )
    ).rejects.toMatchObject({ code: 'ZP_INVALID_PAYLOAD' })
    await expect(
      runPack(packRequest({ sources: [join(root, '无')], outputDir: root }), () => undefined)
    ).rejects.toMatchObject({ code: 'ZP_SOURCE_INVALID' })
    const fileAsDir = writeText(join(root, '占位'), 'x')
    await expect(
      runPack(packRequest({ sources: [source], outputDir: fileAsDir }), () => undefined)
    ).rejects.toMatchObject({ code: 'ZP_TARGET_INVALID' })
    await expect(
      runPack(packRequest({ sources: [], outputDir: root }), () => undefined)
    ).rejects.toMatchObject({ code: 'ZP_SOURCE_INVALID' })
  })
})

describe('runUnpack', () => {
  it('解压回读文件与目录，计数正确', () => {
    const archive = writeZip({
      'a.txt': '甲',
      '子目录/': '',
      '子目录/b.txt': '乙'
    })
    const targetDir = join(tempRoot(), '解压')
    const { updates, emit } = collect()
    const result = runUnpack(unpackRequest({ archive, targetDir, conflict: 'rename' }), emit)
    expect(result.files).toBe(2)
    expect(result.dirs).toBe(1)
    expect(result.skipped).toBe(0)
    expect(result.renamed).toBe(0)
    expect(readFileSync(join(targetDir, 'a.txt'), 'utf8')).toBe('甲')
    expect(readFileSync(join(targetDir, '子目录', 'b.txt'), 'utf8')).toBe('乙')
    expect(updates.at(-1)).toMatchObject({ current: 3, total: 3, stage: 'unpack' })
  })

  it('GBK 条目名（bit11 未置位）→ 转码为中文并落盘', () => {
    const gbkName = Uint8Array.from([0xb2, 0xe2, 0xca, 0xd4, 0x2e, 0x74, 0x78, 0x74])
    const archive = writeRawNameZip(gbkName)
    const targetDir = join(tempRoot(), '解压')
    const result = runUnpack(
      unpackRequest({ archive, targetDir, conflict: 'rename' }),
      () => undefined
    )
    expect(result.files).toBe(1)
    expect(result.skipped).toBe(0)
    expect(existsSync(join(targetDir, '测试.txt'))).toBe(true)
  })

  it('bit11 置位 → 不按 GBK 转码', () => {
    const gbkName = Uint8Array.from([0xb2, 0xe2, 0xca, 0xd4, 0x2e, 0x74, 0x78, 0x74])
    const archive = writeRawNameZip(gbkName, 0x800)
    const targetDir = join(tempRoot(), '解压')
    const result = runUnpack(
      unpackRequest({ archive, targetDir, conflict: 'rename' }),
      () => undefined
    )
    expect(result.files).toBe(1)
    expect(existsSync(join(targetDir, '测试.txt'))).toBe(false)
  })

  it('非 GBK 损坏名 → 跳过计数且不落盘', () => {
    const archive = writeRawNameZip(Uint8Array.from([0x81]))
    const targetDir = join(tempRoot(), '解压')
    const result = runUnpack(
      unpackRequest({ archive, targetDir, conflict: 'rename' }),
      () => undefined
    )
    expect(result.skipped).toBe(1)
    expect(result.files).toBe(0)
  })

  it('UTF-8 中文名（bit11 置位）零回归', () => {
    const utf8Name = Uint8Array.from([
      0xe6, 0xb5, 0x8b, 0xe8, 0xaf, 0x95, 0x2e, 0x74, 0x78, 0x74
    ])
    const archive = writeRawNameZip(utf8Name, 0x800)
    const targetDir = join(tempRoot(), '解压')
    const result = runUnpack(
      unpackRequest({ archive, targetDir, conflict: 'rename' }),
      () => undefined
    )
    expect(result.files).toBe(1)
    expect(existsSync(join(targetDir, '测试.txt'))).toBe(true)
  })

  it('rename：同名自动递增；skip：跳过已存在文件', () => {
    const archive = writeZip({ 'a.txt': '新' })
    const targetDir = join(tempRoot(), '解压')
    mkdirSync(targetDir, { recursive: true })
    writeText(join(targetDir, 'a.txt'), '旧')

    const renamed = runUnpack(
      unpackRequest({ archive, targetDir, conflict: 'rename' }),
      () => undefined
    )
    expect(renamed.renamed).toBe(1)
    expect(readFileSync(join(targetDir, 'a (1).txt'), 'utf8')).toBe('新')

    const skipped = runUnpack(
      unpackRequest({ archive, targetDir, conflict: 'skip' }),
      () => undefined
    )
    expect(skipped.skipped).toBe(1)
    expect(skipped.renamed).toBe(0)
    expect(readFileSync(join(targetDir, 'a.txt'), 'utf8')).toBe('旧')
  })

  it('zip slip：绝对路径/盘符/.. 条目一律跳过且不越界落盘', () => {
    const archive = writeZip({
      '../越界.txt': 'evil',
      '/绝对.txt': 'evil',
      'C:/盘符.txt': 'evil',
      '正常.txt': 'ok'
    })
    const targetDir = join(tempRoot(), '解压')
    const result = runUnpack(
      unpackRequest({ archive, targetDir, conflict: 'rename' }),
      () => undefined
    )
    expect(result.skipped).toBe(3)
    expect(result.files).toBe(1)
    expect(existsSync(join(targetDir, '正常.txt'))).toBe(true)
    expect(existsSync(join(targetDir, '..', '越界.txt'))).toBe(false)
  })

  it('非法 zip / 非 zip 文件 → ZP_ARCHIVE_INVALID', () => {
    const root = tempRoot()
    const junk = writeText(join(root, 'junk.zip'), '这不是压缩包')
    expectToolError(() => runUnpack(unpackRequest({ archive: junk }), () => undefined), 'ZP_ARCHIVE_INVALID')
    expectToolError(
      () => runUnpack(unpackRequest({ archive: join(root, '缺失.zip') }), () => undefined),
      'ZP_ARCHIVE_INVALID'
    )
    const tiny = join(root, 'tiny.zip')
    writeFileSync(tiny, Buffer.from([0x50, 0x4b]))
    expectToolError(
      () => runUnpack(unpackRequest({ archive: tiny }), () => undefined),
      'ZP_ARCHIVE_INVALID'
    )
  })

  it('条目数 / 声明总大小超上限 → 拒绝', () => {
    const archive = writeZip({ 'a.txt': 'x', 'b.txt': 'y' })
    expectToolError(() => runUnpack(unpackRequest({ archive }), () => undefined, 1), 'ZP_TOO_MANY_ENTRIES')
    expectToolError(
      () => runUnpack(unpackRequest({ archive }), () => undefined, 100, 1),
      'ZP_ARCHIVE_TOO_LARGE'
    )
  })

  it('中央目录标记加密 / 不支持的压缩算法 → ZP_ARCHIVE_INVALID', () => {
    const source = writeZip({ 'a.txt': '加密前' })

    const encrypted = join(tempRoot(), '加密.zip')
    const encryptedBuffer = readFileSync(source)
    const [first] = centralSlots(encryptedBuffer)
    if (first === undefined) throw new Error('缺少中央目录条目')
    encryptedBuffer.writeUInt16LE(
      encryptedBuffer.readUInt16LE(first.offset + 8) | 0x1,
      first.offset + 8
    )
    writeFileSync(encrypted, encryptedBuffer)
    expectToolError(
      () => runUnpack(unpackRequest({ archive: encrypted }), () => undefined),
      'ZP_ARCHIVE_INVALID'
    )

    const unsupported = join(tempRoot(), '算法.zip')
    const unsupportedBuffer = readFileSync(source)
    const [slot] = centralSlots(unsupportedBuffer)
    if (slot === undefined) throw new Error('缺少中央目录条目')
    unsupportedBuffer.writeUInt16LE(12, slot.offset + 10)
    writeFileSync(unsupported, unsupportedBuffer)
    expectToolError(
      () => runUnpack(unpackRequest({ archive: unsupported }), () => undefined),
      'ZP_ARCHIVE_INVALID'
    )
  })

  it('外部属性标记符号链接 → 跳过计数且不落盘', () => {
    const source = writeZip({ 'link.txt': '目标内容' })
    const archive = join(tempRoot(), '符号链接.zip')
    const buffer = readFileSync(source)
    const [slot] = centralSlots(buffer)
    if (slot === undefined) throw new Error('缺少中央目录条目')
    buffer.writeUInt32LE(0xa1ff0000, slot.offset + 38)
    writeFileSync(archive, buffer)

    const targetDir = join(tempRoot(), '解压')
    const result = runUnpack(unpackRequest({ archive, targetDir }), () => undefined)
    expect(result.skipped).toBe(1)
    expect(result.files).toBe(0)
    expect(existsSync(join(targetDir, 'link.txt'))).toBe(false)
  })

  it('目标目录被同名文件占用 → ZP_TARGET_INVALID', () => {
    const archive = writeZip({ 'a.txt': 'x' })
    const targetDir = writeText(join(tempRoot(), '目标'), 'x')
    expectToolError(
      () => runUnpack(unpackRequest({ archive, targetDir }), () => undefined),
      'ZP_TARGET_INVALID'
    )
  })
})

describe('中央目录解析', () => {
  it('EOCD 与条目元数据可解析', () => {
    const buffer = Buffer.from(zipSync({ '测试.txt': strToU8('内容') }))
    const eocd = findEndOfCentralDirectory(buffer)
    expect(eocd).not.toBeNull()
    expect(eocd?.totalEntries).toBe(1)
    const entries = parseCentralDirectory(
      buffer.subarray(eocd?.cdOffset ?? 0, (eocd?.cdOffset ?? 0) + (eocd?.cdSize ?? 0))
    )
    expect(entries?.[0]).toMatchObject({
      name: '测试.txt',
      encrypted: false,
      symlink: false,
      directory: false
    })
  })

  it('EOCD 缺失 / ZIP64 标记 → null', () => {
    expect(findEndOfCentralDirectory(new Uint8Array(22))).toBeNull()

    const buffer = Buffer.from(zipSync({ 'a.txt': strToU8('x') }))
    const eocd = findEndOfCentralDirectory(buffer)
    if (eocd === null) throw new Error('缺少 EOCD')
    const tailOffset = buffer.length - 22
    buffer.writeUInt16LE(0xffff, tailOffset + 10)
    expect(findEndOfCentralDirectory(buffer)).toBeNull()
  })

  it('损坏字节 → null', () => {
    expect(parseCentralDirectory(new Uint8Array(0))).toEqual([])
    const broken = Buffer.alloc(46)
    expect(parseCentralDirectory(broken)).toBeNull()
    const trailing = Buffer.alloc(47)
    trailing.writeUInt32LE(0x02014b50, 0)
    expect(parseCentralDirectory(trailing)).toBeNull()
  })
})
