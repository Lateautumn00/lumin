/**
 * @file text-diff 主进程通道（pick-file 文件选择 / compare-files 文件比较，同步短阻塞）
 * @author cuilanchao
 * @date 2026-11-24
 * @description 模式判定走纯函数 classifyFile（≤1MB 且行数 ≤20,000 且前 8KB 无 NUL → 文本，
 *              UTF-16/32 BOM → TD_UNSUPPORTED_ENCODING）；文本模式剥 UTF-8 BOM 后复用 diffLines
 *              （行数/字符数超限由 diffLines 兜底 TD_TOO_LARGE）；二进制模式 node:crypto
 *              1MB/块流式 SHA-256 逐块同位比对、块不同字节级定位首差异偏移（内存 O(1)）。
 *              文件上限 200MB（stat 预检）；同步通道最坏 1–2s 短阻塞，不走三段式（plan §4.62）。
 *              依赖可注入（deps），单测不触真实对话框与磁盘。
 */
import { createHash } from 'node:crypto'
import { closeSync, openSync, readFileSync, readSync, statSync } from 'node:fs'
import { basename } from 'node:path'
import { dialog, clipboard } from 'electron'
import type { MainPluginContext, RegisterMain } from '@lumin/plugin-api'
import { errnoCode, isStructuredError } from '@lumin/shared'
import {
  BINARY_CHUNK_BYTES,
  FILE_COMPARE_MAX_BYTES,
  compareFilesPayloadSchema,
  copyTextPayloadSchema,
  pickFilePayloadSchema,
  type CompareFilesPayload,
  type CompareFilesResult,
  type CopyTextResult,
  type PickFileResult
} from './schema'
import { TEXT_FILE_MAX_BYTES, classifyFile, diffLines, diffStats, splitLines } from './diff'
import { toolError } from './errors'

/** 通道依赖（测试可整体注入，不触真实对话框/磁盘） */
export interface TextDiffNodeDeps {
  /** 选择单文件绝对路径（生产 = dialog.showOpenDialogSync；取消返回 null） */
  pickFilePath(): string | null
  /** 文件字节数（生产 = fs.statSync；不存在/不可读抛 fs 错误） */
  statSize(path: string): number
  /** 整读文件（两侧均 ≤1MB 的文本判定与读入用；失败抛 fs 错误） */
  readWholeFile(path: string): Buffer
  /** 二进制逐块读取（生产 = 1MB/块流式生成器，失败抛 fs 错误） */
  readChunks(path: string): Iterable<Buffer>
  /** 写系统剪贴板（生产 = electron clipboard.writeText；主进程写不依赖窗口焦点） */
  writeClipboard(text: string): void
}

/** zod issue 消息拼接（信封校验失败 detail） */
function invalidDetail(issues: readonly { message: string }[]): string {
  return issues.map((issue) => issue.message).join('; ')
}

/** 任意抛出物描述（errno 优先，回退 Error.message / String） */
function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** 文件系统异常统一包装 TD_FILE_READ_FAILED（结构化错误原样透传） */
function withFileError<T>(fn: () => T): T {
  try {
    return fn()
  } catch (err) {
    if (isStructuredError(err)) throw err
    throw toolError('TD_FILE_READ_FAILED', errnoCode(err) || describeError(err))
  }
}

/** UTF-8 解码（剥 BOM；非法字节序列 → TD_UNSUPPORTED_ENCODING） */
function decodeUtf8(buf: Buffer): string {
  const hasBom = buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf.subarray(hasBom ? 3 : 0))
  } catch {
    throw toolError('TD_UNSUPPORTED_ENCODING', 'invalid UTF-8 sequence')
  }
}

/** 单块 SHA-256 十六进制摘要 */
function hashChunk(chunk: Buffer): string {
  return createHash('sha256').update(chunk).digest('hex')
}

/** 二进制逐块比对结局（判别联合，避免不可达兜底分支） */
type BinaryOutcome =
  | { same: true; totalChunks: number }
  | { same: false; firstDiffOffset: number; totalChunks: number }

/**
 * 两文件块迭代器逐块同位比对：块 SHA-256 相同跳过，不同则字节级定位首差异偏移；
 * 一侧读尽而另一侧仍有剩余 → 首差异即较短文件末尾。内存 O(1)（仅保留当前两块）
 */
function diffBinaryChunks(left: Iterable<Buffer>, right: Iterable<Buffer>): BinaryOutcome {
  const leftIterator = left[Symbol.iterator]()
  const rightIterator = right[Symbol.iterator]()
  let leftBytes = 0
  let rightBytes = 0
  let totalChunks = 0
  let firstDiffOffset: number | undefined

  for (;;) {
    const nextLeft = leftIterator.next()
    const nextRight = rightIterator.next()
    if (nextLeft.done === true && nextRight.done === true) break
    const chunkLeft = nextLeft.done === true ? undefined : nextLeft.value
    const chunkRight = nextRight.done === true ? undefined : nextRight.value
    if (chunkLeft !== undefined) leftBytes += chunkLeft.length
    if (chunkRight !== undefined) rightBytes += chunkRight.length

    if (firstDiffOffset === undefined) {
      if (chunkLeft === undefined || chunkRight === undefined) {
        firstDiffOffset = Math.min(leftBytes, rightBytes)
      } else if (hashChunk(chunkLeft) !== hashChunk(chunkRight)) {
        const limit = Math.min(chunkLeft.length, chunkRight.length)
        let index = 0
        while (index < limit && chunkLeft[index] === chunkRight[index]) index += 1
        firstDiffOffset = totalChunks * BINARY_CHUNK_BYTES + index
      }
    }
    totalChunks += 1
  }

  if (firstDiffOffset === undefined) return { same: true, totalChunks }
  return { same: false, firstDiffOffset, totalChunks }
}

/** 文件比较主流程：stat 预检 → 模式判定 → 文本 diff / 二进制流式比对 */
function compareFiles(input: CompareFilesPayload, deps: TextDiffNodeDeps): CompareFilesResult {
  const { left, right, ignoreWhitespace, ignoreCase } = input
  const leftSize = withFileError(() => deps.statSize(left))
  const rightSize = withFileError(() => deps.statSize(right))
  if (leftSize > FILE_COMPARE_MAX_BYTES || rightSize > FILE_COMPARE_MAX_BYTES) {
    throw toolError('TD_FILE_TOO_LARGE', `${Math.max(leftSize, rightSize)} bytes`)
  }

  if (leftSize <= TEXT_FILE_MAX_BYTES && rightSize <= TEXT_FILE_MAX_BYTES) {
    const leftHead = withFileError(() => deps.readWholeFile(left))
    const rightHead = withFileError(() => deps.readWholeFile(right))
    const leftClass = classifyFile(leftHead, leftSize)
    const rightClass = classifyFile(rightHead, rightSize)
    if (leftClass === 'text' && rightClass === 'text') {
      const leftText = decodeUtf8(leftHead)
      const rightText = decodeUtf8(rightHead)
      const result = diffLines(leftText, rightText, { ignoreWhitespace, ignoreCase })
      if (!result.ok) throw toolError('TD_TOO_LARGE', result.message)
      return {
        mode: 'text',
        changes: result.value,
        stats: diffStats(result.value),
        leftLabel: basename(left),
        rightLabel: basename(right),
        leftLines: splitLines(leftText),
        rightLines: splitLines(rightText)
      }
    }
  }

  const outcome = withFileError(() =>
    diffBinaryChunks(deps.readChunks(left), deps.readChunks(right))
  )
  if (outcome.same) return { mode: 'binary', same: true, totalChunks: outcome.totalChunks }
  return {
    mode: 'binary',
    same: false,
    firstDiffOffset: outcome.firstDiffOffset,
    totalChunks: outcome.totalChunks
  }
}

/**
 * 注册 3 同步通道（测试可注入 deps）
 * @param ctx 主进程插件上下文
 * @param deps 通道依赖
 */
export function registerWith(
  ctx: MainPluginContext,
  deps: TextDiffNodeDeps = createDefaultDeps()
): void {
  /** pick-file：对话框选单文件，取消返回 null */
  ctx.registerIpc('pick-file', ({ payload }): PickFileResult => {
    const parsed = pickFilePayloadSchema.safeParse(payload)
    if (!parsed.success) throw toolError('INVALID_INPUT', invalidDetail(parsed.error.issues))
    return { path: deps.pickFilePath() }
  })

  /** compare-files：stat 预检 → classifyFile 分支 → 文本 diff / 二进制流式比对 */
  ctx.registerIpc('compare-files', ({ payload }): CompareFilesResult => {
    const parsed = compareFilesPayloadSchema.safeParse(payload)
    if (!parsed.success) throw toolError('INVALID_INPUT', invalidDetail(parsed.error.issues))
    return compareFiles(parsed.data, deps)
  })

  /** copy-text：主进程写系统剪贴板（不受 renderer 焦点/权限限制） */
  ctx.registerIpc('copy-text', ({ payload }): CopyTextResult => {
    const parsed = copyTextPayloadSchema.safeParse(payload)
    if (!parsed.success) throw toolError('INVALID_INPUT', invalidDetail(parsed.error.issues))
    try {
      deps.writeClipboard(parsed.data.text)
    } catch (err) {
      throw toolError('TD_CLIPBOARD_FAILED', describeError(err))
    }
    return { ok: true }
  })

  ctx.log.info('text-diff registered')
}

/** 生产注册入口（壳 tool-mains.ts 调用） */
export const registerMain: RegisterMain = (ctx) => registerWith(ctx)

/** 生产块读取：1MB/块流式（fd 由生成器打开、结束即关，内存 O(1)） */
function* readBinaryChunks(path: string): Generator<Buffer> {
  const fd = openSync(path, 'r')
  try {
    let position = 0
    for (;;) {
      const chunk = Buffer.allocUnsafe(BINARY_CHUNK_BYTES)
      const bytes = readSync(fd, chunk, 0, BINARY_CHUNK_BYTES, position)
      if (bytes <= 0) return
      yield chunk.subarray(0, bytes)
      position += bytes
    }
  } finally {
    closeSync(fd)
  }
}

/** 生产依赖：Electron 文件选择对话框 + node fs */
export function createDefaultDeps(): TextDiffNodeDeps {
  return {
    pickFilePath: () => {
      const picked = dialog.showOpenDialogSync({
        properties: ['openFile'],
        title: '选择比较文件'
      })
      return picked?.[0] ?? null
    },
    statSize: (path) => statSync(path).size,
    readWholeFile: (path) => readFileSync(path),
    readChunks: (path) => readBinaryChunks(path),
    writeClipboard: (text) => clipboard.writeText(text)
  }
}
