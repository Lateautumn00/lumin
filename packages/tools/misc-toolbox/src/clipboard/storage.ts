/**
 * @file 持久化存储（userData/clipboard-history.json 原子读写 + 孤儿图片清理）
 * @author cuilanchao
 * @date 2026-11-24
 * @description 读写经可注入 StorageFs（单测不触盘）；损坏/半写 JSON 删除重建空表
 *              （断电恢复口径，调用方记 electron-log warn）；非 ENOENT 读失败原样抛出，
 *              由通道包装为 CH_STORAGE_FAILED；启动加载后清理 JSON 未引用的孤儿 PNG。
 */
import { errnoCode } from './errors'
import { entriesFileSchema, type Entry } from './schema'

/** 存储文件系统能力（生产实现见 node.ts createDeps） */
export interface StorageFs {
  /** 读取文本；文件不存在抛 ENOENT，其他错误原样抛出 */
  readFile(path: string): string
  /** 删除文件（损坏重建用）；不存在时静默 */
  remove(path: string): void
  /** 原子写（node-kit writeAtomic：临时文件 + 重命名） */
  writeFile(path: string, data: string): void
}

/** 加载结果：corrupted 非空串 = 已按断电恢复口径重建空表 */
export interface LoadResult {
  entries: Entry[]
  corrupted: string
}

/**
 * 读取历史文件：ENOENT = 首次运行空表；JSON/结构损坏 = 删除重建空表；
 * 其他 IO 错误原样抛出（调用方转 CH_STORAGE_FAILED）。
 */
export function loadEntries(filePath: string, fs: StorageFs): LoadResult {
  let raw: string
  try {
    raw = fs.readFile(filePath)
  } catch (err) {
    if (errnoCode(err) === 'ENOENT') return { entries: [], corrupted: '' }
    throw err
  }
  try {
    const parsed = entriesFileSchema.safeParse(JSON.parse(raw))
    if (parsed.success) return { entries: parsed.data, corrupted: '' }
    return rebuild(fs, filePath, parsed.error.issues[0]?.message ?? '结构不符')
  } catch (err) {
    return rebuild(fs, filePath, err instanceof Error ? err.message : String(err))
  }
}

/** 原子落盘（失败原样抛出，调用方转 CH_STORAGE_FAILED 或记 warn） */
export function saveEntries(filePath: string, entries: readonly Entry[], fs: StorageFs): void {
  fs.writeFile(filePath, JSON.stringify(entries))
}

/** 损坏重建：删除坏文件（失败不阻断，下次保存覆盖）并返回空表 */
function rebuild(fs: StorageFs, filePath: string, reason: string): LoadResult {
  try {
    fs.remove(filePath)
  } catch {
    // 删除失败不阻断重建，后续原子写会覆盖
  }
  return { entries: [], corrupted: reason }
}

/** 图片文件能力（生产 = userData/clipboard-history/images 目录） */
export interface ImageFs {
  /** 列出图片文件名（{id}.png）；目录不存在抛 ENOENT（静默口径） */
  listFiles(): string[]
  /** 删除图片文件（按 id）；不存在时静默 */
  removeImage(id: string): void
}

/**
 * 孤儿 PNG 清理（崩溃残留口径，spec §1.3）：删除 JSON 未引用的图片文件，
 * 返回已删文件名；目录不存在（ENOENT）静默返回空，其他错误原样抛出（调用方 warn）。
 */
export function cleanupOrphanImages(entries: readonly Entry[], imageFs: ImageFs): string[] {
  let files: string[]
  try {
    files = imageFs.listFiles()
  } catch (err) {
    if (errnoCode(err) === 'ENOENT') return []
    throw err
  }
  const referenced = new Set(
    entries.filter((entry) => entry.type === 'image').map((entry) => `${entry.id}.png`)
  )
  const removed: string[] = []
  for (const file of files) {
    if (file.endsWith('.png') && !referenced.has(file)) {
      imageFs.removeImage(file.slice(0, -'.png'.length))
      removed.push(file)
    }
  }
  return removed
}
