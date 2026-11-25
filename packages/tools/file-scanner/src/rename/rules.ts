/**
 * @file 规则模型与重命名计划生成（纯函数，renderer 预览与 node 复核共用）
 * @author cuilanchao
 * @date 2026-11-18
 * @description 作用顺序：删除字符 → 查找替换 → 大小写 → 序号/日期 → 扩展名（spec §3）；
 *              buildRenamePlan 输出逐行 ok/skip/conflict 与冲突原因，供 UI 与执行前复核
 */
import {
  applyCase,
  applyFindReplace,
  deleteChars,
  formatDate,
  joinFileName,
  padNumber,
  splitFileName,
  validateFileName,
  type CaseMode,
  type DateFormat
} from './naming'

/** 查找替换规则 */
export interface FindReplaceRule {
  enabled: boolean
  find: string
  replace: string
  isRegex: boolean
  caseSensitive: boolean
}

/** 序号规则 */
export interface IndexRule {
  enabled: boolean
  position: 'prefix' | 'suffix'
  start: number
  digits: number
  separator: '' | '-' | '_' | '.'
}

/** 日期规则 */
export interface DateRule {
  enabled: boolean
  position: 'prefix' | 'suffix'
  format: DateFormat
  source: 'mtime' | 'now'
}

/** 扩展名规则 */
export interface ExtensionRule {
  mode: 'keep' | 'lower' | 'custom'
  custom: string
}

/** 删除字符规则 */
export interface DeleteRule {
  enabled: boolean
  from: number
  count: number
}

/** 全部规则（spec §3） */
export interface RenameRules {
  findReplace: FindReplaceRule
  index: IndexRule
  date: DateRule
  caseMode: CaseMode
  extension: ExtensionRule
  delete: DeleteRule
}

/** 参与计划计算的目录文件（scan 结果） */
export interface PlanFile {
  name: string
  mtimeMs: number
}

/** 单行状态：ok 可执行 / skip 不执行 / conflict 冲突 */
export type PlanStatus = 'ok' | 'skip' | 'conflict'

/** 单行计划 */
export interface PlanEntry {
  from: string
  to: string
  status: PlanStatus
  /** 冲突/跳过原因（UI 展示） */
  reason?: string
  /** 冲突错误码（FR_NAME_INVALID / FR_NAME_RESERVED / FR_CONFLICT） */
  code?: string
}

/** 整份计划 */
export interface RenamePlan {
  entries: PlanEntry[]
  renameCount: number
  conflictCount: number
  /** 规则输入非法时的提示（非空则不生成 entries） */
  ruleError: string | null
}

/** 计划构建选项 */
export interface PlanOptions {
  /** 勾选参与本次的文件名集合 */
  selected: ReadonlySet<string>
  /** 统一时间点（日期规则 source=now 时使用） */
  now: Date
}

/** 默认规则（spec §3 默认列） */
export function createDefaultRules(): RenameRules {
  return {
    findReplace: { enabled: false, find: '', replace: '', isRegex: false, caseSensitive: true },
    index: { enabled: false, position: 'prefix', start: 1, digits: 3, separator: '-' },
    date: { enabled: false, position: 'prefix', format: 'YYYYMMDD', source: 'mtime' },
    caseMode: 'none',
    extension: { mode: 'keep', custom: 'jpg' },
    delete: { enabled: false, from: 1, count: 0 }
  }
}

/**
 * 校验规则输入（正则合法性、自定义扩展名格式）；通过返回 null
 * @param rules 规则集
 */
export function validateRules(rules: RenameRules): string | null {
  const { findReplace, extension } = rules
  if (findReplace.enabled && findReplace.isRegex && findReplace.find !== '') {
    try {
      new RegExp(findReplace.find)
    } catch {
      return '查找内容不是合法正则表达式'
    }
  }
  if (extension.mode === 'custom' && !/^[A-Za-z0-9]{1,10}$/.test(extension.custom)) {
    return '扩展名只能为 1–10 位字母或数字（不含点）'
  }
  return null
}

/**
 * 计算单个文件的新名（作用顺序见文件头注释）
 * @param original 原文件名
 * @param rules 规则集
 * @param index 勾选序号（0 起；未勾选传 0）
 * @param mtimeMs 文件修改时间（毫秒）
 * @param now 统一时间点
 */
export function computeNewName(
  original: string,
  rules: RenameRules,
  index: number,
  mtimeMs: number,
  now: Date
): string {
  const { stem, ext } = splitFileName(original)
  let next = stem
  if (rules.delete.enabled) next = deleteChars(next, rules.delete.from, rules.delete.count)
  if (rules.findReplace.enabled && rules.findReplace.find !== '') {
    next = applyFindReplace(next, {
      find: rules.findReplace.find,
      replace: rules.findReplace.replace,
      isRegex: rules.findReplace.isRegex,
      caseSensitive: rules.findReplace.caseSensitive
    })
  }
  next = applyCase(next, rules.caseMode)

  const sep = rules.index.separator
  const prefixParts: string[] = []
  const suffixParts: string[] = []
  if (rules.index.enabled) {
    const part = padNumber(rules.index.start + index, rules.index.digits)
    ;(rules.index.position === 'prefix' ? prefixParts : suffixParts).push(part)
  }
  if (rules.date.enabled) {
    const date = rules.date.source === 'now' ? now : new Date(mtimeMs)
    const part = formatDate(date, rules.date.format)
    ;(rules.date.position === 'prefix' ? prefixParts : suffixParts).push(part)
  }
  if (prefixParts.length > 0) next = `${prefixParts.join(sep)}${sep}${next}`
  if (suffixParts.length > 0) next = `${next}${sep}${suffixParts.join(sep)}`

  let nextExt = ext
  if (rules.extension.mode === 'lower') nextExt = ext.toLowerCase()
  if (rules.extension.mode === 'custom') nextExt = `.${rules.extension.custom}`
  return joinFileName(next, nextExt)
}

/**
 * 生成整份重命名计划（勾选行按列表顺序编号；未勾选行仅预览）
 * @param files 扫描结果（顺序即序号顺序）
 * @param rules 规则集
 * @param options 勾选集合与时间点
 */
export function buildRenamePlan(
  files: PlanFile[],
  rules: RenameRules,
  options: PlanOptions
): RenamePlan {
  const ruleError = validateRules(rules)
  if (ruleError !== null) {
    return { entries: [], renameCount: 0, conflictCount: 0, ruleError }
  }

  let seq = 0
  const rows = files.map((file) => {
    const isSelected = options.selected.has(file.name)
    const seqIndex = isSelected ? seq++ : 0
    const to = computeNewName(file.name, rules, seqIndex, file.mtimeMs, options.now)
    return { file, isSelected, to, unchanged: to.toLowerCase() === file.name.toLowerCase() }
  })

  /** 未勾选文件仍占用原名（其目标名不可被他人使用） */
  const occupied = new Set(
    rows.filter((row) => !row.isSelected || row.unchanged).map((row) => row.file.name.toLowerCase())
  )
  /** 本次将改名的来源名（目标若命中即链式/交换，一期判冲突） */
  const sources = new Set(
    rows.filter((row) => row.isSelected && !row.unchanged).map((row) => row.file.name.toLowerCase())
  )
  const targetCount = new Map<string, number>()
  for (const row of rows) {
    if (!row.isSelected || row.unchanged) continue
    const key = row.to.toLowerCase()
    targetCount.set(key, (targetCount.get(key) ?? 0) + 1)
  }

  const entries: PlanEntry[] = rows.map((row) => {
    const { from, to } = { from: row.file.name, to: row.to }
    if (!row.isSelected) return { from, to, status: 'skip', reason: '未勾选' }
    if (row.unchanged) return { from, to, status: 'skip', reason: '名称未变化' }
    const issue = validateFileName(to)
    if (issue !== null)
      return { from, to, status: 'conflict', code: issue.code, reason: issue.message }
    const key = to.toLowerCase()
    if ((targetCount.get(key) ?? 0) > 1)
      return { from, to, status: 'conflict', code: 'FR_CONFLICT', reason: '与其它文件目标重名' }
    if (occupied.has(key))
      return {
        from,
        to,
        status: 'conflict',
        code: 'FR_CONFLICT',
        reason: '目标名已被未勾选文件占用'
      }
    if (sources.has(key))
      return {
        from,
        to,
        status: 'conflict',
        code: 'FR_CONFLICT',
        reason: '目标名与其它待改文件原名相同（链式/交换）'
      }
    return { from, to, status: 'ok' }
  })

  const renameCount = entries.filter((entry) => entry.status === 'ok').length
  const conflictCount = entries.filter((entry) => entry.status === 'conflict').length
  return { entries, renameCount, conflictCount, ruleError: null }
}
