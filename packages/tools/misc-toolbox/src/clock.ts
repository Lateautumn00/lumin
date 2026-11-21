/**
 * @file 计时器纯逻辑（格式 / 番茄钟阶段流转 / 计次，spec/misc-toolbox.md §2）
 * @author cuilanchao
 * @date 2026-11-21
 * @description 与 Vue 解耦：刷新用 performance.now 差值，显示格式与状态流转均在此单测覆盖
 */

/** 秒表计次列表上限（新的在上，spec §2.1） */
export const MAX_LAPS = 20

/** 显示刷新周期（仅用于刷新显示，不参与计时精度） */
export const TICK_INTERVAL_MS = 50

/** 番茄钟阶段 */
export type PomodoroPhase = 'focus' | 'short-break' | 'long-break'

/** 番茄钟状态：当前阶段 + 已完成专注数 */
export interface PomodoroState {
  phase: PomodoroPhase
  completedFocus: number
}

/** 一次计次：分段耗时与累计耗时（ms） */
export interface Lap {
  totalMs: number
  segmentMs: number
}

/** 倒计时输入（时/分/秒） */
export interface CountdownParts {
  hours: number
  minutes: number
  seconds: number
}

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value)
}

/**
 * 秒表显示：`mm:ss.cs`；超过 1 小时显示 `h:mm:ss`
 * @param ms 已计时毫秒
 */
export function formatClock(ms: number): string {
  const total = Number.isFinite(ms) ? Math.max(0, Math.floor(ms)) : 0
  const hours = Math.floor(total / 3_600_000)
  const minutes = Math.floor(total / 60_000) % 60
  const seconds = Math.floor(total / 1000) % 60
  if (hours > 0) return `${hours}:${pad2(minutes)}:${pad2(seconds)}`
  const centis = Math.floor(total / 10) % 100
  return `${pad2(minutes)}:${pad2(seconds)}.${pad2(centis)}`
}

/**
 * 倒计时 / 番茄钟显示：`mm:ss`；超过 1 小时显示 `h:mm:ss`
 * @param totalSeconds 剩余秒数
 */
export function formatDuration(totalSeconds: number): string {
  const total = Number.isFinite(totalSeconds) ? Math.max(0, Math.floor(totalSeconds)) : 0
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor(total / 60) % 60
  const seconds = total % 60
  if (hours > 0) return `${hours}:${pad2(minutes)}:${pad2(seconds)}`
  return `${pad2(minutes)}:${pad2(seconds)}`
}

/**
 * 时/分/秒 → 总秒数
 * @param parts 倒计时输入
 */
export function countdownTotalSeconds(parts: CountdownParts): number {
  return parts.hours * 3600 + parts.minutes * 60 + parts.seconds
}

/**
 * 番茄钟阶段流转：专注结束后累计 +1，每满 4 个进入长休，否则短休；休息结束回到专注
 * @param state 当前状态
 */
export function nextPhase(state: PomodoroState): PomodoroState {
  if (state.phase !== 'focus') return { phase: 'focus', completedFocus: state.completedFocus }
  const completedFocus = state.completedFocus + 1
  return {
    phase: completedFocus % 4 === 0 ? 'long-break' : 'short-break',
    completedFocus
  }
}

/**
 * 计算一次计次：分段 = 当前累计 - 上次累计
 * @param totalMs 当前累计毫秒
 * @param previousTotalMs 上次累计毫秒
 */
export function splitLap(totalMs: number, previousTotalMs: number): Lap {
  const total = Number.isFinite(totalMs) ? Math.max(0, Math.floor(totalMs)) : 0
  const previous = Number.isFinite(previousTotalMs) ? Math.max(0, Math.floor(previousTotalMs)) : 0
  return { totalMs: total, segmentMs: Math.max(0, total - previous) }
}

/**
 * 追加计次：新的在上，最多保留 MAX_LAPS 条
 * @param laps 现有计次
 * @param lap 新计次
 */
export function pushLap(laps: readonly Lap[], lap: Lap): Lap[] {
  return [lap, ...laps].slice(0, MAX_LAPS)
}

/**
 * 阶段中文名
 * @param phase 番茄钟阶段
 */
export function phaseLabel(phase: PomodoroPhase): string {
  if (phase === 'focus') return '专注'
  if (phase === 'short-break') return '短休'
  return '长休'
}
