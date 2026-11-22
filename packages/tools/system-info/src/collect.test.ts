/**
 * @file collect.test.ts 采集逻辑单测（假 deps，不触真实系统）
 * @author cuilanchao
 * @date 2026-11-22
 */
import { describe, expect, it } from 'vitest'
import {
  collectSnapshot,
  createDefaultDeps,
  defaultDrivePaths,
  type SystemInfoDeps
} from './collect'
import { MAX_NETWORKS } from './schema'

const GiB = 1024 ** 3

function fakeDeps(overrides: Partial<SystemInfoDeps> = {}): SystemInfoDeps {
  return {
    cpus: () => [
      { model: 'Test CPU', speed: 2000 },
      { model: 'Test CPU', speed: 4000 }
    ],
    totalmem: () => 16 * GiB,
    freemem: () => 4 * GiB,
    platform: () => 'win32',
    type: () => 'Windows_NT',
    release: () => '10.0.22631',
    version: () => 'Windows 11',
    arch: () => 'x64',
    hostname: () => 'lumin-test',
    uptime: () => 90_061,
    networkInterfaces: () => ({
      'Loopback Pseudo-Interface 1': [
        { address: '127.0.0.1', family: 'IPv4', mac: '00-00', internal: true }
      ],
      Ethernet: [
        { address: '192.168.1.2', family: 'IPv4', mac: 'AA-BB', internal: false },
        { address: 'fe80::1', family: 'IPv6', mac: 'AA-BB', internal: false }
      ]
    }),
    statfs: async (path) =>
      path === 'C:\\'
        ? { bsize: 4096, blocks: 100, bfree: 25 }
        : Promise.reject(new Error('ENOENT')),
    now: () => 1_700_000_000_000,
    drivePaths: ['C:\\', 'D:\\'],
    ...overrides
  }
}

describe('collectSnapshot', () => {
  it('聚合 OS/CPU/内存/磁盘/网络，跳过不可访问盘符与回环网卡', async () => {
    const snapshot = await collectSnapshot(fakeDeps())
    expect(snapshot.collectedAt).toBe(1_700_000_000_000)
    expect(snapshot.os).toEqual({
      platform: 'win32',
      type: 'Windows_NT',
      release: '10.0.22631',
      version: 'Windows 11',
      arch: 'x64',
      hostname: 'lumin-test',
      uptimeSec: 90_061
    })
    expect(snapshot.cpu).toEqual({ model: 'Test CPU', cores: 2, speedMhz: 3000 })
    expect(snapshot.memory).toEqual({
      totalBytes: 16 * GiB,
      freeBytes: 4 * GiB,
      usedBytes: 12 * GiB
    })
    expect(snapshot.disks).toEqual([
      { path: 'C:\\', totalBytes: 409_600, freeBytes: 102_400, usedBytes: 307_200 }
    ])
    expect(snapshot.networks).toEqual([
      { name: 'Ethernet', address: '192.168.1.2', family: 'IPv4', mac: 'AA-BB' },
      { name: 'Ethernet', address: 'fe80::1', family: 'IPv6', mac: 'AA-BB' }
    ])
  })

  it('磁盘按路径排序，容量非法或 statfs 抛错时跳过', async () => {
    const snapshot = await collectSnapshot(
      fakeDeps({
        drivePaths: ['D:\\', 'C:\\', 'E:\\', 'F:\\'],
        statfs: async (path) => {
          if (path === 'D:\\') return { bsize: 512, blocks: 200, bfree: 100 }
          if (path === 'C:\\') return { bsize: 512, blocks: 100, bfree: 25 }
          if (path === 'E:\\') return { bsize: 0, blocks: 100, bfree: 0 }
          return Promise.reject(new Error('ENOENT'))
        }
      })
    )
    expect(snapshot.disks.map((disk) => disk.path)).toEqual(['C:\\', 'D:\\'])
  })

  it('磁盘总量上限截断到 MAX_DISKS', async () => {
    const paths = Array.from({ length: 20 }, (_, index) => `${String.fromCharCode(65 + index)}:\\`)
    const snapshot = await collectSnapshot(
      fakeDeps({
        drivePaths: paths,
        statfs: async () => ({ bsize: 1024, blocks: 10, bfree: 5 })
      })
    )
    expect(snapshot.disks).toHaveLength(16)
  })

  it('CPU 无有效主频/无核心时回落默认值', async () => {
    const snapshot = await collectSnapshot(
      fakeDeps({ cpus: () => [] })
    )
    expect(snapshot.cpu).toEqual({ model: '未知处理器', cores: 1, speedMhz: 0 })

    const zeroSpeed = await collectSnapshot(
      fakeDeps({
        cpus: () => [
          { model: 'X', speed: 0 },
          { model: 'X', speed: Number.NaN },
          { model: 'X', speed: 2400 }
        ]
      })
    )
    expect(zeroSpeed.cpu.speedMhz).toBe(2400)
  })

  it('可用内存大于总量时夹紧，used 不为负', async () => {
    const snapshot = await collectSnapshot(fakeDeps({ totalmem: () => 100, freemem: () => 200 }))
    expect(snapshot.memory).toEqual({ totalBytes: 100, freeBytes: 100, usedBytes: 0 })
  })

  it('网卡过滤回环/非法协议，按名称地址排序并截断', async () => {
    const interfaces: Record<string, { address: string; family: string | number; mac: string; internal: boolean }[]> = {}
    for (let index = 0; index < 40; index += 1) {
      const name = `NIC-${String(index).padStart(2, '0')}`
      interfaces[name] = [
        { address: `10.0.0.${index}`, family: 4, mac: '', internal: false }
      ]
    }
    interfaces.Bad = [{ address: '1.2.3.4', family: 'IPv5', mac: '', internal: false }]
    const snapshot = await collectSnapshot(fakeDeps({ networkInterfaces: () => interfaces }))
    expect(snapshot.networks).toHaveLength(MAX_NETWORKS)
    expect(snapshot.networks[0]?.name).toBe('NIC-00')
    expect(snapshot.networks[0]?.family).toBe('IPv4')
    expect(snapshot.networks.at(-1)?.name).toBe('NIC-31')
  })

  it('采集时间非法时归零', async () => {
    const snapshot = await collectSnapshot(fakeDeps({ now: () => Number.NaN }))
    expect(snapshot.collectedAt).toBe(0)
  })
})

describe('defaultDrivePaths', () => {
  it('Windows 返回 26 个盘符，非 Windows 返回根路径', () => {
    const paths = defaultDrivePaths()
    if (process.platform === 'win32') {
      expect(paths).toHaveLength(26)
      expect(paths[0]).toBe('A:\\')
      expect(paths.at(-1)).toBe('Z:\\')
    } else {
      expect(paths).toEqual(['/'])
    }
  })
})

describe('createDefaultDeps', () => {
  it('生产依赖各项可调用（真实 node:os / fs.statfs 冒烟）', async () => {
    const deps = createDefaultDeps()
    expect(Array.isArray(deps.cpus())).toBe(true)
    expect(deps.totalmem()).toBeGreaterThan(0)
    expect(deps.freemem()).toBeGreaterThanOrEqual(0)
    expect(typeof deps.platform()).toBe('string')
    expect(typeof deps.type()).toBe('string')
    expect(typeof deps.release()).toBe('string')
    expect(typeof deps.version()).toBe('string')
    expect(typeof deps.arch()).toBe('string')
    expect(typeof deps.hostname()).toBe('string')
    expect(deps.uptime()).toBeGreaterThan(0)
    expect(typeof deps.networkInterfaces()).toBe('object')
    const stats = await deps.statfs(process.cwd())
    expect(stats.bsize).toBeGreaterThan(0)
    expect(deps.now()).toBeGreaterThan(0)
    expect(deps.drivePaths.length).toBeGreaterThan(0)
  })
})
