/**
 * @file 纯展示函数（无 IO，便于单测；spec §6）
 * @author cuilanchao
 * @date 2026-11-22
 * @description 平台名、运行时长、频率、百分比、时间戳、磁盘汇总与复制文本
 */
import { formatBytes } from '@lumin/shared'
import type { DiskInfo, Snapshot } from './schema'

/** 平台标识 → 展示名（未知平台原样返回） */
export function platformLabel(platform: string): string {
  if (platform === 'win32') return 'Windows'
  if (platform === 'darwin') return 'macOS'
  if (platform === 'linux') return 'Linux'
  return platform
}

/**
 * 运行时长（秒 → `MM:SS` / `HH:MM:SS` / `N 天 HH:MM:SS`）
 * @param seconds 系统 uptime（非法/负数按 0 处理）
 */
export function formatUptime(seconds: number): string {
  const total =
    Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0
  const days = Math.floor(total / 86_400)
  const hours = Math.floor((total % 86_400) / 3_600)
  const minutes = Math.floor((total % 3_600) / 60)
  const secs = total % 60
  const clock = `${pad2(hours)}:${pad2(minutes)}:${pad2(secs)}`
  return days > 0 ? `${days} 天 ${clock}` : clock
}

/**
 * 主频展示：≥1000 MHz 转 GHz（最多 2 位小数并去尾零）
 * @param mhz 主频（MHz；非法/≤0 → `—`）
 */
export function formatFrequency(mhz: number): string {
  if (!Number.isFinite(mhz) || mhz <= 0) return '—'
  if (mhz >= 1000) return `${trimZeros(mhz / 1000, 2)} GHz`
  return `${Math.round(mhz)} MHz`
}

/**
 * 使用率数值（0–100，供进度条宽度）
 * @param used 已用
 * @param total 总量（≤0/非法 → 0）
 */
export function percentValue(used: number, total: number): number {
  if (!Number.isFinite(used) || !Number.isFinite(total) || total <= 0 || used <= 0) return 0
  return Math.min(100, (used / total) * 100)
}

/**
 * 使用率文案（保留 1 位小数）
 * @param used 已用
 * @param total 总量（≤0/非法 → `—`）
 */
export function formatPercent(used: number, total: number): string {
  if (!Number.isFinite(used) || !Number.isFinite(total) || total <= 0) return '—'
  return `${percentValue(used, total).toFixed(1)}%`
}

/**
 * 字节体积展示（0 → `0 B`，其余委托 shared.formatBytes）
 * @param bytes 字节数（非法/负数 → `—`）
 */
export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes === 0) return '0 B'
  return formatBytes(bytes)
}

/**
 * 毫秒时间戳 → `YYYY-MM-DD HH:mm:ss`（本地时区）
 * @param ms 毫秒时间戳（非法 → `—`）
 */
export function formatTimestamp(ms: number): string {
  if (!Number.isFinite(ms)) return '—'
  const date = new Date(ms)
  if (Number.isNaN(date.getTime())) return '—'
  return (
    `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ` +
    `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
  )
}

/** 磁盘汇总（非法值按 0 计） */
export interface DiskSummary {
  totalBytes: number
  freeBytes: number
  usedBytes: number
}

/**
 * 汇总所有磁盘容量
 * @param disks 磁盘列表
 */
export function summarizeDisks(disks: readonly DiskInfo[]): DiskSummary {
  let totalBytes = 0
  let freeBytes = 0
  let usedBytes = 0
  for (const disk of disks) {
    totalBytes += safeInt(disk.totalBytes)
    freeBytes += safeInt(disk.freeBytes)
    usedBytes += safeInt(disk.usedBytes)
  }
  return { totalBytes, freeBytes, usedBytes }
}

/**
 * 「复制全部」多行文本（中文标签，spec §2）
 * @param snapshot 系统信息快照
 */
export function buildCopyText(snapshot: Snapshot): string {
  const lines: string[] = []
  lines.push(`系统信息（采集时间：${formatTimestamp(snapshot.collectedAt)}）`)
  lines.push(
    `操作系统：${platformLabel(snapshot.os.platform)} ${snapshot.os.release}（${snapshot.os.arch}）`
  )
  lines.push(`主机名：${snapshot.os.hostname}`)
  lines.push(`运行时长：${formatUptime(snapshot.os.uptimeSec)}`)
  lines.push(
    `处理器：${snapshot.cpu.model} · ${snapshot.cpu.cores} 核 · ${formatFrequency(snapshot.cpu.speedMhz)}`
  )
  lines.push(
    `内存：已用 ${formatSize(snapshot.memory.usedBytes)} / 共 ${formatSize(snapshot.memory.totalBytes)}（${formatPercent(snapshot.memory.usedBytes, snapshot.memory.totalBytes)}）`
  )
  lines.push('磁盘：')
  if (snapshot.disks.length === 0) {
    lines.push('  （未检测到可访问磁盘）')
  } else {
    for (const disk of snapshot.disks) {
      lines.push(
        `  ${disk.path} 已用 ${formatSize(disk.usedBytes)} / 共 ${formatSize(disk.totalBytes)}（${formatPercent(disk.usedBytes, disk.totalBytes)}）`
      )
    }
  }
  lines.push('网络：')
  if (snapshot.networks.length === 0) {
    lines.push('  （未检测到外部网络接口）')
  } else {
    for (const network of snapshot.networks) {
      const mac = network.mac === '' ? '' : ` · ${network.mac}`
      lines.push(`  ${network.name} ${network.address}（${network.family}）${mac}`)
    }
  }
  return lines.join('\n')
}

/** 两位补零 */
function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

/** 保留 digits 位小数并去掉尾零 */
function trimZeros(value: number, digits: number): string {
  return value.toFixed(digits).replace(/\.?0+$/, '')
}

/** 非负整数化（非法/负数 → 0） */
function safeInt(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.round(value) : 0
}
