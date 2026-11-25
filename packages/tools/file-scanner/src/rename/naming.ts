/**
 * @file 文件名纯函数（拆分/拼接、序号补零、日期格式化、大小写、删除字符、查找替换、名称校验）
 * @author cuilanchao
 * @date 2026-11-18
 * @description file-renamer 的核心命名工具集，无副作用；node 与 renderer 共用（spec §3/§4）
 */

/** 日期格式（spec §3） */
export type DateFormat = 'YYYYMMDD' | 'YYYY-MM-DD' | 'YYMMDD-HHmmss'

/** 大小写模式 */
export type CaseMode = 'none' | 'lower' | 'upper' | 'capitalize'

/** 文件名拆分结果（ext 含前导点；无扩展名时为 ''） */
export interface SplitName {
  stem: string
  ext: string
}

/** 全名最大 UTF-8 字节数（Windows 单段名限制） */
export const MAX_NAME_BYTES = 255

/** 名称问题错误码（spec §4） */
export type NameIssueCode = 'FR_NAME_INVALID' | 'FR_NAME_RESERVED'

/** 名称校验问题 */
export interface NameIssue {
  code: NameIssueCode
  message: string
}

/** Windows 非法字符（保留字符 + ASCII 控制字符） */
const ILLEGAL_CHARS = /[\u0000-\u001f<>:"/\\|?*]/

/** Windows 保留设备名（不区分大小写） */
const RESERVED_DEVICE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

/** 文本替换需转义的正则元字符 */
const REGEX_SPECIAL = /[.*+?^${}()|[\]\\]/g

/**
 * 拆分文件名：最后一个点且不在首位 → 主名 + 扩展名（`.gitignore` 不视为扩展名）
 * @param name 文件名（不含目录）
 */
export function splitFileName(name: string): SplitName {
  const idx = name.lastIndexOf('.')
  if (idx <= 0) return { stem: name, ext: '' }
  return { stem: name.slice(0, idx), ext: name.slice(idx) }
}

/**
 * 拼接主名与扩展名
 * @param stem 主名（不含点）
 * @param ext 扩展名（含前导点，可为空串）
 */
export function joinFileName(stem: string, ext: string): string {
  return ext === '' ? stem : `${stem}${ext}`
}

/**
 * 数字补零到指定宽度（超出宽度原样返回）
 * @param value 数值（负数按 0 处理）
 * @param digits 目标宽度 1–8
 */
export function padNumber(value: number, digits: number): string {
  const text = String(Math.max(0, Math.trunc(value)))
  return text.length >= digits ? text : text.padStart(digits, '0')
}

/** 两位补零 */
function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value)
}

/**
 * 按格式输出日期（本地时区）
 * @param date 时间点
 * @param format 目标格式（spec §3）
 */
export function formatDate(date: Date, format: DateFormat): string {
  const yyyy = String(date.getFullYear())
  const yy = yyyy.slice(-2)
  const mm = pad2(date.getMonth() + 1)
  const dd = pad2(date.getDate())
  if (format === 'YYYYMMDD') return `${yyyy}${mm}${dd}`
  if (format === 'YYYY-MM-DD') return `${yyyy}-${mm}-${dd}`
  return `${yy}${mm}${dd}-${pad2(date.getHours())}${pad2(date.getMinutes())}${pad2(date.getSeconds())}`
}

/**
 * 大小写转换（capitalize = 每个词首字母大写，其余小写；词以空白/-/_ 分隔）
 * @param text 输入文本
 * @param mode 模式
 */
export function applyCase(text: string, mode: CaseMode): string {
  if (mode === 'lower') return text.toLowerCase()
  if (mode === 'upper') return text.toUpperCase()
  if (mode === 'none') return text
  return text
    .toLowerCase()
    .replace(
      /(^|[\s\-_])(\p{L})/gu,
      (_whole: string, sep: string, ch: string) => sep + ch.toUpperCase()
    )
}

/**
 * 删除字符：从第 from 个字符（1 起）起删除 count 个（按码点计；越界则删到末尾）
 * @param text 输入文本
 * @param from 起始位置（1 起）
 * @param count 删除数量
 */
export function deleteChars(text: string, from: number, count: number): string {
  if (count <= 0) return text
  const chars = Array.from(text)
  const start = Math.max(0, Math.trunc(from) - 1)
  if (start >= chars.length) return text
  return [...chars.slice(0, start), ...chars.slice(start + count)].join('')
}

/** 查找替换参数（spec §3） */
export interface FindReplaceOptions {
  find: string
  replace: string
  isRegex: boolean
  caseSensitive: boolean
}

/**
 * 查找替换：文本模式（大小写敏感 → split/join，宽容 → 转义正则）；正则模式支持 `$1`–`$9`
 * @param text 输入文本
 * @param options 替换参数
 */
export function applyFindReplace(text: string, options: FindReplaceOptions): string {
  const { find, replace, isRegex, caseSensitive } = options
  if (find === '') return text
  if (isRegex) {
    try {
      return text.replace(new RegExp(find, caseSensitive ? 'g' : 'gi'), replace)
    } catch {
      // 正则非法由 validateRules 拦截；兜底保持原文
      return text
    }
  }
  if (caseSensitive) return text.split(find).join(replace)
  const escaped = find.replace(REGEX_SPECIAL, '\\$&')
  return text.replace(new RegExp(escaped, 'gi'), () => replace)
}

/**
 * 是否为 Windows 保留设备名（含带扩展名形式，如 CON.txt）
 * @param fullName 完整文件名
 */
export function isReservedName(fullName: string): boolean {
  return RESERVED_DEVICE.test(splitFileName(fullName).stem.trim())
}

/**
 * 校验文件名（spec §4 第 1–5 条）；通过返回 null
 * @param fullName 完整文件名（主名 + 扩展名）
 */
export function validateFileName(fullName: string): NameIssue | null {
  const { stem } = splitFileName(fullName)
  if (stem.trim() === '') return { code: 'FR_NAME_INVALID', message: '文件名为空' }
  if (ILLEGAL_CHARS.test(fullName))
    return { code: 'FR_NAME_INVALID', message: '含 Windows 保留字符（< > : " / \\ | ? *）' }
  if (fullName.endsWith(' ') || fullName.endsWith('.'))
    return { code: 'FR_NAME_INVALID', message: '名称不能以空格或点结尾' }
  if (new TextEncoder().encode(fullName).length > MAX_NAME_BYTES)
    return { code: 'FR_NAME_INVALID', message: `文件名超长（>${MAX_NAME_BYTES} 字节）` }
  if (isReservedName(fullName))
    return { code: 'FR_NAME_RESERVED', message: '使用了 Windows 保留设备名' }
  return null
}
