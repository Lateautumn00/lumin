import { describe, expect, it } from 'vitest'
import { evaluate, type AngleMode } from './evaluate'

function ok(expr: string, mode: AngleMode = 'deg'): number {
  const result = evaluate(expr, mode)
  if (!result.ok) throw new Error(`期望成功，实际 ${result.error.code}：${result.error.message}`)
  return result.value
}

function err(expr: string, code: string, mode: AngleMode = 'deg'): void {
  const result = evaluate(expr, mode)
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.error.code).toBe(code)
}

describe('evaluate 四则与结构', () => {
  it('空表达式', () => {
    err('', 'EMPTY_EXPR')
    err('   ', 'EMPTY_EXPR')
  })

  it('优先级与括号', () => {
    expect(ok('1+2*3')).toBe(7)
    expect(ok('(1+2)*3')).toBe(9)
    expect(ok('2*(3+(4-1))')).toBe(12)
  })

  it('幂与取模', () => {
    expect(ok('2^10')).toBe(1024)
    expect(ok('10%3')).toBe(1)
  })

  it('一元负号', () => {
    expect(ok('-5+2')).toBe(-3)
    expect(ok('2^-1')).toBe(0.5)
  })

  it('浮点噪声归一', () => {
    expect(ok('0.1+0.2')).toBeCloseTo(0.3, 10)
  })
})

describe('evaluate 函数与常量', () => {
  it('sqrt / abs / 取整', () => {
    expect(ok('sqrt(16)')).toBe(4)
    expect(ok('abs(-3)')).toBe(3)
    expect(ok('round(2.6)')).toBe(3)
    expect(ok('floor(2.6)')).toBe(2)
    expect(ok('ceil(2.1)')).toBe(3)
  })

  it('ln 自然对数 / log 常用对数 / log10', () => {
    expect(ok('ln(e)')).toBeCloseTo(1, 10)
    expect(ok('log(1000)')).toBeCloseTo(3, 10)
    expect(ok('log10(100)')).toBeCloseTo(2, 10)
  })

  it('pi 与 e 常量', () => {
    expect(ok('pi')).toBeCloseTo(Math.PI, 12)
    expect(ok('e')).toBeCloseTo(Math.E, 12)
    expect(ok('2*pi')).toBeCloseTo(2 * Math.PI, 12)
  })
})

describe('evaluate 角度模式', () => {
  it('deg：sin/cos/tan 输入角度', () => {
    expect(ok('sin(90)', 'deg')).toBeCloseTo(1, 10)
    expect(ok('cos(0)', 'deg')).toBeCloseTo(1, 10)
    expect(ok('tan(45)', 'deg')).toBeCloseTo(1, 10)
  })

  it('rad：sin/cos/tan 输入弧度', () => {
    expect(ok('sin(pi/2)', 'rad')).toBeCloseTo(1, 10)
    expect(ok('cos(0)', 'rad')).toBeCloseTo(1, 10)
    expect(ok('tan(pi/4)', 'rad')).toBeCloseTo(1, 10)
  })

  it('deg：反三角输出角度', () => {
    expect(ok('asin(1)', 'deg')).toBeCloseTo(90, 10)
    expect(ok('acos(1)', 'deg')).toBeCloseTo(0, 10)
    expect(ok('atan(1)', 'deg')).toBeCloseTo(45, 10)
  })

  it('rad：反三角输出弧度', () => {
    expect(ok('asin(1)', 'rad')).toBeCloseTo(Math.PI / 2, 10)
    expect(ok('atan(1)', 'rad')).toBeCloseTo(Math.PI / 4, 10)
  })

  it('同一表达式两模式结果不同', () => {
    expect(ok('sin(30)', 'deg')).toBeCloseTo(0.5, 10)
    expect(ok('sin(30)', 'rad')).toBeCloseTo(Math.sin(30), 10)
  })
})

describe('evaluate 阶乘', () => {
  it('函数与后缀两种语法结果一致', () => {
    expect(ok('factorial(5)')).toBe(120)
    expect(ok('5!')).toBe(120)
    expect(ok('0!')).toBe(1)
    expect(ok('(2+3)!')).toBe(120)
    expect(ok('3!+2')).toBe(8)
  })

  it('负数与非整数 → EVAL_FAILED（中文文案明确）', () => {
    err('factorial(-1)', 'EVAL_FAILED')
    err('(-1)!', 'EVAL_FAILED')
    err('1.5!', 'EVAL_FAILED')
    const result = evaluate('2.5!', 'deg')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toBe('阶乘仅支持非负整数')
  })

  it('数值溢出 → NON_FINITE', () => {
    err('171!', 'NON_FINITE')
  })
})

describe('evaluate 错误分支', () => {
  it('语法错误 → SYNTAX_ERROR', () => {
    err('2+', 'SYNTAX_ERROR')
    err('(', 'SYNTAX_ERROR')
    err('1+*2', 'SYNTAX_ERROR')
  })

  it('未知符号 → UNKNOWN_SYMBOL', () => {
    err('foo', 'UNKNOWN_SYMBOL')
    err('bar(1)', 'UNKNOWN_SYMBOL')
  })

  it('白名单外符号 → UNKNOWN_SYMBOL', () => {
    err('random()', 'UNKNOWN_SYMBOL')
    err('x=2', 'UNKNOWN_SYMBOL')
    err('1 and 1', 'UNKNOWN_SYMBOL')
  })

  it('白名单外节点类型 → UNKNOWN_SYMBOL', () => {
    err('det([1,2;3,4])', 'UNKNOWN_SYMBOL')
    err('"str"', 'UNKNOWN_SYMBOL')
    err('2>1', 'UNKNOWN_SYMBOL')
  })

  it('非有限结果 → NON_FINITE', () => {
    err('1/0', 'NON_FINITE')
    err('0/0', 'NON_FINITE')
    err('ln(0)', 'NON_FINITE')
    err('sqrt(-1)', 'NON_FINITE')
  })

  it('求值期异常 → EVAL_FAILED', () => {
    err('sqrt()', 'EVAL_FAILED')
  })
})
