/**
 * @file 保存相关纯函数（文件名清洗、扩展名白名单）
 * @author cuilanchao
 * @date 2026-11-21
 * @description 主进程保存前的入参规范化（spec §3.4）：文件名去非法字符防路径穿越；
 *              本文件不依赖 node-kit，renderer 可安全复用清洗逻辑。
 */

/** 文件名主名长度上限（与 savePayloadSchema 对齐） */
export const MAX_BASE_NAME = 80

/** 允许导出的扩展名（单一来源） */
export const EXTENSIONS = ['html', 'ts', 'json', 'yaml'] as const

export type SaveExtension = (typeof EXTENSIONS)[number]

/** Windows 非法文件名字符（含换行等控制字符） */
const ILLEGAL_NAME_RE = /[\\/:*?"<>|\r\n\t]/g

/**
 * 扩展名是否在导出白名单内
 * @param value 待校验字符串
 */
export function isSaveExtension(value: string): value is SaveExtension {
  return (EXTENSIONS as readonly string[]).includes(value)
}

/**
 * 清洗文件名主名：非法字符 → `_`，去首尾空白与末尾点，空则 `document`，截断 80
 * @param raw 用户输入的文件名主名
 */
export function sanitizeBaseName(raw: string): string {
  const cleaned = raw.replace(ILLEGAL_NAME_RE, '_').trim().replace(/\.+$/, '').trim()
  const limited = cleaned.slice(0, MAX_BASE_NAME).replace(/\.+$/, '').trim()
  return limited === '' ? 'document' : limited
}
