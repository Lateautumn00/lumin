/**
 * @file entries.test.ts 轮询判定与展示纯函数单测（R1：核心纯函数 ≥80%）
 * @author cuilanchao
 * @date 2026-11-23
 */
import { describe, expect, it } from 'vitest'
import {
  evictOverLimit,
  filterEntries,
  formatRelativeTime,
  formatTextStats,
  ingestClipboard,
  moveToFront,
  removeEntry,
  sortEntries,
  summarize,
  togglePinned,
  upsertEntry,
  utf8ByteLength
} from './entries'
import { MAX_ENTRIES, MAX_TEXT_BYTES, type Entry } from './schema'

const NOW = 1_700_000_000_000

function entry(partial: Partial<Entry> & { id: string }): Entry {
  return { text: `文本-${partial.id}`, createdAt: NOW, pinned: false, ...partial }
}

describe('utf8ByteLength', () => {
  it('ASCII 一字节、中文三字节', () => {
    expect(utf8ByteLength('abc')).toBe(3)
    expect(utf8ByteLength('中文')).toBe(6)
  })
})

describe('sortEntries', () => {
  it('置顶组恒在最前，组内按 createdAt 倒序', () => {
    const items = [
      entry({ id: 'a', createdAt: 100 }),
      entry({ id: 'b', createdAt: 300, pinned: true }),
      entry({ id: 'c', createdAt: 200 }),
      entry({ id: 'd', createdAt: 150, pinned: true })
    ]
    expect(sortEntries(items).map((e) => e.id)).toEqual(['b', 'd', 'c', 'a'])
  })
})

describe('evictOverLimit', () => {
  it('超过上限从尾部最旧未置顶逐条丢弃', () => {
    const items = Array.from({ length: MAX_ENTRIES + 3 }, (_, i) =>
      entry({ id: `e${i}`, createdAt: MAX_ENTRIES + 3 - i })
    )
    const next = evictOverLimit(items)
    expect(next).toHaveLength(MAX_ENTRIES)
    expect(next.some((e) => e.id === 'e0')).toBe(true)
    expect(next.some((e) => e.id === `e${MAX_ENTRIES + 2}`)).toBe(false)
  })

  it('尾部为置顶时丢弃其前一条未置顶，置顶永不淘汰', () => {
    const items = Array.from({ length: MAX_ENTRIES }, (_, i) =>
      entry({ id: `e${i}`, createdAt: MAX_ENTRIES - i, pinned: i === MAX_ENTRIES - 1 })
    )
    const next = evictOverLimit([entry({ id: 'new', createdAt: MAX_ENTRIES + 1 }), ...items])
    expect(next).toHaveLength(MAX_ENTRIES)
    expect(next.some((e) => e.id === 'e499')).toBe(true)
    expect(next.some((e) => e.id === 'e498')).toBe(false)
    expect(next.some((e) => e.id === 'new')).toBe(true)
  })

  it('全为置顶时不淘汰（上限只约束未置顶条目）', () => {
    const items = Array.from({ length: MAX_ENTRIES + 1 }, (_, i) =>
      entry({ id: `p${i}`, createdAt: MAX_ENTRIES + 1 - i, pinned: true })
    )
    expect(evictOverLimit(items)).toHaveLength(MAX_ENTRIES + 1)
  })
})

describe('ingestClipboard', () => {
  it('空串跳过，不新增', () => {
    const items = [entry({ id: 'a' })]
    const outcome = ingestClipboard(items, '', NOW, 'new')
    expect(outcome.entry).toBeNull()
    expect(outcome.items).toHaveLength(1)
  })

  it('恰好 100KB 入库，超 100KB 跳过并返回 TOO_LARGE', () => {
    const atLimit = 'a'.repeat(MAX_TEXT_BYTES)
    const ok = ingestClipboard([], atLimit, NOW, 'new')
    expect(ok.entry?.id).toBe('new')
    expect(ok.skipped).toBeUndefined()

    const overLimit = 'a'.repeat(MAX_TEXT_BYTES + 1)
    const skipped = ingestClipboard([], overLimit, NOW, 'new2')
    expect(skipped.entry).toBeNull()
    expect(skipped.skipped).toBe('TOO_LARGE')
    expect(skipped.items).toHaveLength(0)
  })

  it('与头部条目相同则跳过', () => {
    const items = [entry({ id: 'head', text: '重复文本' }), entry({ id: 'other', text: '别的' })]
    const outcome = ingestClipboard(items, '重复文本', NOW, 'new')
    expect(outcome.entry).toBeNull()
    expect(outcome.items).toHaveLength(2)
  })

  it('与非头部条目相同则前移该条（去重，不新增，createdAt 前移）', () => {
    const items = [
      entry({ id: 'head', text: '头部', createdAt: 200 }),
      entry({ id: 'dup', text: '重复', createdAt: 100 })
    ]
    const outcome = ingestClipboard(items, '重复', NOW, 'new')
    expect(outcome.entry).toEqual({ id: 'dup', text: '重复', createdAt: NOW, pinned: false })
    expect(outcome.items).toHaveLength(2)
    expect(outcome.items[0]?.id).toBe('dup')
  })

  it('已处于所属组首位的重复文本跳过（避免轮询反复重写）', () => {
    const items = [
      entry({ id: 'pinned-head', text: '置顶头', createdAt: 300, pinned: true }),
      entry({ id: 'front-unpinned', text: '未置顶头', createdAt: 200 })
    ]
    const outcome = ingestClipboard(items, '未置顶头', NOW, 'new')
    expect(outcome.entry).toBeNull()
    expect(outcome.items).toHaveLength(2)
  })

  it('新条目前插（置顶组恒在最前），并按上限淘汰', () => {
    const pinned = entry({ id: 'p', createdAt: 1, pinned: true })
    const outcome = ingestClipboard([pinned], '新剪贴板文本', NOW, 'new')
    expect(outcome.entry?.id).toBe('new')
    expect(outcome.items.map((e) => e.id)).toEqual(['p', 'new'])
  })

  it('满 500 条时新条目挤掉最旧未置顶', () => {
    const items = Array.from({ length: MAX_ENTRIES }, (_, i) =>
      entry({ id: `e${i}`, createdAt: MAX_ENTRIES - i })
    )
    const outcome = ingestClipboard(items, '第五百零一条', NOW, 'new')
    expect(outcome.items).toHaveLength(MAX_ENTRIES)
    expect(outcome.items[0]?.id).toBe('new')
    expect(outcome.items.some((e) => e.id === 'e499')).toBe(false)
  })
})

describe('togglePinned / removeEntry / moveToFront / upsertEntry', () => {
  it('togglePinned 切换并重排（置顶组在前）', () => {
    const items = [entry({ id: 'a', createdAt: 200 }), entry({ id: 'b', createdAt: 300 })]
    const next = togglePinned(items, 'a')
    expect(next?.[0]).toEqual({ id: 'a', text: '文本-a', createdAt: 200, pinned: true })
    const back = togglePinned(next ?? [], 'a')
    expect(back?.find((e) => e.id === 'a')?.pinned).toBe(false)
  })

  it('togglePinned 对不存在 id 返回 null', () => {
    expect(togglePinned([entry({ id: 'a' })], 'missing')).toBeNull()
  })

  it('removeEntry 删除存在的条目，不存在返回 null', () => {
    const items = [entry({ id: 'a' }), entry({ id: 'b' })]
    expect(removeEntry(items, 'a')?.map((e) => e.id)).toEqual(['b'])
    expect(removeEntry(items, 'missing')).toBeNull()
  })

  it('moveToFront 前移到所属组首位，id 不存在返回 null', () => {
    const items = [
      entry({ id: 'p', createdAt: 500, pinned: true }),
      entry({ id: 'a', createdAt: 100 }),
      entry({ id: 'b', createdAt: 200 })
    ]
    const next = moveToFront(items, 'a', NOW)
    expect(next?.map((e) => e.id)).toEqual(['p', 'a', 'b'])
    expect(moveToFront(items, 'missing', NOW)).toBeNull()
  })

  it('upsertEntry 按 id 替换或追加后重排', () => {
    const items = [entry({ id: 'a', createdAt: 100 })]
    const replaced = upsertEntry(items, entry({ id: 'a', createdAt: 50 }))
    expect(replaced).toHaveLength(1)
    expect(replaced[0]?.createdAt).toBe(50)
    const appended = upsertEntry(items, entry({ id: 'b', createdAt: 200 }))
    expect(appended.map((e) => e.id)).toEqual(['b', 'a'])
  })
})

describe('filterEntries / summarize', () => {
  const items = [
    entry({ id: 'a', text: 'Hello 世界' }),
    entry({ id: 'b', text: 'hello lumin', pinned: true }),
    entry({ id: 'c', text: '无关文本' })
  ]

  it('空词返回全量，子串忽略大小写过滤', () => {
    expect(filterEntries(items, '')).toHaveLength(3)
    expect(filterEntries(items, 'HELLO').map((e) => e.id)).toEqual(['a', 'b'])
    expect(filterEntries(items, '世界').map((e) => e.id)).toEqual(['a'])
    expect(filterEntries(items, '无命中词')).toHaveLength(0)
  })

  it('条数徽标随过滤更新', () => {
    expect(summarize(items)).toBe('共 3 条 · 置顶 1 条')
    expect(summarize(filterEntries(items, 'hello'))).toBe('共 2 条 · 置顶 1 条')
  })
})

describe('formatRelativeTime / formatTextStats', () => {
  it('刚刚 / 分钟前 / 同日小时前 / 跨日日期', () => {
    expect(formatRelativeTime(NOW - 30_000, NOW)).toBe('刚刚')
    expect(formatRelativeTime(NOW - 30 * 60_000, NOW)).toBe('30 分钟前')
    expect(formatRelativeTime(NOW - 5 * 3_600_000, NOW)).toBe('5 小时前')
    const yesterday = NOW - 26 * 3_600_000
    expect(formatRelativeTime(yesterday, NOW)).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('未来时间视为刚刚', () => {
    expect(formatRelativeTime(NOW + 60_000, NOW)).toBe('刚刚')
  })

  it('字数与行数徽标', () => {
    expect(formatTextStats('abc')).toBe('3 字 · 1 行')
    expect(formatTextStats('第一行\n第二行\n第三行')).toBe('11 字 · 3 行')
  })
})
