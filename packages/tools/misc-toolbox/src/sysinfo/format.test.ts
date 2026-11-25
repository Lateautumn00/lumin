/**
 * @file format.ts 纯函数单测（spec §6）
 * @author cuilanchao
 * @date 2026-11-22
 */
import { describe, expect, it } from 'vitest'
import {
  buildCopyText,
  formatFrequency,
  formatPercent,
  formatSize,
  formatTimestamp,
  formatUptime,
  percentValue,
  platformLabel,
  summarizeDisks
} from './format'
import type { Snapshot } from './schema'

function fixture(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    collectedAt: new Date(2026, 0, 2, 3, 4, 5).getTime(),
    os: {
      platform: 'win32',
      type: 'Windows_NT',
      release: '10.0.22631',
      version: 'Windows 11',
      arch: 'x64',
      hostname: 'lumin-pc',
      uptimeSec: 90_061
    },
    cpu: { model: 'Intel Core', cores: 8, speedMhz: 3200 },
    memory: {
      totalBytes: 16 * 1024 ** 3,
      freeBytes: 4 * 1024 ** 3,
      usedBytes: 12 * 1024 ** 3
    },
    disks: [
      {
        path: 'C:\\',
        totalBytes: 100 * 1024 ** 3,
        freeBytes: 25 * 1024 ** 3,
        usedBytes: 75 * 1024 ** 3
      }
    ],
    networks: [{ name: 'Ethernet', address: '192.168.1.2', family: 'IPv4', mac: 'AA-BB' }],
    ...overrides
  }
}

describe('platformLabel', () => {
  it('已知平台映射为展示名，未知平台原样返回', () => {
    expect(platformLabel('win32')).toBe('Windows')
    expect(platformLabel('darwin')).toBe('macOS')
    expect(platformLabel('linux')).toBe('Linux')
    expect(platformLabel('freebsd')).toBe('freebsd')
  })
})

describe('formatUptime', () => {
  it('非法/负数按 0 处理', () => {
    expect(formatUptime(0)).toBe('00:00:00')
    expect(formatUptime(-5)).toBe('00:00:00')
    expect(formatUptime(Number.NaN)).toBe('00:00:00')
  })

  it('不足一天输出 HH:MM:SS，超过一天带天数', () => {
    expect(formatUptime(65)).toBe('00:01:05')
    expect(formatUptime(3661)).toBe('01:01:01')
    expect(formatUptime(90_061)).toBe('1 天 01:01:01')
  })
})

describe('formatFrequency', () => {
  it('非法/≤0 返回占位符', () => {
    expect(formatFrequency(0)).toBe('—')
    expect(formatFrequency(-1)).toBe('—')
    expect(formatFrequency(Number.NaN)).toBe('—')
  })

  it('低于 1000 MHz 用 MHz，否则转 GHz 去尾零', () => {
    expect(formatFrequency(800)).toBe('800 MHz')
    expect(formatFrequency(1000)).toBe('1 GHz')
    expect(formatFrequency(3200)).toBe('3.2 GHz')
    expect(formatFrequency(3234)).toBe('3.23 GHz')
  })
})

describe('percentValue / formatPercent', () => {
  it('百分比数值夹紧在 0–100', () => {
    expect(percentValue(0, 100)).toBe(0)
    expect(percentValue(25, 100)).toBe(25)
    expect(percentValue(200, 100)).toBe(100)
    expect(percentValue(10, 0)).toBe(0)
    expect(percentValue(Number.NaN, 100)).toBe(0)
  })

  it('文案保留 1 位小数，非法总量返回占位符', () => {
    expect(formatPercent(25, 100)).toBe('25.0%')
    expect(formatPercent(200, 100)).toBe('100.0%')
    expect(formatPercent(10, 0)).toBe('—')
    expect(formatPercent(Number.NaN, 100)).toBe('—')
  })
})

describe('formatSize', () => {
  it('0 显示 0 B，负数/非法显示占位符，其余委托 shared', () => {
    expect(formatSize(0)).toBe('0 B')
    expect(formatSize(-1)).toBe('—')
    expect(formatSize(Number.NaN)).toBe('—')
    expect(formatSize(1024)).toBe('1.0 KB')
    expect(formatSize(1536)).toBe('1.5 KB')
    expect(formatSize(1024 ** 3)).toBe('1.0 GB')
  })
})

describe('formatTimestamp', () => {
  it('按本地时区输出 YYYY-MM-DD HH:mm:ss', () => {
    expect(formatTimestamp(new Date(2026, 0, 2, 3, 4, 5).getTime())).toBe('2026-01-02 03:04:05')
    expect(formatTimestamp(Number.NaN)).toBe('—')
  })
})

describe('summarizeDisks', () => {
  it('空列表返回 0，多项求和且忽略非法值', () => {
    expect(summarizeDisks([])).toEqual({ totalBytes: 0, freeBytes: 0, usedBytes: 0 })
    expect(
      summarizeDisks([
        { path: 'C:\\', totalBytes: 100, freeBytes: 40, usedBytes: 60 },
        { path: 'D:\\', totalBytes: 200, freeBytes: 50, usedBytes: 150 }
      ])
    ).toEqual({ totalBytes: 300, freeBytes: 90, usedBytes: 210 })
    expect(
      summarizeDisks([{ path: 'C:\\', totalBytes: -1, freeBytes: Number.NaN, usedBytes: 10 }])
    ).toEqual({ totalBytes: 0, freeBytes: 0, usedBytes: 10 })
  })
})

describe('buildCopyText', () => {
  it('输出五段中文概览', () => {
    const text = buildCopyText(fixture())
    expect(text).toContain('系统信息（采集时间：2026-01-02 03:04:05）')
    expect(text).toContain('操作系统：Windows 10.0.22631（x64）')
    expect(text).toContain('主机名：lumin-pc')
    expect(text).toContain('运行时长：1 天 01:01:01')
    expect(text).toContain('处理器：Intel Core · 8 核 · 3.2 GHz')
    expect(text).toContain('内存：已用 12.0 GB / 共 16.0 GB（75.0%）')
    expect(text).toContain('磁盘：')
    expect(text).toContain('  C:\\ 已用 75.0 GB / 共 100.0 GB（75.0%）')
    expect(text).toContain('网络：')
    expect(text).toContain('  Ethernet 192.168.1.2（IPv4） · AA-BB')
  })

  it('无磁盘/无网络时给出说明，空 MAC 不追加分隔符', () => {
    const text = buildCopyText(
      fixture({
        disks: [],
        networks: [{ name: 'Wi-Fi', address: 'fe80::1', family: 'IPv6', mac: '' }]
      })
    )
    expect(text).toContain('（未检测到可访问磁盘）')
    const wifiLine = text.split('\n').find((line) => line.includes('Wi-Fi'))
    expect(wifiLine).toBe('  Wi-Fi fe80::1（IPv6）')
  })
})
