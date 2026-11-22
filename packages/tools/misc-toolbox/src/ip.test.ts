import { describe, expect, it } from 'vitest'

import {
  classOf,
  computeSubnet,
  computeSubnet6,
  formatIpv4,
  formatIpv6,
  ipv6TypeOf,
  isIpv6Info,
  isLoopbackIp,
  isPrivateIp,
  maskForPrefix,
  netmaskBinary,
  parseAndCompute,
  parseCidr,
  parseCidr6,
  parseIpv4,
  parseIpv6,
  prefixFromMask,
  usableHosts,
  type SubnetInfo
} from './ip'

/** 断言解析成功并收窄为 IPv4 子网信息 */
function subnetOf(input: string): SubnetInfo {
  const result = parseAndCompute(input)
  if (!result.ok) throw new Error(`解析失败：${input} → ${result.error.message}`)
  if (isIpv6Info(result.value)) throw new Error(`期望 IPv4 结果：${input}`)
  return result.value
}

/** 断言解析成功并收窄为 IPv6 子网信息 */
function subnet6Of(input: string) {
  const result = parseAndCompute(input)
  if (!result.ok) throw new Error(`解析失败：${input} → ${result.error.message}`)
  if (!isIpv6Info(result.value)) throw new Error(`期望 IPv6 结果：${input}`)
  return result.value
}

describe('parseAndCompute 基础计算', () => {
  it('/24 标准网段（网络/广播/掩码/反掩码/主机范围/主机数）', () => {
    const info = subnetOf('192.168.1.10/24')
    expect(info.network).toBe('192.168.1.0')
    expect(info.broadcast).toBe('192.168.1.255')
    expect(info.netmask).toBe('255.255.255.0')
    expect(info.wildcard).toBe('0.0.0.255')
    expect(info.prefix).toBe(24)
    expect(info.firstHost).toBe('192.168.1.1')
    expect(info.lastHost).toBe('192.168.1.254')
    expect(info.hostCount).toBe(254)
    expect(info.ipClass).toBe('C')
    expect(info.isPrivate).toBe(true)
    expect(info.isLoopback).toBe(false)
  })

  it('主机位非 0 时按掩码归一化并标记 normalized', () => {
    const result = parseCidr('192.168.1.10/24')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.normalized).toBe(true)
    expect(subnetOf('192.168.1.0/24').normalized).toBe(false)
  })

  it('/8 大网段主机数 16777214（不溢出）', () => {
    const info = subnetOf('10.0.0.0/8')
    expect(info.network).toBe('10.0.0.0')
    expect(info.broadcast).toBe('10.255.255.255')
    expect(info.hostCount).toBe(16777214)
    expect(info.ipClass).toBe('A')
    expect(info.isPrivate).toBe(true)
  })

  it('/30 点对点前网段主机数 2', () => {
    const info = subnetOf('192.168.1.0/30')
    expect(info.firstHost).toBe('192.168.1.1')
    expect(info.lastHost).toBe('192.168.1.2')
    expect(info.hostCount).toBe(2)
  })

  it('/31 首末均可用（主机数 2）', () => {
    const info = subnetOf('192.168.1.0/31')
    expect(info.network).toBe('192.168.1.0')
    expect(info.broadcast).toBe('192.168.1.1')
    expect(info.firstHost).toBe('192.168.1.0')
    expect(info.lastHost).toBe('192.168.1.1')
    expect(info.hostCount).toBe(2)
  })

  it('/32 单主机（首末同为该地址）', () => {
    const info = subnetOf('8.8.8.8/32')
    expect(info.network).toBe('8.8.8.8')
    expect(info.broadcast).toBe('8.8.8.8')
    expect(info.firstHost).toBe('8.8.8.8')
    expect(info.lastHost).toBe('8.8.8.8')
    expect(info.hostCount).toBe(1)
    expect(info.isPrivate).toBe(false)
  })

  it('/0 全网（主机数 4294967294，不得溢出）', () => {
    const info = subnetOf('0.0.0.0/0')
    expect(info.network).toBe('0.0.0.0')
    expect(info.broadcast).toBe('255.255.255.255')
    expect(info.wildcard).toBe('255.255.255.255')
    expect(info.hostCount).toBe(4294967294)
    expect(info.normalized).toBe(false)
  })

  it('掩码点数写法与 /24 等价', () => {
    const info = subnetOf('192.168.1.10/255.255.255.0')
    expect(info.prefix).toBe(24)
    expect(info.network).toBe('192.168.1.0')
  })

  it('掩码二进制按四段 8 位展示', () => {
    expect(netmaskBinary(24)).toBe('11111111.11111111.11111111.00000000')
    expect(subnetOf('172.16.0.0/12').netmaskBinary).toBe('11111111.11110000.00000000.00000000')
  })
})

describe('parseCidr 非法输入', () => {
  it('空输入 → MT_CIDR_INVALID', () => {
    const result = parseCidr('   ')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('MT_CIDR_INVALID')
    expect(result.error.detail).toContain('请输入 CIDR')
  })

  it('IPv6 输入交由 parseCidr6 处理（parseCidr 保持 IPv4 专用）', () => {
    const result = parseCidr6('2001:db8::1/64')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.prefix).toBe(64)
    expect(result.value.normalized).toBe(true)
  })

  it('段值越界 → detail 指明段号', () => {
    const tooBig = parseCidr('192.168.1.256/24')
    expect(tooBig.ok).toBe(false)
    if (!tooBig.ok) expect(tooBig.error.detail).toBe('第 4 段 256 超出 0–255')

    const notNumber = parseCidr('192.168.a.1/24')
    expect(notNumber.ok).toBe(false)
    if (!notNumber.ok) expect(notNumber.error.detail).toBe('第 3 段不是 0–255 的整数')

    const notFour = parseCidr('192.168.1/24')
    expect(notFour.ok).toBe(false)
    if (!notFour.ok) expect(notFour.error.detail).toBe('IP 地址须为 a.b.c.d 四段')
  })

  it('前缀越界 → 提示 0–32', () => {
    const result = parseCidr('192.168.1.0/33')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.detail).toBe('前缀长度 33 超出 0–32')
  })

  it('多余字符 / 多斜杠 / 缺前缀 → 结构错误', () => {
    expect(parseCidr('192.168.1.0/24x').ok).toBe(false)
    expect(parseCidr('192.168.1.0/24/24').ok).toBe(false)
    const missing = parseCidr('192.168.1.1')
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.error.detail).toBe('缺少前缀长度（0–32）')
  })

  it('非连续掩码被拒绝', () => {
    const result = parseCidr('192.168.1.0/255.0.255.0')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.detail).toBe('子网掩码必须由连续 1 组成')
  })

  it('非法掩码点数 → 子网掩码无效', () => {
    const result = parseCidr('192.168.1.0/255.255.255.999')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.detail).toContain('子网掩码无效')
  })
})

describe('地址判定与位运算辅助', () => {
  it('私有地址三段 + 非私有', () => {
    expect(isPrivateIp(0x0a000001)).toBe(true)
    expect(isPrivateIp(0xac100001)).toBe(true)
    expect(isPrivateIp(0xc0a80001)).toBe(true)
    expect(isPrivateIp(0x08080808)).toBe(false)
  })

  it('回环地址 127/8', () => {
    expect(subnetOf('127.0.0.1/8').isLoopback).toBe(true)
    expect(isLoopbackIp(0x7f000001)).toBe(true)
    expect(isLoopbackIp(0x7e000001)).toBe(false)
  })

  it('IP 类别 A/B/C/D/E', () => {
    expect(classOf(0x0a000001)).toBe('A')
    expect(classOf(0xac100001)).toBe('B')
    expect(classOf(0xc0a80001)).toBe('C')
    expect(subnetOf('224.0.0.1/4').ipClass).toBe('D')
    expect(subnetOf('240.0.0.0/4').ipClass).toBe('E')
  })

  it('formatIpv4 / maskForPrefix / prefixFromMask 边界', () => {
    expect(formatIpv4(0)).toBe('0.0.0.0')
    expect(formatIpv4(0xffffffff)).toBe('255.255.255.255')
    expect(maskForPrefix(0)).toBe(0)
    expect(maskForPrefix(32)).toBe(0xffffffff)
    expect(maskForPrefix(1)).toBe(0x80000000)
    expect(prefixFromMask(0)).toBe(0)
    expect(prefixFromMask(0xffffffff)).toBe(32)
    expect(prefixFromMask(0xff000000)).toBe(8)
    expect(prefixFromMask(0xffffff00)).toBe(24)
  })

  it('usableHosts 特例与常规', () => {
    expect(usableHosts(32)).toBe(1)
    expect(usableHosts(31)).toBe(2)
    expect(usableHosts(30)).toBe(2)
    expect(usableHosts(29)).toBe(6)
    expect(usableHosts(0)).toBe(4294967294)
  })

  it('parseIpv4 接受合法地址并用 >>> 0 表示', () => {
    const result = parseIpv4('255.255.255.255')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toBe(0xffffffff)
  })

  it('computeSubnet 直接消费 parseCidr 结果（含 trimmed 空白输入）', () => {
    const parsed = parseCidr('  172.16.0.1/12  ')
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const info = computeSubnet(parsed.value)
    expect(info.network).toBe('172.16.0.0')
    expect(info.broadcast).toBe('172.31.255.255')
    expect(info.isPrivate).toBe(true)
  })
})

describe('parseIpv6 / formatIpv6', () => {
  it('压缩写法与完整写法等价', () => {
    const full = parseIpv6('2001:0db8:0000:0000:0000:0000:0000:0001')
    const short = parseIpv6('2001:db8::1')
    expect(full.ok).toBe(true)
    expect(short.ok).toBe(true)
    if (!full.ok || !short.ok) return
    expect(full.value).toBe(short.value)
    expect(formatIpv6(short.value)).toBe('2001:db8::1')
  })

  it('格式化边界：全零 / 回环 / 无零段', () => {
    expect(formatIpv6(0n)).toBe('::')
    expect(formatIpv6(1n)).toBe('::1')
    expect(formatIpv6(0x20010db8_00000000_00000000_00000001n)).toBe('2001:db8::1')
    const noZero =
      (1n << 112n) | (2n << 96n) | (3n << 80n) | (4n << 64n) | (5n << 48n) | (6n << 32n) | (7n << 16n)
    expect(formatIpv6(noZero)).toBe('1:2:3:4:5:6:7:0')
  })

  it('多段等长零段时压缩第一段', () => {
    const value = (1n << 112n) | (2n << 64n) | (3n << 16n) | 4n
    expect(formatIpv6(value)).toBe('1::2:0:0:3:4')
  })

  it('非法输入返回 MT_CIDR_INVALID', () => {
    const cases: [string, string][] = [
      ['', '请输入 IPv6 地址'],
      [':::', 'IPv6 地址不能包含 :::'],
      ['1::2::3', 'IPv6 地址最多包含一处 ::'],
      ['1:2:3:4:5:6:7', 'IPv6 地址须为 8 组十六进制'],
      ['1:2:3:4:5:6:7:8:9', 'IPv6 地址须为 8 组十六进制'],
      ['1:2:3:4:5:6:7:8::', ':: 至少省略一组'],
      ['12345::', 'IPv6 地址每组须为 1–4 位十六进制'],
      ['gggg::', 'IPv6 地址每组须为 1–4 位十六进制']
    ]
    for (const [input, detail] of cases) {
      const result = parseIpv6(input)
      expect(result.ok, input).toBe(false)
      if (result.ok) continue
      expect(result.error.code).toBe('MT_CIDR_INVALID')
      expect(result.error.detail).toBe(detail)
    }
  })
})

describe('parseCidr6 / computeSubnet6', () => {
  it('/32 网络地址与 2^96 主机数', () => {
    const info = subnet6Of('2001:db8::/32')
    expect(info.network).toBe('2001:db8::')
    expect(info.last).toBe('2001:db8:ffff:ffff:ffff:ffff:ffff:ffff')
    expect(info.firstHost).toBe('2001:db8::1')
    expect(info.lastHost).toBe('2001:db8:ffff:ffff:ffff:ffff:ffff:fffe')
    expect(info.hostCount).toBe('79228162514264337593543950336')
    expect(info.addressType).toBe('全局地址')
    expect(info.normalized).toBe(false)
  })

  it('/64 归一化与 2^64 主机数', () => {
    const info = subnet6Of('2001:db8::1/64')
    expect(info.network).toBe('2001:db8::')
    expect(info.last).toBe('2001:db8::ffff:ffff:ffff:ffff')
    expect(info.hostCount).toBe('18446744073709551616')
    expect(info.normalized).toBe(true)
    expect(info.address).toBe('2001:db8::1')
  })

  it('/0 全网 2^128 主机数不溢出', () => {
    const info = subnet6Of('::/0')
    expect(info.network).toBe('::')
    expect(info.last).toBe('ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff')
    expect(info.firstHost).toBe('::1')
    expect(info.lastHost).toBe('ffff:ffff:ffff:ffff:ffff:ffff:ffff:fffe')
    expect(info.hostCount).toBe('340282366920938463463374607431768211456')
    expect(info.addressType).toBe('未指定地址')
  })

  it('/127 首末均可用，/128 单地址', () => {
    const pair = subnet6Of('2001:db8::/127')
    expect(pair.firstHost).toBe('2001:db8::')
    expect(pair.lastHost).toBe('2001:db8::1')
    expect(pair.hostCount).toBe('2')

    const single = subnet6Of('2001:db8::1/128')
    expect(single.network).toBe('2001:db8::1')
    expect(single.firstHost).toBe('2001:db8::1')
    expect(single.lastHost).toBe('2001:db8::1')
    expect(single.hostCount).toBe('1')
  })

  it('IPv6 地址类型判定', () => {
    expect(subnet6Of('::/128').addressType).toBe('未指定地址')
    expect(subnet6Of('::1/128').addressType).toBe('回环地址')
    expect(subnet6Of('fe80::1/64').addressType).toBe('链路本地地址')
    expect(subnet6Of('fd00::1/8').addressType).toBe('唯一本地地址')
    expect(subnet6Of('ff02::1/128').addressType).toBe('组播地址')
    expect(subnet6Of('2001:db8::1/128').addressType).toBe('全局地址')
    expect(ipv6TypeOf(0xfe80n << 112n)).toBe('链路本地地址')
    expect(ipv6TypeOf(0xfec0n << 112n)).toBe('全局地址')
    expect(ipv6TypeOf(0xfc00n << 112n)).toBe('唯一本地地址')
    expect(ipv6TypeOf(0xfbffn << 112n)).toBe('全局地址')
  })

  it('非法前缀与结构错误', () => {
    const cases: [string, string][] = [
      ['', '请输入 CIDR，如 2001:db8::/32'],
      ['2001:db8::', '缺少前缀长度（0–128）'],
      ['2001:db8::/x', '无法识别的前缀：x'],
      ['2001:db8::/129', '前缀长度 129 超出 0–128'],
      ['2001:db8::/64/64', '格式应为 IPv6/前缀长度']
    ]
    for (const [input, detail] of cases) {
      const result = parseCidr6(input)
      expect(result.ok, input).toBe(false)
      if (result.ok) continue
      expect(result.error.code).toBe('MT_CIDR_INVALID')
      expect(result.error.detail).toBe(detail)
    }
  })

  it('computeSubnet6 直接消费 parseCidr6 结果', () => {
    const parsed = parseCidr6('  2001:db8::/48  ')
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const info = computeSubnet6(parsed.value)
    expect(info.network).toBe('2001:db8::')
    expect(info.hostCount).toBe('1208925819614629174706176')
  })

  it('isIpv6Info 按 hostCount 类型判别', () => {
    expect(isIpv6Info(subnet6Of('2001:db8::/32'))).toBe(true)
    expect(isIpv6Info(subnetOf('192.168.1.0/24'))).toBe(false)
  })
})
