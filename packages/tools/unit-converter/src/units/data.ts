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

export type CategoryId =
  | 'length'
  | 'weight'
  | 'temperature'
  | 'area'
  | 'volume'
  | 'speed'
  | 'time'
  | 'data'
  | 'pressure'
  | 'power'

/** 至少两个单位（spec §2：units[0] 基准默认源单位，units[1] 默认目标单位） */
type UnitPair<U> = readonly [U, U, ...U[]]

export interface LinearCategory {
  readonly id: Exclude<CategoryId, 'temperature'>
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

export type Category = LinearCategory | TempCategory

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
  }
]

export function findCategory(id: string): Category | undefined {
  return CATEGORIES.find((category) => category.id === id)
}

export function isCategoryId(value: string): value is CategoryId {
  return CATEGORIES.some((category) => category.id === value)
}
