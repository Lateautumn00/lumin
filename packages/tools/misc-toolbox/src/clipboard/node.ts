/**
 * @file clipboard-history 主进程通道注册（7 同步通道 + 持久化 + 图片文件）
 * @author cuilanchao
 * @date 2026-11-24
 * @description 内存表 + userData/clipboard-history.json 原子持久化（新条目防抖 500ms，
 *              pin/remove/clear 立即落盘）；poll 图片优先判定（spec §1.3：readImage 非空
 *              走图片分支，>5MB 跳过、SHA-1 与头部图片条目去重、先同步写 PNG 再防抖写
 *              JSON；图片为空走 M59 文本分支）；原图存 clipboard-history/images/{id}.png，
 *              加载后清理孤儿 PNG；remove/clear 同步删图（失败仅 warn）。
 *              剪贴板图片读写经 Electron 45 W3C 口径：readImage/writeImage 已移除，
 *              改 clipboard.read()/write() + ClipboardItem（异步）。
 */
import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ClipboardItem, clipboard, nativeImage } from 'electron'
import { writeAtomic } from '@lumin/node-kit'
import type { MainPluginContext, RegisterMain } from '@lumin/plugin-api'
import {
  ingestClipboard,
  ingestClipboardImage,
  removeEntry,
  sortEntries,
  togglePinned
} from './entries'
import { errnoCode, isStructuredError, toolError } from './errors'
import {
  MAX_IMAGE_BYTES,
  THUMB_WIDTH,
  emptyPayloadSchema,
  idPayloadSchema,
  imageResultSchema,
  listResultSchema,
  okResultSchema,
  pollResultSchema,
  type Entry
} from './schema'
import { cleanupOrphanImages, loadEntries, saveEntries, type StorageFs } from './storage'

/** 持久化文件固定名（落 ctx.paths.userData，即 app.getPath('userData')） */
export const STORAGE_FILE_NAME = 'clipboard-history.json'
/** 图片子目录名（userData/clipboard-history/images/{id}.png） */
export const IMAGES_DIR_NAME = 'clipboard-history/images'
/** 新条目落盘防抖（轮询高频写合并） */
export const SAVE_DEBOUNCE_MS = 500

/** 剪贴板图片（readClipboardImage 返回值） */
export interface ClipboardImage {
  /** PNG 内容字节 */
  png: Buffer
  width: number
  height: number
}

/** 通道依赖（测试可整体注入，不触真实剪贴板/磁盘） */
export interface ClipboardHistoryDeps {
  /** 读取系统剪贴板文本（生产 = electron clipboard.readText，Electron 45 为 Promise） */
  readClipboardText(): string | Promise<string>
  /** 读取系统剪贴板图片（生产 = clipboard.read() 找 image/png；空图返回 null，图片优先判定用） */
  readClipboardImage(): Promise<ClipboardImage | null>
  /** 缩略图生成（生产 = nativeImage resize 到宽 160 → toPNG → dataURL） */
  makeThumb(png: Buffer, width: number): string
  /** 图片存储目录绝对路径 */
  imageDir: string
  /** 读取原图 PNG（不存在抛 ENOENT，调用方转 CH_IMAGE_MISSING） */
  readImageFile(id: string): Buffer
  /** 同步写原图 PNG（新条目先写文件再防抖写 JSON） */
  writeImageFile(id: string, png: Buffer): void
  /** 删除原图 PNG（remove/clear 用，失败由调用方 warn 不阻断） */
  removeImageFile(id: string): void
  /** 列出图片文件名（孤儿清理用；目录不存在抛 ENOENT） */
  listImageFiles(): string[]
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
 * 注册 7 同步通道（测试可注入 deps）
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
    // 启动加载后清理孤儿 PNG（崩溃残留）；失败仅 warn 不阻断
    try {
      const removed = cleanupOrphanImages(entries, {
        listFiles: deps.listImageFiles,
        removeImage: deps.removeImageFile
      })
      if (removed.length > 0) ctx.log.warn(`已清理孤儿剪贴板图片 ${removed.length} 个`)
    } catch (err) {
      ctx.log.warn('孤儿剪贴板图片清理失败', err)
    }
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

  /** 读原图：ENOENT → CH_IMAGE_MISSING（可重试，重试 = 重新 list 移除幽灵条目） */
  function readPng(id: string): Buffer {
    try {
      return deps.readImageFile(id)
    } catch (err) {
      if (errnoCode(err) === 'ENOENT') throw toolError('CH_IMAGE_MISSING')
      throw err
    }
  }

  /** 图片条目校验（image/copy 通道共用）：id 必须指向图片条目 */
  function requireImageEntry(id: string): void {
    const entry = entries.find((item) => item.id === id)
    if (entry === undefined || entry.type !== 'image') {
      throw toolError('INVALID_INPUT', '条目不存在')
    }
  }

  /** 删除图片文件（remove/clear 用）：失败仅 warn 不阻断 */
  function removeImageQuietly(id: string): void {
    try {
      deps.removeImageFile(id)
    } catch (err) {
      ctx.log.warn('剪贴板图片文件删除失败', err)
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

  /** poll：剪贴板变化判定入库（图片优先），返回新条目供 renderer 前移 */
  ctx.registerIpc('poll', async ({ payload }) => {
    requireEmptyPayload(payload)
    withStorage(ensureLoaded)

    // 图片优先判定（spec §1.3）：剪贴板含图片即走图片分支（忽略文本，防截图路径污染）
    const image = await deps.readClipboardImage()
    if (image !== null) {
      if (image.png.length > MAX_IMAGE_BYTES) {
        return pollResultSchema.parse({ entry: null, skipped: 'TOO_LARGE' })
      }
      const sha1 = createHash('sha1').update(image.png).digest('hex')
      const outcome = ingestClipboardImage(
        entries,
        {
          sha1,
          width: image.width,
          height: image.height,
          bytes: image.png.length,
          thumb: deps.makeThumb(image.png, image.width)
        },
        deps.now(),
        deps.newId()
      )
      const created = outcome.entry
      if (created !== null) {
        // 先同步写 PNG 文件，再提交内存表并防抖写 JSON（防 JSON 引用缺失文件）
        withStorage(() => deps.writeImageFile(created.id, image.png))
        entries = outcome.items
        scheduleSave()
        return pollResultSchema.parse({ entry: created })
      }
      entries = outcome.items
      return pollResultSchema.parse({ entry: null })
    }

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

  /** remove：单条删除（置顶同样可删），图片条目同步删 PNG，立即落盘 */
  ctx.registerIpc('remove', ({ payload }) => {
    const id = requireIdPayload(payload)
    withStorage(() => {
      ensureLoaded()
      const target = entries.find((entry) => entry.id === id)
      const next = removeEntry(entries, id)
      if (next === null || target === undefined) throw toolError('INVALID_INPUT', '条目不存在')
      entries = next
      persistNow()
      if (target.type === 'image') removeImageQuietly(id)
    })
    return okResultSchema.parse({ ok: true })
  })

  /** clear：清空全部历史（含置顶）+ 删全部图片文件，立即落盘 */
  ctx.registerIpc('clear', ({ payload }) => {
    requireEmptyPayload(payload)
    withStorage(() => {
      ensureLoaded()
      const imageIds = entries.filter((entry) => entry.type === 'image').map((entry) => entry.id)
      entries = []
      persistNow()
      for (const id of imageIds) removeImageQuietly(id)
    })
    return okResultSchema.parse({ ok: true })
  })

  /** image：原图 dataURL（打开预览时按需读取），文件缺失 → CH_IMAGE_MISSING */
  ctx.registerIpc('image', ({ payload }) => {
    const id = requireIdPayload(payload)
    return imageResultSchema.parse(
      withStorage(() => {
        ensureLoaded()
        requireImageEntry(id)
        return { dataUrl: `data:image/png;base64,${readPng(id).toString('base64')}` }
      })
    )
  })

  /** copy：主进程读 PNG 经 clipboard.write + ClipboardItem 回写（渲染端写不了图），缺失同码 */
  ctx.registerIpc('copy', async ({ payload }) => {
    const id = requireIdPayload(payload)
    await withStorage(async () => {
      ensureLoaded()
      requireImageEntry(id)
      const png = nativeImage.createFromBuffer(readPng(id)).toPNG()
      await clipboard.write([
        new ClipboardItem({ 'image/png': new Blob([new Uint8Array(png)], { type: 'image/png' }) })
      ])
    })
    return okResultSchema.parse({ ok: true })
  })

  ctx.log.info('misc-toolbox clipboard registered')
}

/** 生产注册入口（壳 tool-mains.ts 调用） */
export const registerMain: RegisterMain = (ctx) => registerWith(ctx)

/** 生产依赖：electron 剪贴板（Electron 45 W3C 口径）+ node fs + node-kit 原子写 */
export function createDefaultDeps(ctx: MainPluginContext): ClipboardHistoryDeps {
  const imageDir = join(ctx.paths.userData, IMAGES_DIR_NAME)
  return {
    readClipboardText: () => clipboard.readText(),
    readClipboardImage: async () => {
      const items = await clipboard.read()
      const pngItem = items.find((item) => item.types.includes('image/png'))
      if (pngItem === undefined) return null
      const blob = await pngItem.getType('image/png')
      const png = Buffer.from(await blob.arrayBuffer())
      if (png.length === 0) return null
      const size = nativeImage.createFromBuffer(png).getSize()
      return { png, width: size.width, height: size.height }
    },
    makeThumb: (png, width) => {
      const source = nativeImage.createFromBuffer(png)
      const target = width > THUMB_WIDTH ? source.resize({ width: THUMB_WIDTH }) : source
      return `data:image/png;base64,${target.toPNG().toString('base64')}`
    },
    imageDir,
    readImageFile: (id) => readFileSync(join(imageDir, `${id}.png`)),
    writeImageFile: (id, png) => {
      mkdirSync(imageDir, { recursive: true })
      writeFileSync(join(imageDir, `${id}.png`), png)
    },
    removeImageFile: (id) => {
      try {
        unlinkSync(join(imageDir, `${id}.png`))
      } catch {
        // 文件已不存在：删除失败不阻断（孤儿清理兜底）
      }
    },
    listImageFiles: () => readdirSync(imageDir),
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

/** id 入参信封校验（pin/remove/image/copy） */
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
