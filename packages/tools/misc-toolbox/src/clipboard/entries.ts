/**
 * @file 轮询判定与列表展示纯函数（R1：核心纯函数 ≥80%，入口薄）
 * @author cuilanchao
 * @date 2026-11-24
 * @description 入库去重 / 上限淘汰 / 置顶排序 / 搜索与类型过滤 / 相对时间与字数、
 *              字节格式化；全部无 IO、无副作用，主进程通道与 renderer 共用同一套规则。
 */
import {
  MAX_ENTRIES,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_ENTRIES,
  MAX_TEXT_BYTES,
  type Entry
} from './schema'

/** UTF-8 字节长度（>100KB 跳过判定） */
export function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).length
}

/** 置顶组恒在最前，组内按 createdAt 倒序 */
export function sortEntries(items: readonly Entry[]): Entry[] {
  return [...items].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
    return b.createdAt - a.createdAt
  })
}

/** 上限淘汰：从尾部（最旧且未置顶）逐条丢弃，置顶条目永不淘汰 */
export function evictOverLimit(items: readonly Entry[]): Entry[] {
  const list = [...items]
  while (list.length > MAX_ENTRIES) {
    let oldestUnpinned = -1
    for (let i = list.length - 1; i >= 0; i -= 1) {
      const item = list[i]
      if (item !== undefined && !item.pinned) {
        oldestUnpinned = i
        break
      }
    }
    // 全为置顶：置顶永不淘汰（上限只约束未置顶条目）
    if (oldestUnpinned === -1) break
    list.splice(oldestUnpinned, 1)
  }
  return list
}

/** poll 判定结果：entry = 新条目或去重前移的目标；skipped = 跳过原因 */
export interface IngestOutcome {
  items: Entry[]
  entry: Entry | null
  skipped?: 'TOO_LARGE'
}

/**
 * poll 入库判定（spec §1.3）：空串 / 头部相同 / >100KB 跳过；
 * 与非头部条目相同则前移该条（去重，不新增）；新条目前插并按上限淘汰。
 */
export function ingestClipboard(
  items: readonly Entry[],
  text: string,
  now: number,
  newId: string
): IngestOutcome {
  if (text === '') return { items: [...items], entry: null }
  if (utf8ByteLength(text) > MAX_TEXT_BYTES)
    return { items: [...items], entry: null, skipped: 'TOO_LARGE' }

  const sorted = sortEntries(items)
  const head = sorted[0]
  if (head !== undefined && head.text === text) return { items: sorted, entry: null }

  const existing = sorted.find((entry) => entry.text === text)
  if (existing !== undefined) {
    const index = sorted.indexOf(existing)
    // 已在所属组首位：前移不改变展示位置，跳过避免轮询反复重写该条
    const firstOfGroup = sorted.findIndex((entry) => entry.pinned === existing.pinned)
    if (firstOfGroup === index) return { items: sorted, entry: null }
    const moved: Entry = { ...existing, createdAt: now }
    return {
      items: sortEntries(sorted.map((entry) => (entry.id === existing.id ? moved : entry))),
      entry: moved
    }
  }

  const created: Entry = { id: newId, text, createdAt: now, pinned: false, type: 'text' }
  return { items: evictOverLimit(sortEntries([created, ...sorted])), entry: created }
}

/** 图片条目附加元数据（SHA-1 内容去重 + 尺寸 + PNG 字节 + 缩略图 dataURL） */
export interface ImageIngestMeta {
  sha1: string
  width: number
  height: number
  bytes: number
  thumb: string
}

/**
 * poll 图片入库判定（spec §1.3）：>5MB 跳过；与头部图片条目 SHA-1 相同跳过；
 * 新图片条目前插（text 恒空串），并按图片独立上限 100 条淘汰（置顶永不淘汰）。
 */
export function ingestClipboardImage(
  items: readonly Entry[],
  meta: ImageIngestMeta,
  now: number,
  newId: string
): IngestOutcome {
  if (meta.bytes > MAX_IMAGE_BYTES) return { items: [...items], entry: null, skipped: 'TOO_LARGE' }

  const sorted = sortEntries(items)
  const headImage = sorted.find((entry) => entry.type === 'image')
  if (headImage !== undefined && headImage.sha1 === meta.sha1) {
    return { items: sorted, entry: null }
  }

  const created: Entry = {
    id: newId,
    text: '',
    createdAt: now,
    pinned: false,
    type: 'image',
    ...meta
  }
  return { items: evictImagesOverLimit(sortEntries([created, ...sorted])), entry: created }
}

/** 图片独立上限淘汰：仅统计图片条目（与文本 500 独立计数），最旧未置顶图片先出，置顶永不淘汰 */
export function evictImagesOverLimit(items: readonly Entry[]): Entry[] {
  const list = [...items]
  while (list.filter((entry) => entry.type === 'image').length > MAX_IMAGE_ENTRIES) {
    let oldestUnpinnedImage = -1
    for (let i = list.length - 1; i >= 0; i -= 1) {
      const item = list[i]
      if (item !== undefined && item.type === 'image' && !item.pinned) {
        oldestUnpinnedImage = i
        break
      }
    }
    // 图片全为置顶：置顶永不淘汰
    if (oldestUnpinnedImage === -1) break
    list.splice(oldestUnpinnedImage, 1)
  }
  return list
}

/** 置顶切换；id 不存在返回 null（调用方转 INVALID_INPUT） */
export function togglePinned(items: readonly Entry[], id: string): Entry[] | null {
  const target = items.find((entry) => entry.id === id)
  if (target === undefined) return null
  return sortEntries(
    items.map((entry) => (entry.id === id ? { ...entry, pinned: !entry.pinned } : entry))
  )
}

/** 单条删除；id 不存在返回 null（调用方转 INVALID_INPUT） */
export function removeEntry(items: readonly Entry[], id: string): Entry[] | null {
  if (!items.some((entry) => entry.id === id)) return null
  return items.filter((entry) => entry.id !== id)
}

/** 复制回写后的本地前移：同组前移到位（置顶组恒在最前）；id 不存在返回 null */
export function moveToFront(items: readonly Entry[], id: string, now: number): Entry[] | null {
  const target = items.find((entry) => entry.id === id)
  if (target === undefined) return null
  return sortEntries(items.map((entry) => (entry.id === id ? { ...entry, createdAt: now } : entry)))
}

/** poll 回包条目并入本地表（按 id 替换或追加后重排） */
export function upsertEntry(items: readonly Entry[], entry: Entry): Entry[] {
  const next = items.some((item) => item.id === entry.id)
    ? items.map((item) => (item.id === entry.id ? entry : item))
    : [...items, entry]
  return sortEntries(next)
}

/** 顶栏类型筛选（spec §1.1：全部 / 文本 / 图片，默认全部） */
export type EntryTypeFilter = 'all' | 'text' | 'image'

/** 过滤：类型筛选与搜索叠加；搜索词非空时排除图片条目（图片不参与搜索，spec §1.1） */
export function filterEntries(
  items: readonly Entry[],
  query: string,
  type: EntryTypeFilter = 'all'
): Entry[] {
  let list = [...items]
  if (type !== 'all') list = list.filter((entry) => entry.type === type)
  if (query === '') return list
  const keyword = query.toLowerCase()
  return list.filter((entry) => entry.type === 'text' && entry.text.toLowerCase().includes(keyword))
}

/** 条数徽标：共 N 条 · 置顶 M 条（随过滤更新） */
export function summarize(filtered: readonly Entry[]): string {
  const pinned = filtered.filter((entry) => entry.pinned).length
  return `共 ${filtered.length} 条 · 置顶 ${pinned} 条`
}

/** 相对时间：刚刚 / N 分钟前 / N 小时前（同日）/ 日期 */
export function formatRelativeTime(createdAt: number, now: number): string {
  const delta = now - createdAt
  if (delta < 60_000) return '刚刚'
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)} 分钟前`
  const created = new Date(createdAt)
  const current = new Date(now)
  const sameDay =
    created.getFullYear() === current.getFullYear() &&
    created.getMonth() === current.getMonth() &&
    created.getDate() === current.getDate()
  if (sameDay) return `${Math.floor(delta / 3_600_000)} 小时前`
  const month = String(created.getMonth() + 1).padStart(2, '0')
  const day = String(created.getDate()).padStart(2, '0')
  return `${created.getFullYear()}-${month}-${day}`
}

/** 字数与行数徽标：128 字 · 4 行 */
export function formatTextStats(text: string): string {
  const lines = text.split('\n').length
  return `${text.length} 字 · ${lines} 行`
}

/** 字节格式化（KB/MB 紧凑口径）：512B / 128.5KB / 2.1MB */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

/** 图片徽标：1920×1080 · 2.1MB（图片字段缺失返回空串） */
export function formatImageStats(item: Entry): string {
  if (item.width === undefined || item.height === undefined || item.bytes === undefined) return ''
  return `${item.width}×${item.height} · ${formatBytes(item.bytes)}`
}
