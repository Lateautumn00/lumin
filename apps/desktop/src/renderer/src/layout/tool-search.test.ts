/**
 * @file 工具搜索纯函数单测
 * @author cuilanchao
 * @date 2026-11-24
 * @description 覆盖单字段评分（全等/前缀/子串/子序列/多词）与清单搜索（隐藏过滤、排序、条数、分类名命中）。
 */
import { describe, expect, it } from 'vitest'
import type { ToolCategory, ToolManifest } from '@lumin/plugin-api'
import { scoreText, searchTools } from './tool-search'

/** 构造测试用清单 */
function tool(
  id: string,
  name: string,
  category: ToolCategory,
  order: number,
  hidden = false
): ToolManifest {
  return {
    id,
    name,
    description: name,
    icon: 'wrench',
    category,
    order,
    version: '1.0.0',
    ...(hidden ? { hidden: true } : {})
  }
}

const TOOLS: readonly ToolManifest[] = [
  tool('calculator', '计算器', 'compute', 1),
  tool('image-watermark', '图片加水印', 'image', 2),
  tool('image-dewatermark', '图片去水印', 'image', 3),
  tool('text-diff', '文本对比', 'text', 4),
  tool('hidden-tool', '隐藏工具', 'misc', 5, true)
]

const CATEGORY_LABEL: Record<string, string> = {
  compute: '计算与转换',
  text: '文本与编码',
  image: '图片处理',
  document: '文档与 PDF',
  media: '音视频',
  file: '文件管理',
  misc: '其他'
}

/** 按分类取中文展示名（模拟壳层 i18n 注入） */
function labelOf(category: ToolCategory): string {
  return CATEGORY_LABEL[category] ?? ''
}

describe('scoreText', () => {
  it('空查询 / 空文本不匹配', () => {
    expect(scoreText('', '计算器')).toBeNull()
    expect(scoreText('   ', '计算器')).toBeNull()
    expect(scoreText('计算', '')).toBeNull()
  })

  it('完全相等得分最高，且高于前缀/子串/子序列', () => {
    const exact = scoreText('计算器', '计算器')
    const prefix = scoreText('计算', '计算器')
    const inner = scoreText('算器', '计算器')
    const spread = scoreText('计器', '计算器')
    expect(exact).not.toBeNull()
    expect(prefix).not.toBeNull()
    expect(inner).not.toBeNull()
    expect(spread).not.toBeNull()
    expect(exact).toBeGreaterThan(prefix as number)
    expect(prefix).toBeGreaterThan(inner as number)
    expect(inner).toBeGreaterThan(spread as number)
  })

  it('大小写不敏感，多词需全部命中', () => {
    expect(scoreText('CALC', 'calculator')).not.toBeNull()
    expect(scoreText('图片 水印', '图片去水印')).not.toBeNull()
    expect(scoreText('图片 对比', '图片去水印')).toBeNull()
  })

  it('无法按序命中时返回 null', () => {
    expect(scoreText('器计', '计算器')).toBeNull()
  })
})

describe('searchTools', () => {
  it('空查询返回空结果', () => {
    expect(searchTools(TOOLS, '  ')).toEqual([])
  })

  it('按工具名命中并按相关度排序，隐藏工具不参与', () => {
    const results = searchTools(TOOLS, '水印')
    expect(results.map((item) => item.id)).toEqual(['image-watermark', 'image-dewatermark'])
    expect(results.every((item) => item.id !== 'hidden-tool')).toBe(true)
    expect(results[0]?.score).toBeGreaterThanOrEqual(results[1]?.score ?? 0)
  })

  it('支持 id 与分类名命中', () => {
    expect(searchTools(TOOLS, 'text-diff').map((item) => item.id)).toEqual(['text-diff'])
    const image = searchTools(TOOLS, '图片', { categoryLabel: labelOf })
    expect(image.map((item) => item.id)).toEqual(
      expect.arrayContaining(['image-watermark', 'image-dewatermark'])
    )
  })

  it('limit 截断，得分相同保持清单原顺序', () => {
    expect(searchTools(TOOLS, '水印', { limit: 1 })).toHaveLength(1)
    const compute = searchTools(TOOLS, '计算与转换', { categoryLabel: labelOf })
    expect(compute[0]?.id).toBe('calculator')
  })
})
