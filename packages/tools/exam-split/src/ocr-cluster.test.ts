import { describe, expect, it } from 'vitest'
import {
  COLUMN_GAP_MIN,
  clusterPage,
  detectColumnSplit,
  isPrimaryQNum,
  isSecondaryQNum
} from './ocr-cluster'
import type { OcrLine } from './schema'

function line(text: string, x: number, y: number, width: number, height = 0.02): OcrLine {
  return { text, x, y, width, height }
}

describe('题号规则（spec §10.4 两级）', () => {
  it('一级：`1.` `1、` `一、` `第1题`', () => {
    expect(isPrimaryQNum('1. 下列哪项正确')).toBe(true)
    expect(isPrimaryQNum('1、已知函数 f(x)')).toBe(true)
    expect(isPrimaryQNum('一、选择题（每题 5 分）')).toBe(true)
    expect(isPrimaryQNum('十二、作文（60 分）')).toBe(true)
    expect(isPrimaryQNum('第1题 计算下列各题')).toBe(true)
    expect(isPrimaryQNum('第 12 题')).toBe(true)
  })

  it('非题号：小数、选项、二级、普通文本', () => {
    expect(isPrimaryQNum('1.5 厘米的线段')).toBe(false)
    expect(isPrimaryQNum('A. 只在夜间进行')).toBe(false)
    expect(isPrimaryQNum('(1) 结合上下文说明')).toBe(false)
    expect(isPrimaryQNum('下列说法正确的是')).toBe(false)
  })

  it('二级：`(1)` `（1）`；不匹配一级样式', () => {
    expect(isSecondaryQNum('(1) 结合上下文说明含义')).toBe(true)
    expect(isSecondaryQNum('（2）简要分析论证结构')).toBe(true)
    expect(isSecondaryQNum('1. 下列哪项正确')).toBe(false)
    expect(isSecondaryQNum('1) 半角右括号不匹配')).toBe(false)
  })
})

describe('detectColumnSplit', () => {
  it('左右两列均有题号行且空隙 ≥3% → 返回列边界', () => {
    const lines = [
      line('姓名：____ 班级：____', 0.05, 0.02, 0.4, 0.02),
      line('1. 左栏第一题', 0.06, 0.1, 0.38),
      line('2. 左栏第二题', 0.06, 0.3, 0.38),
      line('6. 右栏第一题', 0.56, 0.1, 0.38),
      line('7. 右栏第二题', 0.56, 0.3, 0.38)
    ]
    const split = detectColumnSplit(lines)
    expect(split).not.toBeNull()
    expect(split).toBeCloseTo(0.5, 5)
  })

  it('空隙 <3% → 单栏', () => {
    const lines = [line('1. 左题', 0.05, 0.1, 0.43), line('2. 右题', 0.5, 0.1, 0.45)]
    expect(detectColumnSplit(lines)).toBeNull()
    expect(COLUMN_GAP_MIN).toBe(0.03)
  })

  it('仅一列含题号行 → 不判分栏', () => {
    const lines = [
      line('1. 左栏题', 0.06, 0.1, 0.38),
      line('这是一段没有题号的正文', 0.56, 0.3, 0.38)
    ]
    expect(detectColumnSplit(lines)).toBeNull()
  })

  it('全宽标题行被覆盖阈值容忍（跨中部但不断栏）', () => {
    const lines = [
      line('一、选择题（每题 5 分，共 30 分）', 0.05, 0.05, 0.9),
      line('1. 左栏题', 0.06, 0.1, 0.38),
      line('2. 左栏题', 0.06, 0.3, 0.38),
      line('6. 右栏题', 0.56, 0.1, 0.38),
      line('7. 右栏题', 0.56, 0.3, 0.38)
    ]
    const split = detectColumnSplit(lines)
    expect(split).not.toBeNull()
    expect(split).toBeCloseTo(0.5, 5)
  })

  it('行数不足 / 无题号 → null', () => {
    expect(detectColumnSplit([])).toBeNull()
    expect(detectColumnSplit([line('1. 只有一行', 0.1, 0.1, 0.3)])).toBeNull()
    expect(
      detectColumnSplit([line('正文甲', 0.06, 0.1, 0.38), line('正文乙', 0.56, 0.1, 0.38)])
    ).toBeNull()
  })
})

describe('detectColumnSplit · 跨页展开照（spec §10.12）', () => {
  /** 整本摊开：左右各一页，书脊窄、页脚行跨缝（旧「最大空隙」口径恒判单栏） */
  const spread = [
    line('1. 左页第一题', 0.02, 0.1, 0.44),
    line('2. 左页第二题', 0.02, 0.35, 0.44),
    line('3. 左页第三题', 0.02, 0.62, 0.44),
    line('1. 右页第一题', 0.54, 0.12, 0.44),
    line('2. 右页第二题', 0.54, 0.4, 0.44),
    line('一年级语文 第 1 页', 0.4, 0.94, 0.2)
  ]

  it('页脚跨缝仍判两列，切分落在书脊', () => {
    const split = detectColumnSplit(spread)
    expect(split).not.toBeNull()
    // 书脊真实中点 0.5；页脚（0.4–0.6）跨缝只让谷底收窄，切分仍落在书脊附近
    expect(split).toBeCloseTo(0.5, 5)
  })

  it('clusterPage 按列各自聚类：左 3 题 + 右 2 题，按页序→列序编号', () => {
    const split = detectColumnSplit(spread) ?? 0.5
    const regions = clusterPage(spread)
    expect(regions).toHaveLength(5)
    const left = regions.slice(0, 3)
    for (const region of left) {
      expect(region.xStart).toBe(0)
      expect(region.xEnd).toBeCloseTo(split, 5)
    }
    expect(left.map((region) => region.lines[0]?.text)).toEqual([
      '1. 左页第一题',
      '2. 左页第二题',
      '3. 左页第三题'
    ])
    const right = regions.slice(3)
    for (const region of right) {
      expect(region.xStart).toBeCloseTo(split, 5)
      expect(region.xEnd).toBe(1)
    }
    expect(right.map((region) => region.lines[0]?.text)).toEqual(['1. 右页第一题', '2. 右页第二题'])
    // 页脚中心 x=0.5 → 归右页末题
    expect(right[1]?.lines.at(-1)?.text).toBe('一年级语文 第 1 页')
  })

  it('单栏满宽排版（覆盖率无谷底）→ null', () => {
    const lines = Array.from({ length: 40 }, (_, index) =>
      line(`${index + 1}. 正文第 ${index + 1} 行`, 0.05, index / 40, 0.9)
    )
    expect(detectColumnSplit(lines)).toBeNull()
  })

  it('书脊/栏缝窄于 3% → 不判分栏', () => {
    const lines = [line('1. 左题', 0.02, 0.1, 0.465), line('2. 右题', 0.515, 0.1, 0.465)]
    expect(detectColumnSplit(lines)).toBeNull()
  })
})

describe('detectColumnSplit · 候选排序（spec §10.4 P4）', () => {
  /**
   * 34 行（谷底阈值 2 行）：左栏内 8% 宽的配对题留白有 2 行跨过，
   * 真实栏缝 6% 宽且完全空白。旧「最宽优先」会选内部留白（会裁掉右列内容）。
   */
  const lines = (() => {
    const out = Array.from({ length: 14 }, (_, index) =>
      line('页边注', 0, 0.1 + index * 0.05, 0.16)
    )
    for (let index = 0; index < 6; index++) {
      out.push(line(`${index + 1}. 左栏题`, 0.2, 0.1 + index * 0.12, 0.16))
    }
    out.push(line('跨留白行一', 0.24, 0.06, 0.24), line('跨留白行二', 0.24, 0.88, 0.24))
    for (let index = 0; index < 6; index++) {
      out.push(line('左栏正文', 0.44, 0.1 + index * 0.12, 0.11))
    }
    for (let index = 0; index < 6; index++) {
      out.push(line(`${index + 1}. 右栏题`, 0.62, 0.1 + index * 0.12, 0.3))
    }
    return out
  })()

  it('宽而浅的内部留白 vs 窄而空的真实栏缝 → 选后者', () => {
    expect(detectColumnSplit(lines)).toBeCloseTo(0.59, 5)
  })
})

describe('clusterPage 单栏', () => {
  it('按一级题号切分，首 start=0、末 end=1、边界取空隙中点', () => {
    const lines = [
      line('1. 第一题', 0.1, 0.2, 0.5),
      line('选项 A ……', 0.1, 0.3, 0.5),
      line('2. 第二题', 0.1, 0.5, 0.5)
    ]
    const regions = clusterPage(lines)
    expect(regions).toHaveLength(2)
    expect(regions[0]?.start).toBe(0)
    // 边界 = (0.2+0.02 + 0.5) / 2 = 0.36
    expect(regions[0]?.end).toBeCloseTo(0.36, 5)
    expect(regions[1]?.start).toBeCloseTo(0.36, 5)
    expect(regions[1]?.end).toBe(1)
    // 正文行（中心 0.31）归第一题
    expect(regions[0]?.lines).toHaveLength(2)
    expect(regions[1]?.lines).toHaveLength(1)
    // 单栏不附 x 边界（缺省全宽）
    expect(regions[0]).not.toHaveProperty('xStart')
    expect(regions[0]).not.toHaveProperty('xEnd')
  })

  it('无任何题号 → 整页一个 region', () => {
    const regions = clusterPage([line('这是一段正文', 0.1, 0.2, 0.5)])
    expect(regions).toHaveLength(1)
    expect(regions[0]?.start).toBe(0)
    expect(regions[0]?.end).toBe(1)
    expect(regions[0]?.lines).toHaveLength(1)
  })

  it('仅二级题号（无一级）→ 按二级切分', () => {
    const lines = [line('(1) 小问一', 0.1, 0.2, 0.5), line('(2) 小问二', 0.1, 0.5, 0.5)]
    const regions = clusterPage(lines)
    expect(regions).toHaveLength(2)
    expect(regions[0]?.end).toBeCloseTo(0.36, 5)
  })

  it('存在一级题号时不启用二级（避免切碎小题）', () => {
    const lines = [
      line('1. 大题', 0.1, 0.1, 0.5),
      line('(1) 小问', 0.1, 0.3, 0.5),
      line('(2) 小问', 0.1, 0.5, 0.5)
    ]
    const regions = clusterPage(lines)
    expect(regions).toHaveLength(1)
    expect(regions[0]?.end).toBe(1)
  })

  it('空行集 → 空数组', () => {
    expect(clusterPage([])).toEqual([])
  })
})

describe('clusterPage 双栏', () => {
  const twoColumn = [
    line('（试卷满分 150 分，考试时间 120 分钟）', 0.05, 0.04, 0.9),
    line('1. 左一', 0.06, 0.1, 0.38),
    line('2. 左二', 0.06, 0.4, 0.38),
    line('6. 右一', 0.56, 0.1, 0.38),
    line('7. 右二', 0.56, 0.4, 0.38)
  ]

  it('每列独立聚类，左列前右列后，附 xStart/xEnd', () => {
    const regions = clusterPage(twoColumn)
    expect(regions).toHaveLength(4)

    const left = regions.slice(0, 2)
    const right = regions.slice(2)
    for (const region of left) {
      expect(region.xStart).toBe(0)
      expect(region.xEnd).toBeCloseTo(0.5, 5)
    }
    for (const region of right) {
      expect(region.xStart).toBeCloseTo(0.5, 5)
      expect(region.xEnd).toBe(1)
    }
    expect(left[0]?.start).toBe(0)
    expect(right[1]?.end).toBe(1)
  })

  it('全宽标题行不参与列检测，按中心归属一列', () => {
    const regions = clusterPage(twoColumn)
    const headerRegion = regions.find((region) =>
      region.lines.some((item) => item.text.startsWith('（试卷满分'))
    )
    expect(headerRegion).toBeDefined()
    // 标题中心 x = 0.5 → 归右列（xStart=0.5）
    expect(headerRegion?.xStart).toBeCloseTo(0.5, 5)
  })

  it('题号行归属正确（左一/左二/右一/右二各自成区）', () => {
    const regions = clusterPage(twoColumn)
    expect(regions[0]?.lines.map((item) => item.text)).toEqual(['1. 左一'])
    expect(regions[1]?.lines.map((item) => item.text)).toEqual(['2. 左二'])
    expect(regions[2]?.lines.map((item) => item.text)).toEqual([
      '（试卷满分 150 分，考试时间 120 分钟）',
      '6. 右一'
    ])
    expect(regions[3]?.lines.map((item) => item.text)).toEqual(['7. 右二'])
  })

  it('全宽一级题号（`一、`大题头）作为其所在列的 region 起点', () => {
    const withSection = [
      line('一、选择题（每题 5 分，共 30 分）', 0.05, 0.04, 0.9),
      line('1. 左一', 0.06, 0.1, 0.38),
      line('6. 右一', 0.56, 0.1, 0.38)
    ]
    const regions = clusterPage(withSection)
    // 左列：1 题；右列：大题头（region 起点）+ 6 题 → 3 个 region
    expect(regions).toHaveLength(3)
    expect(regions[1]?.lines[0]?.text).toBe('一、选择题（每题 5 分，共 30 分）')
    expect(regions[1]?.xStart).toBeCloseTo(0.5, 5)
    expect(regions[2]?.lines.map((item) => item.text)).toEqual(['6. 右一'])
  })
})
