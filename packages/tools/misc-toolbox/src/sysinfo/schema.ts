/**
 * @file IPC 出参 zod schema（AGENTS §6：主进程返回前校验）
 * @author cuilanchao
 * @date 2026-11-22
 * @description system-info:snapshot 的系统信息快照契约（spec §4）
 */
import { z } from 'zod'

/** 单次快照最多返回的磁盘数 */
export const MAX_DISKS = 16

/** 单次快照最多返回的网络接口数 */
export const MAX_NETWORKS = 32

export const osInfoSchema = z.object({
  platform: z.string(),
  type: z.string(),
  release: z.string(),
  version: z.string(),
  arch: z.string(),
  hostname: z.string(),
  uptimeSec: z.number().int().nonnegative()
})

export type OsInfo = z.infer<typeof osInfoSchema>

export const cpuInfoSchema = z.object({
  model: z.string(),
  cores: z.number().int().positive(),
  /** 平均主频（MHz，0 表示系统未上报） */
  speedMhz: z.number().int().nonnegative()
})

export type CpuInfo = z.infer<typeof cpuInfoSchema>

export const memoryInfoSchema = z.object({
  totalBytes: z.number().int().nonnegative(),
  freeBytes: z.number().int().nonnegative(),
  usedBytes: z.number().int().nonnegative()
})

export type MemoryInfo = z.infer<typeof memoryInfoSchema>

export const diskInfoSchema = z.object({
  /** 盘符根路径（Windows 形如 `C:\`，非 Windows 为 `/`） */
  path: z.string().min(1),
  totalBytes: z.number().int().nonnegative(),
  freeBytes: z.number().int().nonnegative(),
  usedBytes: z.number().int().nonnegative()
})

export type DiskInfo = z.infer<typeof diskInfoSchema>

export const networkInfoSchema = z.object({
  name: z.string().min(1),
  address: z.string().min(1),
  family: z.enum(['IPv4', 'IPv6']),
  mac: z.string()
})

export type NetworkInfo = z.infer<typeof networkInfoSchema>

export const snapshotSchema = z.object({
  /** 采集时间（毫秒时间戳） */
  collectedAt: z.number().int().nonnegative(),
  os: osInfoSchema,
  cpu: cpuInfoSchema,
  memory: memoryInfoSchema,
  disks: z.array(diskInfoSchema).max(MAX_DISKS),
  networks: z.array(networkInfoSchema).max(MAX_NETWORKS)
})

export type Snapshot = z.infer<typeof snapshotSchema>
