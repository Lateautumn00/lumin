/**
 * @file netstat / tasklist 纯解析层（无进程调用，全部可单测）
 * @author cuilanchao
 * @date 2026-11-21
 * @description 兼容 TCP 五列（含状态）与 UDP 四列（无状态）行、IPv6 方括号地址与含空格进程名
 */
import type { PortRow } from './schema'

/** 行内空白分隔（netstat 用多空格对齐列） */
const FIELD_SEPARATOR = /\s+/

/**
 * 拆分 `地址:端口`（IPv6 形如 `[::]:135`，按最后一个冒号切分）
 * @param value netstat 本地地址列
 */
export function splitAddress(value: string): { address: string; port: number } | null {
  const index = value.lastIndexOf(':')
  if (index <= 0) return null
  const portText = value.slice(index + 1)
  if (!/^\d{1,5}$/.test(portText)) return null
  const port = Number(portText)
  if (port > 65535) return null
  const host = value.slice(0, index)
  const address = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host
  if (address === '') return null
  return { address, port }
}

/**
 * 解析 `netstat -ano -p tcp|udp` 输出（只保留 LISTENING/ESTABLISHED 与全部 UDP 行）
 * @param output 命令标准输出
 */
export function parseNetstat(output: string): PortRow[] {
  const rows: PortRow[] = []
  for (const raw of output.split(/\r?\n/)) {
    const line = raw.trim()
    if (line === '') continue
    const fields = line.split(FIELD_SEPARATOR)
    const protocol = fields[0]?.toUpperCase()
    if (protocol !== 'TCP' && protocol !== 'UDP') continue
    const local = fields[1]
    if (local === undefined) continue
    const parsed = splitAddress(local)
    if (parsed === null) continue

    if (protocol === 'TCP') {
      const state = (fields[3] ?? '').toUpperCase()
      const pidText = fields[4]
      if (state !== 'LISTENING' && state !== 'ESTABLISHED') continue
      if (pidText === undefined || !/^\d+$/.test(pidText)) continue
      rows.push({
        protocol,
        localAddress: parsed.address,
        port: parsed.port,
        state,
        pid: Number(pidText),
        process: ''
      })
      continue
    }

    // UDP 行无状态列：`UDP 0.0.0.0:500 *:* 1234`
    const pidText = fields[3]
    if (pidText === undefined || !/^\d+$/.test(pidText)) continue
    rows.push({
      protocol,
      localAddress: parsed.address,
      port: parsed.port,
      state: '',
      pid: Number(pidText),
      process: ''
    })
  }
  return rows
}

/**
 * 按 CSV 规则切分一行（进程名可含逗号，以双引号包裹）
 * @param line tasklist CSV 行
 */
export function splitCsvLine(line: string): string[] {
  const fields: string[] = []
  let current = ''
  let quoted = false
  for (let index = 0; index < line.length; index += 1) {
    const char = line.charAt(index)
    if (quoted) {
      if (char === '"') {
        if (line.charAt(index + 1) === '"') {
          current += '"'
          index += 1
        } else {
          quoted = false
        }
        continue
      }
      current += char
      continue
    }
    if (char === '"') {
      quoted = true
      continue
    }
    if (char === ',') {
      fields.push(current)
      current = ''
      continue
    }
    current += char
  }
  fields.push(current)
  return fields
}

/**
 * 解析 `tasklist /FO CSV /NH` 输出为 PID → 进程名映射
 * @param output 命令标准输出（失败时传空串即可）
 */
export function parseTasklist(output: string): Map<number, string> {
  const names = new Map<number, string>()
  for (const line of output.split(/\r?\n/)) {
    if (line.trim() === '') continue
    const fields = splitCsvLine(line)
    const name = fields[0]
    const pidText = fields[1]
    if (name === undefined || pidText === undefined || !/^\d+$/.test(pidText)) continue
    names.set(Number(pidText), name)
  }
  return names
}

/**
 * 回填进程名（缺失留空，不丢弃端口行）
 * @param rows 端口行
 * @param names PID → 进程名
 */
export function attachProcessNames(
  rows: readonly PortRow[],
  names: ReadonlyMap<number, string>
): PortRow[] {
  return rows.map((row) => ({ ...row, process: names.get(row.pid) ?? '' }))
}

/**
 * 稳定排序：端口升序 → PID 升序 → 协议 → 本地地址
 * @param rows 端口行
 */
export function sortRows(rows: readonly PortRow[]): PortRow[] {
  return [...rows].sort(
    (left, right) =>
      left.port - right.port ||
      left.pid - right.pid ||
      left.protocol.localeCompare(right.protocol) ||
      left.localAddress.localeCompare(right.localAddress)
  )
}

/**
 * 按端口过滤（缺省返回全部）
 * @param rows 端口行
 * @param port 目标端口
 */
export function filterByPort(rows: readonly PortRow[], port: number | undefined): PortRow[] {
  return port === undefined ? [...rows] : rows.filter((row) => row.port === port)
}

/**
 * 行数上限截断
 * @param rows 端口行（应已排序）
 * @param limit 上限
 */
export function limitRows(
  rows: readonly PortRow[],
  limit: number
): { rows: PortRow[]; truncated: boolean } {
  if (rows.length <= limit) return { rows: [...rows], truncated: false }
  return { rows: rows.slice(0, limit), truncated: true }
}
