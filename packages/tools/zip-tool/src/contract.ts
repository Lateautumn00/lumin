/**
 * @file contract.ts 压缩包路径与命名纯函数（renderer / worker 共用，单一真相源）
 * @author cuilanchao
 * @date 2026-11-20
 * @description zip slip 防护的路径归一、条目键、默认命名、源去重与进度百分比；
 *              不依赖 node:path，renderer 与 worker 均可直接使用（spec §4）
 */

/** Windows 盘符前缀（`C:`） */
const DRIVE_PREFIX = /^[a-zA-Z]:/

/** 控制字符（含 NUL）；文件名不允许出现 */
const CONTROL_CHARS = /[\u0000-\u001f]/

/** Unicode 替换符（解码失败标记） */
const REPLACEMENT_CHAR = '\ufffd'

/** fflate 在 bit11 未置位时按 latin1 解码，GBK 高阶字节落在 U+0080–U+00FF */
const LATIN1_HIGH_BYTES = /[\u0080-\u00ff]/

/** GBK（CP936）解码；含替换符或运行环境不支持时返回 null */
function decodeGbk(bytes: Uint8Array): string | null {
  try {
    const decoded = new TextDecoder('gbk').decode(bytes)
    return decoded.includes(REPLACEMENT_CHAR) ? null : decoded
  } catch {
    return null
  }
}

/**
 * 条目名原始字节 → 文本：优先 UTF-8；bit11 未置位且 UTF-8 解码含替换符时回退 GBK
 * @param bytes 条目名原始字节
 * @param efs 通用标志位 bit11（UTF-8 名）是否置位
 */
export function decodeZipEntryName(bytes: Uint8Array, efs: boolean): string {
  const utf8 = new TextDecoder().decode(bytes)
  if (efs || !utf8.includes(REPLACEMENT_CHAR)) return utf8
  return decodeGbk(bytes) ?? utf8
}

/**
 * fflate `UnzipFile.name` 纠偏：bit11 未置位时 fflate 按 latin1 解码，GBK 名会变成 U+0080–U+00FF
 * @returns 转码成功的中文名；非 latin1 高字节时原样返回；疑似编码损坏（无法 GBK 解码）返回 null
 */
export function decodeLegacyEntryName(name: string): string | null {
  if (name.includes(REPLACEMENT_CHAR) || !LATIN1_HIGH_BYTES.test(name)) return name
  return decodeGbk(Uint8Array.from(name, (ch) => ch.charCodeAt(0) & 0xff))
}

/**
 * 归一条目路径并做 zip slip 判定
 * @param raw 压缩包内条目原始名（可能为 `\` 分隔或含 `..`）
 * @returns 安全相对路径（`/` 分隔）；非法（绝对路径/盘符/UNC/`..`/空/控制字符）返回 null
 */
export function normalizeArchivePath(raw: string): string | null {
  if (raw === '' || CONTROL_CHARS.test(raw)) return null
  const text = raw.replace(/\\/g, '/')
  // 绝对路径 / UNC（`/x`、`//server`）一律拒绝
  if (text.startsWith('/')) return null
  if (DRIVE_PREFIX.test(text)) return null
  const segments = text.split('/').filter((segment) => segment !== '' && segment !== '.')
  if (segments.length === 0) return null
  if (segments.some((segment) => segment === '..' || segment.includes(':'))) return null
  return segments.join('/')
}

/** 条目比较键（Windows 大小写不敏感） */
export function entryKey(name: string): string {
  return name.toLowerCase()
}

/**
 * 条目路径拼接（`/` 分隔，忽略空段）
 * @param parent 父路径（可为空）
 * @param name 子名称
 */
export function joinArchivePath(parent: string, name: string): string {
  const left = parent.replace(/^\/+|\/+$/g, '')
  const right = name.replace(/^\/+|\/+$/g, '')
  if (left === '') return right
  if (right === '') return left
  return `${left}/${right}`
}

/** 是否 .zip 文件名（大小写不敏感，且基名非空） */
export function isZipFileName(name: string): boolean {
  return name.length > 4 && /\.zip$/i.test(name)
}

/** 去首尾分隔符后的基名（路径最后一段） */
function lastSegment(filePath: string): string {
  const text = filePath.replace(/[\\/]+$/, '')
  const index = Math.max(text.lastIndexOf('/'), text.lastIndexOf('\\'))
  return index === -1 ? text : text.slice(index + 1)
}

/**
 * 依据首个源推导默认 zip 文件名
 * @param sources 源路径列表（文件或目录）
 * @returns `{基名}.zip`；基名为空时回退 `打包.zip`
 */
export function defaultArchiveName(sources: readonly string[]): string {
  const first = sources.find((source) => source !== '')
  const base = first === undefined ? '' : lastSegment(first)
  return base === '' ? '打包.zip' : `${base}.zip`
}

/**
 * 依据压缩包路径推导默认解压目标目录（同目录同名文件夹）
 * @param archivePath 压缩包绝对路径
 * @returns `{父目录}/{去扩展名}`；无 .zip 扩展名时追加 `-解压`
 */
export function defaultTargetDir(archivePath: string): string {
  const text = archivePath.replace(/[\\/]+$/, '')
  const index = Math.max(text.lastIndexOf('/'), text.lastIndexOf('\\'))
  const dir = index === -1 ? '' : text.slice(0, index)
  const name = index === -1 ? text : text.slice(index + 1)
  const stem = isZipFileName(name) ? name.slice(0, -4) : `${name}-解压`
  if (dir === '') return stem
  const separator = dir.includes('\\') ? '\\' : '/'
  return `${dir}${separator}${stem}`
}

/**
 * 按目录风格拼接绝对路径（renderer 无 node:path）
 * @param dir 目录
 * @param name 文件/目录名
 */
export function joinFsPath(dir: string, name: string): string {
  if (dir === '') return name
  const separator = dir.includes('\\') ? '\\' : '/'
  const left = dir.replace(/[\\/]+$/, '')
  const right = name.replace(/^[\\/]+/, '')
  return `${left}${separator}${right}`
}

/**
 * 取父目录（renderer 无 node:path；根路径返回空串）
 * @param filePath 文件或目录路径
 */
export function parentDirectory(filePath: string): string {
  const text = filePath.replace(/[\\/]+$/, '')
  const index = Math.max(text.lastIndexOf('/'), text.lastIndexOf('\\'))
  return index <= 0 ? '' : text.slice(0, index)
}

/**
 * 源列表去重（大小写不敏感）并过滤空串，保持首次出现顺序
 * @param sources 用户添加的源（文件或目录）
 */
export function partitionSourcePaths(sources: readonly string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const source of sources) {
    if (source === '') continue
    const key = entryKey(source.replace(/[\\/]+$/, ''))
    if (seen.has(key)) continue
    seen.add(key)
    result.push(source)
  }
  return result
}

/**
 * 进度百分比（0–100 整数）
 * @param current 已完成条目
 * @param total 总条目
 */
export function progressPercent(current: number, total: number): number {
  if (total <= 0) return 0
  const ratio = (Math.max(0, current) / total) * 100
  return Math.min(100, Math.max(0, Math.round(ratio)))
}

/**
 * 压缩包内条目重名自动递增：仅对最后一段文件名加 ` (n)`，目录前缀原样保留
 * （Windows 大小写不敏感比较，spec §1.2）
 * @param existing 已占用条目名集合
 * @param candidate 期望条目名（`/` 分隔）
 */
export function uniqueArchiveEntryName(
  existing: ReadonlySet<string>,
  candidate: string
): string {
  const occupied = new Set([...existing].map(entryKey))
  if (!occupied.has(entryKey(candidate))) return candidate
  const slash = candidate.lastIndexOf('/')
  const dir = slash === -1 ? '' : candidate.slice(0, slash + 1)
  const name = slash === -1 ? candidate : candidate.slice(slash + 1)
  const dot = name.lastIndexOf('.')
  const base = dot <= 0 ? name : name.slice(0, dot)
  const ext = dot <= 0 ? '' : name.slice(dot)
  for (let n = 1; ; n += 1) {
    const next = `${dir}${base} (${n})${ext}`
    if (!occupied.has(entryKey(next))) return next
  }
}
