/**
 * @file 保存相关纯函数（文件名清洗、PNG base64 归一、原子写盘）
 * @author cuilanchao
 * @date 2026-11-19
 * @description 主进程保存前的入参规范化（spec §6.4）：文件名去非法字符防路径穿越、
 *              base64 前缀剥离与字符校验、临时文件 + rename 原子写入（失败清理临时文件）
 */
import { renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { toolError } from './errors'

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

/** 原子写盘所需的最小 fs 子集（单测注入假件以覆盖 rename 失败清理） */
export interface AtomicFs {
  writeFileSync: (file: string, data: string | Buffer) => void
  renameSync: (from: string, to: string) => void
  unlinkSync: (file: string) => void
}

const defaultFs: AtomicFs = { writeFileSync, renameSync, unlinkSync }

/** 临时文件序号（同进程内防重名） */
let tempSequence = 0

/**
 * 原子写盘：先写 `<target>.tmp-<pid>-<n>` 再 rename 到目标
 * @param target 目标绝对路径
 * @param data 文件内容（PNG Buffer 或 SVG 文本）
 * @param fs 可注入 fs 子集（默认 Node 实现）
 */
export function writeAtomic(target: string, data: string | Buffer, fs: AtomicFs = defaultFs): void {
  tempSequence += 1
  const temp = `${target}.tmp-${process.pid}-${tempSequence}`
  fs.writeFileSync(temp, data)
  try {
    fs.renameSync(temp, target)
  } catch (err) {
    try {
      fs.unlinkSync(temp)
    } catch {
      // 临时文件可能未落盘或被占用，忽略清理失败以透传原始写盘错误
    }
    throw err
  }
}
