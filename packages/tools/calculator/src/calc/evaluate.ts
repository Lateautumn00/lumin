import type { StructuredError } from '@lumin/shared'
import {
  ConstantNode,
  FunctionNode,
  OperatorNode,
  ParenthesisNode,
  SymbolNode,
  parse,
  type MathNode
} from 'mathjs/number'

export type AngleMode = 'deg' | 'rad'

export type EvalErrorCode =
  'EMPTY_EXPR' | 'SYNTAX_ERROR' | 'UNKNOWN_SYMBOL' | 'NON_NUMERIC' | 'NON_FINITE' | 'EVAL_FAILED'

export type EvalResult =
  | { readonly ok: true; readonly value: number }
  | { readonly ok: false; readonly error: StructuredError }

/** 允许出现在表达式中的符号（函数与常量）；其余一律拒绝 */
const ALLOWED_SYMBOLS: ReadonlySet<string> = new Set([
  'sin',
  'cos',
  'tan',
  'asin',
  'acos',
  'atan',
  'ln',
  'log',
  'log10',
  'sqrt',
  'abs',
  'round',
  'floor',
  'ceil',
  'factorial',
  'pi',
  'e'
])

/** 允许的运算符（mathjs OperatorNode.fn 名）；factorial 对应后缀 `!` 语法 */
const ALLOWED_OPS: ReadonlySet<string> = new Set([
  'add',
  'subtract',
  'multiply',
  'divide',
  'pow',
  'mod',
  'factorial',
  'unaryMinus',
  'unaryPlus'
])

class WhitelistViolation extends Error {
  constructor(symbol: string) {
    super(`白名单外符号：${symbol}`)
    this.name = 'WhitelistViolation'
  }
}

function failure(code: EvalErrorCode, message: string, detail?: string): EvalResult {
  return { ok: false, error: detail === undefined ? { code, message } : { code, message, detail } }
}

function assertWhitelisted(node: MathNode): void {
  if (node instanceof ConstantNode) {
    if (typeof node.value !== 'number') throw new WhitelistViolation(typeof node.value)
    return
  }
  if (node instanceof SymbolNode) {
    if (!ALLOWED_SYMBOLS.has(node.name)) throw new WhitelistViolation(node.name)
    return
  }
  if (node instanceof FunctionNode) {
    if (!ALLOWED_SYMBOLS.has(node.fn.name)) throw new WhitelistViolation(node.fn.name)
    for (const arg of node.args) assertWhitelisted(arg)
    return
  }
  if (node instanceof OperatorNode) {
    if (!ALLOWED_OPS.has(node.fn)) throw new WhitelistViolation(node.fn)
    for (const arg of node.args) assertWhitelisted(arg)
    return
  }
  if (node instanceof ParenthesisNode) {
    assertWhitelisted(node.content)
    return
  }
  throw new WhitelistViolation(node.type)
}

function identity(x: number): number {
  return x
}

/** 阶乘仅接受非负整数（mathjs 默认对非整数走伽马函数，此处收敛为普通计算器语义） */
function factorial(x: number): number {
  if (!Number.isInteger(x) || x < 0) throw new Error('阶乘仅支持非负整数')
  let value = 1
  for (let index = 2; index <= x; index += 1) value *= index
  return value
}

/**
 * 把后缀 `!`（OperatorNode.fn='factorial'）改写为函数调用节点
 * @description mathjs 的 OperatorNode 求值不读 scope，改写后两种写法统一走本地阶乘实现
 */
function normalizeFactorial(node: MathNode): MathNode {
  return node.transform<MathNode>((current) =>
    current instanceof OperatorNode && current.fn === 'factorial'
      ? new FunctionNode(new SymbolNode('factorial'), current.args)
      : current
  )
}

/** 按角度模式构造求值 scope：三角函数与反三角函数换算角度，ln/log 分别为自然对数/常用对数 */
function createScope(mode: AngleMode): Record<string, unknown> {
  const toRad = mode === 'deg' ? (x: number): number => (x * Math.PI) / 180 : identity
  const fromRad = mode === 'deg' ? (x: number): number => (x * 180) / Math.PI : identity
  return {
    sin: (x: number): number => Math.sin(toRad(x)),
    cos: (x: number): number => Math.cos(toRad(x)),
    tan: (x: number): number => Math.tan(toRad(x)),
    asin: (x: number): number => fromRad(Math.asin(x)),
    acos: (x: number): number => fromRad(Math.acos(x)),
    atan: (x: number): number => fromRad(Math.atan(x)),
    ln: (x: number): number => Math.log(x),
    log: (x: number): number => Math.log10(x),
    factorial
  }
}

function classifyParseError(err: unknown): StructuredError {
  const detail = err instanceof Error ? err.message : String(err)
  if (err instanceof Error && err.name === 'SyntaxError') {
    return { code: 'SYNTAX_ERROR', message: '表达式语法无效', detail }
  }
  return { code: 'EVAL_FAILED', message: '计算失败', detail }
}

function classifyEvalError(err: unknown): StructuredError {
  const detail = err instanceof Error ? err.message : String(err)
  if (err instanceof Error && err.name === 'SyntaxError') {
    return { code: 'SYNTAX_ERROR', message: '表达式语法无效', detail }
  }
  if (/Undefined symbol/i.test(detail)) {
    return { code: 'UNKNOWN_SYMBOL', message: '表达式含未知符号', detail }
  }
  if (detail.includes('阶乘仅支持非负整数')) {
    return { code: 'EVAL_FAILED', message: '阶乘仅支持非负整数', detail }
  }
  return { code: 'EVAL_FAILED', message: '计算失败', detail }
}

/** 求值纯函数：语法解析 → 白名单校验 → 按角度模式求值；永不抛出 */
export function evaluate(expr: string, mode: AngleMode): EvalResult {
  const trimmed = expr.trim()
  if (trimmed === '') return failure('EMPTY_EXPR', '请输入表达式')

  let node: MathNode
  try {
    node = parse(trimmed)
  } catch (err) {
    return { ok: false, error: classifyParseError(err) }
  }

  try {
    assertWhitelisted(node)
  } catch (err) {
    if (err instanceof WhitelistViolation) {
      return failure('UNKNOWN_SYMBOL', '表达式含未知符号', err.message)
    }
    return failure('EVAL_FAILED', '计算失败')
  }

  try {
    const value: unknown = normalizeFactorial(node).compile().evaluate(createScope(mode))
    if (typeof value !== 'number') return failure('NON_NUMERIC', '结果不是数值')
    if (!Number.isFinite(value)) return failure('NON_FINITE', '结果无效（除零或溢出）')
    return { ok: true, value }
  } catch (err) {
    return { ok: false, error: classifyEvalError(err) }
  }
}
