/**
 * @file 纯函数层：规则解析、目录树渲染、空目录判定、时间格式化、分批
 * @author cuilanchao
 * @date 2026-11-21
 * @description 无 fs 依赖，全部可在 renderer / 主进程 / 单测复用（AGENTS §7.1 纯函数 ≥80%）
 */

/** 目录树节点（children 已按「目录优先 + 名称升序」排序后传入） */
export interface TreeNode {
  name: string
  kind: 'dir' | 'file'
  children: TreeNode[]
}

/** 目录树渲染结果 */
export interface TreeText {
  text: string
  dirs: number
  files: number
  truncated: boolean
}

/** 主进程扫描后交给空目录判定的目录记录 */
export interface DirEntry {
  path: string
  /** 直接子目录绝对路径 */
  childDirs: string[]
  /** 直接非目录条目数（含符号链接，避免误判空目录） */
  fileCount: number
}

/** 规则文本切分符（换行 / 逗号 / 分号，含全角） */
const RULE_SEPARATORS = /[,;\n\r，；]+/

/**
 * 解析排除规则文本：切分、去空、小写、去重（保持首次出现顺序）
 * @param input 文本域原文
 */
export function parsePatterns(input: string): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const raw of input.split(RULE_SEPARATORS)) {
    const item = raw.trim().toLowerCase()
    if (item === '' || seen.has(item)) continue
    seen.add(item)
    result.push(item)
  }
  return result
}

/**
 * 解析扩展名规则文本：切分、去前导点、小写、去重
 * @param input 输入框原文
 */
export function parseExtensions(input: string): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const raw of input.split(RULE_SEPARATORS)) {
    const item = raw.trim().toLowerCase().replace(/^\.+/, '')
    if (item === '' || seen.has(item)) continue
    seen.add(item)
    result.push(item)
  }
  return result
}

/** 通配符转正则（仅支持 `*`，大小写不敏感） */
function wildcardToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
  return new RegExp(`^${escaped}$`, 'i')
}

/**
 * 名称是否命中排除规则（精确或 `*` 通配，大小写不敏感）
 * @param name 文件/目录名
 * @param patterns parsePatterns 结果
 */
export function isExcluded(name: string, patterns: readonly string[]): boolean {
  if (patterns.length === 0) return false
  const target = name.toLowerCase()
  for (const pattern of patterns) {
    if (!pattern.includes('*')) {
      if (pattern === target) return true
      continue
    }
    if (wildcardToRegExp(pattern).test(name)) return true
  }
  return false
}

/**
 * 文件名是否命中扩展名规则（空规则集恒为 false；无扩展名不匹配）
 * @param fileName 文件名（非完整路径）
 * @param extensions parseExtensions 结果
 */
export function matchesExtensions(fileName: string, extensions: readonly string[]): boolean {
  if (extensions.length === 0) return false
  const index = fileName.lastIndexOf('.')
  if (index <= 0 || index === fileName.length - 1) return false
  const ext = fileName.slice(index + 1).toLowerCase()
  return extensions.includes(ext)
}

/**
 * 渲染目录树为 Box-drawing 文本
 * @param root 根节点（name 作为首行）
 * @param options.maxDepth 展开层数（1 = 只列一层子项）
 */
export function renderTree(root: TreeNode, options: { maxDepth: number }): TreeText {
  const lines: string[] = [root.name]
  let dirs = 0
  let files = 0
  let truncated = false

  const walk = (node: TreeNode, prefix: string, depth: number): void => {
    const total = node.children.length
    for (let index = 0; index < total; index += 1) {
      const child = node.children[index]
      if (child === undefined) continue
      const last = index === total - 1
      const branch = last ? '└── ' : '├── '
      const label = child.kind === 'dir' ? `${child.name}/` : child.name
      lines.push(`${prefix}${branch}${label}`)
      if (child.kind === 'file') {
        files += 1
        continue
      }
      dirs += 1
      if (depth >= options.maxDepth) {
        if (child.children.length > 0) truncated = true
        continue
      }
      walk(child, `${prefix}${last ? '    ' : '│   '}`, depth + 1)
    }
  }

  walk(root, '', 1)
  return { text: lines.join('\n'), dirs, files, truncated }
}

/** 路径深度（按分隔符计数；根为 0） */
function depthOf(path: string): number {
  return path.split(/[\\/]+/).filter((part) => part !== '').length
}

/**
 * 判定空目录（自底向上：子目录全空则父目录也算空），返回深度降序（深层在前）
 * @param root 扫描根目录（自身不参与判定）
 * @param entries 主进程收集的目录记录（无法读取的目录不应出现在此表中）
 */
export function findEmptyDirs(root: string, entries: readonly DirEntry[]): string[] {
  const byPath = new Map<string, DirEntry>()
  for (const entry of entries) byPath.set(entry.path, entry)
  const memo = new Map<string, boolean>()
  const visiting = new Set<string>()

  const isEmpty = (path: string): boolean => {
    const cached = memo.get(path)
    if (cached !== undefined) return cached
    const entry = byPath.get(path)
    if (entry === undefined || visiting.has(path)) return false
    visiting.add(path)
    let empty = entry.fileCount === 0
    if (empty) {
      for (const child of entry.childDirs) {
        if (!isEmpty(child)) {
          empty = false
          break
        }
      }
    }
    visiting.delete(path)
    memo.set(path, empty)
    return empty
  }

  const result = entries
    .filter((entry) => entry.path !== root && isEmpty(entry.path))
    .map((entry) => entry.path)
  result.sort((a, b) => depthOf(b) - depthOf(a) || a.localeCompare(b))
  return result
}

/** 两位补零 */
function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value)
}

const DATE_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/

/**
 * 解析 `YYYY-MM-DD HH:mm`（或 ISO 的 `T` 分隔）为本地时间 epoch ms
 * @param text 输入文本
 * @returns 非法（含不存在的日期）返回 null
 */
export function parseDateTime(text: string): number | null {
  const matched = DATE_TIME_PATTERN.exec(text.trim())
  if (matched === null) return null
  const year = Number(matched[1])
  const month = Number(matched[2])
  const day = Number(matched[3])
  const hour = Number(matched[4])
  const minute = Number(matched[5])
  const second = matched[6] === undefined ? 0 : Number(matched[6])
  const date = new Date(year, month - 1, day, hour, minute, second, 0)
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day ||
    date.getHours() !== hour ||
    date.getMinutes() !== minute ||
    date.getSeconds() !== second
  ) {
    return null
  }
  return date.getTime()
}

/**
 * 格式化 epoch ms 为 `YYYY-MM-DD HH:mm`（本地时间）
 * @param ms 时间戳
 */
export function formatDateTime(ms: number): string {
  const date = new Date(ms)
  const ymd = `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
  return `${ymd} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}

/**
 * 按批切分路径（回收站单批 ≤200）
 * @param paths 待处理路径
 * @param size 批大小
 */
export function chunkPaths(paths: readonly string[], size: number): string[][] {
  const step = Math.max(1, Math.floor(size))
  const batches: string[][] = []
  for (let index = 0; index < paths.length; index += step) {
    batches.push(paths.slice(index, index + step))
  }
  return batches
}
