import { defineStore } from 'pinia'

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export const FAVORITES_STORAGE_KEY = 'lumin.tool.unit-converter.favorites'

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item: unknown) => typeof item === 'string')
}

/** 读取持久化收藏（按类别分组的单位 id）：损坏/非法形状一律回退为空表 */
export function loadFavorites(
  storage: StorageLike | null = defaultStorage()
): Record<string, string[]> {
  if (storage === null) return {}
  try {
    const raw = storage.getItem(FAVORITES_STORAGE_KEY)
    if (raw === null) return {}
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
    const favorites: Record<string, string[]> = {}
    for (const [categoryId, unitIds] of Object.entries(parsed as Record<string, unknown>)) {
      if (isStringArray(unitIds)) favorites[categoryId] = [...unitIds]
    }
    return favorites
  } catch {
    return {}
  }
}

export function saveFavorites(
  favorites: Record<string, string[]>,
  storage: StorageLike | null = defaultStorage()
): void {
  if (storage === null) return
  try {
    storage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(favorites))
  } catch {
    // 配额满等存储失败静默：收藏为增强功能，不阻塞换算
  }
}

/** 收藏切换纯函数：已收藏则移除，未收藏则追加到该类别列表末尾（不改动原表） */
export function toggleFavorite(
  favorites: Record<string, string[]>,
  categoryId: string,
  unitId: string
): Record<string, string[]> {
  const current = favorites[categoryId] ?? []
  const next = current.includes(unitId)
    ? current.filter((id) => id !== unitId)
    : [...current, unitId]
  return { ...favorites, [categoryId]: next }
}

/** 收藏单位置顶排序：收藏组在前、其余在后，组内保持原顺序；收藏表中的未知 id 忽略 */
export function sortWithFavorites<T extends { readonly id: string }>(
  units: readonly T[],
  favorites: readonly string[]
): T[] {
  const favoriteSet = new Set(favorites)
  return [
    ...units.filter((unit) => favoriteSet.has(unit.id)),
    ...units.filter((unit) => !favoriteSet.has(unit.id))
  ]
}

export const useFavoritesStore = defineStore('unit-converter-favorites', {
  state: () => ({
    byCategory: loadFavorites()
  }),
  getters: {
    list:
      (state) =>
      (categoryId: string): string[] =>
        state.byCategory[categoryId] ?? []
  },
  actions: {
    toggle(categoryId: string, unitId: string) {
      this.byCategory = toggleFavorite(this.byCategory, categoryId, unitId)
      saveFavorites(this.byCategory)
    }
  }
})
