/**
 * @file clipboard-history 主进程通道注册（5 同步通道 + 持久化）
 * @author cuilanchao
 * @date 2026-11-23
 * @description 内存表 + userData/clipboard-history.json 原子持久化（新条目防抖 500ms，
 *              pin/remove/clear 立即落盘）；poll 按 spec §1.3 判定入库（空串/头部相同/
 *              超限跳过、重复前移去重、上限 500 淘汰且置顶永不淘汰）。
 */
import { randomUUID } from 'node:crypto'
import { readFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { clipboard } from 'electron'
import { writeAtomic } from '@lumin/node-kit'
import type { MainPluginContext, RegisterMain } from '@lumin/plugin-api'
import { ingestClipboard, removeEntry, sortEntries, togglePinned } from './entries'
import { errnoCode, isStructuredError, toolError } from './errors'
import {
  emptyPayloadSchema,
  idPayloadSchema,
  listResultSchema,
  okResultSchema,
  pollResultSchema,
  type Entry
} from './schema'
import { loadEntries, saveEntries, type StorageFs } from './storage'

/** 持久化文件固定名（落 ctx.paths.userData，即 app.getPath('userData')） */
export const STORAGE_FILE_NAME = 'clipboard-history.json'
/** 新条目落盘防抖（轮询高频写合并） */
export const SAVE_DEBOUNCE_MS = 500

/** 通道依赖（测试可整体注入，不触真实剪贴板/磁盘） */
export interface ClipboardHistoryDeps {
  /** 读取系统剪贴板文本（生产 = electron clipboard.readText，Electron 45 为 Promise） */
  readClipboardText(): string | Promise<string>
  /** 存储文件绝对路径 */
  filePath: string
  /** 存储文件系统能力（生产 = node fs + node-kit writeAtomic） */
  fs: StorageFs
  /** 时间源（单测注入） */
  now(): number
  /** 条目 id 生成（单测注入） */
  newId(): string
  /** 落盘防抖毫秒（单测注入 0） */
  debounceMs?: number
}

/**
 * 注册 5 同步通道（测试可注入 deps）
 * @param ctx 主进程插件上下文
 * @param deps 通道依赖
 */
export function registerWith(
  ctx: MainPluginContext,
  deps: ClipboardHistoryDeps = createDefaultDeps(ctx)
): void {
  let entries: Entry[] = []
  let loaded = false
  let saveTimer: ReturnType<typeof setTimeout> | undefined
  const debounceMs = deps.debounceMs ?? SAVE_DEBOUNCE_MS

  /** 惰性加载（幂等）：损坏 JSON 重建空表 + warn；非 ENOENT 读失败抛出 */
  function ensureLoaded(): void {
    if (loaded) return
    const result = loadEntries(deps.filePath, deps.fs)
    if (result.corrupted !== '') {
      ctx.log.warn(`剪贴板历史存储损坏，已重建空表：${result.corrupted}`)
    }
    entries = sortEntries(result.entries)
    loaded = true
  }

  /** 立即落盘（pin/remove/clear 等单次用户操作；失败原样抛出） */
  function persistNow(): void {
    if (saveTimer !== undefined) {
      clearTimeout(saveTimer)
      saveTimer = undefined
    }
    saveEntries(deps.filePath, entries, deps.fs)
  }

  /** 防抖落盘（poll 高频写合并；后台失败仅记 warn，内存态继续可用） */
  function scheduleSave(): void {
    if (saveTimer !== undefined) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saveTimer = undefined
      try {
        saveEntries(deps.filePath, entries, deps.fs)
      } catch (err) {
        ctx.log.warn('剪贴板历史持久化失败', err)
      }
    }, debounceMs)
  }

  /** 存储异常统一包装 CH_STORAGE_FAILED（结构化错误原样透传） */
  function withStorage<T>(fn: () => T): T {
    try {
      return fn()
    } catch (err) {
      if (isStructuredError(err)) throw err
      throw toolError('CH_STORAGE_FAILED', detailOf(err))
    }
  }

  /** list：全量（置顶前、组内 createdAt 倒序） */
  ctx.registerIpc('list', ({ payload }) => {
    requireEmptyPayload(payload)
    return listResultSchema.parse(
      withStorage(() => {
        ensureLoaded()
        return { items: sortEntries(entries) }
      })
    )
  })

  /** poll：剪贴板变化判定入库，返回新条目供 renderer 前移 */
  ctx.registerIpc('poll', async ({ payload }) => {
    requireEmptyPayload(payload)
    withStorage(ensureLoaded)
    const text = await deps.readClipboardText()
    const outcome = ingestClipboard(entries, text, deps.now(), deps.newId())
    entries = outcome.items
    if (outcome.entry !== null) scheduleSave()
    return pollResultSchema.parse({
      entry: outcome.entry,
      ...(outcome.skipped !== undefined ? { skipped: outcome.skipped } : {})
    })
  })

  /** pin：切换置顶（置顶组恒在最前），立即落盘 */
  ctx.registerIpc('pin', ({ payload }) => {
    const id = requireIdPayload(payload)
    withStorage(() => {
      ensureLoaded()
      const next = togglePinned(entries, id)
      if (next === null) throw toolError('INVALID_INPUT', '条目不存在')
      entries = next
      persistNow()
    })
    return okResultSchema.parse({ ok: true })
  })

  /** remove：单条删除（置顶同样可删），立即落盘 */
  ctx.registerIpc('remove', ({ payload }) => {
    const id = requireIdPayload(payload)
    withStorage(() => {
      ensureLoaded()
      const next = removeEntry(entries, id)
      if (next === null) throw toolError('INVALID_INPUT', '条目不存在')
      entries = next
      persistNow()
    })
    return okResultSchema.parse({ ok: true })
  })

  /** clear：清空全部历史（含置顶），立即落盘 */
  ctx.registerIpc('clear', ({ payload }) => {
    requireEmptyPayload(payload)
    withStorage(() => {
      ensureLoaded()
      entries = []
      persistNow()
    })
    return okResultSchema.parse({ ok: true })
  })

  ctx.log.info('clipboard-history registered')
}

/** 生产注册入口（壳 tool-mains.ts 调用） */
export const registerMain: RegisterMain = (ctx) => registerWith(ctx)

/** 生产依赖：electron 剪贴板 + node fs + node-kit 原子写 */
export function createDefaultDeps(ctx: MainPluginContext): ClipboardHistoryDeps {
  return {
    readClipboardText: () => clipboard.readText(),
    filePath: join(ctx.paths.userData, STORAGE_FILE_NAME),
    fs: {
      readFile: (path) => readFileSync(path, 'utf8'),
      remove: (path) => {
        try {
          unlinkSync(path)
        } catch {
          // 文件已不存在：损坏重建时删除失败不阻断
        }
      },
      writeFile: (path, data) => writeAtomic(path, data)
    },
    now: () => Date.now(),
    newId: () => randomUUID()
  }
}

/** 空入参信封校验（list/poll/clear） */
function requireEmptyPayload(payload: unknown): void {
  const parsed = emptyPayloadSchema.safeParse(payload)
  if (!parsed.success) {
    throw toolError('INVALID_INPUT', parsed.error.issues[0]?.message ?? '参数无效')
  }
}

/** id 入参信封校验（pin/remove） */
function requireIdPayload(payload: unknown): string {
  const parsed = idPayloadSchema.safeParse(payload)
  if (!parsed.success) {
    throw toolError('INVALID_INPUT', parsed.error.issues[0]?.message ?? '参数无效')
  }
  return parsed.data.id
}

/** 异常详情：优先 errno，其次 Error.message */
function detailOf(err: unknown): string {
  const code = errnoCode(err)
  if (code !== '') return code
  return err instanceof Error ? err.message : String(err)
}
