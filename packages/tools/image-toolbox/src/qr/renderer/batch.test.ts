/**
 * @file batch.test.ts 批量识别编排单测（spec M55 ⑨）
 * @author cuilanchao
 * @date 2026-11-22
 * @description 上限截断、错误归类、汇总、TSV 转义
 */
import { describe, expect, it } from 'vitest'

import {
  appendBatchItems,
  BATCH_LIMIT,
  batchStatusAfterError,
  batchToTsv,
  summarizeBatch,
  type BatchItem
} from './batch'

/** 构造已识别条目 */
function item(
  id: number,
  name: string,
  status: BatchItem<null>['status'],
  text = ''
): BatchItem<null> {
  return { id, name, source: null, status, text }
}

describe('appendBatchItems', () => {
  it('空列表追加并生成连续 id', () => {
    const { items, ignored } = appendBatchItems(
      [],
      [
        { name: 'a.png', source: 'a' },
        { name: 'b.png', source: 'b' }
      ]
    )
    expect(ignored).toBe(0)
    expect(items.map((entry) => entry.id)).toEqual([1, 2])
    expect(items.map((entry) => entry.status)).toEqual(['待识别', '待识别'])
    expect(items.map((entry) => entry.text)).toEqual(['', ''])
  })

  it('已有条目时 id 从最大值递增', () => {
    const existing = [item(3, 'old.png', '已识别', 'x')]
    const { items } = appendBatchItems(existing, [{ name: 'new.png', source: 'n' }])
    expect(items.map((entry) => entry.id)).toEqual([3, 4])
    expect(items[0]?.text).toBe('x')
  })

  it('超过上限时截断并返回忽略数', () => {
    const additions = Array.from({ length: 3 }, (_, index) => ({
      name: `${index}.png`,
      source: index
    }))
    const { items, ignored } = appendBatchItems([], additions, 2)
    expect(items).toHaveLength(2)
    expect(ignored).toBe(1)
  })

  it('已满时全部忽略', () => {
    const existing = Array.from({ length: 2 }, (_, index) =>
      item(index + 1, `${index}.png`, '未识别')
    )
    const { items, ignored } = appendBatchItems(existing, [{ name: 'x.png', source: 'x' }], 2)
    expect(items).toHaveLength(2)
    expect(ignored).toBe(1)
  })

  it('默认上限为 50', () => {
    expect(BATCH_LIMIT).toBe(50)
    const additions = Array.from({ length: 51 }, (_, index) => ({
      name: `${index}.png`,
      source: index
    }))
    expect(appendBatchItems([], additions).items).toHaveLength(50)
    expect(appendBatchItems([], additions).ignored).toBe(1)
  })
})

describe('batchStatusAfterError', () => {
  it('无码归未识别，其余归失败', () => {
    expect(batchStatusAfterError('QR_DECODE_FAILED')).toBe('未识别')
    expect(batchStatusAfterError('QR_IMAGE_UNREADABLE')).toBe('失败')
    expect(batchStatusAfterError('QR_IMAGE_TOO_LARGE')).toBe('失败')
  })
})

describe('summarizeBatch', () => {
  it('按状态计数，待识别/识别中计入 pending', () => {
    const summary = summarizeBatch([
      item(1, 'a', '已识别', 'x'),
      item(2, 'b', '已识别', 'y'),
      item(3, 'c', '未识别'),
      item(4, 'd', '失败'),
      item(5, 'e', '待识别'),
      item(6, 'f', '识别中')
    ])
    expect(summary).toEqual({
      total: 6,
      pending: 2,
      recognized: 2,
      unrecognized: 1,
      failed: 1
    })
  })

  it('空列表全为 0', () => {
    expect(summarizeBatch([])).toEqual({
      total: 0,
      pending: 0,
      recognized: 0,
      unrecognized: 0,
      failed: 0
    })
  })
})

describe('batchToTsv', () => {
  it('首行表头 + 三列，含状态', () => {
    const tsv = batchToTsv([item(1, 'a.png', '已识别', 'hello'), item(2, 'b.png', '未识别')])
    expect(tsv.split('\n')).toEqual([
      '文件名\t识别文本\t状态',
      'a.png\thello\t已识别',
      'b.png\t\t未识别'
    ])
  })

  it('制表符与换行折叠为空格，避免破列', () => {
    const tsv = batchToTsv([item(1, 'a\tb.png', '已识别', '第一行\r\n第二行\tX')])
    expect(tsv.split('\n')[1]).toBe('a b.png\t第一行 第二行 X\t已识别')
  })
})
