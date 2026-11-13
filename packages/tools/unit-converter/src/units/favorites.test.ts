import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import {
  FAVORITES_STORAGE_KEY,
  loadFavorites,
  saveFavorites,
  sortWithFavorites,
  toggleFavorite,
  useFavoritesStore,
  type StorageLike
} from './favorites'

function mapStorage(initial: Record<string, string> = {}): {
  storage: StorageLike
  map: Map<string, string>
} {
  const map = new Map<string, string>(Object.entries(initial))
  const storage: StorageLike = {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => map.set(key, value)
  }
  return { storage, map }
}

describe('loadFavorites', () => {
  it('null 存储 / 无记录 → 空表', () => {
    expect(loadFavorites(null)).toEqual({})
    const { storage } = mapStorage()
    expect(loadFavorites(storage)).toEqual({})
  })

  it('合法 JSON → 按类别还原', () => {
    const raw = JSON.stringify({ length: ['m', 'ft'], time: ['min'] })
    const { storage } = mapStorage({ [FAVORITES_STORAGE_KEY]: raw })
    expect(loadFavorites(storage)).toEqual({ length: ['m', 'ft'], time: ['min'] })
  })

  it('损坏 JSON / 非对象 / 数组 → 空表', () => {
    for (const raw of ['{oops', 'null', '[]', '"str"', '42']) {
      const { storage } = mapStorage({ [FAVORITES_STORAGE_KEY]: raw })
      expect(loadFavorites(storage)).toEqual({})
    }
  })

  it('类别值非法（非字符串数组）时丢弃该类别，合法类别保留', () => {
    const raw = JSON.stringify({ length: ['m', 2, null], time: 'min', power: ['W'] })
    const { storage } = mapStorage({ [FAVORITES_STORAGE_KEY]: raw })
    expect(loadFavorites(storage)).toEqual({ power: ['W'] })
  })

  it('getItem 抛错 → 空表', () => {
    const storage: StorageLike = {
      getItem: () => {
        throw new Error('SecurityError')
      },
      setItem: () => {}
    }
    expect(loadFavorites(storage)).toEqual({})
  })
})

describe('saveFavorites', () => {
  it('写入 JSON 并可回读', () => {
    const { storage, map } = mapStorage()
    saveFavorites({ length: ['m'] }, storage)
    expect(map.get(FAVORITES_STORAGE_KEY)).toBe('{"length":["m"]}')
    expect(loadFavorites(storage)).toEqual({ length: ['m'] })
  })

  it('null 存储不抛错', () => {
    expect(() => saveFavorites({}, null)).not.toThrow()
  })

  it('setItem 抛错（配额满）时静默', () => {
    const storage: StorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError')
      }
    }
    expect(() => saveFavorites({ length: ['m'] }, storage)).not.toThrow()
  })
})

describe('toggleFavorite', () => {
  it('未收藏 → 追加；已收藏 → 移除；不改动原表', () => {
    const original = { length: ['m'] }
    const added = toggleFavorite(original, 'length', 'ft')
    expect(added).toEqual({ length: ['m', 'ft'] })
    expect(original).toEqual({ length: ['m'] })
    expect(toggleFavorite(added, 'length', 'm')).toEqual({ length: ['ft'] })
    expect(toggleFavorite(added, 'length', 'ft')).toEqual({ length: ['m'] })
  })

  it('未知类别与清空该类别', () => {
    expect(toggleFavorite({}, 'time', 'min')).toEqual({ time: ['min'] })
    expect(toggleFavorite({ time: ['min'] }, 'time', 'min')).toEqual({ time: [] })
  })
})

describe('sortWithFavorites', () => {
  const units = [{ id: 'm' }, { id: 'km' }, { id: 'ft' }, { id: 'mi' }]

  it('收藏置顶且组内保持原顺序', () => {
    expect(sortWithFavorites(units, ['ft', 'mi']).map((u) => u.id)).toEqual(['ft', 'mi', 'm', 'km'])
  })

  it('空收藏与未知收藏 id → 原顺序', () => {
    expect(sortWithFavorites(units, []).map((u) => u.id)).toEqual(['m', 'km', 'ft', 'mi'])
    expect(sortWithFavorites(units, ['foo']).map((u) => u.id)).toEqual(['m', 'km', 'ft', 'mi'])
  })
})

describe('useFavoritesStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('toggle 切换收藏，list 默认空数组', () => {
    const store = useFavoritesStore()
    expect(store.list('length')).toEqual([])
    store.toggle('length', 'm')
    store.toggle('length', 'ft')
    expect(store.list('length')).toEqual(['m', 'ft'])
    expect(store.list('time')).toEqual([])
    store.toggle('length', 'm')
    expect(store.list('length')).toEqual(['ft'])
  })
})
