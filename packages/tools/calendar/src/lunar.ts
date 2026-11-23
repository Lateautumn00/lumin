// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- 库无内置类型：untyped 模块禁止增强，只能三斜线拉入 ambient d.ts
/// <reference path="./lunar-javascript.d.ts" />
/**
 * @file 农历/黄历纯函数封装（lunar-javascript 的类型化薄层，全部可单测）
 * @author cuilanchao
 * @date 2026-11-23
 */
import { Lunar, Solar } from 'lunar-javascript'

import { getHolidayInfo, type HolidayInfo } from './holidays'

/** 单日综合信息（月格与详情面板共用） */
export interface DayInfo {
  /** 公历日期 YYYY-MM-DD */
  solar: string
  /** 星期X */
  week: string
  /** 农历月日中文（如 十月十五） */
  lunarText: string
  /** 当日节气名，非节气日为 null */
  jieqi: string | null
  /** 公历+农历节日名（如 中秋节、除夕） */
  festivals: string[]
  /** 日干支（如 辛丑） */
  ganzhi: string
  /** 年生肖 */
  shengXiao: string
  /** 星座（如 射手座） */
  xingZuo: string
  /** 农历月（1-12，闰月取绝对值） */
  lunarMonth: number
  /** 农历日（1-30） */
  lunarDay: number
  /** 是否闰月日 */
  lunarLeap: boolean
}

/** 月历单格（恒 42 格） */
export interface MonthCell {
  date: Date
  info: DayInfo
  /** 是否属于当前显示月 */
  inMonth: boolean
  holiday: HolidayInfo | null
}

/** 黄历（宜忌/建除/值神/冲煞/吉神/凶煞） */
export interface HuangJi {
  yi: string[]
  ji: string[]
  /** 建除十二值星 */
  zhiXing: string
  /** 值神 */
  tianShen: string
  tianShenLuck: string
  /** 冲（如 (乙未)羊） */
  chong: string
  /** 煞方 */
  sha: string
  jiShen: string[]
  xiongSha: string[]
}

const CN_KEY_RE = /^[一-龥]+$/

/**
 * 节气表拼音别名键 → 中文名（跨年段节气如冬至/立春当日落在拼音键下，
 * 中文键保存的是上一农历年的同名节气）
 */
const JIEQI_ALIAS: Record<string, string> = {
  DA_XUE: '大雪',
  DONG_ZHI: '冬至',
  XIAO_HAN: '小寒',
  DA_HAN: '大寒',
  LI_CHUN: '立春',
  YU_SHUI: '雨水',
  JING_ZHE: '惊蛰'
}

const WEEK_NAMES = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']

function findJieQi(lunar: Lunar, ymd: string): string | null {
  const table = lunar.getJieQiTable()
  let aliasHit: string | null = null
  for (const [key, value] of Object.entries(table)) {
    if (value.toYmd() !== ymd) continue
    if (CN_KEY_RE.test(key)) return key
    const mapped = JIEQI_ALIAS[key]
    if (mapped && aliasHit === null) aliasHit = mapped
  }
  return aliasHit
}

function buildDayInfo(date: Date): DayInfo {
  const solar = Solar.fromDate(date)
  const lunar = solar.getLunar()

  return {
    solar: solar.toYmd(),
    week: WEEK_NAMES[solar.getWeek()] ?? '',
    lunarText: `${lunar.getMonthInChinese()}月${lunar.getDayInChinese()}`,
    jieqi: findJieQi(lunar, solar.toYmd()),
    festivals: [...solar.getFestivals(), ...lunar.getFestivals()],
    ganzhi: lunar.getDayInGanZhi(),
    shengXiao: lunar.getShengxiao(),
    xingZuo: `${solar.getXingZuo()}座`,
    lunarMonth: Math.abs(lunar.getMonth()),
    lunarDay: lunar.getDay(),
    lunarLeap: lunar.getMonth() < 0
  }
}

/** 单日综合信息 */
export function getDayInfo(date: Date): DayInfo {
  return buildDayInfo(date)
}

/** 当月月历：恒 42 格（6 行 × 7 列），周一起始（日期按本地时区构造，与 Solar.fromDate 一致） */
export function getMonthGrid(year: number, month: number): MonthCell[] {
  const first = new Date(year, month - 1, 1)
  const firstWeek = Solar.fromDate(first).getWeek()
  // Solar.getWeek()：0=周日；转为周一起始偏移
  const offset = (firstWeek + 6) % 7

  const cells: MonthCell[] = []
  for (let i = 0; i < 42; i += 1) {
    const date = new Date(year, month - 1, 1 - offset + i)
    cells.push({
      date,
      info: buildDayInfo(date),
      inMonth: date.getMonth() + 1 === month && date.getFullYear() === year,
      holiday: getHolidayInfo(date.getFullYear(), date.getMonth() + 1, date.getDate())
    })
  }
  return cells
}

/** 黄历 */
export function getHuangJi(date: Date): HuangJi {
  const lunar = Solar.fromDate(date).getLunar()
  return {
    yi: lunar.getDayYi(1),
    ji: lunar.getDayJi(1),
    zhiXing: lunar.getZhiXing(),
    tianShen: lunar.getDayTianShen(),
    tianShenLuck: lunar.getDayTianShenLuck(),
    chong: lunar.getChongDesc(),
    sha: lunar.getSha(),
    jiShen: lunar.getDayJiShen(),
    xiongSha: lunar.getDayXiongSha()
  }
}
