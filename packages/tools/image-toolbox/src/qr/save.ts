/**
 * @file 保存相关纯函数（文件名清洗、PNG base64 归一）
 * @author cuilanchao
 * @date 2026-11-19
 * @description 主进程保存前的入参规范化（spec §6.4）：文件名去非法字符防路径穿越、
 *              base64 前缀剥离与字符校验；原子写盘已上提至 @lumin/node-kit 供多工具复用。
 */
import { toolError } from './errors'

export { writeAtomic } from '@lumin/node-kit'
export type { AtomicFs } from '@lumin/node-kit'

/** 文件名主名长度上限（与 savePayloadSchema 对齐） */
export const MAX_BASE_NAME = 80

/** Windows 非法文件名字符（含换行） */
const ILLEGAL_NAME_RE = /[\\/:*?"<>|\r\n]/g

/**
 * 清洗文件名主名：非法字符 → `_`，去首尾空白与末尾点，空则 `qrcode`，截断 80
 * @param raw 用户输入的文件名主名
 */
export function sanitizeBaseName(raw: string): string {
  const cleaned = raw.replace(ILLEGAL_NAME_RE, '_').trim().replace(/\.+$/, '').trim()
  const limited = cleaned.slice(0, MAX_BASE_NAME).replace(/\.+$/, '').trim()
  return limited === '' ? 'qrcode' : limited
}

/**
 * 归一 PNG base64：剥 `data:image/png;base64,` 前缀与空白，校验 base64 字符集
 * @param data 原始 base64 或 dataURL
 */
export function normalizePngBase64(data: string): string {
  const marker = 'base64,'
  const markerIndex = data.startsWith('data:') ? data.indexOf(marker) : -1
  const raw = markerIndex >= 0 ? data.slice(markerIndex + marker.length) : data
  const compact = raw.replace(/\s+/g, '')
  if (compact === '' || !/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) {
    throw toolError('QR_INVALID_PAYLOAD', 'PNG 数据无效')
  }
  return compact
}
