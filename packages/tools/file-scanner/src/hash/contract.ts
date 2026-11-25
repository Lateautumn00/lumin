/**
 * @file contract.ts 纯函数契约（算法归一 / 期望哈希解析 / 比对 / TSV 导出）
 * @author cuilanchao
 * @date 2026-11-19
 * @description 算法列表归一与标签、期望哈希规范化（前缀优先，否则按 32/40/64/128 长度识别）、
 *              单行比对、结果表复制文本。全部无副作用，供 worker/renderer 共用。
 */
import { formatBytes, fileNameOf, formatTime } from '@lumin/shared'
import { ALGORITHMS, type Algorithm, type HashFileResult } from './schema'

export { fileNameOf, formatTime }

/** 算法 → 展示名 */
const LABELS: Record<Algorithm, string> = {
  md5: 'MD5',
  sha1: 'SHA-1',
  sha256: 'SHA-256',
  sha512: 'SHA-512'
}

/** 算法 → 十六进制摘要长度 */
const HEX_LENGTHS: Record<Algorithm, number> = {
  md5: 32,
  sha1: 40,
  sha256: 64,
  sha512: 128
}

/** 期望哈希可接受的前缀（小写比较，`sha-1`/`sha1` 等价） */
const PREFIXES: readonly (readonly [string, Algorithm])[] = [
  ['md5', 'md5'],
  ['sha1', 'sha1'],
  ['sha-1', 'sha1'],
  ['sha256', 'sha256'],
  ['sha-256', 'sha256'],
  ['sha512', 'sha512'],
  ['sha-512', 'sha512']
]

/**
 * 算法展示名
 * @param algorithm 算法
 */
export function algorithmLabel(algorithm: Algorithm): string {
  return LABELS[algorithm]
}

/**
 * 勾选列表归一：丢弃未知值、去重、按固定顺序（md5 → sha1 → sha256 → sha512）返回
 * @param input 任意字符串列表（来自设置或 UI）
 */
export function normalizeAlgorithms(input: readonly string[]): Algorithm[] {
  const selected = new Set<string>(input)
  return ALGORITHMS.filter((algorithm) => selected.has(algorithm))
}

/** 规范化后的期望哈希 */
export interface ExpectedHash {
  /** 小写十六进制摘要 */
  value: string
  algorithm: Algorithm
}

/** 去掉 0x 前缀（若有） */
function stripHexPrefix(value: string): string {
  return value.startsWith('0x') ? value.slice(2) : value
}

/**
 * 解析用户粘贴的期望哈希：trim、去空白、小写、去 `0x`、拆 `md5:`/`sha1:`/`sha256:`/`sha512:` 前缀；
 * 无前缀时按长度（32/40/64/128）识别算法。
 * @param raw 原始输入
 * @returns 合法时返回摘要与算法；空串、未知前缀、长度或字符非法时返回 null
 */
export function normalizeExpected(raw: string): ExpectedHash | null {
  const compact = raw.trim().toLowerCase().replace(/\s+/g, '')
  if (compact === '') return null

  let body = compact
  let algorithm: Algorithm | null = null
  const colon = compact.indexOf(':')
  if (colon > 0) {
    const prefix = compact.slice(0, colon)
    const matched = PREFIXES.find(([name]) => name === prefix)
    if (matched === undefined) return null
    algorithm = matched[1]
    body = compact.slice(colon + 1)
  }

  body = stripHexPrefix(body)
  if (algorithm === null) {
    algorithm = ALGORITHMS.find((candidate) => HEX_LENGTHS[candidate] === body.length) ?? null
  }
  if (algorithm === null || body.length !== HEX_LENGTHS[algorithm]) return null
  if (!/^[0-9a-f]+$/.test(body)) return null
  return { value: body, algorithm }
}

/**
 * 判断单条结果是否与期望哈希匹配
 * @param result 单文件结果
 * @param expected 规范化后的期望哈希
 */
export function matchesExpected(result: HashFileResult, expected: ExpectedHash): boolean {
  return result.status === 'ok' && result.hashes[expected.algorithm] === expected.value
}

/**
 * 结果表 TSV 文本（含表头；复制全部与复制本行共用）
 * @param results 单文件结果（保持输入顺序）
 * @param algorithms 已选算法（决定列集合与顺序）
 */
export function toTsv(results: readonly HashFileResult[], algorithms: readonly Algorithm[]): string {
  const header = [
    '文件路径',
    '大小',
    '修改时间',
    ...algorithms.map(algorithmLabel),
    '状态'
  ]
  const rows = results.map((result) => [
    result.path,
    formatBytes(result.size),
    formatTime(result.mtimeMs),
    ...algorithms.map((algorithm) => result.hashes[algorithm] ?? ''),
    result.status === 'ok' ? '成功' : `失败（${result.code ?? 'ERROR'}）`
  ])
  return [header, ...rows].map((columns) => columns.join('\t')).join('\n')
}
