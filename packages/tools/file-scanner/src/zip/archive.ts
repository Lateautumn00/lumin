/**
 * @file archive.ts 打包 / 解压核心实现（fs + fflate，worker 内执行）
 * @author cuilanchao
 * @date 2026-11-20
 * @description 打包：枚举源条目 → 冲突去重 → 流式 DEFLATE 写入（64KB 分块读取）；
 *              解压：先解析中央目录（条目数/总大小/加密/符号链接预检）→ 流式解压逐条落盘，
 *              路径穿越条目跳过并计数（spec §5.3）。所有错误均为结构化工具错误。
 */
import {
  closeSync,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readSync,
  statSync,
  unlinkSync,
  writeSync,
  type Dirent,
  type Stats
} from 'node:fs'
import { open } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { Zip, ZipDeflate, ZipPassThrough, Unzip, UnzipInflate, type UnzipFile } from 'fflate'
import { resolveConflictPath } from '@lumin/node-kit'
import { errnoCode, isStructuredError, toolError } from './errors'
import {
  decodeLegacyEntryName,
  decodeZipEntryName,
  entryKey,
  isZipFileName,
  normalizeArchivePath,
  uniqueArchiveEntryName
} from './contract'
import {
  MAX_ENTRIES,
  MAX_UNPACK_BYTES,
  PROGRESS_STEP_ENTRIES,
  type ConflictPolicy,
  type PackRequest,
  type PackResult,
  type UnpackRequest,
  type UnpackResult
} from './schema'

/** 读写分块大小（64KB） */
export const ARCHIVE_CHUNK_BYTES = 64 * 1024

/** 同名冲突递增上限（与 node-kit resolveConflictPath 一致） */
const MAX_RENAME_ATTEMPTS = 99

/** 进度回调（worker 适配为 TaskUpdate） */
export type ArchiveProgress = (progress: {
  current: number
  total: number
  stage: 'pack' | 'unpack'
  message?: string
}) => void

/** 打包条目（文件或目录） */
export interface PackEntry {
  /** 压缩包内条目名（`/` 分隔；目录以 `/` 结尾） */
  name: string
  /** 磁盘绝对路径 */
  absPath: string
  isDir: boolean
  size: number
  mtimeMs: number
}

/** 中央目录条目（预检用） */
export interface CentralEntry {
  name: string
  compressedSize: number
  originalSize: number
  compression: number
  encrypted: boolean
  symlink: boolean
  directory: boolean
}

/** 中央目录尾部信息 */
export interface EndOfCentralDirectory {
  cdOffset: number
  cdSize: number
  totalEntries: number
}

/** 错误详情：errno + 条目/路径 */
function ioDetail(err: unknown, subject: string): string {
  const code = errnoCode(err)
  const message = err instanceof Error ? err.message : String(err)
  return code === '' ? `${subject}: ${message}` : `${subject}: ${code}`
}

/** 目录条目名（末尾 `/`）同名递增；比较键统一带 `/`，避免与同名文件误判 */
function uniqueDirEntryName(existing: ReadonlySet<string>, candidate: string): string {
  const plain = candidate.endsWith('/') ? candidate.slice(0, -1) : candidate
  const slash = plain.lastIndexOf('/')
  const dir = slash === -1 ? '' : plain.slice(0, slash + 1)
  const name = slash === -1 ? plain : plain.slice(slash + 1)
  for (let n = 0; ; n += 1) {
    const next = `${dir}${n === 0 ? name : `${name} (${n})`}/`
    if (!existing.has(entryKey(next))) return next
  }
}

/**
 * 枚举打包源（文件源 = 文件名；目录源 = `{目录名}/…` 保留相对结构）
 * @param sources 源绝对路径（node 侧已 zod 校验）
 * @param maxEntries 条目上限（测试可注入）
 */
export function collectPackEntries(
  sources: readonly string[],
  maxEntries: number = MAX_ENTRIES
): PackEntry[] {
  const entries: PackEntry[] = []
  const occupied = new Set<string>()

  /** 追加条目并返回最终条目名（同名递增后的结果） */
  const push = (
    rawName: string,
    absPath: string,
    isDir: boolean,
    size: number,
    mtimeMs: number
  ): string => {
    if (entries.length >= maxEntries) {
      throw toolError('ZP_TOO_MANY_ENTRIES')
    }
    const name = isDir
      ? uniqueDirEntryName(occupied, rawName)
      : uniqueArchiveEntryName(occupied, rawName)
    occupied.add(entryKey(name))
    entries.push({ name, absPath, isDir, size, mtimeMs })
    return name
  }

  for (const source of sources) {
    let rootInfo: Stats
    try {
      rootInfo = statSync(source)
    } catch {
      throw toolError('ZP_SOURCE_INVALID', source)
    }
    if (rootInfo.isFile()) {
      const name = basename(source)
      if (name === '') throw toolError('ZP_SOURCE_INVALID', source)
      push(name, source, false, rootInfo.size, rootInfo.mtimeMs)
      continue
    }
    if (!rootInfo.isDirectory()) {
      throw toolError('ZP_SOURCE_INVALID', `${source}（不是文件或文件夹）`)
    }
    const prefix = basename(source.replace(/[\\/]+$/, ''))
    const rootName = prefix === '' ? '打包' : prefix
    // 目录条目可能因同名递增改名，子条目必须跟随最终名，否则包内路径断裂
    const rootEntry = push(`${rootName}/`, source, true, 0, rootInfo.mtimeMs)
    const stack: { abs: string; rel: string }[] = [{ abs: source, rel: rootEntry.slice(0, -1) }]
    while (stack.length > 0) {
      const current = stack.pop()
      if (current === undefined) break
      let dirents: Dirent[]
      try {
        dirents = readdirSync(current.abs, { withFileTypes: true })
      } catch {
        throw toolError('ZP_SOURCE_INVALID', current.abs)
      }
      for (const dirent of dirents) {
        // 符号链接与非常规条目一律跳过（不跟随，避免环与越界）
        if (dirent.isSymbolicLink()) continue
        const abs = join(current.abs, dirent.name)
        const rel = `${current.rel}/${dirent.name}`
        if (dirent.isDirectory()) {
          let info: Stats
          try {
            info = statSync(abs)
          } catch {
            continue
          }
          const dirEntry = push(`${rel}/`, abs, true, 0, info.mtimeMs)
          stack.push({ abs, rel: dirEntry.slice(0, -1) })
          continue
        }
        if (!dirent.isFile()) continue
        try {
          const info = statSync(abs)
          push(rel, abs, false, info.size, info.mtimeMs)
        } catch {
          // 单文件 stat 失败不中断（打包时再报读取错误）
          continue
        }
      }
    }
  }
  return entries
}

/** 流式读取文件并推入 deflate 流（64KB 分块） */
async function feedFile(entry: PackEntry, sink: ZipDeflate): Promise<void> {
  let handle: Awaited<ReturnType<typeof open>>
  try {
    handle = await open(entry.absPath, 'r')
  } catch (err) {
    throw toolError('ZP_SOURCE_INVALID', ioDetail(err, entry.name))
  }
  try {
    if (entry.size === 0) {
      sink.push(new Uint8Array(0), true)
      return
    }
    const buffer = Buffer.alloc(Math.min(ARCHIVE_CHUNK_BYTES, entry.size))
    let position = 0
    while (position < entry.size) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position)
      if (bytesRead === 0) {
        sink.push(new Uint8Array(0), true)
        return
      }
      position += bytesRead
      sink.push(buffer.subarray(0, bytesRead), position >= entry.size)
    }
  } catch (err) {
    throw toolError('ZP_SOURCE_INVALID', ioDetail(err, entry.name))
  } finally {
    await handle.close().catch(() => undefined)
  }
}

/**
 * 执行打包（源枚举 → 冲突递增输出路径 → 流式写入）
 * @param request 打包参数（已 zod 校验）
 * @param emit 进度回调
 * @param maxEntries 条目上限（测试可注入）
 * @param now 时钟（测试可注入）
 */
export async function runPack(
  request: PackRequest,
  emit: ArchiveProgress,
  maxEntries: number = MAX_ENTRIES,
  now: () => number = Date.now
): Promise<PackResult> {
  const started = now()
  if (!isZipFileName(request.outputName)) {
    throw toolError('ZP_INVALID_PAYLOAD', '输出文件名必须以 .zip 结尾')
  }
  try {
    if (!statSync(request.outputDir).isDirectory()) {
      throw toolError('ZP_TARGET_INVALID', request.outputDir)
    }
  } catch (err) {
    if (isStructuredError(err)) throw err
    throw toolError('ZP_TARGET_INVALID', ioDetail(err, request.outputDir))
  }

  const entries = collectPackEntries(request.sources, maxEntries)
  if (entries.length === 0) {
    throw toolError('ZP_SOURCE_INVALID', '没有可打包的文件')
  }
  const outputZip = resolveConflictPath(join(request.outputDir, request.outputName), existsSync)
  if (outputZip === null) {
    throw toolError('ZP_TARGET_INVALID', `${request.outputName}（同名文件过多）`)
  }

  let fd = -1
  let committed = false
  let writeError: unknown = null
  try {
    fd = openSync(outputZip, 'w')
    const zip = new Zip((err, data) => {
      if (err !== null) {
        writeError = writeError ?? err
        return
      }
      try {
        writeSync(fd, data)
      } catch (writeFailure) {
        writeError = writeError ?? writeFailure
      }
    })

    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index]
      if (entry === undefined) break
      if (entry.isDir) {
        const sink = new ZipPassThrough(entry.name)
        sink.mtime = new Date(entry.mtimeMs)
        zip.add(sink)
        sink.push(new Uint8Array(0), true)
      } else {
        const sink = new ZipDeflate(entry.name, { level: 6 })
        sink.mtime = new Date(entry.mtimeMs)
        zip.add(sink)
        await feedFile(entry, sink)
      }
      if (writeError !== null) {
        throw toolError('ZP_TARGET_INVALID', ioDetail(writeError, outputZip))
      }
      const done = index + 1
      if (done % PROGRESS_STEP_ENTRIES === 0 || done === entries.length) {
        emit({ current: done, total: entries.length, stage: 'pack', message: entry.name })
      }
    }
    zip.end()
    if (writeError !== null) {
      throw toolError('ZP_TARGET_INVALID', ioDetail(writeError, outputZip))
    }
    committed = true
  } finally {
    if (fd !== -1) closeSync(fd)
    if (!committed) {
      try {
        unlinkSync(outputZip)
      } catch {
        // 清理半成品失败不覆盖原始错误
      }
    }
  }

  const files = entries.filter((entry) => !entry.isDir)
  return {
    outputZip,
    files: files.length,
    dirs: entries.length - files.length,
    bytes: files.reduce((sum, entry) => sum + entry.size, 0),
    elapsedMs: now() - started
  }
}

/**
 * 定位中央目录结束记录（EOCD）
 * @param tail 文件尾部（≥22 字节）
 */
export function findEndOfCentralDirectory(tail: Uint8Array): EndOfCentralDirectory | null {
  const view = Buffer.from(tail.buffer, tail.byteOffset, tail.byteLength)
  for (let offset = view.length - 22; offset >= 0; offset -= 1) {
    if (view.readUInt32LE(offset) !== 0x06054b50) continue
    const totalEntries = view.readUInt16LE(offset + 10)
    const cdSize = view.readUInt32LE(offset + 12)
    const cdOffset = view.readUInt32LE(offset + 16)
    // ZIP64 暂不支持（标记值 0xffff / 0xffffffff）
    if (totalEntries === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) return null
    return { cdOffset, cdSize, totalEntries }
  }
  return null
}

/**
 * 解析中央目录（条目元数据 + 加密/符号链接标记）
 * @param data 中央目录原始字节
 */
export function parseCentralDirectory(data: Uint8Array): CentralEntry[] | null {
  const view = Buffer.from(data.buffer, data.byteOffset, data.byteLength)
  const entries: CentralEntry[] = []
  let offset = 0
  while (offset + 46 <= view.length) {
    if (view.readUInt32LE(offset) !== 0x02014b50) return null
    const flags = view.readUInt16LE(offset + 8)
    const compression = view.readUInt16LE(offset + 10)
    const compressedSize = view.readUInt32LE(offset + 20)
    const originalSize = view.readUInt32LE(offset + 24)
    const nameLength = view.readUInt16LE(offset + 28)
    const extraLength = view.readUInt16LE(offset + 30)
    const commentLength = view.readUInt16LE(offset + 32)
    const externalAttrs = view.readUInt32LE(offset + 38)
    const nameStart = offset + 46
    const nameEnd = nameStart + nameLength
    if (nameEnd > view.length) return null
    const name = decodeZipEntryName(view.subarray(nameStart, nameEnd), (flags & 0x800) !== 0)
    const unixMode = (externalAttrs >>> 16) & 0xffff
    entries.push({
      name,
      compressedSize,
      originalSize,
      compression,
      encrypted: (flags & 0x1) !== 0,
      symlink: (unixMode & 0xf000) === 0xa000,
      directory: name.endsWith('/') || (externalAttrs & 0x10) !== 0
    })
    offset = nameEnd + extraLength + commentLength
  }
  if (offset !== view.length) return null
  return entries
}

/** 读取中央目录并做容量/加密/压缩算法预检 */
function readCentralEntries(fd: number, size: number): CentralEntry[] {
  if (size < 22) throw toolError('ZP_ARCHIVE_INVALID', '文件过小')
  const head = Buffer.alloc(4)
  readSync(fd, head, 0, 4, 0)
  const magic = head.readUInt32LE(0)
  if (magic !== 0x04034b50 && magic !== 0x06054b50) {
    throw toolError('ZP_ARCHIVE_INVALID', '不是 ZIP 文件或已损坏')
  }
  const tailLength = Math.min(size, 65_557)
  const tail = Buffer.alloc(tailLength)
  readSync(fd, tail, 0, tailLength, size - tailLength)
  const eocd = findEndOfCentralDirectory(tail)
  if (eocd === null) throw toolError('ZP_ARCHIVE_INVALID', '未找到中央目录（ZIP64 暂不支持）')
  if (eocd.cdOffset + eocd.cdSize > size) {
    throw toolError('ZP_ARCHIVE_INVALID', '中央目录越界')
  }
  const directory = Buffer.alloc(eocd.cdSize)
  if (eocd.cdSize > 0) readSync(fd, directory, 0, eocd.cdSize, eocd.cdOffset)
  const entries = parseCentralDirectory(directory)
  if (entries === null) throw toolError('ZP_ARCHIVE_INVALID', '中央目录损坏')
  if (entries.length !== eocd.totalEntries) {
    throw toolError('ZP_ARCHIVE_INVALID', '条目数与中央目录不一致')
  }
  return entries
}

/** 解压同名冲突决策 */
function resolveUnpackPath(
  targetDir: string,
  rel: string,
  conflict: ConflictPolicy
): { path: string; renamed: boolean } | null {
  const desired = join(targetDir, ...rel.split('/'))
  if (!existsSync(desired)) return { path: desired, renamed: false }
  if (conflict === 'skip') return null
  const dir = dirname(desired)
  const name = basename(desired)
  const dot = name.lastIndexOf('.')
  const base = dot <= 0 ? name : name.slice(0, dot)
  const ext = dot <= 0 ? '' : name.slice(dot)
  for (let n = 1; n <= MAX_RENAME_ATTEMPTS; n += 1) {
    const candidate = join(dir, `${base} (${n})${ext}`)
    if (!existsSync(candidate)) return { path: candidate, renamed: true }
  }
  throw toolError('ZP_TARGET_INVALID', `${rel}（同名文件过多）`)
}

/**
 * 执行解压（中央目录预检 → 流式解压逐条落盘）
 * @param request 解压参数（已 zod 校验）
 * @param emit 进度回调
 * @param maxEntries 条目上限（测试可注入）
 * @param maxBytes 解压总大小上限（测试可注入）
 * @param now 时钟（测试可注入）
 */
export function runUnpack(
  request: UnpackRequest,
  emit: ArchiveProgress,
  maxEntries: number = MAX_ENTRIES,
  maxBytes: number = MAX_UNPACK_BYTES,
  now: () => number = Date.now
): UnpackResult {
  const started = now()
  let archiveFd = -1
  try {
    archiveFd = openSync(request.archive, 'r')
  } catch (err) {
    throw toolError('ZP_ARCHIVE_INVALID', ioDetail(err, request.archive))
  }

  const openOutputs = new Set<number>()
  try {
    const size = fstatSync(archiveFd).size
    const entries = readCentralEntries(archiveFd, size)
    if (entries.length > maxEntries) {
      throw toolError('ZP_TOO_MANY_ENTRIES', `压缩包含 ${entries.length} 个条目`)
    }
    const declared = entries.reduce((sum, entry) => sum + entry.originalSize, 0)
    if (declared > maxBytes) {
      throw toolError('ZP_ARCHIVE_TOO_LARGE', `声明解压大小 ${declared} 字节`)
    }
    for (const entry of entries) {
      if (entry.encrypted) throw toolError('ZP_ARCHIVE_INVALID', `加密条目：${entry.name}`)
      if (!entry.directory && entry.compression !== 0 && entry.compression !== 8) {
        throw toolError(
          'ZP_ARCHIVE_INVALID',
          `不支持的压缩算法 ${entry.compression}：${entry.name}`
        )
      }
    }

    try {
      mkdirSync(request.targetDir, { recursive: true })
      if (!statSync(request.targetDir).isDirectory()) {
        throw toolError('ZP_TARGET_INVALID', request.targetDir)
      }
    } catch (err) {
      if (isStructuredError(err)) throw err
      throw toolError('ZP_TARGET_INVALID', ioDetail(err, request.targetDir))
    }

    const total = entries.length
    const symlinkKeys = new Set(
      entries.filter((entry) => entry.symlink).map((entry) => entryKey(entry.name))
    )
    let processed = 0
    let files = 0
    let dirs = 0
    let skipped = 0
    let renamed = 0
    let bytes = 0

    const report = (message: string): void => {
      processed += 1
      if (processed % PROGRESS_STEP_ENTRIES === 0 || processed >= total) {
        emit({ current: Math.min(processed, total), total, stage: 'unpack', message })
      }
    }

    /** 跳过条目：排空数据（避免未 start 的条目在 fflate 内部缓冲压缩字节） */
    const drainSkipped = (file: UnzipFile, rawName: string): void => {
      file.ondata = (_err, _chunk, final) => {
        if (!final) return
        skipped += 1
        report(rawName)
      }
      file.start()
    }

    const unzip = new Unzip((file) => {
      // GBK 老 zip（bit11 未置位）由 fflate 按 latin1 解码，此处回退 GBK 重解；无法恢复则跳过计数
      const decodedName = decodeLegacyEntryName(file.name)
      if (decodedName === null) {
        drainSkipped(file, file.name)
        return
      }
      const rawName = decodedName
      if (symlinkKeys.has(entryKey(rawName))) {
        drainSkipped(file, rawName)
        return
      }
      const isDirEntry = rawName.endsWith('/')
      const rel = normalizeArchivePath(isDirEntry ? rawName.slice(0, -1) : rawName)
      if (rel === null) {
        // zip slip 防护：绝对路径 / 盘符 / `..` / 控制字符条目一律不落盘
        drainSkipped(file, rawName)
        return
      }
      if (isDirEntry) {
        try {
          mkdirSync(join(request.targetDir, ...rel.split('/')), { recursive: true })
        } catch (err) {
          throw toolError('ZP_TARGET_INVALID', ioDetail(err, rel))
        }
        dirs += 1
        report(rawName)
        return
      }
      const target = resolveUnpackPath(request.targetDir, rel, request.conflict)
      if (target === null) {
        skipped += 1
        report(rawName)
        return
      }
      if (target.renamed) renamed += 1
      let outputFd = -1
      try {
        mkdirSync(dirname(target.path), { recursive: true })
        outputFd = openSync(target.path, 'w')
      } catch (err) {
        throw toolError('ZP_TARGET_INVALID', ioDetail(err, rel))
      }
      openOutputs.add(outputFd)
      file.ondata = (err, chunk, final) => {
        if (err !== null) {
          throw toolError('ZP_ARCHIVE_INVALID', `${rawName}: ${err.message}`)
        }
        if (chunk.length > 0) {
          try {
            writeSync(outputFd, chunk)
          } catch (writeFailure) {
            throw toolError('ZP_TARGET_INVALID', ioDetail(writeFailure, rel))
          }
          bytes += chunk.length
          if (bytes > maxBytes) {
            throw toolError('ZP_ARCHIVE_TOO_LARGE', `解压字节数超过上限`)
          }
        }
        if (final) {
          closeSync(outputFd)
          openOutputs.delete(outputFd)
          files += 1
          report(rawName)
        }
      }
      file.start()
    })
    unzip.register(UnzipInflate)

    const buffer = Buffer.alloc(ARCHIVE_CHUNK_BYTES)
    let position = 0
    for (;;) {
      const bytesRead = readSync(archiveFd, buffer, 0, buffer.length, position)
      if (bytesRead === 0) break
      position += bytesRead
      unzip.push(new Uint8Array(buffer.subarray(0, bytesRead)), false)
    }
    unzip.push(new Uint8Array(0), true)

    return {
      targetDir: request.targetDir,
      files,
      dirs,
      bytes,
      skipped,
      renamed,
      elapsedMs: now() - started
    }
  } finally {
    for (const fd of openOutputs) {
      try {
        closeSync(fd)
      } catch {
        // 关闭失败不覆盖原始错误
      }
    }
    if (archiveFd !== -1) closeSync(archiveFd)
  }
}
