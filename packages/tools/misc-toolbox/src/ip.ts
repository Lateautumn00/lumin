/**
 * @file IPv4 / IPv6 CIDR 解析与子网计算（纯函数，spec/misc-toolbox.md §1）
 * @author cuilanchao
 * @date 2026-11-21
 * @description IPv4 以无符号 32 位整数运算；IPv6 以 BigInt 128 位运算。
 *              主机数用除法/BigInt 避免位运算溢出。
 */
import type { StructuredError } from '@lumin/shared'

import { toolError } from './errors'
import { ipv4CidrSchema } from './schema'

/** IP 类别（classful A/B/C/D/E） */
export type IpClass = 'A' | 'B' | 'C' | 'D' | 'E'

/** 解析后的 CIDR：无符号 32 位地址 + 前缀长度 + 是否已归一化 */
export interface ParsedCidr {
  address: number
  prefix: number
  normalized: boolean
}

/** 子网计算结果（展示用均为点分十进制文本） */
export interface SubnetInfo {
  address: string
  network: string
  broadcast: string
  netmask: string
  wildcard: string
  prefix: number
  firstHost: string
  lastHost: string
  hostCount: number
  ipClass: IpClass
  isPrivate: boolean
  isLoopback: boolean
  netmaskBinary: string
  normalized: boolean
}

/** 纯函数统一结果：成功带值，失败带结构化错误（不 throw） */
export type IpResult<T> = { ok: true; value: T } | { ok: false; error: StructuredError }

/** 四段十进制八位组（1–3 位） */
const OCTET_RE = /^\d{1,3}$/

function invalid(detail: string): { ok: false; error: StructuredError } {
  return { ok: false, error: toolError('MT_CIDR_INVALID', detail) }
}

/**
 * 无符号 32 位整数 → 点分十进制
 * @param value 0–4294967295 的整数
 */
export function formatIpv4(value: number): string {
  const v = value >>> 0
  return `${(v >>> 24) & 0xff}.${(v >>> 16) & 0xff}.${(v >>> 8) & 0xff}.${v & 0xff}`
}

/**
 * 前缀长度 → 子网掩码（无符号 32 位）
 * @param prefix 0–32
 */
export function maskForPrefix(prefix: number): number {
  if (prefix <= 0) return 0
  if (prefix >= 32) return 0xffffffff
  return (0xffffffff << (32 - prefix)) >>> 0
}

/**
 * 前缀长度 → 掩码二进制（四段 8 位，点分）
 * @param prefix 0–32
 */
export function netmaskBinary(prefix: number): string {
  const bits = `${'1'.repeat(prefix)}${'0'.repeat(32 - prefix)}`
  return [0, 8, 16, 24].map((start) => bits.slice(start, start + 8)).join('.')
}

/**
 * 可用主机数：/31 与 /32 有特例，其余为 2^主机位 - 2（用除法避免位运算溢出）
 * @param prefix 0–32
 */
export function usableHosts(prefix: number): number {
  if (prefix === 32) return 1
  if (prefix === 31) return 2
  return Math.floor(0x100000000 / 2 ** prefix) - 2
}

/**
 * 首八位组 → IP 类别（0–127 A / 128–191 B / 192–223 C / 224–239 D / 240–255 E）
 * @param value 无符号 32 位地址
 */
export function classOf(value: number): IpClass {
  const first = (value >>> 24) & 0xff
  if (first < 128) return 'A'
  if (first < 192) return 'B'
  if (first < 224) return 'C'
  if (first < 240) return 'D'
  return 'E'
}

/**
 * RFC 1918 私有地址判定（10/8、172.16/12、192.168/16）
 * @param value 无符号 32 位地址
 */
export function isPrivateIp(value: number): boolean {
  const v = value >>> 0
  if ((v & 0xff000000) >>> 0 === 0x0a000000) return true
  if ((v & 0xfff00000) >>> 0 === 0xac100000) return true
  return (v & 0xffff0000) >>> 0 === 0xc0a80000
}

/**
 * 回环地址判定（127/8）
 * @param value 无符号 32 位地址
 */
export function isLoopbackIp(value: number): boolean {
  return ((value >>> 24) & 0xff) === 127
}

/**
 * 解析点分十进制 IPv4
 * @param text 如 `192.168.1.10`
 */
export function parseIpv4(text: string): IpResult<number> {
  const segments = text.split('.')
  if (segments.length !== 4) return invalid('IP 地址须为 a.b.c.d 四段')
  let value = 0
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index] ?? ''
    if (!OCTET_RE.test(segment)) return invalid(`第 ${index + 1} 段不是 0–255 的整数`)
    const octet = Number(segment)
    if (octet > 255) return invalid(`第 ${index + 1} 段 ${octet} 超出 0–255`)
    value = (value * 256 + octet) >>> 0
  }
  return { ok: true, value }
}

/**
 * 连续 1 的掩码 → 前缀长度；非连续返回 null
 * @param mask 无符号 32 位掩码
 */
export function prefixFromMask(mask: number): number | null {
  const inverted = ~mask >>> 0
  if ((inverted & (inverted + 1)) !== 0) return null
  return Math.clz32(inverted)
}

/**
 * 解析 CIDR（支持 `/24` 与前缀点数两种写法）
 * @param input 如 `192.168.1.10/24` 或 `192.168.1.10/255.255.255.0`
 */
export function parseCidr(input: string): IpResult<ParsedCidr> {
  const text = input.trim()
  if (text === '') return invalid('请输入 CIDR，如 192.168.1.0/24')

  const parts = text.split('/')
  if (parts.length > 2) return invalid('格式应为 a.b.c.d/前缀长度')

  const addressText = (parts[0] ?? '').trim()
  const parsedAddress = parseIpv4(addressText)
  if (!parsedAddress.ok) return parsedAddress

  const suffix = (parts[1] ?? '').trim()
  if (suffix === '') return invalid('缺少前缀长度（0–32）')

  let prefix: number
  if (OCTET_RE.test(suffix)) {
    const length = Number(suffix)
    if (length > 32) return invalid(`前缀长度 ${length} 超出 0–32`)
    prefix = length
  } else if (suffix.includes('.')) {
    const parsedMask = parseIpv4(suffix)
    if (!parsedMask.ok) return invalid(`子网掩码无效：${parsedMask.error.detail ?? '格式错误'}`)
    const derived = prefixFromMask(parsedMask.value)
    if (derived === null) return invalid('子网掩码必须由连续 1 组成')
    prefix = derived
  } else {
    return invalid(`无法识别的前缀：${suffix}`)
  }

  const mask = maskForPrefix(prefix)
  const address = parsedAddress.value
  const checked = ipv4CidrSchema.safeParse({
    address,
    prefix,
    normalized: (address & mask) >>> 0 !== address
  })
  if (!checked.success) return invalid('解析结果超出 IPv4 范围')
  return { ok: true, value: checked.data }
}

/**
 * 由解析结果计算子网信息
 * @param cidr parseCidr 的返回值
 */
export function computeSubnet(cidr: ParsedCidr): SubnetInfo {
  const mask = maskForPrefix(cidr.prefix)
  const network = (cidr.address & mask) >>> 0
  const broadcast = (network | (~mask >>> 0)) >>> 0
  const firstHost = cidr.prefix >= 31 ? network : (network + 1) >>> 0
  const lastHost = cidr.prefix >= 31 ? broadcast : (broadcast - 1) >>> 0
  return {
    address: formatIpv4(cidr.address),
    network: formatIpv4(network),
    broadcast: formatIpv4(broadcast),
    netmask: formatIpv4(mask),
    wildcard: formatIpv4(~mask >>> 0),
    prefix: cidr.prefix,
    firstHost: formatIpv4(firstHost),
    lastHost: formatIpv4(lastHost),
    hostCount: usableHosts(cidr.prefix),
    ipClass: classOf(cidr.address),
    isPrivate: isPrivateIp(cidr.address),
    isLoopback: isLoopbackIp(cidr.address),
    netmaskBinary: netmaskBinary(cidr.prefix),
    normalized: cidr.normalized
  }
}

/** 解析后的 IPv6 CIDR：128 位地址 + 前缀长度 + 是否已归一化 */
export interface ParsedCidr6 {
  address: bigint
  prefix: number
  normalized: boolean
}

/** IPv6 地址类型（按输入地址判定，非网络地址） */
export type Ipv6AddressType =
  | '未指定地址'
  | '回环地址'
  | '链路本地地址'
  | '唯一本地地址'
  | '组播地址'
  | '全局地址'

/** IPv6 子网计算结果（展示用均为 RFC 5952 压缩文本） */
export interface SubnetInfo6 {
  address: string
  network: string
  last: string
  prefix: number
  firstHost: string
  lastHost: string
  hostCount: string
  addressType: Ipv6AddressType
  normalized: boolean
}

/** 单组十六进制（1–4 位） */
const GROUP_RE = /^[0-9a-f]{1,4}$/i

/** 128 位全 1 */
const ALL_ONES_128 = (1n << 128n) - 1n

/**
 * 解析 IPv6 地址（支持 `::` 压缩与前导零省略）
 * @param text 如 `2001:db8::1`
 */
export function parseIpv6(text: string): IpResult<bigint> {
  const trimmed = text.trim()
  if (trimmed === '') return invalid('请输入 IPv6 地址')
  if (trimmed.includes(':::')) return invalid('IPv6 地址不能包含 :::')

  const halves = trimmed.split('::')
  if (halves.length > 2) return invalid('IPv6 地址最多包含一处 ::')

  const splitGroups = (part: string): string[] => (part === '' ? [] : part.split(':'))

  const left = splitGroups(halves[0] ?? '')
  const right = halves.length === 2 ? splitGroups(halves[1] ?? '') : []
  const all = [...left, ...right]
  for (const group of all) {
    if (!GROUP_RE.test(group)) return invalid('IPv6 地址每组须为 1–4 位十六进制')
  }

  let groups: string[]
  if (halves.length === 1) {
    if (all.length !== 8) return invalid('IPv6 地址须为 8 组十六进制')
    groups = all
  } else {
    const zeros = 8 - left.length - right.length
    if (zeros < 1) return invalid(':: 至少省略一组')
    groups = [...left, ...Array<string>(zeros).fill('0'), ...right]
  }

  let value = 0n
  for (const group of groups) {
    value = (value << 16n) | BigInt(Number.parseInt(group, 16))
  }
  return { ok: true, value }
}

/**
 * 128 位整数 → RFC 5952 压缩文本（最长连续 0 组替换为 `::`，平手取第一段）
 * @param value 0–2^128-1
 */
export function formatIpv6(value: bigint): string {
  const masked = value & ALL_ONES_128
  const groups: number[] = []
  let rest = masked
  for (let index = 0; index < 8; index += 1) {
    groups.unshift(Number(rest & 0xffffn))
    rest >>= 16n
  }

  let bestStart = -1
  let bestLength = 1
  let runStart = -1
  let runLength = 0
  for (let index = 0; index < 8; index += 1) {
    if (groups[index] === 0) {
      if (runLength === 0) runStart = index
      runLength += 1
      if (runLength > bestLength) {
        bestLength = runLength
        bestStart = runStart
      }
    } else {
      runLength = 0
    }
  }

  const hex = groups.map((group) => group.toString(16))
  if (bestStart < 0) return hex.join(':')
  const head = hex.slice(0, bestStart).join(':')
  const tail = hex.slice(bestStart + bestLength).join(':')
  return `${head}::${tail}`
}

/**
 * 解析 IPv6 CIDR
 * @param input 如 `2001:db8::/32`
 */
export function parseCidr6(input: string): IpResult<ParsedCidr6> {
  const text = input.trim()
  if (text === '') return invalid('请输入 CIDR，如 2001:db8::/32')

  const parts = text.split('/')
  if (parts.length > 2) return invalid('格式应为 IPv6/前缀长度')

  const addressText = (parts[0] ?? '').trim()
  const parsedAddress = parseIpv6(addressText)
  if (!parsedAddress.ok) return parsedAddress

  const suffix = (parts[1] ?? '').trim()
  if (suffix === '') return invalid('缺少前缀长度（0–128）')
  if (!/^\d{1,3}$/.test(suffix)) return invalid(`无法识别的前缀：${suffix}`)
  const prefix = Number(suffix)
  if (prefix > 128) return invalid(`前缀长度 ${prefix} 超出 0–128`)

  const hostBits = 1n << BigInt(128 - prefix)
  const mask = prefix === 0 ? 0n : ALL_ONES_128 ^ (hostBits - 1n)
  const address = parsedAddress.value
  return { ok: true, value: { address, prefix, normalized: (address & mask) !== address } }
}

/**
 * IPv6 地址类型判定（未指定 / 回环 / 链路本地 / 唯一本地 / 组播 / 全局）
 * @param value 128 位地址
 */
export function ipv6TypeOf(value: bigint): Ipv6AddressType {
  const v = value & ALL_ONES_128
  if (v === 0n) return '未指定地址'
  if (v === 1n) return '回环地址'
  if (v >> 118n === 0x3fan) return '链路本地地址'
  if (v >> 121n === 0x7en) return '唯一本地地址'
  if (v >> 120n === 0xffn) return '组播地址'
  return '全局地址'
}

/**
 * 由解析结果计算 IPv6 子网信息（主机数恒为 2^主机位，不扣减）
 * @param cidr parseCidr6 的返回值
 */
export function computeSubnet6(cidr: ParsedCidr6): SubnetInfo6 {
  const totalHosts = 1n << BigInt(128 - cidr.prefix)
  const mask = cidr.prefix === 0 ? 0n : ALL_ONES_128 ^ (totalHosts - 1n)
  const network = cidr.address & mask
  const last = network | (totalHosts - 1n)
  const firstHost = cidr.prefix >= 127 ? network : network + 1n
  const lastHost = cidr.prefix >= 127 ? last : last - 1n
  return {
    address: formatIpv6(cidr.address),
    network: formatIpv6(network),
    last: formatIpv6(last),
    prefix: cidr.prefix,
    firstHost: formatIpv6(firstHost),
    lastHost: formatIpv6(lastHost),
    hostCount: totalHosts.toString(),
    addressType: ipv6TypeOf(cidr.address),
    normalized: cidr.normalized
  }
}

/**
 * 结果判别：IPv6 的 hostCount 为字符串，IPv4 为数字
 * @param info parseAndCompute 的返回值
 */
export function isIpv6Info(info: SubnetInfo | SubnetInfo6): info is SubnetInfo6 {
  return typeof info.hostCount === 'string'
}

/**
 * 一步解析并计算（UI 主入口）：含 `:` 走 IPv6，否则走 IPv4
 * @param input CIDR 文本
 */
export function parseAndCompute(input: string): IpResult<SubnetInfo | SubnetInfo6> {
  if (input.includes(':')) {
    const parsed = parseCidr6(input)
    if (!parsed.ok) return parsed
    return { ok: true, value: computeSubnet6(parsed.value) }
  }
  const parsed = parseCidr(input)
  if (!parsed.ok) return parsed
  return { ok: true, value: computeSubnet(parsed.value) }
}
