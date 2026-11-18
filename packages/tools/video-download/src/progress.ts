/**
 * @file yt-dlp 进度解析与格式预设映射（核心纯函数，覆盖率 ≥80% 分组）
 * @author cuilanchao
 * @date 2026-11-18
 * @description `--progress-template download:PROGRESS|…` 输出行解析、preset → `-f` 参数映射、速度/剩余时间格式化（spec/video-download.md §4）
 */
import type { Preset } from './schema'

/**
 * 进度快照：一行 PROGRESS 输出的解析结果（数值可能缺失/非法 → null 字段）
 */
export interface ProgressSnapshot {
  downloadedBytes: number | null
  totalBytes: number | null
  speedBps: number | null
  etaSec: number | null
}

/** progress-template 行前缀（与 start 参数严格一致） */
const PROGRESS_PREFIX = 'PROGRESS|'

/**
 * 解析 progress-template 输出行；非 PROGRESS 行（如 [download]、[Merger]）返回 null
 * @param line yt-dlp --newline 的一行 stdout
 */
export function parseProgressLine(line: string): ProgressSnapshot | null {
  if (!line.startsWith(PROGRESS_PREFIX)) return null
  const parts = line.slice(PROGRESS_PREFIX.length).split('|')
  // 期望 4 段：downloaded | total_estimate | speed | eta
  const num = (raw: string | undefined): number | null => {
    if (raw === undefined) return null
    const trimmed = raw.trim()
    if (trimmed === '' || trimmed === 'NA') return null
    const value = Number(trimmed)
    return Number.isFinite(value) && value >= 0 ? value : null
  }
  return {
    downloadedBytes: num(parts[0]),
    totalBytes: num(parts[1]),
    speedBps: num(parts[2]),
    etaSec: num(parts[3])
  }
}

/**
 * preset → yt-dlp `-f` 格式串（spec §1；audio-mp3 需搭配 extract-audio 参数，由 buildStartArgs 拼）
 * @param preset 格式预设
 */
export function formatArgFor(preset: Preset): string {
  switch (preset) {
    case 'best':
      return 'bv*+ba/b'
    case '1080p':
      return 'bv*[height<=1080]+ba/b[height<=1080]'
    case 'audio-mp3':
      return 'ba'
  }
}

/**
 * 速度格式化（B/s → KB/s、MB/s，保留 1 位小数）
 * @param bps 字节每秒；null/非有限数返回 null
 */
export function formatSpeed(bps: number | null): string | null {
  if (bps === null || !Number.isFinite(bps) || bps < 0) return null
  if (bps < 1024) return `${Math.round(bps)} B/s`
  if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(1)} KB/s`
  return `${(bps / (1024 * 1024)).toFixed(1)} MB/s`
}

/**
 * 剩余时间格式化（秒 → m:ss / h:mm:ss）
 * @param etaSec 剩余秒；null/非有限数返回 null
 */
export function formatEta(etaSec: number | null): string | null {
  if (etaSec === null || !Number.isFinite(etaSec) || etaSec < 0) return null
  const total = Math.round(etaSec)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const two = (n: number): string => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`
}

/**
 * 组装 progress 事件的 message 文案（速度 + ETA 可缺省）
 * @param snapshot 解析后的进度快照
 */
export function progressMessage(snapshot: ProgressSnapshot): string | undefined {
  const parts: string[] = []
  const speed = formatSpeed(snapshot.speedBps)
  if (speed !== null) parts.push(speed)
  const eta = formatEta(snapshot.etaSec)
  if (eta !== null) parts.push(`剩余 ${eta}`)
  return parts.length === 0 ? undefined : parts.join(' · ')
}

/**
 * 组装 yt-dlp start 参数（纯函数，便于测试；含合流/续传/命名模板）
 * @param input 下载输入
 * @param input.url 视频链接
 * @param input.preset 格式预设
 * @param input.outputDir 输出目录（绝对路径）
 * @param input.engineDir 引擎目录（yt-dlp.exe 与 ffmpeg 所在，`--ffmpeg-location` 指向）
 */
export function buildStartArgs(input: {
  url: string
  preset: Preset
  outputDir: string
  engineDir: string
}): string[] {
  const args = [
    '--no-playlist',
    '--newline',
    '--progress-template',
    'download:PROGRESS|%(progress.downloaded_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s',
    '--ffmpeg-location',
    input.engineDir,
    '--no-overwrites',
    '--continue',
    '-P',
    input.outputDir,
    '-o',
    '%(title).120s [%(id)s].%(ext)s'
  ]
  if (input.preset === 'audio-mp3') {
    args.push('-f', formatArgFor(input.preset), '--extract-audio', '--audio-format', 'mp3')
  } else {
    args.push('-f', formatArgFor(input.preset))
  }
  // after_move 不触发 simulate 模式：下载完成后输出最终文件路径（裸路径行）
  args.push('--print', 'after_move:filepath', input.url)
  return args
}

/**
 * 组装 probe 参数（-J 输出单 JSON；20s 超时由调用方 runProcess timeoutMs 控制）
 * @param url 视频链接
 */
export function buildProbeArgs(url: string): string[] {
  return ['-J', '--no-playlist', url]
}
