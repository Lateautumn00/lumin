/**
 * @file schema.test.ts zod 契约单测
 * @author cuilanchao
 * @date 2026-11-22
 */
import { describe, expect, it } from 'vitest'
import { MAX_DISKS, snapshotSchema, type Snapshot } from './schema'

function fixture(): Snapshot {
  return {
    collectedAt: 1_700_000_000_000,
    os: {
      platform: 'win32',
      type: 'Windows_NT',
      release: '10.0.22631',
      version: 'Windows 11',
      arch: 'x64',
      hostname: 'lumin-pc',
      uptimeSec: 100
    },
    cpu: { model: 'Test CPU', cores: 8, speedMhz: 3200 },
    memory: { totalBytes: 100, freeBytes: 25, usedBytes: 75 },
    disks: [{ path: 'C:\\', totalBytes: 100, freeBytes: 25, usedBytes: 75 }],
    networks: [{ name: 'Ethernet', address: '192.168.1.2', family: 'IPv4', mac: 'AA-BB' }]
  }
}

describe('snapshotSchema', () => {
  it('合法快照解析通过', () => {
    expect(snapshotSchema.parse(fixture())).toEqual(fixture())
  })

  it('负数字节 / 零核心 / 负 uptime 均拒绝', () => {
    expect(() =>
      snapshotSchema.parse({
        ...fixture(),
        memory: { totalBytes: -1, freeBytes: 0, usedBytes: 0 }
      })
    ).toThrow()
    expect(() =>
      snapshotSchema.parse({ ...fixture(), cpu: { ...fixture().cpu, cores: 0 } })
    ).toThrow()
    expect(() =>
      snapshotSchema.parse({ ...fixture(), os: { ...fixture().os, uptimeSec: -1 } })
    ).toThrow()
  })

  it('磁盘数量超过上限拒绝', () => {
    const disks = Array.from({ length: MAX_DISKS + 1 }, (_, index) => ({
      path: `${String.fromCharCode(65 + index)}:\\`,
      totalBytes: 1,
      freeBytes: 0,
      usedBytes: 1
    }))
    expect(() => snapshotSchema.parse({ ...fixture(), disks })).toThrow()
  })

  it('网络协议只接受 IPv4 / IPv6', () => {
    expect(() =>
      snapshotSchema.parse({
        ...fixture(),
        networks: [{ name: 'X', address: '1', family: 'IPv7', mac: '' }]
      })
    ).toThrow()
  })
})
