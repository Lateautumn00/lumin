/**
 * @file Cron 表达式解析：5 字段（分 时 日 月 周）校验、中文描述、未来触发时间
 * @author cuilanchao
 * @date 2026-11-20
 * @description 只支持标准 5 字段；周字段 0 与 7 均为周日；日与周同时受限时按传统 Cron「或」语义
 */

/** 单个 Cron 字段：取值集合 + 是否为通配 */
export interface CronField {
  values: ReadonlySet<number>
  wildcard: boolean
}

/** 解析后的 5 字段 */
export interface ParsedCron {
  minutes: CronField
  hours: CronField
  daysOfMonth: CronField
  months: CronField
  daysOfWeek: CronField
}

/** 字段解析结果 */
export type CronFieldResult = { ok: true; value: CronField } | { ok: false; message: string }

/** 表达式解析结果 */
export type CronParseResult = { ok: true; value: ParsedCron } | { ok: false; message: string }

const WEEK_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const

const NUMERIC_PATTERN = /^\d+$/

const RANGE_PATTERN = /^(\d+)-(\d+)$/

function fail(message: string): CronFieldResult {
  return { ok: false, message }
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

function sortedValues(field: CronField): number[] {
  return [...field.values].sort((left, right) => left - right)
}

/**
 * 解析单个 Cron 字段
 * @param field 字段文本
 * @param min 允许最小值
 * @param max 允许最大值
 * @param normalizeDow 周字段：把 7 归一为 0
 */
export function parseCronField(
  field: string,
  min: number,
  max: number,
  normalizeDow = false
): CronFieldResult {
  const text = field.trim()
  if (text === '') return fail('字段不能为空')
  if (text === '*') {
    const values = new Set<number>()
    for (let value = min; value <= max; value += 1) values.add(value)
    return { ok: true, value: { values, wildcard: true } }
  }

  const values = new Set<number>()
  const segments = text.split(',')
  for (const segment of segments) {
    if (segment === '') return fail('存在空的列表项')

    const stepParts = segment.split('/')
    if (stepParts.length > 2) return fail('步长语法只能出现一个 “/”')
    const base = stepParts[0] ?? ''
    const stepText = stepParts[1]

    let step = 1
    if (stepText !== undefined) {
      if (!NUMERIC_PATTERN.test(stepText)) return fail('步长必须是正整数')
      step = Number(stepText)
      if (step <= 0) return fail('步长必须大于 0')
    }

    let start: number
    let end: number
    if (base === '*') {
      start = min
      end = max
    } else if (NUMERIC_PATTERN.test(base)) {
      start = Number(base)
      // `5/n` 视为从 5 到最大值按步长取值
      end = stepText === undefined ? start : max
    } else {
      const rangeMatch = RANGE_PATTERN.exec(base)
      if (rangeMatch === null) return fail(`无法解析 “${segment}”`)
      start = Number(rangeMatch[1])
      end = Number(rangeMatch[2])
    }

    if (start < min || start > max || end < min || end > max) {
      return fail(`取值超出范围 ${min}-${max}`)
    }
    if (start > end) return fail('区间起点不能大于终点')

    for (let value = start; value <= end; value += step) {
      values.add(normalizeDow && value === 7 ? 0 : value)
    }
  }

  if (values.size === 0) return fail('字段没有可用取值')
  return { ok: true, value: { values, wildcard: false } }
}

/**
 * 解析 5 字段 Cron 表达式
 * @param expr 表达式文本，如 `0/5 * * * *`
 */
export function parseCron(expr: string): CronParseResult {
  const fields = expr.trim().split(/\s+/)
  if (fields.length !== 5) {
    return {
      ok: false,
      message: `需要 5 个字段（分 时 日 月 周），当前 ${fields.length} 个`
    }
  }

  const minutes = parseCronField(fields[0] ?? '', 0, 59)
  if (!minutes.ok) return { ok: false, message: `分字段：${minutes.message}` }

  const hours = parseCronField(fields[1] ?? '', 0, 23)
  if (!hours.ok) return { ok: false, message: `时字段：${hours.message}` }

  const daysOfMonth = parseCronField(fields[2] ?? '', 1, 31)
  if (!daysOfMonth.ok) return { ok: false, message: `日字段：${daysOfMonth.message}` }

  const months = parseCronField(fields[3] ?? '', 1, 12)
  if (!months.ok) return { ok: false, message: `月字段：${months.message}` }

  const daysOfWeek = parseCronField(fields[4] ?? '', 0, 7, true)
  if (!daysOfWeek.ok) return { ok: false, message: `周字段：${daysOfWeek.message}` }

  return {
    ok: true,
    value: {
      minutes: minutes.value,
      hours: hours.value,
      daysOfMonth: daysOfMonth.value,
      months: months.value,
      daysOfWeek: daysOfWeek.value
    }
  }
}

/**
 * 识别等差序列的步长（如 0,5,10… → 5）
 * @param values 升序数组
 */
function detectStep(values: readonly number[]): number | null {
  const first = values[0]
  const second = values[1]
  if (first === undefined || second === undefined) return null
  const step = second - first
  if (step <= 0) return null
  for (let index = 2; index < values.length; index += 1) {
    const current = values[index]
    const previous = values[index - 1]
    if (current === undefined || previous === undefined) return null
    if (current - previous !== step) return null
  }
  return step
}

/** 周几中文描述（连续区间合并为「周一至周五」） */
function describeWeekdays(values: readonly number[]): string {
  if (values.length === 0) return '每周'
  const names = values.map((value) => WEEK_NAMES[value] ?? '周日')
  const first = values[0]
  const last = values[values.length - 1]
  if (
    values.length > 1 &&
    first !== undefined &&
    last !== undefined &&
    last - first === values.length - 1
  ) {
    const startName = names[0] ?? '周日'
    const endName = names[names.length - 1] ?? '周日'
    return `每${startName}至${endName}`
  }
  if (values.length === 1) return `每${names[0] ?? '周日'}`
  return `每${names.join('、')}`
}

/** 「分 / 时」频率描述 */
function describeTime(parsed: ParsedCron): string {
  const minutes = sortedValues(parsed.minutes)
  const hours = sortedValues(parsed.hours)

  if (parsed.hours.wildcard) {
    if (parsed.minutes.wildcard) return '每分钟'
    const step = detectStep(minutes)
    if (step !== null && minutes[0] === 0) return `每 ${step} 分钟`
    if (minutes.length === 1) return `每小时第 ${minutes[0]} 分`
    return `每小时第 ${minutes.join('、')} 分`
  }

  const times = hours.flatMap((hour) => minutes.map((minute) => `${pad2(hour)}:${pad2(minute)}`))
  if (times.length === 0) return '无触发时刻'
  if (times.length <= 6) return times.join('、')
  return `${times.slice(0, 6).join('、')} 等 ${times.length} 个时刻`
}

/**
 * 「日 / 月 / 周」约束描述；全部通配时返回空串（由调用方按时间粒度决定是否加「每天」）
 */
function describeDays(parsed: ParsedCron): string {
  const domWildcard = parsed.daysOfMonth.wildcard
  const dowWildcard = parsed.daysOfWeek.wildcard
  const monthWildcard = parsed.months.wildcard
  const domValues = sortedValues(parsed.daysOfMonth)
  const dowValues = sortedValues(parsed.daysOfWeek)
  const monthValues = sortedValues(parsed.months)

  let dayText: string
  if (domWildcard && dowWildcard) {
    dayText = '每天'
  } else if (domWildcard) {
    dayText = describeWeekdays(dowValues)
  } else if (dowWildcard) {
    dayText = `每月 ${domValues.join('、')} 日`
  } else {
    dayText = `每月 ${domValues.join('、')} 日或${describeWeekdays(dowValues)}`
  }

  if (monthWildcard) return dayText === '每天' ? '' : dayText

  const monthText = `每年 ${monthValues.join('、')} 月`
  if (dayText === '每天') return `${monthText}每天`
  return `${monthText}${dayText.replace(/^每月/, '')}`
}

/**
 * 生成中文描述（示例：「每 5 分钟」「每天 09:00」「每周一 09:00」「每年 1 月 1 日 00:00」）
 * @param parsed 解析结果
 */
export function describeCron(parsed: ParsedCron): string {
  const timeText = describeTime(parsed)
  const dayText = describeDays(parsed)
  if (dayText === '') {
    return timeText.startsWith('每') ? timeText : `每天 ${timeText}`
  }
  return `${dayText} ${timeText}`
}

// —— 反向生成（M55 §4.55，spec time-toolbox M55 追加节） ——

/** 反向生成输入：五组勾选值（空数组 = 未选 → 该字段通配 `*`） */
export interface CronSelection {
  minutes: readonly number[]
  hours: readonly number[]
  daysOfMonth: readonly number[]
  months: readonly number[]
  daysOfWeek: readonly number[]
}

/**
 * 单字段勾选值 → cron 字段文本（纯函数，M55 §4.55）
 * - 空 / 全量 → 通配
 * - 首值 = min 的完整等差循环（末值 + 步长 > max）→ 步长形式（如 `0/5` 语义的通配步长）
 * - 连续段 ≥3 → `起-止`；其余逐值逗号列表；去重、升序归一
 * @param values 勾选值
 * @param min 字段最小值
 * @param max 字段最大值
 */
function renderField(values: readonly number[], min: number, max: number): string {
  const sorted = [
    ...new Set(values.filter((value) => Number.isInteger(value) && value >= min && value <= max))
  ].sort((left, right) => left - right)
  if (sorted.length === 0) return '*'
  if (sorted.length === max - min + 1) return '*'

  const first = sorted[0]
  const second = sorted[1]
  if (first !== undefined && second !== undefined && first === min) {
    const step = second - first
    const last = sorted[sorted.length - 1]
    // 步长 ≤ 半程才用 */step（避免周「六、日」这种被渲染成费解的 */6）
    if (
      step > 1 &&
      step <= (max - min + 1) / 2 &&
      last !== undefined &&
      last + step > max &&
      sorted.every((value, index) => value === min + index * step)
    ) {
      return `*/${step}`
    }
  }

  const parts: string[] = []
  let runStart: number | null = null
  let runEnd: number | null = null
  const flush = (): void => {
    if (runStart === null || runEnd === null) return
    if (runEnd - runStart >= 2) parts.push(`${runStart}-${runEnd}`)
    else {
      parts.push(String(runStart))
      if (runEnd !== runStart) parts.push(String(runEnd))
    }
  }
  for (const value of sorted) {
    if (runStart !== null && runEnd !== null && value === runEnd + 1) {
      runEnd = value
      continue
    }
    flush()
    runStart = value
    runEnd = value
  }
  flush()
  return parts.join(',')
}

/**
 * 勾选矩阵 → 5 字段 Cron 表达式（M55 §4.55，纯函数）
 * 永远产出可被 `parseCron` 接受的表达式；周字段仅 0–6（周日 = 0）
 * @param selection 五组勾选值
 */
export function buildCron(selection: CronSelection): string {
  return [
    renderField(selection.minutes, 0, 59),
    renderField(selection.hours, 0, 23),
    renderField(selection.daysOfMonth, 1, 31),
    renderField(selection.months, 1, 12),
    renderField(selection.daysOfWeek, 0, 6)
  ].join(' ')
}

/** 判断某个时刻是否命中表达式 */
function matchesCron(parsed: ParsedCron, date: Date): boolean {
  if (!parsed.minutes.values.has(date.getMinutes())) return false
  if (!parsed.hours.values.has(date.getHours())) return false
  if (!parsed.months.values.has(date.getMonth() + 1)) return false

  const domMatches = parsed.daysOfMonth.values.has(date.getDate())
  const dowMatches = parsed.daysOfWeek.values.has(date.getDay())
  if (parsed.daysOfMonth.wildcard && parsed.daysOfWeek.wildcard) return true
  if (parsed.daysOfMonth.wildcard) return dowMatches
  if (parsed.daysOfWeek.wildcard) return domMatches
  return domMatches || dowMatches
}

/**
 * 计算未来触发时间（本地时区，逐分钟匹配）
 * @param parsed 解析结果
 * @param fromMs 起点毫秒（从下一整分钟开始搜索）
 * @param count 需要的结果数量
 * @param maxDays 最大向后搜索天数
 * @returns 命中的毫秒时间戳数组；搜索范围内无解为空数组
 */
export function nextCronRuns(
  parsed: ParsedCron,
  fromMs: number,
  count = 5,
  maxDays = 60
): number[] {
  const results: number[] = []
  if (count <= 0 || maxDays <= 0) return results

  const cursor = new Date(fromMs)
  cursor.setSeconds(0, 0)
  cursor.setMinutes(cursor.getMinutes() + 1)

  const limit = maxDays * 1440
  for (let step = 0; step < limit && results.length < count; step += 1) {
    if (matchesCron(parsed, cursor)) results.push(cursor.getTime())
    cursor.setMinutes(cursor.getMinutes() + 1)
  }
  return results
}
