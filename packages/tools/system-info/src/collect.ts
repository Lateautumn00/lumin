/**
 * @file 主进程系统信息采集（依赖可注入，便于单测）
 * @author cuilanchao
 * @date 2026-11-22
 * @description node:os 概览 + fs.statfs 磁盘容量；只读，不写任何文件。
 */
import { statfs } from 'node:fs/promises'
import * as os from 'node:os'
import {
  MAX_DISKS,
  MAX_NETWORKS,
  snapshotSchema,
  type DiskInfo,
  type NetworkInfo,
  type Snapshot
} from './schema'

/** CPU 信息源（os.cpus() 的结构子集） */
export interface CpuSource {
  model: string
  speed: number
}

/** 网卡地址源（os.networkInterfaces() 的结构子集） */
export interface NetworkSource {
  address: string
  family: string | number
  mac: string
  internal: boolean
}

/** statfs 结果的结构子集 */
export interface FileSystemStats {
  bsize: number
  blocks: number
  bfree: number
}

/** 采集依赖（测试注入假件，生产由 node:os / node:fs 提供） */
export interface SystemInfoDeps {
  cpus(): readonly CpuSource[]
  totalmem(): number
  freemem(): number
  platform(): string
  type(): string
  release(): string
  version(): string
  arch(): string
  hostname(): string
  uptime(): number
  networkInterfaces(): Record<string, readonly NetworkSource[] | undefined>
  statfs(path: string): Promise<FileSystemStats>
  now(): number
  drivePaths: readonly string[]
}

/** 默认探测路径：Windows 遍历 A:–Z:，其余平台仅 `/` */
export function defaultDrivePaths(): string[] {
  if (process.platform !== 'win32') return ['/']
  return Array.from({ length: 26 }, (_, index) => `${String.fromCharCode(65 + index)}:\\`)
}

/** 生产依赖 */
export function createDefaultDeps(): SystemInfoDeps {
  return {
    cpus: () => os.cpus(),
    totalmem: () => os.totalmem(),
    freemem: () => os.freemem(),
    platform: () => os.platform(),
    type: () => os.type(),
    release: () => os.release(),
    version: () => os.version(),
    arch: () => os.arch(),
    hostname: () => os.hostname(),
    uptime: () => os.uptime(),
    networkInterfaces: () => os.networkInterfaces(),
    statfs: async (path) => statfs(path),
    now: () => Date.now(),
    drivePaths: defaultDrivePaths()
  }
}

/**
 * 采集一次系统信息快照
 * @param deps 采集依赖
 */
export async function collectSnapshot(deps: SystemInfoDeps): Promise<Snapshot> {
  const cpuList = deps.cpus()
  const speeds = cpuList.map((cpu) => cpu.speed).filter((speed) => Number.isFinite(speed) && speed > 0)
  const speedMhz =
    speeds.length === 0 ? 0 : Math.round(speeds.reduce((sum, speed) => sum + speed, 0) / speeds.length)

  const totalBytes = safeInt(deps.totalmem())
  const freeBytes = Math.min(totalBytes, safeInt(deps.freemem()))
  const disks = await collectDisks(deps)

  return snapshotSchema.parse({
    collectedAt: safeInt(deps.now()),
    os: {
      platform: deps.platform(),
      type: deps.type(),
      release: deps.release(),
      version: deps.version(),
      arch: deps.arch(),
      hostname: deps.hostname(),
      uptimeSec: safeInt(deps.uptime())
    },
    cpu: {
      model: cpuList[0]?.model ?? '未知处理器',
      cores: Math.max(1, cpuList.length),
      speedMhz
    },
    memory: {
      totalBytes,
      freeBytes,
      usedBytes: Math.max(0, totalBytes - freeBytes)
    },
    disks,
    networks: collectNetworks(deps)
  })
}

/** 并发探测所有盘符，不可访问/容量非法的盘符静默跳过 */
async function collectDisks(deps: SystemInfoDeps): Promise<DiskInfo[]> {
  const probes = await Promise.all(
    deps.drivePaths.map(async (path) => {
      try {
        return diskFromStats(path, await deps.statfs(path))
      } catch {
        return null
      }
    })
  )
  return probes
    .filter((disk): disk is DiskInfo => disk !== null)
    .sort((a, b) => a.path.localeCompare(b.path))
    .slice(0, MAX_DISKS)
}

/** statfs 结果 → 磁盘信息（总容量 ≤0 视为无效盘符） */
function diskFromStats(path: string, stats: FileSystemStats): DiskInfo | null {
  const totalBytes = safeInt(stats.bsize * stats.blocks)
  if (totalBytes <= 0) return null
  const freeBytes = Math.min(totalBytes, safeInt(stats.bsize * stats.bfree))
  return { path, totalBytes, freeBytes, usedBytes: Math.max(0, totalBytes - freeBytes) }
}

/** 扁平化网卡地址，过滤回环与非法协议，排序后截断 */
function collectNetworks(deps: SystemInfoDeps): NetworkInfo[] {
  const result: NetworkInfo[] = []
  for (const [name, addresses] of Object.entries(deps.networkInterfaces())) {
    if (addresses === undefined) continue
    for (const item of addresses) {
      if (item.internal) continue
      const family = familyOf(item.family)
      if (family === null || item.address === '') continue
      result.push({ name, address: item.address, family, mac: item.mac })
    }
  }
  return result
    .sort(
      (a, b) =>
        a.name.localeCompare(b.name) ||
        a.family.localeCompare(b.family) ||
        a.address.localeCompare(b.address)
    )
    .slice(0, MAX_NETWORKS)
}

/** 协议族归一（兼容旧版 Node 的数字 4/6） */
function familyOf(raw: string | number): NetworkInfo['family'] | null {
  if (raw === 'IPv4' || raw === 4) return 'IPv4'
  if (raw === 'IPv6' || raw === 6) return 'IPv6'
  return null
}

/** 非负整数化（非法/负数 → 0） */
function safeInt(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.round(value) : 0
}
