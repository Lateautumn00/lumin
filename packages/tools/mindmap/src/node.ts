/**
 * @file 思维导图主进程通道（open/save/read/export/draft 共 8 条同步通道）
 * @author cuilanchao
 * @date 2026-11-24
 * @description 只做 I/O 与边界校验（zod + 体积/节点上限），树清洗在渲染进程 sanitizeDocument；
 *              原子写统一 writeAtomic（.tmp + rename），草稿损坏降级改名留痕。
 */
import { mkdir, readFile, rename, stat, unlink } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import { dialog } from 'electron'
import { writeAtomic } from '@lumin/node-kit'
import type { MainPluginContext, RegisterMain } from '@lumin/plugin-api'
import { errnoCode, isStructuredError, stripBom } from '@lumin/shared'
import type { ZodType } from 'zod'

import {
  MAX_DEPTH,
  MAX_DOC_BYTES,
  MAX_DRAFT_BYTES,
  MAX_EXPORT_BYTES,
  MAX_NODES,
  countNodes,
  treeDepth
} from './contract'
import { toolError } from './errors'
import {
  clearDraftResultSchema,
  draftFileSchema,
  loadDraftResultSchema,
  openDialogResultSchema,
  openDocumentPayloadSchema,
  openDocumentResultSchema,
  rawDocumentSchema,
  readTextFilePayloadSchema,
  readTextFileResultSchema,
  saveDocumentPayloadSchema,
  saveDocumentResultSchema,
  saveDraftPayloadSchema,
  saveDraftResultSchema,
  writeExportPayloadSchema,
  writeExportResultSchema,
  type ClearDraftResult,
  type LoadDraftResult,
  type OpenDialogResult,
  type OpenDocumentResult,
  type ReadTextFileResult,
  type SaveDocumentResult,
  type SaveDraftResult,
  type WriteExportResult
} from './schema'

/** 主进程依赖（单测可整体注入，不触真实对话框/磁盘） */
export interface MindmapDeps {
  stat(path: string): Promise<{ size: number; mtimeMs: number; isFile(): boolean }>
  readFile(path: string): Promise<Buffer>
  writeAtomic(target: string, data: string | Buffer): void
  rename(from: string, to: string): Promise<void>
  mkdir(path: string): Promise<void>
  unlink(path: string): Promise<void>
  now(): Date
  pickJsonFile(): string | null
}

/** 允许导出的扩展名 */
const EXPORT_EXTENSIONS = new Set(['.json', '.md', '.markdown', '.opml', '.svg', '.png'])

/** 错误细节：优先 errno，回退 String(err) */
function detailOf(err: unknown): string {
  const code = errnoCode(err)
  return code === '' ? String(err) : code
}

/** 读取期错误归一 */
function classifyReadError(err: unknown): unknown {
  if (isStructuredError(err)) return err
  const code = errnoCode(err)
  if (code === 'ENOENT') return toolError('MM_NOT_FOUND', code)
  if (code === 'EBUSY' || code === 'EPERM') return toolError('MM_LOCKED', code)
  return toolError('MM_READ_FAILED', detailOf(err))
}

/** 保存期错误归一 */
function classifySaveError(err: unknown): unknown {
  if (isStructuredError(err)) return err
  const code = errnoCode(err)
  if (code === 'ENOENT') return toolError('MM_NOT_FOUND', code)
  if (code === 'EBUSY' || code === 'EPERM') return toolError('MM_LOCKED', code)
  return toolError('MM_SAVE_FAILED', code === '' ? detailOf(err) : code)
}

/** zod 校验：失败统一 MM_INVALID_PAYLOAD */
function parseOrThrow<T>(schema: ZodType<T>, payload: unknown): T {
  const parsed = schema.safeParse(payload)
  if (!parsed.success) {
    throw toolError('MM_INVALID_PAYLOAD', parsed.error.issues[0]?.message ?? '参数无效')
  }
  return parsed.data
}

/** 本地时间戳（草稿损坏文件名） */
function formatStamp(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join('')
}

/** 校验节点/深度上限 */
function assertLimits(data: unknown): void {
  if (countNodes(data) > MAX_NODES) throw toolError('MM_NODE_LIMIT', 'nodes')
  if (treeDepth(data) > MAX_DEPTH) throw toolError('MM_NODE_LIMIT', 'depth')
}

/**
 * 注册 8 条通道（测试可注入 deps）
 * @param ctx 主进程插件上下文
 * @param deps 文件系统与对话框依赖
 */
export function registerWith(ctx: MainPluginContext, deps: MindmapDeps = createNodeDeps()): void {
  const draftDir = join(ctx.paths.userData, 'mindmap')
  const draftPath = join(draftDir, 'draft.json')

  // —— open-dialog：系统文件选择（仅 .json） ——
  ctx.registerIpc('open-dialog', (): OpenDialogResult => {
    const path = deps.pickJsonFile()
    return openDialogResultSchema.parse(path === null ? null : { path })
  })

  // —— open-document：stat 预检 → 读取 → JSON 校验 → 原始数据交给渲染进程清洗 ——
  ctx.registerIpc('open-document', async ({ payload }): Promise<OpenDocumentResult> => {
    const { path } = parseOrThrow(openDocumentPayloadSchema, payload)
    let info: { size: number; mtimeMs: number; isFile(): boolean }
    try {
      info = await deps.stat(path)
    } catch (err) {
      throw classifyReadError(err)
    }
    if (!info.isFile()) throw toolError('MM_INVALID_PATH')
    if (info.size > MAX_DOC_BYTES) throw toolError('MM_DOC_TOO_LARGE', String(info.size))

    let bytes: Buffer
    try {
      bytes = await deps.readFile(path)
    } catch (err) {
      throw classifyReadError(err)
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(stripBom(bytes.toString('utf8')))
    } catch {
      throw toolError('MM_INVALID_DOCUMENT', 'JSON 解析失败')
    }
    const raw = parseOrThrow(rawDocumentSchema, parsed)
    assertLimits(raw)

    return openDocumentResultSchema.parse({
      path,
      name: basename(path),
      data: raw,
      warnings: [],
      size: info.size,
      mtimeMs: info.mtimeMs
    })
  })

  // —— save-document：mtime 冲突检测 → 序列化 → 原子写盘 ——
  ctx.registerIpc('save-document', async ({ payload }): Promise<SaveDocumentResult> => {
    const parsed = parseOrThrow(saveDocumentPayloadSchema, payload)
    assertLimits(parsed.data)

    if (parsed.expectedMtimeMs !== undefined) {
      let info: { mtimeMs: number; isFile(): boolean }
      try {
        info = await deps.stat(parsed.path)
      } catch (err) {
        throw classifySaveError(err)
      }
      if (!info.isFile()) throw toolError('MM_INVALID_PATH')
      if (parsed.expectedMtimeMs !== info.mtimeMs && parsed.force !== true) {
        throw toolError('MM_FILE_CHANGED')
      }
    }

    const text = JSON.stringify(parsed.data, null, 2)
    if (Buffer.byteLength(text, 'utf8') > MAX_DOC_BYTES) {
      throw toolError('MM_DOC_TOO_LARGE', String(Buffer.byteLength(text, 'utf8')))
    }
    try {
      await deps.mkdir(dirname(parsed.path))
      deps.writeAtomic(parsed.path, text)
    } catch (err) {
      throw classifySaveError(err)
    }

    let mtimeMs = deps.now().getTime()
    try {
      mtimeMs = (await deps.stat(parsed.path)).mtimeMs
    } catch {
      // 写盘已成功，mtime 读取失败时回退当前时间
    }
    return saveDocumentResultSchema.parse({ path: parsed.path, mtimeMs, warnings: [] })
  })

  // —— read-text-file：Markdown / OPML 读取（UTF-8，去 BOM） ——
  ctx.registerIpc('read-text-file', async ({ payload }): Promise<ReadTextFileResult> => {
    const { path } = parseOrThrow(readTextFilePayloadSchema, payload)
    let info: { size: number; isFile(): boolean }
    try {
      info = await deps.stat(path)
    } catch (err) {
      throw classifyReadError(err)
    }
    if (!info.isFile()) throw toolError('MM_INVALID_PATH')
    if (info.size > MAX_DOC_BYTES) throw toolError('MM_DOC_TOO_LARGE', String(info.size))
    let bytes: Buffer
    try {
      bytes = await deps.readFile(path)
    } catch (err) {
      throw classifyReadError(err)
    }
    return readTextFileResultSchema.parse({
      text: stripBom(bytes.toString('utf8')),
      size: info.size,
      name: basename(path)
    })
  })

  // —— write-export：JSON / Markdown / OPML / SVG / PNG 落盘 ——
  ctx.registerIpc('write-export', async ({ payload }): Promise<WriteExportResult> => {
    const parsed = parseOrThrow(writeExportPayloadSchema, payload)
    if (!EXPORT_EXTENSIONS.has(extname(parsed.path).toLowerCase())) {
      throw toolError('MM_INVALID_PATH')
    }
    const data =
      parsed.text !== undefined ? parsed.text : Buffer.from(parsed.base64 ?? '', 'base64')
    if (Buffer.byteLength(data) > MAX_EXPORT_BYTES) {
      throw toolError('MM_EXPORT_TOO_LARGE', String(Buffer.byteLength(data)))
    }
    try {
      await deps.mkdir(dirname(parsed.path))
      deps.writeAtomic(parsed.path, data)
    } catch (err) {
      throw toolError('MM_SAVE_FAILED', detailOf(err))
    }
    return writeExportResultSchema.parse({ path: parsed.path, size: Buffer.byteLength(data) })
  })

  // —— load-draft：读取草稿；损坏 → 改名留痕并返回 corrupt ——
  ctx.registerIpc('load-draft', async (): Promise<LoadDraftResult> => {
    let bytes: Buffer
    try {
      bytes = await deps.readFile(draftPath)
    } catch (err) {
      if (errnoCode(err) === 'ENOENT') return loadDraftResultSchema.parse({ status: 'empty' })
      throw classifyReadError(err)
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(stripBom(bytes.toString('utf8')))
    } catch {
      parsed = null
    }
    const draft = draftFileSchema.safeParse(parsed)
    if (
      !draft.success ||
      countNodes(draft.data.data) > MAX_NODES ||
      treeDepth(draft.data.data) > MAX_DEPTH
    ) {
      const corruptPath = join(draftDir, `draft.corrupt-${formatStamp(deps.now())}.json`)
      try {
        await deps.rename(draftPath, corruptPath)
      } catch (err) {
        ctx.log.warn(`草稿损坏且改名失败：${detailOf(err)}`)
      }
      ctx.log.warn('草稿损坏，已忽略并保留原文')
      return loadDraftResultSchema.parse({ status: 'corrupt' })
    }

    return loadDraftResultSchema.parse({
      status: 'ok',
      data: draft.data.data,
      savedAt: draft.data.savedAt,
      ...(draft.data.documentPath === undefined ? {} : { documentPath: draft.data.documentPath })
    })
  })

  // —— save-draft：超限拒绝（渲染进程暂停自动保存） ——
  ctx.registerIpc('save-draft', async ({ payload }): Promise<SaveDraftResult> => {
    const parsed = parseOrThrow(saveDraftPayloadSchema, payload)
    assertLimits(parsed.data)
    const savedAt = deps.now().toISOString()
    const text = JSON.stringify({
      savedAt,
      ...(parsed.documentPath === undefined ? {} : { documentPath: parsed.documentPath }),
      data: parsed.data
    })
    if (Buffer.byteLength(text, 'utf8') > MAX_DRAFT_BYTES) {
      throw toolError('MM_DRAFT_TOO_LARGE', String(Buffer.byteLength(text, 'utf8')))
    }
    try {
      await deps.mkdir(draftDir)
      deps.writeAtomic(draftPath, text)
    } catch (err) {
      throw toolError('MM_SAVE_FAILED', detailOf(err))
    }
    return saveDraftResultSchema.parse({ savedAt })
  })

  // —— clear-draft：不存在视为成功 ——
  ctx.registerIpc('clear-draft', async (): Promise<ClearDraftResult> => {
    try {
      await deps.unlink(draftPath)
    } catch (err) {
      if (errnoCode(err) !== 'ENOENT') throw toolError('MM_SAVE_FAILED', detailOf(err))
    }
    return clearDraftResultSchema.parse({})
  })

  ctx.log.info('mindmap registered')
}

/** 生产实现：node:fs + Electron dialog */
export function createNodeDeps(): MindmapDeps {
  return {
    stat: async (path) => {
      const info = await stat(path)
      return { size: info.size, mtimeMs: info.mtimeMs, isFile: () => info.isFile() }
    },
    readFile: (path) => readFile(path),
    writeAtomic: (target, data) => {
      writeAtomic(target, data)
    },
    rename: (from, to) => rename(from, to),
    mkdir: async (path) => {
      await mkdir(path, { recursive: true })
    },
    unlink: (path) => unlink(path),
    now: () => new Date(),
    pickJsonFile: () => {
      const result = dialog.showOpenDialogSync({
        title: '打开思维导图',
        filters: [{ name: '思维导图', extensions: ['json'] }],
        properties: ['openFile']
      })
      return result?.[0] ?? null
    }
  }
}

/** 壳注册入口（plugin-host 调用） */
export const registerMain: RegisterMain = (ctx) => {
  registerWith(ctx, createNodeDeps())
}
