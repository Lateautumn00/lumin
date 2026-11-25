/**
 * @file 扩展名 → 编辑器语言 / EOL 映射 / 路径拆分等纯函数
 * @author cuilanchao
 * @date 2026-11-22
 * @description renderer 与主进程共用（无 node 依赖）：语言判定、NUL 检测、EOL 枚举互转。
 */
import type { Eol } from '@lumin/shared'

/** 打开上限（字节，spec §4：5MiB） */
export const TEXT_EDITOR_MAX_BYTES = 5 * 1024 * 1024

/** CodeMirror 语法高亮语言（其余纯文本） */
export type EditorLanguage = 'markdown' | 'json' | 'javascript'

/** EOL 枚举（跨 IPC 可序列化） */
export type EolKind = 'lf' | 'crlf' | 'cr'

/** Markdown 扩展名 */
const MARKDOWN_EXTENSIONS = ['md', 'markdown'] as const

/** JSON 扩展名 */
const JSON_EXTENSIONS = ['json'] as const

/** JS/TS 扩展名（共用 javascript 语言包） */
const JAVASCRIPT_EXTENSIONS = ['js', 'ts', 'jsx', 'tsx', 'mjs', 'cjs'] as const

/**
 * 取扩展名（小写、无点）；无扩展名/隐藏文件（如 .gitignore）返回 null
 * @param path 文件路径（兼容 `\` 与 `/`）
 */
export function extensionOf(path: string): string | null {
  const name = path.split(/[\\/]/).pop() ?? ''
  const dot = name.lastIndexOf('.')
  if (dot <= 0 || dot === name.length - 1) return null
  return name.slice(dot + 1).toLowerCase()
}

/**
 * 路径 → 语法高亮语言（未知/无扩展名返回 null，降级为纯文本）
 * @param path 文件路径
 */
export function languageForPath(path: string): EditorLanguage | null {
  const ext = extensionOf(path)
  if (ext === null) return null
  if ((MARKDOWN_EXTENSIONS as readonly string[]).includes(ext)) return 'markdown'
  if ((JSON_EXTENSIONS as readonly string[]).includes(ext)) return 'json'
  if ((JAVASCRIPT_EXTENSIONS as readonly string[]).includes(ext)) return 'javascript'
  return null
}

/**
 * 是否包含 NUL 字节（二进制文件特征；UTF-16 文本天然含 NUL，调用方需先排除）
 * @param bytes 原始字节
 */
export function hasNulByte(bytes: Uint8Array): boolean {
  for (const byte of bytes) {
    if (byte === 0) return true
  }
  return false
}

/**
 * shared Eol → 可序列化枚举
 * @param eol 实际换行符
 */
export function toEolKind(eol: Eol): EolKind {
  if (eol === '\r\n') return 'crlf'
  if (eol === '\r') return 'cr'
  return 'lf'
}

/**
 * 可序列化枚举 → shared Eol
 * @param kind 换行符枚举
 */
export function toEolChar(kind: EolKind): Eol {
  if (kind === 'crlf') return '\r\n'
  if (kind === 'cr') return '\r'
  return '\n'
}

/**
 * 拆分路径为目录与文件名（纯字符串，不依赖 node:path）
 * @param path 文件路径（兼容 `\` 与 `/`）
 */
export function splitPath(path: string): { dir: string; name: string } {
  const index = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'))
  if (index < 0) return { dir: '', name: path }
  return { dir: path.slice(0, index), name: path.slice(index + 1) }
}
