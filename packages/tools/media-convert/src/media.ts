/**
 * @file 探测/时间/进度解析纯函数（spec §3.4，无副作用）
 * @author cuilanchao
 * @date 2026-11-19
 * @description 解析 `ffmpeg -i` stderr（时长/音视频流）、用户时间输入（90 / 1:30 / 01:02:03.5）
 *              与 `-progress pipe:1` 的 key=value 输出；损坏特征与 image-toolbox 同口径
 */
import { MAX_TRIM_SEC } from './schema'

/** 损坏类 stderr 特征（据此把「无可用流」细分为文件损坏） */
export const CORRUPT_HINTS =
  /Invalid data|moov atom not found|does not contain any stream|End of file|No .* data found|Could not find codec parameters|Error while decoding|Invalid NAL unit/i

/** 解析后的媒体信息（video/audio 缺失为 null） */
export interface ParsedMediaInfo {
  durationSec: number
  video: { codec: string; width: number; height: number; fps: number } | null
  audio: { codec: string; sampleRate: number; channels: number } | null
}

/** 声道描述 → 数量（未知按立体声） */
function channelsOf(text: string): number {
  if (/mono/i.test(text)) return 1
  if (/stereo/i.test(text)) return 2
  if (/7\.1/i.test(text)) return 8
  if (/5\.1/i.test(text)) return 6
  if (/quad/i.test(text)) return 4
  return 2
}

/**
 * 解析 `ffmpeg -i <file>` 的 stderr（无输出文件时 ffmpeg 以 code 1 退出并打印媒体信息）
 * @param stderr 探测输出
 * @returns 时长与首个音视频流；完全无法识别 → null
 */
export function parseMediaInfo(stderr: string): ParsedMediaInfo | null {
  const durationMatch = /Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(stderr)
  const durationSec =
    durationMatch === null
      ? 0
      : Number(durationMatch[1]) * 3600 + Number(durationMatch[2]) * 60 + Number(durationMatch[3])

  let video: ParsedMediaInfo['video'] = null
  let audio: ParsedMediaInfo['audio'] = null

  for (const line of stderr.split(/\r?\n/)) {
    if (video === null) {
      const marker = ': Video: '
      const idx = line.indexOf(marker)
      if (idx !== -1) {
        const rest = line.slice(idx + marker.length)
        const codec = /^([^\s,]+)/.exec(rest)?.[1]
        const size = /(\d{2,5})x(\d{2,5})/.exec(rest)
        if (codec !== undefined && size !== null) {
          const width = Number(size[1])
          const height = Number(size[2])
          if (width > 0 && height > 0) {
            const fps = Number(/(\d+(?:\.\d+)?)\s*fps/.exec(rest)?.[1] ?? 0)
            video = { codec, width, height, fps: fps > 0 ? fps : 25 }
          }
        }
      }
    }
    if (audio === null) {
      const marker = ': Audio: '
      const idx = line.indexOf(marker)
      if (idx !== -1) {
        const rest = line.slice(idx + marker.length)
        const codec = /^([^\s,]+)/.exec(rest)?.[1]
        if (codec !== undefined) {
          const sampleRate = Number(/(\d+)\s*Hz/.exec(rest)?.[1] ?? 48000)
          audio = {
            codec,
            sampleRate: sampleRate > 0 ? sampleRate : 48000,
            channels: channelsOf(rest)
          }
        }
      }
    }
  }

  if (durationMatch === null && video === null && audio === null) return null
  return { durationSec, video, audio }
}

/**
 * 用户时间输入 → 秒：`90` / `1:30` / `01:02:03.5`
 * @param text 原始输入
 * @returns 秒数；非法或超过 24h → null
 */
export function parseTimecode(text: string): number | null {
  const trimmed = text.trim()
  if (!/^\d+(:\d{1,2}){0,2}(\.\d+)?$/.test(trimmed)) return null
  // 正则已保证最多 3 段且全为数字，无需再做段数/有限性校验
  const parts = trimmed.split(':')
  let seconds = 0
  for (const [index, part] of parts.entries()) {
    // 分/秒位必须 < 60（秒可带小数）
    if (index > 0 && Number(part) >= 60) return null
    seconds = seconds * 60 + Number(part)
  }
  if (seconds < 0 || seconds > MAX_TRIM_SEC) return null
  return seconds
}

/**
 * 秒 → 进度展示时钟（`mm:ss` / 超过 1h 为 `h:mm:ss`）
 * @param seconds 秒
 */
export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const hh = Math.floor(total / 3600)
  const mm = String(Math.floor((total % 3600) / 60)).padStart(2, '0')
  const ss = String(total % 60).padStart(2, '0')
  return hh > 0 ? `${String(hh)}:${mm}:${ss}` : `${mm}:${ss}`
}

/**
 * 秒 → 命名用紧凑时间标签 `HHMMSS`
 * @param seconds 秒（四舍五入）
 */
export function formatTimeTag(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  const hh = String(Math.floor(total / 3600)).padStart(2, '0')
  const mm = String(Math.floor((total % 3600) / 60)).padStart(2, '0')
  const ss = String(total % 60).padStart(2, '0')
  return `${hh}${mm}${ss}`
}

/** `-progress` 单行解析结果 */
export interface ProgressValue {
  /** 已处理时长（微秒）；仅 progress=end 行为 undefined */
  outTimeUs?: number
  /** progress=end */
  finished?: boolean
}

/**
 * 解析 `-progress pipe:1` 输出单行（key=value）
 * @param line 单行文本
 * @returns 可识别信息；无关行 → null
 */
export function parseProgressLine(line: string): ProgressValue | null {
  const trimmed = line.trim()
  if (trimmed === 'progress=end') return { finished: true }
  const match = /^out_time_(?:us|ms)=(\d+)$/.exec(trimmed)
  if (match === null) return null
  // ffmpeg 的 out_time_ms 实际也是微秒（历史字段名）
  return { outTimeUs: Number(match[1]) }
}

/**
 * 进度节流判定：百分比至少 +1 或距上次 ≥200ms 或已完成才推送
 * @param previousPercent 上次推送的当前文件百分比（null = 尚未推送）
 * @param nextPercent 本次百分比
 * @param nowMs 当前时间
 * @param lastMs 上次推送时间
 */
export function shouldEmitProgress(
  previousPercent: number | null,
  nextPercent: number,
  nowMs: number,
  lastMs: number
): boolean {
  if (previousPercent === null) return true
  if (nextPercent >= 100) return true
  if (nextPercent - previousPercent >= 1) return true
  return nowMs - lastMs >= 200
}
