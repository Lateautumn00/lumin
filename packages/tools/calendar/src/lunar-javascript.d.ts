/**
 * @file lunar-javascript 模块类型声明（该库无内置类型，手写所用子集）
 * @author cuilanchao
 * @date 2026-11-23
 * @description 签名对照官方 lunar-typescript d.ts；仅声明本工具实际调用的 API。
 * 本文件是无 import/export 的全局脚本（ambient declare module），
 * 消费方（lunar.ts / holidays.ts / anniversaries.ts）以三斜线引用拉入各自程序
 */

declare module 'lunar-javascript' {
  /** 公历日期 */
  export class Solar {
    static fromDate(date: Date): Solar
    static fromYmd(year: number, month: number, day: number): Solar
    getYear(): number
    getMonth(): number
    getDay(): number
    /** 0=周日，1=周一 … 6=周六 */
    getWeek(): number
    getWeekInChinese(): string
    getLunar(): Lunar
    getFestivals(): string[]
    getXingZuo(): string
    toYmd(): string
  }

  /** 农历日期 */
  export class Lunar {
    static fromDate(date: Date): Lunar
    static fromYmd(lunarYear: number, lunarMonth: number, lunarDay: number): Lunar
    getSolar(): Solar
    getYear(): number
    /** 负数表示闰月（如 -6 = 闰六月） */
    getMonth(): number
    getDay(): number
    isLeap(): boolean
    getMonthInChinese(): string
    getDayInChinese(): string
    getDayInGanZhi(): string
    /** 年生肖 */
    getShengxiao(): string
    getFestivals(): string[]
    /** 节气表：中文名键与拼音别名键并存，值为对应公历日 */
    getJieQiTable(): Record<string, Solar>
    getChongDesc(): string
    getSha(): string
    /** 建除十二值星 */
    getZhiXing(): string
    getDayTianShen(): string
    getDayTianShenLuck(): string
    getDayYi(sect?: number): string[]
    getDayJi(sect?: number): string[]
    getDayJiShen(): string[]
    getDayXiongSha(): string[]
  }

  /** 法定节假日条目（HolidayUtil 内置数据） */
  export interface Holiday {
    getDay(): string
    getName(): string
    /** true = 调休上班日 */
    isWork(): boolean
    getTarget(): string
  }

  export const HolidayUtil: {
    getHoliday(year: number, month: number, day: number): Holiday | null
  }
}
