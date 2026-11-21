/**
 * @file netstat.ts 单测：TCP/UDP 行解析、IPv6、CSV 进程名与排序/截断
 * @author cuilanchao
 * @date 2026-11-21
 */
import { describe, expect, it } from 'vitest'
import {
  attachProcessNames,
  filterByPort,
  limitRows,
  parseNetstat,
  parseTasklist,
  sortRows,
  splitAddress,
  splitCsvLine
} from './netstat'

const TCP_SAMPLE = [
  '',
  '活动连接',
  '',
  '  协议  本地地址          外部地址        状态           PID',
  '  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1234',
  '  TCP    127.0.0.1:8080         127.0.0.1:52100        ESTABLISHED     5678',
  '  TCP    127.0.0.1:9999         127.0.0.1:52101        TIME_WAIT       1111',
  '  TCP    [::]:443               [::]:0                 LISTENING       2222',
  ''
].join('\r\n')

const UDP_SAMPLE = [
  '活动连接',
  '',
  '  协议  本地地址          外部地址         PID',
  '  UDP    0.0.0.0:500            *:*                                    3333',
  '  UDP    [::]:500               *:*                                    3333',
  '  UDP    127.0.0.1:5353         *:*                                    4444',
  ''
].join('\n')

describe('splitAddress', () => {
  it('IPv4 地址按最后一个冒号切分', () => {
    expect(splitAddress('0.0.0.0:135')).toEqual({ address: '0.0.0.0', port: 135 })
  })

  it('IPv6 方括号去括号保留地址', () => {
    expect(splitAddress('[::]:443')).toEqual({ address: '::', port: 443 })
    expect(splitAddress('[fe80::1%12]:8080')).toEqual({ address: 'fe80::1%12', port: 8080 })
  })

  it('无端口/非数字/越界一律返回 null', () => {
    expect(splitAddress('*:*')).toBeNull()
    expect(splitAddress('abc')).toBeNull()
    expect(splitAddress(':80')).toBeNull()
    expect(splitAddress('1.2.3.4:99999')).toBeNull()
  })
})

describe('parseNetstat', () => {
  it('TCP 只保留 LISTENING/ESTABLISHED，跳过 TIME_WAIT 与表头', () => {
    const rows = parseNetstat(TCP_SAMPLE)
    expect(rows.map((row) => row.port)).toEqual([135, 8080, 443])
    expect(rows.every((row) => row.protocol === 'TCP')).toBe(true)
    expect(rows[0]).toMatchObject({ localAddress: '0.0.0.0', pid: 1234, state: 'LISTENING' })
    expect(rows[2]).toMatchObject({ localAddress: '::', port: 443, state: 'LISTENING' })
  })

  it('UDP 四列行无状态，PID 取第 4 列', () => {
    const rows = parseNetstat(UDP_SAMPLE)
    expect(rows).toHaveLength(3)
    expect(rows[0]).toMatchObject({ protocol: 'UDP', state: '', pid: 3333, port: 500 })
    expect(rows[2]).toMatchObject({ localAddress: '127.0.0.1', port: 5353, pid: 4444 })
  })

  it('忽略空行与非端口行', () => {
    expect(parseNetstat('\n\nhello world\nTCP bad-line\n')).toEqual([])
  })
})

describe('parseTasklist', () => {
  it('解析带引号 CSV 与含逗号的进程名', () => {
    const output = [
      '"chrome.exe","1234","Console","1","123,456 K"',
      '"a,b.exe","42","Console","1","1,000 K"',
      '"微信.exe","777","Console","1","10,000 K"'
    ].join('\r\n')
    const names = parseTasklist(output)
    expect(names.get(1234)).toBe('chrome.exe')
    expect(names.get(42)).toBe('a,b.exe')
    expect(names.get(777)).toBe('微信.exe')
  })

  it('跳过空行与非法 PID 行', () => {
    const names = parseTasklist('\n"x.exe","abc"\n"y.exe","9"\n')
    expect(names.size).toBe(1)
    expect(names.get(9)).toBe('y.exe')
  })

  it('splitCsvLine 支持双引号转义', () => {
    expect(splitCsvLine('"a""b","2"')).toEqual(['a"b', '2'])
  })
})

describe('行处理', () => {
  const rows = parseNetstat(TCP_SAMPLE)

  it('attachProcessNames 缺失进程名留空', () => {
    const names = new Map<number, string>([[1234, 'svchost.exe']])
    const merged = attachProcessNames(rows, names)
    expect(merged[0]?.process).toBe('svchost.exe')
    expect(merged[1]?.process).toBe('')
  })

  it('sortRows 按端口→PID 升序', () => {
    expect(sortRows(rows).map((row) => row.port)).toEqual([135, 443, 8080])
  })

  it('filterByPort 缺省全量、指定端口过滤', () => {
    expect(filterByPort(rows, undefined)).toHaveLength(3)
    expect(filterByPort(rows, 8080)).toHaveLength(1)
    expect(filterByPort(rows, 1)).toHaveLength(0)
  })

  it('limitRows 未超限不截断、超限截断', () => {
    expect(limitRows(rows, 3)).toEqual({ rows, truncated: false })
    expect(limitRows(rows, 2)).toMatchObject({ truncated: true })
    expect(limitRows(rows, 2).rows).toHaveLength(2)
  })
})
