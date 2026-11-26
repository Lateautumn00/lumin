/**
 * @file text-editor 主进程逻辑（open / save / save-as，全同步通道）
 * @author cuilanchao
 * @date 2026-11-22
 * @description 读取时判定编码/EOL 与只读状态；保存先归一 EOL 再按编码写盘，
 *              经 @lumin/node-kit writeAtomic 原子落盘；save-as 校验目录与文件名。
 */
import { constants } from 'node:fs'
import { access, readFile, stat } from 'node:fs/promises'
import { basename, isAbsolute, join } from 'node:path'
import { writeAtomic } from '@lumin/node-kit'
import type { MainPluginContext, RegisterMain } from '@lumin/plugin-api'
import {
  detectEol,
  detectTextEncoding,
  errnoCode,
  makeError,
  normalizeEol,
  type StructuredError,
  type TextEncoding
} from '@lumin/shared'
import type { ZodType } from 'zod'
import { decodeBytes, encodeText } from './encoding'
import { toolError } from './errors'
import { TEXT_EDITOR_MAX_BYTES, hasNulByte, toEolChar, toEolKind, type EolKind } from './formats'
import {
  openPayloadSchema,
  openResultSchema,
  saveAsPayloadSchema,
  saveAsResultSchema,
  savePayloadSchema,
  saveResultSchema,
  type OpenResult,
  type SaveAsResult,
  type SaveResult
} from './schema'

/** 文件系统依赖（测试可注入假件） */
export interface TextEditorDeps {
  stat(path: string): Promise<{ size: number; mtimeMs: number; isFile(): boolean }>
  readFile(path: string): Promise<Buffer>
  access(path: string, mode: number): Promise<void>
  writeAtomic(target: string, data: Buffer): void
  fileExists(path: string): Promise<boolean>
}

/** 文件名禁用字符（分隔符与盘符；另禁止以 `.` 开头） */
const INVALID_NAME_CHARS = /[\\/:]/

/** utf16 文本天然含 NUL 字节，NUL 检测需排除 */
function isUtf16(encoding: TextEncoding): boolean {
  return encoding === 'utf16le' || encoding === 'utf16be'
}

/** 错误细节：优先 errno 码，回退 String(err) */
function detailOf(err: unknown): string {
  const code = errnoCode(err)
  return code === '' ? String(err) : code
}

/** 读取期错误归一：不存在 / 被占用 / 其余读取失败 */
function classifyReadError(err: unknown): StructuredError {
  const code = errnoCode(err)
  if (code === 'ENOENT') return toolError('TE_NOT_FOUND', code)
  if (code === 'EBUSY' || code === 'EPERM' || code === 'EACCES') {
    return toolError('TE_LOCKED', code)
  }
  return toolError('TE_DECODE_FAILED', detailOf(err))
}

/** 保存期 stat 错误归一：不存在 / 被占用 / 其余保存失败 */
function classifySaveError(err: unknown): StructuredError {
  const code = errnoCode(err)
  if (code === 'ENOENT') return toolError('TE_NOT_FOUND', code)
  if (code === 'EBUSY' || code === 'EPERM' || code === 'EACCES') {
    return toolError('TE_LOCKED', code)
  }
  return toolError('TE_SAVE_FAILED', detailOf(err))
}

/** zod 校验：失败统一 INVALID_PAYLOAD */
function parseOrThrow<T>(schema: ZodType<T>, payload: unknown): T {
  const parsed = schema.safeParse(payload)
  if (!parsed.success) {
    throw makeError('INVALID_PAYLOAD', parsed.error.issues[0]?.message ?? '参数无效')
  }
  return parsed.data
}

/** 按目标 EOL/编码生成待写字节（编码失败归为 TE_SAVE_FAILED） */
function encodeForWrite(content: string, encoding: TextEncoding, eol: EolKind): Buffer {
  try {
    return encodeText(normalizeEol(content, toEolChar(eol)), encoding)
  } catch (err) {
    throw toolError('TE_SAVE_FAILED', detailOf(err))
  }
}

/** 写盘并返回新 mtimeMs（失败归为 TE_SAVE_FAILED） */
async function writeAndStat(deps: TextEditorDeps, target: string, data: Buffer): Promise<number> {
  try {
    deps.writeAtomic(target, data)
  } catch (err) {
    throw toolError('TE_SAVE_FAILED', detailOf(err))
  }
  try {
    const info = await deps.stat(target)
    return info.mtimeMs
  } catch (err) {
    throw toolError('TE_SAVE_FAILED', detailOf(err))
  }
}

/**
 * 注册 text-editor 全部通道（工具注册入口，可注入 deps 供测试）
 * @param ctx 主进程插件上下文（registerIpc/log）
 * @param deps 可注入文件系统依赖
 */
export function registerWith(
  ctx: MainPluginContext,
  deps: TextEditorDeps = createNodeDeps()
): void {
  // —— open（sync）：体积/类型 → 读字节 → 判定编码/EOL → 只读探测 ——
  ctx.registerIpc('open', async ({ payload }): Promise<OpenResult> => {
    const { path } = parseOrThrow(openPayloadSchema, payload)

    let info: { size: number; mtimeMs: number; isFile(): boolean }
    try {
      info = await deps.stat(path)
    } catch (err) {
      throw classifyReadError(err)
    }
    if (!info.isFile()) throw toolError('TE_INVALID_PATH')
    if (info.size > TEXT_EDITOR_MAX_BYTES) {
      throw toolError('TE_TOO_LARGE', String(info.size))
    }

    let bytes: Buffer
    try {
      bytes = await deps.readFile(path)
    } catch (err) {
      throw classifyReadError(err)
    }

    const encoding = detectTextEncoding(bytes)
    if (!isUtf16(encoding) && hasNulByte(bytes)) {
      throw toolError('TE_DECODE_FAILED', '包含 NUL 字节')
    }

    let content: string
    try {
      content = decodeBytes(bytes, encoding)
    } catch (err) {
      throw toolError('TE_DECODE_FAILED', detailOf(err))
    }

    let readOnly = false
    try {
      await deps.access(path, constants.W_OK)
    } catch {
      readOnly = true
    }

    return openResultSchema.parse({
      path,
      name: basename(path),
      size: info.size,
      mtimeMs: info.mtimeMs,
      content,
      encoding,
      eol: toEolKind(detectEol(content)),
      readOnly
    })
  })

  // —— save（sync）：mtime 冲突检测 → 归一 EOL → 编码 → 原子写盘 ——
  ctx.registerIpc('save', async ({ payload }): Promise<SaveResult> => {
    const parsed = parseOrThrow(savePayloadSchema, payload)

    let info: { mtimeMs: number; isFile(): boolean }
    try {
      info = await deps.stat(parsed.path)
    } catch (err) {
      throw classifySaveError(err)
    }
    if (!info.isFile()) throw toolError('TE_INVALID_PATH')
    if (
      parsed.expectedMtimeMs !== undefined &&
      parsed.expectedMtimeMs !== info.mtimeMs &&
      parsed.force !== true
    ) {
      throw toolError('TE_FILE_CHANGED')
    }

    const data = encodeForWrite(parsed.content, parsed.encoding, parsed.eol)
    const mtimeMs = await writeAndStat(deps, parsed.path, data)
    return saveResultSchema.parse({ mtimeMs })
  })

  // —— save-as（sync）：目录/文件名校验 → 存在检测 → 原子写盘 ——
  ctx.registerIpc('save-as', async ({ payload }): Promise<SaveAsResult> => {
    const parsed = parseOrThrow(saveAsPayloadSchema, payload)
    if (!isAbsolute(parsed.dir)) throw toolError('TE_INVALID_PATH')
    if (INVALID_NAME_CHARS.test(parsed.name) || parsed.name.startsWith('.')) {
      throw toolError('TE_INVALID_PATH')
    }

    const target = join(parsed.dir, parsed.name)
    if (await deps.fileExists(target)) throw toolError('TE_FILE_EXISTS', parsed.name)

    const data = encodeForWrite(parsed.content, parsed.encoding, parsed.eol)
    const mtimeMs = await writeAndStat(deps, target, data)
    return saveAsResultSchema.parse({ path: target, mtimeMs })
  })

  ctx.log.info('text-toolbox editor registered')
}

/** 生产实现：node:fs（测试可作基底再覆盖） */
export function createNodeDeps(): TextEditorDeps {
  return {
    stat: async (path) => {
      const info = await stat(path)
      return { size: info.size, mtimeMs: info.mtimeMs, isFile: () => info.isFile() }
    },
    readFile: (path) => readFile(path),
    access: (path, mode) => access(path, mode),
    writeAtomic: (target, data) => {
      writeAtomic(target, data)
    },
    fileExists: async (path) => {
      try {
        await access(path, constants.F_OK)
        return true
      } catch {
        return false
      }
    }
  }
}

/** 壳注册入口（plugin-host 调用） */
export const registerMain: RegisterMain = (ctx) => {
  registerWith(ctx, createNodeDeps())
}
