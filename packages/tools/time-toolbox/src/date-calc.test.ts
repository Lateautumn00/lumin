/**
 * @file date-calc.ts 单测：跨年总天数、含头含尾、周末计数、月末钳制、负数与周单位、时区无关
 * @author cuilanchao
 * @date 2026-11-23
 */
import { describe, expect, it } from 'vitest'
import {
  addDays,
  calcInterval,
  formatUtcDate,
  MAX_DATE_STEP,
  parseUtcNoon,
  weekdayLabel,
  weekdayOf
} from './date-calc'

describe('parseUtcNoon / formatUtcDate（UTC 正午构造，时区无关）', () => {
  it('解析为 UTC 正午 12:00', () => {
    const ms = parseUtcNoon('2026-11-23')
    expect(ms).not.toBeNull()
    const date = new Date(ms ?? 0)
    expect(date.getUTCHours()).toBe(12)
    expect(date.getUTCMinutes()).toBe(0)
    expect(formatUtcDate(ms ?? 0)).toBe('2026-11-23')
  })

  it('非法格式与不存在的日期返回 null', () => {
    expect(parseUtcNoon('2023-02-29')).toBeNull()
    expect(parseUtcNoon('2023-13-01')).toBeNull()
    expect(parseUtcNoon('2023/01/01')).toBeNull()
    expect(parseUtcNoon('abc')).toBeNull()
    expect(parseUtcNoon('')).toBeNull()
  })

  it('跨夏令时边界按日历日推进（美东 DST 切换周不影响天数）', () => {
    // 2024-03-10 为美东夏令时切换日：本地零点构造会多出/少掉数小时
    const result = calcInterval('2024-03-09', '2024-03-11', false)
    expect(result?.totalDays).toBe(2)
    expect(addDays('2024-03-09', 2, 'day')).toBe('2024-03-11')
  })
})

describe('calcInterval（spec M60 验收锚点）', () => {
  it('跨年总天数：2024-12-31 → 2025-01-01 = 1 天', () => {
    const result = calcInterval('2024-12-31', '2025-01-01', false)
    expect(result).not.toBeNull()
    expect(result?.totalDays).toBe(1)
    expect(result?.negative).toBe(false)
    expect(result?.startWeekday).toBe(2) // 2024-12-31 周二
    expect(result?.endWeekday).toBe(3) // 2025-01-01 周三
  })

  it('含头含尾：同日 0 天 → 1 天，跨年 +1', () => {
    expect(calcInterval('2024-12-31', '2024-12-31', false)?.totalDays).toBe(0)
    expect(calcInterval('2024-12-31', '2024-12-31', true)?.totalDays).toBe(1)
    expect(calcInterval('2024-12-31', '2025-01-01', true)?.totalDays).toBe(2)
    expect(calcInterval('2024-12-31', '2025-01-01', true)?.weekdays).toBe(2)
  })

  it('跨年周末计数（仅跳过周六日）：2024-12-28 周六 → 2025-01-03 周五', () => {
    const exclusive = calcInterval('2024-12-28', '2025-01-03', false)
    expect(exclusive?.totalDays).toBe(6) // 12-29 ~ 01-03
    expect(exclusive?.weekdays).toBe(5) // 周日 12-29 被跳过
    expect(exclusive?.weeks).toBe(0.9)

    const inclusive = calcInterval('2024-12-28', '2025-01-03', true)
    expect(inclusive?.totalDays).toBe(7) // 12-28 周六 ~ 01-03 周五
    expect(inclusive?.weekdays).toBe(5) // 周六、周日均跳过
    expect(inclusive?.weeks).toBe(1)
  })

  it('止早于起取绝对值并标注 negative', () => {
    const result = calcInterval('2025-01-03', '2024-12-28', false)
    expect(result?.negative).toBe(true)
    expect(result?.totalDays).toBe(6)
    expect(result?.weekdays).toBe(5)
    // 起止星期按原始输入（不因绝对值交换）
    expect(result?.startWeekday).toBe(5) // 2025-01-03 周五
    expect(result?.endWeekday).toBe(6) // 2024-12-28 周六
  })

  it('自然周 = 天数 ÷7 保留 1 位', () => {
    expect(calcInterval('2026-01-01', '2026-01-08', false)?.weeks).toBe(1)
    expect(calcInterval('2026-01-01', '2026-01-09', false)?.weeks).toBe(1.1)
    expect(calcInterval('2026-01-01', '2026-01-02', false)?.weeks).toBe(0.1)
  })

  it('任一侧非法返回 null', () => {
    expect(calcInterval('2023-02-29', '2024-01-01', false)).toBeNull()
    expect(calcInterval('2024-01-01', 'bad', false)).toBeNull()
  })
})

describe('addDays（spec M60 验收锚点）', () => {
  it('日溢出钳制月末：2024-01-31 + 1 月 → 2024-02-29（闰年）', () => {
    expect(addDays('2024-01-31', 1, 'month')).toBe('2024-02-29')
  })

  it('日溢出钳制月末：2023-01-31 + 1 月 → 2023-02-28（平年）', () => {
    expect(addDays('2023-01-31', 1, 'month')).toBe('2023-02-28')
  })

  it('负数：日、周、月均可回退', () => {
    expect(addDays('2023-03-01', -1, 'day')).toBe('2023-02-28')
    expect(addDays('2024-03-01', -1, 'day')).toBe('2024-02-29')
    expect(addDays('2024-01-15', -2, 'week')).toBe('2024-01-01')
    expect(addDays('2023-03-31', -1, 'month')).toBe('2023-02-28')
  })

  it('周单位：2 周 = 14 天', () => {
    expect(addDays('2024-01-01', 2, 'week')).toBe('2024-01-15')
    expect(addDays('2024-01-15', -1, 'week')).toBe('2024-01-08')
  })

  it('年单位按日历进位并钳制闰日', () => {
    expect(addDays('2024-02-29', 1, 'year')).toBe('2025-02-28')
    expect(addDays('2024-01-31', 1, 'year')).toBe('2025-01-31')
    expect(addDays('2023-12-31', 1, 'month')).toBe('2024-01-31')
  })

  it('N = 0 返回原日期', () => {
    expect(addDays('2026-11-23', 0, 'day')).toBe('2026-11-23')
    expect(addDays('2026-11-23', 0, 'month')).toBe('2026-11-23')
  })

  it('越界与非整数返回 null（|N| ≤ 36500）', () => {
    expect(addDays('2026-01-01', MAX_DATE_STEP + 1, 'day')).toBeNull()
    expect(addDays('2026-01-01', -(MAX_DATE_STEP + 1), 'day')).toBeNull()
    expect(addDays('2026-01-01', 1.5, 'day')).toBeNull()
    expect(addDays('2026-01-01', Number.NaN, 'day')).toBeNull()
    expect(addDays('bad', 1, 'day')).toBeNull()
    expect(addDays('2026-01-01', MAX_DATE_STEP, 'day')).toBe('2125-12-08')
  })
})

describe('星期标签', () => {
  it('序号映射中文星期', () => {
    expect(weekdayLabel(0)).toBe('星期日')
    expect(weekdayLabel(6)).toBe('星期六')
    expect(weekdayLabel(-1)).toBe('星期六')
    expect(weekdayLabel(7)).toBe('星期日')
  })

  it('weekdayOf 解析日期文本（非法返回空串）', () => {
    expect(weekdayOf('2024-12-31')).toBe('星期二')
    expect(weekdayOf('2025-01-01')).toBe('星期三')
    expect(weekdayOf('bad')).toBe('')
  })
})
