/** 线性单位：换算基准为 `value × factor`（factor = 相对基准单位的倍数） */
export interface LinearUnit {
  readonly id: string
  readonly name: string
  readonly factor: number
}

/** 温度单位：换算基准为开尔文 `K = value × scale + offset` */
export interface TempUnit {
  readonly id: string
  readonly name: string
  readonly scale: number
  readonly offset: number
}

/** 像素/分辨率单位：factor 为相对英寸的倍数；px 的实际换算由 DPI 决定 */
export interface ResolutionUnit {
  readonly id: 'px' | 'in' | 'cm' | 'mm'
  readonly name: string
  readonly factor: number
}

/** 油耗单位：`dpm` 距离/容积（km/L、mpg），`vpd` 容积/距离（L/100km）；换算是倒数关系 */
export interface ConsumptionUnit {
  readonly id: string
  readonly name: string
  readonly kind: 'dpm' | 'vpd'
  readonly factor: number
}

export type CategoryId =
  | 'length'
  | 'weight'
  | 'temperature'
  | 'area'
  | 'volume'
  | 'speed'
  | 'time'
  | 'data'
  | 'data-rate'
  | 'pressure'
  | 'power'
  | 'energy'
  | 'flow'
  | 'fuel'
  | 'angle'
  | 'frequency'
  | 'resolution'

/** 至少两个单位（spec §2：units[0] 基准默认源单位，units[1] 默认目标单位） */
type UnitPair<U> = readonly [U, U, ...U[]]

export interface LinearCategory {
  readonly id: Exclude<CategoryId, 'temperature' | 'resolution' | 'fuel'>
  readonly name: string
  readonly base: string
  readonly units: UnitPair<LinearUnit>
}

export interface TempCategory {
  readonly id: 'temperature'
  readonly name: string
  readonly base: string
  readonly units: UnitPair<TempUnit>
}

/** 像素 ↔ 物理尺寸：px 与物理单位互转需要 DPI，不能套用线性 factor */
export interface ResolutionCategory {
  readonly id: 'resolution'
  readonly name: string
  readonly base: 'px'
  readonly units: UnitPair<ResolutionUnit>
  readonly dpiDefault: number
}

/** 油耗：`kmPerLiter` 为统一中间量；`dpm` 取 `value × factor`，`vpd` 取 `factor / value` */
export interface ConsumptionCategory {
  readonly id: 'fuel'
  readonly name: string
  readonly base: 'L/100km'
  readonly units: UnitPair<ConsumptionUnit>
}

export type Category = LinearCategory | TempCategory | ResolutionCategory | ConsumptionCategory

export const CATEGORIES: readonly [Category, ...Category[]] = [
  {
    id: 'length',
    name: '长度',
    base: 'm',
    units: [
      { id: 'm', name: '米 (m)', factor: 1 },
      { id: 'km', name: '千米 (km)', factor: 1000 },
      { id: 'cm', name: '厘米 (cm)', factor: 0.01 },
      { id: 'mm', name: '毫米 (mm)', factor: 0.001 },
      { id: 'in', name: '英寸 (in)', factor: 0.0254 },
      { id: 'ft', name: '英尺 (ft)', factor: 0.3048 },
      { id: 'yd', name: '码 (yd)', factor: 0.9144 },
      { id: 'mi', name: '英里 (mi)', factor: 1609.344 }
    ]
  },
  {
    id: 'weight',
    name: '重量',
    base: 'kg',
    units: [
      { id: 'kg', name: '千克 (kg)', factor: 1 },
      { id: 'g', name: '克 (g)', factor: 0.001 },
      { id: 'mg', name: '毫克 (mg)', factor: 1e-6 },
      { id: 't', name: '吨 (t)', factor: 1000 },
      { id: 'lb', name: '磅 (lb)', factor: 0.45359237 },
      { id: 'oz', name: '盎司 (oz)', factor: 0.028349523125 }
    ]
  },
  {
    id: 'temperature',
    name: '温度',
    base: 'K',
    units: [
      { id: 'K', name: '开尔文 (K)', scale: 1, offset: 0 },
      { id: 'C', name: '摄氏度 (°C)', scale: 1, offset: 273.15 },
      { id: 'F', name: '华氏度 (°F)', scale: 5 / 9, offset: 255.37222222222223 }
    ]
  },
  {
    id: 'area',
    name: '面积',
    base: 'm²',
    units: [
      { id: 'm2', name: '平方米 (m²)', factor: 1 },
      { id: 'km2', name: '平方千米 (km²)', factor: 1e6 },
      { id: 'cm2', name: '平方厘米 (cm²)', factor: 1e-4 },
      { id: 'mm2', name: '平方毫米 (mm²)', factor: 1e-6 },
      { id: 'ha', name: '公顷 (ha)', factor: 10000 },
      { id: 'acre', name: '英亩 (acre)', factor: 4046.8564224 },
      { id: 'ft2', name: '平方英尺 (ft²)', factor: 0.09290304 }
    ]
  },
  {
    id: 'volume',
    name: '体积',
    base: 'L',
    units: [
      { id: 'L', name: '升 (L)', factor: 1 },
      { id: 'ml', name: '毫升 (mL)', factor: 0.001 },
      { id: 'm3', name: '立方米 (m³)', factor: 1000 },
      { id: 'floz', name: '美制液体盎司 (fl oz)', factor: 0.0295735295625 },
      { id: 'pt', name: '美制品脱 (pt)', factor: 0.473176473 },
      { id: 'qt', name: '美制夸脱 (qt)', factor: 0.946352946 },
      { id: 'gal', name: '美制加仑 (gal)', factor: 3.785411784 }
    ]
  },
  {
    id: 'speed',
    name: '速度',
    base: 'm/s',
    units: [
      { id: 'mps', name: '米/秒 (m/s)', factor: 1 },
      { id: 'kmh', name: '千米/时 (km/h)', factor: 1 / 3.6 },
      { id: 'mph', name: '英里/时 (mph)', factor: 0.44704 },
      { id: 'kn', name: '节 (kn)', factor: 1852 / 3600 },
      { id: 'fps', name: '英尺/秒 (ft/s)', factor: 0.3048 }
    ]
  },
  {
    id: 'time',
    name: '时间',
    base: 's',
    units: [
      { id: 's', name: '秒 (s)', factor: 1 },
      { id: 'ms', name: '毫秒 (ms)', factor: 0.001 },
      { id: 'min', name: '分钟 (min)', factor: 60 },
      { id: 'h', name: '小时 (h)', factor: 3600 },
      { id: 'd', name: '天 (d)', factor: 86400 },
      { id: 'wk', name: '周 (week)', factor: 604800 }
    ]
  },
  {
    id: 'data',
    name: '数据量',
    base: 'B',
    units: [
      { id: 'B', name: '字节 (B)', factor: 1 },
      { id: 'bit', name: '比特 (bit)', factor: 0.125 },
      { id: 'KB', name: '千字节 (KB)', factor: 1024 },
      { id: 'MB', name: '兆字节 (MB)', factor: 1048576 },
      { id: 'GB', name: '吉字节 (GB)', factor: 1073741824 },
      { id: 'TB', name: '太字节 (TB)', factor: 1099511627776 }
    ]
  },
  {
    id: 'data-rate',
    name: '数据速率',
    base: 'bps',
    units: [
      { id: 'bps', name: '比特/秒 (bps)', factor: 1 },
      { id: 'Kbps', name: '千比特/秒 (Kbps)', factor: 1e3 },
      { id: 'Mbps', name: '兆比特/秒 (Mbps)', factor: 1e6 },
      { id: 'Gbps', name: '吉比特/秒 (Gbps)', factor: 1e9 },
      { id: 'KBps', name: '千字节/秒 (KB/s)', factor: 8e3 },
      { id: 'MBps', name: '兆字节/秒 (MB/s)', factor: 8e6 },
      { id: 'GBps', name: '吉字节/秒 (GB/s)', factor: 8e9 }
    ]
  },
  {
    id: 'pressure',
    name: '压强',
    base: 'Pa',
    units: [
      { id: 'Pa', name: '帕 (Pa)', factor: 1 },
      { id: 'kPa', name: '千帕 (kPa)', factor: 1000 },
      { id: 'bar', name: '巴 (bar)', factor: 100000 },
      { id: 'MPa', name: '兆帕 (MPa)', factor: 1e6 },
      { id: 'atm', name: '标准大气压 (atm)', factor: 101325 },
      { id: 'psi', name: '磅力/平方英寸 (psi)', factor: 6894.757293168361 }
    ]
  },
  {
    id: 'power',
    name: '功率',
    base: 'W',
    units: [
      { id: 'W', name: '瓦 (W)', factor: 1 },
      { id: 'kW', name: '千瓦 (kW)', factor: 1000 },
      { id: 'MW', name: '兆瓦 (MW)', factor: 1e6 },
      { id: 'mW', name: '毫瓦 (mW)', factor: 0.001 },
      { id: 'hp', name: '英制马力 (hp)', factor: 745.6998715822702 },
      { id: 'PS', name: '公制马力 (PS)', factor: 735.49875 }
    ]
  },
  {
    id: 'energy',
    name: '能量',
    base: 'J',
    units: [
      { id: 'J', name: '焦耳 (J)', factor: 1 },
      { id: 'kJ', name: '千焦 (kJ)', factor: 1000 },
      { id: 'cal', name: '卡 (cal)', factor: 4.184 },
      { id: 'kcal', name: '千卡 (kcal)', factor: 4184 },
      { id: 'Wh', name: '瓦时 (Wh)', factor: 3600 },
      { id: 'kWh', name: '千瓦时 (kWh)', factor: 3.6e6 },
      { id: 'BTU', name: '英热单位 (BTU)', factor: 1055.05585262 }
    ]
  },
  {
    id: 'flow',
    name: '流量',
    base: 'L/min',
    units: [
      { id: 'lpm', name: '升/分钟 (L/min)', factor: 1 },
      { id: 'lps', name: '升/秒 (L/s)', factor: 60 },
      { id: 'm3h', name: '立方米/时 (m³/h)', factor: 1000 / 60 },
      { id: 'm3s', name: '立方米/秒 (m³/s)', factor: 60000 },
      { id: 'gpm', name: '美制加仑/分钟 (GPM)', factor: 3.785411784 },
      { id: 'cfm', name: '立方英尺/分钟 (CFM)', factor: 28.316846592 }
    ]
  },
  {
    id: 'fuel',
    name: '油耗',
    base: 'L/100km',
    units: [
      { id: 'l100km', name: '升/百公里 (L/100km)', kind: 'vpd', factor: 100 },
      { id: 'kmpl', name: '公里/升 (km/L)', kind: 'dpm', factor: 1 },
      { id: 'mpgus', name: '英里/加仑 美制 (mpg)', kind: 'dpm', factor: 1.609344 / 3.785411784 },
      { id: 'mpguk', name: '英里/加仑 英制 (mpg)', kind: 'dpm', factor: 1.609344 / 4.54609 }
    ]
  },
  {
    id: 'angle',
    name: '角度',
    base: 'deg',
    units: [
      { id: 'deg', name: '度 (°)', factor: 1 },
      { id: 'rad', name: '弧度 (rad)', factor: 180 / Math.PI },
      { id: 'grad', name: '百分度 (grad)', factor: 0.9 },
      { id: 'turn', name: '转 (turn)', factor: 360 },
      { id: 'arcmin', name: '角分 (′)', factor: 1 / 60 },
      { id: 'arcsec', name: '角秒 (″)', factor: 1 / 3600 }
    ]
  },
  {
    id: 'frequency',
    name: '频率',
    base: 'Hz',
    units: [
      { id: 'Hz', name: '赫兹 (Hz)', factor: 1 },
      { id: 'kHz', name: '千赫兹 (kHz)', factor: 1e3 },
      { id: 'MHz', name: '兆赫兹 (MHz)', factor: 1e6 },
      { id: 'GHz', name: '吉赫兹 (GHz)', factor: 1e9 }
    ]
  },
  {
    id: 'resolution',
    name: '像素/分辨率',
    base: 'px',
    dpiDefault: 96,
    units: [
      { id: 'px', name: '像素 (px)', factor: 1 },
      { id: 'in', name: '英寸 (in)', factor: 1 },
      { id: 'cm', name: '厘米 (cm)', factor: 1 / 2.54 },
      { id: 'mm', name: '毫米 (mm)', factor: 1 / 25.4 }
    ]
  }
]

export function findCategory(id: string): Category | undefined {
  return CATEGORIES.find((category) => category.id === id)
}

export function isCategoryId(value: string): value is CategoryId {
  return CATEGORIES.some((category) => category.id === value)
}
